/* ============================================================
 * DF-97：小程序首页「自由对话」通道编排（对齐网站 xiaoxuan.html 的自由对话）
 *
 * 链路：换票 → WebSocket 文本通道 → 流式 delta → 分句 TTS 连续播报；
 *       同时用连续语音识别把每一句识别结果送进通道。
 * 约束：
 *   - 与麦克风链路严格分离，不触发正式提问/不弹积分/不扣积分；
 *   - 通道内不计费、不建会话摘要、退出不续聊；
 *   - 被打断后不自动续播（丢弃未播内容），由用户继续说触发新一轮；
 *   - 播报中用户开口即打断；播报结束后的短时窗口内丢弃自身回声。
 * ============================================================ */
var AgentChannel = require('./agent-ws.js');
var asr = require('./asr.js');
var tts = require('./tts.js');
var api = require('./api.js');

var GREETING = '你好，我在。想聊点什么？';
var TAIL_MS = 400;          // 播报结束后仍视为「正在说」的尾窗
var POST_ECHO_MS = 2500;    // 播报结束后的回声丢弃窗口
var ECHO_SIM = 0.55;        // 文本相似度阈值
var SPOKEN_MAX = 7;         // 回声比对保留的最近句子数
var MIN_SEND_CHARS = 2;
var SOFT_SEG = 26;          // 无标点长句的软切长度
var MIN_SEG = 6;

function noop() {}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000，。！？、；：,.!?;:"'“”‘’（）()【】\[\]…—\-]/g, '');
}

function bigrams(s) {
  var out = [];
  for (var i = 0; i + 1 < s.length; i++) out.push(s.substr(i, 2));
  return out;
}

/** Dice 相似度：2×交集/(A+B) */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  var A = bigrams(a);
  var B = bigrams(b);
  if (!A.length || !B.length) return 0;
  var pool = {};
  for (var i = 0; i < B.length; i++) pool[B[i]] = (pool[B[i]] || 0) + 1;
  var hit = 0;
  for (var j = 0; j < A.length; j++) {
    if (pool[A[j]]) { hit++; pool[A[j]]--; }
  }
  return (2 * hit) / (A.length + B.length);
}

/** 从流式缓冲里切出可播的整句，返回剩余缓冲 */
function takeSentences(buf) {
  var rest = String(buf || '');
  var segs = [];
  while (true) {
    var m = rest.match(/^[\s\S]*?[。！？!?；;…\n]/);
    if (!m) break;
    var s = m[0].trim();
    if (s) segs.push(s);
    rest = rest.slice(m[0].length);
  }
  if (rest.length > SOFT_SEG) {
    var idx = -1;
    for (var i = SOFT_SEG - 1; i >= MIN_SEG; i--) {
      if (/[，,、：:]/.test(rest.charAt(i))) { idx = i; break; }
    }
    if (idx < 0) idx = SOFT_SEG - 1;
    var cut = rest.slice(0, idx + 1).trim();
    if (cut) segs.push(cut);
    rest = rest.slice(idx + 1);
  }
  return { segs: segs, rest: rest };
}

function FreeTalk(opts) {
  opts = opts || {};
  this.onState = opts.onState || noop;
  this.onUserText = opts.onUserText || noop;
  this.onSpeaking = opts.onSpeaking || noop;
  this.onNotice = opts.onNotice || noop;
  this.onError = opts.onError || noop;

  this._active = false;
  this._channel = null;
  this._ttsOff = null;
  this._greeted = false;
  this._buf = '';
  this._replyDelta = 0;
  // 被打断后到下一轮 assistant.start 之间，丢弃在途 delta，避免自动续播
  this._muteDeltas = false;
  this._spokeSomething = false;
  this._tailUntil = 0;
  this._postEchoUntil = 0;
  this._spoken = [];
  this._lastFinal = '';
  this._lastFinalAt = 0;
}

FreeTalk.prototype.isActive = function () {
  return this._active;
};

FreeTalk.prototype.start = function () {
  if (this._active) return;
  if (!api.getToken()) {
    this.onError(new Error('请先登录后再使用语音对话'));
    return;
  }
  this._active = true;
  var self = this;

  this._ttsOff = tts.addStateListener(function (state, extra) {
    if (!self._active) return;
    if (state === 'playing') {
      var seg = String((extra && extra.text) || '');
      if (seg) {
        self._spokeSomething = true;
        self._rememberSpoken(seg);
      }
      self._emitState('speaking');
    } else if (state === 'end') {
      if (!self._spokeSomething) return;
      self._spokeSomething = false;
      self._tailUntil = Date.now() + TAIL_MS;
      self._postEchoUntil = Date.now() + POST_ECHO_MS;
      self._emitState('listening');
    }
  });

  this._channel = new AgentChannel({
    onState: function (state, detail) {
      if (state === 'ready') {
        self._replyDelta = 0;
        self._emitState('ready');
        self._ensureAsr();
        if (!self._greeted) {
          self._greeted = true;
          self._speakText(GREETING);
        }
        return;
      }
      if (state === 'generating') {
        // 新一轮回复开始：解除打断后的静音，允许正常播报
        self._replyDelta = 0;
        self._muteDeltas = false;
        return;
      }
      if (state === 'thinking') { self._emitState('thinking'); return; }
      if (state === 'failed' || state === 'closed' || state === 'idle') {
        self._emitState(state);
        return;
      }
      self._emitState(state);
    },
    onDelta: function (delta) {
      if (self._muteDeltas) return;   // 打断后残留 delta：不续播
      self._replyDelta += 1;
      self._buf += String(delta || '');
      self._drainBuffer(false);
    },
    onEnd: function (text) {
      if (self._muteDeltas) {         // 被用户打断的这一轮：不补播整段
        self._muteDeltas = false;
        self._replyDelta = 0;
        self._buf = '';
        return;
      }
      // 流式没有 delta（极短回复）时把整段补播
      if (self._replyDelta === 0 && text) self._buf += String(text);
      self._replyDelta = 0;
      self._drainBuffer(true);
    },
    onInterrupted: function () {
      // 服务端确认打断：丢弃未播内容，静音在途 delta，不自动续播
      self._muteDeltas = true;
      self._resetSpeech();
    },
    onNotice: function (n) {
      if (!n || !n.message) return;
      try { self.onNotice(n); } catch (e) { /* 忽略 */ }
    },
    onError: function (e, detail) {
      try { self.onError(e, detail); } catch (err) { /* 忽略 */ }
    },
    onUserText: function () { /* 通道回显由本地先展示，避免重复 */ }
  });

  this._channel.start();
};

/** 连续识别：一段说完自动续录 */
FreeTalk.prototype._ensureAsr = function () {
  var self = this;
  asr.startContinuous({
    onPartial: function (text) {
      if (!self._active) return;
      if (self._speaking()) return;  // 播报中不展示中间结果，避免回声闪字
      try { self.onUserText(String(text || '').trim(), false); } catch (e) { /* 忽略 */ }
    },
    onFinal: function (text) {
      self._onAsrFinal(text);
    },
    onError: function (e, fatal) {
      if (!self._active) return;
      if (fatal) {
        self.onError(new Error('连续语音识别不可用：' + (e && e.message ? e.message : e)));
        self.stop();
      }
    }
  });
};

FreeTalk.prototype._onAsrFinal = function (text) {
  if (!this._active) return;
  var t = String(text || '').trim();
  if (!t) return;
  var now = Date.now();
  if (t === this._lastFinal && now - this._lastFinalAt < 1200) return;
  this._lastFinal = t;
  this._lastFinalAt = now;

  if (this._speaking()) {
    if (this._isEcho(t)) return;                 // 自己的播报回声
    if (now < this._tailUntil) return;           // 播报刚结束的尾音
    if (norm(t).length < MIN_SEND_CHARS) return;
    this._bargeIn(t);
    return;
  }
  if (now < this._postEchoUntil && this._isEcho(t)) return;
  this._sendUser(t);
};

FreeTalk.prototype._speaking = function () {
  return tts.isPlaying() || Date.now() < this._tailUntil;
};

FreeTalk.prototype._rememberSpoken = function (seg) {
  var n = norm(seg);
  if (n.length < 2) return;
  this._spoken.push(n);
  if (this._spoken.length > SPOKEN_MAX) this._spoken.shift();
};

FreeTalk.prototype._isEcho = function (text) {
  var n = norm(text);
  if (n.length < 2) return false;
  for (var i = 0; i < this._spoken.length; i++) {
    if (similarity(n, this._spoken[i]) >= ECHO_SIM) return true;
  }
  return false;
};

/** 打断：停播 + 丢弃未播内容（不自动续播），随后把这句话当新输入 */
FreeTalk.prototype._bargeIn = function (text) {
  // 先静音上一轮残留 delta，再由通道打断并作为新输入发出
  this._muteDeltas = true;
  this._resetSpeech();
  this._sendUser(text);
};

FreeTalk.prototype._resetSpeech = function () {
  this._buf = '';
  this._spokeSomething = false;
  this._tailUntil = 0;
  this._postEchoUntil = 0;
  try { tts.stop(true); } catch (e) { /* 忽略 */ }
  try { this.onSpeaking(false); } catch (e) { /* 忽略 */ }
};

FreeTalk.prototype._sendUser = function (text) {
  if (!this._active || !this._channel) return;
  try { this.onUserText(text, true); } catch (e) { /* 忽略 */ }
  this._emitState('thinking');
  this._channel.pushFragment(text);
  this._channel.flushNow();
};

FreeTalk.prototype._speakText = function (text) {
  var t = String(text || '').trim();
  if (!t) return;
  tts.enqueue(t);
  this._emitState('speaking');
};

FreeTalk.prototype._drainBuffer = function (final) {
  var cut = takeSentences(this._buf);
  this._buf = cut.rest;
  for (var i = 0; i < cut.segs.length; i++) tts.enqueue(cut.segs[i]);
  if (final) {
    var tail = this._buf.trim();
    this._buf = '';
    if (tail) tts.enqueue(tail);
  }
};

FreeTalk.prototype._emitState = function (state) {
  try { this.onState(state); } catch (e) { /* 忽略 */ }
};

FreeTalk.prototype.stop = function () {
  if (!this._active) return;
  this._active = false;
  if (this._ttsOff) { this._ttsOff(); this._ttsOff = null; }
  try { asr.stopContinuous(); } catch (e) { /* 忽略 */ }
  try { tts.stop(true); } catch (e) { /* 忽略 */ }
  if (this._channel) {
    try { this._channel.stop(); } catch (e) { /* 忽略 */ }
    this._channel = null;
  }
  this._buf = '';
  this._spoken = [];
  this._tailUntil = 0;
  this._postEchoUntil = 0;
  try { this.onSpeaking(false); } catch (e) { /* 忽略 */ }
};

function create(opts) {
  return new FreeTalk(opts);
}

module.exports = {
  create: create,
  similarity: similarity,
  takeSentences: takeSentences
};
