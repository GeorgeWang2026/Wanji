/* ============================================================
 * window-shim.js —— 小程序端的「最小浏览器全局壳」
 * ------------------------------------------------------------
 * 为什么需要：工程根目录的 markdown.js 与 yishu.js 是按浏览器脚本写的
 *   - markdown.js 用 IIFE 接收 window，并在末尾挂 window.QimenMarkdown
 *   - yishu.js 的万物类象缓存直接调用 localStorage
 * 小程序没有 window / localStorage，这里在 app.js 的最顶部补上，
 * 从而可以「原样复用」这两个库，不需要改动它们的算法与行为。
 *
 * 依赖：基础库需支持 globalThis（≥ 2.11）；不满足时回退到 global。
 * ============================================================ */
function getGlobal() {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof global !== 'undefined') return global;
  if (typeof window !== 'undefined') return window;
  return null;
}

var g = getGlobal();

if (g) {
  if (!g.window) g.window = g;
  if (!g.global) g.global = g;

  // localStorage 的最小实现：落到 wx 的同步缓存，键加前缀避免与业务键冲突
  if (typeof g.localStorage === 'undefined') {
    var mem = {};
    g.localStorage = {
      getItem: function (k) {
        try {
          var v = wx.getStorageSync('ls:' + k);
          if (v !== '' && v !== undefined && v !== null) return v;
        } catch (e) { /* 忽略，走内存兜底 */ }
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      setItem: function (k, v) {
        mem[k] = String(v);
        try { wx.setStorageSync('ls:' + k, String(v)); } catch (e) { /* 忽略 */ }
      },
      removeItem: function (k) {
        delete mem[k];
        try { wx.removeStorageSync('ls:' + k); } catch (e) { /* 忽略 */ }
      }
    };
  }
} else {
  console.error('[window-shim] 未找到可用的全局对象，公共库（markdown.js / yishu.js）可能无法加载，请升级基础库');
}

module.exports = g || {};
