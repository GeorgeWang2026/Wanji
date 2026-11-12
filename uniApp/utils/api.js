/* ============================================================
 * api.js —— 请求层 + 登录态
 * ------------------------------------------------------------
 * 对应网页版的 static/api-client.js，但把 fetch / localStorage / DOM 弹框
 * 换成了 wx.request / wx.getStorageSync / 页面内自绘弹框。
 * 登录态三件套沿用网页版键名，方便同一用户在同一设备上保持一致：
 *   qimen_token / qimen_uid / qimen_uname
 * ============================================================ */
var env = require('./env.js');

var TOKEN_KEY = 'qimen_token';
var UID_KEY = 'qimen_uid';
var UNAME_KEY = 'qimen_uname';

function getToken() {
  try { return wx.getStorageSync(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

function readUser() {
  try {
    var token = wx.getStorageSync(TOKEN_KEY) || '';
    if (!token) return null;
    return {
      token: token,
      uid: wx.getStorageSync(UID_KEY) || '',
      name: wx.getStorageSync(UNAME_KEY) || ''
    };
  } catch (e) { return null; }
}

function saveUser(data) {
  if (!data) return null;
  try {
    wx.setStorageSync(TOKEN_KEY, data.token || '');
    wx.setStorageSync(UID_KEY, String(data.user_id || ''));
    wx.setStorageSync(UNAME_KEY, data.display_name || data.username || '');
  } catch (e) { /* 忽略 */ }
  return readUser();
}

function clearUser() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(UID_KEY);
    wx.removeStorageSync(UNAME_KEY);
  } catch (e) { /* 忽略 */ }
}

/**
 * 统一请求
 * @param {string} path   以 / 开头的接口路径，如 '/chat'
 * @param {object} opts   { method, data, auth=true, timeout }
 * @returns {Promise<object>} 解析后的 JSON（401 会 reject 并清登录态）
 */
function request(path, opts) {
  opts = opts || {};
  var method = opts.method || 'GET';
  var header = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    var t = getToken();
    if (t) header.Authorization = 'Bearer ' + t;
  }
  return new Promise(function (resolve, reject) {
    wx.request({
      url: env.getApiBase() + path,
      method: method,
      data: opts.data,
      header: header,
      timeout: opts.timeout || 60000,
      success: function (res) {
        var body = res.data;
        if (res.statusCode === 401) {
          // 登录/注册接口的 401 = 用户名或密码错误，按业务错误返回
          if (path === '/auth/login' || path === '/auth/register') {
            resolve(body || { code: 401, detail: '用户名或密码错误' });
            return;
          }
          clearUser();
          reject(new Error('登录已过期，请重新登录'));
          return;
        }
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) { body = { detail: body }; }
        }
        resolve(body || {});
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '网络请求失败'));
      }
    });
  });
}

/** 登录 */
function login(username, password) {
  return request('/auth/login', {
    method: 'POST',
    auth: false,
    data: { username: username, password: password }
  }).then(function (r) {
    if (r && r.code === 0 && r.data && r.data.token) {
      saveUser(r.data);
      return r.data;
    }
    var msg = (r && (r.detail || r.msg)) || '登录失败';
    throw new Error(msg);
  });
}

/** 注册（后端默认送 10 积分） */
function register(username, password, displayName) {
  return request('/auth/register', {
    method: 'POST',
    auth: false,
    data: { username: username, password: password, display_name: displayName || undefined }
  }).then(function (r) {
    if (r && r.code === 0 && r.data && r.data.token) {
      saveUser(r.data);
      return r.data;
    }
    var msg = (r && (r.detail || r.msg)) || '注册失败';
    throw new Error(msg);
  });
}

/** 余额（附带今日已用） */
function getBalance() {
  return request('/credits/balance').then(function (r) {
    return (r && r.data) || null;
  });
}

module.exports = {
  TOKEN_KEY: TOKEN_KEY,
  getToken: getToken,
  readUser: readUser,
  saveUser: saveUser,
  clearUser: clearUser,
  request: request,
  login: login,
  register: register,
  getBalance: getBalance
};
