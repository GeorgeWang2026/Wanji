/* ============================================================
 * tts.js —— 语音播报
 * ------------------------------------------------------------
 * 网页版用 speechSynthesis / Audio 播放后端 /api/v1/speech/tts 返回的音频；
 * 小程序用 wx.createInnerAudioContext 播放同一个接口。
 *
 * 长文本按句切段顺序播放，避免单次请求过长导致首包延迟。
 * ============================================================ */
var env = require('./env.js');

var MAX_SEG = 110;

var queue = [];
var ctx = null;
var playing = false;
var stateCb = null;
var seq = 0; // 每次 speak/stop 递增，用于丢弃过期的回调

function setStateCallback(fn) { stateCb = fn; }

function notify(state, extra) {
  if (typeof stateCb === 'function') {
    try { stateCb(state, extra || {}); } catch (e) { /* 忽略 */ }
  }
}

/** 按句末标点切分，保留标点 */
function splitText(text) {
  var s = String(text || '').replace(/\r/g, '');
  s = s.replace(/```[\s\S]*?```/g, ''); // 代码块不朗读
  s = s.replace(/[#>*`_~]/g, '');
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  var parts = s.split(/(?<=[。！？!?；;\n])/);
  var out = [];
  var buf = '';
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p) continue;
    if ((buf + p).length > MAX_SEG && buf) {
      out.push(buf);
      buf = p;
    } else {
      buf += p;
    }
  }
  if (buf.trim()) out.push(buf);
  return out.filter(function (x) { return x.trim().length > 0; });
}

function destroyCtx() {
  if (!ctx) return;
  try {
    ctx.stop();
    ctx.destroy();
  } catch (e) { /* 忽略 */ }
  ctx = null;
}

function playNext(mySeq) {
  if (mySeq !== seq) return;
  if (!queue.length) {
    playing = false;
    destroyCtx();
    notify('end');
    return;
  }
  var seg = queue.shift();
  // TTS 端点默认不强制鉴权（backend config.SPEECH_REQUIRE_AUTH 默认关闭），
  // innerAudioContext 也无法自定义请求头，所以这里直接拼 GET URL。
  var url = env.getApiBase() + '/speech/tts?text=' + encodeURIComponent(seg) + '&voice=zh-CN-XiaoxiaoNeural';

  destroyCtx();
  ctx = wx.createInnerAudioContext();
  // 语音助手场景：静音键下也要能听到播报
  ctx.obeyMuteSwitch = false;
  ctx.autoplay = true;
  ctx.src = url;
  ctx.onPlay(function () { notify('playing', { text: seg }); });
  ctx.onEnded(function () { playNext(mySeq); });
  ctx.onError(function (err) {
    console.warn('[tts] 播放失败', err);
    // 单段失败不阻塞后续片段
    playNext(mySeq);
  });
}

/**
 * 开始播报（会自动打断上一段）
 * @param {string} text 纯文本
 */
function speak(text) {
  stop(true);
  var segs = splitText(text);
  if (!segs.length) return;
  seq += 1;
  queue = segs;
  playing = true;
  notify('start');
  playNext(seq);
}

/** 停止播报 */
function stop(silent) {
  seq += 1;
  queue = [];
  var wasPlaying = playing;
  playing = false;
  destroyCtx();
  if (wasPlaying && !silent) notify('end');
}

function isPlaying() { return playing; }

module.exports = {
  speak: speak,
  stop: stop,
  isPlaying: isPlaying,
  setStateCallback: setStateCallback,
  splitText: splitText
};
