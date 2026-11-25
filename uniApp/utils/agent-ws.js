/* ============================================================
 * DF-97：小程序端智能体 WebSocket 连续对话通道（对齐网站 static/agent-ws.js）
 * 职责：换票 → 建连 → session.ready → 流式 delta → assistant.end；
 *       心跳、指数退避重连（带 session_id 续传）、打断、断开清理。
 * 说明：小程序不能自定义握手请求头，票据只能走 query；
 *       本模块不碰录音与播报，只负责文本通道。
 * ============================================================ */
var api = require('./api.js');
var env = require('./env.js');

var BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];
var MAX_RETRY = 8;
// 换票被限流（服务端 429／「请求过于频繁」）时另走一条慢阶梯：短退避会把票打光，越重越快。
var RATE_LIMIT_BACKOFF_MS = [5000, 10000, 20000, 30000, 60000];
// 连上后这么快就断＝连接不稳，不把重试计数清零，否则会无限快重连。
var UNSTABLE_CLOSE_MS = 5000;
var CLIENT_PING_MS = 20000;
var MAX_TEXT_CHARS = 1900;
var READY_TIMEOUT_MS = 8000;   // 建连后等 session.ready 的上限：超时主动断开重连

// 这几种关闭码不重连：限流 / 消息非法 / 票据换了用户
var NO_RETRY_CODES = { 4004: true, 4006: true, 4010: true };

function noop() {}

/** ws_url 若是相对路径，按接口域名补成 wss:// */
function toWsUrl(raw) {
  var u = String(raw || '').trim();
  if (/^wss?:\/\//i.test(u)) return u;
  var origin = env.getApiOrigin().replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  if (!u) return '';
  return origin + (u.charAt(0) === '/' ? u : '/' + u);
}

function AgentChannel(opts) {
  opts = opts || {};
  this.onState = opts.onState || noop;
  this.onDelta = opts.onDelta || noop;
  this.onEnd = opts.onEnd || noop;
  this.onInterrupted = opts.onInterrupted || noop;
  this.onNotice = opts.onNotice || noop;
  this.onError = opts.onError || noop;
  this.onUserText = opts.onUserText || noop;
  this.onClientEventAck = opts.onClientEventAck || noop;   // DF-104：client.event 服务端回执

  this.state = 'idle';
  this.sessionId = opts.sessionId || '';
  // DF-100：会话档位（auto/chat/deep）。与网页端一致走换票（连接级默认档），
  // 不放在 user.message 帧里，避免首帧竞态；不传则保持后端默认（auto）。
  this.scenario = opts.scenario || '';
  this._ticketScenario = '';

  this._task = null;
  this._opened = false;
  this._wantOpen = false;
  this._attempt = 0;
  this._authRetried = false;
  this._retryTimer = null;
  this._pingTimer = null;
  this._readyTimer = null;
  this._stableTimer = null;
  this._readyAt = 0;         // 上次 session.ready 的时刻：判断「连上即断」
  this._unstable = 0;        // 连续不稳定断线次数
  this._rateLimitHits = 0;   // 换票被限流的连续次数
  this._mergeTimer = null;
  this._frag = '';
  this._pendingText = '';
  this._lastSentText = '';
  this._lastSentAt = 0;
  this._generating = false;
  this._assistantText = '';
  this._clientSeq = 0;
}

AgentChannel.prototype.isActive = function () {
  return this._wantOpen && this.state !== 'idle' && this.state !== 'failed';
};

AgentChannel.prototype._setState = function (state, detail) {
  if (this.state === state) return;
  this.state = state;
  try { this.onState(state, detail || null); } catch (e) { /* 忽略 */ }
};

AgentChannel.prototype._send = function (type, data) {
  if (!this._task || !this._opened) return false;
  try {
    this._task.send({ data: JSON.stringify({ type: type, data: data || {} }) });
    return true;
  } catch (e) {
    return false;
  }
};

/** DF-104：上报 client.event（草稿编辑 / 深度解读提交确认 / 放弃草稿）。
 *  返回 false 表示当前没有可用连接，调用方据此提示或走 HTTP 兜底。 */
AgentChannel.prototype.sendEvent = function (name, data) {
  var payload = {};
  if (data && typeof data === 'object') {
    for (var k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
    }
  }
  payload.name = name;
  return this._send('client.event', payload);
};

/** 换票：POST /agent/ws-ticket，用小程序自身登录态鉴权 */
AgentChannel.prototype._fetchTicket = function () {
  var self = this;
  if (!api.getToken()) {
    var err = new Error('请先登录后再使用语音对话');
    err.fatal = true;
    return Promise.reject(err);
  }
  return api.request('/agent/ws-ticket', {
    method: 'POST',
    // DF-100：档位随换票下发（重连换票会自动带上），与网页端 static/agent-ws.js 落点一致
    data: this.scenario ? { scenario: this.scenario } : {}
  }).then(function (body) {
    if (!body || (body.code !== undefined && body.code !== 0)) {
      var msg = (body && (body.detail || body.msg)) || '换票失败，请稍后重试';
      var e1 = new Error(msg);
      if (body && body.code === 401) e1.fatal = true;
      if (body && (body.code === 429 || /过于频繁|稍后再试|too many/i.test(msg))) e1.rateLimited = true;
      throw e1;
    }
    var data = body.data || body;
    if (!data || !data.ticket || !data.ws_url) throw new Error('换票响应缺少字段');
    self._ticketScenario = String(data.scenario || '');
    console.log('[agent-ws] ws-ticket | 请求档位 =', self.scenario || 'auto(默认)',
      '| 回显档位 =', self._ticketScenario || '-');
    return data;
  }).catch(function (e) {
    var err = e instanceof Error ? e : new Error(String(e || '换票失败'));
    if (/登录已过期/.test(err.message || '')) err.fatal = true;
    throw err;
  });
};

AgentChannel.prototype.start = function () {
  if (this._wantOpen) return;
  this._wantOpen = true;
  this._attempt = 0;
  this._authRetried = false;
  this._connect(true);
};

AgentChannel.prototype._connect = function (first) {
  if (!this._wantOpen) return;
  this._clearRetryTimer();
  this._setState(first ? 'ticketing' : 'reconnecting');
  var self = this;
  this._fetchTicket().then(function (ticket) {
    if (!self._wantOpen) return;
    self._open(ticket);
  }).catch(function (e) {
    if (!self._wantOpen) return;   // 已主动退出：不再提示、不再重连
    console.warn('[agent-ws] 换票失败', (e && e.message) || e);
    try { self.onError(e); } catch (err) { /* 忽略 */ }
    if (e && e.fatal) { self._finish('failed'); return; }
    if (e && e.rateLimited) {
      // 限流不是「连不上」，是「换票换太勤」：拉长间隔，且不占普通重试次数。
      self._rateLimitHits = (self._rateLimitHits || 0) + 1;
      if (self._rateLimitHits === 1) {
        try {
          self.onNotice({ code: 'RATE_LIMITED', level: 'warn', message: '服务端限流，正在放慢重连' });
        } catch (err) { /* 忽略 */ }
      }
      var wait = RATE_LIMIT_BACKOFF_MS[Math.min(self._rateLimitHits - 1, RATE_LIMIT_BACKOFF_MS.length - 1)];
      console.warn('[agent-ws] 换票限流，第', self._rateLimitHits, '次，', wait + 'ms 后再试');
      self._scheduleReconnect(false, wait);
      return;
    }
    self._rateLimitHits = 0;
    self._scheduleReconnect();
  });
};

AgentChannel.prototype._open = function (ticket) {
  this._setState('connecting');
  var base = toWsUrl(ticket.ws_url);
  if (!base) {
    this.onError(new Error('连接地址无效'));
    this._scheduleReconnect();
    return;
  }
  var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'ticket=' + encodeURIComponent(ticket.ticket);
  if (this.sessionId) url += '&session_id=' + encodeURIComponent(this.sessionId);
  // 只打去掉 ticket 的地址：真机排查时用于确认是否为 wss 及 socket 合法域名
  console.log('[agent-ws] connect', url.split('?')[0]);

  var self = this;
  var settled = false;
  var task = null;
  try {
    task = wx.connectSocket({
      url: url,
      fail: function (e) {
        if (settled) return;
        settled = true;
        self._opened = false;
        // 真机常见：socket 合法域名未配置 → 这里拿到 "url not in domain list"
        console.warn('[agent-ws] connectSocket fail |', (e && e.errMsg) || 'unknown');
        self._onClose({ code: 0, reason: (e && e.errMsg) || 'connect failed' });
      }
    });
  } catch (e) {
    this.onError(new Error('无法建立连接'));
    this._scheduleReconnect();
    return;
  }
  if (!task) {
    this.onError(new Error('无法建立连接'));
    this._scheduleReconnect();
    return;
  }
  this._task = task;
  this._opened = false;

  // 建连超时：部分机型既不回调 fail 也不回调 close，这里兜底一次
  var connectTimer = setTimeout(function () {
    if (settled || self._opened) return;
    settled = true;
    self._opened = false;
    try { task.close({ code: 1006, reason: 'connect_timeout' }); } catch (e) { /* 忽略 */ }
    self._onClose({ code: 1006, reason: 'connect_timeout' });
  }, 8000);

  task.onOpen(function () {
    clearTimeout(connectTimer);
    self._opened = true;
    // 不在这里清零重试计数：连上即断时清零＝无限快重连。等连接稳住 5 秒再清（见 session.ready）。
    self._authRetried = false;
    self._startPing();
    console.log('[agent-ws] open');
    self._armReadyWatch(task);
  });

  task.onMessage(function (res) {
    self._onFrame(res && res.data);
  });

  task.onClose(function (res) {
    clearTimeout(connectTimer);
    if (settled) return;
    settled = true;
    self._opened = false;
    self._onClose(res || {});
  });

  task.onError(function () {
    // 交给 onClose 统一收口，避免重复重连
  });
};

/** 建连成功但等不到 session.ready：多为反代/鉴权卡住，主动断开交给重连兜底 */
AgentChannel.prototype._armReadyWatch = function (task) {
  var self = this;
  this._clearReadyTimer();
  this._readyTimer = setTimeout(function () {
    self._readyTimer = null;
    if (!self._wantOpen || !self._opened || self.state === 'ready') return;
    console.warn('[agent-ws] ' + READY_TIMEOUT_MS + 'ms 未收到 session.ready，主动断开重连');
    try { task.close({ code: 4005, reason: 'ready_timeout' }); } catch (e) { /* 忽略 */ }
  }, READY_TIMEOUT_MS);
};

AgentChannel.prototype._clearReadyTimer = function () {
  if (this._readyTimer) { clearTimeout(this._readyTimer); this._readyTimer = null; }
};

AgentChannel.prototype._onFrame = function (raw) {
  var frame;
  try { frame = JSON.parse(raw); } catch (e) { return; }
  if (!frame || !frame.type) return;
  var type = frame.type;
  var data = frame.data || {};

  if (type === 'ping') {
    this._send('pong', {});
    return;
  }
  if (type === 'pong') return;

  if (type === 'session.ready') {
    this._clearReadyTimer();
    if (data.session_id) this.sessionId = data.session_id;
    console.log('[agent-ws] session.ready | session_id =', this.sessionId || '-',
      '| scenario =', data.scenario || this._ticketScenario || this.scenario || '-',
      '| model =', data.model || '-', '| model_mode =', data.model_mode || '-');
    this._setState('ready', data);
    this._readyAt = Date.now();
    // 稳住 5 秒才算这轮连接可用：清重试计数与限流计数，之后断线按正常退避走。
    this._clearStableTimer();
    var selfStable = this;
    this._stableTimer = setTimeout(function () {
      selfStable._stableTimer = null;
      if (!selfStable._opened) return;
      selfStable._attempt = 0;
      selfStable._rateLimitHits = 0;
      selfStable._unstable = 0;
    }, UNSTABLE_CLOSE_MS);
    if (this._pendingText) {
      var pending = this._pendingText;
      this._pendingText = '';
      this._emitUserMessage(pending);
    }
    return;
  }
  if (type === 'assistant.start') {
    this._generating = true;
    this._assistantText = '';
    // DF-100：服务端在这一帧回显本轮实际档位，是「有没有走到 chat」的客户端判据
    console.log('[agent-ws] assistant.start | scenario =', data.scenario || '-',
      '| model =', data.model || '-');
    this._setState('generating', data);
    return;
  }
  if (type === 'assistant.delta') {
    this._generating = true;
    var delta = String(data.text || '');
    this._assistantText += delta;
    try { this.onDelta(delta, this._assistantText, data); } catch (e) { /* 忽略 */ }
    return;
  }
  if (type === 'assistant.end') {
    var finalText = String(data.text || this._assistantText || '');
    this._generating = false;
    this._assistantText = '';
    this._setState('ready', data);
    try { this.onEnd(finalText, data); } catch (e) { /* 忽略 */ }
    return;
  }
  if (type === 'assistant.interrupted') {
    this._generating = false;
    this._assistantText = '';
    this._setState('ready', data);
    try { this.onInterrupted(data); } catch (e) { /* 忽略 */ }
    return;
  }
  if (type === 'system.notice') {
    try { this.onNotice(data); } catch (e) { /* 忽略 */ }
    return;
  }
  if (type === 'client.event.ack') {
    try { this.onClientEventAck(data); } catch (e) { /* 忽略 */ }
    return;
  }
  if (type === 'error') {
    try { this.onError(new Error(data.message || '智能体返回错误'), data); } catch (e) { /* 忽略 */ }
    return;
  }
  if (type === 'session.closed') {
    this._setState('idle');
  }
};

AgentChannel.prototype._onClose = function (ev) {
  this._stopPing();
  this._clearReadyTimer();
  this._clearStableTimer();
  this._task = null;
  console.warn('[agent-ws] close | code =', (ev && ev.code), '| reason =', (ev && ev.reason) || '-');

  // ready 后 5 秒内就断＝连接不稳：界面不能一直停在「生成中」，连断两次就把状态拉回空闲并说明。
  var unstable = !!(this._readyAt && (Date.now() - this._readyAt) < UNSTABLE_CLOSE_MS);
  this._readyAt = 0;
  if (unstable) {
    this._unstable = (this._unstable || 0) + 1;
    if (this._unstable >= 2 && this._generating) {
      this._generating = false;
      this._assistantText = '';
      this._setState('idle');
      try {
        this.onNotice({ code: 'REPLY_INTERRUPTED', level: 'warn', message: '连接不稳，这次回复中断了，请再说一次' });
      } catch (e) { /* 忽略 */ }
    }
  } else {
    this._unstable = 0;
  }

  if (!this._wantOpen) {
    this._setState('idle');
    return;
  }

  var code = ev && ev.code;
  if (NO_RETRY_CODES[code]) {
    if (code === 4006) this.onNotice({ code: 'PAYLOAD_TOO_LARGE', level: 'warn', message: '这句话太长了，请缩短后再说' });
    if (code === 4010) this.onNotice({ code: 'SESSION_REPLACED', level: 'warn', message: '会话已在其它页面打开' });
    this._finish('closed');
    return;
  }
  if (code === 4005) {
    // 续传的会话已不在服务端：清 session_id 重建
    this.sessionId = '';
    this.onNotice({ code: 'SESSION_GONE', level: 'warn', message: '会话已过期，正在新建' });
    this._attempt = 0;
    this._scheduleReconnect();
    return;
  }
  if ((code === 4001 || code === 4002) && !this._authRetried) {
    this._authRetried = true;
    this.sessionId = '';
    this._scheduleReconnect(true);
    return;
  }

  this._setState('reconnecting');
  this._scheduleReconnect();
};

AgentChannel.prototype._scheduleReconnect = function (immediate, delayOverride) {
  if (!this._wantOpen) return;
  this._clearRetryTimer();
  if (delayOverride !== undefined && delayOverride !== null) {
    // 指定间隔（限流阶梯）：不计入普通重试次数，也不受 MAX_RETRY 截断。
    var selfDelay = this;
    this._retryTimer = setTimeout(function () {
      selfDelay._retryTimer = null;
      selfDelay._connect(false);
    }, delayOverride);
    return;
  }
  this._attempt += 1;
  if (this._attempt > MAX_RETRY) {
    this.onError(new Error('连接失败，请稍后重试'));
    this._finish('failed');
    return;
  }
  var delay = immediate ? 0 : BACKOFF_MS[Math.min(this._attempt - 1, BACKOFF_MS.length - 1)];
  var self = this;
  this._retryTimer = setTimeout(function () {
    self._retryTimer = null;
    self._connect(false);
  }, delay);
};

AgentChannel.prototype._startPing = function () {
  this._stopPing();
  var self = this;
  this._pingTimer = setInterval(function () {
    if (self._opened) self._send('ping', {});
  }, CLIENT_PING_MS);
};

AgentChannel.prototype._stopPing = function () {
  if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
};

AgentChannel.prototype._clearRetryTimer = function () {
  if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
};

AgentChannel.prototype._clearStableTimer = function () {
  if (this._stableTimer) { clearTimeout(this._stableTimer); this._stableTimer = null; }
};

AgentChannel.prototype._emitUserMessage = function (text) {
  var t = String(text || '').trim();
  if (!t) return;
  if (t.length > MAX_TEXT_CHARS) {
    t = t.slice(0, MAX_TEXT_CHARS);
    this.onNotice({ code: 'TEXT_TRUNCATED', level: 'warn', message: '内容较长，已截取前半段' });
  }
  this._clientSeq += 1;
  var ok = this._send('user.message', {
    text: t,
    client_msg_id: 'c_' + Date.now().toString(36) + '_' + this._clientSeq
  });
  if (!ok) {
    this._pendingText = t;
    this.onNotice({ code: 'SEND_FAILED', level: 'warn', message: '消息发送失败，正在重连，稍后自动重发' });
    return;
  }
  this._lastSentText = t;
  this._lastSentAt = Date.now();
  try { this.onUserText(t); } catch (e) { /* 忽略 */ }
  this._setState('thinking');
};

/**
 * 接收一句「已识别完」的语音。
 * 短句在合并窗口内拼成同一句，避免每句都当新提问。
 */
AgentChannel.prototype.pushFragment = function (text) {
  var t = String(text || '').trim();
  if (!t) return;

  if (this._generating) {
    // 用户抢话：先打断；明显的补充语按并句处理
    this.interrupt('user_barge_in');
    var additive = /^(还有|另外|补充|对了|再加上|以及|然后|顺便)/.test(t);
    var short = t.replace(/[\s，。！？、,.!?]/g, '').length <= 20;
    var within = this._lastSentText && (Date.now() - this._lastSentAt < 8000);
    this._frag = (within && short && additive) ? this._lastSentText + '，' + t : t;
  } else {
    this._frag = this._frag ? this._joinFragment(this._frag, t) : t;
  }

  if (this._mergeTimer) { clearTimeout(this._mergeTimer); this._mergeTimer = null; }
  var self = this;
  this._mergeTimer = setTimeout(function () {
    self._mergeTimer = null;
    self._flush();
  }, this._mergeDelay());
};

AgentChannel.prototype._joinFragment = function (prev, next) {
  if (!prev) return next;
  if (/[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(next)) return prev + ' ' + next;
  return prev + next;
};

/** 合并窗口：句末标点 200ms、长句 350ms、短句 500ms，未完结语气再等一拍 */
AgentChannel.prototype._mergeDelay = function () {
  if (/[。！？!?；;…]$/.test(this._frag)) return 200;
  var n = this._frag.replace(/\s/g, '').length;
  var delay = n <= 12 ? 500 : 350;
  if (/(的|了|和|与|跟|把|被|因为|所以|但是|然后|如果|虽然|还是|就是|这个|那个|地|得|就|而|才)$/.test(this._frag)) delay += 300;
  return delay;
};

AgentChannel.prototype._flush = function () {
  var text = this._frag.trim();
  this._frag = '';
  if (!text) return;
  if (this._opened && this.state !== 'idle') {
    this._emitUserMessage(text);
  } else {
    this._pendingText = text;
    this.onNotice({ code: 'NOT_CONNECTED', level: 'warn', message: '连接已断开，正在重连，这句话稍后自动发送' });
  }
};

AgentChannel.prototype.flushNow = function () {
  if (this._mergeTimer) { clearTimeout(this._mergeTimer); this._mergeTimer = null; }
  this._flush();
};

AgentChannel.prototype.interrupt = function (reason) {
  if (!this._opened) return;
  if (!this._generating) return;
  this._send('interrupt', { reason: reason || 'user_barge_in' });
};

AgentChannel.prototype._finish = function (reason) {
  this._wantOpen = false;
  this._stopPing();
  this._clearRetryTimer();
  this._clearReadyTimer();
  if (this._mergeTimer) { clearTimeout(this._mergeTimer); this._mergeTimer = null; }
  this._frag = '';
  this._pendingText = '';
  this._generating = false;
  this._task = null;
  this._opened = false;
  this._setState(reason === 'failed' ? 'failed' : 'idle');
};

AgentChannel.prototype.stop = function () {
  var task = this._task;
  this._wantOpen = false;
  this._stopPing();
  this._clearRetryTimer();
  this._clearReadyTimer();
  if (this._mergeTimer) { clearTimeout(this._mergeTimer); this._mergeTimer = null; }
  this._frag = '';
  this._pendingText = '';
  this._task = null;
  this._opened = false;
  if (task) {
    try { task.close({ code: 1000, reason: 'client_stop' }); } catch (e) { /* 忽略 */ }
  }
  this._generating = false;
  this._setState('idle');
};

module.exports = AgentChannel;
