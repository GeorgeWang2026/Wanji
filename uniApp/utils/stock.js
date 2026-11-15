/* ============================================================
 * stock.js —— 证券数据适配层（DF-99）
 * ------------------------------------------------------------
 * 1) 详情信息：GET /api/v1/stocks/detail?code=
 *    与网站 static/xiaoxuan.html 证券详情页（#stockDetailInfo）同一接口、
 *    同一字段口径；渲染用的易学查找表照 static/mystock/yijing.js 同名函数移植。
 * 2) 日 K：不再由小程序取数，改为全屏图表页 web-view 加载站点 kline.html
 *    （TradingView 组件自带取数 /tv/history 与画线能力，地址与站点详情页 iframe 一致）。
 * ============================================================ */
var api = require('./api.js');

/**
 * 代码补市场前缀（后端只接受 SH./SZ. 形式，与网站一致：a:SH.600519）。
 * 已有前缀则原样返回；给了 market/exchange 优先用；否则按代码规则推断：
 * 6/9 → SH.，0/3 → SZ.
 * @param {string} code 600519 / SH.600519 / a:SH.600519
 * @param {string} [market] 数据源已给的市场字段，如 SH / SZ / SSE / SZSE
 * @returns {string} 带前缀代码，如 SH.600519
 */
function withMarket(code, market) {
  var raw = String(code || '').trim().toUpperCase();
  var pre = raw.match(/^A:([A-Z]{2})\.(\d{6})$/);
  if (pre) return pre[1] + '.' + pre[2];
  var full = raw.match(/^([A-Z]{2})\.(\d{6})$/);
  if (full) return full[1] + '.' + full[2];
  var digits = raw.replace(/\D/g, '').slice(0, 6);
  if (!digits) return '';
  var m = String(market || '').trim().toUpperCase();
  if (m === 'SSE' || m === 'SH' || m === '1' || m === '沪' || m === '上海') return 'SH.' + digits;
  if (m === 'SZSE' || m === 'SZ' || m === '0' || m === '深' || m === '深圳') return 'SZ.' + digits;
  return ((digits.charAt(0) === '6' || digits.charAt(0) === '9') ? 'SH.' : 'SZ.') + digits;
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
function fetchDetail(code, market) {
  var full = withMarket(code, market);
  return api.request('/stocks/detail?code=' + encodeURIComponent(full)).then(function (r) {
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

module.exports = {
  withMarket: withMarket,
  fetchDetail: fetchDetail,
  buildInfo: buildInfo
};
