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
var avatarMouth = require('../../utils/avatar-mouth.js');
var QUOTES = require('../../data/quotes.js');   // DF-64：等待期/空闲期金句池（自动生成）
// DF-67：证券条件池（仅当当前线程关联了证券信息卡片时并入轮播）；缺失/为空/解析失败自动降级为主力池
var QUOTES_STOCK = [];
try { QUOTES_STOCK = require('../../data/quotes-stock.js') || []; } catch (e) { QUOTES_STOCK = []; }
if (!Array.isArray(QUOTES_STOCK)) QUOTES_STOCK = [];

// 与 assistant-widget.js 的 XIAOXUAN_DEFAULT_SYSTEM 保持一致
var SYSTEM_PROMPT = '你是万机决策助手，九天玄女化身的智能助手。你同时擅长：健康咨询、学业辅导、工作助理、情感顾问、战略决策。'
  + '回复温柔聪慧，中文，简洁友好。'
  + '若用户是在分析页面，你可以调用奇门遁甲/八字/梅花易数排盘来辅助判断。';

// FB-48：积分确认框点「取消」后走免费引导对话（不扣积分、不落问事记录）
var GUIDANCE_PROMPT = '本轮为免费引导，未扣除积分、未做深度命理推演。'
  + '请用温柔简洁的中文说明这一点，并针对用户的问题指出哪些信息还不够具体，'
  + '给出 2-3 条可执行建议；若用户缺少出生信息，提示其前往「个人中心 → 我的档案」补充生日；'
  + '若问题与证券相关，提示其先去证券页添加关注标的；不要承诺任何命理结论。';

var MSG_SEQ = 0;

// FB-47：判空/过短阈值（按 trim 后字符数）；集中定义，便于统一调整
var SHORT_TEXT_MIN = 1;
var SHORT_TEXT_MAX = 3;

// DF-63：等待期思考提示语三组词库（照抄 xiaoxuan.html _THINK_VERBS/_THINK_OBJS/_THINK_TAILS，各 6 条，组合 216）
var THINK_VERBS = ['正在推演', '正在思考', '正在分析', '正在琢磨', '正在揣摩', '正在洞察'];
var THINK_OBJS = ['你的问题', '其中的趋势', '这件事的走向', '潜在的变量', '背后的格局', '关键的节点'];
var THINK_TAILS = ['，请稍候', '，请稍待片刻', '，很快就好', '，稍等一下', '，正在为你准备', '，请耐心等待'];
var HINT_GAP_MS = 300;                       // 提示语句间间隔（对齐网站 2431-2448）
var HINT_SAFETY_MS = 5 * 60 * 1000;          // 等待期安全上限 5 分钟（对齐网站 _awaitingReplySafety）
var HINT_TEXT_ONLY_MS = 2000;                // ttsOn=false 时按字数兜底的基础时长
var IDLE_HINT_MS = 6000;                     // DF-64：空闲期纯文字轮播节奏（6 秒/句）

// 与 assistant-widget.js 的 XB_AVATAR_CONFIGS 保持一致（网页版 4 个智能体头像）
var AVATARS = [
  { file: '/avatar/xiaoxuan_1.png', name: '神机子' },
  { file: '/avatar/xiaoxuan_21.png', name: '天机子' },
  { file: '/avatar/xiaoxuan_3.png', name: '灵机子' },
  { file: '/avatar/xiaoxuan_4.jpg', name: '时机子' }
];

// 档案关系字典（与 qimen-1/static/yishu.js RELATION_MAP 及后端 archives._RELATIONSHIPS 一致）
// key 上送后端，中文用于 picker 展示；数组顺序即 picker 顺序
var RELATION_KEYS = ['self', 'spouse', 'child', 'parent', 'sibling', 'grandparent', 'grandchild',
  'friend', 'colleague', 'classmate', 'teacher', 'student', 'other'];
var RELATION_LABELS = {
  self: '自己', spouse: '配偶', child: '子女', parent: '父母', sibling: '兄弟姐妹',
  grandparent: '祖辈', grandchild: '孙辈', friend: '朋友', colleague: '同事',
  classmate: '同学', teacher: '老师', student: '学生', other: '其他'
};
var RELATION_LABELS_ARR = RELATION_KEYS.map(function (k) { return RELATION_LABELS[k]; });
var ARCH_GENDER_OPTIONS = ['请选择性别', '男', '女'];
var ARCH_DEFAULT_RELATION_IDX = RELATION_KEYS.indexOf('other');

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
    inputCursor: -1,       // DF-58：输入框光标位置
    canClear: false,       // DF-58：输入框是否有可清空内容
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
    profileName: '',          // DF-62：昵称（nickname > display_name > username）
    profileAvatar: '',        // DF-62：头像 URL（空则显示占位符）
    nicknameEditing: false,   // DF-62：昵称就地编辑态
    nicknameDraft: '',        // DF-62：昵称编辑草稿
    /* ---- 我的档案（DF-56：内嵌全屏层，列表 + 新增/编辑，不新增页面 / 不改 app.json） ---- */
    showArchives: false,
    showArchiveEditor: false,
    archives: [],
    archivesLoading: false,
    archSaving: false,
    archEditing: null,            // 正在编辑的档案对象；null = 新增
    archGenderIndex: 0,           // 0 = 未选择，1 = 男，2 = 女
    archRelationIndex: ARCH_DEFAULT_RELATION_IDX,
    genderOptions: ARCH_GENDER_OPTIONS,
    relationLabels: RELATION_LABELS_ARR,
    archForm: { nickname: '', gender: '', relationship: 'other', birth_year: '', birth_month: '', birth_day: '', birth_hour: '', birth_minute: '' },
    /* ---- 我的积分（DF-57：内嵌全屏层，混合流水，不新增页面 / 不改 app.json） ---- */
    showCredits: false,
    ledgerItems: [],
    ledgerLoading: false,
    ledgerLoadingMore: false,
    ledgerError: '',
    ledgerTotal: 0,
    ledgerPage: 0,
    ledgerPageSize: 20,
    creditsBalance: null,
    creditsTodayUsed: 0,
    /* ---- 积分消耗确认（对应参考页自绘对话框） ---- */
    costOpen: false,
    costCredits: paipanUtil.DEEP_READING_COST,
    costTypesText: '',
    /* ---- 删除确认（参考页浅色自绘确认框） ---- */
    delOpen: false,
    delIdx: -1,
    delKind: 'record',           // record | root | followup
    delId: '',
    delText: '',
    /* ---- 界面状态（对齐 xiaoxuan.html 布局） ---- */
    statusBarH: 0,
    topOpen: true,
    inputOpen: false,
    showHistory: false,
    /* FB-51：咨询记录未读回复数（数字角标，来自 storage 「unread_replies:<uid>」） */
    historyUnread: 0,
    /* ---- 深度解读全屏层（FB-44 技能标签 / DF-54 主问题与追问，共用同一层） ---- */
    showSkillAnalysis: false,
    skillAnalysisState: '',      // loading | ready | error | none
    skillAnalysisMsg: '',
    skillAnalysisHtml: '',
    skillAnalysisTitle: '深度解读',
    activeAnalysisSource: '',    // analysis（analysis_result）| answer（问题记录里的 answer）
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
    hintQuote: null,       // DF-64：等待期当前金句 { text, author, translation }；思考语时为 null
    idleQuote: null,       // DF-64：空闲期顶部轮播金句 { text, author, translation }
    inputFocus: false,     // DF-64：输入框是否聚焦（空闲轮播暂停条件之一）
    ttsText: '',           // #ttsLines 字幕内容
    ttsLabel: '万机决策助手',
    examples: EXAMPLES,
    avatarIdx: 0,
    avatarSrc: '',
    avatarErr: false,
    usingUserAvatar: false, // DF-62：主页是否在用用户上传的头像（true 时隐藏角色切换/口型）
    /* ---- 头像口型（DF-55：播报时嘴部缩放动画，定位照抄 XB_AVATAR_CONFIGS） ---- */
    mouthRect: null,       // {left,top,width,height} 百分比；null 则不渲染口型层
    mouthSx: 1,            // 口型横向缩放
    mouthSy: 1             // 口型纵向缩放
  },

  /* ---------------- 生命周期 ---------------- */
  onLoad: function (options) {
    this._pendingNewArchive = !!(options && options.openNewArchive);
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
      profileName: u ? u.name : '',
      apiOrigin: env.getApiOrigin(),
      ttsOn: !(g0 && g0.ttsOn === false),
      statusBarH: statusBarH,
      avatarSrc: env.getApiOrigin() + AVATARS[0].file
    });
    this._applyMouthRect(AVATARS[0].file);
    this.rootQuestionId = null; // question_records 根记录 id（追问免费）
    this.questionId = null;     // 本轮 question_records.id（consume 返回，/chat 回写答案用）
    this.chatMsgId = null;      // 上一条回复的 chat_messages.id（作为追问的 target_id）
    this.autoMetas = [];        // 本轮兜底自动起的盘
    this._ttsText = '';         // 最近一条被播报的文本（暂停后恢复用）
    // DF-63/DF-64：等待期提示语轮播状态（单一实例，全页唯一）
    this._hintActive = false;
    this._hintEpoch = 0;
    this._hintTimer = null;
    this._hintSafety = null;
    this._hintResolve = null;
    this._hintSeq = 0;
    this._quotePool = [];
    this._stockPool = (QUOTES_STOCK || []).slice(); // DF-67：证券池源（静态，缺失时为空数组）
    this._stockHintPool = [];    // DF-67：等待期可用的证券池副本（每轮重置）
    this._stockLinked = false;   // DF-67：当前线程是否关联证券（触发条件，任一条记录 usages 含 stock）
    this._hintOwner = null;      // 'waiting' | 'idle' | null（互斥）
    this._idleTimer = null;
    this._idleIdx = 0;

    var self = this;
    tts.setStateCallback(function (state) {
      var speaking = state === 'playing';
      self.setData({ speaking: speaking });
      if (speaking) { self._startMouth(); } else { self._stopMouth(); }
      // DF-63：一句等待提示语播完 → 释放挂起的 promise，推进下一句
      if (state === 'end' && self._hintResolve) {
        var r = self._hintResolve; self._hintResolve = null; r();
      }
    });

    // DF-62：主页头像优先用本地缓存的用户头像（避免先闪角色图）
    this._syncUserAvatar();

    if (!md.available) {
      this.pushMsg('assistant', '提示：Markdown 渲染库加载失败，回复将以纯文本展示。请确认工程根 markdown.js 未被小程序打包忽略。');
    }
    this.loadBalance();
  },

  onShow: function () {
    this._appHidden = false;
    var u = api.readUser();
    this.setData({ loggedIn: !!u, userName: u ? u.name : '', userId: u ? String(u.uid || '') : '' });
    // FB-51：冷启动 / 切账号后按 uid 恢复未读角标（杀进程保留）
    this._syncUnread();
    this.syncChips();
    // DF-62：回显本地缓存的用户头像，并异步用 /auth/profile 回填（登录/冷启动）
    this._syncUserAvatar();
    this._loadProfile();
    // DF-61：奇门页「去创建」返回时，直接打开「新增档案」编辑器
    var g = app().globalData;
    var wantNewArchive = this._pendingNewArchive || (g && g._openNewArchive);
    this._pendingNewArchive = false;
    if (g) g._openNewArchive = false;
    if (wantNewArchive) this._openNewArchiveFlow();
    // DF-64：回到前台若无覆盖层、在等待/空闲切换时按条件恢复空闲期文字轮播
    this._maybeStartIdleHint();
  },

  /** DF-63/DF-64：小程序无 onHide 需求时离开前台需暂停空闲轮播 */
  onHide: function () {
    this._appHidden = true;
    this._stopIdleHint();
  },

  /** DF-61：打开档案层并直接进入新增编辑器（未登录先弹登录，沿用 pendingAction） */
  _openNewArchiveFlow: function () {
    if (!api.getToken()) { this.pendingAction = 'archives'; this.setData({ showLogin: true }); return; }
    this.onArchives();
    this.onNewArchive();
  },

  onUnload: function () {
    this._stopThinking();
    this._stopIdleHint();
    tts.stop(true);
    if (this.recTimer) clearInterval(this.recTimer);
    if (this._mouthTimer) { clearInterval(this._mouthTimer); this._mouthTimer = null; }
  },

  noop: function () {},

  /* ================= DF-62：个人中心昵称 / 头像 ================= */

  /** 主页头像与用户头像同步：有用户头像则用它并隐藏口型/角色切换，否则保持角色图 */
  _syncUserAvatar: function () {
    var u = api.readUser();
    var av = (u && u.avatar_url) || '';
    if (av) {
      if (this.data.avatarSrc !== av) this._stopMouth();
      this.setData({ usingUserAvatar: true, avatarSrc: av, avatarErr: false, mouthRect: null });
    } else if (this.data.usingUserAvatar) {
      this.setData({ usingUserAvatar: false });
      this.setAvatar(this.data.avatarIdx || 0);
    }
  },

  /** GET /auth/profile 回填昵称（nickname>display_name>username）/头像并写本地缓存 */
  _loadProfile: function () {
    var self = this;
    if (!api.getToken()) return;
    api.request('/auth/profile').then(function (res) {
      var d = (res && (res.data || res.profile)) || res || {};
      if (d && d.profile) d = d.profile;
      var nickname = d.nickname || d.display_name || d.username || '';
      var av = d.avatar_url || '';
      var patch = {};
      if (nickname) patch.profileName = nickname;
      if (av) { patch.profileAvatar = av; api.setAvatarUrl(av); }
      if (Object.keys(patch).length) self.setData(patch);
      if (av) self._syncUserAvatar();
    }).catch(function () { /* 静默：资料刷新失败不阻塞页面 */ });
  },

  /** 选择头像回调（button open-type=chooseAvatar） */
  onChooseAvatar: function (e) {
    var path = e && e.detail && e.detail.avatarUrl;
    if (!path) return;
    var self = this;
    this._checkAvatarSize(path).then(function (ok) { if (ok) self._uploadAvatar(path); });
  },

  /** 上传前先本地判大小（>2MB 直接提示，避免白传） */
  _checkAvatarSize: function (path) {
    return new Promise(function (resolve) {
      try {
        wx.getFileSystemManager().getFileInfo({
          filePath: path,
          success: function (r) {
            if (r && r.size > 2 * 1024 * 1024) {
              wx.showToast({ title: '图片需小于 2MB', icon: 'none' });
              resolve(false);
            } else { resolve(true); }
          },
          fail: function () { resolve(true); }
        });
      } catch (err) { resolve(true); }
    });
  },

  /** 上传头像 → PUT /auth/profile 保存绝对 URL → 刷新个人中心与主页头像 */
  _uploadAvatar: function (path) {
    var self = this;
    var token = api.getToken();
    if (!token) { this.pendingAction = 'profile'; this.setData({ showLogin: true }); return; }
    wx.showLoading({ title: '上传中…', mask: true });
    wx.uploadFile({
      url: env.getApiBase() + '/upload/avatar',
      filePath: path,
      name: 'file',
      header: { Authorization: 'Bearer ' + token },
      timeout: 60000,
      success: function (res) {
        var body = res.data;
        try { body = JSON.parse(body); } catch (err) { /* 保持原文 */ }
        if (res.statusCode === 401) {
          wx.hideLoading();
          api.clearUser();
          self.setData({ loggedIn: false, userName: '', showProfile: false, showLogin: true });
          wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
          return;
        }
        var rel = body && (body.url || (body.data && body.data.url));
        if (res.statusCode === 200 && rel) {
          var abs = /^https?:\/\//i.test(rel) ? rel : env.getApiOrigin() + rel;
          self._saveAvatarUrl(abs);
          return;
        }
        wx.hideLoading();
        var st = res.statusCode;
        var detail = body && (body.detail || body.msg);
        var tip = detail
          || (st === 413 ? '图片超过 2MB，请换一张更小的'
            : st === 501 ? '服务端头像目录不可写，请稍后重试'
              : st === 400 ? '图片格式不支持，请选择 JPG/PNG'
                : ('上传失败（' + st + '），请重试'));
        wx.showToast({ title: tip, icon: 'none' });
      },
      fail: function () {
        wx.hideLoading();
        wx.showToast({ title: '上传失败，请检查网络后重试', icon: 'none' });
      }
    });
  },

  /** PUT /auth/profile 保存头像 URL，成功后立即回显 + 写缓存（失败保持旧头像） */
  _saveAvatarUrl: function (abs) {
    var self = this;
    api.request('/auth/profile', { method: 'PUT', data: { avatar_url: abs } }).then(function (res) {
      wx.hideLoading();
      if (res && res.code !== undefined && res.code !== 0) {
        wx.showToast({ title: (res.detail || res.msg) || '保存失败，请重试', icon: 'none' });
        return;
      }
      api.setAvatarUrl(abs);
      self.setData({ profileAvatar: abs });
      self._syncUserAvatar();
      wx.showToast({ title: '头像已更新', icon: 'success' });
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' });
    });
  },

  /** 昵称就地编辑 */
  onEditNickname: function () {
    this._nicknameDraft = this.data.profileName || '';
    this.setData({ nicknameEditing: true, nicknameDraft: this.data.profileName || '' });
  },
  onNicknameInput: function (e) { this._nicknameDraft = e.detail.value; },
  onCancelNickname: function () { this.setData({ nicknameEditing: false, nicknameDraft: '' }); },
  onSaveNickname: function () {
    var self = this;
    var val = String((this._nicknameDraft != null ? this._nicknameDraft : this.data.nicknameDraft) || '').trim();
    if (!val) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return; }
    if (val.length > 64) { wx.showToast({ title: '昵称不能超过 64 个字', icon: 'none' }); return; }
    api.request('/auth/profile', { method: 'PUT', data: { nickname: val } }).then(function (res) {
      if (res && res.code !== undefined && res.code !== 0) {
        wx.showToast({ title: (res.detail || res.msg) || '保存失败，请重试', icon: 'none' });
        return;
      }
      api.setCachedName(val);
      self.setData({ profileName: val, nicknameEditing: false, nicknameDraft: '', userName: val });
      wx.showToast({ title: '昵称已更新', icon: 'success' });
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' });
    });
  },

  /** 主页头像点击：用户头像生效时打开个人中心，否则保持原有录音行为 */
  onAvatarTap: function () {
    if (this.data.usingUserAvatar) { this.openProfile(); return; }
    this.onMicTap();
  },

  /* ================= DF-63：等待期提示语轮播 + 统一停止 ================= */

  _genThinkingMsg: function () {
    var v = THINK_VERBS[Math.floor(Math.random() * THINK_VERBS.length)];
    var o = THINK_OBJS[Math.floor(Math.random() * THINK_OBJS.length)];
    var t = THINK_TAILS[Math.floor(Math.random() * THINK_TAILS.length)];
    return v + o + t;
  },

  /** 启动等待期提示语轮播：先停旧链，epoch+1，5 分钟安全上限 */
  _startThinking: function () {
    var self = this;
    this._stopThinking();
    this._stopIdleHint();
    this._hintOwner = 'waiting';
    var epoch = ++this._hintEpoch;
    this._hintActive = true;
    this._hintSeq = 0;
    this._quotePool = (QUOTES || []).slice();
    this._stockHintPool = this._stockLinked ? (this._stockPool || []).slice() : []; // DF-67：关联证券才并入
    if (this._hintSafety) clearTimeout(this._hintSafety);
    this._hintSafety = setTimeout(function () { self._stopThinking(); }, HINT_SAFETY_MS);
    var loop = function () {
      if (!self._hintActive || epoch !== self._hintEpoch) return;
      var hint = self._nextHint();
      self.setData({
        typingText: hint.text,
        hintQuote: hint.isQuote ? { text: hint.text, author: hint.author, translation: hint.translation } : null
      });
      var speech = self.data.ttsOn ? (hint.speech || hint.text) : '';
      self._hintSpeak(speech).then(function () {
        if (!self._hintActive || epoch !== self._hintEpoch) return;
        self._hintTimer = setTimeout(loop, HINT_GAP_MS);
      });
    };
    loop();
  },

  /** 停止等待期轮播：清 timer / 释放挂起 promise / epoch+1，防止旧回调继续推进 */
  _stopThinking: function () {
    this._hintActive = false;
    this._hintEpoch = (this._hintEpoch || 0) + 1;
    if (this._hintTimer) { clearTimeout(this._hintTimer); this._hintTimer = null; }
    if (this._hintSafety) { clearTimeout(this._hintSafety); this._hintSafety = null; }
    if (this._hintResolve) { var r = this._hintResolve; this._hintResolve = null; r(); }
    if (this._hintOwner === 'waiting') this._hintOwner = null;
  },

  /** 播报一句提示：有文本走 TTS（等 'end' 后推进），无文本按 2000ms/句兜底 */
  _hintSpeak: function (text) {
    var self = this;
    return new Promise(function (resolve) {
      if (!text) { setTimeout(resolve, HINT_TEXT_ONLY_MS); return; }
      self._hintResolve = resolve;
      tts.speak(text);
    });
  },

  /* ================= DF-64：金句轮播 / 空闲期文字轮播 ================= */

  /** 取下一句等待期提示语：首句 50% 金句，其后 2 思考语 : 1 金句；金句不重复、用尽只走思考语 */
  _nextHint: function () {
    var n = this._hintSeq++;
    var wantQuote = n === 0 ? (Math.random() < 0.5) : (n % 3 === 0);
    if (wantQuote) {
      var q = this._pickHintQuote();
      if (q) return { isQuote: true, text: q.text, author: q.author, translation: q.translation, speech: q.speech || q.text };
    }
    return { isQuote: false, text: this._genThinkingMsg() };
  },

  /**
   * DF-67：从提示金句池取一句。主力池与证券池按 2:1 随机加权（证券约 1/3）并入同一序列；
   * 证券池仅在当前线程关联证券（_stockLinked）且非空时参与；各自不重复，取尽后回退另一池。
   */
  _pickHintQuote: function () {
    var main = this._quotePool || [];
    var stock = this._stockLinked ? (this._stockHintPool || []) : [];
    if (!main.length && !stock.length) return null;
    var wantStock = stock.length && (!main.length || Math.random() < 1 / 3);
    var pool = wantStock ? stock : main;
    if (!pool.length) pool = wantStock ? main : stock;
    if (!pool.length) return null;
    return pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  },

  /** DF-64：空闲期顶部金句轮播（纯文字，6 秒/句，顺序遍历；DF-67：每 2 条主力插 1 条证券） */
  _startIdleHint: function () {
    if (!(QUOTES || []).length) return;
    if (this._hintOwner === 'idle' && this._idleTimer) return;
    this._hintOwner = 'idle';
    this._idleIdx = 0;
    this._showIdleHint();
  },
  _showIdleHint: function () {
    var self = this;
    var main = QUOTES || [];
    var stock = this._stockLinked ? (this._stockPool || []) : [];
    var q;
    var idx = this._idleIdx++;
    if (main.length) {
      if (stock.length && idx % 3 === 2) {
        // DF-67：证券句并入同一序列，每 2 条主力插 1 条（约 1/3）
        q = stock[Math.floor(idx / 3) % stock.length];
      } else {
        q = main[(idx - Math.floor(idx / 3)) % main.length];
      }
    } else if (stock.length) {
      q = stock[idx % stock.length];
    } else {
      return;
    }
    this.setData({ idleQuote: { text: q.text, author: q.author, translation: q.translation } });
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(function () { self._showIdleHint(); }, IDLE_HINT_MS);
  },
  _stopIdleHint: function () {
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    if (this._hintOwner === 'idle') this._hintOwner = null;
  },

  /**
   * DF-67：同步「当前线程是否关联证券信息卡片」——任一 question_record 的 usages[].tool === 'stock'。
   * 判定统一为记录级信号（不按关键词、不按是否打开过证券页）；本轮等待期无法预判，最早在回复落地后生效。
   * 后端若新增独立卡片字段（如 stock_card），改这里即可切换判定源。
   */
  _syncStockLinked: function (detail) {
    var linked = false;
    if (detail) {
      var outs = [detail].concat(detail.followups || []);
      outs.forEach(function (it) {
        if (linked || !it) return;
        (it.usages || []).forEach(function (u) {
          if (u && u.tool === 'stock') linked = true;
        });
      });
    }
    this._stockLinked = linked;
  },

  /** 空闲轮播启动条件（对齐 DF-64）：未录音/未等待/无置顶/无已发送/无覆盖层/面板展开/输入为空且未聚焦/在前台 */
  _maybeStartIdleHint: function () {
    var d = this.data;
    if (this._appHidden) return;
    if (this._hintOwner === 'waiting' || d.typing || d.recording) return;
    if (d.pinned || d.sentVisible) return;
    if (d.showLogin || d.showProfile || d.showHistory || d.showArchives || d.showArchiveEditor || d.showCredits || d.showSkillAnalysis) return;
    if (!d.topOpen) return;
    if (d.inputFocus || (d.input || '').trim().length) return;
    this._startIdleHint();
  },

  onInputFocus: function () { this.setData({ inputFocus: true }); this._stopIdleHint(); },
  onInputBlur: function () { this.setData({ inputFocus: false }); this._maybeStartIdleHint(); },


  /* ---------------- 界面交互（面板 / 头像 / 记录） ---------------- */
  toggleTop: function () {
    var open = !this.data.topOpen;
    this.setData({ topOpen: open });
    if (open) { this._maybeStartIdleHint(); }
    else { this._stopIdleHint(); }
  },

  toggleInput: function () {
    // 录音期间禁止收起：收起会把正在回填的文字藏起来，先结束录音
    if (this.data.recording && this.data.inputOpen) {
      wx.showToast({ title: '录音中，结束后再收起', icon: 'none' });
      return;
    }
    var open = !this.data.inputOpen;
    this.setData({
      inputOpen: open,
      topOpen: open ? false : true,
      canClear: open ? (this.data.input || '').trim().length > 0 : this.data.canClear
    });
  },

  openHistory: function () {
    this.historyFromProfile = false;
    if (this.data.recording) {
      wx.showToast({ title: '录音中，结束后再查看', icon: 'none' });
      return;
    }
    // 参考页：未登录点「咨询记录」先弹登录，登录成功后自动打开
    if (!this.data.loggedIn) {
      this.pendingAction = 'history';
      this.setData({ showLogin: true });
      return;
    }
    // 先用本次会话的本地聚合占位，随后以服务端列表为准
    this.buildHistory();
    this.setData({ showHistory: true, inputOpen: false, scrollTo: '' });
    // FB-51：进入咨询记录页即整体清零未读角标
    this._clearUnread();
    this._stopIdleHint();
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
    if (!(backToProfile && this.data.loggedIn)) this._maybeStartIdleHint();
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
            sourceText: '万机决策助手',
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
    var aids = {};
    (it.usages || []).forEach(function (u) {
      var t = u && u.tool;
      if (!t) return;
      if (tools.indexOf(t) < 0) tools.push(t);
      // FB-44：保留 usages[].analysis_id，点标签时用它取深度解读正文
      if (u.analysis_id && !aids[t]) aids[t] = u.analysis_id;
    });
    var chips = tools.map(function (t) {
      var meta = TOOL_CHIPS[t] || { icon: '📐', cls: '' };
      return { type: t, icon: meta.icon, cls: meta.cls || 'qm', label: '', analysisId: aids[t] || '' };
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
      sourceText: '万机决策助手',
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

  /** 详情里的 followups[] → .chat-item-followup（id + 问题文本 + 该条 answer） */
  _mapFollowups: function (list) {
    return (list || []).map(function (f) {
      return { id: f.id, text: f.question || '', answer: f.answer || '' };
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
   * 咨询报告：记录卡片入口（DF-51）
   * 不再复制飞书链接，改为小程序内全屏预览 PDF。
   */
  onFeishu: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var rec = this.data.historyRecords[idx];
    if (!rec) return;
    var self = this;
    this._openReport({
      id: rec.qid || rec.id,
      url: rec.reportUrl,
      onDoc: function (docUrl) {
        // 旧接口生成成功：同步卡片「📄 报告 ↗」状态（沿用原有行为）
        var p = {};
        p['historyRecords[' + idx + '].reportUrl'] = docUrl;
        p['historyRecords[' + idx + '].feishuState'] = 'ready';
        p['historyRecords[' + idx + '].feishuLabel'] = feishuLabel(docUrl, 'ready');
        self.setData(p);
      },
      onError: function (body) {
        // 飞书未配置：卡片沿用「📄 报告（未配置）」
        if (Number(body && body.code) === 50300) {
          var off = {};
          off['historyRecords[' + idx + '].feishuState'] = 'off';
          off['historyRecords[' + idx + '].feishuLabel'] = feishuLabel('', 'off');
          self.setData(off);
        }
      }
    });
  },

  /**
   * 咨询报告预览（DF-51，三处入口共用）：
   * POST /credits/questions/{id}/feishu_doc/pdf → wx.downloadFile → wx.openDocument
   * - 40401（无文档）先用旧 POST .../feishu_doc 生成，再重试一次
   * - 下载/预览失败降级复制链接；接口失败按错误码给文案，不静默
   * @param {object} opts { id: 根记录 id, url: 原飞书链接(降级用), onDoc: fn(url), onError: fn(body) }
   */
  _openReport: function (opts) {
    var self = this;
    opts = opts || {};
    var rootId = opts.id || '';
    var fallbackUrl = opts.url || '';
    if (!rootId) {
      // 拿不到根记录 id，退回旧的复制链接能力
      if (fallbackUrl) this._copyLink(fallbackUrl);
      return;
    }
    function degrade(url) {
      wx.hideLoading();
      var u = url || fallbackUrl;
      if (u) self._copyLink(u, '预览失败，已复制链接');
      else wx.showToast({ title: '报告准备失败，请稍后再试', icon: 'none' });
    }
    wx.showLoading({ title: '正在准备报告…', mask: true });
    this._requestPdf(rootId, true, opts.onDoc).then(function (data) {
      wx.downloadFile({
        url: data.url,
        timeout: 60000,
        success: function (res) {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            degrade(data.doc_url);
            return;
          }
          wx.hideLoading();
          wx.openDocument({
            filePath: res.tempFilePath,
            fileType: 'pdf',
            showMenu: true,
            fail: function () { degrade(data.doc_url); }
          });
        },
        fail: function () { degrade(data.doc_url); }
      });
    }).catch(function (err) {
      wx.hideLoading();
      var body = (err && err.body) || null;
      if (opts.onError) opts.onError(body);
      wx.showToast({ title: self._reportErrorText(body), icon: 'none' });
    });
  },

  /** 取 PDF 地址；code=40401 时先生成飞书文档再重试一次（只重试一次） */
  _requestPdf: function (rootId, allowGenerate, onDoc) {
    var self = this;
    return api.request('/credits/questions/' + rootId + '/feishu_doc/pdf', {
      method: 'POST',
      timeout: 90000
    }).then(function (r) {
      if (r && r.code === 0 && r.data && r.data.url) return r.data;
      if (r && Number(r.code) === 40401 && allowGenerate) {
        return self._generateReportDoc(rootId).then(function (docUrl) {
          if (onDoc) onDoc(docUrl);
          return self._requestPdf(rootId, false, onDoc);
        });
      }
      var e = new Error('pdf_failed');
      e.body = r;
      throw e;
    });
  },

  /** 旧接口：POST .../feishu_doc 生成飞书文档，返回文档链接 */
  _generateReportDoc: function (rootId) {
    return api.request('/credits/questions/' + rootId + '/feishu_doc', {
      method: 'POST',
      timeout: 120000
    }).then(function (r) {
      if (r && r.code === 0 && r.data && r.data.url) return r.data.url;
      var e = new Error('gen_failed');
      e.body = r;
      throw e;
    });
  },

  /** 错误码 → 界面文案（不把后端正文透出） */
  _reportErrorText: function (body) {
    var code = Number((body && body.code) || 0);
    if (code === 50300 || code === 40301) return '咨询报告暂不可预览';
    if (code === 42901) return '请求过于频繁，请稍后再试';
    return '报告准备失败，可复制链接查看';
  },

  _copyLink: function (url, title) {
    wx.setClipboardData({
      data: url,
      success: function () { wx.showToast({ title: title || '链接已复制，到浏览器打开', icon: 'none' }); }
    });
  },

  /* ---------------- 咨询记录技能标签：全屏深度解读（FB-44） ----------------
   * 对齐 xiaoxuan.html DF-43：点标签只弹解读正文，不跳技能详情页、不调 consume、不扣费。
   * 取数：GET /chat/analysis_result/{analysis_id} → reply/analysis/result/content。
   * 卡片没有 analysis_id 时先拉一次详情兜底，仍无则提示「该技能未生成深度解读，无法查看。」
   */
  onSkillChipTap: function (e) {
    this._tapSkillChip(e.currentTarget.dataset.idx, e.currentTarget.dataset.type);
  },

  _tapSkillChip: function (idx, type) {
    var self = this;
    var rec = this.data.historyRecords[idx];
    if (!rec || !type) return;
    this._skillRetry = { idx: idx, type: type };
    var chip = (rec.skillChips || []).filter(function (c) { return c.type === type; })[0];
    if (!chip) return;
    if (chip.analysisId) {
      this._openSkillAnalysis(type, chip.analysisId);
      return;
    }
    if (!rec.id) {
      this._showSkillAnalysisEmpty();
      return;
    }
    // 列表接口不带 analysis_id：拉一次详情兜底，成功后缓存回卡片，二次点击直接命中
    var key = 'detail_' + rec.id;
    this._skillInflight = this._skillInflight || {};
    if (this._skillInflight[key]) return;
    this._skillInflight[key] = true;
    wx.showLoading({ title: '加载中…', mask: true });
    api.request('/credits/questions/' + rec.id).then(function (res) {
      var aid = self._pickAnalysisId(res && res.code === 0 ? res.data : null, type);
      if (aid) self._patchChipAnalysisId(idx, type, aid);
      return aid;
    }).then(function (aid) {
      wx.hideLoading();
      delete self._skillInflight[key];
      if (aid) self._openSkillAnalysis(type, aid);
      else self._showSkillAnalysisEmpty();
    }).catch(function (err) {
      wx.hideLoading();
      delete self._skillInflight[key];
      console.warn('[FB-44] 技能解读 id 兜底失败', err);
      self._openSkillAnalysisError();
    });
  },

  /** 详情 usages[].analysis_id → 指定 type 的 id（与 _restoreThread 同口径，含追问） */
  _pickAnalysisId: function (detail, type) {
    if (!detail) return '';
    var found = '';
    function collect(it) {
      (it.usages || []).forEach(function (u) {
        if (!found && u && u.tool === type && u.analysis_id) found = u.analysis_id;
      });
    }
    collect(detail);
    (detail.followups || []).forEach(collect);
    return found;
  },

  _patchChipAnalysisId: function (idx, type, analysisId) {
    var rec = this.data.historyRecords[idx];
    if (!rec) return;
    var chips = (rec.skillChips || []).map(function (c) {
      return c.type === type ? { type: c.type, icon: c.icon, cls: c.cls, label: c.label, analysisId: analysisId } : c;
    });
    var p = {};
    p['historyRecords[' + idx + '].skillChips'] = chips;
    this.setData(p);
  },

  /** 拉正文并渲染；同一 analysisId 请求中不重复发起（in-flight 防抖） */
  _openSkillAnalysis: function (type, analysisId) {
    var self = this;
    if (!analysisId) {
      this._showSkillAnalysisEmpty();
      return;
    }
    var key = 'skill_' + analysisId;
    this._skillInflight = this._skillInflight || {};
    if (this._skillInflight[key]) return;
    this._skillInflight[key] = true;
    this._skillRetry = { idx: (this._skillRetry || {}).idx, type: type, analysisId: analysisId };
    this.setData({
      showSkillAnalysis: true,
      activeAnalysisSource: 'analysis',
      skillAnalysisTitle: '深度解读',
      skillAnalysisState: 'loading',
      skillAnalysisMsg: '正在生成深度解读…',
      skillAnalysisHtml: ''
    });
    this._stopIdleHint();
    api.request('/chat/analysis_result/' + analysisId, { timeout: 60000 }).then(function (j) {
      delete self._skillInflight[key];
      var text = self._analysisText(j);
      if (!text) {
        self.setData({ skillAnalysisState: 'error', skillAnalysisMsg: '暂无深度解读' });
        return;
      }
      self.setData({
        skillAnalysisState: 'ready',
        skillAnalysisHtml: md.chatHtml(text)
      });
    }).catch(function (err) {
      delete self._skillInflight[key];
      console.warn('[FB-44] 深度解读加载失败', err);
      self.setData({ skillAnalysisState: 'error', skillAnalysisMsg: '暂无深度解读' });
    });
  },

  /** analysis_result 兼容字段：reply / analysis / result / content；兼容 code+data 包裹 */
  _analysisText: function (j) {
    if (!j) return '';
    var d = (j.code === 0 && j.data) ? j.data : j;
    var t = d.reply || d.analysis || d.result || d.content || '';
    return String(t || '').trim();
  },

  /** 无 analysis_id：只提示，不空态、不退回详情（对齐参考页 DF-43 口径） */
  _showSkillAnalysisEmpty: function () {
    this.setData({
      showSkillAnalysis: true,
      skillAnalysisState: 'none',
      skillAnalysisMsg: '该技能未生成深度解读，无法查看。',
      skillAnalysisHtml: ''
    });
  },

  _openSkillAnalysisError: function () {
    this.setData({
      showSkillAnalysis: true,
      skillAnalysisState: 'error',
      skillAnalysisMsg: '暂无深度解读',
      skillAnalysisHtml: ''
    });
  },

  onSkillAnalysisRetry: function () {
    if (this.data.activeAnalysisSource === 'answer') {
      this._restorePromise = null;   // 详情可能失败过，重试用一次全新请求
      this._openAnswerOrLoad(this.data.skillAnalysisTitle);
      return;
    }
    var r = this._skillRetry || {};
    if (r.analysisId) {
      this._openSkillAnalysis(r.type, r.analysisId);
      return;
    }
    if (r.type && r.idx !== undefined) this._tapSkillChip(r.idx, r.type);
  },

  closeSkillAnalysis: function () {
    this.setData({
      showSkillAnalysis: false,
      skillAnalysisState: '',
      skillAnalysisMsg: '',
      skillAnalysisHtml: ''
    });
    this._maybeStartIdleHint();
  },

  /* ---------------- DF-54：主问题 / 追问 → 全屏解读（复用 FB-44 的同一层） ---------------- */

  onPinnedQuestionTap: function () {
    if (!this.data.pinned) return;
    this._answerTarget = { kind: 'root' };
    this._openAnswerOrLoad('深度解读');
  },

  onFollowupTap: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var p = this.data.pinned;
    var fu = p && (p.followups || [])[idx];
    if (!fu) return;
    this._answerTarget = { kind: 'followup', idx: idx };
    this._openAnswerOrLoad('追问 · 深度解读');
  },

  /** 详情已回来直接渲染 answer；未回来则先拉详情（复用 _restoreThread），再按目标取正文 */
  _openAnswerOrLoad: function (title) {
    var self = this;
    var p = this.data.pinned;
    if (!p) return;
    if (p.answerLoaded) {
      this._openAnswerModal(this._targetAnswer(), title);
      return;
    }
    if (this._answerLoading) return;
    this._answerLoading = true;
    this.setData({
      showSkillAnalysis: true,
      activeAnalysisSource: 'answer',
      skillAnalysisTitle: title || '深度解读',
      skillAnalysisState: 'loading',
      skillAnalysisMsg: '解读加载中…',
      skillAnalysisHtml: ''
    });
    if (!this._restorePromise && p.id) this._restoreThread(p.id);
    var done = function () {
      self._answerLoading = false;
      if ((self.data.pinned || {}).answerLoaded) {
        self._openAnswerModal(self._targetAnswer(), title);
      } else {
        self.setData({ skillAnalysisState: 'error', skillAnalysisMsg: '暂无深度解读' });
      }
    };
    if (this._restorePromise) this._restorePromise.then(done).catch(done);
    else done();
  },

  _targetAnswer: function () {
    var p = this.data.pinned || {};
    var t = this._answerTarget || {};
    if (t.kind === 'followup') {
      var fu = (p.followups || [])[t.idx];
      return fu ? fu.answer : '';
    }
    return p.questionAnswer || '';
  },

  _openAnswerModal: function (text, title) {
    var t = String(text || '').trim();
    this.setData({
      showSkillAnalysis: true,
      activeAnalysisSource: 'answer',
      skillAnalysisTitle: title || '深度解读',
      skillAnalysisState: t ? 'ready' : 'none',
      skillAnalysisMsg: t ? '' : '这条暂无深度解读',
      skillAnalysisHtml: t ? md.chatHtml(t) : ''
    });
  },

  /* ---------------- DF-54：主问题 / 追问 长按删除（同一行 tap=看解读，longpress=删） ---------------- */

  onPinnedQuestionLongPress: function () {
    var p = this.data.pinned;
    if (!p || !p.id) return;
    var n = (p.followups || []).length;
    wx.vibrateShort({ type: 'medium' });
    this.setData({
      delOpen: true,
      delKind: 'root',
      delId: p.id,
      delIdx: -1,
      delText: n > 0
        ? '删除主问题将同时删除其下 ' + n + ' 条追问，且无法恢复。'
        : '确定删除这条主问题？删除后无法恢复。'
    });
  },

  onFollowupLongPress: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var p = this.data.pinned;
    var fu = p && (p.followups || [])[idx];
    if (!fu) return;
    wx.vibrateShort({ type: 'medium' });
    this.setData({
      delOpen: true,
      delKind: 'followup',
      delId: fu.id,
      delIdx: idx,
      delText: '确定删除这条追问？删除后无法恢复。'
    });
  },

  /** 删主问题：DELETE 根 id（后端级联追问），并清空置顶区与解读层 */
  _deleteRoot: function (id) {
    var self = this;
    if (!id || this._deleting) return;
    this._deleting = true;
    wx.showLoading({ title: '删除中…', mask: true });
    api.request('/credits/questions/' + id, { method: 'DELETE' }).then(function (res) {
      wx.hideLoading();
      self._deleting = false;
      if (!res || res.code !== 0) {
        wx.showToast({ title: (res && (res.detail || res.msg)) || '删除失败', icon: 'none' });
        return;
      }
      if (String(id) === String(self.rootQuestionId)) {
        self.rootQuestionId = null;
        self.questionId = null;
        self.chatMsgId = null;
      }
      self.threadTypes = [];
      self._restorePromise = null;
      var rest = (self.data.historyRecords || []).filter(function (r) {
        return String(r.id) !== String(id) && String(r.qid) !== String(id);
      });
      self.setData({
        pinned: null,
        chips: [],
        sentFeishuUrl: '',
        sentVisible: false,
        sentContent: '',
        showSkillAnalysis: false,
        skillAnalysisState: '',
        skillAnalysisMsg: '',
        skillAnalysisHtml: '',
        // 咨询记录里同一条卡片一并移除，避免本地残留已删记录
        historyRecords: rest,
        historyTotal: Math.max(0, self.data.historyTotal - 1),
        historyShown: countShown(rest),
        sessionRecords: (self.data.sessionRecords || []).filter(function (s) {
          return String(s.qid) !== String(id);
        })
      });
      wx.showToast({ title: '已删除', icon: 'none' });
    }).catch(function (err) {
      wx.hideLoading();
      self._deleting = false;
      console.warn('[DF-54] 删除主问题失败', err);
      wx.showToast({ title: '删除失败，请稍后重试', icon: 'none' });
    });
  },

  /** 删单条追问：DELETE 追问 id，同步置顶区与咨询记录卡片的追问列表 */
  _deleteFollowup: function (id) {
    var self = this;
    if (!id || this._deleting) return;
    this._deleting = true;
    wx.showLoading({ title: '删除中…', mask: true });
    api.request('/credits/questions/' + id, { method: 'DELETE' }).then(function (res) {
      wx.hideLoading();
      self._deleting = false;
      if (!res || res.code !== 0) {
        wx.showToast({ title: (res && (res.detail || res.msg)) || '删除失败', icon: 'none' });
        return;
      }
      var p = self.data.pinned;
      var patch = {
        // 解读层若正展示被删的这条，收起
        showSkillAnalysis: false,
        skillAnalysisState: '',
        skillAnalysisMsg: '',
        skillAnalysisHtml: ''
      };
      if (p) {
        patch.pinned = {
          id: p.id,
          timeText: p.timeText,
          question: p.question,
          questionAnswer: p.questionAnswer,
          answerLoaded: p.answerLoaded,
          feishuUrl: p.feishuUrl,
          followups: (p.followups || []).filter(function (f) { return String(f.id) !== String(id); })
        };
      }
      patch.historyRecords = (self.data.historyRecords || []).map(function (r) {
        if (!r.followups || !r.followups.length) return r;
        var next = r.followups.filter(function (f) { return String(f.id) !== String(id); });
        if (next.length === r.followups.length) return r;
        var out = {};
        for (var k in r) { if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k]; }
        out.followups = next;
        out.followupCount = Math.max(0, (r.followupCount || r.followups.length) - 1);
        return out;
      });
      self.setData(patch);
      wx.showToast({ title: '已删除', icon: 'none' });
    }).catch(function (err) {
      wx.hideLoading();
      self._deleting = false;
      console.warn('[DF-54] 删除追问失败', err);
      wx.showToast({ title: '删除失败，请稍后重试', icon: 'none' });
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

  /** 列表项兜底（详情接口没回来前先展示问题与时间；answer 需等详情） */
  _pinnedFromRecord: function (rec) {
    return {
      id: rec.qid || rec.id,
      timeText: fmtFullTime(rec.createdAt),
      question: rec.question || '',
      questionAnswer: '',
      answerLoaded: false,
      feishuUrl: rec.reportUrl || '',
      followups: (rec.followups || []).map(function (f) {
        return { id: f.id, text: f.text || f.question || '', answer: '' };
      })
    };
  },

  _pinnedFromDetail: function (d) {
    return {
      id: d.id,
      timeText: fmtFullTime(d.created_at),
      question: d.question || '',
      questionAnswer: d.answer || '',
      answerLoaded: true,
      feishuUrl: d.feishu_doc_url || '',
      followups: (d.followups || []).map(function (f) {
        return { id: f.id, text: f.question || '', answer: f.answer || '' };
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
      self._syncStockLinked(d);      // DF-67：恢复该记录时按其实际 usages 判定证券条件池
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

  /** 置顶区「查看咨询报告」：小程序内预览 PDF（DF-51） */
  onPinnedFeishu: function () {
    var p = this.data.pinned;
    if (!p || !p.feishuUrl) return;
    this._openReport({ id: p.id, url: p.feishuUrl });
  },

  /** 发送后徽标「📄 查看咨询报告 ↗」：小程序内预览 PDF（DF-51） */
  onSentFeishu: function () {
    var url = this.data.sentFeishuUrl;
    if (!url) return;
    var rootId = this.rootQuestionId || (this.data.pinned && this.data.pinned.id) || '';
    this._openReport({ id: rootId, url: url });
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
      self._syncStockLinked(d);      // DF-67：回复落地后同步证券条件池触发标记
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
    this.setData({
      delOpen: true,
      delIdx: idx,
      delKind: 'record',
      delId: rec.id,
      delText: '确定要删除这条咨询记录（含其下所有追问）吗？删除后无法恢复。'
    });
  },

  cancelDelete: function () {
    this.setData({ delOpen: false, delIdx: -1, delKind: 'record', delId: '', delText: '' });
  },

  confirmDelete: function () {
    var kind = this.data.delKind || 'record';
    var idx = this.data.delIdx;
    var delId = this.data.delId;
    this.setData({ delOpen: false, delKind: 'record', delId: '' });
    if (kind === 'root') {
      this._deleteRoot(delId);
      return;
    }
    if (kind === 'followup') {
      this._deleteFollowup(delId);
      return;
    }
    var rec = this.data.historyRecords[idx];
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
    var cu = api.readUser();
    this.setData({
      showProfile: true,
      inputOpen: false,
      nicknameEditing: false,
      profileName: this.data.profileName || this.data.userName || '',
      profileAvatar: (cu && cu.avatar_url) || this.data.profileAvatar || ''
    });
    this._stopIdleHint();
    this.loadBalance();
    this._loadProfile();
  },

  closeProfile: function () {
    this.setData({ showProfile: false, nicknameEditing: false });
    this._maybeStartIdleHint();
  },

  onProfileHistory: function () {
    this.setData({ showProfile: false });
    this.openHistory();
    // 只有真的打开了咨询记录才记住「来自个人中心」
    this.historyFromProfile = this.data.showHistory;
  },

  /** 我的积分：打开混合流水全屏层（DF-57，内嵌层，不新增页面 / 不改 app.json） */
  onProfileCredits: function () {
    if (!api.getToken()) { this.pendingAction = 'credits'; this.setData({ showLogin: true }); return; }
    this.setData({ showCredits: true });
    this._stopIdleHint();
    this.loadCreditsBalance();
    this.loadLedger(false);
  },
  closeCredits: function () { this.setData({ showCredits: false }); this._maybeStartIdleHint(); },

  /** 拉取余额与今日已消耗（沿用 /credits/balance，口径与网页一致） */
  loadCreditsBalance: function () {
    var self = this;
    api.getBalance().then(function (d) {
      if (d && typeof d.credits === 'number') {
        self.setData({ creditsBalance: d.credits, creditsTodayUsed: d.today_used || 0 });
      }
    }).catch(function () { /* 忽略：余额刷新失败不阻塞流水列表 */ });
  },

  /** 拉取积分混合流水；append=false 首屏/下拉刷新，true 触底追加 */
  loadLedger: function (append) {
    var self = this;
    if (this._ledgerLoading) return;
    if (!api.getToken()) {
      this.setData({ ledgerLoading: false, ledgerError: '请先登录后查看积分记录' });
      return;
    }
    var page = append ? (this.data.ledgerPage + 1) : 1;
    this._ledgerLoading = true;
    var patch = { ledgerLoading: !append, ledgerLoadingMore: !!append, ledgerError: '' };
    if (!append) { patch.ledgerItems = []; }
    this.setData(patch);

    api.request('/credits/ledger?page=' + page + '&size=' + this.data.ledgerPageSize)
      .then(function (res) {
        if (!res || res.code !== 0 || !res.data) {
          throw new Error((res && (res.detail || res.msg)) || '加载失败');
        }
        var items = (res.data.items || []).map(function (it) { return self._toLedgerItem(it); });
        var merged = append ? (self.data.ledgerItems || []).concat(items) : items;
        // usage 与 transaction 两套 id 各自从 1 起，跨表可能重复 → 按 kind+id 去重，避免触底加载重复/跳条
        var seen = {};
        merged = merged.filter(function (r) {
          var k = r.kind + '-' + r.id;
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });
        self._ledgerLoading = false;
        self.setData({
          ledgerItems: merged,
          ledgerTotal: res.data.total || merged.length,
          ledgerPage: page,
          ledgerLoading: false,
          ledgerLoadingMore: false,
          ledgerError: ''
        });
      })
      .catch(function (err) {
        self._ledgerLoading = false;
        var msg = (err && err.message) || '加载失败';
        if (/登录已过期/.test(msg)) {
          self.setData({ loggedIn: false, showCredits: false, showLogin: true });
          return;
        }
        if (append) {
          // 追加失败：保留已加载内容，底部给「加载失败，点击重试」
          self.setData({ ledgerLoadingMore: false, ledgerError: msg });
          return;
        }
        // 首屏失败：空态区 ❌ 错误 + 「点击重试」
        self.setData({ ledgerItems: [], ledgerLoading: false, ledgerError: msg });
      });
  },

  /** 后端流水项 → 展示项：补展示文案/颜色/可跳标记 */
  _toLedgerItem: function (it) {
    var isConsume = it.kind === 'consume';
    var q = it.root_question || it.ask || '';
    return {
      key: it.kind + '-' + it.id,
      kind: it.kind,
      amount: it.amount || 0,
      sign: isConsume ? '-' : '+',
      amountCls: isConsume ? 'amt-consume' : 'amt-increase',
      reasonText: it.reason_text || (isConsume ? '积分消耗' : '积分增加'),
      question: isConsume ? (q || '排盘推演') : '',
      tool: it.tool || '',
      timeText: fmtFullTime(it.created_at),
      clickable: isConsume && !!it.root_question_id,
      rootQuestionId: it.root_question_id || null
    };
  },

  onLedgerScrollToLower: function () {
    var d = this.data;
    if (d.ledgerLoading || d.ledgerLoadingMore || d.ledgerError) return;
    if (d.ledgerItems.length >= (d.ledgerTotal || 0)) return;
    this.loadLedger(true);
  },
  onLedgerRefresh: function () {
    this.loadCreditsBalance();
    this.loadLedger(false);
  },
  retryLedger: function () { this.loadLedger(this.data.ledgerItems.length > 0); },

  /** 消耗项点击 → 关闭积分层与个人中心 → 恢复主问题上下文 → 回到主页可直接追问（追问同样计 1 分） */
  onLedgerItemTap: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var item = this.data.ledgerItems[idx];
    if (!item || !item.clickable) {
      wx.showToast({ title: '该记录暂不支持跳转追问', icon: 'none' });
      return;
    }
    var rootId = item.rootQuestionId;
    this.rootQuestionId = rootId;
    this.questionId = null;
    this.chatMsgId = null;
    this.threadTypes = [];
    this.autoMetas = [];
    this.setData({
      showCredits: false,
      showProfile: false,
      inputOpen: false,
      topOpen: true,
      input: '',
      sentVisible: false,
      sentContent: '',
      sentFeishuUrl: '',
      lastQuestion: item.question || this.data.lastQuestion,
      pinned: {
        id: rootId, timeText: item.timeText, question: item.question || '',
        questionAnswer: '', answerLoaded: false, feishuUrl: '', followups: []
      }
    });
    this._restoreThread(rootId);
    wx.showToast({ title: '已衔接该问题，可直接追问', icon: 'none' });
  },

  onCreditsRecharge: function () {
    wx.showModal({
      title: '充值',
      content: '小程序暂未开通支付，请前往网页版「万机」完成充值。',
      showCancel: false
    });
  },

  /** 我的档案：打开列表并拉取（内嵌全屏层，不新增页面 / 不改 app.json） */
  onArchives: function () {
    if (!api.getToken()) { this.pendingAction = 'archives'; this.setData({ showLogin: true }); return; }
    this.setData({ showArchives: true });
    this._stopIdleHint();
    this.loadArchives();
  },
  closeArchives: function () { this.setData({ showArchives: false }); this._maybeStartIdleHint(); },
  closeArchiveEditor: function () { this.setData({ showArchiveEditor: false }); },

  /** 拉取档案列表，附加展示用的关系中文与出生文案 */
  loadArchives: function () {
    var self = this;
    this.setData({ archivesLoading: true });
    api.request('/archives').then(function (res) {
      var list = (res && res.code === 0 && res.data) ? res.data : [];
      var mapped = list.map(function (a) {
        return {
          id: a.id, name: a.name, nickname: a.nickname, gender: a.gender,
          relationship: a.relationship, is_self: !!a.is_self,
          relationLabel: RELATION_LABELS[a.relationship] || '其他',
          birthText: self._archBirthText(a),
          birth_year: a.birth_year,
          birth_month: a.birth_month,
          birth_day: a.birth_day,
          birth_hour: a.birth_hour,
          birth_minute: a.birth_minute
        };
      });
      self.setData({ archives: mapped });
    }).catch(function (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }).then(function () {
      self.setData({ archivesLoading: false });
    });
  },

  _archBirthText: function (a) {
    var parts = [];
    if (a.birth_year) parts.push(String(a.birth_year));
    if (a.birth_month) parts.push((a.birth_month < 10 ? '0' : '') + a.birth_month);
    if (a.birth_day) parts.push((a.birth_day < 10 ? '0' : '') + a.birth_day);
    var d = parts.length ? parts.join('-') : '';
    var t = '';
    if (a.birth_hour != null && a.birth_minute != null) {
      t = (a.birth_hour < 10 ? '0' : '') + a.birth_hour + ':' + (a.birth_minute < 10 ? '0' : '') + a.birth_minute;
    } else if (a.birth_hour != null) {
      t = (a.birth_hour < 10 ? '0' : '') + a.birth_hour + ':00';
    }
    return (d || '出生未填') + (t ? ' ' + t : '');
  },

  /** 新增档案：清空表单 */
  onNewArchive: function () {
    this.setData({
      archEditing: null,
      archGenderIndex: 0,
      archRelationIndex: ARCH_DEFAULT_RELATION_IDX,
      archForm: { nickname: '', gender: '', relationship: 'other', birth_year: '', birth_month: '', birth_day: '', birth_hour: '', birth_minute: '' },
      showArchiveEditor: true
    });
  },

  /** 编辑档案：用列表数据回填表单 */
  onEditArchive: function (e) {
    var id = e.currentTarget.dataset.id;
    var a = this.data.archives.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!a) return;
    var gIdx = 0;
    if (a.gender === '男') gIdx = 1; else if (a.gender === '女') gIdx = 2;
    var rIdx = RELATION_KEYS.indexOf(a.relationship);
    if (rIdx < 0) rIdx = ARCH_DEFAULT_RELATION_IDX;
    this.setData({
      archEditing: a,
      archGenderIndex: gIdx,
      archRelationIndex: rIdx,
      archForm: {
        nickname: a.nickname || '',
        gender: a.gender || '',
        relationship: a.relationship || 'other',
        birth_year: a.birth_year != null ? String(a.birth_year) : '',
        birth_month: a.birth_month != null ? String(a.birth_month) : '',
        birth_day: a.birth_day != null ? String(a.birth_day) : '',
        birth_hour: a.birth_hour != null ? String(a.birth_hour) : '',
        birth_minute: a.birth_minute != null ? String(a.birth_minute) : ''
      },
      showArchiveEditor: true
    });
  },

  /** 表单输入：统一回写 archForm[field] */
  onArchInput: function (e) {
    var field = e.currentTarget.dataset.field;
    var patch = {};
    patch['archForm.' + field] = e.detail.value;
    this.setData(patch);
  },
  onArchGenderChange: function (e) { this.setData({ archGenderIndex: Number(e.detail.value) }); },
  onArchRelationChange: function (e) { this.setData({ archRelationIndex: Number(e.detail.value) }); },

  /** 保存：本地校验 → POST（含 name）或 PUT（不含 name，避免覆盖 name —— 网页端缺陷 #1） */
  onSaveArchive: function () {
    if (this.data.archSaving) return;
    var form = this.data.archForm;
    var nickname = (form.nickname || '').trim();
    if (!nickname) { wx.showToast({ title: '请输入昵称', icon: 'none' }); return; }
    if (nickname.length > 64) { wx.showToast({ title: '昵称不能超过 64 字', icon: 'none' }); return; }
    var gIdx = this.data.archGenderIndex;
    if (gIdx <= 0) { wx.showToast({ title: '请选择性别', icon: 'none' }); return; }
    var gender = ARCH_GENDER_OPTIONS[gIdx];
    var rIdx = this.data.archRelationIndex;
    var relKey = RELATION_KEYS[rIdx];
    if (!relKey || RELATION_KEYS.indexOf(relKey) < 0) { wx.showToast({ title: '请选择关系', icon: 'none' }); return; }
    var parsed = this._parseArchBirth(form);
    if (parsed.error) { wx.showToast({ title: parsed.error, icon: 'none' }); return; }

    var body = {
      nickname: nickname,
      gender: gender,
      relationship: relKey,
      birth_year: parsed.birth_year,
      birth_month: parsed.birth_month,
      birth_day: parsed.birth_day,
      birth_hour: parsed.birth_hour,
      birth_minute: parsed.birth_minute
    };
    if (!this.data.archEditing) { body.name = nickname; } // 新增带 name；编辑(PUT)不带 name

    var self = this;
    this.setData({ archSaving: true });
    var req = this.data.archEditing
      ? api.request('/archives/' + this.data.archEditing.id, { method: 'PUT', data: body })
      : api.request('/archives', { method: 'POST', data: body });
    req.then(function (res) {
      if (res && res.code === 0) {
        wx.showToast({ title: '已保存', icon: 'success' });
        self.setData({ showArchiveEditor: false });
        self.loadArchives();
      } else {
        var msg = (res && (res.detail || res.msg)) || '保存失败';
        wx.showToast({ title: msg, icon: 'none' });
      }
    }).catch(function (e) {
      wx.showToast({ title: (e && e.message) || '网络请求失败', icon: 'none' });
    }).then(function () {
      self.setData({ archSaving: false });
    });
  },

  /** 解析出生字段：空→null，否则校验范围（年月齐全时校验该月真实天数） */
  _parseArchBirth: function (form) {
    var checks = [
      ['birth_year', 1900, 2100, '出生年需在 1900–2100 之间'],
      ['birth_month', 1, 12, '出生月需在 1–12 之间'],
      ['birth_hour', 0, 23, '出生时需在 0–23 之间'],
      ['birth_minute', 0, 59, '出生分需在 0–59 之间']
    ];
    var out = {};
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i], raw = (form[c[0]] || '').trim();
      if (raw === '') { out[c[0]] = null; continue; }
      if (!/^\d+$/.test(raw)) { return { error: c[3] }; }
      var n = parseInt(raw, 10);
      if (n < c[1] || n > c[2]) { return { error: c[3] }; }
      out[c[0]] = n;
    }
    var dayRaw = (form.birth_day || '').trim();
    if (dayRaw === '') { out.birth_day = null; }
    else {
      if (!/^\d+$/.test(dayRaw)) { return { error: '出生日需在 1–31 之间' }; }
      var d = parseInt(dayRaw, 10);
      if (d < 1 || d > 31) { return { error: '出生日需在 1–31 之间' }; }
      if (out.birth_year != null && out.birth_month != null) {
        var dim = new Date(out.birth_year, out.birth_month, 0).getDate();
        if (d > dim) { return { error: '该月没有 ' + d + ' 号' }; }
      }
      out.birth_day = d;
    }
    return out;
  },

  /** 删除：自己的档案不显示删除入口；二次确认后调 DELETE */
  onDeleteArchive: function (e) {
    var id = e.currentTarget.dataset.id;
    var a = this.data.archives.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!a) return;
    var self = this;
    wx.showModal({
      title: '删除档案',
      content: '确定删除「' + (a.nickname || '未命名') + '」的档案吗？',
      success: function (r) {
        if (!r.confirm) return;
        api.request('/archives/' + id, { method: 'DELETE' }).then(function (res) {
          if (res && res.code === 0) {
            wx.showToast({ title: '已删除', icon: 'success' });
            self.loadArchives();
          } else {
            var msg = (res && (res.detail || res.msg)) || '删除失败';
            wx.showToast({ title: msg, icon: 'none' });
          }
        }).catch(function (err) {
          wx.showToast({ title: (err && err.message) || '网络请求失败', icon: 'none' });
        });
      }
    });
  },

  /* ---- 头像口型动画（DF-55） ---- */
  // 按头像文件查定位配置，写入 mouthRect（无配置则 null → 不渲染口型层）
  _applyMouthRect: function (avatarFile) {
    var rect = avatarMouth.getMouthRect(avatarFile);
    this.setData({ mouthRect: rect, mouthSx: 1, mouthSy: 1 });
  },
  // 播报开始：120ms 节拍用双正弦模拟开合（无 analyser，与网页模拟分支同参数）
  _startMouth: function () {
    if (this._mouthTimer) return;            // 幂等：已在跑不重复开
    if (!this.data.mouthRect) return;        // 无定位配置不显示口型
    var self = this;
    var phase = 0;
    this._mouthTimer = setInterval(function () {
      phase += 0.12;
      var v1 = Math.sin(phase) * 0.5 + 0.5;
      var v2 = Math.sin(phase * 2.3 + 1.2) * 0.5 + 0.5;
      var level = (v1 * 0.45 + v2 * 0.55) * 1.3;
      if (level < 0) level = 0;
      if (level > 1) level = 1;
      self.setData({
        mouthSy: 1.0 + level * 1.2,          // 1.0（闭）– 2.2（张）
        mouthSx: 0.97 + level * 0.15         // 0.97 – 1.12
      });
    }, 120);
  },
  // 播报结束/切头像：清定时器、复位缩放（隐藏由 speaking 状态控制）
  _stopMouth: function () {
    if (this._mouthTimer) { clearInterval(this._mouthTimer); this._mouthTimer = null; }
    this.setData({ mouthSx: 1, mouthSy: 1 });
  },

  setAvatar: function (idx) {
    var n = AVATARS.length;
    var i = ((idx % n) + n) % n;
    this.setData({
      avatarIdx: i,
      avatarSrc: env.getApiOrigin() + AVATARS[i].file,
      avatarErr: false
    });
    // 切换头像：先停旧口型，刷新定位，若仍在播报则在新头像上重启动画
    this._stopMouth();
    this._applyMouthRect(AVATARS[i].file);
    if (this.data.speaking) { this._startMouth(); }
  },

  prevAvatar: function () { this.setAvatar(this.data.avatarIdx - 1); },

  nextAvatar: function () { this.setAvatar(this.data.avatarIdx + 1); },

  onAvatarErr: function () {
    // 头像加载失败：回退占位符并隐藏口型，避免白块/错位嘴型
    this.setData({ avatarErr: true, mouthRect: null });
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
        self._stockLinked = false;     // DF-67：重新开始/新会话清除证券条件池标记
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
        // DF-63/DF-64：重新开始后清空提示语轮播，并在空闲态按条件恢复顶部轮播
        self._stopThinking();
        self._maybeStartIdleHint();
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
      // FB-51：回复到达不再无条件弹咨询记录页，改为按「归属」分流。
      // 归属键 = 本轮请求携带的 question_id（由调用方写入 item.qid）；
      // 与当前面板根 id（付费 rootQuestionId / 免费 freeQuestionId）相等 → 属于当前根：
      //   展开顶部咨询面板直接看回复（录音中不打断输入面板，避免藏起正在回填的文字）。
      // 不等 → 属于其他问题：不展开、不播报，仅在咨询记录按钮累加未读数字角标。
      // 缺失 question_id → 按其他处理且不计数（不猜测归属，仅 console 记录）。
      var curRoot = this.rootQuestionId || this.freeQuestionId || '';
      var rqid = ex.qid || '';
      if (rqid && curRoot && String(rqid) === String(curRoot)) {
        if (!this.data.recording) {
          patch.topOpen = true;
          patch.inputOpen = false;
        }
      } else if (rqid) {
        this._addUnread(rqid);
      } else {
        console.warn('[chat] FB-51：回复未携带 question_id，按其他处理且不计未读');
      }
    }
    this.setData(patch);
    this.buildHistory();
    return id;
  },

  /* ---------------- FB-51：咨询记录未读角标（storage 按 uid 隔离） ---------------- */
  _unreadKey: function () { return 'unread_replies:' + (this.data.userId || ''); },
  _readUnread: function () {
    try {
      var v = wx.getStorageSync(this._unreadKey());
      if (v && typeof v === 'object' && typeof v.total === 'number') {
        return { total: v.total, byQid: (v.byQid && typeof v.byQid === 'object') ? v.byQid : {} };
      }
    } catch (e) { /* 忽略读取异常，按未读 0 处理 */ }
    return { total: 0, byQid: {} };
  },
  _writeUnread: function (u) {
    try { wx.setStorageSync(this._unreadKey(), u); } catch (e) { /* 忽略写入异常 */ }
    this.setData({ historyUnread: u.total || 0 });
  },
  /** 把 storage 未读同步到界面（登录 / 切账号 / 进页面时调用） */
  _syncUnread: function () { this.setData({ historyUnread: this._readUnread().total || 0 }); },
  /** 其他问题的回复到达：按 qid 累加未读（每条 +1，同 qid 累加） */
  _addUnread: function (qid) {
    var u = this._readUnread();
    var k = String(qid || '');
    u.byQid[k] = (u.byQid[k] || 0) + 1;
    u.total = (u.total || 0) + 1;
    this._writeUnread(u);
  },
  /** 进入咨询记录页：未读整体清零 */
  _clearUnread: function () { this._writeUnread({ total: 0, byQid: {} }); },

  updateScroll: function () {
    this.setData({ scrollTo: 'anchor-bottom' });
  },

  /* ---------------- 输入 ---------------- */
  onInput: function (e) {
    this._inputCursor = (e.detail && typeof e.detail.cursor === 'number') ? e.detail.cursor : -1;
    var v = e.detail.value;
    this.setData({ input: v, inputCursor: -1, canClear: (v || '').trim().length > 0 });
    // DF-64：输入框有文字时暂停空闲期金句轮播
    if ((v || '').trim().length) this._stopIdleHint();
  },

  onExample: function (e) {
    var text = e.currentTarget.dataset.text || '';
    this.setData({ input: text, inputOpen: true, canClear: text.trim().length > 0 });
    this._stopIdleHint();
  },

  /** DF-58：一键清空输入区（需求方定稿：不保留原文、不显示撤销、无 5 秒计时） */
  clearInput: function () {
    if (!(this.data.input || '').trim()) return;
    this.setData({ input: '', inputCursor: 0, canClear: false });
    wx.showToast({ title: '已清空', icon: 'none' });
    this._maybeStartIdleHint();
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
      this.pendingAction = 'send';
      this.setData({ showLogin: true });
      return;
    }
    this._maybeSendShort(text);
  },

  /** FB-47：短内容（1-3 字）先弹一次「是否发送」确认，避免误发/静默丢弃 */
  _maybeSendShort: function (text) {
    var self = this;
    if (text.length >= SHORT_TEXT_MIN && text.length <= SHORT_TEXT_MAX) {
      wx.showModal({
        title: '内容较短，确定发送吗？',
        showCancel: true,
        confirmText: '发送',
        cancelText: '取消',
        success: function (res) {
          if (res.confirm) self._doSend(text);
        }
      });
      return;
    }
    this._doSend(text);
  },

  _doSend: function (text) {
    // FB-51：发送后保持顶部咨询面板展开（会话区 / 已发送内容可见）
    this.setData({ input: '', inputOpen: false, topOpen: true, canClear: false });
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
      this.stopSpeaking('pause');
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
    this.stopSpeaking('off');
    if (app().globalData) app().globalData.ttsOn = false;
    this.setData({ ttsOn: false });
    wx.showToast({ title: '已关闭自动播报', icon: 'none' });
  },

  /**
   * DF-63：统一停止播报（单击暂停 / 长按关闭 / 开始录音 / 重新发送 / 离开页面 均走这里）
   * 语义（对齐网站）：停止等待期提示语轮播（置 hintActive=false、epoch+1、清 timer）、
   * 立即停 TTS、复位口型，避免残留回调继续推进提示语。
   */
  stopSpeaking: function (reason) {
    this._stopThinking();
    tts.stop();
    this.setData({ speaking: false, typing: false });
    this._stopMouth();
    return reason;
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

    // DF-77：首次提问与追问均需确认扣费（每次 1 积分）
    var ok = await this.confirmCost(text, bundle);
    if (!ok) {
      // FB-48：首个根问题取消扣费后转入免费引导对话（与计费路径隔离）；
      //        DF-77：追问取消则留在当前状态，不进入免费流
      if (!this.rootQuestionId) {
        await this.freeGuidanceFlow(text);
      }
      this.setData({ sending: false });
      return;
    }

    // 参考页 #sentPreview：确认扣费后先把本轮问题置顶展示，回复落地后换成置顶上下文
    this.setData({ sentVisible: true, sentContent: text, sentFeishuUrl: '' });

    // 用户消息带上本轮技能 types，咨询记录卡片用它渲染技能信息
    var userMsgId = this.pushMsg('user', text, {
      types: bundle.types,
      auto: !!(this.autoMetas && this.autoMetas.length)
    });
    this.setData({ typing: true });
    // DF-63：启动等待期随机提示语轮播（含 TTS）
    this._startThinking();
    this.updateScroll();

    try {
      // 1) 让后端把盘面组装成提示词文本（网页版同款接口）
      var promptRes = { texts: {}, hint: '' };
      try {
        promptRes = await paipanUtil.fetchPromptText(bundle.paipanData);
      } catch (e) {
        console.warn('[chat] preview_prompt_hint 失败，继续走 /chat：', e);
      }

      // 2) 扣积分（幂等 client_id）
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

      this._stopThinking();
      this.setData({ typing: false });
      var id = this.pushMsg('assistant', res.reply, {
        msgId: res.msg_id || '',
        qid: this.questionId || this.rootQuestionId || ''   // FB-51：归属键 = 本轮 question_id
      });
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
      this._stopThinking();
      this.setData({ typing: false, sentVisible: false });
      var msg = (e && e.message) || '请求失败';
      if (/登录已过期/.test(msg)) {
        this.setData({ loggedIn: false, userName: '', showLogin: true });
      }
      this.pushMsg('assistant', '出错了：' + msg + '。可以稍后再试一次。');
      this.updateScroll();
    } finally {
      this.setData({ sending: false, typing: false });
      this._maybeStartIdleHint();
    }
  },

  /**
   * FB-48：积分确认框点「取消」后走免费引导对话
   * 与计费路径隔离：不调用 /credits/consume、不设置 rootQuestionId/questionId、
   * 不显示「已消耗 N 积分」气泡与 sentPreview 置顶，question_id 传 null 保证不落问事记录。
   */
  freeGuidanceFlow: async function (text) {
    // DF-63：免费路径同样展示「已发送」卡片（定稿口径）
    this.setData({ sentVisible: true, sentContent: text, sentFeishuUrl: '' });
    // 用户这句作为普通消息展示，不带技能标记，不进咨询记录卡片
    this.pushMsg('user', text, { types: [], auto: false });
    this.setData({ typing: true });
    this._startThinking();
    this.updateScroll();
    try {
      var res = await api.request('/chat', {
        method: 'POST',
        timeout: 180000,
        data: {
          message: text,
          system_prompt: GUIDANCE_PROMPT,
          source: 'xiaoxuan',
          paipan_data: {},
          paipan_prompt_text: {},
          target_id: null,
          question_id: null
        }
      });
      if (!res || typeof res.reply !== 'string') {
        throw new Error((res && (res.detail || res.msg)) || '模型未返回内容');
      }
      this._stopThinking();
      this.setData({ typing: false });
      var id = this.pushMsg('assistant', res.reply, {
        msgId: res.msg_id || '',
        qid: this.freeQuestionId || ''   // FB-51：免费路径归属键（DF-72 提供 freeQuestionId）
      });
      this.updateScroll();
      if (this.data.ttsOn) {
        var item = this.findMsg(id);
        var plain = (item && item.plain) || md.plain(res.reply);
        this._ttsText = plain;
        this.setData({ ttsText: plain });
        tts.speak(plain);
      }
    } catch (e) {
      console.error('[chat] 免费引导失败', e);
      this._stopThinking();
      this.setData({ typing: false, sentVisible: false });
      var msg = (e && e.message) || '请求失败';
      if (/登录已过期/.test(msg)) {
        this.setData({ loggedIn: false, userName: '', showLogin: true });
      }
      this.pushMsg('assistant', '出错了：' + msg + '。可以稍后再试一次。');
      this.updateScroll();
    }
    this._maybeStartIdleHint();
  },

  /**
   * 积分消耗确认（参考页自绘卡片，替代原来的 wx.showModal）
   * 文案沿用参考页：已关联技能 + 每次 1 积分 + 两条说明
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
    this.stopSpeaking('record');
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
        self.setData({ input: text, canClear: (text || '').trim().length > 0 });
      });
      // 录音开始即展开输入面板（向上浮层），让用户边录边看到回填区域
      this.setData({ recording: true, recSeconds: 0, inputOpen: true, topOpen: false });
      this._stopIdleHint();
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

      // FB-47：不再因时长 <1s / 文件过小直接判失败，先尽量拿到识别文本（短按也可能识别出内容）
      if (!text && filePath) {
        // 有音频但没有文本（插件异常 / 兜底链路）：走原来的整段识别补救
        wx.showLoading({ title: '识别中…', mask: true });
        try {
          var res = await asr.recognize(filePath);
          wx.hideLoading();
          text = (res && res.text) || '';
        } catch (e) {
          wx.hideLoading();
          var em = (e && e.message) || '请稍后重试，或改用文字输入';
          if (this._isAsrShortErr(em)) {
            // FB-47：太短/没录到声音不算识别失败，按「没听清」轻提示，可重录
            wx.showToast({ title: '没听清，请再说一次', icon: 'none' });
          } else {
            wx.showModal({ title: '语音识别失败', content: em, showCancel: false });
          }
          return;
        }
      }

      var trimmed = String(text || '').trim();
      if (!trimmed) {
        // FB-47：空/静音按「没听清」提示可重录；真实故障仍弹「语音识别失败」
        var errMsg = (r && r.error) || asr.lastError() || '';
        if (errMsg && !this._isAsrShortErr(errMsg)) {
          wx.showModal({ title: '语音识别失败', content: errMsg, showCancel: false });
        } else {
          wx.showToast({ title: '没听清，请再说一次', icon: 'none' });
        }
        return;
      }

      // 最终结果整体覆盖中间结果，避免重复拼接
      this.setData({ input: trimmed, inputOpen: true, canClear: true });

      // FB-47：识别出的短内容（1-3 字）同样先弹确认，取消则停在输入态
      if (trimmed.length <= SHORT_TEXT_MAX) {
        var self = this;
        wx.showModal({
          title: '内容较短，确定发送吗？',
          showCancel: true,
          confirmText: '发送',
          cancelText: '取消',
          success: function (res) {
            if (res.confirm) self._doSend(trimmed);
          }
        });
      } else {
        wx.showToast({ title: '已填入，确认后发送', icon: 'none' });
      }
    } finally {
      this._stopping = false;
    }
  },

  /** FB-47：识别「太短 / 没录到声音」类错误，避免误弹「语音识别失败」 */
  _isAsrShortErr: function (msg) {
    return /too short|太短|没听清|没有录到声音|没录到声音|录音时间过短/i.test(String(msg || ''));
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
    // FB-49：关闭/取消登录层即放弃之前的待办意图，避免跨会话继承
    this.pendingAction = null;
    this.pendingText = '';
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
    // FB-51：登录 / 切账号后按 uid 恢复未读角标
    this._syncUnread();
    // FB-49：按登录前唯一意图分发；无意图默认停在主页，不再被残留标记劫持
    var action = this.pendingAction || null;
    var pending = this.pendingText || '';
    this.pendingAction = null;
    this.pendingText = '';
    if (action === 'send' && pending) {
      this.setData({ input: '', inputOpen: false });
      this.startFlow(pending);
      return;
    }
    if (action === 'history') {
      this.openHistory();
      return;
    }
    if (action === 'credits') {
      this.onProfileCredits();
      return;
    }
    if (action === 'archives') {
      this.onArchives();
      return;
    }
    // 默认：停在主页，不打开任何全屏层
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
    // FB-49：退出登录清空待办意图
    this.pendingAction = null;
    this.pendingText = '';
    // FB-51：退出登录清除本账号未读角标
    this._clearUnread();
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
        + ' 积分\n每次深度解读消耗 1 积分（根问题与追问相同）。\n充值请前往网页版「万机」完成。',
      confirmText: '刷新',
      success: function (r) { if (r.confirm) self.loadBalance(); }
    });
  },

  onShareAppMessage: function () {
    return { title: '万机决策助手', path: '/uniApp/pages/chat/chat' };
  }
});
