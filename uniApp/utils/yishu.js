/* ============================================================
 * yishu.js（适配层）—— 复用工程根目录的 yishu.js 术数引擎（网页版复制件）
 * ------------------------------------------------------------
 * 奇门遁甲 / 四柱八字 / 梅花易数 三套算法全部来自 yishu.js，
 * 本文件只做两件事：
 *   1. 先加载 window-shim，保证 yishu.js 里的 localStorage / window 可用
 *   2. require 后把需要的能力统一导出（yishu.js 末尾有 CommonJS 导出块，
 *      该块只在存在 module 对象时生效，浏览器里完全不受影响）
 *
 * 不改写任何算法；页面里出现的只有 getBazi / qimenPaiPan / meihuaGua 这类调用。
 * ============================================================ */
require('./window-shim.js');

var Y = null;
try {
  Y = require('../../yishu.js');
} catch (e) {
  console.error('[yishu] 加载工程根 yishu.js 失败：', e);
}

if (!Y || typeof Y.getBazi !== 'function') {
  console.error('[yishu] 引擎未就绪，排盘功能不可用（请检查工程根 yishu.js 是否被 packOptions 忽略）');
}

function need(name) {
  if (!Y || typeof Y[name] === 'undefined') {
    throw new Error('术数引擎缺少 ' + name + '，请检查工程根 yishu.js');
  }
  return Y[name];
}

/** 奇门遁甲排盘：返回 { pan, bazi } */
function qimenPan(y, m, d, h, mi) {
  var getBazi = need('getBazi');
  var qimenPaiPan = need('qimenPaiPan');
  var bazi = getBazi(y, m, d, h, mi);
  var pan = qimenPaiPan(bazi.year, bazi.month, bazi.day, bazi.hour, bazi.jieqi);
  // 地盘干视图（网页版 renderQmPan 的同一补丁，缺了它九宫格地盘列会是 undefined）
  pan.di_pan_view = {};
  var order = [1, 8, 3, 4, 9, 2, 7, 6];
  for (var i = 0; i < order.length; i++) {
    pan.di_pan_view[order[i]] = pan.tp[order[i]].dg;
  }
  return { pan: pan, bazi: bazi };
}

/** 四柱八字 + 大运 + 旺衰 */
function baziPan(y, m, d, h, mi, gender) {
  var getBazi = need('getBazi');
  var calcDayun = need('calcDayun');
  var dayMasterProfile = need('dayMasterProfile');
  var pb = getBazi(y, m, d, h, mi || 0);
  var dy = calcDayun(pb, gender || '男');
  var prof = dayMasterProfile(pb);
  pb.dayGan = pb.day[0];
  pb.dayZhi = pb.day[1];
  pb.qiangRuo = prof.level;
  pb.score = prof.score;
  pb._prof = prof;
  return { pb: pb, dy: dy, prof: prof };
}

/** 梅花易数起卦 */
function meihuaGua(opts) {
  return need('meihuaGua')(opts);
}

/** 六十四卦查表 */
function lookup64(up, down) {
  return need('lookup64')(up, down);
}

/** 通用字典 / 常量访问（页面渲染用） */
function dict(name) {
  return Y ? Y[name] : undefined;
}

module.exports = {
  available: !!(Y && typeof Y.getBazi === 'function'),
  engine: Y,
  qimenPan: qimenPan,
  baziPan: baziPan,
  meihuaGua: meihuaGua,
  lookup64: lookup64,
  dict: dict
};
