/* ============================================================
 * env.js —— 接口基址配置（唯一数据源）
 * ------------------------------------------------------------
 * 小程序与网页版最大的差异之一：request / uploadFile 的合法域名必须是
 * 「https + 已备案 + 在微信公众平台配置过」的域名，且不能带端口（只能是 443）。
 * 所以这里不放行 location.origin 那一套，而是显式给 dev / prod 两个地址。
 *
 * 本地联调：
 *   1. 开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、
 *      TLS 版本以及 HTTPS 证书」，即可直连 http://localhost:5000
 *   2. 真机预览必须把 dev 改成电脑的局域网 IP（手机不能访问 localhost）
 * ============================================================ */
var ENV = 'prod'; // 'dev' | 'prod'

var CONFIG = {
  dev: {
    API_ORIGIN: 'http://localhost:5000'
  },
  prod: {
    // 生产环境走 Caddy 反代（见仓库根 Caddyfile），与网页版同源，接口前缀一致 /api/v1
    API_ORIGIN: 'https://wanji.sh.cn'
  }
};

/** 读取接口根地址：本地缓存里的手动覆盖 > 环境默认值 */
function getApiOrigin() {
  var saved = '';
  try { saved = wx.getStorageSync('qimen_api_origin') || ''; } catch (e) { /* 忽略 */ }
  return String(saved || CONFIG[ENV].API_ORIGIN).replace(/\/+$/, '');
}

/** 完整 API 前缀，形如 https://wanji.sh.cn/api/v1 */
function getApiBase() {
  return getApiOrigin() + '/api/v1';
}

/** 手动切换接口地址（调试用，留空则恢复默认） */
function setApiOrigin(origin) {
  try {
    if (origin) wx.setStorageSync('qimen_api_origin', String(origin).replace(/\/+$/, ''));
    else wx.removeStorageSync('qimen_api_origin');
  } catch (e) { /* 忽略 */ }
}

module.exports = {
  ENV: ENV,
  CONFIG: CONFIG,
  getApiOrigin: getApiOrigin,
  getApiBase: getApiBase,
  setApiOrigin: setApiOrigin
};
