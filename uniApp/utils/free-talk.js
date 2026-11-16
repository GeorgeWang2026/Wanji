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
var env = require('./env.js');
// 金句来源与首页金句区同一份数据（data/quotes.js，字段：text/translation/author/lang）
var QUOTES = [];
try { QUOTES = require('../data/quotes.js') || []; } catch (e) { QUOTES = []; }
if (!Array.isArray(QUOTES)) QUOTES = [];
// 金句引导依赖本地金句池：加载失败时不再静默降级，启动就告警一次，
// 真机上「金句模式一轮都没出现」时能直接判断是数据问题还是触发问题。
if (!QUOTES.length) {
  console.error('[ft-alarm] 金句数据缺失：data/quotes.js 加载失败或为空 → 金句模式将自动降级为轻问');
}

var GREETING = '你好，我在。想聊点什么？';
// 播报结束后的判回录短窗口（精确匹配只在「正在播 / 刚播完」的窗口内生效）。
// 400ms 尾窗 + 1100ms = 1.5s：窗口外用户复述 AI 原话必须放行，不能误杀。
var POST_ECHO_MS = 1100;
var TAIL_MS = 400;          // 播报结束后仍视为「正在说」的尾窗
var ECHO_SIM = 0.55;        // 文本相似度阈值
var ECHO_MIN = 2;           // 过短结果不参与回声判定
var ECHO_BLOCK_MIN = 4;     // 精确匹配时可裁剪的已播片段最短字数（低于它不裁，避免把用户原话拆碎）
var ECHO_REST_MIN = 3;      // 裁剪后剩下的字数下限：不足按整段回录丢弃（防止只留下「嗯嗯」这类残渣）
var SPOKEN_MAX = 7;         // 回声比对保留的最近句子数
// 真机加固：WechatSI 的 onStop 常把「整轮播报」合成一条 final（远长于单句），
// 单句 Dice 会被长度拉低而漏判。另记一份逐字累积的播报全文，用覆盖率 / 最长公共片段判同源。
var SPOKEN_TEXT_MAX = 3000; // 播报全文保留长度（覆盖当前若干轮）
var ECHO_COVER = 0.6;       // 回录文本的二元组落在播报全文里的比例阈值
var ECHO_COVER_MIN = 6;     // 至少命中这么多个二元组才判回声（避免短句误伤）
var ECHO_LCS_MIN = 8;       // 最长公共连续片段下限（字）
var ECHO_LCS_RATIO = 0.5;   // 公共片段至少占回录文本的比例
var LCS_MAX_LEN = 200;      // 超过这个长度的回录文本只走覆盖率，不算 LCS
var SOFT_SEG = 19;          // 无句末标点时强制切句的字数（网站 _SPEAK_SOFT_MAX）
var SOFT_WINDOW = 27;       // 软切时回看的窗口（网站 _SPEAK_SOFT_MAX + 8）
var SOFT_PAUSE_MIN = 8;     // 软切停顿标点最早落点
var LOG_MAX = 40;           // 对话记录保留条数（最新在前）
var LOG_THROTTLE_MS = 150;  // 流式/中间识别结果的记录刷新节流
var REPLY_TIMEOUT_MS = 15000; // 发出后多久没回复就提示
var AI_SHOWN_MAX = 4000;      // AI 字幕保留上限（防止超长回复把 setData 拖慢）
// DF-97：播报期间暂停收音（主防线），播报队列真正空闲后再恢复
var RESUME_ECHO_MS = 800;     // 恢复收音后的从严回声窗（扬声器尾音兜底，非主防线）
var ASR_PAUSE_MAX_MS = 15000; // 暂停上限：超过且音频已空闲则强制恢复，避免麦克风被永久关掉
// 静默噪音闸门：插件在完全没人说话时也会回 1–2 个字（幻听/环境音）。
// 中文最短的完整口语（「好的」「不是」）是 2 个字，1 个字几乎都不是有效输入，故取 2。
var MIN_VOICE_CHARS = 2;
// 字幕/播报合并：短句先攒着，与下一句一起出声，避免字幕一条条跳
var SAY_MIN = 18;             // 单段最短长度（达到才交付播报）
var SAY_MAX = 60;             // 单段最长长度（超过必须切）
var SAY_HOLD_MS = 260;        // 短句等待合并的最长时间（超时单发，避免一直不出声）
var SPEAK_SEG_MAX = 110;      // 单次 TTS 请求的最长字数（与 tts.MAX_SEG 对齐，仅极长段才硬切）
// 长静默引导阶梯：第 1 次追问 → 第 2 次换角度 → 第 3 次起金句模式（中间穿插轻问）。
// 配置项名：GUIDE_DELAYS_MS（首次阈值与递增基数都在这里）
var GUIDE_DELAYS_MS = [60000, 90000, 150000];
var GUIDE_DELAY_MAX = 300000;  // 后续间隔上限（金句模式两轮之间递增到 5 分钟后不再拉长）
var GUIDE_MAX = 8;             // 单次沉默最多主动开口几轮，之后收尾不再打扰
var GUIDE_TIMEOUT_MS = 12000;  // 引导请求等模型回复的上限：超时宁可不说话
var GUIDE_RETRY_MS = 5000;     // 引导被占用（仍在播报/通道未就绪）时的短重试间隔，不重置整档计时

// 三种状态的一句话说明（只用于日志，真机核对「界面为什么显示这句话」）
var STATE_TIP = {
  ticketing: '正在换票',
  connecting: '正在建连',
  reconnecting: '正在重连',
  generating: '她在生成中（还没有声音）',
  speaking: '她在说（有音频或正在等下一段）',
  your_turn: '轮到你说（回复已结束 + 队列空 + 收音已恢复）',
  failed: '通道失败',
  closed: '通道关闭',
  idle: '空闲'
};
var GUIDE_ASKED_MAX = 8;       // 本会话「已问过」列表保留条数（仅内存，不跨会话/不落盘）

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

/**
 * Dice 相似度：2×交集/(A+B)。
 * 真机根因修复：不再保留「包含即判同」的捷径。用户说「你好，我在想问问……」时，
 * 句子里只要包含播报过的短句「你好我在」，旧捷径就直接返回 1，
 * 而且句子越长越包含，导致整段被反复判成回录。
 * 「被播报全文包含」的语义只留在 _echoCheck 第 ① 条（用户整句 ⊆ 播报文本），方向相反才代表回录。
 */
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

/** 最长公共连续子串长度（「回录文本任意 N 字连续片段命中播报」判定用） */
function longestCommon(a, b) {
  if (!a || !b) return 0;
  var prev = new Array(b.length + 1);
  var cur = new Array(b.length + 1);
  for (var k = 0; k <= b.length; k++) { prev[k] = 0; cur[k] = 0; }
  var best = 0;
  for (var i = 1; i <= a.length; i++) {
    var ca = a.charCodeAt(i - 1);
    cur[0] = 0;
    for (var j = 1; j <= b.length; j++) {
      if (ca === b.charCodeAt(j - 1)) {
        var v = prev[j - 1] + 1;
        cur[j] = v;
        if (v > best) best = v;
      } else {
        cur[j] = 0;
      }
    }
    var tmp = prev; prev = cur; cur = tmp;
  }
  return best;
}

/** 播报全文 → 二元组集合（覆盖率判定的索引） */
function gramSet(s) {
  var out = Object.create(null);
  for (var i = 0; i + 1 < s.length; i++) out[s.substr(i, 2)] = 1;
  return out;
}

/** 从流式缓冲里切出可播的整句，返回剩余缓冲（网站 _speakCutBuffer 口径） */
function takeSentences(buf) {
  var rest = String(buf || '');
  var segs = [];
  while (true) {
    var m = rest.match(/[。！？；…!?;]/);
    if (m) {
      var idx = m.index + 1;
      var s = rest.slice(0, idx).trim();
      rest = rest.slice(idx);
      if (s) segs.push(s);
      continue;
    }
    // 无句末标点的中文长段：在前 27 字里找最后一个停顿标点，找不到就按 19 字硬切
    if (/[\u4e00-\u9fff]/.test(rest) && rest.replace(/\s/g, '').length >= SOFT_SEG) {
      var win = rest.slice(0, SOFT_WINDOW);
      var lastPause = Math.max(win.lastIndexOf('，'), win.lastIndexOf('、'), win.lastIndexOf(','));
      var cut = lastPause >= SOFT_PAUSE_MIN ? lastPause + 1 : SOFT_SEG;
      var s2 = rest.slice(0, cut).trim();
      rest = rest.slice(cut);
      if (s2) segs.push(s2);
      continue;
    }
    break;
  }
  return { segs: segs, rest: rest };
}

function FreeTalk(opts) {
  opts = opts || {};
  this.onState = opts.onState || noop;
  // 对话记录：最新一轮在最上面，元素 { id, user, userFinal, ai, aiFinal }
  this.onLog = opts.onLog || noop;
  this.onSpeaking = opts.onSpeaking || noop;
  this.onNotice = opts.onNotice || noop;
  this.onError = opts.onError || noop;
  // DF-104：client.event 服务端回执（草稿编辑 / 深度解读提交确认等）
  this.onClientEventAck = opts.onClientEventAck || noop;
  // DF-104：WS session.ready 下发的权威 session_id 回调，供页面回写扣费关联
  this.onReady = opts.onReady || noop;
  // DF-104：续用页面进入时建立的会话（/agent/sessions/ensure 的 session_id）
  this.sessionId = opts.sessionId || '';
  // DF-97：AI 文字逐句上屏（与播报同一份分段、同一时刻），页面只需把它写进字幕区
  this.onAiText = opts.onAiText || noop;
  // 发送倒计时：'即将发送…2' 显示在用户文字区；'' 表示撤掉。不新增控件。
  this.onCountdown = opts.onCountdown || noop;
  // DF-103：「可以开始说话了」提示的启停（麦克风闪烁动效开关），true = 可说话 / false = 撤下
  this.onTurn = opts.onTurn || noop;
  // 录音状态提示：写进用户文字区（如「麦克风异常，正在重连」），不弹窗、不静默空转
  this.onStatus = opts.onStatus || noop;

  this._active = false;
  this._channel = null;
  this._ttsOff = null;
  this._greeted = false;
  // 问候语延迟到录音器 onStart 之后再出声：避免「录音启动中」与「音频焦点被播报占用」撞在一起
  this._greetPending = false;
  this._greetDone = false;
  this._greetTimer = null;
  this._asrStarted = false;      // 插件是否已回 onStart（录音乐器真的起来了）
  this._buf = '';
  this._replyDelta = 0;
  // 被打断后到下一轮 assistant.start 之间，丢弃在途 delta，避免自动续播
  this._muteDeltas = false;
  this._tailUntil = 0;
  this._postEchoUntil = 0;
  this._speechSeq = 0;          // 播报批次号：插话/停通道后作废旧批次
  this._tailTimer = null;       // 尾窗结束 → 开启延迟回声窗
  this._spoken = [];
  this._spokenText = '';        // 播报全文（归一化后逐句累积），用于整段回录的覆盖率判定
  this._spokenGrams = Object.create(null);
  // AI 字幕：只累积「已经开始播的段」，由 tts 的 playing 事件驱动，
  // 与播报队列一一对应，避免回复整段到齐时一次性铺满。
  this._aiShown = '';
  this._aiShownSegs = 0;        // 本轮已上屏的句数（日志里验证逐句到达）
  // 已交给 tts 播放、但还没开始出声的段落：用于「播到哪一句、字幕就到哪一句」，
  // 以及在播报被暂停/关闭时把剩余文字补齐（插话中断则整队清空，不补）。
  this._aiQueue = [];
  // 交付链编号：本轮编号 + 段序号。只做结构校验（序号），不比对文本内容，
  // 避免误杀模型刻意原样重复的一整句。
  this._replySeq = 0;           // 轮次号（assistant.start / 开场问候 = 新一轮）
  this._segSeq = 0;             // 本轮已交付段号（唯一分配器，只在本轮内 +1）
  this._segCount = 0;           // 本轮实际交付段数（日志汇总用）
  this._segChars = 0;           // 本轮实际交付总字数
  this._deliveredRaw = '';      // 本轮实际交付的原文（含标点，用于内容级校验）
  this._streamRaw = '';         // 本轮收到的全部 delta 原文（内容级校验的对照基准）
  this._deliveredSeqs = [];     // 结构性校验：本轮已交付的 seq（只校验序号，不看内容）
  this._seqAlarm = 0;           // 结构告警次数：>0 说明链路里出现了第二个生产者
  this._sawDelta = false;       // 本轮是否收到过流式 delta（决定 onEnd 要不要整段补播）
  // 用户行「同段同终态只写一次」：只在当前识别段内判重，
  // 比较对象是「本段上一次写进 UI 的值」，不放宽到历史文本/内容相似度，
  // 所以不是内容去重：换段、换字、状态变化都照常写。
  this._uiSegNo = 0;            // 识别段号（onStart +1）
  this._uiText = '';            // 本段已写入 UI 的文本
  this._uiFinal = false;        // 本段已写入的是否终态
  // 发送倒计时（录音侧停滞计时倒计），'' = 不显示
  this._countdownOn = false;
  this._countText = '';
  this._countBlocked = false;   // 闸门拦截去重标记：同一次拦截只打一条日志（防 120ms 刷屏）
  this._countBlockReason = '';  // 最近一次拦截原因：原因变了要再打一条（真机定位用）
  // 本轮耗时桶：最后一次部分结果 → 首段开播，逐段打点，一条日志看瓶颈
  this._turnT = null;
  this._asrMeta = null;         // 本次 final 携带的录音侧时间戳（停口/stop/onStop）
  this._segStartAt = 0;         // 本轮 ASR 识别段的起始时刻
  this._lastSpeechEndAt = 0;    // 最近一次播报结束时刻（判断 final 是否起于播报期间）
  this._lastFinal = '';
  this._lastFinalAt = 0;
  this._asrOn = false;          // 连续识别是否已开启（ready 会多次回调，只开一次）
  this._chanBusy = false;       // 已发出消息但还没收到任何回复
  // ft-diag13：三种状态（生成中 / 她在说 / 轮到你说）统一收口
  this._replyOpen = false;      // 本轮 assistant 还没 end（含生成中与播报中）
  this._spokeThisReply = false; // 本轮是否已经出过声：空隙期维持「她在说」，不掉回「轮到你说」
  this._holdTimer = null;       // 状态保持轮询：空隙/收音未恢复时每 500ms 复核一次
  this._state = '';             // 最近一次下发给页面的状态（去重）
  this._turnNo = 0;             // 轮次序号：每轮「可以开始说话了」只提示一次
  this._hintShownTurn = -1;
  this._hintOn = false;         // 当前小字位显示的是「轮到你说」提示
  this._interruptedTurn = false;// 本轮由用户插话结束：不提示「可以开始说话了」
  this._replyTimer = null;      // 无回应看门狗
  // 对话记录内部状态：每轮 = 一条「用户行 + AI 行」，最新一轮在最上面
  this._log = [];
  this._logSeq = 0;
  this._logTimer = null;
  this._curId = '';             // 当前正在构建的那一轮（用户行落在这一轮）
  this._aiId = '';              // 正在接收 AI 流式内容的那一轮（打断时仍指向旧轮）
  this._segFresh = false;       // 新一段识别已开始、但还没写入任何文字（用于换轮清空）
  this._segLock = '';           // 段锁：'' 未决 / 'show' 本段已确认是用户语音 / 'mute' 本段判为回录
  this._segLen = 0;             // 本段最近一次 partial 的长度（长度单调增长 = 同一句话在继续）
  // 播报期间暂停收音：主防线。暂停后到达的任何识别结果一律丢弃，
  // 回声判据（_echoCheck）降级为兜底，只负责「恢复瞬间的扬声器尾音」等时序竞争。
  this._asrPaused = false;
  this._pauseGuardTimer = null;
  // 开场问候的「预录」窗口：只有它是唯一不暂停收音的播报（保证进入即可说话）
  this._preRoll = false;
  this._preRollTimer = null;
  // 播报/字幕合并缓冲：短句先攒，凑够 SAY_MIN 再交给 tts（保证字幕与音频同源同段）
  this._sayPending = '';
  this._sayHoldTimer = null;
  // 长静默检测（只检测 + 日志 + 回调，不说话）
  this._silenceTimer = null;
  this._silenceSince = 0;
  this._silenceOn = false;
  // 主动引导（长静默时不伪装用户消息，只发一条系统指令给模型）
  this._guideLevel = 0;          // 本轮沉默已引导次数（用户一开口就归零）
  this._guidePending = false;    // 引导请求已发出、还没等到回复
  this._guideStagePending = '';  // 本轮引导的分级（ask/angle/quote/light）
  this._guidesAsked = [];        // 本会话已问过的引导（只在本实例内，退出即清）
  this._quotesUsed = {};         // 本会话已用过的金句下标（退出即清）
  this._quotesUsedCount = 0;
  this._lastQuoteIdx = -1;
  this._guideDueAt = 0;
  this._guideRetryTimer = null;  // 引导被占用时的短重试（不重置整档到期时间）
  this._guideRetry = 0;          // 已短重试次数：超过上限才推进档位
  this._recorderBad = false;     // 录音实例异常（asr onStatus）：优先状态提示、跳过引导
  this._lastStatus = '';
  this._statusShownAt = 0;       // 状态提示去重时间戳
  this._hidden = false;          // 已切后台/锁屏（收音已停，回前台需重建实例）
  this._hiddenAt = 0;
  // 启动耗时标记（进入自由对话 → 真正开始录音）
  this._t0 = 0;
  this._markedAsr = false;
}

FreeTalk.prototype.start = function () {
  if (this._active) return;
  if (!api.getToken()) {
    this.onError(new Error('请先登录后再使用语音对话'));
    return;
  }
  this._active = true;
  this._t0 = Date.now();
  this._markedAsr = false;
  this._asrStarted = false;
  this._greetPending = false;
  this._greetDone = false;
  if (this._greetTimer) { clearTimeout(this._greetTimer); this._greetTimer = null; }
  console.log('[build]', env.BUILD_TAG, '| 自由对话开始');
  this._mark('进入自由对话（t0）');
  var self = this;

  // 播报事件的职责边界（只做这些，不产生新段）：
  //   playing：出队 + 上屏（与音频同一刻），不再往队列里加东西
  //   skip   ：该段没出声，只补这一段的文字（出队一次）
  //   end    ：把队列里剩下没出声的段补成文字，然后开尾窗；不再 new 段
  this._ttsOff = tts.addStateListener(function (state, extra) {
    if (!self._active) return;
    if (state === 'start') {
      // 播报一开始就停掉收音：不再依赖回声判据去猜「这句是不是自己说的」。
      // 代价：播报期间用户插话不会被识别（本轮已确认接受）。
      self._pauseAsr('播报开始');
      return;
    }
    if (state === 'playing') {
      self._pauseAsr('播报中');
      var seg = String((extra && extra.text) || '');
      if (seg) {
        self._rememberSpoken(seg);
        if (self._aiQueue.length) self._aiQueue.shift();
        // 字幕与播报同源：这一句开始出声的同一时刻，文字才追加到字幕区。
        // 上屏只在这里发生（唯一消费者），没有第二条写文字的路径。
        self._appendAiShown(seg);
        // 本轮耗时：首段真正出声 → 打一条分段摘要（之后不再重复打）
        if (self._turnT && !self._turnT.firstPlay) {
          self._turnT.firstPlay = Date.now();
          self._logTurnTiming();
        }
      }
      self._spokeThisReply = true;
      self._syncTurnState('播报中');
    } else if (state === 'skip') {
      // 该段音频拉取失败 / 上下文卡死被跳过：声音没有，但文字不能缺。
      // 出队一次 + 补字一次，同样不产生新段。
      var skipped = String((extra && extra.text) || '');
      if (skipped) {
        if (self._aiQueue.length) self._aiQueue.shift();
        self._appendAiShown(skipped, true);
      }
    } else if (state === 'end') {
      // 开场问候播完：预录窗口结束，此后所有播报都会暂停收音
      if (self._preRoll) {
        self._clearPreRoll();
        console.log('[ft] 问候语播报结束 | 此后播报将暂停收音 | +' + (Date.now() - self._t0) + 'ms');
      }
      // 播报被暂停/关闭时不一定会把队列播完：剩余段落的文字在这里补齐（只补字，不入队）
      self._flushAiQueue();
      // 播报结束（含音频拉取失败只回 end、没有 playing 的情况）一律回到聆听态；
      // 与网站 _speakFinish 口径一致：先开 400ms 尾窗，尾窗结束再开 2.5s 延迟回声窗
      self._lastSpeechEndAt = Date.now();
      self._tailUntil = Date.now() + TAIL_MS;
      var seq = ++self._speechSeq;
      if (self._tailTimer) clearTimeout(self._tailTimer);
      self._tailTimer = setTimeout(function () {
        self._tailTimer = null;
        if (!self._active || seq !== self._speechSeq) return;
        self._tailUntil = 0;
        self._postEchoUntil = Date.now() + POST_ECHO_MS;
        // ft-diag13：音频尾窗结束不代表轮到用户 —— 只有回复已 end 且队列空才切
        self._syncTurnState('音频尾窗结束');
      }, TAIL_MS + 20);
      // 只有「无 playing、无待播段、回复也收完了」才恢复收音
      self._maybeResumeAsr('播报队列空闲');
    }
  });

  this._channel = new AgentChannel({
    // DF-100：语音自由对话固定走 chat 档（flash），与网页端 createChannel({ scenario: 'chat' }) 一致。
    // 语音转写常超过后端 auto 判 deep 的 80 字阈值，不显式指定会被判成 deep（TTFT 数秒到十几秒）。
    // 只影响这一条通道的换票，不动其它业务请求的档位。
    scenario: 'chat',
    sessionId: self.sessionId,   // DF-104：续用 ensure 到的会话（连接时带 session_id 续传）
    onState: function (state, detail) {
      // 启动耗时分解：换票 → 建连 → session.ready（供真机日志核对空窗去向）
      if (state === 'ticketing') self._mark('换票请求');
      if (state === 'connecting') self._mark('WebSocket 建连');
      if (state === 'ready') {
        self._mark('session.ready');
        console.log('[ft] 通道就绪');
        // DF-104：session.ready 下发的 session_id 是权威值，透传回页面（channel 内部已同步）
        try { self.onReady(detail); } catch (e) { /* 忽略 */ }
        // 硬约束：ready 分支禁止清本轮计数（_replyDelta / _sawDelta / _segSeq 都不能动）。
        // assistant.end 在通道里是先 emit('ready') 再回调 onEnd 的，
        // 在 ready 里清计数会让 onEnd 误判「本轮没有 delta」，把整段回复再补播一遍
        // （真机症状：同一条回复的文字与音频各出现两遍）。
        self._chanBusy = false;
        self._clearReplyTimer();
        self._ensureAsr();
        if (!self._greeted) {
          self._greeted = true;
          self._resetAiShown();
          self._logAiSay(GREETING);
          // 问候语原文固定已知：排队时就登记进「已播文本表」，
          // 这样无论回声在它第几句开口时被识别到，都能整句精确命中。
          self._rememberSpoken(GREETING);
          if (self._asrStarted) {
            self._speakGreetingNow('asr-ready');
          } else {
            // ft-diag15：录音器 start 在途时不要开播（真机 -30001 的触发时序），
            // 等插件 onStart 再出声；最多等 1500ms，超时也要让用户听到问候。
            self._greetPending = true;
            console.log('[ft] 问候语待播 | 等插件 onStart 再出声，避免录音启动与音频焦点抢占 | 已等 =',
              (Date.now() - (self._t0 || Date.now())) + 'ms');
            self._greetTimer = setTimeout(function () {
              self._greetTimer = null;
              if (!self._active || !self._greetPending) return;
              console.warn('[ft] 问候语待播超时（1500ms 没等到 onStart）| 先出声，录音恢复后继续');
              self._speakGreetingNow('timeout');
            }, 1500);
          }
        }
        // 通道就绪本身不等于「轮到你说」：本轮 assistant 没 end 就继续维持生成中/她在说
        self._syncTurnState('通道就绪');
        return;
      }
      if (state === 'generating') {
        // 新一轮回复开始：解除打断后的静音，允许正常播报；记录里新起一条 AI 条目
        self._chanBusy = true;
        self._replyOpen = true;
        self._spokeThisReply = false;
        self._interruptedTurn = false;
        self._turnNo++;
        self._clearReplyTimer();
        self._muteDeltas = false;
        self._replyDelta = 0;
        self._sawDelta = false;
        self._resetAiShown();      // 字幕从这一轮第一句重新逐句出现
        self._logAiStart();
        // 一收到 assistant.start 就明确告诉用户「还在生成、没有声音」，别以为轮到自己
        self._syncTurnState('回复开始');
        return;
      }
      // 通道的 thinking 落在「已发出、还没开始吐字」区间：统一并入「生成中」，不再多一种文案
      if (state === 'thinking') { self._syncTurnState('通道 thinking'); return; }
      if (state === 'failed' || state === 'closed' || state === 'idle') {
        self._emitState(state);
        return;
      }
      self._emitState(state);
    },
    onDelta: function (delta) {
      if (self._muteDeltas) return;   // 打断后残留 delta：不续播
      self._replyDelta += 1;
      self._sawDelta = true;
      if (self._turnT && !self._turnT.firstDelta) self._turnT.firstDelta = Date.now();
      self._streamRaw += String(delta || '');
      self._logAiAppend(delta);
      self._buf += String(delta || '');
      self._drainBuffer(false);
    },
    onEnd: function (text) {
      self._chanBusy = false;
      self._replyOpen = false;   // 本轮 assistant 正式结束：此后才允许出现「轮到你说」
      self._clearReplyTimer();
      // 主动引导的这一轮：记入「已问过」，轮次 +1（下次间隔更长）
      if (self._guidePending) {
        var g = String(text || '').trim();
        self._guidePending = false;
        if (g) {
          self._rememberGuide(g);
          self._guideLevel++;
          console.log('[ft-guide] 引导回复到达 | stage =', self._guideStagePending || '-',
            '| len =', g.length,
            '| 已问过 =', self._guidesAsked.length, '| 下一轮间隔 =',
            self._guideDelay(self._guideLevel) + 'ms');
        } else {
          console.warn('[ft-guide] 引导回复为空 → 本轮不说话');
          self._silenceSince = Date.now();
          self._armSilence();
        }
      }
      if (self._muteDeltas) {         // 被用户打断的这一轮：不补播整段
        self._muteDeltas = false;
        self._replyDelta = 0;
        self._sawDelta = false;
        self._buf = '';
        self._logAiFinal('');
        return;
      }
      // 只有「本轮一个 delta 都没收到」才整段补播。
      // 这里用本轮独立的 _sawDelta 判断：状态事件（ready/generating）不会清它，
      // 避免 assistant.end 先 emit('ready') 导致的「整段回复被再播一遍」。
      var hadDelta = self._sawDelta;
      if (!hadDelta && text) {
        console.log('[ft-diag] 整段补播 | reply =', self._replySeq, '| 原因 = 本轮无 delta | len =', String(text).length);
        self._buf += String(text);
      } else if (text) {
        console.log('[ft-diag] 整段补播判定 | reply =', self._replySeq, '| 跳过 | 本轮 delta =',
          self._replyDelta, '| final len =', String(text).length);
      }
      self._replyDelta = 0;
      self._sawDelta = false;
      self._logAiFinal(text);
      self._drainBuffer(true);
      // 一条日志证明「一轮只有一条交付链」：段数、seq 是否连续、字数是否对齐。
      // seq 一定从 1 连到 N（唯一分配器）；continuous=no 或 alarm>0 才说明存在第二个生产者。
      var replyLen = String(text || '').length;
      console.log('[ft-diag] 本轮交付链 | reply =', self._replySeq,
        '| seq = 1..' + self._segCount,
        '| 连续 =', (self._seqAlarm || self._segSeq !== self._segCount) ? 'no' : 'yes',
        '| 段数 =', self._segCount,
        '| 交付字数 =', self._segChars, '| 回复字数 =', replyLen,
        '| 字数差 =', replyLen - self._segChars,
        '| 结构告警 =', self._seqAlarm,
        '| 已上屏段 =', self._aiShownSegs, '| 待播段 =', self._aiQueue.length);
      // 内容级校验：字数差只说明「少了几个字符」，这里证明少的是不是只有标点/空白。
      // 对照基准要与实际交付同源：有 delta 时用本轮 delta 累积（end 的整段可能比流式多出未下发的尾字，
      // 拿它比会把正常情况误报成丢失）；没有 delta 时用整段补播的 final。
      // 两边都做同一套归一化（去标点、空白、大小写）后比较，差 0 即「无内容丢失」。
      var expectRaw = hadDelta ? self._streamRaw : String(text || '');
      var replyNorm = norm(expectRaw);
      var deliveredNorm = norm(self._deliveredRaw);
      var contentDiff = replyNorm.length - deliveredNorm.length;
      console.log('[ft-diag] 交付内容校验 | 基准 =', hadDelta ? 'delta 累积' : 'final 整段',
        '| 基准字数 =', String(expectRaw).length, '| 基准规范字数 =', replyNorm.length,
        '| 交付规范字数 =', deliveredNorm.length,
        '| 内容差 =', contentDiff,
        '| 结论 =', contentDiff === 0
          ? '字数差仅来自切句标点与空白，无内容丢失'
          : '有内容未交付，请查 _buf 收尾与 _sayCut');
      if (contentDiff !== 0) {
        console.error('[ft-alarm] 交付内容缺失 | reply =', self._replySeq,
          '| 缺 =', contentDiff, '字 | 回复尾部 =', replyNorm.slice(-40),
          '| 已交付尾部 =', deliveredNorm.slice(-40));
      }
      // 本轮耗时兜底：若音频一直没起来，也要有一条能看出瓶颈在哪的日志
      self._logTurnTiming();
      // 音频可能比回复流更早结束（'end' 已到但那时 _chanBusy 还是 true）：
      // 这里补一次「队列空闲则恢复收音」，否则麦克风会一直停到兜底超时。
      self._maybeResumeAsr('回复结束');
      // 回复已 end：若音频也播完、收音已恢复，这一刻才切「轮到你说」
      self._syncTurnState('回复结束');
    },
    onInterrupted: function () {
      // 服务端确认打断：丢弃未播内容，静音在途 delta，不自动续播
      self._chanBusy = false;
      self._replyOpen = false;
      self._interruptedTurn = true;   // 本轮由用户插话结束：不提示「可以开始说话了」
      self._clearReplyTimer();
      self._muteDeltas = true;
      self._resetSpeech();
      self._logAiFinal('');
      self._maybeResumeAsr('打断确认');
      // 打断 = 队列已清、回复已停：立即切「轮到你说」，但按用户要求不提示「可以开始说话了」
      self._syncTurnState('打断确认');
    },
    onNotice: function (n) {
      // DF-72：DEEP_DRAFT 不带 message（带 draft/cards），不能按「无 message 丢弃」处理
      if (!n || (!n.message && n.code !== 'DEEP_DRAFT')) return;
      try { self.onNotice(n); } catch (e) { /* 忽略 */ }
    },
    onError: function (e, detail) {
      try { self.onError(e, detail); } catch (err) { /* 忽略 */ }
    },
    onClientEventAck: function (data) {
      try { self.onClientEventAck(data); } catch (err) { /* 忽略 */ }
    },
    onUserText: function () { /* 通道回显由本地先展示，避免重复 */ }
  });

  // 真机排查结论：连续识别此前只在通道 session.ready 之后才启动，
  // 换票/握手/ready 任一环失败都会表现为「完全听不到、无文字、无回复」。
  // 现在把识别放到最前面：换票与建连在后台并行，识别不必等通道。
  this._ensureAsr();
  this._channel.start();
  // 静默计时不依赖 ASR 事件：进入对话就开始算。
  // 否则录音器一起不来（record manager failed）就永远不会有 onStart，引导也永远不会触发。
  this._silenceSince = Date.now();
  this._armSilence();
};

/**
 * 切后台 / 锁屏：收音必须停（后台录音一定失败），通道保留（无需重新换票）。
 * 与 onUnload 不同：这里不退出自由对话，回前台接着聊。
 */
FreeTalk.prototype.handleHide = function (where) {
  if (!this._active) return;
  this._hidden = true;
  this._hiddenAt = Date.now();
  this._clearSilence();          // 后台不累计静默，回前台重新计时
  this._setCountdown(-1);
  this._clearPauseGuard();
  try { asr.suspendForBackground(where || 'onHide'); } catch (e) { /* 忽略 */ }
  console.log('[ft-diag] 生命周期 | onHide | 收音已停 | 通道保留 =',
    (this._channel && this._channel.isActive && this._channel.isActive()) ? 'yes' : 'no',
    '| 引导计时 = 暂停 | 说明 = 回前台强制重建录音实例');
};

/**
 * 回到前台：丢弃旧录音实例并重建，再恢复连续识别与通道。
 * 锁屏/切后台后录音句柄会被系统回收，沿用旧实例只会一直 record manager failed。
 */
FreeTalk.prototype.handleShow = function (where) {
  if (!this._active || !this._hidden) return;
  var away = Date.now() - this._hiddenAt;
  this._hidden = false;
  this._hiddenAt = 0;
  this._recorderBad = false;
  this._asrPaused = false;         // 后台可能停在「播报暂停」，回前台按未暂停处理
  this._segLock = '';
  this._segLen = 0;
  this._silenceSince = Date.now(); // 静默从回前台重新算，避免一回来就被引导
  this._guideLevel = 0;
  this._guideRetry = 0;
  console.log('[ft-diag] 生命周期 | onShow | 回到前台 | 后台时长 =', (away / 1000).toFixed(1) + 's',
    '| 处理 = 重建录音实例 + 检查通道');
  this._ensureAsr({ fresh: true, freshReason: '回前台重建' });
  var ch = this._channel;
  if (ch && ch.isActive && ch.isActive()) {
    console.log('[ft-diag] 生命周期 | onShow | 通道仍在，保留（无需换票）');
  } else {
    console.warn('[ft-diag] 生命周期 | onShow | 通道已断 → 重新换票连接');
    if (ch) { try { ch.start(); } catch (e) { /* 忽略 */ } }
  }
  // 回前台给一句轻状态（文字区），不额外播报，避免打断用户第一句话
  this._notifyStatus('已回到对话，继续说吧');
  this._armSilence();
};

/**
 * 启动耗时打点：所有点都相对 t0（进入自由对话）计时，
 * 真机日志里从 `进入自由对话` 到 `录音真正开始` 之间每条 `[ft-timing]` 就是空窗的去处。
 */
FreeTalk.prototype._mark = function (label) {
  if (!this._t0) return;
  console.log('[ft-timing]', label, '| +' + (Date.now() - this._t0) + 'ms');
};

/** 连续识别：一段说完自动续录（ready 会多次回调，只开启一次；启动异常允许下次重试） */
FreeTalk.prototype._ensureAsr = function (opts) {
  opts = opts || {};
  if (this._asrOn && !opts.fresh) return;
  this._asrOn = true;
  var self = this;
  if (opts.fresh) {
    console.warn('[asr-diag] 生命周期 | onShow | 恢复连续识别 | 强制重建实例 = yes',
      '| 后台时长 =', ((Date.now() - (this._hiddenAt || Date.now())) / 1000).toFixed(1) + 's');
  }
  console.log('[ft] 启动连续识别 | plugin mode =', asr.mode(), '| reason =', asr.reason());
  try {
    asr.startContinuous({
      freshManager: !!opts.fresh,
      freshReason: opts.freshReason || '回前台重建',
      // 录音实例异常（如 record manager record failed）：写用户文字区 + 暂停引导
      onStatus: function (text) {
        self._recorderBad = true;
        console.warn('[ft-diag] 录音实例异常 |', text, '| 处理 = 提示用户 + 跳过引导');
        self._notifyStatus(text);
      },
      // 上层播报状态：录音器启动失败重试时，若正在播报就先等播报结束再抢麦
      // （真机：播报期 start 更容易 -30001，且会让重试一直失败）
      isPlaybackActive: function () {
        // 只看「真的有声音/有排队待播」，不含问候的 8s 预录尾窗，否则会把重试挡掉太久
        try { return !!(self._speaking() || tts.isPlaying()); } catch (e) { return false; }
      },
      onStart: function () {
        console.log('[ft] asr onStart');
        self._asrStarted = true;
        // 问候语在等录音器真正起来：现在才出声，避免 start 在途时被 TTS 抢音频焦点
        if (self._greetPending) self._speakGreetingNow('onStart');
        if (!self._markedAsr) {
          self._markedAsr = true;
          // 只在首段打一次：进入自由对话 → 真正开始录音的总耗时
          self._mark('录音真正开始（插件 onStart）');
        }
        self._segStartAt = Date.now();
        // 新一段识别开始：等第一段文字到达时清掉上一轮已定稿的用户文字（换轮清空）
        self._segFresh = true;
        // 段锁随新段复位：回声判定每段只做一次，不在段内反复重判
        self._segLock = '';
        self._segLen = 0;
        // 用户行「同段只写一次」的批次号也随段递增
        self._uiSegNo++;
        self._uiText = '';
        self._uiFinal = false;
        // 注意：这里不能调 _restartSilence()。插件每次停/开（含空段自然重启）都会 onStart，
        // 一旦在 onStart 里把 _silenceSince 归零，沉默永远攒不到 60s，引导语就永远不触发。
        // 这里只保证静默计时器在跑；起点仍由真正的用户语音（partial/final）重置。
        self._armSilence();
      },
      onStartTimeout: function () {
        if (!self._active) return;
        // 模拟器/开发者工具不会真正录音：必须显式提示，不能静默无反应
        self.onNotice({
          code: 'ASR_NO_START',
          level: 'warn',
          message: '录音未启动：开发者工具不支持同声传译，请用真机预览'
        });
      },
      onPartial: function (text) {
        if (!self._active) return;
        var t = String(text || '').trim();
        if (!t) return;
        var n = self._diagPartial = (self._diagPartial || 0) + 1;
        var show = n <= 3 || n % 10 === 0;
        // 主防线：播报期间录音已暂停，这期间到达的任何结果都是扬声器回录（或暂停失败），直接丢弃
        if (self._asrPaused) {
          if (show) console.log('[ft-diag] partial#' + n, '| len =', t.length, '| 播报暂停期丢弃');
          return;
        }
        // 噪音闸门：静音时插件会吐 1 个字（幻听/环境音），不足 MIN_VOICE_CHARS 视为无输入，
        // 不上屏、不重置静默计时，也不产生「用户说了话」的事件
        if (norm(t).length < MIN_VOICE_CHARS) {
          console.log('[ft-diag] partial#' + n, '| len =', t.length, '| 有效字数 =', norm(t).length,
            '| 判为噪音，不上屏');
          return;
        }
        if (self._recorderBad) {
          // 有真实识别结果 = 录音链路已经恢复，后续静默重新允许引导
          self._recorderBad = false;
          console.log('[ft-diag] 录音器已恢复 | 有效 partial #' + n, '| len =', t.length);
        }
        // 判回录只发生在「正在播 / 刚播完的短窗口」内；窗口外用户复述 AI 原话必须放行
        var suspect = self._speaking() || Date.now() < self._postEchoUntil
          || (self._segStartAt && self._segStartAt <= self._lastSpeechEndAt);
        var chk = self._echoCheck(t, suspect);
        // 精确匹配优先级最高（已播文本是已知的，不用猜）；命中整段 → 丢，
        // 命中且带用户新内容 → 裁掉回声部分后保留，并把段锁直接定为 show（确定性裁决，不再让兜底判据二次误杀）。
        if (chk.lane === 'exact') {
          if (chk.echo) {
            self._segLock = 'mute';
            console.log('[ft-echo] 精确命中 → 丢弃 | 来源 = partial | rule =', chk.rule,
              '| len =', t.length, '| 段锁 = mute');
            return;
          }
          if (chk.rest) {
            console.log('[ft-echo] 精确命中 → 裁剪保留新内容 | 来源 = partial | rule =', chk.rule,
              '| 原 =', t, '| 保留 =', chk.rest);
            t = chk.rest;
            self._segLock = 'show';
            self._segLen = t.length;
            self._restartSilence();
            self._resetGuideLevel();
            self._logUser(t, false);
            return;
          }
        }
        self._restartSilence();
        self._resetGuideLevel();
        // 段锁：回声判定每段只做一次。
        // 真机证据：同一段（seg = 1）前 3 个 partial 已正常上屏，第 10 个（len 20）被相似度误判后，
        // 之后更长的 partial 全部被吞，而整段没有 final —— 文字就彻底空白。
        // 一旦本段确认是用户真实语音，后续 partial 一律直接上屏，不再重新判回声。
        if (self._segLock === 'mute') {
          if (show) console.log('[ft-diag] partial#' + n, '| len =', t.length, '| 段锁 = mute（本段静默）');
          return;
        }
        if (self._segLock === 'show') {
          // 长度单调增长 = 同一句话在继续，直接上屏，不再走相似度
          var grew = t.length - self._segLen;
          self._segLen = t.length;
          if (show) console.log('[ft-diag] partial#' + n, '| len =', t.length, '(+' + grew + ')',
            '| 段锁 = show → 上屏');
          self._logUser(t, false);
          return;
        }
        if (chk.echo) {
          // ft-diag14：模糊命中只丢这一条 partial，不再把整段锁成 mute。
          // 真机反馈「AI 刚说完后我开口，前半句被吞、也没有倒计时」：
          // 旧实现在 1.1s 尾窗里用相似度命中一次就整段静默，后面的 partial 全部被吞，
          // 用户文字区一直空着，倒计时闸门（无可见文本）也随之不显示。
          // 现在只丢这一条，下一条更长的 partial 会重新判定；真是回录就继续逐条丢弃。
          console.log('[ft-echo] 相似度兜底 → 仅丢这一条 partial（不锁段）| rule =', chk.rule,
            '| len =', t.length, '| 下一条重新判定');
          return;
        }
        if (suspect && show) {
          console.log('[ft-echo] 新内容 → 放行 | 来源 = partial | len =', t.length, '| 窗口内但未命中已播文本');
        }
        self._segLock = 'show';
        self._segLen = t.length;
        console.log('[ft] 段锁定 | lock = show（本段后续 partial 直接上屏）| len =', t.length);
        self._logUser(t, false);
      },
      onCountdown: function (remain, total) {
        if (!self._active) return;
        self._setCountdown(remain, total);
      },
      onFinal: function (text, meta) {
        self._onAsrFinal(text, meta);
      },
      onError: function (e, fatal) {
        if (!self._active) return;
        var msg = (e && e.message) || '语音识别出错';
        // 区分「录音器没起来」和「用户这句话没识别好」：前者不是用户的错，
        // 不能把插件的 record manager 原文直接甩给用户（真机反馈「一进来就报录音识别出错」）。
        var startFail = /record manager|record failed|record fail|-30001|录音失败|启动录音/i.test(msg);
        console.warn('[ft] asr error | fatal =', !!fatal,
          '| 播报中 =', (self._speaking() || tts.isPlaying()) ? 'yes' : 'no',
          '| 类型 =', startFail ? '录音器启动失败' : '识别错误',
          '|', msg);
        self.onNotice({
          code: 'ASR_ERROR',
          level: 'warn',
          message: startFail ? '麦克风启动失败，正在自动重试' : ('语音识别异常：' + msg)
        });
        if (fatal) {
          // 权限/授权类错误：停止重试，但保留对话面板让用户看到提示后自行退出
          self._asrOn = false;
          try { asr.stopContinuous(); } catch (err) { /* 忽略 */ }
        }
      }
    });
  } catch (e) {
    // 插件未就绪等启动异常不能静默：复位标记，下一次 ready 或通道重连时再试
    this._asrOn = false;
    console.error('[ft] 连续识别启动失败', e);
  }
};

/**
 * 真正开始播问候语。调用前必须满足：录音器已 onStart（或等待超时）。
 * 开场问候是「预录」而不是回复：不暂停收音，问候期间用户开口仍走插话截断。
 */
FreeTalk.prototype._speakGreetingNow = function (why) {
  if (!this._active || this._greetDone) return;
  this._greetDone = true;
  this._greetPending = false;
  if (this._greetTimer) { clearTimeout(this._greetTimer); this._greetTimer = null; }
  this._mark('问候语播报');
  this._clearPreRoll();
  this._preRoll = true;
  this._preRollTimer = setTimeout(function () {
    this._preRollTimer = null;
    this._preRoll = false;
    console.log('[ft] 问候语预录窗口结束（兜底）');
  }.bind(this), 8000);
  console.log('[ft] 问候语开播 | 触发 =', why, '| 录音已起 =', this._asrStarted ? 'yes' : 'no',
    '| 预录 = yes（问候期间不暂停收音）');
  this._speakText(GREETING);
};

FreeTalk.prototype._onAsrFinal = function (text, meta) {
  if (!this._active) return;
  var t = String(text || '').trim();
  console.log('[ft] asr final | len =', t.length);
  // 录音侧时间戳（停口/stop/onStop）先挂起来，真正送出时建本轮耗时桶
  if (meta) this._asrMeta = meta;
  if (!t) { this._dropInterim(); return; }
  // 播报暂停期到达的 final 一定是被暂停截断的那一段（扬声器回录），整段丢弃
  if (this._asrPaused) {
    console.log('[ft] 播报暂停期 final 丢弃 | len =', t.length);
    this._dropInterim();
    return;
  }
  // 噪音闸门：与 partial 同口径，空段/1 字不算用户输入
  if (norm(t).length < MIN_VOICE_CHARS) {
    console.log('[ft-diag] final 有效字数 =', norm(t).length, '<', MIN_VOICE_CHARS, '| 判为噪音，不上屏不发送');
    this._dropInterim();
    return;
  }
  var now = Date.now();
  // 本轮识别段的起始时刻：WechatSI 的 onStop 可能晚于播报结束才返回，
  // 只要这段录音起于播报期间，final 就按「疑似回录」走回声判定（不受短窗口限制）。
  var segStartedAt = this._segStartAt;
  this._segStartAt = 0;
  var segDuringSpeech = !!segStartedAt && segStartedAt <= this._lastSpeechEndAt;
  var echoSuspect = this._speaking() || now < this._postEchoUntil || segDuringSpeech;
  // 判据顺序：① 精确匹配（已播文本表，确定性）→ ② 段锁（同段内不重复判）→ ③ 相似度兜底。
  // 命中精确匹配时连「不上屏、不发送、不计静默」一起生效，所以放在静默计时之前。
  var lock = this._segLock;
  var chk = this._echoCheck(t, echoSuspect);
  if (chk.lane === 'exact') {
    this._segLock = '';
    if (chk.echo) {
      console.log('[ft-echo] 精确命中 → 丢弃 | 来源 = final | rule =', chk.rule,
        '| len =', t.length, '| 不上屏/不发送/不计静默');
      this._dropInterim();
      return;
    }
    if (chk.rest) {
      // 一句里既有已播片段又有用户新内容：裁掉回声部分，只把用户那部分发出去
      console.log('[ft-echo] 精确命中 → 裁剪保留新内容 | 来源 = final | rule =', chk.rule,
        '| 原 =', t, '| 保留 =', chk.rest);
      t = chk.rest;
      lock = 'show';   // 确定性裁决覆盖段锁，不再走兜底判据
    }
  }
  this._segLock = '';
  this._restartSilence();
  this._resetGuideLevel();
  if (lock === 'mute') {
    console.log('[ft] 段锁 = mute，final 丢弃 | len =', t.length);
    this._dropInterim();
    return;
  }
  // 兜底：相似度/覆盖率/公共片段。只在精确匹配没命中时使用，避免两套判据重复裁决。
  if (lock !== 'show' && chk.echo && chk.lane === 'fuzzy') {
    console.log('[ft-echo] 相似度兜底 → 丢弃 | 来源 = final | rule =', chk.rule,
      '| 从严 =', echoSuspect ? 'yes' : 'no', '| len =', t.length);
    this._dropInterim();
    return;
  }
  if (lock !== 'show' && !chk.lane) {
    console.log(echoSuspect
      ? '[ft-echo] 新内容 → 放行 | 来源 = final | len = ' + t.length + ' | 窗口内但未命中已播文本'
      : '[ft-echo] 窗口外 → 放行（不判回录）| 来源 = final | len = ' + t.length);
  }
  if (lock === 'show') console.log('[ft] 段锁 = show，final 直接发送 | len =', t.length);
  // DF-103：发送前统一按 200 字截断（超出部分不再接收），保证实际送出长度与分档口径一致
  var capped = asr.truncateEff(t, 200);
  if (capped.length !== t.length) console.log('[ft] final 超 200 字 → 截断 | 原 =', t.length, '| 截断后 =', capped.length);
  t = capped;
  if (t === this._lastFinal && now - this._lastFinalAt < 1200) {
    // 重复定稿：已显示过就不再重复发送/重复建轮
    var cur = this._curId ? this._findLog(this._curId) : null;
    if (!cur || cur.user !== t) this._logUser(t, true);
    return;
  }
  this._lastFinal = t;
  this._lastFinalAt = now;

  // 播报期间（含 400ms 尾窗）：已排除回声，其余一律按「用户插话」处理。
  // 播报暂停收音后，尾窗内到达的定稿基本是「恢复收音后用户马上开口」的开头，
  // 不能再按回录丢掉 —— 那正是用户说的「开头那段话被切掉」。
  if (this._speaking()) {
    if (norm(t).length >= ECHO_MIN) { this._bargeIn(t); return; }
    this._dropInterim();
    return;
  }
  this._sendUser(t);
};

FreeTalk.prototype._speaking = function () {
  return tts.isPlaying() || Date.now() < this._tailUntil;
};

/* ---------------- 播报期间暂停收音（主防线） ---------------- */

/** 播报开始：停掉收音。回声判据仍保留，只用于恢复瞬间的兜底 */
FreeTalk.prototype._pauseAsr = function (reason) {
  if (!this._active || this._asrPaused) return;
  // 开场问候是预录欢迎语：不暂停收音，否则用户进入后的第一句话会被整段吃掉
  if (this._preRoll) {
    console.log('[ft] 收音保持 | 问候语预录期，不暂停 | +' + (Date.now() - this._t0) + 'ms');
    return;
  }
  this._asrPaused = true;
  this._clearSilence();
  this._setCountdown(-1);   // 播报开始：录音侧的发送倒计时立即撤掉
  var ok = false;
  try { ok = asr.pauseContinuous(reason); } catch (e) { ok = false; }
  // 暂停瞬间还在识别的半句属于播报回录，清掉不留残影
  this._dropInterim();
  this._segLock = '';
  console.log('[ft] 收音暂停 | reason =', reason || '-', '| 插件已停 =', ok ? 'yes' : 'no',
    '| 待播段 =', this._aiQueue.length, '| +' + (Date.now() - this._t0) + 'ms');
  this._armPauseGuard();
};

/** 恢复收音：只有播报队列彻底空闲（无 playing、无待播段）且回复已收完才叫用 */
FreeTalk.prototype._maybeResumeAsr = function (reason) {
  if (!this._active || !this._asrPaused) return;
  if (tts.isPlaying() || this._aiQueue.length) return;   // 还有音频或待播段
  if (this._chanBusy) return;                            // 回复还在流，下一段音频随时会来
  this._resumeAsr(reason);
};

FreeTalk.prototype._resumeAsr = function (reason) {
  if (!this._active || !this._asrPaused) return;
  this._asrPaused = false;
  this._clearPauseGuard();
  this._setCountdown(-1);   // 恢复瞬间不该残留上一段的倒计时
  this._segLock = '';
  this._segLen = 0;
  // 兜底：恢复瞬间扬声器尾音可能被刚打开的话筒收进去，这一小段仍按从严判回声
  this._postEchoUntil = Date.now() + RESUME_ECHO_MS;
  var ok = false;
  try { ok = asr.resumeContinuous(reason); } catch (e) { ok = false; }
  console.log('[ft] 收音恢复 | reason =', reason || '-', '| 插件已重开 =', ok ? 'yes' : 'no',
    '| 音频播放中 =', tts.isPlaying() ? 'yes' : 'no', '| 待播段 =', this._aiQueue.length,
    '| +' + (Date.now() - this._t0) + 'ms');
  this._restartSilence();
};

/** 暂停兜底：回复卡死/通道无回应时，不能让麦克风永久关闭 */
FreeTalk.prototype._armPauseGuard = function () {
  var self = this;
  this._clearPauseGuard();
  this._pauseGuardTimer = setTimeout(function () {
    self._pauseGuardTimer = null;
    if (!self._active || !self._asrPaused) return;
    if (tts.isPlaying() || self._aiQueue.length) {
      console.warn('[ft-diag] 收音暂停超过', ASR_PAUSE_MAX_MS / 1000, 's 但音频仍在播，继续等待');
      self._armPauseGuard();
      return;
    }
    console.warn('[ft-diag] 收音暂停超过', ASR_PAUSE_MAX_MS / 1000, 's 且音频空闲，强制恢复收音');
    self._resumeAsr('暂停超时兜底');
  }, ASR_PAUSE_MAX_MS);
};

FreeTalk.prototype._clearPauseGuard = function () {
  if (this._pauseGuardTimer) { clearTimeout(this._pauseGuardTimer); this._pauseGuardTimer = null; }
};

/** 结束问候语预录窗口（问候播完 / 被插话 / 超时兜底） */
FreeTalk.prototype._clearPreRoll = function () {
  if (this._preRollTimer) { clearTimeout(this._preRollTimer); this._preRollTimer = null; }
  this._preRoll = false;
};

/* ---------------- 长静默检测 + 主动引导（模型现说） ---------------- */

/** 本轮耗时摘要：一眼看出等待花在录音侧还是回复侧（首播到达时自动打一次） */
FreeTalk.prototype._logTurnTiming = function () {
  var t = this._turnT;
  if (!t || t.printedFull) return;
  // 首播还没到就先不打：否则「首delta→首播 / 总计」只能是短横线，看不出瓶颈。
  // 留一个 3s 兜底，真没有播放回调（TTS 失败/整段被跳过）时再打一条「未起播」并写明原因；
  // 之后若音频终于起来，还会再补一条完整值的日志（两条都有明确标注，不会互相覆盖）。
  if (!t.firstPlay && !t.playWaitTried) {
    if (!t.waitTimer) {
      var self = this;
      t.waitTimer = setTimeout(function () {
        t.waitTimer = 0;
        t.playWaitTried = true;          // 只等一次
        if (self._turnT !== t) return;   // 已经换轮：这条属于上一轮，作废
        self._logTurnTiming();
      }, 3000);
    }
    return;
  }
  var noPlay = !t.firstPlay;
  if (noPlay && t.printed) return;       // 「未起播」只打一次
  if (noPlay) t.printed = true;
  else t.printedFull = true;
  if (t.waitTimer) { clearTimeout(t.waitTimer); t.waitTimer = 0; }
  var d = function (a, b) { return (a && b) ? Math.max(0, b - a) + 'ms' : ''; };
  // 停口→stop：只有「我们主动 stop」才有确切时刻。
  // 插件自动收尾 / 20s 兜底 都没有主动 stop 的时刻，这里写明来源与停口→final，
  // 绝不用 0 冒充一个不存在的时刻。
  var stopToStop, stopToFinal, stopNote;
  if (t.stopAt) {
    stopToStop = d(t.lastPartial, t.stopAt) || '无停口时刻（空段/静音）';
    stopToFinal = d(t.stopAt, t.finalAt) || '未收到 onStop';
    stopNote = t.stopBy || 'manual';
  } else {
    var by = t.stopBy || 'plugin';
    stopToStop = t.lastPartial
      ? '无主动 stop（' + by + '，停口→final = ' + (d(t.lastPartial, t.finalAt) || '未知') + '）'
      : '无停口时刻（空段/静音）';
    stopToFinal = '无主动 stop（' + by + ' 自动收尾）';
    stopNote = by + '(自动收尾)';
  }
  var total = (t.lastPartial && t.firstPlay) ? (t.firstPlay - t.lastPartial) + 'ms'
    : (t.firstPlay ? '无停口时刻（空段/静音）' : '音频未起播（无 playing 回调）');
  console.log('[ft-timing] 本轮耗时 | 停口→stop =', stopToStop,
    '| stop→final =', stopToFinal,
    '| final→送出 =', d(t.finalAt, t.sentAt) || '未送出',
    '| 送出→首delta =', d(t.sentAt, t.firstDelta) || (t.sentAt ? '本轮无 delta（整段补播）' : '未送出'),
    '| 首delta→首播 =', noPlay ? '未起播（无 playing 回调：TTS 未出声）'
      : (d(t.firstDelta, t.firstPlay) || '无 delta（直接首播）'),
    '| 总计 =', total,
    '| 收尾 =', stopNote,
    '| 窗口 =', (t.stallMs || 0) + 'ms');
};

/**
 * 倒计时可见性闸门：只有「本段确实有将被发送的可见文本」才允许出现倒计时。
 * 逐条判据（任一不满足即不显示）：
 *   1) 通道在跑、收音未暂停；
 *   2) 本段没有被判为回声（_segLock !== 'mute'）—— 回声段的文字不会发送；
 *   3) 用户文字区当前有 ≥ MIN_VOICE_CHARS 的有效文本，且本段还没定稿。
 * 这只是显示层闸门：不改停滞计时、不改上屏、不改交付，也不丢弃任何内容。
 * ft-diag14：模糊回声不再锁段，所以第 2 条实际只会因为「精确命中已播文本」触发，
 * 不会再出现「用户真在说话、文字区空着、倒计时也不显示」的三重误判。
 * @param {{reason:string}} why 出参：不满足时写入原因（给日志用）
 */
FreeTalk.prototype._countdownEligible = function (why) {
  var put = function (msg) { if (why) why.reason = msg; return false; };
  if (!this._active) return put('通道未激活');
  if (this._asrPaused) return put('播报暂停期收音已停');
  if (this._segLock === 'mute') return put('整段判为回声（段锁 = mute）');
  if (this._uiFinal) return put('本段已定稿，等待发送（不再倒数）');
  var vis = norm(this._uiText || '');
  if (vis.length < MIN_VOICE_CHARS) {
    return put('无有效可见文本（有效字数 = ' + vis.length + ' < ' + MIN_VOICE_CHARS + '）');
  }
  return true;
};

/**
 * 发送倒计时（显示在用户文字区，不新增控件）。
 * remain < 0  = 用户又开口/被暂停 → 撤掉
 * remain == 0 = 到点 → 撤掉（随后 final 会送出）
 * remain > 0  = 显示「分档文案 + 剩余秒数」，0.5s 粒度，档位一眼可辨
 *
 * ft-diag16 显示层口径：保留 0.5s 粒度，但**显示与 stop 绑定同一个到期时刻**（asr 侧的
 * contStallAt + contStallWindow），数字走到 0 才允许发送；提前收尾时 asr 会先补一次 0，
 * 界面不会停在「还剩 1.5」直接跳成消息。文案按新分档（5/6/7/9/10s）分三组：
 *   5~6s →「快发…」  6~9s →「即将发送…」  ≥9s →「等你想完…」
 * 闸门不变：没有「看得见、且确实会被发送」的文本时，绝不启动倒计时，也绝不反复重绘。
 */
FreeTalk.prototype._setCountdown = function (remain, total) {
  if (remain < 0 || remain === 0) {
    if (this._countdownOn || this._hintOn) {
      this._countdownOn = false;
      this._hintOn = false;
      this._countText = '';
      console.log('[ft-diag] 倒计时撤销 |', remain < 0 ? '用户继续说话/收音暂停' : '已到点，等待发送');
      try { this.onCountdown(''); } catch (e) { /* 忽略 */ }
    }
    this._countBlocked = false;
    this._countBlockReason = '';
    return;
  }
  var why = { reason: '' };
  if (!this._countdownEligible(why)) {
    if (this._countdownOn) {
      // 两侧状态不一致（例如本段刚被判为回声）：把界面上的小字撤掉
      this._countdownOn = false;
      this._countText = '';
      try { this.onCountdown(''); } catch (e) { /* 忽略 */ }
    }
    // 拦截日志：同一原因只打一条；原因变化立刻再打，真机可据此定位是哪一条挡住倒计时
    if (!this._countBlocked || this._countBlockReason !== why.reason) {
      this._countBlocked = true;
      this._countBlockReason = why.reason;
      console.log('[ft-diag] 倒计时不显示 | 原因 =', why.reason,
        '| 剩余 =', remain + 'ms', '| 段锁 =', this._segLock || '未决',
        '| 本段已定稿 =', this._uiFinal ? 'yes' : 'no',
        '| 可见字数 =', norm(this._uiText || '').length,
        '| 说明 = 无可见文本/回声段不启动倒计时');
    }
    return;
  }
  this._countBlocked = false;
  this._countBlockReason = '';
  this._hintOn = false;   // 倒数接管小字位（「可以开始说话了」让位）
  var totalMs = total || 0;
  // 0.5s 粒度：短档 1、中档 1.5/2、长档 3/4/5，任何两档的起始数字都不同
  var sec = Math.max(0.5, Math.ceil(remain / 500) / 2);
  var secStr = sec % 1 === 0 ? String(sec) : sec.toFixed(1);
  // ft-diag16：分档已改为 5/6/7/9/10s，文案阈值同步按新档位重排（否则 5~10s 全落进同一档）
  var tag = totalMs >= 9000 ? '等你想完…' : (totalMs >= 6000 ? '即将发送…' : '快发…');
  var s = tag + secStr;
  this._countdownOn = true;
  if (s === this._countText) return;
  this._countText = s;
  console.log('[ft-diag] 发送倒计时 | 剩余 =', remain + 'ms', '| 阈值 =', totalMs + 'ms',
    '| 档位文案 =', tag, '| 显示 =', s);
  try { this.onCountdown(s); } catch (e) { /* 忽略 */ }
};

/** 收到有效语音（≥ MIN_VOICE_CHARS）就重新计时，并把引导轮次归零 */
FreeTalk.prototype._restartSilence = function () {
  if (!this._active) return;
  this._silenceSince = Date.now();
  this._armSilence();
};

/** 用户一开口：本会话已问过的引导仍保留（避免重复问），但沉默轮次清零 */
FreeTalk.prototype._resetGuideLevel = function () {
  this._guideLevel = 0;
  this._guideDueAt = 0;
};

/**
 * 排静默计时：到期时刻 = 沉默起点 + 本档间隔（绝对时间）。
 * ft-diag12 关键修复：旧实现每收到一次 onStart（含插件空段重启）就 setTimeout(整档 delay)，
 * 60s 的期限被无限推后 —— 真机 8 分钟一条引导日志都没有，根因就在这里。
 * 现在只按「剩余时间」排，任何 onStart / 空段重启都不会推迟到期时刻。
 */
FreeTalk.prototype._armSilence = function () {
  var self = this;
  this._clearSilence();
  if (!this._active) return;
  if (!this._silenceSince) this._silenceSince = Date.now();
  this._silenceOn = true;
  var delay = this._guideDelay(this._guideLevel);
  this._guideDueAt = this._silenceSince + delay;
  var remain = Math.max(0, this._guideDueAt - Date.now());
  this._silenceTimer = setTimeout(function () {
    self._silenceTimer = null;
    self._onSilenceDue();
  }, remain);
};

/** 静默到点：录音异常时优先报状态，否则按阶梯引导 */
FreeTalk.prototype._onSilenceDue = function () {
  if (!this._active) return;
  var ms = Date.now() - this._silenceSince;
  console.log('[ft-diag] 长静默 | 连续', (ms / 1000).toFixed(1) + 's 无有效用户输入',
    '| 阈值 =', this._guideDelay(this._guideLevel) + 'ms',
    '| 已引导 =', this._guideLevel,
    '| 录音健康 =', this._recorderBad ? 'NO（实例异常）' : 'yes',
    '| 收音暂停 =', this._asrPaused ? 'yes' : 'no');
  if (this._recorderBad) {
    // 录音器坏了：引导说得再温柔，用户也说不进来。先明确告知，再按档继续等。
    console.warn('[ft-guide] 录音器异常 → 本轮不引导，改为状态提示');
    this._notifyStatus('麦克风异常，正在重连');
    this._guideLevel++;
    this._silenceSince = Date.now();
    this._armSilence();
    return;
  }
  this._fireGuide('长静默');
};

/** 录音状态的用户可见提示：写进用户文字区（10s 内同一句去重），不弹窗 */
FreeTalk.prototype._notifyStatus = function (text) {
  var t = String(text || '').trim();
  if (!t) return;
  if (t === this._lastStatus && Date.now() - this._statusShownAt < 10000) return;
  this._lastStatus = t;
  this._statusShownAt = Date.now();
  if (this._hintOn) { this._hintOn = false; this._countText = ''; }
  this._setCountdown(-1);
  console.log('[ft-diag] 状态提示 → 用户文字区 |', t);
  try { this.onStatus(t); } catch (e) { /* 忽略 */ }
};

/**
 * 引导被占用（仍在播报 / 通道未就绪）时：不重置整档静默，5s 后按同一档重试；
 * 连续重试 12 次（≈1 分钟）仍不行才推进档位，避免永久卡死在同一轮。
 */
FreeTalk.prototype._retryGuideLater = function (why) {
  var self = this;
  if (!this._active) return;
  this._guideRetry++;
  if (this._guideRetry > 12) {
    console.warn('[ft-guide] 引导短重试', this._guideRetry - 1, '次仍被占用（', why, '）→ 推进档位继续等');
    this._guideRetry = 0;
    this._guideLevel++;
    this._silenceSince = Date.now();
    this._armSilence();
    return;
  }
  if (this._guideRetryTimer) clearTimeout(this._guideRetryTimer);
  this._guideRetryTimer = setTimeout(function () {
    self._guideRetryTimer = null;
    self._fireGuide('重试-' + why);
  }, GUIDE_RETRY_MS);
  console.log('[ft-guide] 引导暂缓 | 原因 =', why,
    '| 第', this._guideRetry, '次重试 | 间隔 =', GUIDE_RETRY_MS + 'ms');
};

/** 分级间隔：60s / 90s / 150s，之后每次 +60s，封顶 300s */
FreeTalk.prototype._guideDelay = function (level) {
  if (level < GUIDE_DELAYS_MS.length) return GUIDE_DELAYS_MS[level];
  return Math.min(GUIDE_DELAY_MAX, GUIDE_DELAYS_MS[GUIDE_DELAYS_MS.length - 1]
    + (level - GUIDE_DELAYS_MS.length + 1) * 60000);
};

/**
 * 引导分级：
 *   level 0 → ask   温和追问（结合用户说过的话）
 *   level 1 → angle 换角度追问（不复用角度、不复用问过的问题）
 *   level 2+ → 金句模式与轻问交替，避免连续两条都是金句
 */
FreeTalk.prototype._guideStage = function () {
  if (this._guideLevel === 0) return 'ask';
  if (this._guideLevel === 1) return 'angle';
  return (this._guideLevel % 2 === 0) ? 'quote' : 'light';
};

FreeTalk.prototype._clearSilence = function () {
  if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
  if (this._guideRetryTimer) { clearTimeout(this._guideRetryTimer); this._guideRetryTimer = null; }
  this._silenceOn = false;
};

/** 现在是否适合主动开口：不在播报、没有待播段、不在暂停期、通道空闲 */
FreeTalk.prototype._canGuide = function () {
  return !!this._active
    && !this._asrPaused
    && !this._guidePending
    && !this._chanBusy
    && !tts.isPlaying()
    && !this._aiQueue.length
    && !this._speaking();
};

FreeTalk.prototype._fireGuide = function (from) {
  var self = this;
  if (!this._active) return;
  if (this._guideLevel >= GUIDE_MAX) {
    console.log('[ft-guide] 已达引导上限', GUIDE_MAX, '轮，停止主动开口（收尾）');
    return;
  }
  if (this._recorderBad) {
    // 录音坏了：本轮不引导（用户说不进来），只报状态，稍后按同一档再试
    this._notifyStatus('麦克风异常，正在重连');
    this._retryGuideLater('录音器异常');
    return;
  }
  if (!this._canGuide()) {
    console.log('[ft-guide] 跳过本轮引导 | 原因 =', tts.isPlaying() ? '仍在播报' :
      (this._asrPaused ? '暂停收音' : (this._chanBusy ? '回复未结束' : '待播段未清')));
    // 短重试：不再把整档静默重排（旧行为会让 60s 永远从头算，引导永远不触发）
    this._retryGuideLater(tts.isPlaying() ? '仍在播报'
      : (this._asrPaused ? '暂停收音' : (this._chanBusy ? '回复未结束' : '待播段未清')));
    return;
  }
  var channel = this._channel;
  if (!channel || !channel.isActive || !channel.isActive()) {
    console.log('[ft-guide] 通道未就绪，跳过本轮引导');
    this._retryGuideLater('通道未就绪');
    return;
  }
  var stage = this._guideStage();
  var quote = null;
  if (stage === 'quote') {
    quote = this._pickQuote();
    if (!quote) {
      // 金句池取不到：宁可不编，降级成一次简短自然轻问
      console.warn('[ft-guide] 金句池为空（data/quotes.js 不可用），降级为轻问');
      stage = 'light';
    }
  }
  var prompt = this._buildGuidePrompt(stage, quote);
  if (!prompt) return;
  console.log('[ft-guide] 触发主动引导 | from =', from || '-', '| stage =', stage,
    '| 轮次 =', this._guideLevel + 1,
    '| 沉默 =', ((Date.now() - this._silenceSince) / 1000).toFixed(1) + 's',
    '| 已问过 =', this._guidesAsked.length,
    '| 已用金句 =', this._quotesUsedCount || 0,
    quote ? ('| quoteIdx =', quote.idx, '| author =', quote.q.author || '-') : '',
    '| promptLen =', prompt.length);
  this._guidePending = true;
  this._guideStagePending = stage;
  this._chanBusy = true;
  this._muteDeltas = false;
  this._guideRetry = 0;   // 真正发起了：短重试计数清零
  // 引导请求只发给模型，不写进本地用户行（不调用 _logUser）
  channel.pushFragment(prompt);
  if (typeof channel.flushNow === 'function') channel.flushNow();
  this._clearReplyTimer();
  this._replyTimer = setTimeout(function () {
    self._replyTimer = null;
    if (!self._active || !self._guidePending) return;
    console.warn('[ft-guide] 引导请求超时（', GUIDE_TIMEOUT_MS, 'ms 无回复）→ 本轮不说话');
    self._guidePending = false;
    self._chanBusy = false;
    // 超时也推进轮次，避免同一角度反复重试刷屏；金句未真正播出，不计入已用
    self._guideLevel++;
    self._silenceSince = Date.now();
    self._armSilence();
  }, GUIDE_TIMEOUT_MS);
};

/** 取一句本会话没用过的金句（与首页金句区同一份数据）；全部用过则重置后避开上一句 */
FreeTalk.prototype._pickQuote = function () {
  var pool = QUOTES || [];
  if (!pool.length) {
    console.error('[ft-alarm] 金句池为空（data/quotes.js 未加载或为空）→ 本轮降级为轻问');
    return null;
  }
  var used = this._quotesUsed || {};
  var start = Math.floor(Math.random() * pool.length);
  for (var i = 0; i < pool.length; i++) {
    var idx = (start + i) % pool.length;
    if (!used[idx] && pool[idx] && pool[idx].translation) {
      used[idx] = 1;
      this._quotesUsed = used;
      this._quotesUsedCount = Object.keys(used).length;
      this._lastQuoteIdx = idx;
      return { idx: idx, q: pool[idx] };
    }
  }
  // 池子用尽：清空重来，但避开刚才那句，保证不连着重复
  this._quotesUsed = {};
  for (var j = 0; j < pool.length; j++) {
    var k = (start + j) % pool.length;
    if (k !== this._lastQuoteIdx && pool[k] && pool[k].translation) {
      this._quotesUsed[k] = 1;
      this._quotesUsedCount = 1;
      this._lastQuoteIdx = k;
      return { idx: k, q: pool[k] };
    }
  }
  console.error('[ft-alarm] 金句池无可用条目（缺少 translation 字段）| 总数 =', pool.length,
    '| 说明 = 本轮降级为轻问');
  return null;
};

/**
 * 引导用的指令文本：按分级给不同任务（追问 / 换角度 / 金句 / 轻问）。
 * 这段文字不会被当成用户说的话展示（不落 _log 的 user 字段）。
 */
FreeTalk.prototype._buildGuidePrompt = function (stage, quote) {
  var angles = ['此刻的感受', '具体的细节', '当下的身体状态', '当时的场景',
    '与前面话题的关联', '回到更早提过的事'];
  var angle = angles[Math.max(0, this._guideLevel - 2) % angles.length];
  var asked = this._guidesAsked.slice(-GUIDE_ASKED_MAX);
  var lines = [];
  var n = Math.min(this._log.length, 4);
  for (var i = n - 1; i >= 0; i--) {
    var it = this._log[i];
    if (it.user) lines.push('用户：' + it.user);
    if (it.ai) lines.push('玄机子：' + it.ai);
  }
  var p = '【系统指令：主动关心，不是用户发言，不要复述本段】\n';
  p += '你是玄机子，像知心姐姐/心理咨询师一样温和地陪着用户。用户已经安静了一会儿。\n';
  if (stage === 'ask') {
    p += '请只说 1 到 2 句口语化的温柔追问，不要列点、不要一次问多个问题、不要审问式盘问。\n';
    p += '优先抓住用户自己提过的具体的人、事、时间、情绪词往下问，不要空泛地说「你还好吗」。\n';
  } else if (stage === 'angle') {
    p += '请换一个角度追问，只说 1 到 2 句口语化的话，不要列点、不要一次问多个问题。\n';
    p += '这一轮从「' + angle + '」切入，不要重复前面问过的角度和说法。\n';
  } else if (stage === 'quote' && quote) {
    p += '这一轮不要追问，改为分享一句金句，并说说你自己的体会。\n';
    p += '金句（作者：' + (quote.q.author || '佚名') + '）：\n';
    p += '译文：' + quote.q.translation + '\n';
    if (quote.q.text && quote.q.text !== quote.q.translation) p += '原文：' + quote.q.text + '\n';
    p += '要求：先用中文口语自然地说出这句（外文只念译文，可以带上作者名），'
      + '再用一到两句说你自己的理解和感悟，最后轻轻问用户怎么看、有什么感受。\n';
    p += '不要列点、不要念稿、不要说「下面我引用一句」这种话。\n';
  } else {
    p += '这一轮不要引用金句，也不要长篇大论。用一句自然的回应接住用户，'
      + '再轻轻抛一个很好回答的小问题，1 到 2 句就够。\n';
  }
  p += asked.length
    ? ('以下问题已经问过，不要再用同类角度重复：\n' + asked.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n') + '\n')
    : '（还没有问过引导问题，可以自由选一个最有价值的角度）\n';
  p += lines.length ? ('最近的对话（从早到晚）：\n' + lines.join('\n') + '\n') : '（用户还没说过有效内容）\n';
  p += '只输出你要说的那 1 到 2 句，不要解释、不要加引号。';
  return p;
};

/** 引导回复到手：记录「已问过」，供下一轮过滤 */
FreeTalk.prototype._rememberGuide = function (text) {
  var t = String(text || '').trim();
  if (!t) return;
  this._guidesAsked.push(t.slice(0, 60));
  if (this._guidesAsked.length > GUIDE_ASKED_MAX) this._guidesAsked.shift();
};

FreeTalk.prototype._rememberSpoken = function (seg) {
  var n = norm(seg);
  if (n.length < 2) return;
  if (this._spoken[this._spoken.length - 1] === n) return;   // 问候语排队时已登记过，播出声时不再重复入表
  this._spoken.push(n);
  if (this._spoken.length > SPOKEN_MAX) this._spoken.shift();
  // 同步累积播报全文：整轮回复被 ASR 合成一条长 final 时，用它算覆盖率
  this._spokenText = (this._spokenText + n).slice(-SPOKEN_TEXT_MAX);
  this._spokenGrams = gramSet(this._spokenText);
};

/* ---------------- 回录判定：精确匹配为主，相似度兜底 ----------------
 * 已播文本在 tts 'playing' 时按规范化形式存进 _spoken / _spokenText
 * （问候语在排队时即登记；金句引导、普通回复、合并后的实际播报段全走同一条路，只有这一张表）。
 *   ① 识别文本是已播全文的子串（相邻段在 _spokenText 里本来就是连着的）→ 精确命中
 *   ② 识别文本里含某段已播文本（或相邻 2~3 段拼接）→ 裁掉它，剩下的才是用户新内容
 *   ③ 都不中才用相似度 / 覆盖率 / 公共片段兜底（插件把文本识别得支离破碎时）
 * 窗口外（strict = false）一律不判回录：用户复述 AI 原话不能被误杀。
 */
FreeTalk.prototype._echoCheck = function (text, strict) {
  var out = { echo: false, rest: '', rule: '', lane: '' };
  var n = norm(text);
  if (!n || n.length < MIN_VOICE_CHARS) return out;
  if (!strict) return out;                       // 窗口外直接放行
  var sp = this._spokenText || '';
  // ① 子串：整段都能在已播全文里找到
  if (sp && sp.indexOf(n) >= 0) {
    out.echo = true; out.rule = '子串'; out.lane = 'exact';
    return out;
  }
  // ② 已播片段出现在识别文本里：取最长可裁剪片段，剩下的才是用户新内容
  var segs = this._spoken || [];
  var best = '';
  for (var i = 0; i < segs.length; i++) {
    if (segs[i].length > best.length && n.indexOf(segs[i]) >= 0) best = segs[i];
    var join = segs[i];
    for (var k = i + 1; k < segs.length && k <= i + 2; k++) {
      join += segs[k];
      if (join.length > best.length && n.indexOf(join) >= 0) best = join;
    }
  }
  if (best.length >= ECHO_BLOCK_MIN) {
    var rest = n.split(best).join('');
    out.lane = 'exact';
    out.rule = '连续片段';
    if (rest.length >= ECHO_REST_MIN) out.rest = rest;
    else out.echo = true;
    return out;
  }
  // ③ 兜底 1：与最近若干播报句的 Dice（网站 _ftIsEcho 原判据）
  for (var j = 0; j < segs.length; j++) {
    if (similarity(n, segs[j]) >= ECHO_SIM) {
      out.echo = true; out.rule = '相似度'; out.lane = 'fuzzy'; return out;
    }
  }
  // ③ 兜底 2：二元组覆盖率（整轮播报被识别成一条长 final 时 Dice 会被长度拉低）
  var grams = bigrams(n);
  if (grams.length >= ECHO_COVER_MIN) {
    var pool = this._spokenGrams || {};
    var hit = 0;
    for (var g = 0; g < grams.length; g++) if (pool[grams[g]]) hit++;
    if (hit >= ECHO_COVER_MIN && hit / grams.length >= ECHO_COVER) {
      out.echo = true; out.rule = '覆盖率'; out.lane = 'fuzzy'; return out;
    }
  }
  // ③ 兜底 3：最长公共连续片段（容忍 ASR 首尾多字 / 漏字、同音错字）
  if (n.length >= ECHO_LCS_MIN && n.length <= LCS_MAX_LEN && sp) {
    var lcs = longestCommon(n, sp);
    if (lcs >= ECHO_LCS_MIN && lcs >= n.length * ECHO_LCS_RATIO) {
      out.echo = true; out.rule = '公共片段'; out.lane = 'fuzzy'; return out;
    }
  }
  return out;
};

/** 打断：停播 + 丢弃未播内容（不自动续播），随后把这句话当新输入立即发出 */
FreeTalk.prototype._bargeIn = function (text) {
  // 先静音上一轮残留 delta，再由通道打断并作为新输入发出
  this._muteDeltas = true;
  this._resetSpeech();
  this._sendUser(text);
  // 网站 _ftBargeIn：插话是明确意图，不等待合并窗口，直接发出
  if (this._channel && typeof this._channel.flushNow === 'function') this._channel.flushNow();
};

FreeTalk.prototype._resetSpeech = function () {
  this._buf = '';
  this._tailUntil = 0;
  this._postEchoUntil = 0;
  // 播报被插话/中断：把这之前开始的识别段视为「可能含回录」，之后仍按回声判定
  this._lastSpeechEndAt = Date.now();
  this._segStartAt = 0;
  this._speechSeq++;
  if (this._tailTimer) { clearTimeout(this._tailTimer); this._tailTimer = null; }
  // 插话/中断：未播出声的段落属于被打断的这一轮，直接丢弃（不补文字、不续播）
  this._aiQueue = [];
  this._sayPending = '';
  if (this._sayHoldTimer) { clearTimeout(this._sayHoldTimer); this._sayHoldTimer = null; }
  // 被打断时若正等引导回复，这一轮直接作废（不记入已问过）
  this._guidePending = false;
  this._clearPreRoll();       // 问候被插话打断：预录窗口就此结束，后续播报正常暂停收音
  try { tts.stop(true); } catch (e) { /* 忽略 */ }
  try { this.onSpeaking(false); } catch (e) { /* 忽略 */ }
  // 打断后麦克风要立刻回来（此时没有音频可回录）
  this._resumeAsr('打断后恢复');
};

FreeTalk.prototype._sendUser = function (text) {
  if (!this._active || !this._channel) return;
  this._logUser(text, true);
  console.log('[ft] 送出用户文本 | len =', String(text || '').length);
  // 本轮耗时桶：录音侧时间戳来自 asr 的 final meta，回复侧在 delta/首播/end 上补点
  var meta = this._asrMeta || {};
  this._asrMeta = null;
  this._turnT = {
    lastPartial: meta.lastPartialAt || 0,
    stopAt: meta.stopAt || 0,
    stopBy: meta.stopBy || '',
    stallMs: meta.stallMs || 0,
    finalAt: meta.onStopAt || Date.now(),
    sentAt: Date.now(),
    firstDelta: 0,
    firstPlay: 0,
    printed: false
  };
  // 未连接/发送失败由 agent-ws 通过 onNotice 显式提示，并把文本缓存到重连后补发
  // 不立即 flush：交给通道的合并窗口（句末 200ms / 长句 350ms / 短句 500ms / 未完结 +300ms），
  // 停顿后自动发出，与网站 pushFragment 的行为一致。
  this._channel.pushFragment(text);
  this._chanBusy = true;
  this._replyOpen = true;          // 发出即进入「本轮未结束」：界面显示生成中，而不是等你说
  this._spokeThisReply = false;
  this._interruptedTurn = false;
  this._startReplyWatch();
  this._syncTurnState('已发送');
};

/** 发出后 15s 内没有任何回复：明确提示，避免「说完没反应」 */
FreeTalk.prototype._startReplyWatch = function () {
  var self = this;
  this._clearReplyTimer();
  this._replyTimer = setTimeout(function () {
    self._replyTimer = null;
    if (!self._active || !self._chanBusy) return;
    self.onNotice({ code: 'NO_REPLY', level: 'warn', message: '没有收到回应，请再说一次' });
  }, REPLY_TIMEOUT_MS);
};

FreeTalk.prototype._clearReplyTimer = function () {
  if (this._replyTimer) { clearTimeout(this._replyTimer); this._replyTimer = null; }
};

FreeTalk.prototype._speakText = function (text) {
  this._sayText(text, 'greeting');
  this._drainSay(true, 'greeting');  // 开场问候等一次性文本：立刻交付，不等合并窗口
  this._spokeThisReply = true;
  this._syncTurnState('问候语');
};

/**
 * 字幕/播报的合并缓冲（连贯度策略）：
 * 模型是流式吐句的，句子长短差别很大，逐句直发就会出现「好的。」「我在呢。」这种
 * 一条条跳动的短段。这里把短句先攒在 _sayPending 里，凑到 SAY_MIN 再交给播报，
 * 于是同一段文字与同一段音频严格同源，字幕每次出现都是更完整的一块。
 * 长句不受影响：找到第一个句末标点且长度已达标就直接交付。
 */
FreeTalk.prototype._sayText = function (text, source) {
  var t = String(text || '').trim();
  if (!t) return;
  this._sayPending += t;
  this._drainSay(false, source);
};

/** 切点：优先在 [SAY_MIN, SAY_MAX] 内的句末标点；没有就在 SAY_MAX 内的逗号；再不行硬切 */
FreeTalk.prototype._sayCut = function (buf, final) {
  var lim = Math.min(buf.length, SAY_MAX);
  var strong = '。！？；…!?;\n';
  for (var i = SAY_MIN - 1; i < lim; i++) {
    if (strong.indexOf(buf.charAt(i)) >= 0) return i + 1;
  }
  if (buf.length >= SAY_MAX) {
    var weak = '，、,';
    for (var j = lim - 1; j >= SAY_MIN; j--) {
      if (weak.indexOf(buf.charAt(j)) >= 0) return j + 1;
    }
    return SAY_MAX;
  }
  return final ? buf.length : 0;
};

FreeTalk.prototype._drainSay = function (final, source) {
  var buf = String(this._sayPending || '');
  var out = [];
  while (buf.length) {
    if (!final && buf.length < SAY_MIN) break;
    var cut = this._sayCut(buf, final);
    if (!cut) break;
    var piece = buf.slice(0, cut).trim();
    buf = buf.slice(cut);
    if (piece) out.push(piece);
  }
  this._sayPending = buf;
  for (var i = 0; i < out.length; i++) this._enqueueSay(out[i], source);
  if (out.length) {
    console.log('[ft-diag] 播报段合并 | 来源 =', source || '-', '| 本次交付 =', out.length, '段 | 各段 len =',
      out.map(function (s) { return s.length; }).join('/'), '| 待合并余量 =', this._sayPending.length);
  }
  if (this._sayPending && !final) this._armSayHold();
  if (!this._sayPending && this._sayHoldTimer) {
    clearTimeout(this._sayHoldTimer);
    this._sayHoldTimer = null;
  }
};

/** 短句凑不够长度时的兜底：最多等 SAY_HOLD_MS，避免一直不出声 */
FreeTalk.prototype._armSayHold = function () {
  var self = this;
  if (this._sayHoldTimer || !this._active) return;
  this._sayHoldTimer = setTimeout(function () {
    self._sayHoldTimer = null;
    if (!self._active || !self._sayPending) return;
    console.log('[ft-diag] 短句等待超时，单发 | len =', self._sayPending.length);
    self._drainSay(true, 'hold');
  }, SAY_HOLD_MS);
};

/**
 * 本轮唯一的播报交付入口。
 *
 * 唯一交付链（任何新段都只能走这一条，入口内部没有并行分支）：
 *   assistant.delta / assistant.end(整段补播) → _buf
 *     → takeSentences 切句 → _sayPending → _drainSay 合并/切段
 *     → _enqueueSay（这里）→ _aiQueue + tts.enqueue
 *     → tts 的 playing / skip → _appendAiShown（上屏）
 * 也就是说「写进 _aiQueue」「调 tts.enqueue」「上屏」三个动作都只有这一个源头。
 * final 整段补播只是往 _buf 里追加文本，不另开分支；它只在「本轮确实没有任何 delta」
 * 时才被允许（见 onEnd 的 _sawDelta），所以同一条回复不会既走 delta 又走整段。
 *
 * 结构校验（不是内容校验）：每段带 reply + seq，seq 必须在本轮内严格 +1 且只出现一次。
 * 一旦重复/跨轮，说明出现了第二个生产者，这里只报 [ft-alarm] 并停下（不静默），
 * 告警里的「来源」直接指出是哪条路径，便于修根因。
 *
 * @param {string} text 待交付片段
 * @param {string} source 入口来源：delta / final / hold / greeting
 */
FreeTalk.prototype._enqueueSay = function (text, source) {
  var raw = String(text || '').trim();
  var t = tts.stripMarkdown(raw).trim();
  if (!t) return;
  var reply = this._replySeq;
  var parts = [];
  var rest = t;
  while (rest.length > SPEAK_SEG_MAX) {   // 极长段才硬切，避免单次 TTS 过长
    parts.push(rest.slice(0, SPEAK_SEG_MAX));
    rest = rest.slice(SPEAK_SEG_MAX);
  }
  if (rest.trim()) parts.push(rest);
  var deliveredAny = false;
  for (var i = 0; i < parts.length; i++) {
    var p = String(parts[i] || '').trim();
    if (!p) continue;
    var seq = ++this._segSeq;
    if (reply !== this._replySeq || this._deliveredSeqs.indexOf(seq) >= 0) {
      this._seqAlarm++;
      console.log('[ft-alarm] 重复 seq 交付 | reply =', reply, '| 当前轮 =', this._replySeq,
        '| seq =', seq, '| 来源 =', source || '-',
        '| 说明 = 本轮出现第二个生产者，请顺着来源查调用链');
      return;
    }
    this._deliveredSeqs.push(seq);
    this._segCount++;
    this._segChars += p.length;
    deliveredAny = true;
    this._aiQueue.push(p);
    tts.enqueue(p, { raw: true });
    console.log('[ft-diag] 播报段交付 | reply =', reply, '| seq =', seq,
      '| 来源 =', source || '-', '| len =', p.length);
  }
  if (deliveredAny) this._deliveredRaw += raw;   // 原文（含标点）累积：只做内容级校验，不参与交付
};

/**
 * 播报被暂停/关闭时，把还没出声的段落一次性补齐，避免文字缺尾。
 * 只吐字、不入队：队列在这里被清空，所以同一段不会既走 playing 又被补齐。
 */
FreeTalk.prototype._flushAiQueue = function () {
  if (!this._aiQueue.length) return;
  var rest = this._aiQueue.join('');
  this._aiQueue = [];
  console.log('[ft-diag] 播报中断，剩余字幕补齐 | len =', rest.length);
  this._appendAiShown(rest, true);
};

/**
 * AI 字幕逐句追加（DF-97）——上屏的唯一出口。
 * 调用点只有两个：tts 的 playing / skip 事件（出队即上屏），以及 end 时补齐未播段。
 * 一处出队只对应一次追加，所以不会出现「播第 2 句已显示第 4 句」，也不会同一段上屏两次。
 * @param {string} seg 本段文本
 * @param {boolean} silent 音频没出声（拉流失败/卡死被跳过），只补文字
 */
FreeTalk.prototype._appendAiShown = function (seg, silent) {
  var t = String(seg || '');
  if (!t) return;
  this._aiShown += t;
  if (this._aiShown.length > AI_SHOWN_MAX) this._aiShown = this._aiShown.slice(-AI_SHOWN_MAX);
  this._aiShownSegs = (this._aiShownSegs || 0) + 1;
  console.log('[ft-diag] AI 上屏 #' + this._aiShownSegs,
    '| 本句 len =', t.length, '| 累计 len =', this._aiShown.length,
    silent ? '| 音频跳过只补字' : '| 与播报同步');
  try { this.onAiText(this._aiShown); } catch (e) { /* 页面异常不影响播报 */ }
};

/** 新一轮回答：字幕清空，从第一句开始重新逐句追加 */
FreeTalk.prototype._resetAiShown = function () {
  this._replySeq++;
  this._segSeq = 0;
  this._segCount = 0;
  this._segChars = 0;
  this._deliveredRaw = '';
  this._streamRaw = '';
  this._deliveredSeqs = [];
  this._seqAlarm = 0;
  this._aiShown = '';
  this._aiShownSegs = 0;
  this._aiQueue = [];
  this._sayPending = '';
  if (this._sayHoldTimer) { clearTimeout(this._sayHoldTimer); this._sayHoldTimer = null; }
  try { this.onAiText(''); } catch (e) { /* 忽略 */ }
  console.log('[ft-diag] 新一轮播报 | reply =', this._replySeq, '| 段号已复位');
};

FreeTalk.prototype._drainBuffer = function (final) {
  var src = final ? 'final' : 'delta';
  var cut = takeSentences(this._buf);
  this._buf = cut.rest;
  for (var i = 0; i < cut.segs.length; i++) this._sayText(cut.segs[i], src);
  if (final) {
    var tail = this._buf.trim();
    this._buf = '';
    if (tail) this._sayText(tail, src);
    this._drainSay(true, src);   // 本轮回复收尾：把合并缓冲里剩下的短句立刻交付
  }
};

/* ---------------- 对话记录（最新在最上面，用户/AI 用条目标签区分） ---------------- */

FreeTalk.prototype._findLog = function (id) {
  for (var i = 0; i < this._log.length; i++) {
    if (this._log[i].id === id) return this._log[i];
  }
  return null;
};

FreeTalk.prototype._trimLog = function () {
  while (this._log.length > LOG_MAX) this._log.pop();
};

FreeTalk.prototype._flushLog = function () {
  if (this._logTimer) { clearTimeout(this._logTimer); this._logTimer = null; }
  try { this.onLog(this._log.slice()); } catch (e) { /* 忽略 */ }
};

FreeTalk.prototype._scheduleLog = function () {
  if (this._logTimer) return;
  var self = this;
  this._logTimer = setTimeout(function () {
    self._logTimer = null;
    self._flushLog();
  }, LOG_THROTTLE_MS);
};

/** 新起一轮对话（最新一轮在最上面） */
FreeTalk.prototype._newExchange = function () {
  var item = { id: 'x' + (++this._logSeq), user: '', userFinal: false, ai: '', aiFinal: false };
  this._log.unshift(item);
  this._trimLog();
  this._curId = item.id;
  return item;
};

/**
 * 换轮清空用户行：全模块唯一的清空入口（幂等）。
 * 两个触发点都走这里，不会打架：
 *   1) 进入「轮到你说」时（正常一轮结束、播报队列空、收音已恢复）；
 *   2) 新一段识别的第一段文字到达时（_segFresh，兜底：切轮时机没对上也不叠字）。
 * 已经清过的轮次再次调用是空操作，不会重复 flush、不会打第二条日志。
 */
FreeTalk.prototype._clearUserLine = function () {
  var item = this._curId ? this._findLog(this._curId) : null;
  this._uiText = '';
  this._uiFinal = false;
  if (!item || !item.userFinal || !item.user) {
    // 当前指针可能是 AI 轮（没有用户文字）：回退到最新一条带用户文字的轮
    item = null;
    for (var i = 0; i < this._log.length; i++) {
      if (this._log[i].user) { item = this._log[i]; break; }
    }
  }
  if (!item || !item.user) return false;   // 已清过：空操作
  item.user = '';
  // 上一轮还没等到回复：整条空轮直接移除，避免日志里堆积空条目
  if (!item.ai && !item.aiFinal) {
    var idx = this._log.indexOf(item);
    if (idx >= 0) this._log.splice(idx, 1);
  }
  this._curId = '';
  console.log('[ft] 换轮清空用户行（进入「轮到你说」）');
  this._flushLog();
  return true;
};

/** 用户行：识别中不断更新同一条，定稿后保留；用户再次开口则另起一轮 */
FreeTalk.prototype._logUser = function (text, isFinal) {
  // DF-103：文字输入上限 200 字（超出截断，不再接收），与倒计时分档同口径（中文 1 / 半角 0.5）
  var t = asr.truncateEff(String(text || '').trim(), 200);
  if (!t) return;
  // 同一识别段 + 同一文本 + 同一状态 = 同一个终态值，重复写只会让 UI 重渲染一次。
  // 作用域严格限制在「本段最近一次写入」，换段（_uiSegNo 变化）、换字、interim→final 都照常写，
  // 因此它不是内容去重：不会跨段比较，也不会吞掉任何新内容。
  if (this._uiText === t && this._uiFinal === !!isFinal) {
    console.log('[ft-diag] 上屏跳过 | 同段同文本 | seg =', this._uiSegNo,
      '| len =', t.length, '| final =', isFinal ? 'yes' : 'no');
    return;
  }
  // 换轮清空：新一段识别的第一段文字到达时，先抹掉上一轮已定稿的文字，
  // 不与本轮叠在一起往下续（时机取「新一轮识别开始」，不依赖回复或通道重连）
  if (this._segFresh) {
    this._segFresh = false;
    this._clearUserLine();
  }
  var item = this._curId ? this._findLog(this._curId) : null;
  var replay = item && item.userFinal && item.user === t;
  // 当前轮已经定稿了另一句话，或已经有了 AI 回复 → 用户重新开口，另起一轮
  if (!item || item.ai || (item.userFinal && !replay)) item = this._newExchange();
  // 用户真的开口：撤掉「可以开始说话了」，由真实识别文字接管小字位
  this._clearTurnHint('用户开口');
  item.user = t;
  item.userFinal = !!isFinal;
  this._uiText = t;
  this._uiFinal = !!isFinal;
  if (isFinal) {
    console.log('[ft-diag] 上屏 | len =', t.length, '| final = yes');
    this._flushLog();
  } else this._scheduleLog();
};

/** 丢弃还在识别中的用户文本（判定为回声时不留残影） */
FreeTalk.prototype._dropInterim = function () {
  this._setCountdown(-1);   // 文字都不发了：倒计时立即撤掉（不留空转提示）
  var item = this._curId ? this._findLog(this._curId) : null;
  this._uiText = '';       // 文字被撤回：允许同一段重新写入同样内容
  this._uiFinal = false;
  if (!item || item.userFinal) return;
  item.user = '';
  if (!item.ai && !item.aiFinal) {
    var idx = this._log.indexOf(item);
    if (idx >= 0) this._log.splice(idx, 1);
    this._curId = '';
  }
  this._flushLog();
};

/** AI 行：assistant.start 挂到当前用户轮，delta 增量，end/interrupted 定稿 */
FreeTalk.prototype._logAiStart = function () {
  var item = this._aiId ? this._findLog(this._aiId) : null;
  if (item && !item.aiFinal) return item;
  var cur = this._curId ? this._findLog(this._curId) : null;
  if (cur && !cur.ai && !cur.aiFinal) {
    this._aiId = cur.id;
    this._flushLog();
    return cur;
  }
  item = this._newExchange();
  this._aiId = item.id;
  this._flushLog();
  return item;
};

FreeTalk.prototype._logAiAppend = function (delta) {
  var d = String(delta || '');
  if (!d) return;
  var item = this._aiId ? this._findLog(this._aiId) : null;
  if (!item || item.aiFinal) item = this._logAiStart();
  item.ai += d;
  this._scheduleLog();
};

/** 定稿：text 非空时以服务端整段为准（流式缺 delta 的兜底） */
FreeTalk.prototype._logAiFinal = function (text) {
  var item = this._aiId ? this._findLog(this._aiId) : null;
  var t = String(text || '').trim();
  if (!item) {
    if (!t) return;
    item = this._logAiStart();
  }
  if (t) item.ai = t;
  item.aiFinal = true;
  this._aiId = '';
  // 空轮次（既无用户文本也无 AI 内容）直接移除
  if (!item.user && !item.ai) {
    var idx = this._log.indexOf(item);
    if (idx >= 0) this._log.splice(idx, 1);
    if (this._curId === item.id) this._curId = '';
  }
  this._flushLog();
};

/** 本地 AI 话术（开场问候）：直接落一条已定稿的 AI 行 */
FreeTalk.prototype._logAiSay = function (text) {
  var t = String(text || '').trim();
  if (!t) return;
  var item = this._newExchange();
  item.ai = t;
  item.aiFinal = true;
  this._flushLog();
};

FreeTalk.prototype._emitState = function (state) {
  if (this._state === state) return;   // 同一状态不重复下发（避免 setData 抖动、日志刷屏）
  this._state = state;
  console.log('[ft-state] 状态 =', state, '| 说明 =', STATE_TIP[state] || state,
    '| 回复未结束 =', this._replyOpen ? 'yes' : 'no',
    '| 待播段 =', this._aiQueue.length,
    '| 收音暂停 =', this._asrPaused ? 'yes' : 'no');
  try { this.onState(state); } catch (e) { /* 忽略 */ }
};

/**
 * 三种状态的唯一判定入口：生成中 → 她在说 → 轮到你说。
 * 判据（缺一不可，否则绝不显示「轮到你说」）：
 *   1) 本轮 assistant 已 end（_replyOpen=false）且通道不忙（_chanBusy=false）
 *   2) 播报队列为空、也没有音频在播（含 >1s 段间空隙）
 *   3) 收音已恢复（_asrPaused=false），用户确实能开口
 * 空隙期（已出过声但下一段还没来）继续维持「她在说」，不降级成「轮到你说」。
 */
FreeTalk.prototype._syncTurnState = function (why) {
  if (!this._active) return;
  var playing = false;
  try { playing = tts.isPlaying(); } catch (e) { playing = false; }
  var queued = this._aiQueue.length > 0;
  var waiting = this._replyOpen || this._chanBusy;
  if (playing || queued) {
    this._clearTurnHint('进入播报');
    this._emitState('speaking');
    this._holdTurnState(why);
    return;
  }
  if (waiting) {
    this._clearTurnHint('回复未结束');
    this._emitState(this._spokeThisReply ? 'speaking' : 'generating');
    this._holdTurnState(why);
    return;
  }
  if (this._asrPaused) {
    // 收音还没恢复：先不宣布轮到用户，500ms 后再核（避免「说了也不听」）
    this._holdTurnState(why + '|等收音恢复');
    return;
  }
  // DF-103：问候语还没说完（待播 _greetPending / 正在播 _preRoll）时先不宣布「轮到你说」。
  // 否则通道 ready 阶段会提前把 _hintShownTurn 消耗成当前轮，问候播完再进 _enterTurn 时
  // 被「同轮只提示一次」拦截，导致首轮问候结束不显示「可以开始说话了」。
  if (this._greetPending || this._preRoll) {
    this._holdTurnState(why + '|等问候播完');
    return;
  }
  this._clearHold();
  this._enterTurn(why);
};

/** 保持轮询：空隙 / 收音未恢复时每 500ms 复核一次状态 */
FreeTalk.prototype._holdTurnState = function (why) {
  var self = this;
  if (this._holdTimer) return;
  this._holdTimer = setTimeout(function () {
    self._holdTimer = null;
    if (!self._active) return;
    self._syncTurnState('保持:' + why);
  }, 500);
};

FreeTalk.prototype._clearHold = function () {
  if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
};

/** 真正进入「轮到你说」：清空上一轮用户行 + 一次性提示 */
FreeTalk.prototype._enterTurn = function (why) {
  this._emitState('your_turn');
  if (this._interruptedTurn) {
    this._interruptedTurn = false;
    console.log('[ft-state] 打断后轮到用户 | 不提示「可以开始说话了」| 说明 = 本轮由用户插话结束，用户行保留');
    return;
  }
  if (this._hintShownTurn === this._turnNo) return;   // 同一轮只提示一次，避免反复刷新
  this._hintShownTurn = this._turnNo;
  if (this._recorderBad) {
    console.log('[ft-state] 轮到你说但录音器异常 → 只保留麦克风状态提示，不显示「可以开始说话了」');
    return;
  }
  this._clearUserLine();     // 唯一清空入口（详见 _clearUserLine 注释）
  this._showTurnHint();
};

/** 小字提示：可以开始说话了（与发送倒计时共用文字区尾部小字位） */
FreeTalk.prototype._showTurnHint = function () {
  if (this._countdownOn) {
    console.log('[ft-diag] 轮到你说提示暂不显示 | 原因 = 正在倒计时');
    return;
  }
  var t = '您可以开始说话了';
  if (this._countText === t && this._hintOn) return;
  this._hintOn = true;
  this._countText = t;
  console.log('[ft-diag] 轮到你说 | 提示 =', t, '| 触发 =', '回复结束 + 队列空 + 收音已恢复');
  try { this.onCountdown(t); } catch (e) { /* 忽略 */ }
  try { this.onTurn(true); } catch (e) { /* 忽略 */ }
};

FreeTalk.prototype._clearTurnHint = function (why) {
  if (!this._hintOn) return;
  this._hintOn = false;
  this._countText = '';
  console.log('[ft-diag] 轮到你说提示撤下 |', why);
  try { this.onCountdown(''); } catch (e) { /* 忽略 */ }
  try { this.onTurn(false); } catch (e) { /* 忽略 */ }
};

/** DF-103：播报中断（点按播报图标打断 / 语音打断共用）。
 *  停止播报 + 清空待播队列 + 丢弃在途回复 + 转等待输入，不自动续播。 */
FreeTalk.prototype.interrupt = function (reason) {
  if (!this._active) return false;
  this._muteDeltas = true;       // 在途 delta 作废：不续播、不补文字
  this._chanBusy = false;        // 本轮回复视为已结束，不再维持「生成中」
  this._replyOpen = false;
  this._clearReplyTimer();
  this._resetSpeech();           // 停播 + 清待播队列 + 恢复收音
  this._syncTurnState(reason || '点按打断');
  return true;
};

/** DF-104：草稿确认区上报 client.event（deep.abandon / deep.draft.edit / deep.submitted）。
 *  无连接返回 false，调用方据此提示或走 HTTP 兜底。 */
FreeTalk.prototype.sendEvent = function (name, data) {
  return this._channel ? this._channel.sendEvent(name, data) : false;
};

/** DF-104：录音文字区「点 ✕ 清空」——撤掉倒计时、清空当前转写（interim/final 都清），不再到点发出。 */
FreeTalk.prototype.cancelUser = function () {
  if (!this._active) return false;
  this._setCountdown(-1);    // 撤掉倒计时：不再到点自动发出
  this._clearUserLine();     // 清空当前用户行并刷新 UI（复用既有唯一清空入口）
  try { this.onCountdown(''); } catch (e) { /* 忽略 */ }
  // 清空后重新提示「可以开始说话了」，避免用户行空无一物
  this._showTurnHint();
  return true;
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
  this._spokenText = '';
  this._spokenGrams = Object.create(null);
  this._segStartAt = 0;
  this._lastSpeechEndAt = 0;
  this._tailUntil = 0;
  this._postEchoUntil = 0;
  this._speechSeq++;
  if (this._tailTimer) { clearTimeout(this._tailTimer); this._tailTimer = null; }
  if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
  this._replyOpen = false;
  this._spokeThisReply = false;
  this._interruptedTurn = false;
  this._hintOn = false;
  this._state = '';
  this._asrOn = false;
  this._asrPaused = false;
  this._clearPauseGuard();
  this._clearPreRoll();
  this._clearSilence();
  this._chanBusy = false;
  this._clearReplyTimer();
  this._guidePending = false;
  this._guideLevel = 0;
  this._guideRetry = 0;
  this._recorderBad = false;
  this._hidden = false;
  this._hiddenAt = 0;
  this._guidesAsked = [];
  this._quotesUsed = {};
  this._quotesUsedCount = 0;
  this._lastQuoteIdx = -1;
  this._sayPending = '';
  if (this._sayHoldTimer) { clearTimeout(this._sayHoldTimer); this._sayHoldTimer = null; }
  if (this._logTimer) { clearTimeout(this._logTimer); this._logTimer = null; }
  this._log = [];
  this._curId = '';
  this._aiId = '';
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
