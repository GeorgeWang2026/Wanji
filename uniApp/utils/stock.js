/* ============================================================
 * stock.js —— 证券数据适配层（DF-99）
 * ------------------------------------------------------------
 * 1) 详情信息：GET /api/v1/stocks/detail?code=
 *    与网站 static/xiaoxuan.html 证券详情页（#stockDetailInfo）同一接口、
 *    同一字段口径；渲染用的易学查找表照 static/mystock/yijing.js 同名函数移植。
 * 2) 日 K：GET /api/v1/tv/history（与网站 kline.html 完全同一套 UDF 接口）
 *    - 站点 kline.html L743 用 Datafeeds.UDFCompatibleDatafeed(API_BASE + "/tv")，
 *      由 UDF 发出 /tv/history?symbol=&resolution=&from=&to=&countback=&firstDataRequest=，
 *      attachHistoryParams 再注入 fq；这里按同一契约直接组装请求。
 *    - 站点详情页 K 线 iframe 的地址为 /mystock/kline.html?symbol=a:<code>&interval=1D&simple=1
 *      （xiaoxuan.html L6352），故 symbol=a:<code>、resolution=1D。
 *    - 返回体 {s,t,o,h,l,c,v}：s!=="ok" 视为无数据，t 为秒级时间戳。
 *    - 不依赖任何外部域名（与详情接口同源 https://estock.space/api/v1）。
 * ============================================================ */
var api = require('./api.js');

var MEMO = {};

/** 与站点 kline.html 首屏取数一致的条数（图表库首次 getBars 的 countBack 默认 300） */
var COUNTBACK = 300;
var RESOLUTION = '1D';

/** 秒级时间戳 → YYYY-MM-DD（与 kline.html laneRenderStrategy 的 fmtDate 同口径） */
function fmtDate(tSec) {
  var d = new Date(tSec * 1000);
  var p2 = function (v) { return (v < 10 ? '0' : '') + v; };
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

/**
 * 组装 /tv/history 请求（复刻 UDF datafeed 首次取数的请求形状）。
 * @param {string} code 6 位代码
 * @returns {string} 接口路径（含 query）
 */
function historyPath(code, countback) {
  var to = Math.floor(Date.now() / 1000);
  var cb = countback || COUNTBACK;
  var from = to - cb * 86400;
  return '/tv/history?symbol=' + encodeURIComponent('a:' + code)
    + '&resolution=' + RESOLUTION
    + '&from=' + from
    + '&to=' + to
    + '&countback=' + cb
    + '&firstDataRequest=true'
    + '&fq=qfq';
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
 * 日 K —— /tv/history（与站点 kline.html 同一接口）
 * ============================================================ */

/**
 * 拉取日 K。
 * 返回 Promise<Array<{date,open,high,low,close,volume}>>；
 * s!=="ok" 或 t 为空 → 空数组（对应站点「暂无 K 线数据」）；
 * 网络/HTTP 异常 → reject（对应站点「K线数据加载失败」）。
 */
function fetchKline(code) {
  return api.request(historyPath(code), { auth: false, timeout: 20000 }).then(function (r) {
    if (!r || r.s !== 'ok' || !r.t || !r.t.length) return [];
    var out = [];
    for (var i = 0; i < r.t.length; i++) {
      // UDF 返回并列数组：t 秒级时间戳 / o 开 / h 高 / l 低 / c 收 / v 量
      out.push({
        date: fmtDate(r.t[i]),
        open: Number(r.o[i]),
        high: Number(r.h[i]),
        low: Number(r.l[i]),
        close: Number(r.c[i]),
        volume: Number(r.v[i])
      });
    }
    return out;
  });
}

/** 带 60s 内存缓存（对齐站点 PULSE_MS 的刷新节奏）；force=true 强制绕过缓存 */
function load(code, force) {
  var key = String(code);
  var hit = MEMO[key];
  if (!force && hit && Date.now() - hit.t < 60000) {
    return Promise.resolve(hit.data);
  }
  return fetchKline(code).then(function (klines) {
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
