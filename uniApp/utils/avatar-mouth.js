/* ============================================================
 * avatar-mouth.js —— 头像 → 嘴部定位（百分比，相对头像图片容器）
 * ------------------------------------------------------------
 * 照抄 qimen-1/static/assistant-widget.js 的 XB_AVATAR_CONFIGS（L411-418）：
 *   value = { left, top, width, height, name }，单位百分比，相对「头像图片容器」。
 * key 必须与 pages/chat/chat.js 的 AVATARS[].file 完全一致；
 * 查不到配置时返回 null → 隐藏口型，绝不套用别人的坐标。
 * 以后换图/加图只改这一张表（AVATARS 加一条 + 这里按相同文件名加四元组）。
 * ============================================================ */

var MOUTH_RECT = {
  '/avatar/xiaoxuan_1.png':  { left: 45, top: 53,   width: 10, height: 15 }, // 神机子
  '/avatar/xiaoxuan_21.png': { left: 45, top: 60,   width: 12, height: 20 }, // 天机子
  '/avatar/xiaoxuan_3.png':  { left: 45, top: 58,   width: 12, height: 15 }, // 灵机子
  '/avatar/xiaoxuan_4.jpg':  { left: 42, top: 46,   width: 10, height: 15 }  // 时机子
};

function getMouthRect(avatarFile) {
  return MOUTH_RECT[avatarFile] || null;
}

module.exports = {
  MOUTH_RECT: MOUTH_RECT,
  getMouthRect: getMouthRect
};
