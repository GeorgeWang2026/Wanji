/* ============================================================
 * features.js —— 隐藏功能的单开关（送审期一律关闭）
 * ------------------------------------------------------------
 * 八字详情（pages/occult/bazi）与卦典（pages/occult/gua）都不注册进
 * app.json，页面只留在源码里，运行期不可达；送审期点到相关入口只提示
 * 「功能开发中，敬请期待」，不留死按钮。
 *
 * 过审后要走开：把 OCCULT_PAGES_ENABLED 改成 true，并在 app.json 的
 * pages 里补上这两行路径，再发版验证。
 * ============================================================ */
var OCCULT_PAGES_ENABLED = false;

module.exports = {
  OCCULT_PAGES_ENABLED: OCCULT_PAGES_ENABLED
};
