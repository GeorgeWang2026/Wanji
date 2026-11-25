/* ============================================================
 * asr.js —— 语音输入（微信同声传译插件，实时识别）
 * ------------------------------------------------------------
 * 主路径：WechatSI 插件的 RecordRecognitionManager（0.3.10）
 *   边录边通过 onRecognize 返回累计识别结果 → 上层实时写进输入框；
 *   onStop 返回最终结果，用它整体覆盖，避免和中间结果重复拼接。
 *   注意：官方文档只写了 onStart/onStop/onError，onRecognize 属于
 *   0.3.x 实际可用的实时结果回调；若某机型不触发，页面仍会在 onStop
 *   时拿到最终文本，只是没有“边说边出字”。
 *
 * 兜底路径：插件未注册/未授权/基础库不支持时，自动退回原来的
 *   wx.getRecorderManager 录音 → /speech/asr 整段识别（非实时）。
 *
 * 上线前置条件（后台）：
 *   小程序后台 → 设置 → 第三方设置 → 插件管理 → 添加「微信同声传译」
 *   （provider: wx069ba97219f66d99），版本 0.3.10，并确认 app.json 已声明。
 *
 * 对外接口（chat.js 使用）：
 *   start(onPartial?) → Promise            开始录音；onPartial(text) 实时回调
 *   stop()            → Promise<{text, filePath, duration, error?}>
 *   recognize(filePath) → Promise<{text, source}>   整段识别，兜底用
 *   mode()            → 'plugin' | 'fallback'
 *   reason()          → string            插件不可用原因
 * ============================================================ */
var env = require('./env.js');
var api = require('./api.js');

var PLUGIN_NAME = 'WechatSI';
// 与 app.json 的 plugins.WechatSI.version 保持同步（后台实际可用版本为准）
var PLUGIN_VERSION = '0.3.10';

/* ---------------- 插件加载（失败即降级，不抛给页面） ---------------- */
var plugin = null;
var pluginReason = '';
if (typeof requirePlugin !== 'function') {
  pluginReason = '当前环境不支持插件（基础库过低或非小程序环境）';
} else {
  try {
    plugin = requirePlugin(PLUGIN_NAME);
  } catch (e) {
    plugin = null;
    pluginReason = (e && (e.message || e.errMsg)) || '同声传译插件未安装或未授权';
  }
  if (plugin && typeof plugin.getRecordRecognitionManager !== 'function') {
    pluginReason = '同声传译插件未提供 RecordRecognitionManager';
  }
}

function getMode() {
  return plugin && typeof plugin.getRecordRecognitionManager === 'function' ? 'plugin' : 'fallback';
}

// 启动时打一条路径日志：开发者工具 Console 一眼看出走插件还是兜底
console.log('[asr] WechatSI', PLUGIN_VERSION, '| mode =', getMode(),
  pluginReason ? ('| reason = ' + pluginReason) : '');

/* ---------------- 真机排障：环境与录音权限（只打日志，不动界面） ---------------- */
function logEnvDiag() {
  try {
    var info = wx.getSystemInfoSync() || {};
    console.log('[asr-diag] env | platform =', info.platform, '| system =', info.system,
      '| SDKVersion =', info.SDKVersion, '| mode =', getMode(),
      '| reason =', pluginReason || '-');
  } catch (e) { /* 忽略 */ }
  try {
    if (typeof wx.getSetting !== 'function') return;
    wx.getSetting({
      success: function (res) {
        var a = res && res.authSetting ? res.authSetting['scope.record'] : undefined;
        console.log('[asr-diag] scope.record =',
          a === undefined ? '未询问（首次 start 会自动弹窗）' : (a ? '已授权' : '已拒绝 ← 需用户到 设置→隐私 重新授权'));
      },
      fail: function () { console.log('[asr-diag] scope.record 读取失败'); }
    });
  } catch (e) { /* 忽略 */ }
}
logEnvDiag();

/* ---------------- 共用状态 ---------------- */
var partialCb = null;
var partialCount = 0;
var finalText = '';
var finalPath = '';
var lastError = '';
var startResolve = null;
var startReject = null;
var startTimer = null;
var stopResolve = null;
var stopTimer = null;

function clearStartTimer() {
  if (startTimer) { clearTimeout(startTimer); startTimer = null; }
}

function resolveStart() {
  clearStartTimer();
  if (startResolve) {
    var r = startResolve;
    startResolve = null;
    startReject = null;
    r();
  }
}

function rejectStart(err) {
  clearStartTimer();
  if (startReject) {
    var rj = startReject;
    startResolve = null;
    startReject = null;
    rj(err);
  }
}

function finishStop(patch) {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (!stopResolve) return;
  var out = {
    text: (patch && patch.text) || finalText || '',
    filePath: (patch && patch.filePath) || finalPath || '',
    duration: (patch && patch.duration) || 0,
    error: (patch && patch.error) || ''
  };
  // 诊断用：实时结果触发了几次、最终文本多长、有无音频文件、有无错误
  console.log('[asr] stop | mode =', getMode(), '| partial =', partialCount,
    '| textLen =', out.text.length, '| file =', out.filePath ? 'yes' : 'no',
    out.error ? ('| error = ' + out.error) : '');
  var cb = stopResolve;
  stopResolve = null;
  partialCb = null;
  cb(out);
}

/* ---------------- 插件：RecordRecognitionManager ---------------- */
var pluginManager = null;

/* ---------------- 单次录音（对讲／麦克风按钮）：停-开串行守卫 ----------------
 * WechatSI 0.3.10 是单实例：上一段识别没真正结束（onStop 未到）就再 start，
 * 插件直接回 -30011 please wait recognition finished，onStart 也不会来 ——
 * 页面看到的是「录音启动失败」，而紧接着仍有 partial，证明识别本身是好的，坏在时序。
 * 连续模式有 scheduleContRestart 的退避阶梯，单次链路原来一条都没有，所以补在这里：
 *   1) start 前若上一段还没收尾，先 stop() 推它去收尾，等 onStop 再发 start；
 *   2) 真撞上 -30011 不往上抛（页面会弹「录音启动失败」），按阶梯重试，超限才 reject。 */
var shotBusy = false;          // 插件的上一次识别还没收尾（onStop 未到）
var shotRetry = 0;             // 单次链路 -30011 重试次数（onStart 成功即清零）
var shotRetryTimer = null;
var shotIdleWaiters = [];      // 等「插件空闲」的回调，onStop 时统一唤醒
var SHOT_BUSY_BACKOFF = [0, 400, 900, 1600];
var SHOT_BUSY_MAX = SHOT_BUSY_BACKOFF.length - 1;
var SHOT_IDLE_WAIT_MS = 1500;  // 等 onStop 的上限：等不到也试一次，由阶梯兜底

function clearShotRetry() {
  if (shotRetryTimer) { clearTimeout(shotRetryTimer); shotRetryTimer = null; }
}

/** 插件已收尾（onStop 到达）：放掉所有等空闲的回调 */
function markShotIdle() {
  shotBusy = false;
  var ws = shotIdleWaiters;
  shotIdleWaiters = [];
  for (var i = 0; i < ws.length; i++) {
    try { ws[i](); } catch (e) { /* 忽略 */ }
  }
}

/** 等插件空闲再回调；已空闲立即回。最多等 SHOT_IDLE_WAIT_MS。
 *  忙的时候顺手 stop() 推它一把：只等不催的话，有的机型要干等到超时才重试。 */
function whenShotIdle(cb) {
  if (!shotBusy) { cb(); return; }
  if (!contWanted) {
    try { if (pluginManager && pluginManager.stop) pluginManager.stop(); } catch (e) { /* 忽略 */ }
  }
  var fired = false;
  var once = function () {
    if (fired) return;
    fired = true;
    var k = shotIdleWaiters.indexOf(once);
    if (k >= 0) shotIdleWaiters.splice(k, 1);
    cb();
  };
  shotIdleWaiters.push(once);
  setTimeout(once, SHOT_IDLE_WAIT_MS);
}

/** 真正发出一次单次录音 start：所有重试共用这一个出口，不许裸调 m.start() */
function issueShotStart(m) {
  if (!startReject) return;   // 页面已经放弃（松手／取消）
  m = m || pluginManager;
  if (!m) { rejectStart(new Error('录音实例不可用')); return; }
  startTimer = setTimeout(resolveStart, 2000);   // 兜底：个别机型不进 onStart
  try {
    m.start({ lang: 'zh_CN', duration: 60000 });
    shotBusy = true;
  } catch (e) {
    startResolve = null;
    clearStartTimer();
    if (startReject) { var rj = startReject; startReject = null; rj(e); }
  }
}

/* ---------------- DF-97：连续监听（自由对话通道专用） ----------------
 * 插件自带的 VAD 会在停顿后自动结束一段录音，这里在 onStop 后自动续录，
 * 形成「连续听」；与麦克风链路（start/stop 单次录音）共用同一个 manager，
 * 两种模式互斥：连续模式开启时，单次录音的回调不参与。 */
var contWanted = false;
var contOpts = null;
var contRestartTimer = null;
var contRestartAt = 0;         // 已排队的重开时刻：更早的重开可以覆盖更晚的
var contSuppressStop = false;  // 主动 stop 时吞掉随之而来的 onStop，避免误判为一句结束
var contSuppressAt = 0;        // 主动 stop 的时间，超过 1.5s 的 onStop 不再吞（防止标记滞留）
var contStartTimer = null;     // 连续模式「录音是否真的启动」看门狗
var contSetupTimer = null;     // 启动守卫：只有 start 根本没发出去时才补发（已发出就等插件）
var contStarted = false;       // 本轮连续模式是否收到过 onStart
var contStartWarned = false;   // 启动看门狗只提示一次，避免每轮刷屏
// 播报期间暂停录音（自由对话主防线）：保持连续模式上下文，只是不收音、不重录。
// 与 stopContinuous 的区别：暂停后 onStop/看门狗都不再自动续录，resumeContinuous 才重开。
var contPaused = false;
var contPausedAt = 0;
// 停-开时序守卫：WechatSI 在上一次识别没真正结束时 start() 会返回 -30011
// （please wait recognition finished），而 onStart 可能已经先回调了 —— 表现为「开录了但一个 partial 都没有」。
// 因此 start 只走 tryContStart 这一个入口，任何一条路径都不允许裸调 m.start()。
var contStarting = false;      // start() 已发出、还没等到 onStart
var contStartSent = false;     // start() 调用确实执行成功（无异常）：只是插件还没回 onStart
var contStartAt = 0;
var contStopping = false;      // 已请求 stop()、还没等到 onStop
var contStopAt = 0;
var contStopReason = '';       // 最近一次 stop 的原因：stall-endpoint / 单段超时兜底 / pause…
var contBusyUntil = 0;         // -30011 退避截止时刻
var contBusyLevel = 0;         // 退避级别（成功开录后清零）
var contLastStartAt = 0;       // 最近一次 start() 时刻（最短间隔）
var CONT_MIN_GAP_MS = 300;     // 两次 start 的最短间隔
var CONT_STOP_WAIT_MS = 1500;  // 发出 stop 后等 onStop 的上限
// 发出 start 后等 onStart 的上限。真机实测首次 onStart 本身就要 859ms，
// 所以这个阈值必须明显大于它，否则会把「插件正在起」误判成「请求丢了」而自己制造 -30011。
var CONT_START_WAIT_MS = 2500;
// 启动守卫：只在「start 根本没发出去」（被守卫挡下或抛异常）时才补发；
// 已经发出去就在等插件响应，补发只会撞 -30011。
var CONT_SETUP_RETRY_MS = 3000;
var CONT_BUSY_BACKOFF = [600, 1200, 2400, 4800, 8000]; // -30011 退避阶梯
var contWatchTimer = null;     // 停滞看门狗：插件静默死亡（无 onStart 也无 onStop）时强制重录
var contWatchRestarts = 0;
var contLastEventAt = 0;       // 最近一次插件回调时刻：判断「已在录但彻底没动静」
var contSegStartedAt = 0;      // 本段录音开始时刻
var contSegPartials = 0;       // 本段 onRecognize 回调次数：判定「partial 到底有没有来」
var contEmptySegs = 0;         // 连续「onStop 拿不到任何文本」的段数：判定插件不回结果用
var contSegErrors = 0;         // 本段 onError 次数（onStart 时清零）
var contRebuilds = 0;          // 连续重建录音实例的次数（收到有效文本即清零）
var contMgrGen = 0;            // 录音实例代次：旧实例的迟到回调按代次丢弃
var contDead = false;          // 重建多次仍失败：停止重连，等用户退出重进
var contDiagTick = 0;          // 快照节拍

/* ---------------- 端点检测（部分结果停滞 + 已有文本） ----------------
 * 真机（Android 12 / WechatSI 0.3.10）上插件不触发 VAD，而且停口后还会每秒量级
 * 重复回调同一结果 —— 所以停滞计时只能在「文本真的增长/变化」时重置，
 * 重复回调不重置，否则 5s 会被无限刷新，永远发不出去。
 * 等待窗口自适应（ft-diag16 起 5/6/7/9/10s），倒计时按 0.5s 递减；
 * 可配固定值：startContinuous({ stallMs })。
 * 这个比较只服务于计时，不丢弃任何内容、不影响上屏与交付，所以不是「按内容去重」。
 */
var CONT_STALL_MS = 5000;
var CONT_STALL_MIN_MS = 1000;
var CONT_STALL_MAX_MS = 10000;
// 自适应等待窗口（DF-103）：按「字数」分档，判定与渲染解耦，不看渲染行数 / scrollHeight。
// 字数口径：中文 / 全角计 1，半角计 0.5，空白不计（与需求「中文 1、半角 0.5」一致）。
// 分档（含上限即归本档）：≤60 字 = 3s，61~150 字 = 5s，151~200 字 = 8s；
// >200 字不再接收（由 free-talk 侧按 truncateEff 截断），此处兜底仍按 8s。
// 显示与 stop 必须同一个到期时刻，界面按整数秒递减。
var CONT_STALL_TABLE = [
  { max: 60, ms: 3000 },     // 短句：说完可能性高，快速送出
  { max: 150, ms: 5000 },    // 中长句：给足补充时间
  { max: 200, ms: 8000 }     // 长段：最长等待
];
var CONT_STALL_OVER_MS = 8000;   // >200 字兜底（正常应已被 free-talk 截断）

/** 单个 code unit 的字数权重：中文/全角 1，半角 0.5，空白 0（代理对高位按 1） */
function charWeight(c) {
  if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) return 0;
  if (c >= 0xD800 && c <= 0xDBFF) return 1;                       // 代理对高位：整对按 1
  if ((c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xFF00 && c <= 0xFFEF) ||
      (c >= 0x1100 && c <= 0x11FF) || (c >= 0xAC00 && c <= 0xD7AF) ||
      (c >= 0xF900 && c <= 0xFAFF)) return 1;
  return 0.5;
}

/** 字数口径（中文 1 / 半角 0.5），仅用于分档与截断，不依赖渲染 */
function effLen(s) {
  s = String(s || '');
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var w = charWeight(c);
    n += w;
    if (w === 1 && c >= 0xD800 && c <= 0xDBFF) i++;               // 跳过低代理
  }
  return n;
}

/** 按 effLen 口径截断到 max 字（超出部分丢弃，即「不再接收」） */
function truncateEff(s, max) {
  s = String(s || '');
  if (effLen(s) <= max) return s;
  var n = 0, out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var w = charWeight(c);
    if (n + w > max) break;
    out += s.charAt(i);
    if (w === 1 && c >= 0xD800 && c <= 0xDBFF) { out += s.charAt(i + 1); i++; }
    n += w;
  }
  return out;
}
var contStallMs = 0;           // >0 表示外部强制固定窗口（startContinuous({ stallMs })），0 = 自适应
var contStallWindow = CONT_STALL_MS;  // 本次倒数实际使用的窗口（日志与 meta 用）
var contSegWindowMax = 0;      // 本段已用过的最大窗口：新内容只允许把窗口调大，不允许调小（数字不来回跳）
var contStallTimer = null;
var contStallAt = 0;           // 停滞计时起点（= 最后一次文本变化时刻）
var contCountTimer = null;     // 倒计时节拍（每 120ms 把剩余时间报给上层）
var contLastPartialAt = 0;     // 最近一次「文本发生变化」的时刻（= 停口时刻，耗时统计用）
var contLastGap = 0;           // 上一条 partial 与这一次的间隔（判断插件回调是否滞后）
var contLastKey = '';          // 上一次文本的规范化内容（去标点/空白）：判断是否真的增长

/** 归一化：去标点与空白，只保留「内容」。仅用于判断识别文本是否真的变化。 */
function stallKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000，。！？、；：,.!?;:"'“”‘’（）()【】\[\]…—\-]/g, '');
}
// 空段重启退避：用户沉默时插件每段都为空，立刻重开只会持续丢音 + 加重插件 churn。
// 连续空段越多，重启越慢；一有语音（partial）就复位。
// 上限压到 2.5s：空段回收周期已经缩到 15s，退避再长就只是白白扩大「不收音」的空窗。
var CONT_EMPTY_BACKOFF = [300, 800, 1500, 2500];
// 录音器「启动失败」重试阶梯（-30001 record manager record failed 等）：
// 真机证据：错误路径原来固定 600ms 重排 start，绕过了 CONT_START_WAIT_MS 守卫，
// 形成「start → 立刻失败 → 600ms 后再 start」的抢占风暴（会把录音器一直卡在坏状态）。
// 现在按阶梯退避，并给连续失败上限：超过就停止重试、明确提示用户重进，不再空转。
var CONT_ERR_BACKOFF = [800, 1600, 3000, 5000, 8000, 8000];
var CONT_ERR_MAX = 6;
var contErrStreak = 0;         // 连续「启动即失败」次数（onStart 成功即清零）
var contErrUntil = 0;          // 错误退避截止时刻：看门狗在这之前不得叠加重启
var contErrFirstAt = 0;        // 本轮连续失败的起始时刻（恢复时打「用时」）
var contPlaybackWaitLogged = false; // 「等播报结束再试」同一次失败只打一条
var contStopSeen = false;      // 本次连续会话里是否真的发过 stop（日志用，避免首次 start 显示"已收到 onStop"）
// 有文本的段：最后兜底（正常路径应由停滞端点或插件 VAD 收尾，不应触达）
var CONT_SEG_MAX_MS = 20000;
// 无文本段（用户沉默 / 插件不回结果）：15s 就回收重开。
// 依据：中文口语的停顿很少超过 10s；15s 足够确认「这段真没内容」，
// 又能让「实例损坏」在 3 段内（≈1 分钟）被发现，而不是按插件 60s 自然结束拖到十几分钟。
// 这与「不要拿 15s 判死」不冲突：那条是判定插件死亡，这里只是正常的段回收。
var CONT_EMPTY_SEG_MS = 15000;
// 录音实例损坏判定：连续 N 段「onStart 成功但 0 partial」，且最近错误是 record manager 失败
// （或本段 onError 达到下限）→ 丢弃旧实例、新建一个，而不是继续 start 同一个。
var CONT_EMPTY_REBUILD_SEGS = 3;
var CONT_REBUILD_ERR_MIN = 2;
var CONT_REBUILD_MAX = 3;        // 连续重建 3 次仍失败 → 降级停止重连
var CONT_REBUILD_DELAY_MS = 900; // 重建后稍等再 start，给插件释放旧的录音句柄


/* 诊断计数：真机排查用，随 stats() 暴露给页面 */
var contStats = { starts: 0, partials: 0, finals: 0, errors: 0, lastPartial: '', lastFinal: '', lastError: '' };

function clearContStartTimer() {
  if (contStartTimer) { clearTimeout(contStartTimer); contStartTimer = null; }
}

function clearContSetupTimer() {
  if (contSetupTimer) { clearTimeout(contSetupTimer); contSetupTimer = null; }
}

function clearStallTimer() {
  if (contStallTimer) { clearTimeout(contStallTimer); contStallTimer = null; }
  if (contCountTimer) { clearInterval(contCountTimer); contCountTimer = null; }
}

/** 通知上层清掉倒计时（-1 = 取消，0 = 到点） */
function notifyCountdown(remain, total) {
  if (!contOpts || typeof contOpts.onCountdown !== 'function') return;
  try { contOpts.onCountdown(remain, total); } catch (e) { /* 上层异常不影响录音 */ }
}

function clearCountdown(notify) {
  var had = !!contCountTimer;
  clearStallTimer();
  if (notify && had) notifyCountdown(-1, contStallMs);
}

/**
 * 本次倒数该等多久：外部固定值优先，否则按「是否已说完 + 字数」自适应。
 * @param {string} text 本段当前文本
 */
function stallBaseFor(text) {
  var n = effLen(text);
  for (var i = 0; i < CONT_STALL_TABLE.length; i++) {
    if (n <= CONT_STALL_TABLE[i].max) return CONT_STALL_TABLE[i].ms;
  }
  return CONT_STALL_OVER_MS;
}

function stallWindowFor(text) {
  if (contStallMs > 0) return contStallMs;                 // 外部强制固定窗口
  // DF-103：分档值即实际窗口（3/5/8s），不再额外叠加滞后补偿
  return Math.max(CONT_STALL_MIN_MS, Math.min(CONT_STALL_MAX_MS, stallBaseFor(text)));
}

/** 分档说明（只用于日志，让人一眼看出这次为什么等这么久） */
function stallTierLabel(text) {
  if (contStallMs > 0) return '外部固定 ' + contStallMs + 'ms';
  var base = stallBaseFor(text);
  var n = effLen(text);
  for (var i = 0; i < CONT_STALL_TABLE.length; i++) {
    if (n <= CONT_STALL_TABLE[i].max) return '≤' + CONT_STALL_TABLE[i].max + '字 → ' + base + 'ms';
  }
  return '>200字 → ' + base + 'ms';
}

/**
 * 每次拿到「有变化」的 partial 就重置停滞计时：用户还在说，端点不存在。
 * 只有「已有文本 + 停滞满窗口」才主动 stop；没有文本（纯沉默）永远不触发。
 */
function armStall() {
  var prevWindow = !!contStallTimer || !!contCountTimer;   // 之前还有一个倒数在跑
  var prevTotal = contStallWindow;
  clearStallTimer();
  if (!contWanted || contPaused || !contStarted || contStopping) return;
  var text = String(contStats.lastPartial || '');
  if (!text.trim()) return;   // 无文本 → 不启动倒计时
  var total = stallWindowFor(text);
  // 同一段内窗口只上调、不下调：文本继续增长时起始值可以变大，但不允许数字突然变小
  if (total > contSegWindowMax) contSegWindowMax = total;
  else total = contSegWindowMax;
  contStallWindow = total;
  contStallAt = Date.now();
  var len = effLen(text);
  if (prevWindow) {
    console.log('[asr-diag] 发送窗口重算（用户继续说话）| 上一次 =', prevTotal + 'ms',
      '| 新窗口 =', total + 'ms', '| 字数 =', len, '| 距上条 partial =', contLastGap + 'ms',
      '| 分档 =', stallTierLabel(text));
  } else {
    console.log('[asr-diag] 发送窗口开始 | 倒计时 =', total + 'ms',
      '| 字数 =', len, '| 距上条 partial =', contLastGap + 'ms',
      '| 分档 =', stallTierLabel(text));
  }
  if (contOpts && typeof contOpts.onCountdown === 'function') {
    notifyCountdown(total, total);
    contCountTimer = setInterval(function () {
      var left = total - (Date.now() - contStallAt);
      if (left <= 0) return;
      notifyCountdown(left, total);
    }, 120);
  }
  contStallTimer = setTimeout(function () {
    contStallTimer = null;
    if (contCountTimer) { clearInterval(contCountTimer); contCountTimer = null; }
    if (!contWanted || contPaused || contStopping) return;
    if (!contStarted) return;
    var text = String(contStats.lastPartial || '').trim();
    if (!text) return;   // 兜底：没有文本绝不因停滞而 stop
    notifyCountdown(0, total);
    console.log('[asr-diag] 倒计时到点 → 主动 stop 取 final | 窗口 =', total + 'ms',
      '| 距最后一次文本变化 =', (Date.now() - contStallAt) + 'ms',
      '| 本段 partial 次数 =', contSegPartials,
      '| 已有文本 len =', text.length, '| 不等 20s 兜底');
    requestContStop('stall-endpoint');
    scheduleContRestart(CONT_STOP_WAIT_MS + 100, 'after-stall-stop');
  }, total);
}

/** 空段重启间隔：连续空段越多越慢，有语音后由 onRecognize 复位 contEmptySegs */
function contEmptyBackoffMs() {
  var i = Math.min(Math.max(contEmptySegs - 1, 0), CONT_EMPTY_BACKOFF.length - 1);
  return CONT_EMPTY_BACKOFF[i];
}

/** 把录音异常提示交给上层（显示在用户文字区，不弹窗、不静默） */
function notifyAsrStatus(text) {
  if (!contOpts || typeof contOpts.onStatus !== 'function') return;
  try { contOpts.onStatus(text); } catch (e) { /* 上层异常不影响录音状态机 */ }
}

/**
 * 丢弃旧录音实例：解绑回调 + 停一次，再让 ensurePluginManager 新建。
 * 注意：WechatSI 的 getRecordRecognitionManager 可能是单例，
 * 若拿回同一个对象，只能做「软重建」（重绑回调 + 复位状态），日志会写明。
 */
function discardPluginManager(reason) {
  var old = pluginManager;
  if (!old) return null;
  pluginManager = null;
  try {
    old.onStart = null;
    old.onStop = null;
    old.onError = null;
    old.onRecognize = null;
  } catch (e) { /* 忽略 */ }
  try { old.stop(); } catch (e) { /* 旧实例可能已死，忽略 */ }
  console.warn('[asr-diag] 丢弃旧录音实例 | 原因 =', reason || '-', '| 原代次 =', contMgrGen);
  return old;
}

/**
 * 重建录音实例：丢弃旧的 → 新建/重绑 → 复位时序 → 稍后重新 start。
 * 连续重建超过上限则降级，不再无限循环。
 */
function rebuildPluginManager(reason) {
  if (!contWanted || contDead) return false;
  if (contRebuilds >= CONT_REBUILD_MAX) {
    degradeRecorder(reason);
    return false;
  }
  contRebuilds++;
  var empty = contEmptySegs;
  var old = discardPluginManager(reason);
  // 与旧实例相关的一次性时序全部复位，避免新实例被旧的「停/开在途」标记卡住
  contStarted = false;
  contStarting = false;
  contStartSent = false;
  contStopping = false;
  contEmptySegs = 0;
  contSegErrors = 0;
  contBusyUntil = 0;
  contBusyLevel = 0;
  clearStallTimer();
  clearCountdown(true);
  var m = ensurePluginManager();
  console.error('[asr-alarm] 已重建录音实例 | 第', contRebuilds + '/' + CONT_REBUILD_MAX, '次',
    '| 原因 =', reason || '-',
    '| 连续空段 =', empty,
    '| 累计 onError =', contStats.errors,
    '| lastErr =', contStats.lastError || '-',
    '| 新实例 =', m ? (m === old ? '否（插件单例，已重绑回调）' : '是') : '否（获取失败）',
    '| 延时启动 =', CONT_REBUILD_DELAY_MS + 'ms');
  notifyAsrStatus('麦克风异常，正在重连');
  scheduleContRestart(CONT_REBUILD_DELAY_MS, 'after-rebuild');
  return true;
}

/** 重建/重试多次仍失败：停止重连并明确提示，不再静默空转 */
function degradeRecorder(reason, msg) {
  if (contDead) return;
  contDead = true;
  if (contRestartTimer) { clearTimeout(contRestartTimer); contRestartTimer = null; }
  contRestartAt = 0;
  contStarting = false;
  contStartSent = false;
  contStopping = false;
  contStarted = false;
  clearStallTimer();
  clearCountdown(true);
  console.error('[asr-alarm] 连续重建', contRebuilds, '次 / 连续启动失败', contErrStreak, '次 → 降级停止重连',
    '| 原因 =', reason || '-',
    '| 累计 onError =', contStats.errors,
    '| lastErr =', contStats.lastError || '-',
    '| 处理 = 请用户退出后重新进入对话');
  notifyAsrStatus(msg || '麦克风异常，请退出后重新进入对话');
}

function ensurePluginManager() {
  if (pluginManager) return pluginManager;
  return bindPluginManager();
}

/**
 * 新建并绑定一个录音实例。
 * 实例重建（record manager failed / 锁屏回前台）也走这里：
 * 旧实例先解绑并 stop，新实例代次 +1，旧实例的迟到回调按代次丢弃。
 */
function bindPluginManager() {
  var m = plugin.getRecordRecognitionManager();
  pluginManager = m;
  contMgrGen++;
  var gen = contMgrGen;
  function alive() { return pluginManager === m; }

  m.onStart = function () {
    if (!alive()) { console.warn('[asr-diag] 忽略旧录音实例回调 | onStart | 代次 =', gen); return; }
    var wasStarting = contStarting;   // 这次 onStart 是否对应一条在途的 start
    var waitMs = wasStarting && contStartAt ? (Date.now() - contStartAt) : 0;
    contStarted = true;
    contStarting = false;
    contStartSent = false;
    contLastEventAt = Date.now();
    clearContStartTimer();
    clearContSetupTimer();
    if (contWanted) {
      if (contErrFirstAt) {
        // 恢复判据：下次真机再出现 -30001，用这一条直接看「撞了多少次、用了多久才自己好」
        console.warn('[asr-diag] 录音恢复 | 连续失败次数 =', contErrStreak,
          '| 用时 =', (Date.now() - contErrFirstAt) + 'ms',
          '| 恢复后实例代次 =', contMgrGen,
          '| 说明 = 期间没有换实例，是录音器自己从失败态恢复');
        contErrFirstAt = 0;
      }
      if (contErrStreak) {
        console.log('[asr-diag] 录音器已恢复 | 连续启动失败计数清零（原 =', contErrStreak + '）');
      }
      contErrStreak = 0;
      contErrUntil = 0;
      contPlaybackWaitLogged = false;
      contSegWindowMax = 0;   // 新的一段：窗口从该段自己的档位重新起算
      contStats.starts++;
      // 真正开录成功：忙退避复位（下次再遇到 -30011 从最短窗口重算）
      contBusyLevel = 0;
      contSegStartedAt = Date.now();
      contSegPartials = 0;
      contSegErrors = 0;
      contLastPartialAt = 0;
      contLastKey = '';
      clearCountdown(true);       // 新段开始：上一段的停滞倒计时作废（同时撤掉界面小字）
      console.log('[asr] cont onStart #' + contStats.starts);
      if (waitMs) {
        // 插件首次启动本身就要几百毫秒：记下来，便于判断启动守卫的阈值是否还要放宽
        console.log('[asr-diag] onStart 响应耗时 =', waitMs + 'ms | 期间未补发 start = yes');
      }
      console.log('[asr-diag] 录音已起（插件级 onStart）| seg =', contStats.starts);
      if (contOpts && typeof contOpts.onStart === 'function') {
        try { contOpts.onStart(); } catch (e) { /* 忽略 */ }
      }
      return;
    }
    console.log('[asr] plugin recorder started');
    shotBusy = true;
    shotRetry = 0;
    resolveStart();
  };

  // 实时结果：每次都是“当前这句”的累计文本，直接整体替换
  m.onRecognize = function (res) {
    if (!alive()) return;
    var t = (res && res.result) || '';
    if (!t) return;
    if (contWanted) {
      contStats.partials++;
      contSegPartials++;
      contStats.lastPartial = t;
      contLastEventAt = Date.now();
      // 关键：只有文本真的增长/变化才重置停滞计时。
      // 真机上插件停口后会每秒量级重复回调同一结果，若每次都重置，
      // 倒计时会被无限打回 5，永远发不出去。
      // 比较的是「去标点/空白后的内容」：仅尾部标点抖动（你好 → 你好，）也不算变化。
      // 这个比较只用于「何时收尾」，不丢弃任何内容，也不参与上屏/交付，故不是内容去重。
      var key = stallKey(t);
      var changed = (key !== contLastKey);
      contLastKey = key;
      if (changed) {
        contLastGap = contLastPartialAt ? (Date.now() - contLastPartialAt) : 0;
        contLastPartialAt = Date.now();
        if (contEmptySegs) contEmptySegs = 0;   // 有语音了：空段退避复位
        if (contRebuilds) contRebuilds = 0;     // 实例已恢复正常：连续重建计数清零
      }
      if (contStats.partials <= 3 || contStats.partials % 10 === 0) {
        console.log('[asr-diag] onRecognize#' + contStats.partials, '| len =', String(t).length,
          '| 内容变化 =', changed ? 'yes' : 'no（重复回调，不重置倒计时）');
      }
      if (contOpts && typeof contOpts.onPartial === 'function') {
        try { contOpts.onPartial(t); } catch (e) { /* 上层异常不影响录音 */ }
      }
      // 端点检测：文本有变化 → 重新开始 5s 倒数；重复回调只让原计时继续走
      if (changed) armStall();
      return;
    }
    partialCount++;
    if (partialCount === 1) console.log('[asr] partial#1', t);
    finalText = t;
    if (partialCb) {
      try { partialCb(t); } catch (e) { /* 上层 setData 异常不影响录音 */ }
    }
  };

  m.onStop = function (res) {
    if (!alive()) { console.warn('[asr-diag] 忽略旧录音实例回调 | onStop | 代次 =', gen); return; }
    // 部分机型 onStop 的 result 为空，但 onRecognize 已经给过中间结果：
    // 这种情况下用最后一段中间结果兜底，避免「识别到了却没发出去」。
    // 连续模式只认本轮中间结果，绝不能回退到单次录音留下的 finalText（会把上一句话重复发出去）。
    var isCont = contWanted;
    var t = (res && res.result) || '';
    if (isCont) {
      if (!t) t = contStats.lastPartial || '';
    } else {
      if (!t) t = finalText || '';
      finalText = t;
    }
    finalPath = (res && res.tempFilePath) || finalPath || '';
    if (isCont) {
      // 收到 onStop 才能认为「上一段识别真正结束」，此后才允许 start 下一段
      // ft-diag16：先把「倒计时还剩多少」记下来。若还没到 0 就被收尾（插件 VAD / 兜底），
      // 界面必须先归 0 再发送，不能停在 1.5 直接跳成一条消息。
      var leftAtStop = contCountTimer ? Math.max(0, contStallAt + contStallWindow - Date.now()) : 0;
      clearStallTimer();
      contStopping = false;
      contStarting = false;
      // 先把本次 stop 的来源取走并清空，避免下一段（插件自行收尾）误用上一次的 stopAt
      var stopAtUsed = contStopAt;
      var stopByUsed = contStopAt ? (contStopReason || 'manual') : 'plugin';
      contStopAt = 0;
      contStopReason = '';
      if (contPaused) {
        // 播报期间主动停的：本段内容一定是扬声器回录，整段丢弃，也不续录
        contSuppressStop = false;
        contStarted = false;
        contStats.lastPartial = '';
        console.log('[asr] cont onStop 在暂停期到达，整段丢弃（不续录）');
        return;
      }
      if (contSuppressStop && Date.now() - contSuppressAt < 1500) {
        contSuppressStop = false;
        contStarted = false;
        console.log('[asr] cont onStop suppressed (主动停止)');
        return;
      }
      contSuppressStop = false;
      contStarted = false;
      if (contDead) {
        // 已降级停止重连：这个 onStop 是最后那次失败 start 的残响，绝不能再排重开
        contStats.lastPartial = '';
        console.warn('[asr-diag] onStop 到达（已降级停止重连）| 忽略，不再重开');
        return;
      }
      // 启动失败退避期间的 onStop 只是失败 start 的残响：不参与空段/重开逻辑，
      // 否则它的「空段 300ms 重开」会覆盖 after-error 的递增退避，退化成 300ms 空转。
      if (contErrStreak > 0 && !contDead) {
        contStats.lastPartial = '';
        console.warn('[asr-diag] onStop 到达（处于启动失败退避中）| 不排重开，交给退避计时 | 连续失败 =',
          contErrStreak, '| 退避剩余 =', Math.max(0, contErrUntil - Date.now()) + 'ms');
        return;
      }
      contLastEventAt = Date.now();
      contStats.finals++;
      contStats.lastFinal = t;
      console.log('[asr] cont onStop #' + contStats.finals, '| textLen =', String(t || '').trim().length);
      var trimmed = String(t || '').trim();
      console.log('[asr-diag] onStop #' + contStats.finals,
        '| 时长 =', ((Date.now() - contSegStartedAt) / 1000).toFixed(1) + 's',
        '| partial次数 =', contSegPartials,
        '| resultLen =', String((res && res.result) || '').trim().length,
        '| partialLen =', String(contStats.lastPartial || '').length,
        '| 有文本 =', trimmed ? 'yes' : 'NO');
      if (!trimmed) {
        contEmptySegs++;
        // 空段不是「用户说完了一句」，是插件没给任何文本：
        // 单独计数并与「真·静音」区分开，避免被当成一次输入。
        console.warn('[asr-diag] 空段 #' + contEmptySegs,
          '| partial次数 =', contSegPartials,
          '| 判定 =', contSegPartials ? '有中间结果但 final 为空（已用中间结果兜底）' : '完全无输入',
          contSegPartials ? '' : '| 不产生任何用户事件',
          '| 重启间隔 =', contEmptyBackoffMs() + 'ms（空段退避）');
        if (contEmptySegs === 3) {
          console.error('[asr-diag] 结论：连续 3 段都在录却拿不到任何文本 → 断点在【插件识别回调】这一层，不在 UI 渲染');
        }
        // 实例损坏判定：不是「用户没说话」，而是录音句柄已经废了。
        // 判据：连续 N 段 onStart 成功但 0 partial，且最近错误是 record manager 失败
        //（或本段 onError 达到下限）。此时继续 start 同一个实例只会无限空转。
        var mgrFailed = /record manager|record failed|record fail|录音失败/i.test(contStats.lastError || '');
        if (!contDead && contEmptySegs >= CONT_EMPTY_REBUILD_SEGS
          && (mgrFailed || contSegErrors >= CONT_REBUILD_ERR_MIN)) {
          console.error('[asr-alarm] 连续', contEmptySegs, '段 onStart 成功但 0 partial',
            '| 本段 onError =', contSegErrors, '| 累计 onError =', contStats.errors,
            '| lastErr =', contStats.lastError || '-',
            '| 判定 = 录音实例已损坏（不是用户沉默）');
          rebuildPluginManager('空段 + record manager 失败');
          return;   // 不再按空段退避重开旧实例
        }
      } else {
        contEmptySegs = 0;
        contRebuilds = 0;   // 有正常文本：实例是好的
      }
      contStats.lastPartial = '';
      if (trimmed) {
        // 收尾来源追踪：正常应是 stall-endpoint 且「距最后一次内容变化 ≈ 窗口」。
        // 若来源是 plugin（插件 VAD 自己收尾）或明显早于窗口，说明还有别的路径在提前 stop。
        var sinceLast = contLastPartialAt ? (Date.now() - contLastPartialAt) : -1;
        var early = sinceLast >= 0 && sinceLast < contStallWindow - 200;
        console.warn('[asr-diag] 收尾 | 来源 =', stopByUsed,
          '| 距最后一次内容变化 =', sinceLast + 'ms',
          '| 本次窗口 =', contStallWindow + 'ms',
          '| 早于窗口 =', early
            ? ('yes（' + (stopByUsed === 'plugin' ? '插件 VAD 自动收尾，不是代码 stop' : '异常提前收尾') + '）')
            : 'no');
        // ft-diag16：提前收尾时把界面先归 0，保证「数字到 0 → 发送」的顺序；
        // 日志里同时给出剩余量，下次真机一看就知道抢跑发生在还剩几秒。
        if (leftAtStop > 0) {
          console.error('[asr-alarm] 倒计时未到 0 就收尾 | 来源 =', stopByUsed,
            '| 剩余 =', leftAtStop + 'ms', '| 本次窗口 =', contStallWindow + 'ms');
          notifyCountdown(0, contStallWindow);
        }
      }
      if (trimmed && contOpts && typeof contOpts.onFinal === 'function') {
        // 带上录音侧时间戳：上层用来算「停口→stop / stop→final」，
        // 一眼看出等待是花在录音侧还是回复侧。
        // stopBy：stall-endpoint（正常） / timeout（20s 兜底） / plugin（插件自己收尾）。
        // 后两种没有「我们主动 stop 的时刻」，用 onStop 时刻兜底并标明来源，绝不填 0 冒充。
        var meta = {
          stopAt: stopAtUsed || 0,
          stopBy: stopByUsed,
          lastPartialAt: contLastPartialAt || 0,
          onStopAt: Date.now(),
          segStartedAt: contSegStartedAt || 0,
          stallMs: contStallWindow
        };
        try { contOpts.onFinal(trimmed, meta); } catch (e) { /* 上层异常不影响续录 */ }
      }
      // 停→开必须等本回调结束（这里就是「识别真正结束」的时点），再留最短间隔。
      // 空段（用户沉默）按阶梯拉长间隔，避免每段都立刻重开造成持续丢音与插件 churn。
      scheduleContRestart(trimmed ? 300 : contEmptyBackoffMs(), 'after-onStop');
      return;
    }
    markShotIdle();   // 单次链路：这一段识别真正收尾了，下一次 start 才允许发
    finishStop({
      text: t,
      filePath: finalPath,
      duration: (res && res.duration) || 0
    });
  };

  m.onError = function (res) {
    if (!alive()) { console.warn('[asr-diag] 忽略旧录音实例回调 | onError | 代次 =', gen); return; }
    var msg = (res && (res.msg || res.errMsg)) || '语音识别出错';
    lastError = msg;
    var errPlayback = false;
    try {
      errPlayback = !!(contOpts && typeof contOpts.isPlaybackActive === 'function' && contOpts.isPlaybackActive());
    } catch (e) { errPlayback = false; }
    console.error('[asr] plugin error | retcode =', (res && res.retcode), '| msg =', msg,
      '| 播报中 =', errPlayback ? 'yes' : 'no',
      '| 本次 start 收到 onStart =', contStarted ? 'yes' : 'no',
      '| 实例代次 =', contMgrGen);
    if (contWanted) {
      contSegErrors++;
      contStats.errors++;
      contStats.lastError = msg;
      var wasStarting = contStarting;
      contStarting = false;
      clearCountdown(true);   // 出错：把倒计时从界面上撤掉
      // -30011（please wait recognition finished）：上一段识别还没收尾就被 start 撞上。
      // 这不是「插件坏了」，立即重试只会继续被拒，必须退避到插件空闲；也不该弹提示给用户。
      var busy = (res && res.retcode === -30011) || /please wait recognition finished|-30011/i.test(msg);
      if (busy) {
        var wait = bumpBusy(msg);
        console.warn('[asr-diag] 插件忙（-30011）→ 退避重试 | 第', contStats.busy, '次',
          '| 等待 =', wait + 'ms', '| 等收尾 =', contStopping ? 'yes' : 'no');
        // 若此前已请求 stop，继续等 onStop；否则等退避窗口即可
        scheduleContRestart(wait, 'busy-backoff');
        return;
      }
      var fatal = /auth|permission|deny|denied|not authorized|权限|授权/i.test(msg);
      if (fatal) {
        if (contOpts && typeof contOpts.onError === 'function') {
          try { contOpts.onError(new Error(msg), true); } catch (e) { /* 忽略 */ }
        }
        stopContinuous();
        return;
      }
      contStarted = false;   // 出错即认为本轮录音已死
      contErrStreak++;
      if (!contErrFirstAt) contErrFirstAt = Date.now();
      var errWait = CONT_ERR_BACKOFF[Math.min(contErrStreak - 1, CONT_ERR_BACKOFF.length - 1)];
      contErrUntil = Date.now() + errWait;
      // -30001 / record manager：录音器根本没起来。真机证据：错误路径原来固定 600ms 重排 start，
      // 既绕过 CONT_START_WAIT_MS 守卫，也永远触达不了「空段 3 次才判实例损坏」，于是空转。
      var startFail = (res && res.retcode === -30001)
        || /record manager|record failed|record fail|录音失败|启动录音/i.test(msg);
      console.error('[asr-alarm]', startFail ? '录音器启动失败' : '录音错误',
        '| retcode =', (res && res.retcode),
        '| 第', contErrStreak + '/' + CONT_ERR_MAX, '次',
        '| 退避 =', errWait + 'ms',
        '| 播报中 =', errPlayback ? 'yes（等播报结束再抢录音器）' : 'no',
        '| start 在途 =', wasStarting ? 'yes（插件还没回 onStart）' : 'no',
        '| 判定 =',
        errPlayback ? '音频焦点/录音器被播报占用（时序冲突）' : '录音器未就绪或被其它录音句柄占用（非用户语音问题）');
      // -30001 且上一条 start 还在途：插件句柄没释放，光退避再 start 只会继续撞 -30001。
      // 直接重建实例（丢弃旧句柄 → 重绑回调 → 延时 start），别把 6 次退避白白耗光。
      if (startFail && wasStarting && contRebuilds < CONT_REBUILD_MAX) {
        rebuildPluginManager('启动失败且 start 在途（-30001）');
        return;
      }
      if (contErrStreak >= CONT_ERR_MAX) {
        degradeRecorder('连续 ' + contErrStreak + ' 次' + (startFail ? '录音器启动失败' : '录音错误'),
          startFail ? '麦克风启动失败，请退出对话后重新进入' : '麦克风异常，请退出对话后重新进入');
        return;
      }
      // 同一次连续失败只提示一次，避免重试把提示刷屏
      if (contErrStreak === 1 && contOpts && typeof contOpts.onError === 'function') {
        try { contOpts.onError(new Error(msg), false); } catch (e) { /* 忽略 */ }
      }
      notifyAsrStatus('麦克风启动失败，正在重试（第 ' + contErrStreak + ' 次）');
      scheduleContRestart(errWait, 'after-error-backoff');
      return;
    }
    // 单次链路撞 -30011（上一段识别还没收尾）不往上抛：页面会弹「录音启动失败」，
    // 而紧接着 partial 照样来，证明识别本身是好的、坏的只是时序。按阶梯重试，超限才 reject。
    var shotBusyErr = (res && res.retcode === -30011) || /please wait recognition finished|-30011/i.test(msg);
    if (shotBusyErr && startReject) {
      shotBusy = true;
      if (shotRetry < SHOT_BUSY_MAX) {
        var shotWait = SHOT_BUSY_BACKOFF[++shotRetry] || 400;
        console.warn('[asr] 单次录音撞 -30011 → 第', shotRetry, '次重试，等待', shotWait + 'ms');
        clearStartTimer();
        clearShotRetry();
        shotRetryTimer = setTimeout(function () {
          shotRetryTimer = null;
          if (!startReject) return;   // 页面已经放弃（松手／取消）
          try { if (pluginManager && pluginManager.stop) pluginManager.stop(); } catch (e) { /* 忽略 */ }
          issueShotStart(pluginManager);
        }, shotWait);
        return;
      }
      console.warn('[asr] 单次录音 -30011 重试', shotRetry, '次仍忙，交回页面');
    }
    // 还在启动阶段：直接让 start() 失败，页面走权限/重试提示
    if (startReject) {
      rejectStart(new Error(msg));
    }
    // 已经开始录音：按“结束”处理，把已拿到的中间文本交回页面
    finishStop({ error: msg });
  };

  return m;
}

/* ---------------- 兜底：RecorderManager（原有链路） ---------------- */
var recorder = null;
var recorderBound = false;

function ensureRecorder() {
  if (recorder) return recorder;
  recorder = wx.getRecorderManager();
  return recorder;
}

function bindRecorder() {
  if (recorderBound) return;
  recorderBound = true;
  var m = ensureRecorder();

  m.onStart(function () {
    console.log('[asr] recorder started');
    resolveStart();
  });

  m.onStop(function (res) {
    finalPath = (res && res.tempFilePath) || '';
    finishStop({ text: '', filePath: finalPath, duration: (res && res.duration) || 0 });
  });

  m.onError(function (err) {
    var msg = (err && err.errMsg) || '录音失败';
    lastError = msg;
    console.error('[asr] recorder error', err);
    if (startReject) rejectStart(new Error(msg));
    finishStop({ error: msg });
  });

  m.onInterruptionBegin(function () {
    console.warn('[asr] recorder interrupted (系统占用麦克风)');
  });
}

/* ---------------- 对外：开始 ---------------- */
/**
 * @param {(text:string)=>void} [onPartial] 插件模式下的实时识别回调
 */
function start(onPartial) {
  partialCb = typeof onPartial === 'function' ? onPartial : null;
  partialCount = 0;
  finalText = '';
  finalPath = '';
  lastError = '';
  console.log('[asr] start | mode =', getMode());

  if (getMode() === 'plugin') return startPlugin();
  return startRecorder();
}

function startPlugin() {
  var m = ensurePluginManager();
  shotRetry = 0;
  clearShotRetry();
  return new Promise(function (resolve, reject) {
    startResolve = resolve;
    startReject = reject;
    // 上一段还没收尾就裸 start 必撞 -30011：先等插件空闲（onStop），再发 start
    whenShotIdle(function () { issueShotStart(m); });
  });
}

function startRecorder() {
  bindRecorder();
  var m = ensureRecorder();
  return new Promise(function (resolve, reject) {
    startResolve = resolve;
    startReject = reject;
    startTimer = setTimeout(resolveStart, 2000);
    try {
      m.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3',
        frameSize: 20
      });
    } catch (e) {
      startResolve = null;
      clearStartTimer();
      reject(e);
    }
  });
}

/* ---------------- 对外：停止 ---------------- */
/** @returns {Promise<{text:string, filePath:string, duration:number, error:string}>} */
function stop() {
  if (getMode() === 'plugin' && pluginManager) return stopPlugin();
  return stopRecorder();
}

function stopPlugin() {
  return new Promise(function (resolve) {
    stopResolve = resolve;
    try {
      pluginManager.stop();
    } catch (e) {
      finishStop({ error: (e && e.message) || '停止录音失败' });
      return;
    }
    // 兜底：8s 内没收到 onStop 就用已有中间结果收尾
    stopTimer = setTimeout(function () { finishStop({}); }, 8000);
  });
}

function stopRecorder() {
  bindRecorder();
  var m = ensureRecorder();
  return new Promise(function (resolve) {
    stopResolve = resolve;
    try {
      m.stop();
    } catch (e) {
      finishStop({});
      return;
    }
    stopTimer = setTimeout(function () { finishStop({}); }, 5000);
  });
}

/* ---------------- 对外：整段识别（仅兜底/补救） ---------------- */
/**
 * 上传音频识别文字（插件不可用、或插件只给了临时文件没给文本时使用）
 * @returns {Promise<{text:string, source:string}>}
 */
function recognize(filePath, lang) {
  if (!filePath) return Promise.reject(new Error('没有录到音频'));
  var header = {};
  var token = api.getToken();
  if (token) header.Authorization = 'Bearer ' + token;
  return new Promise(function (resolve, reject) {
    wx.uploadFile({
      url: env.getApiBase() + '/speech/asr',
      filePath: filePath,
      name: 'audio', // 必须与后端 UploadFile 形参 audio 一致
      formData: { lang: lang || 'zh' },
      header: header,
      timeout: 60000,
      success: function (res) {
        var body = res.data;
        try { body = JSON.parse(body); } catch (e) { /* 保持字符串 */ }
        if (res.statusCode === 200 && body && body.text) {
          resolve({ text: String(body.text).trim(), source: body.source || '' });
          return;
        }
        var detail = (body && (body.detail || body.msg)) || ('识别失败 HTTP ' + res.statusCode);
        reject(new Error(formatAsrError(res.statusCode, detail)));
      },
      fail: function (err) {
        reject(new Error('上传失败：' + ((err && err.errMsg) || '网络异常')));
      }
    });
  });
}

/* ---------------- 对外：连续监听（DF-97 自由对话通道） ---------------- */

/** -30011 退避：返回本次应等待的毫秒数（阶梯式，成功开录后由 onStart 清零） */
function bumpBusy(detail) {
  contStats.busy = (contStats.busy || 0) + 1;
  var lv = Math.min(contBusyLevel, CONT_BUSY_BACKOFF.length - 1);
  var ms = CONT_BUSY_BACKOFF[lv];
  contBusyLevel++;
  contBusyUntil = Date.now() + ms;
  contStats.lastBusyAt = Date.now();
  return ms;
}

/**
 * 唯一的 start 入口：所有重启路径都必须经过这里。
 * 守住三条，避免再现「onStart 已回但 0 partial / 17s 空录」的 -30011 死循环：
 *   1. 上一段识别没真正结束（还没收到 onStop）不发 start；
 *   2. start 请求在途（还没等到 onStart）不重复发；
 *   3. -30011 退避窗口内不发，且两次 start 之间留最短间隔。
 */
function tryContStart(reason) {
  if (!contWanted || contPaused || contDead) return false;
  var m = pluginManager;
  if (!m) return false;
  if (contStarted) return false;              // 已在录
  if (contStarting) {                          // 上一条 start 还没回 onStart
    scheduleContRestart(400, 'wait-onStart');
    return false;
  }
  if (contStopping) {
    var left = CONT_STOP_WAIT_MS - (Date.now() - contStopAt);
    if (left > 0) {
      scheduleContRestart(left + 30, 'wait-onStop');
      return false;
    }
    // 发了 stop 却等不到 onStop：不能再等（会永久卡死），按「插件忙」退避，且比常规更久
    contStopping = false;
    bumpBusy('stop 后等不到 onStop');
  }
  var now = Date.now();
  if (now < contBusyUntil) {
    scheduleContRestart(contBusyUntil - now, 'busy-window');
    return false;
  }
  // 启动失败重试期间：如果上层还在播报（问候语/回复），先等播报结束再抢录音器。
  // 真机：播报期 start 更容易 -30001，且这个窗口里的重试会持续失败，等于自己延长坏状态。
  if (contErrStreak > 0 && contOpts && typeof contOpts.isPlaybackActive === 'function') {
    var playing = false;
    try { playing = !!contOpts.isPlaybackActive(); } catch (e) { playing = false; }
    if (playing) {
      if (!contPlaybackWaitLogged) {
        contPlaybackWaitLogged = true;
        console.warn('[asr-diag] 启动失败重试暂缓 | 等播报结束再 start | 连续失败 =', contErrStreak);
      }
      scheduleContRestart(400, 'wait-playback');
      return false;
    }
  }
  var gap = CONT_MIN_GAP_MS - (now - contLastStartAt);
  if (gap > 0) {
    scheduleContRestart(gap, 'min-gap');
    return false;
  }
  var sincePrev = contLastStartAt ? (now - contLastStartAt) : -1;
  contLastStartAt = now;
  contStarting = true;
  contStartSent = false;
  contStartAt = now;
  // 关键日志：能看出这次 start 是在上一段 onStop 之后发的
  console.log('[asr] cont start | reason =', reason,
    '| 距上次 start =', sincePrev >= 0 ? sincePrev + 'ms' : '-',
    '| 已收到 onStop =', contStopping ? 'no（仍在等）' : (contStopSeen ? 'yes' : '首次（本次会话还没 stop 过）'),
    '| 实例代次 =', contMgrGen,
    '| 连续启动失败 =', contErrStreak + '/' + CONT_ERR_MAX);
  try {
    m.start({ lang: 'zh_CN', duration: 60000 });
    // 调用没抛异常 = 请求已经交给插件，只是在等它回 onStart。
    // 这个标记决定启动守卫要不要补发：已发出就绝不补发（补发必撞 -30011）。
    contStartSent = true;
    return true;
  } catch (e) {
    contStarting = false;
    contStartSent = false;
    scheduleContRestart(400, 'start-throw');
    return false;
  }
}

/** 请求停止当前段：设置「等 onStop」标记，onStop 到达后才允许下一次 start */
function requestContStop(reason) {
  if (!pluginManager) return;
  contStopSeen = true;
  var sinceChange = contLastPartialAt ? (Date.now() - contLastPartialAt) : -1;
  console.warn('[asr-diag] 收尾 | 来源 =', String(reason || 'manual'),
    '| 距最后一次内容变化 =', sinceChange + 'ms',
    '| 本次窗口 =', contStallWindow + 'ms',
    '| 早于窗口 =', (sinceChange >= 0 && sinceChange < contStallWindow - 200) ? 'yes（异常提前收尾，需查调用方）' : 'no');
  // ft-diag16：倒计时还没走到 0 就收尾时，界面不能停在 1.5 直接跳到发送。
  // 先打告警（下一次真机日志能直接看到是哪条路径抢跑），再让显示归 0，保证「显示 → 0 → 发送」的顺序。
  var leftAtStop = contCountTimer ? Math.max(0, contStallAt + contStallWindow - Date.now()) : 0;
  if (leftAtStop > 0) {
    console.error('[asr-alarm] 倒计时未到 0 就收尾 | 来源 =', String(reason || 'manual'),
      '| 剩余 =', leftAtStop + 'ms', '| 本次窗口 =', contStallWindow + 'ms');
    notifyCountdown(0, contStallWindow);
  }
  contStopping = true;
  contStopAt = Date.now();
  contStopReason = String(reason || 'manual');
  contStarting = false;
  contStartSent = false;
  contStarted = false;
  clearCountdown(false);   // 到点/主动收口：静默撤掉倒计时（到点时上面已经报过 0）
  console.log('[asr] cont 请求停止 | reason =', reason, '| 等 onStop 后再开下一段');
  try { pluginManager.stop(); } catch (e) { contStopping = false; }
}

/**
 * 停滞看门狗：插件静默死亡（无 onStart 也无 onStop）时兜底。
 * 一律不裸调 start：先 stop 并等 onStop，再走 tryContStart。
 */
function startContWatch() {
  stopContWatch();
  contWatchTimer = setInterval(function () {
    if (!contWanted) { stopContWatch(); return; }
    if (contPaused) return;                 // 播报暂停期：不重启、不提示
    contDiagTick++;
    if (contDiagTick % 2 === 0) {
      console.log('[asr-diag] 快照 | segs =', contStats.starts, '| partials =', contStats.partials,
        '| finals =', contStats.finals, '| emptySegs =', contEmptySegs,
        '| errors =', contStats.errors, '| busy =', contStats.busy || 0,
        '| 重建 =', contRebuilds + '/' + CONT_REBUILD_MAX,
        '| 实例代次 =', contMgrGen,
        '| 已停 =', contDead ? 'yes' : 'no',
        '| 录音中 =', contStarted ? 'yes' : 'no',
        '| lastErr =', contStats.lastError || '-');
    }
    var now = Date.now();
    if (contStarted) {
      // 本段有没有文本，决定上限用哪个：
      //  - 有文本：20s 是最后的兜底（正常路径应由停滞端点或插件 VAD 收口，不应触达）
      //  - 没文本：15s 正常回收（用户沉默 / 插件不回结果），不是「判定死亡」
      var hasText = contSegPartials > 0 && !!String(contStats.lastPartial || '').trim();
      // 有文本：20s 是最后兜底；没文本：15s 正常回收（用户沉默 / 插件不回结果）。
      // 15s 而不是 58s：故障要能在 3 段内被发现，正常沉默也不必频繁断音。
      var cap = hasText ? CONT_SEG_MAX_MS : CONT_EMPTY_SEG_MS;
      // ft-diag16：兜底上限必须让位于「显示中的倒计时」。
      // 真机「还剩 1.5 就发送」的成因：20s 从本段 onStart 起算，而倒计时每次文本变化都会重置，
      // 一个开了 20s 的段会在新窗口还剩 1~2s 时被这里提前收尾 —— 两套时钟不是同一个到期时刻。
      // 现在把上限推到「当前停滞 deadline + 1s」，保证数字先走到 0。
      if (hasText && contCountTimer && contStallAt) {
        var deadlineCap = contStallAt + contStallWindow + 1000 - contSegStartedAt;
        if (deadlineCap > cap) cap = deadlineCap;
      }
      if (contSegStartedAt && now - contSegStartedAt > cap) {
        if (hasText) {
          // 正常路径不该走到这里：停滞端点应该在 5s 就收尾了。
          console.error('[asr-alarm] 20s 兜底触发（正常路径不应出现）| partial次数 =', contSegPartials,
            '| 停滞窗口 =', contStallWindow + 'ms', '| 外部固定 =', contStallMs ? 'yes' : 'no（自适应）',
            '| 说明 = 倒计时没有生效，请检查文本变化判定');
        } else {
          console.warn('[asr-diag] 无文本段', (cap / 1000) + 's 正常回收 | partial次数 =', contSegPartials,
            '| emptySegs =', contEmptySegs,
            '| 说明 = 用户沉默或插件未回结果，重新开段（空段退避）');
        }
        requestContStop('单段超时兜底');
        scheduleContRestart(CONT_STOP_WAIT_MS + 100, 'after-timeout-stop');
        return;
      }
      // 不再用「15s 无任何回调」当死亡判据：用户沉默时本来就没有回调，
      // 那会把「没说话」误判成「插件死了」，每 15s 重启一整段。
      // 插件真死的判据在别处：start 后等不到 onStart（下面 contStarting 分支）、
      // stop 后等不到 onStop（tryContStart 的 contStopping 分支），或收到 onError。
      return;
    }
    // 已有排队重开（含错误退避 / 等播报）时，看门狗不得再叠加第二次 start。
    // 真机日志里「after-error」与「录音停滞重新请求 start #1」同时出现，就是两条路径互相抢。
    if (contRestartTimer || contRestartAt) return;
    if (contErrUntil && Date.now() < contErrUntil) return;
    if (contStarting && now - contStartAt < CONT_START_WAIT_MS) return;  // start 在途（插件还没回 onStart）
    if (contStarting) {
      contStarting = false;
      contStartSent = false;
      console.warn('[asr] start 后', CONT_START_WAIT_MS, 'ms 既无 onStart 也无错误，按请求丢失处理（补发一次）');
    }
    contWatchRestarts++;
    if (contWatchRestarts <= 3 || contWatchRestarts % 5 === 0) {
      console.warn('[asr] cont 录音停滞，重新请求 start #' + contWatchRestarts);
    }
    tryContStart('watchdog');
  }, 3000);
}

function stopContWatch() {
  if (contWatchTimer) { clearInterval(contWatchTimer); contWatchTimer = null; }
}

/**
 * 排一次「收尾后重开」。
 * 允许用更早的时间覆盖已排队的更晚时间：主动 stop 时先排了一个 1.6s 的兜底，
 * 而 onStop 往往 20ms 就到了 —— 那时应该按 300ms 尽快重开，
 * 否则 3s 看门狗会先一步介入，看起来像「录音停滞」。
 * 反方向不允许（更晚不覆盖更早），避免把 -30011 的长退避缩短成重试风暴。
 */
function scheduleContRestart(ms, reason) {
  if (!contWanted || contPaused || contDead) return;
  var at = Date.now() + Math.max(60, ms | 0);
  if (contRestartTimer) {
    if (at >= contRestartAt) return;   // 已有更早的重开排队，交给它
    clearTimeout(contRestartTimer);
    contRestartTimer = null;
  }
  contRestartAt = at;
  contRestartTimer = setTimeout(function () {
    contRestartTimer = null;
    contRestartAt = 0;
    tryContStart(reason || 'timer');
  }, Math.max(60, ms | 0));
}

/**
 * 开启连续监听：一段说完自动收尾并续录，直到 stopContinuous()。
 * @param {{onPartial?:Function, onFinal?:Function, onError?:Function}} opts
 */
function startContinuous(opts) {
  if (getMode() !== 'plugin') {
    if (opts && typeof opts.onError === 'function') {
      opts.onError(new Error('当前环境不支持连续语音识别'), true);
    }
    return;
  }
  var hadMgr = !!pluginManager;
  stopContinuous();
  contWanted = true;
  contOpts = opts || {};
  contSuppressStop = false;
  contSuppressAt = 0;
  contStats = {
    starts: 0, partials: 0, finals: 0, errors: 0, busy: 0,
    lastPartial: '', lastFinal: '', lastError: '', lastBusyAt: 0
  };
  contStarted = false;
  contStarting = false;
  contStartSent = false;
  contStopping = false;
  contPaused = false;
  contBusyUntil = 0;
  contBusyLevel = 0;
  contLastStartAt = 0;
  contStartWarned = false;
  contWatchRestarts = 0;
  contEmptySegs = 0;
  contSegErrors = 0;
  contRebuilds = 0;
  contDead = false;
  contDiagTick = 0;
  contErrStreak = 0;
  contErrUntil = 0;
  contErrFirstAt = 0;
  contPlaybackWaitLogged = false;
  contSegWindowMax = 0;
  contStopSeen = false;
  contLastEventAt = Date.now();
  // 停滞端点窗口：不传 = 自适应（含句末标点/≤8字 5s，16字 6s，28字 7s，44字 9s，超长 10s）；
  // 传了 = 固定窗口，夹在 1000~10000ms。
  var wantStall = parseInt((opts && opts.stallMs) || 0, 10);
  contStallMs = wantStall ? Math.max(CONT_STALL_MIN_MS, Math.min(CONT_STALL_MAX_MS, wantStall)) : 0;
  contStallWindow = wantStall ? contStallMs : CONT_STALL_MS;
  contLastPartialAt = 0;
  contLastKey = '';
  clearStallTimer();
  startContWatch();
  // 回前台/锁屏恢复：强制丢弃旧实例再新建。
  // 锁屏或切后台时录音句柄会被系统回收，回前台后 start 同一个 manager
  // 只会一直报 record manager failed（真机已复现 25 次），必须换新实例。
  if (opts && opts.freshManager) {
    console.warn('[asr-diag] 生命周期 | onShow | 重建 manager 实例 | 原因 =', opts.freshReason || '回前台',
      '| 原代次 =', contMgrGen, '| 原实例 =', pluginManager ? '有' : '无');
    discardPluginManager(opts.freshReason || '回前台重建');
  }
  ensurePluginManager();
  if (opts && opts.freshManager) {
    console.warn('[asr-diag] 生命周期 | onShow | 重建 manager 实例 #' + contMgrGen,
      '| 说明 = 旧实例回调已按代次丢弃，恢复连续识别');
  }
  if (opts && opts.freshManager && hadMgr) {
    // 旧实例 stop 之后先等 150ms 让录音句柄释放，再 start；
    // 不等就 start 在真机上会撞 -30001（record manager record failed）。
    console.warn('[asr-diag] 启动前清理 | 旧实例已 stop + 解绑，等待 150ms 再 start | 原代次 =', contMgrGen);
    contStopSeen = true;
    scheduleContRestart(150, 'after-fresh-stop');
  } else {
    tryContStart('startContinuous');
  }
  // 启动守卫（不再「没等到 onStart 就补发 start」）：
  // 真机上插件首次 onStart 本身就要 ~850ms，800ms 就补发必然先撞 -30011，
  // 于是每次进面板都要白等一轮退避。现在只在「start 根本没发出去」
  // （被守卫挡下、或 start 调用抛异常）时才补，已发出就安静等插件 onStart。
  clearContSetupTimer();
  contSetupTimer = setTimeout(function () {
    contSetupTimer = null;
    if (!contWanted || contPaused || contStarted) return;
    if (contStarting || contStartSent) {
      console.log('[asr-diag] 首个 start 已发出，继续等插件 onStart（不补发）| 已等 =',
        (Date.now() - (contStartAt || contLastEventAt)) + 'ms');
      return;
    }
    console.log('[asr-diag] 首个 start 未发出（被守卫挡下/抛异常），补发一次 | reason = setup-retry');
    tryContStart('setup-retry');
  }, CONT_SETUP_RETRY_MS);
  // 看门狗：4s 内没收到 onStart，说明当前环境（多为开发者工具模拟器）根本没启动录音。
  // 只提示一次，不打断后续自动续录，避免真机启动慢时误报。
  // 注意：若此刻还有 start 在途，说明插件只是慢，不能按「没启动」报。
  clearContStartTimer();
  contStartTimer = setTimeout(function () {
    contStartTimer = null;
    if (!contWanted || contStarted || contStartWarned) return;
    if (contStarting || contStartSent) return;
    contStartWarned = true;
    console.warn('[asr] cont onStart timeout：录音未启动（开发者工具/模拟器可能不支持同声传译）');
    if (contOpts && typeof contOpts.onStartTimeout === 'function') {
      try { contOpts.onStartTimeout(); } catch (e) { /* 忽略 */ }
    }
  }, 4000);
}

/** 关闭连续监听（幂等） */
function stopContinuous() {
  var wasOn = contWanted;
  clearCountdown(true);   // 先撤倒计时（此时 contOpts 还在，能通知到界面）
  contWanted = false;
  contOpts = null;
  contStarted = false;
  contStarting = false;
  contStartSent = false;
  contPaused = false;
  contStopping = false;
  contBusyUntil = 0;
  contBusyLevel = 0;
  clearContStartTimer();
  clearContSetupTimer();
  stopContWatch();
  if (contRestartTimer) { clearTimeout(contRestartTimer); contRestartTimer = null; }
  contRestartAt = 0;
  if (wasOn && pluginManager) {
    contStopSeen = true;
    contSuppressStop = true;
    contSuppressAt = Date.now();
    try { pluginManager.stop(); } catch (e) { contSuppressStop = false; }
  }
}

/**
 * 因切后台/锁屏主动停掉连续识别（收音必须停；通道是否保留由上层决定）。
 * 这里不丢弃实例：回前台统一走 startContinuous({ freshManager: true }) 重建，
 * 两者都打 [asr-diag] 生命周期 日志，便于真机把「后台中断 → 回前台重建」对上同一条时间轴。
 */
function suspendForBackground(where) {
  var recording = contStarted || contStarting;
  var wasOn = contWanted;
  console.log('[asr-diag] 生命周期 |', where || 'onHide', '| 已停连续识别',
    '| 原来在录 =', recording ? 'yes' : 'no',
    '| 连续模式 =', wasOn ? 'on' : 'off',
    '| 说明 = 后台不收音，回前台重建实例');
  if (wasOn) stopContinuous();
  return { wasOn: wasOn, recording: recording };
}

/**
 * 暂停收音（播报期间的主防线）：停掉当前段并保持「暂停」状态，
 * onStop 与看门狗都不会自动续录，直到 resumeContinuous()。
 * 与 stopContinuous 的区别：不丢连续模式上下文，恢复时不需要重建。
 * @returns {boolean} 是否真的执行了暂停
 */
function pauseContinuous(reason) {
  if (!contWanted || contPaused) return false;
  contPaused = true;
  contPausedAt = Date.now();
  clearCountdown(true);   // 播报开始：录音侧的发送倒计时必须撤掉
  if (contRestartTimer) { clearTimeout(contRestartTimer); contRestartTimer = null; }
  contRestartAt = 0;
  clearContStartTimer();
  clearContSetupTimer();
  console.log('[asr] cont 暂停收音 | reason =', reason || '-',
    '| 录音中 =', contStarted ? 'yes' : 'no', '| seg =', contStats.starts);
  var active = contStarted || contStarting;
  contStarting = false;
  contStartSent = false;
  contStarted = false;
  if (active && pluginManager) {
    // 要等识别真正结束再恢复：这里只发 stop，onStop 到达后标记才清
    contStopSeen = true;
    contStopping = true;
    contStopAt = Date.now();
    try { pluginManager.stop(); } catch (e) { contStopping = false; }
  }
  return true;
}

/**
 * 恢复收音：真正 start 交给 tryContStart，若上一段还在收尾会自动等到 onStop。
 * @returns {boolean} 是否真的执行了恢复
 */
function resumeContinuous(reason) {
  if (!contWanted || !contPaused) return false;
  contPaused = false;
  contLastEventAt = Date.now();
  console.log('[asr] cont 恢复收音 | reason =', reason || '-',
    '| 暂停时长 =', ((Date.now() - contPausedAt) / 1000).toFixed(1) + 's',
    '| 仍在收尾 =', contStopping ? 'yes' : 'no');
  tryContStart('resume');
  return true;
}

/** 把后端各降级路径的错误转成用户能看懂的一句话 */
function formatAsrError(status, detail) {
  var d = String(detail || '');
  if (status === 400 && /too short/i.test(d)) return '没听清，请再说一次';
  if (status === 501) return '服务端未配置语音识别（缺少 ASR 密钥）';
  if (/暂时|网络/.test(d)) return d;
  if (status === 502) return '语音识别服务暂时不可用，请稍后重试或改用文字输入';
  return d || '语音识别失败';
}

module.exports = {
  start: start,
  stop: stop,
  startContinuous: startContinuous,
  stopContinuous: stopContinuous,
  pauseContinuous: pauseContinuous,
  resumeContinuous: resumeContinuous,
  suspendForBackground: suspendForBackground,
  recognize: recognize,
  effLen: effLen,
  truncateEff: truncateEff,
  mode: getMode,
  version: function () { return PLUGIN_VERSION; },
  reason: function () { return pluginReason; },
  stats: function () {
    contStats.rebuilds = contRebuilds;
    contStats.emptySegs = contEmptySegs;
    contStats.segErrors = contSegErrors;
    contStats.gen = contMgrGen;
    contStats.dead = contDead;
    return contStats;
  }
};
