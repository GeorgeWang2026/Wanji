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
var listeners = [];   // 自由对话通道：按句取播报文本做回声判据（不抢占 stateCb）
var seq = 0; // 每次 speak/stop 递增，用于丢弃过期的回调
var segTimer = null;  // 单段播报超时兜底：音频上下文卡死时不能让 playing 永久为 true

function clearSegTimer() {
  if (segTimer) { clearTimeout(segTimer); segTimer = null; }
}

function setStateCallback(fn) { stateCb = fn; }

/** 追加状态监听（可多个），返回移除函数 */
function addStateListener(fn) {
  if (typeof fn !== 'function') return function () {};
  listeners.push(fn);
  return function () {
    var i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notify(state, extra) {
  var payload = extra || {};
  if (typeof stateCb === 'function') {
    try { stateCb(state, payload); } catch (e) { /* 忽略 */ }
  }
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](state, payload); } catch (e) { /* 忽略 */ }
  }
}

/** 去掉 Markdown 噪音，只留可朗读的纯文本（代码块整段丢弃） */
function stripMarkdown(text) {
  var s = String(text || '').replace(/\r/g, '');
  s = s.replace(/```[\s\S]*?```/g, ''); // 代码块不朗读
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/[#>*`_~]/g, '');
  return s;
}

/** 按句末标点切分，保留标点 */
function splitText(text) {
  var s = stripMarkdown(text);
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
  clearSegTimer();
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
    // 单段失败不阻塞后续片段；通知上层「这段没出声」，让字幕照常补上这一句
    if (mySeq === seq) notify('skip', { text: seg });
    playNext(mySeq);
  });

  // 音频上下文卡死（不触发 onPlay/onEnded/onError）时，不能让 playing 永久为 true：
  // 那会让自由对话把所有识别中间结果当成「播报中的回录」而永不上屏。
  clearSegTimer();
  segTimer = setTimeout(function () {
    segTimer = null;
    if (mySeq !== seq) return;
    console.warn('[tts-diag] 单段播报 30s 未结束，判定音频上下文卡死，跳过该段');
    notify('skip', { text: seg });
    destroyCtx();
    playNext(mySeq);
  }, 30000);
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

/**
 * DF-97：追加播报（不打断当前句），用于自由对话通道的「边生成边播」。
 * 队列空了以后再追加会自动重新起播；空文本直接忽略。
 * @param {string} text 纯文本
 * @param {{raw?:boolean}} [opts] raw=true 时整段作为一个播报单元（上层已合并好短句，
 *        不能再按句末标点拆回去，否则字幕又会碎成一条条）
 */
function enqueue(text, opts) {
  var segs = (opts && opts.raw) ? [String(text || '')] : splitText(text);
  if (!segs.length) return;
  if (playing) {
    queue = queue.concat(segs);
    return;
  }
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
  clearSegTimer();
  var wasPlaying = playing;
  playing = false;
  destroyCtx();
  if (wasPlaying && !silent) notify('end');
}

function isPlaying() { return playing; }

module.exports = {
  speak: speak,
  enqueue: enqueue,
  stop: stop,
  isPlaying: isPlaying,
  setStateCallback: setStateCallback,
  addStateListener: addStateListener,
  stripMarkdown: stripMarkdown
};
