/* ============================================================
 * stock.js —— 证券行情数据适配层
 * ------------------------------------------------------------
 * 数据源：东方财富公开行情接口（HTTPS + UTF-8 JSON，无需鉴权）
 *   实时快照：https://push2.eastmoney.com/api/qt/stock/get
 *   K 线：    https://push2his.eastmoney.com/api/qt/stock/kline/get
 *
 * 已知限制（正式发布前必须处理其中一条）：
 *   1. 小程序后台需把上面两个域名加入「request 合法域名」；
 *      开发者工具里可临时勾选「不校验合法域名」先看效果。
 *   2. 公开接口无 SLA，字段/参数可能调整；若后端补了行情代理，
 *      只需把 QUOTE_URL / KLINE_URL 换掉并保持下面的返回结构不变。
 * ============================================================ */

var UT = 'fa5fd1943c7b386f172d6893dbfba10b';
var QUOTE_URL = 'https://push2.eastmoney.com/api/qt/stock/get';
var KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

var MEMO = {};

function num(v) {
  if (v === '-' || v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

/** 600028 → 1.600028（沪市 1 / 深市 0） */
function secid(code) {
  var c = String(code || '').replace(/\D/g, '');
  var market = (c.charAt(0) === '6' || c.charAt(0) === '9') ? '1' : '0';
  return market + '.' + c;
}

function getJSON(url, params) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      data: params,
      method: 'GET',
      timeout: 15000,
      success: function (res) {
        if (res.statusCode !== 200) {
          reject(new Error('行情接口返回 HTTP ' + res.statusCode));
          return;
        }
        var body = res.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) {
            reject(new Error('行情接口返回非 JSON'));
            return;
          }
        }
        resolve(body || {});
      },
      fail: function (err) {
        var msg = (err && err.errMsg) || '网络请求失败';
        if (msg.indexOf('domain list') >= 0) {
          reject(new Error('行情域名未加白名单：push2.eastmoney.com / push2his.eastmoney.com'));
        } else {
          reject(new Error(msg));
        }
      }
    });
  });
}

/** 实时快照 */
function fetchQuote(code) {
  return getJSON(QUOTE_URL, {
    secid: secid(code),
    fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170',
    ut: UT
  }).then(function (r) {
    var d = r && r.data;
    if (!d) throw new Error('行情无返回（可能是非交易时段或代码不存在）');
    return {
      code: d.f57 || String(code),
      name: d.f58 || '',
      price: num(d.f43) === null ? null : num(d.f43) / 100,
      high: num(d.f44) === null ? null : num(d.f44) / 100,
      low: num(d.f45) === null ? null : num(d.f45) / 100,
      open: num(d.f46) === null ? null : num(d.f46) / 100,
      prevClose: num(d.f60) === null ? null : num(d.f60) / 100,
      volume: num(d.f47),
      amount: num(d.f48),
      change: num(d.f169) === null ? null : num(d.f169) / 100,
      changePct: num(d.f170) === null ? null : num(d.f170) / 100
    };
  });
}

/**
 * K 线
 * @param {string} code
 * @param {string} period day | week | month
 * @param {number} limit  条数
 */
function fetchKline(code, period, limit) {
  var klt = { day: 101, week: 102, month: 103 }[period] || 101;
  return getJSON(KLINE_URL, {
    secid: secid(code),
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57',
    klt: klt,
    fqt: 1,
    end: '20500101',
    lmt: limit || 120,
    ut: UT
  }).then(function (r) {
    var d = r && r.data;
    if (!d || !d.klines || !d.klines.length) return [];
    return d.klines.map(function (s) {
      var p = String(s).split(',');
      // f51 日期, f52 开, f53 收, f54 高, f55 低, f56 量, f57 额
      return {
        date: p[0],
        open: Number(p[1]),
        close: Number(p[2]),
        high: Number(p[3]),
        low: Number(p[4]),
        volume: Number(p[5]),
        amount: Number(p[6])
      };
    });
  });
}

/** 带 60s 内存缓存，避免切周期/返回页面时重复请求；force=true 强制绕过缓存 */
function load(code, period, limit, force) {
  var key = code + '|' + period;
  var hit = MEMO[key];
  if (!force && hit && Date.now() - hit.t < 60000) {
    return Promise.resolve(hit.data);
  }
  // 实时快照失败不阻断 K 线展示（两个接口不同域名，可能只有其一失败）
  return Promise.all([
    fetchQuote(code).catch(function () { return null; }),
    fetchKline(code, period, limit)
  ]).then(function (arr) {
    var data = { quote: arr[0] || {}, klines: arr[1] };
    MEMO[key] = { t: Date.now(), data: data };
    return data;
  });
}

module.exports = {
  secid: secid,
  fetchQuote: fetchQuote,
  fetchKline: fetchKline,
  load: load
};
