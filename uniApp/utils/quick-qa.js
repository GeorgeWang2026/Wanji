/**
 * DF-81：首页快捷问题池（照抄网站 xiaoxuan.html / assistant-widget.js 的权威模板）
 * - 文案与标点一律照录，不新造、不改写
 * - 关联证券：12 条证券操作模板洗牌取 4 条，注入 {name}
 * - 未关联：6 组通用模板随机取 3 组、每组随机一条模板 + 随机方向词替换 {0}，共 3 条
 */
var GENERAL_PACKS = [
  { t: ['帮我分析未来一年的{0}趋势如何？', '今年我的{0}方面会怎样？', '看看最近三个月在{0}上的表现'], d: ['投资', '婚恋', '事业'] },
  { t: ['今年的{0}运怎么样？', '想知道明年{0}方面的情况', '帮我看看未来三年的{0}走势'], d: ['财运', '健康', '事业'] },
  { t: ['未来一年在{0}上有什么机遇？', '这两年{0}的发展如何？', '半年内{0}有什么动向'], d: ['合作', '学业', '出行'] },
  { t: ['明年全年的{0}如何？', '近期{0}方面要注意什么', '帮我推演一下明年的{0}情况'], d: ['婚恋', '事业', '投资'] },
  { t: ['{0}方面这两年会怎样？', '未来三年的{0}运如何', '看看今年{0}上有什么变化'], d: ['财运', '升迁', '健康'] },
  { t: ['明年我的{0}会怎样？', '这半年{0}有什么关键节点', '帮我看看{0}接下来的走向'], d: ['事业', '投资', '婚恋'] }
];

var STOCK_TPLS = [
  '{name}现在可以抄底了吗？',
  '{name}加仓有风险吗？',
  '{name}补仓没问题吧？',
  '{name}可以清仓了吗？',
  '{name}适合现在追高吗？',
  '{name}要不要止损离场？',
  '{name}适合做T还是继续持有？',
  '{name}短线能看到多少目标位？',
  '{name}这波上涨能跟上吗？',
  '{name}接下来该减仓还是持有？',
  '{name}现在建仓时机合适吗？',
  '{name}被套了该怎么操作？'
];

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * 按当前绑定生成快捷问题
 * @param {{stockName?:string, count?:number}} opts
 * @returns {{examples:string[], examplesStock:boolean}}
 */
function render(opts) {
  opts = opts || {};
  var name = opts.stockName;
  if (name) {
    var n = opts.count || 4;
    var list = shuffle(STOCK_TPLS).slice(0, n).map(function (t) {
      return t.replace(/\{name\}/g, name);
    });
    return { examples: list, examplesStock: true };
  }
  var packs = shuffle(GENERAL_PACKS).slice(0, 3);
  var gen = packs.map(function (p) {
    return pick(p.t).replace(/\{0\}/g, pick(p.d));
  });
  return { examples: gen, examplesStock: false };
}

module.exports = { GENERAL_PACKS: GENERAL_PACKS, STOCK_TPLS: STOCK_TPLS, render: render };
