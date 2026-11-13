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

function ensurePluginManager() {
  if (pluginManager) return pluginManager;
  var m = plugin.getRecordRecognitionManager();
  pluginManager = m;

  m.onStart = function () {
    console.log('[asr] plugin recorder started');
    resolveStart();
  };

  // 实时结果：每次都是“当前这句”的累计文本，直接整体替换
  m.onRecognize = function (res) {
    var t = (res && res.result) || '';
    if (!t) return;
    partialCount++;
    if (partialCount === 1) console.log('[asr] partial#1', t);
    finalText = t;
    if (partialCb) {
      try { partialCb(t); } catch (e) { /* 上层 setData 异常不影响录音 */ }
    }
  };

  m.onStop = function (res) {
    var t = (res && res.result) || finalText || '';
    finalText = t;
    finalPath = (res && res.tempFilePath) || finalPath || '';
    finishStop({
      text: t,
      filePath: finalPath,
      duration: (res && res.duration) || 0
    });
  };

  m.onError = function (res) {
    var msg = (res && (res.msg || res.errMsg)) || '语音识别出错';
    lastError = msg;
    console.error('[asr] plugin error | retcode =', (res && res.retcode), '| msg =', msg);
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
  return new Promise(function (resolve, reject) {
    startResolve = resolve;
    startReject = reject;
    // 兜底：个别机型不进 onStart，2s 后按成功处理，避免按钮卡死
    startTimer = setTimeout(resolveStart, 2000);
    try {
      m.start({ lang: 'zh_CN', duration: 60000 });
    } catch (e) {
      startResolve = null;
      clearStartTimer();
      reject(e);
    }
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
  recognize: recognize,
  mode: getMode,
  version: function () { return PLUGIN_VERSION; },
  reason: function () { return pluginReason; },
  lastError: function () { return lastError; }
};
