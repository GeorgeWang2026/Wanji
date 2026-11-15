/* ============================================================
 * stock.js —— 证券数据适配层（DF-99）
 * ------------------------------------------------------------
 * 1) 详情信息：GET /api/v1/stocks/detail?code=
 *    与网站 static/xiaoxuan.html 证券详情页（#stockDetailInfo）同一接口、
 *    同一字段口径；渲染用的易学查找表照 static/mystock/yijing.js 同名函数移植。
 * 2) 日 K：东方财富公开行情接口（仅日线，保持既有取数方式）
 *    - 小程序后台「request 合法域名」需加入 push2his.eastmoney.com；
 *    - 公开接口无 SLA；若后端补了行情代理，只改 KLINE_URL。
 * ============================================================ */
var api = require('./api.js');

var UT = 'fa5fd1943c7b386f172d6893dbfba10b';
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
          reject(new Error('行情域名未加白名单：push2his.eastmoney.com'));
        } else {
          reject(new Error(msg));
        }
      }
    });
  });
}

/* ============================================================
 * 易学查找表 —— 与 static/mystock/yijing.js 同名函数逐条对齐
 * ============================================================ */
var GUA_TOTAL = {
  '乾': '乾为天', '夬': '泽天夬', '大有': '火天大有', '大壮': '雷天大壮',
  '小畜': '风天小畜', '需': '水天需', '大畜': '山天大畜', '泰': '地天泰',
  '履': '天泽履', '兑': '兑为泽', '睽': '火泽睽', '归妹': '雷泽归妹',
  '中孚': '风泽中孚', '节': '水泽节', '损': '山泽损', '临': '地泽临',
  '同人': '天火同人', '革': '泽火革', '离': '离为火', '丰': '雷火丰',
  '家人': '风火家人', '即济': '水火即济', '贲': '山火贲', '明夷': '地火明夷',
  '无妄': '天雷无妄', '随': '泽雷随', '噬嗑': '火雷噬嗑', '震': '震为雷',
  '益': '风雷益', '屯': '水雷屯', '颐': '山雷颐', '复': '地雷复',
  '姤': '天风姤', '大过': '泽风大过', '鼎': '火风鼎', '恒': '雷风恒',
  '巽': '巽为风', '井': '水风井', '蛊': '山风蛊', '升': '地风升',
  '讼': '天水讼', '困': '泽水困', '未济': '火水未济', '解': '雷水解',
  '涣': '风水涣', '坎': '坎为水', '蒙': '山水蒙', '师': '地水师',
  '遁': '天山遁', '咸': '泽山咸', '旅': '火山旅', '小过': '雷山小过',
  '渐': '风山渐', '蹇': '水山蹇', '艮': '艮为山', '谦': '地山谦',
  '否': '天地否', '萃': '泽地萃', '晋': '火地晋', '豫': '雷地豫',
  '观': '风地观', '比': '水地比', '剥': '山地剥', '坤': '坤为地'
};

var GUA_SYMBOL = {
  '乾': '䷀', '夬': '䷪', '大有': '䷍', '大壮': '䷡',
  '小畜': '䷈', '需': '䷄', '大畜': '䷙', '泰': '䷊',
  '履': '䷉', '兑': '䷹', '睽': '䷥', '归妹': '䷵',
  '中孚': '䷼', '节': '䷻', '损': '䷨', '临': '䷒',
  '同人': '䷌', '革': '䷰', '离': '䷝', '丰': '䷶',
  '家人': '䷤', '即济': '䷾', '贲': '䷕', '明夷': '䷣',
  '无妄': '䷘', '随': '䷐', '噬嗑': '䷔', '震': '䷲',
  '益': '䷩', '屯': '䷂', '颐': '䷚', '复': '䷗',
  '姤': '䷫', '大过': '䷛', '鼎': '䷱', '恒': '䷟',
  '巽': '䷸', '井': '䷯', '蛊': '䷑', '升': '䷭',
  '讼': '䷅', '困': '䷮', '未济': '䷿', '解': '䷧',
  '涣': '䷺', '坎': '䷜', '蒙': '䷃', '师': '䷆',
  '遁': '䷠', '咸': '䷞', '旅': '䷷', '小过': '䷽',
  '渐': '䷴', '蹇': '䷦', '艮': '䷳', '谦': '䷎',
  '否': '䷋', '萃': '䷬', '晋': '䷢', '豫': '䷏',
  '观': '䷓', '比': '䷇', '剥': '䷖', '坤': '䷁'
};

/** yijing.js get_color：按态势取徽标底色 */
function getColor(situation) {
  if (situation === null || situation === undefined) return '#AAAAAA';
  var s = String(situation);
  if (s === '少阴') return '#d9febb';
  if (s === '少阳') return '#ffb2a2';
  if ('乾,夬,大有,大壮,季,q,秋,机构'.indexOf(s) >= 0) return '#FFA500';
  if ('兑,履,睽,归妹,中孚,节,损,临,小畜,需,大畜,泰,年,y,春,游资'.indexOf(s) >= 0) return '#FF11FF';
  if ('离,同人,革,丰,家人,即济,贲,明夷,主力'.indexOf(s) >= 0) return '#DA70D6';
  if ('震,无妄,随,噬嗑,益,屯,颐,复,遁,咸,旅,小过,周,w'.indexOf(s) >= 0) return '#0000FF';
  if ('巽,姤,大过,鼎,恒,井,蛊,升,阳,太阳,月,m,1,夏,热钱'.indexOf(s) >= 0) return '#FF0000';
  if ('坎,讼,困,未济,解,涣,蒙,师,冬,牛散'.indexOf(s) >= 0) return '#11FFFF';
  if ('否,萃,晋,豫,艮,渐,蹇,谦'.indexOf(s) >= 0) return '#FFddaa';
  if ('坤,观,比,剥,阴,太阴,天,d,0'.indexOf(s) >= 0) return '#00FF00';
  // 网站原实现此处返回随机色（每次渲染都变）；小程序取同风格固定色，避免闪烁
  return '#9a8ab8';
}

/** yijing.js get_yijing_total：单字态势 → 六十四卦名 */
function getYijingTotal(situation) {
  return GUA_TOTAL[situation] || '';
}

/** yijing.js get_high_symbol：态势 → 六十四卦符号 */
function getHighSymbol(situation) {
  return GUA_SYMBOL[situation] || '';
}

/** yijing.js get_level_name：周期频率 → 中文级别 */
function getLevelName(frequency) {
  if (frequency === null || frequency === undefined) return '无';
  var f = String(frequency);
  if ('y,Y,12M'.indexOf(f) >= 0) return '年';
  if ('q,Q,3M'.indexOf(f) >= 0) return '季';
  if ('m,M,1M'.indexOf(f) >= 0) return '月';
  if ('w,W'.indexOf(f) >= 0) return '周';
  if ('d,D'.indexOf(f) >= 0) return '日';
  if ('60m,h,H'.indexOf(f) >= 0) return '时';
  if ('15m,k,K'.indexOf(f) >= 0) return '刻';
  return '无';
}

/** yijing.js get_season_symbol：季节 → 符号 */
function getSeasonSymbol(season) {
  if (season === '夏') return '☀';
  if (season === '秋') return '☽';
  if (season === '春') return '❀';
  if (season === '冬') return '❄';
  return '☼';
}

/** yijing.js get_direction：阴阳/态势 → 方向箭头 */
function getDirection(s) {
  if (s === null || s === undefined) return '↕';
  var v = String(s);
  if (v === '太阳') return '↟';
  if (v === '太阴') return '↡';
  if (v === '阳') return '↑';
  if (v === '阴') return '↓';
  if (parseInt(v, 10) === 1) return '↑';
  if (parseInt(v, 10) === 0) return '↓';
  if (v === '少阳') return '⇡';
  if (v === '少阴') return '⇣';
  return '↕';
}

/** yijing.js get_season：短/长态势 → 季节 */
function getSeason(ss, ls) {
  if (ss === null || ss === undefined || ls === null || ls === undefined) return '无';
  var S = String(ss), L = String(ls);
  var A = '乾,兑,离,巽,qian,dui,li,xun,0,1,2,3';
  var B = '震,坎,艮,坤,zhen,kan,gen,kun,4,5,6,7';
  if (A.indexOf(L) >= 0) {
    if (A.indexOf(S) >= 0) return '夏';
    if (B.indexOf(S) >= 0) return '秋';
  }
  if (B.indexOf(L) >= 0) {
    if (A.indexOf(S) >= 0) return '春';
    if (B.indexOf(S) >= 0) return '冬';
  }
  return '无';
}

/* ============================================================
 * 详情信息
 * ============================================================ */

/** GET /stocks/detail?code= → data（与网站同接口、同字段） */
function fetchDetail(code) {
  return api.request('/stocks/detail?code=' + encodeURIComponent(code)).then(function (r) {
    return (r && r.data) || {};
  });
}

/**
 * 把 /stocks/detail 的 data 归一化成页面可直接渲染的结构。
 * 逐行对齐 xiaoxuan.html _renderStockInfo（L6393-L6447）。
 * @returns {object|null} data 无 code 时返回 null（页面显示空态）
 */
function buildInfo(d, meta) {
  d = d || {};
  if (!d.code) return null;

  var name = d.name || (meta && meta.name) || d.code || '';
  var zdf = (d.zdf === null || d.zdf === undefined) ? NaN : Number(d.zdf);
  var zdfText = isNaN(zdf) ? '—' : ((zdf > 0 ? '+' : '') + zdf.toFixed(2) + '%');
  var zdfColor = isNaN(zdf) ? '#8a75b0' : (zdf >= 0 ? '#ff7b8a' : '#3ddc97');

  // 结构：年/季/月/周/日/时（网站只渲染徽标，无文字标签）
  var structKeys = ['y_situation', 'q_situation', 'm_situation', 'w_situation', 'd_situation', 'h_situation'];
  var structs = [];
  for (var i = 0; i < structKeys.length; i++) {
    var sv = d[structKeys[i]];
    structs.push({ t: getDirection(sv), bg: getColor(sv) });
  }

  // 方向 + 级别（刻 15m）
  var dirText = (getDirection(d.k_situation) || '') + (getLevelName(d.k_level) || '');

  // 态势变化趋势：当前态势 → 方向级别 → 目标态势
  var se = getSeason(d.short_situation, d.long_situation);
  var curName = d.total_situation ? (getYijingTotal(d.total_situation) || d.total_situation) : '';
  var curGua = getSeasonSymbol(se) + ' ' + (getHighSymbol(d.total_situation) + curName);
  var tgtGua = getHighSymbol(d.k_target_situation) + (d.k_target_situation ? (getYijingTotal(d.k_target_situation) || d.k_target_situation) : '');
  var trend = [
    { t: curGua, bg: getColor(d.total_situation) },
    { t: dirText, bg: getColor(d.k_situation) },
    { t: tgtGua, bg: getColor(d.k_target_situation) }
  ];

  // 空间提示
  var isDown = (d.k_direction === 'down');
  var spaceText = (isDown ? '向下踩' : '向上攻') + ' ' + (d.k_price == null ? '—' : d.k_price)
    + ' ' + (isDown ? '支撑位' : '压力位') + '，最大' + (isDown ? '跌幅' : '涨幅') + ' '
    + ((d.k_space == null ? '—' : Number(d.k_space).toFixed(1)) + '%');

  var credit = d.credit || '';

  return {
    name: name || d.name || d.code,
    credit: credit,
    creditBg: getColor(d.target_direction || d.total_situation),
    zdfText: zdfText,
    zdfColor: zdfColor,
    dirText: dirText || d.direction || '—',
    grade: d.grade || '',
    structs: structs,
    trend: trend,
    space: spaceText,
    industry: d.industry_name || ''
  };
}

/* ============================================================
 * 日 K
 * ============================================================ */

/** 日 K 线（klt=101） */
function fetchKline(code, limit) {
  return getJSON(KLINE_URL, {
    secid: secid(code),
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57',
    klt: 101,
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

/** 带 60s 内存缓存；force=true 强制绕过缓存 */
function load(code, limit, force) {
  var key = String(code);
  var hit = MEMO[key];
  if (!force && hit && Date.now() - hit.t < 60000) {
    return Promise.resolve(hit.data);
  }
  return fetchKline(code, limit).then(function (klines) {
    MEMO[key] = { t: Date.now(), data: klines };
    return klines;
  });
}

module.exports = {
  fetchDetail: fetchDetail,
  buildInfo: buildInfo,
  fetchKline: fetchKline,
  load: load
};
