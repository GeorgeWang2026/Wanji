/* ============================================================
 * 首页 · 对话（对应 xiaoxuan.html 的聊天主流程）
 * ------------------------------------------------------------
 * 主流程：输入问题 → 关联排盘 → 积分确认/扣减 → /chat → Markdown 渲染 → 可选语音播报
 * 语音输入：录音 → /speech/asr → 回填输入框
 *
 * 与网页版的关键差异（详见 uniApp/README.md）：
 *   - 所有 DOM 操作改为 setData + WXML 绑定
 *   - Web Speech API → wx.getRecorderManager + 后端 ASR
 *   - speechSynthesis → wx.createInnerAudioContext + 后端 TTS
 *   - localStorage → wx.setStorageSync
 *   - 语音识别后不自动发送（涉及扣积分，交回用户确认）
 * ============================================================ */
var api = require('../../utils/api.js');
var env = require('../../utils/env.js');
var md = require('../../utils/markdown.js');
var tts = require('../../utils/tts.js');
var asr = require('../../utils/asr.js');
var paipanUtil = require('../../utils/paipan.js');

// 与 assistant-widget.js 的 XIAOXUAN_DEFAULT_SYSTEM 保持一致
var SYSTEM_PROMPT = '你是玄机子，九天玄女化身的智能助手。你同时擅长：健康咨询、学业辅导、工作助理、情感顾问、战略决策。'
  + '回复温柔聪慧，中文，简洁友好。'
  + '若用户是在分析页面，你可以调用奇门遁甲/八字/梅花易数排盘来辅助判断。';

var MSG_SEQ = 0;

// 与 assistant-widget.js 的 XB_AVATAR_CONFIGS 保持一致（网页版 4 个智能体头像）
var AVATARS = [
  { file: '/avatar/xiaoxuan_1.png', name: '神机子' },
  { file: '/avatar/xiaoxuan_21.png', name: '天机子' },
  { file: '/avatar/xiaoxuan_3.png', name: '灵机子' },
  { file: '/avatar/xiaoxuan_4.jpg', name: '时机子' }
];

var EXAMPLES = [
  '我这周适合谈一笔合作吗？',
  '帮我看下今年的财运走势与关键节点',
  '最近工作变动频繁，该留还是该走？'
];

// 技能 key → 展示名（/credits/questions 的 usages[].tool 即这几个 key）
var TOOL_LABELS = { qimen: '奇门遁甲', bazi: '四柱八字', meihua: '梅花易数', stock: '证券' };
// 技能卡片图标/配色（照抄参考页 _paipanCardHtml 的 toolMeta）
var TOOL_CHIPS = {
  qimen: { icon: '☯', cls: 'qm' },
  bazi: { icon: '命', cls: 'bazi' },
  meihua: { icon: '☰', cls: 'meihua' },
  stock: { icon: '📈', cls: 'stock' }
};

/** 参考页 _xbFeishuBtnHtml 的三种文案 */
function feishuLabel(url, state) {
  if (url) return '📄 报告 ↗';
  if (state === 'off') return '📄 报告（未配置）';
  return '📄 报告';
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/** 参考页置顶区 header 时间带年份：toLocaleString('zh-CN',{year,month,day,hour,minute}) */
function fmtFullTime(v) {
  if (!v) return '';
  var d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 参考页 bound-tag 只显示「图标 + 原始信息」（DF-43）：奇门/梅花/八字=公历时间，证券=名称代码 */
function chipDetail(type, entry) {
  var m = (entry && entry.meta) || {};
  var pl = (entry && entry.payload) || {};
  function fmt(yy, mm, dd, hh, mi) {
    if (!yy) return '';
    return yy + '-' + pad2(mm) + '-' + pad2(dd) + ' ' + pad2(hh || 0) + ':' + pad2(mi || 0);
  }
  if (type === 'qimen') {
    var st = pl.solar_time || {};
    return fmt(st.y || m.y, st.m || m.m, st.d || m.d,
      st.h != null ? st.h : m.h, st.mi != null ? st.mi : m.mi);
  }
  if (type === 'bazi') {
    return fmt(pl.py || m.y, pl.pm || m.m, pl.pd || m.d,
      pl.ph != null ? pl.ph : m.h, pl.pmi != null ? pl.pmi : m.mi);
  }
  if (type === 'meihua') {
    var t = m.time || {};
    return fmt(t.y, t.m, t.d, t.h, t.mi);
  }
  if (type === 'stock') {
    var s = (entry && entry.stock) || {};
    return s.name ? (s.name + (s.code ? ' ' + s.code : '')) : '';
  }
  return '';
}

/** 后端 iso_utc → 参考页 toLocaleString('zh-CN',{month,day,hour,minute}) 的 "MM/DD HH:mm" */
function fmtTime(v) {
  if (!v) return '';
  var d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 参考页 _chatState.items 同时包含根与追问（追问 target_id = 根 id）；
 *  分页「还剩 N 条」按 items.length 计算，这里同样把已加载追问计入。 */
function countShown(list) {
  var n = 0;
  (list || []).forEach(function (r) { n += 1 + ((r.followups || []).length); });
  return n;
}

function app() { return getApp(); }
function nowStr() {
  var d = new Date();
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: {
    messages: [],
    input: '',
    sending: false,
    typing: false,
    typingText: '正在起盘…',
    scrollTo: '',
    balance: null,
    loggedIn: false,
    userName: '',
    chips: [],
    skillActive: { qimen: false, bazi: false, meihua: false },
    ttsOn: true,
    speaking: false,
    recording: false,
    recSeconds: 0,
    showLogin: false,
    loginUser: '',
    loginPwd: '',
    loginPwd2: '',
    loginName: '',
    authMode: 'login',   // login | register（对应参考页 auth-tabs）
    authError: '',
    apiOrigin: '',
    /* ---- 个人中心（对应参考页 #profileModal） ---- */
    showProfile: false,
    userId: '',
    /* ---- 积分消耗确认（对应参考页自绘对话框） ---- */
    costOpen: false,
    costCredits: 5,
    costTypesText: '',
    /* ---- 删除确认（参考页浅色自绘确认框） ---- */
    delOpen: false,
    delIdx: -1,
    /* ---- 界面状态（对齐 xiaoxuan.html 布局） ---- */
    statusBarH: 0,
    topOpen: true,
    inputOpen: false,
    showHistory: false,
    // 咨询记录：服务端 question_records 列表（/credits/questions），页面以此为准
    historyRecords: [],
    // 本次会话按消息聚合出的临时卡片，仅用于接口未返回/失败时的即时展示
    sessionRecords: [],
    historyLoading: false,
    historyLoadingMore: false,
    historyError: '',
    historyAppendError: '',
    historyTotal: 0,
    historyShown: 0,
    historyPage: 0,
    historyPageSize: 5,
    lastQuestion: '',
    /* ---- 顶部咨询面板（参考页 #panelTop：pinnedContext / sentPreview / ttsLines） ---- */
    pinned: null,          // { id, timeText, question, feishuUrl, followups[] }
    sentVisible: false,    // #sentPreview
    sentContent: '',
    sentFeishuUrl: '',
    ttsText: '',           // #ttsLines 字幕内容
    ttsLabel: '玄机子',
    examples: EXAMPLES,
    avatarIdx: 0,
    avatarSrc: '',
    avatarErr: false
  },

  /* ---------------- 生命周期 ---------------- */
  onLoad: function () {
    var u = api.readUser();
    var statusBarH = 0;
    try {
      var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      statusBarH = info.statusBarHeight || 0;
    } catch (e) { /* 忽略 */ }

    // 默认开启自动播报；用户长按关闭后写入 globalData，本次运行内保持
    var g0 = app().globalData;
    if (g0 && typeof g0.ttsOn !== 'boolean') g0.ttsOn = true;

    this.setData({
      loggedIn: !!u,
      userName: u ? u.name : '',
      userId: u ? String(u.uid || '') : '',
      apiOrigin: env.getApiOrigin(),
      ttsOn: !(g0 && g0.ttsOn === false),
      statusBarH: statusBarH,
      avatarSrc: env.getApiOrigin() + AVATARS[0].file
    });
    this.rootQuestionId = null; // question_records 根记录 id（追问免费）
    this.questionId = null;     // 本轮 question_records.id（consume 返回，/chat 回写答案用）
    this.chatMsgId = null;      // 上一条回复的 chat_messages.id（作为追问的 target_id）
    this.autoMetas = [];        // 本轮兜底自动起的盘
    this._ttsText = '';         // 最近一条被播报的文本（暂停后恢复用）

    var self = this;
    tts.setStateCallback(function (state) {
      self.setData({ speaking: state === 'playing' });
    });

    if (!md.available) {
      this.pushMsg('assistant', '提示：Markdown 渲染库加载失败，回复将以纯文本展示。请确认工程根 markdown.js 未被小程序打包忽略。');
    }
    this.loadBalance();
  },

  onShow: function () {
    var u = api.readUser();
    this.setData({ loggedIn: !!u, userName: u ? u.name : '', userId: u ? String(u.uid || '') : '' });
    this.syncChips();
  },

  onUnload: function () {
    tts.stop(true);
    if (this.recTimer) clearInterval(this.recTimer);
  },

  noop: function () {},

  /* ---------------- 界面交互（面板 / 头像 / 记录） ---------------- */
  toggleTop: function () {
    this.setData({ topOpen: !this.data.topOpen });
  },

  toggleInput: function () {
    // 录音期间禁止收起：收起会把正在回填的文字藏起来，先结束录音
    if (this.data.recording && this.data.inputOpen) {
      wx.showToast({ title: '录音中，结束后再收起', icon: 'none' });
      return;
    }
    var open = !this.data.inputOpen;
    this.setData({ inputOpen: open, topOpen: open ? false : true });
  },

  openHistory: function () {
    this.historyFromProfile = false;
    if (this.data.recording) {
      wx.showToast({ title: '录音中，结束后再查看', icon: 'none' });
      return;
    }
    // 参考页：未登录点「咨询记录」先弹登录，登录成功后自动打开
    if (!this.data.loggedIn) {
      this.pendingHistory = true;
      this.setData({ showLogin: true });
      return;
    }
    // 先用本次会话的本地聚合占位，随后以服务端列表为准
    this.buildHistory();
    this.setData({ showHistory: true, inputOpen: false, scrollTo: '' });
    this.loadHistory(false);
  },

  closeHistory: function () {
    // 从个人中心「我的咨询记录」进来的，返回上一层（个人中心），而不是直接回首页
    var backToProfile = !!this.historyFromProfile;
    this.historyFromProfile = false;
    this.setData({
      showHistory: false,
      scrollTo: '',
      showProfile: backToProfile && this.data.loggedIn
    });
  },

  /** 咨询记录条目折叠/展开（参考页 toggleChatItem：点 header / 问题行切换 .expanded） */
  /* ---------------- 咨询记录：按 root qid 聚合成卡片 ---------------- */
  /**
   * messages → sessionRecords（仅本次会话的即时展示）
   * 正式的咨询记录列表以服务端 /credits/questions 为准（loadHistory）；
   * 这里只在接口未返回或失败时兜底，保证刚问完立刻能看到。
   */
  buildHistory: function () {
    var list = this.data.messages || [];
    var prevExp = {};
    var prevFu = {};
    (this.data.sessionRecords || []).forEach(function (r) {
      prevExp[r.id] = r.expanded;
      (r.followups || []).forEach(function (f) { prevFu[f.id] = f.expanded; });
    });

    var recs = [];
    var byQid = {};
    var cur = null;
    var curFu = null;

    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.role === 'user') {
        var key = m.qid ? ('q' + m.qid) : ('l' + m.id);
        if (m.qid && byQid[key]) {
          var fu = {
            id: 'f' + m.id,
            text: m.text,
            timeText: m.timeText || '',
            expanded: prevFu['f' + m.id] === true,
            reply: '',
            replyHtml: '',
            replyId: 0
          };
          byQid[key].followups.push(fu);
          cur = byQid[key];
          curFu = fu;
        } else {
          var chips = (m.types || []).map(function (t) {
            var meta = TOOL_CHIPS[t] || { icon: '📐', cls: '' };
            return { type: t, icon: meta.icon, cls: meta.cls, label: '' };
          });
          var rec = {
            id: 'r' + m.id,
            qid: m.qid || '',
            question: m.text,
            timeText: m.timeText || '',
            userName: '',
            modeText: 'AI',
            sourceText: '玄机子助手',
            skillChips: chips,
            notice: '',
            reply: '',
            replyHtml: '',
            replyId: 0,
            lastMsgId: '',
            reportUrl: '',
            feishuState: 'none',
            feishuLabel: feishuLabel('', 'none'),
            expanded: prevExp['r' + m.id] === true,
            followups: []
          };
          recs.push(rec);
          byQid[key] = rec;
          cur = rec;
          curFu = null;
        }
      } else if (m.role === 'assistant' && cur) {
        if (m.plainOnly) {
          cur.notice = m.text;
          continue;
        }
        if (curFu && !curFu.reply) {
          curFu.reply = m.plain || m.text;
          curFu.replyHtml = m.html || '';
          curFu.replyId = m.id;
        } else {
          var wasEmpty = !cur.reply;
          cur.reply = m.plain || m.text;
          cur.replyHtml = m.html || '';
          cur.replyId = m.id;
          if (wasEmpty) cur.expanded = true;   // 新到的回复默认展开
        }
        if (m.msgId) cur.lastMsgId = m.msgId;
      }
    }

    // 飞书链接不再从正文抓取：服务端列表/详情直接返回 feishu_doc_url
    this.setData({ sessionRecords: recs });
  },

  /* ---------------- 咨询记录：服务端 question_records（真实接口） ---------------- */
  /**
   * /credits/questions 列表项 → 卡片数据（字段绑定，不改参考页结构）
   * 技能来自 usages[].tool；飞书链接来自 feishu_doc_url；
   * 后端不返回 mode（网页版同样写死 'llm'）→ badge 固定 AI；
   * 后端不返回 display_name → 参考页此时不渲染昵称，这里同样留空。
   * paipan_data 为 null（列表接口不返回），参考页此时技能卡片只渲染图标、无 bt-detail。
   */
  _toRecord: function (it, prev) {
    var tools = [];
    (it.usages || []).forEach(function (u) {
      var t = u && u.tool;
      if (t && tools.indexOf(t) < 0) tools.push(t);
    });
    var chips = tools.map(function (t) {
      var meta = TOOL_CHIPS[t] || { icon: '📐', cls: '' };
      return { type: t, icon: meta.icon, cls: meta.cls || 'qm', label: '' };
    });
    var answer = it.answer || '';
    var url = it.feishu_doc_url || '';
    return {
      id: it.id,
      qid: it.id,                       // question_records 根 id（主问题）
      question: it.question || '',
      createdAt: it.created_at || '',
      reply: answer,
      replyHtml: answer ? md.historyHtml(answer) : '',
      timeText: fmtTime(it.created_at),
      userName: '',
      modeText: 'AI',
      sourceText: '玄机子助手',
      skillChips: chips,
      notice: '',
      reportUrl: url,
      feishuState: url ? 'ready' : 'none',
      feishuLabel: feishuLabel(url, url ? 'ready' : 'none'),
      followupCount: it.followup_count || 0,
      followups: [],
      expanded: !!(prev && prev.expanded)
    };
  },

  /** 详情里的 followups[] → .chat-item-followup（只有 id + 问题文本，与参考页一致） */
  _mapFollowups: function (list) {
    return (list || []).map(function (f) {
      return { id: f.id, text: f.question || '' };
    });
  },

  /**
   * GET /credits/questions?page&size —— 列表 + 追问懒加载
   * 列表项只带 followup_count，追问必须再拉 /credits/questions/{id}（与网页版 DF-43 一致）。
   */
  loadHistory: function (append) {
    var self = this;
    if (this._histLoading) return;
    if (!api.getToken()) {
      this.setData({ historyLoading: false, historyError: '请先登录后查看咨询记录' });
      return;
    }
    var page = append ? (this.data.historyPage + 1) : 1;
    this._histLoading = true;
    /* 参考页 loadChatHistory：非追加时 body.innerHTML 先换成「加载中…」，
       这里清空列表让空态区显示加载中，避免沿用上一次的旧列表。 */
    var loadingPatch = { historyLoading: !append, historyLoadingMore: !!append, historyError: '', historyAppendError: '' };
    if (!append) {
      loadingPatch.historyRecords = [];
      loadingPatch.historyShown = 0;
    }
    this.setData(loadingPatch);

    api.request('/credits/questions?page=' + page + '&size=' + this.data.historyPageSize)
      .then(function (res) {
        if (!res || res.code !== 0 || !res.data) {
          throw new Error((res && (res.detail || res.msg)) || '加载失败');
        }
        var prevMap = {};
        (self.data.historyRecords || []).forEach(function (r) { prevMap[r.id] = r; });
        var items = (res.data.items || []).map(function (it) {
          return self._toRecord(it, prevMap[it.id]);
        });
        var merged = append ? (self.data.historyRecords || []).concat(items) : items;
        // 按 id 去重，避免重试/抖动导致重复条目
        var seen = {};
        merged = merged.filter(function (r) {
          if (seen[r.id]) return false;
          seen[r.id] = true;
          return true;
        });
        self._histLoading = false;
        self.setData({
          historyRecords: merged,
          historyTotal: res.data.total || merged.length,
          historyShown: countShown(merged),
          historyPage: page,
          historyLoading: false,
          historyLoadingMore: false,
          historyError: '',
          historyAppendError: ''
        });
        self._loadFollowups(items);
      })
      .catch(function (err) {
        self._histLoading = false;
        var msg = (err && err.message) || '加载失败';
        if (/登录已过期/.test(msg)) {
          self.setData({ loggedIn: false, showHistory: false, showLogin: true });
          return;
        }
        if (append) {
          // 参考页追加失败：保留已加载内容，底部给「加载失败，点击重试」
          self.setData({ historyLoadingMore: false, historyAppendError: msg });
          return;
        }
        // 参考页首屏失败：空态区 ❌ 错误 + 「点击重试」
        self.setData({ historyRecords: [], historyShown: 0, historyLoading: false, historyError: msg });
      });
  },

  retryHistory: function () {
    this.loadHistory(this.data.historyRecords.length > 0);
  },

  /** 为带 followup_count 的根记录补拉 /credits/questions/{id}，注入追问列表 */
  _loadFollowups: function (roots) {
    var self = this;
    var targets = (roots || []).filter(function (r) {
      return r.followupCount > 0 && !(r.followups && r.followups.length);
    });
    if (!targets.length) return;
    Promise.all(targets.map(function (r) {
      return api.request('/credits/questions/' + r.id)
        .then(function (j) { return (j && j.code === 0 && j.data) ? j.data : null; })
        .catch(function () { return null; });
    })).then(function (details) {
      var byId = {};
      details.forEach(function (d) { if (d) byId[d.id] = d; });
      var patch = {};
      (self.data.historyRecords || []).forEach(function (rec, i) {
        var d = byId[rec.id];
        if (!d) return;
        patch['historyRecords[' + i + '].followups'] = self._mapFollowups(d.followups);
        if (!rec.reportUrl && d.feishu_doc_url) {
          patch['historyRecords[' + i + '].reportUrl'] = d.feishu_doc_url;
          patch['historyRecords[' + i + '].feishuState'] = 'ready';
          patch['historyRecords[' + i + '].feishuLabel'] = feishuLabel(d.feishu_doc_url, 'ready');
        }
      });
      if (Object.keys(patch).length) self.setData(patch);
      self.setData({ historyShown: countShown(self.data.historyRecords) });
    });
  },

  loadMoreHistory: function () {
    if (this.data.historyLoading || this.data.historyLoadingMore) return;
    if (this.data.historyShown >= this.data.historyTotal) return;
    this.loadHistory(true);
  },

  toggleRecord: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var rec = this.data.historyRecords[idx];
    if (!rec) return;
    var p = {};
    p['historyRecords[' + idx + '].expanded'] = !rec.expanded;
    this.setData(p);
  },

  /**
   * 飞书文档：列表/详情已带 feishu_doc_url 就直接复制；
   * 没有则 POST /credits/questions/{id}/feishu_doc 生成后复制。
   * 小程序不能直接唤起外部浏览器，所以走「复制链接 + 提示」。
   */
  onFeishu: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var rec = this.data.historyRecords[idx];
    if (!rec) return;
    if (rec.reportUrl) {
      this._copyLink(rec.reportUrl);
      return;
    }
    var self = this;
    wx.showLoading({ title: '生成中…', mask: true });
    api.request('/credits/questions/' + rec.id + '/feishu_doc', { method: 'POST', timeout: 120000 })
      .then(function (r) {
        wx.hideLoading();
        if (r && r.code === 0 && r.data && r.data.url) {
          var p = {};
          p['historyRecords[' + idx + '].reportUrl'] = r.data.url;
          p['historyRecords[' + idx + '].feishuState'] = 'ready';
          p['historyRecords[' + idx + '].feishuLabel'] = feishuLabel(r.data.url, 'ready');
          self.setData(p);
          self._copyLink(r.data.url);
          return;
        }
        var msg = (r && (r.detail || r.msg)) || '生成失败';
        if (/未配置|FEISHU_APP_ID|503/.test(msg)) {
          var off = {};
          off['historyRecords[' + idx + '].feishuState'] = 'off';
          off['historyRecords[' + idx + '].feishuLabel'] = feishuLabel('', 'off');
          self.setData(off);
          wx.showToast({ title: '咨询报告未配置', icon: 'none' });
          return;
        }
        wx.showToast({ title: msg, icon: 'none' });
      })
      .catch(function (err) {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' });
      });
  },

  _copyLink: function (url) {
    wx.setClipboardData({
      data: url,
      success: function () { wx.showToast({ title: '链接已复制，到浏览器打开', icon: 'none' }); }
    });
  },

  /**
   * 继续追问（照参考页 continueFollowupFromRecord）：
   * 关闭咨询记录 → 面板恢复该记录（问题/时间/追问/技能标签）→
   * 用 analysis_result 重绑技能与盘面 → 再发送时 target_id = 根 id（cost=0）
   */
  onContinue: function (e) {
    var rec = this.data.historyRecords[e.currentTarget.dataset.idx];
    if (!rec || !rec.qid) return;
    var rootId = rec.qid;            // question_records 根 id
    this.rootQuestionId = rootId;
    this.questionId = null;          // 下一轮 consume 会返回本条追问的 id
    this.chatMsgId = null;
    this.threadTypes = [];
    this.autoMetas = [];
    this.setData({
      showHistory: false,
      inputOpen: false,
      topOpen: true,                 // 面板保持展开，先展示恢复后的置顶内容
      input: '',
      sentVisible: false,
      sentContent: '',
      sentFeishuUrl: '',
      lastQuestion: rec.question || this.data.lastQuestion,
      pinned: this._pinnedFromRecord(rec)
    });
    this._restoreThread(rootId);
    wx.showToast({ title: '已衔接该记录，可直接提问', icon: 'none' });
  },

  /** 列表项兜底（详情接口没回来前先展示问题与时间） */
  _pinnedFromRecord: function (rec) {
    return {
      id: rec.qid || rec.id,
      timeText: fmtFullTime(rec.createdAt),
      question: rec.question || '',
      feishuUrl: rec.reportUrl || '',
      followups: (rec.followups || []).map(function (f) {
        return { id: f.id, text: f.text || f.question || '' };
      })
    };
  },

  _pinnedFromDetail: function (d) {
    return {
      id: d.id,
      timeText: fmtFullTime(d.created_at),
      question: d.question || '',
      feishuUrl: d.feishu_doc_url || '',
      followups: (d.followups || []).map(function (f) {
        return { id: f.id, text: f.question || '' };
      })
    };
  },

  /**
   * 拉详情 → 恢复置顶内容 + 技能标签；
   * 技能走 paipanUtil.restoreThread（analysis_result → pan_info → 本地重算盘面）。
   */
  _restoreThread: function (rootId) {
    var self = this;
    if (!api.getToken()) return;
    this._restorePromise = api.request('/credits/questions/' + rootId).then(function (res) {
      var d = res && res.code === 0 ? res.data : null;
      if (!d) return;
      var types = [];
      var aids = {};
      function collect(it) {
        (it.usages || []).forEach(function (u) {
          var t = u && u.tool;
          if (!t) return;
          if (types.indexOf(t) < 0) types.push(t);
          if (u.analysis_id && !aids[t]) aids[t] = u.analysis_id;
        });
      }
      collect(d);
      (d.followups || []).forEach(collect);

      self.threadTypes = types;
      self.setData({
        pinned: self._pinnedFromDetail(d),
        sentFeishuUrl: d.feishu_doc_url || ''
      });
      // 先按类型挂标签（详情字段已够），盘面数据回来后再补 detail
      self.syncChips();

      var restoreTask = paipanUtil.restoreThread(types, aids, d.created_at).then(function (restored) {
        var g = app().globalData;
        if (g) g.paipan = restored || {};
        self.syncChips();
        self._restorePromise = null;
      });
      return restoreTask;
    }).catch(function (err) {
      console.warn('[chat] 追问上下文加载失败', err);
      self._restorePromise = null;
    });
  },

  /** 置顶区「查看咨询报告」：参考页为可点击链接，小程序复制链接 */
  onPinnedFeishu: function () {
    var p = this.data.pinned;
    if (p && p.feishuUrl) this._copyLink(p.feishuUrl);
  },

  onSentFeishu: function () {
    if (this.data.sentFeishuUrl) this._copyLink(this.data.sentFeishuUrl);
  },

  /** 回复落地后刷新置顶上下文（参考页 _xbRefreshConsultPanelAfterReply） */
  _refreshPanel: function (rootId) {
    var self = this;
    if (!rootId || !api.getToken()) {
      this.setData({ sentVisible: false });
      return;
    }
    api.request('/credits/questions/' + rootId).then(function (res) {
      var d = res && res.code === 0 ? res.data : null;
      if (!d) {
        self.setData({ sentVisible: false });
        return;
      }
      self.threadTypes = null;       // 回到「以已绑定技能为准」
      self.setData({
        pinned: self._pinnedFromDetail(d),
        sentVisible: false,
        sentContent: '',
        sentFeishuUrl: ''
      });
      self.syncChips();
    }).catch(function () {
      self.setData({ sentVisible: false });
    });
  },

  /** 删除记录：DELETE /credits/questions/{id}（后端连同追问、评论一起删） */
  onDeleteRecord: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var rec = this.data.historyRecords[idx];
    if (!rec) return;
    // 参考页为浅色自绘确认框，这里先开弹框，真正删除在 confirmDelete
    this.setData({ delOpen: true, delIdx: idx });
  },

  cancelDelete: function () {
    this.setData({ delOpen: false, delIdx: -1 });
  },

  confirmDelete: function () {
    var idx = this.data.delIdx;
    var rec = this.data.historyRecords[idx];
    this.setData({ delOpen: false });
    if (!rec) return;
    var self = this;
    api.request('/credits/questions/' + rec.id, { method: 'DELETE' })
      .then(function (res) {
        if (!res || res.code !== 0) {
          wx.showToast({ title: (res && (res.detail || res.msg)) || '删除失败', icon: 'none' });
          return;
        }
        var list = self.data.historyRecords.slice();
        list.splice(idx, 1);
        // 删的正好是当前追问锚点 → 解除绑定，避免后续追问写到已删除的记录上
        if (String(rec.id) === String(self.rootQuestionId)) {
          self.rootQuestionId = null;
          self.questionId = null;
          self.chatMsgId = null;
        }
        self.setData({
          historyRecords: list,
          historyTotal: Math.max(0, self.data.historyTotal - 1),
          historyShown: countShown(list),
          // 本地兜底列表同步剔除，避免接口失败回退时又冒出来
          sessionRecords: (self.data.sessionRecords || []).filter(function (s) {
            return String(s.qid) !== String(rec.id);
          })
        });
      })
      .catch(function (err) {
        wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
      });
  },

  patchMsgField: function (id, field, value) {
    var list = this.data.messages;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) continue;
      var p = {};
      p['messages[' + i + '].' + field] = value;
      this.setData(p);
      this.buildHistory();
      return;
    }
  },

  /* ---------------- 个人中心菜单（参考页 #profileModal） ---------------- */
  openProfile: function () {
    if (this.data.recording) {
      wx.showToast({ title: '录音中，结束后再打开', icon: 'none' });
      return;
    }
    this.setData({ showProfile: true, inputOpen: false });
    this.loadBalance();
  },

  closeProfile: function () { this.setData({ showProfile: false }); },

  onProfileHistory: function () {
    this.setData({ showProfile: false });
    this.openHistory();
    // 只有真的打开了咨询记录才记住「来自个人中心」
    this.historyFromProfile = this.data.showHistory;
  },

  /** 我的积分：沿用现有余额接口 + 现有提示，不做参考页的独立积分页 */
  onProfileCredits: function () {
    this.setData({ showProfile: false });
    this.onBalanceTap();
  },

  /** 我的档案：网页版为独立档案管理，小程序无对应页面 */
  onArchives: function () {
    wx.showToast({ title: '档案功能暂未接入', icon: 'none' });
  },

  setAvatar: function (idx) {
    var n = AVATARS.length;
    var i = ((idx % n) + n) % n;
    this.setData({
      avatarIdx: i,
      avatarSrc: env.getApiOrigin() + AVATARS[i].file,
      avatarErr: false
    });
  },

  prevAvatar: function () { this.setAvatar(this.data.avatarIdx - 1); },

  nextAvatar: function () { this.setAvatar(this.data.avatarIdx + 1); },

  onAvatarErr: function () {
    this.setData({ avatarErr: true });
  },

  onRestart: function () {
    var self = this;
    wx.showModal({
      title: '重新开始提问',
      content: '会清空当前对话与已绑定的排盘，确认继续？',
      confirmText: '重新开始',
      confirmColor: '#9370db',
      success: function (r) {
        if (!r.confirm) return;
        self.rootQuestionId = null;
        self.questionId = null;
        self.chatMsgId = null;
        self.autoMetas = [];
        self.threadTypes = [];
        self._restorePromise = null;
        var g = app().globalData;
        if (g) g.paipan = {};
        self.setData({
          messages: [],
          historyRecords: [],
          sessionRecords: [],
          historyTotal: 0,
          historyPage: 0,
          historyError: '',
          historyLoading: false,
          historyLoadingMore: false,
          lastQuestion: '',
          pinned: null,
          sentVisible: false,
          sentContent: '',
          sentFeishuUrl: '',
          ttsText: '',
          typing: false,
          scrollTo: '',
          showHistory: false,
          topOpen: true,
          chips: [],
          skillActive: { qimen: false, bazi: false, meihua: false }
        });
        tts.stop(true);
        self._ttsText = '';
      }
    });
  },

  /* ---------------- 消息与滚动 ---------------- */
  pushMsg: function (role, text, extra) {
    var id = ++MSG_SEQ;
    var ex = extra || {};
    var item = {
      id: id,
      role: role,
      text: text || '',
      html: '',
      plain: text || '',
      timeText: nowStr(),
      done: role === 'assistant',
      // 参考页咨询记录条目默认折叠；新到的回复直接展开，避免刚推演完看不到答案
      expanded: role === 'assistant',
      // 咨询记录聚合用元信息（buildHistory 依赖）
      qid: ex.qid || '',
      types: ex.types || [],
      auto: !!ex.auto,
      msgId: ex.msgId || '',
      plainOnly: !!ex.plainOnly
    };
    if (role === 'assistant' && text && !ex.plainOnly) {
      item.html = md.chatHtml(text);
      item.plain = md.plain(text);
    }
    var list = this.data.messages.concat([item]);
    var patch = { messages: list, scrollTo: 'anchor-bottom' };
    if (role === 'user') {
      patch.lastQuestion = text;
    } else if (role === 'assistant' && !ex.plainOnly) {
      // 回复到达：自动弹出对话记录（对应网页版的答案浮层）
      // 录音中不打断输入面板，避免把正在回填的文字藏起来
      if (!this.data.recording) {
        patch.showHistory = true;
        patch.inputOpen = false;
      }
    }
    this.setData(patch);
    this.buildHistory();
    // 记录页已自动打开时，以服务端列表为准刷新一次
    if (patch.showHistory && this.data.loggedIn) this.loadHistory(false);
    return id;
  },

  updateScroll: function () {
    this.setData({ scrollTo: 'anchor-bottom' });
  },

  /* ---------------- 输入 ---------------- */
  onInput: function (e) {
    this.setData({ input: e.detail.value });
  },

  onExample: function (e) {
    this.setData({ input: e.currentTarget.dataset.text || '', inputOpen: true });
  },

  onSendTap: function () {
    if (this.data.sending) return;
    if (this.data.recording) {
      wx.showToast({ title: '请先结束录音再发送', icon: 'none' });
      return;
    }
    var text = String(this.data.input || '').trim();
    if (!text) {
      wx.showToast({ title: '先说点什么吧', icon: 'none' });
      return;
    }
    if (!this.data.loggedIn) {
      this.pendingText = text;
      this.setData({ showLogin: true });
      return;
    }
    this.setData({ input: '', inputOpen: false });
    this.startFlow(text);
  },

  /* ---------------- 排盘 bundle ---------------- */
  buildBundle: function () {
    var bound = (app().globalData && app().globalData.paipan) || {};
    var paipanData = {};
    var metas = [];
    var types = [];
    ['qimen', 'bazi', 'meihua'].forEach(function (t) {
      if (bound[t] && bound[t].payload) {
        paipanData[t] = bound[t].payload;
        metas.push(bound[t].meta);
        types.push(t);
      }
    });

    // 未绑定任何技能：与网页版 FB-40 一致，按当前时空自动起「奇门 + 梅花」双盘
    if (!types.length) {
      var now = new Date();
      var q = paipanUtil.autoQimen(now);
      var m = paipanUtil.autoMeihua(now);
      paipanData.qimen = q.payload;
      paipanData.meihua = m.payload;
      q.meta.auto = true;
      q.meta.label = '奇门遁甲·自动';
      m.meta.auto = true;
      m.meta.label = '梅花易数·自动';
      metas = [q.meta, m.meta];
      types = ['qimen', 'meihua'];
      this.autoMetas = metas;
    } else {
      this.autoMetas = [];
    }
    return { paipanData: paipanData, metas: metas, types: types };
  },

  /**
   * 顶部面板技能标签：参考页 .bound-tag 只渲染「图标 + 原始信息」。
   * 线程恢复时按 threadTypes 展示（即使该技能因 analysis_result 失败没能重算盘面）。
   */
  _chipOf: function (type, entry) {
    var meta = TOOL_CHIPS[type] || { icon: '📐', cls: '' };
    return {
      type: type,
      icon: meta.icon,
      cls: meta.cls || 'qm',
      detail: chipDetail(type, entry || {})
    };
  },

  syncChips: function () {
    var bound = (app().globalData && app().globalData.paipan) || {};
    var chips = [];
    var active = { qimen: false, bazi: false, meihua: false };
    var order = (this.threadTypes && this.threadTypes.length)
      ? this.threadTypes
      : ['qimen', 'bazi', 'meihua', 'stock'];
    for (var i = 0; i < order.length; i++) {
      var t = order[i];
      if (t === 'stock') {
        if (bound.stock) chips.push(this._chipOf('stock', bound.stock));
        continue;
      }
      if (bound[t] && bound[t].meta) {
        chips.push(this._chipOf(t, bound[t]));
        active[t] = true;
      }
    }
    if (!chips.length && this.autoMetas && this.autoMetas.length) {
      chips = this.autoMetas.map(this._chipOfAuto, this);
    }
    this.setData({ chips: chips, skillActive: active });
  },

  _chipOfAuto: function (meta) {
    return this._chipOf(meta.type, { meta: meta });
  },

  onChipTap: function (e) {
    var type = e.currentTarget.dataset.type;
    wx.navigateTo({ url: '/uniApp/pages/' + type + '/' + type });
  },

  onChipClose: function (e) {
    var type = e.currentTarget.dataset.type;
    var bound = (app().globalData && app().globalData.paipan) || {};
    if (bound[type]) {
      delete bound[type];
      app().globalData.paipan = bound;
    }
    if (this.threadTypes) {
      this.threadTypes = this.threadTypes.filter(function (t) { return t !== type; });
    }
    if (this.autoMetas && this.autoMetas.length) this.autoMetas = [];
    this.syncChips();
  },

  openPaipan: function (e) {
    var type = e.currentTarget.dataset.type;
    wx.navigateTo({ url: '/uniApp/pages/' + type + '/' + type });
  },

  /* ---------------- 语音播报控制（tts-line 音量图标） ---------------- */
  // 单击：正在播 → 暂停这一条；已暂停/空闲 → 从头恢复上一条；已关闭 → 重新开启
  onTtsIcon: function () {
    if (this.data.speaking) {
      tts.stop();
      this.setData({ speaking: false });
      wx.showToast({ title: '已暂停播报', icon: 'none' });
      return;
    }
    if (!this.data.ttsOn) {
      this.setData({ ttsOn: true });
      if (app().globalData) app().globalData.ttsOn = true;
      wx.showToast({ title: '已开启自动播报', icon: 'none' });
      return;
    }
    var text = this._ttsText || this.lastReplyText();
    if (!text) {
      wx.showToast({ title: '暂无可播报的内容', icon: 'none' });
      return;
    }
    tts.speak(text);
  },

  // 长按：彻底关闭自动播报（本轮及后续新回复都不再自动播）
  onTtsOff: function () {
    if (!this.data.ttsOn) return;
    tts.stop();
    if (app().globalData) app().globalData.ttsOn = false;
    this.setData({ ttsOn: false, speaking: false });
    wx.showToast({ title: '已关闭自动播报', icon: 'none' });
  },

  // 最近一条真正回复的纯文本（恢复播报用）
  lastReplyText: function () {
    var list = this.data.messages || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.role === 'assistant' && m.html && (m.plain || m.text)) return m.plain || m.text;
    }
    return '';
  },

  /* ---------------- 主流程 ---------------- */
  startFlow: async function (text) {
    this.setData({ sending: true });

    // 追问衔接的盘面还原还没完成时先等它，保证本轮用该记录当时的盘
    if (this._restorePromise) {
      try { await this._restorePromise; } catch (e) { /* 忽略，按当前绑定继续 */ }
      this._restorePromise = null;
    }

    // 先确定本轮用哪几套盘（已关联优先，否则按此刻自动起盘）
    var bundle = this.buildBundle();
    this.syncChips();

    // 首次提问需要用户确认扣费；追问不再扣费
    if (!this.rootQuestionId) {
      var ok = await this.confirmCost(text, bundle);
      if (!ok) {
        this.setData({ sending: false });
        return;
      }
    }

    // 参考页 #sentPreview：确认扣费后先把本轮问题置顶展示，回复落地后换成置顶上下文
    this.setData({ sentVisible: true, sentContent: text, sentFeishuUrl: '' });

    // 用户消息带上本轮技能 types，咨询记录卡片用它渲染技能信息
    var userMsgId = this.pushMsg('user', text, {
      types: bundle.types,
      auto: !!(this.autoMetas && this.autoMetas.length)
    });
    this.setData({ typing: true, typingText: '正在起盘…' });
    this.updateScroll();

    try {
      // 1) 让后端把盘面组装成提示词文本（网页版同款接口）
      this.setData({ typingText: '正在组装盘面…' });
      var promptRes = { texts: {}, hint: '' };
      try {
        promptRes = await paipanUtil.fetchPromptText(bundle.paipanData);
      } catch (e) {
        console.warn('[chat] preview_prompt_hint 失败，继续走 /chat：', e);
      }

      // 2) 扣积分（幂等 client_id）
      this.setData({ typingText: '正在推演…' });
      var clientId = 'wx' + Date.now() + Math.floor(Math.random() * 1000);
      var consume = await api.request('/credits/consume', {
        method: 'POST',
        data: {
          scene: 'ask',
          usage: { ask: text, client_id: clientId, tool: bundle.types[0] || 'qimen' },
          paipan_count: Math.min(4, bundle.types.length),
          paipan_types: bundle.types,
          target_id: this.rootQuestionId || null
        }
      });

      if (consume && consume.code === 402) {
        this.setData({ typing: false, sending: false });
        this.pushMsg('assistant', '积分不足（当前剩余 ' + (consume.balance || 0) + '），请先在网页版充值后再来推演。');
        this.updateScroll();
        return;
      }
      if (!consume || consume.code !== 0 || !consume.data) {
        throw new Error((consume && (consume.msg || consume.detail)) || '积分结算失败');
      }
      var cdata = consume.data;
      // 网页版语义：root_id 是本条根问题（追问链的锚点），question_id 是本轮记录（/chat 回写答案用）
      this.rootQuestionId = cdata.root_id || cdata.question_id || this.rootQuestionId;
      this.questionId = cdata.question_id || this.rootQuestionId;
      // 回填到用户消息，供本次会话的本地聚合兜底使用
      if (this.rootQuestionId) this.patchMsgField(userMsgId, 'qid', this.rootQuestionId);
      if (typeof cdata.balance === 'number') this.setData({ balance: cdata.balance });

      if (cdata.cost > 0) {
        this.pushMsg('assistant', '已消耗 ' + cdata.cost + ' 积分（剩余 ' + cdata.balance + '），正在为你用「'
          + bundle.types.map(function (t) { return ({ qimen: '奇门遁甲', bazi: '四柱八字', meihua: '梅花易数' })[t] || t; }).join('、')
          + '」推演「' + text + '」…', { plainOnly: true });
      }
      this.updateScroll();

      // 3) 请求模型回复
      var reqBody = {
        message: text,
        system_prompt: SYSTEM_PROMPT,
        source: 'xiaoxuan',
        paipan_data: bundle.paipanData,
        paipan_prompt_text: promptRes.texts,
        target_id: this.chatMsgId || null,
        question_id: this.questionId || this.rootQuestionId || null
      };
      var res = await api.request('/chat', { method: 'POST', data: reqBody, timeout: 180000 });
      if (!res || typeof res.reply !== 'string') {
        throw new Error((res && (res.detail || res.msg)) || '模型未返回内容');
      }
      if (res.msg_id) this.chatMsgId = res.msg_id;

      this.setData({ typing: false });
      var id = this.pushMsg('assistant', res.reply, { msgId: res.msg_id || '' });
      this.updateScroll();

      // 4) 自动播报（默认开启；长按音量图标关闭后不再自动播）
      if (this.data.ttsOn) {
        var item = this.findMsg(id);
        var plain = (item && item.plain) || md.plain(res.reply);
        this._ttsText = plain;
        this.setData({ ttsText: plain });
        tts.speak(plain);
      }
      // 5) 回复落地：把 #sentPreview 换成置顶上下文（参考页 _xbRefreshConsultPanelAfterReply）
      this._refreshPanel(this.rootQuestionId);
    } catch (e) {
      console.error('[chat] 流程失败', e);
      this.setData({ typing: false, sentVisible: false });
      var msg = (e && e.message) || '请求失败';
      if (/登录已过期/.test(msg)) {
        this.setData({ loggedIn: false, userName: '', showLogin: true });
      }
      this.pushMsg('assistant', '出错了：' + msg + '。可以稍后再试一次。');
      this.updateScroll();
    } finally {
      this.setData({ sending: false, typing: false });
    }
  },

  /**
   * 积分消耗确认（参考页自绘卡片，替代原来的 wx.showModal）
   * 文案沿用参考页：已关联技能 + 固定 5 积分 + 两条说明
   */
  confirmCost: function (text, bundle) {
    var self = this;
    var typeNames = bundle.types.map(function (t) {
      return ({ qimen: '奇门遁甲', bazi: '四柱八字', meihua: '梅花易数' })[t] || t;
    }).join('、');
    return new Promise(function (resolve) {
      self._costResolve = resolve;
      self.setData({
        costOpen: true,
        costCredits: paipanUtil.DEEP_READING_COST,
        costTypesText: typeNames
      });
    });
  },

  cancelCost: function () {
    var fn = this._costResolve;
    this._costResolve = null;
    this.setData({ costOpen: false });
    if (fn) fn(false);
  },

  confirmCostYes: function () {
    var fn = this._costResolve;
    this._costResolve = null;
    this.setData({ costOpen: false });
    if (fn) fn(true);
  },

  findMsg: function (id) {
    var list = this.data.messages;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  },

  /* ---------------- 消息操作 ---------------- */
  /** 播报/复制取文：记录卡用 idx/fidx（服务端记录），消息用 id（本地消息） */
  _cardText: function (ds) {
    if (ds && ds.idx !== undefined && ds.idx !== null) {
      var rec = this.data.historyRecords[ds.idx];
      if (!rec) return '';
      if (ds.fidx !== undefined && ds.fidx !== null) {
        var fu = (rec.followups || [])[ds.fidx];
        return fu ? (fu.reply || '') : '';
      }
      return rec.reply || '';
    }
    var item = this.findMsg(ds && ds.id);
    return item ? (item.plain || item.text || '') : '';
  },

  onSpeak: function (e) {
    var text = this._cardText(e.currentTarget.dataset);
    if (!text) return;
    if (this.data.speaking) {
      tts.stop();
      this.setData({ speaking: false });
      return;
    }
    this._ttsText = text;
    tts.speak(text);
  },

  onCopy: function (e) {
    var text = this._cardText(e.currentTarget.dataset);
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: function () { wx.showToast({ title: '已复制', icon: 'none' }); }
    });
  },

  /* ---------------- 语音输入 ---------------- */
  onMicTap: function () {
    if (this.data.recording) this.stopRecord();
    else this.startRecord();
  },

  startRecord: async function () {
    if (this._stopping) return;
    var self = this;
    // 插件不可用时明确提示一次，避免误以为实时识别失效
    if (!this._asrNoted) {
      this._asrNoted = true;
      // 排查用：Console 直接显示走插件还是兜底、插件版本、降级原因
      console.log('[asr] mode =', asr.mode(), '| version =', asr.version(),
        '| reason =', asr.reason() || 'none');
      if (asr.mode() !== 'plugin') {
        wx.showToast({ title: '未启用实时识别，已回退整段识别', icon: 'none' });
      }
    }
    try {
      // onPartial：同声传译插件的实时累计文本，边录边写进输入框
      await asr.start(function (text) {
        self.setData({ input: text });
      });
      // 录音开始即展开输入面板（向上浮层），让用户边录边看到回填区域
      this.setData({ recording: true, recSeconds: 0, inputOpen: true, topOpen: false });
      if (this.recTimer) clearInterval(this.recTimer);
      this.recTimer = setInterval(function () {
        var s = self.data.recSeconds + 1;
        self.setData({ recSeconds: s });
        if (s >= 60) self.stopRecord();
      }, 1000);
    } catch (e) {
      console.error('[rec] 启动失败', e);
      var msg = String((e && e.message) || e || '');
      if (/auth|authorize|permission|授权|权限|deny|denied/i.test(msg)) {
        wx.showModal({
          title: '需要麦克风权限',
          content: '请在右上角「···」→ 设置里打开麦克风权限后重试',
          showCancel: false
        });
      } else {
        wx.showToast({ title: '录音启动失败', icon: 'none' });
      }
      this.setData({ recording: false });
    }
  },

  stopRecord: async function () {
    if (this._stopping) return;
    this._stopping = true;
    if (this.recTimer) { clearInterval(this.recTimer); this.recTimer = null; }
    // 结束（含回填失败）都保持面板展开，避免把已回填/待回填的文字藏起来
    this.setData({ recording: false, inputOpen: true });

    try {
      var r = null;
      try {
        // 插件模式：text 是最终结果；兜底模式：只有 filePath
        r = await asr.stop();
      } catch (e) {
        r = null;
      }
      var text = (r && r.text) || '';
      var filePath = (r && r.filePath) || '';

      if (!text && filePath) {
        // 有音频但没有文本（插件异常 / 兜底链路）：走原来的整段识别补救
        wx.showLoading({ title: '识别中…', mask: true });
        try {
          var res = await asr.recognize(filePath);
          wx.hideLoading();
          text = (res && res.text) || '';
        } catch (e) {
          wx.hideLoading();
          wx.showModal({
            title: '语音识别失败',
            content: (e && e.message) || '请稍后重试，或改用文字输入',
            showCancel: false
          });
          return;
        }
      }

      if (!text) {
        var errMsg = (r && r.error) || asr.lastError() || '';
        if (errMsg) {
          wx.showModal({ title: '语音识别失败', content: errMsg, showCancel: false });
        } else {
          wx.showToast({ title: '没听清，再说一次？', icon: 'none' });
        }
        return;
      }

      // 最终结果整体覆盖中间结果，避免重复拼接
      this.setData({ input: text, inputOpen: true });
      wx.showToast({ title: '已填入，确认后发送', icon: 'none' });
    } finally {
      this._stopping = false;
    }
  },

  /* ---------------- 登录 ---------------- */
  onAccountTap: function () {
    var u = api.readUser();
    if (u) {
      // 已登录：账号按钮进「个人中心」，未登录才进登录弹层（与参考页一致）
      this.setData({ loggedIn: true, userName: u.name, userId: String(u.uid || '') });
      this.openProfile();
      return;
    }
    this.setData({
      showLogin: true,
      inputOpen: false,
      authMode: 'login',
      authError: '',
      loggedIn: false,
      userName: '',
      apiOrigin: env.getApiOrigin()
    });
  },

  closeLogin: function () {
    this.setData({ showLogin: false, authError: '', loginPwd: '', loginPwd2: '' });
  },

  /** 登录 / 注册 tab 切换（参考页 switchAuthTab） */
  switchAuthTab: function (e) {
    var tab = e.currentTarget.dataset.tab;
    if (tab !== 'login' && tab !== 'register') return;
    this.setData({ authMode: tab, authError: '' });
  },

  onLoginUser: function (e) { this.setData({ loginUser: e.detail.value, authError: '' }); },
  onLoginPwd: function (e) { this.setData({ loginPwd: e.detail.value, authError: '' }); },
  onLoginPwd2: function (e) { this.setData({ loginPwd2: e.detail.value, authError: '' }); },
  onLoginName: function (e) { this.setData({ loginName: e.detail.value }); },
  onApiOrigin: function (e) { this.setData({ apiOrigin: e.detail.value }); },

  saveApiOrigin: function () {
    env.setApiOrigin(String(this.data.apiOrigin || '').trim());
    this.setData({ apiOrigin: env.getApiOrigin() });
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  afterLogin: function (data) {
    this.setData({
      loggedIn: true,
      userName: data.display_name || data.username || '',
      userId: data.user_id != null ? String(data.user_id) : '',
      showLogin: false,
      showProfile: false,
      loginPwd: '',
      loginPwd2: '',
      loginName: '',
      authError: '',
      balance: typeof data.credits === 'number' ? data.credits : this.data.balance
    });
    if (app().globalData) app().globalData.user = data;
    this.loadBalance();
    var pending = this.pendingText;
    this.pendingText = '';
    if (pending) {
      this.setData({ input: '', inputOpen: false });
      this.startFlow(pending);
      return;
    }
    if (this.pendingHistory) {
      this.pendingHistory = false;
      this.openHistory();
    }
  },

  doLogin: async function () {
    var u = String(this.data.loginUser || '').trim();
    var p = String(this.data.loginPwd || '');
    if (!u || !p) { this.setData({ authError: '请填写用户名和密码' }); return; }
    this.setData({ authError: '' });
    wx.showLoading({ title: '登录中…', mask: true });
    try {
      var data = await api.login(u, p);
      wx.hideLoading();
      this.afterLogin(data);
    } catch (e) {
      wx.hideLoading();
      this.setData({ authError: (e && e.message) || '登录失败' });
    }
  },

  doRegister: async function () {
    var u = String(this.data.loginUser || '').trim();
    var p = String(this.data.loginPwd || '');
    var p2 = String(this.data.loginPwd2 || '');
    var nick = String(this.data.loginName || '').trim();
    if (!u || !p) { this.setData({ authError: '请填写用户名和密码' }); return; }
    if (p.length < 6) { this.setData({ authError: '密码至少 6 位' }); return; }
    if (p2 !== p) { this.setData({ authError: '两次输入的密码不一致' }); return; }
    this.setData({ authError: '' });
    wx.showLoading({ title: '注册中…', mask: true });
    try {
      var data = await api.register(u, p, nick || u);
      wx.hideLoading();
      this.afterLogin(data);
    } catch (e) {
      wx.hideLoading();
      this.setData({ authError: (e && e.message) || '注册失败' });
    }
  },

  logout: function () {
    api.clearUser();
    tts.stop(true);
    this.rootQuestionId = null;
    this.questionId = null;
    this.chatMsgId = null;
    this.setData({
      loggedIn: false,
      userName: '',
      userId: '',
      balance: null,
      showLogin: false,
      showProfile: false,
      // 记录属于账号，退出后清空，避免下个账号看到上一个账号的缓存
      historyRecords: [],
      sessionRecords: [],
      historyTotal: 0,
      historyPage: 0,
      historyError: ''
    });
    wx.showToast({ title: '已退出', icon: 'none' });
  },

  loadBalance: function () {
    var self = this;
    if (!api.getToken()) { this.setData({ balance: null }); return; }
    api.getBalance().then(function (d) {
      // /credits/balance 返回 { credits, used_today, ... }
      if (d && typeof d.credits === 'number') self.setData({ balance: d.credits });
    }).catch(function () { /* 忽略 */ });
  },

  onBalanceTap: function () {
    var self = this;
    if (!this.data.loggedIn) { this.setData({ showLogin: true }); return; }
    this.loadBalance();
    wx.showModal({
      title: '积分余额',
      content: '当前剩余 ' + (this.data.balance === null ? '—' : this.data.balance)
        + ' 积分\n每次深度推演消耗 5 积分，追问不额外消耗。\n充值请前往网页版「万机」完成。',
      confirmText: '刷新',
      success: function (r) { if (r.confirm) self.loadBalance(); }
    });
  },

  onShareAppMessage: function () {
    return { title: '玄机 · 时空决策助手', path: '/uniApp/pages/chat/chat' };
  }
});
