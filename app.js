/* ============================================================
 * 万机决策助手 —— 微信小程序入口
 * ------------------------------------------------------------
 * 项目约定（见 uniApp/README.md）：
 *   - 小程序根目录 = 工程根（本文件所在目录，导入微信开发者工具选这一层）
 *   - 页面、组件、工具层 = uniApp/
 *   - 公共库 = 工程根目录的 yishu.js（术数引擎）与 markdown.js（Markdown 渲染），
 *     两者是 qimen-1/static 下同名文件的复制件，同步方式见 uniApp/README.md
 * 网页版（xiaoxuan.html / assistant-widget.js）不受影响：本文件只在微信开发者工具内被加载。
 * ============================================================ */
// 必须最先执行：给公共库补一个最小 window / localStorage 壳（小程序没有这些浏览器全局）
require('./uniApp/utils/window-shim.js');

var env = require('./uniApp/utils/env.js');
var api = require('./uniApp/utils/api.js');

App({
  globalData: {
    // 已关联到「下一条提问」的排盘数据，结构与网页版 window.__xbPaipanData 对齐
    // { qimen: {...}, bazi: {...}, meihua: {...} }
    paipan: null,
    // 每条提问的排盘 payload（对应网页版 window.__xbPaiPanPayload）
    paipanPayload: null,
    // 后端 preview_prompt_hint 返回的各类型提示词文本（对应 window.__xbPaipanPromptText）
    paipanPromptText: null,
    // TTS 开关
    ttsOn: true,
    version: '1.0.0'
  },

  onLaunch: function () {
    // 还原本地登录态
    this.user = api.readUser();
    console.log('[app] launched, api =', env.getApiOrigin(), ', logged in =', !!this.user);
  },

  /** 登录态变化时刷新内存态（登录页 / 退出登录后调用） */
  refreshUser: function () {
    this.user = api.readUser();
    return this.user;
  }
});
