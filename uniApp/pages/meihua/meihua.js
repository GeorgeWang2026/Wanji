/* ============================================================
 * 梅花易数页（对应 xiaoxuan.html 的梅花弹窗）
 * 算法全部复用工程根 yishu.js：meihuaGua / lookup64 / mhWxRel / parseFangweiGua
 * ============================================================ */
var Y = require('../../utils/yishu.js');
var paipan = require('../../utils/paipan.js');
/* DF-82：时间栏参数（年/月/日/时/分）与奇门同源，统一走 timebar */
var TB = require('../../utils/timebar.js');

/** DF-82：数字起卦取值 1-99；非数字/0/负数 → 1，大于 99 → 99（静默钳制，不弹错误） */
function clampNum(v) {
  var n = parseInt(v, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 99) n = 99;
  return n;
}

var MODES = [
  { k: 'time', t: '时间起卦' },
  { k: 'num', t: '数字起卦' },
  { k: 'word', t: '物象起卦' }
];

Page({
  data: {
    mode: 'time',
    modes: MODES,
    /* DF-82：时间区与奇门同源，年/月/日/时（含分）四格一排 + 右端「当前时间」图标 */
    years: [],
    months: [],
    days: [],
    time: '',
    yearIdx: 0,
    monthIdx: 0,
    dayIdx: 0,
    n1: '',
    n2: '',
    guaNames: [],
    upIdx: 0,
    downIdx: 0,
    csNames: [],
    csIdx: 0,
    built: false,
    hexes: [],
    gua: {},
    tiYong: {},
    summary: {},
    hint: '',
    showHint: false
  },

  onLoad: function () {
    var d = new Date();
    var MH_GUA = Y.dict('MH_GUA') || [];
    var CS = Y.dict('CHENSHI_12') || [];
    var names = MH_GUA.map(function (g) { return g.name + '（' + g.wx + '）'; });
    var csNames = CS.map(function (c) { return c.name + '时 ' + c.range; });

    this.MH_GUA = MH_GUA;
    this.CS = CS;
    this.years = TB.yearRange();
    this.setData({
      guaNames: names,
      csNames: csNames,
      csIdx: Math.max(0, this.chenshiIdxOfHour(d.getHours()) - 1)
    });
    this._setTime({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() });
    this.buildGua();
  },

  noop: function () {},

  /** 0-23 时 → CHENSHI_12 数组下标 */
  chenshiIdxOfHour: function (hour) {
    var fn = Y.engine && Y.engine.getChenshiFromHour;
    var idx = fn ? fn(hour) : 1; // 1..12
    return idx;
  },

  onMode: function (e) {
    this.setData({ mode: e.currentTarget.dataset.k, built: false });
  },

  /* DF-82：时间区（年/月/日 + 时含分 四格一排）；改时间只更新输入，不自动起卦 */
  _setTime: function (t) {
    var n = TB.normalize(t);
    this.mtime = { y: n.y, m: n.m, d: n.d, h: n.h, mi: n.mi };
    this.setData({
      years: this.years,
      months: TB.monthOptions(),
      days: TB.dayOptions(n.y, n.m),
      yearIdx: n.y - 1900,
      monthIdx: n.m - 1,
      dayIdx: n.d - 1,
      time: TB.p2(n.h) + ':' + TB.p2(n.mi)
    });
  },

  _onFieldChange: function (patch) {
    var t = { y: this.mtime.y, m: this.mtime.m, d: this.mtime.d, h: this.mtime.h, mi: this.mtime.mi };
    for (var k in patch) { if (patch.hasOwnProperty(k)) t[k] = patch[k]; }
    this._setTime(t);
  },

  onYearChange: function (e) { this._onFieldChange({ y: 1900 + Number(e.detail.value) }); },
  onMonthChange: function (e) { this._onFieldChange({ m: Number(e.detail.value) + 1 }); },
  onDayChange: function (e) { this._onFieldChange({ d: Number(e.detail.value) + 1 }); },
  /** DF-82：时间控件一次给出 HH:mm，时与分同时写入 */
  onTimeChange: function (e) {
    var parts = String(e.detail.value || '').split(':');
    this._onFieldChange({ h: Number(parts[0]), mi: Number(parts[1]) });
  },

  /** 「当前时间」：四格回填系统当前时间并立即起卦（无需再点「起卦」） */
  useNow: function () {
    var d = new Date();
    this._setTime({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() });
    this.buildGua();
  },

  onN1: function (e) { this.setData({ n1: e.detail.value }); },
  onN2: function (e) { this.setData({ n2: e.detail.value }); },
  /** DF-82：随机填值 1-99（只填值、不连带起卦，不聚焦、不弹键盘） */
  onRandomN1: function () { this.setData({ n1: 1 + Math.floor(Math.random() * 99) }); },
  onRandomN2: function () { this.setData({ n2: 1 + Math.floor(Math.random() * 99) }); },
  onUpChange: function (e) { this.setData({ upIdx: Number(e.detail.value) }); },
  onDownChange: function (e) { this.setData({ downIdx: Number(e.detail.value) }); },
  onCsChange: function (e) { this.setData({ csIdx: Number(e.detail.value) }); },

  buildGua: function () {
    if (!Y.available) {
      wx.showModal({ title: '引擎未就绪', content: '术数引擎 yishu.js 未加载成功。', showCancel: false });
      return;
    }
    var mode = this.data.mode;
    var gua = null;
    var input = { mode: mode };

    try {
      if (mode === 'time') {
        var mt = this.mtime || {};
        var t = { y: mt.y, m: mt.m, d: mt.d, h: mt.h, mi: mt.mi };
        gua = Y.meihuaGua({ mode: 'time', year: t.y, month: t.m, day: t.d, hour: t.h });
        input.time = t;
      } else if (mode === 'num') {
        var n1 = clampNum(this.data.n1);
        var n2 = clampNum(this.data.n2);
        gua = Y.meihuaGua({ mode: 'num', n1: n1, n2: n2 });
        input.number = { n1: n1, n2: n2, n3: null };
      } else {
        var upG = this.MH_GUA[this.data.upIdx];
        var downG = this.MH_GUA[this.data.downIdx];
        var cs = this.CS[this.data.csIdx];
        gua = Y.meihuaGua({
          mode: 'word',
          upN: upG.n,
          downN: downG.n,
          csIdx: cs ? cs.idx : 1
        });
        input.word = { text: '', upN: upG.n, downN: downG.n, csIdx: cs ? cs.idx : 1, cs: cs ? cs.name : null };
      }
    } catch (e) {
      console.error('[meihua] 起卦失败', e);
      wx.showModal({ title: '起卦失败', content: (e && e.message) || String(e), showCancel: false });
      return;
    }

    if (!gua) {
      wx.showToast({ title: '起卦结果为空', icon: 'none' });
      return;
    }

    var r = paipan.buildMeihua(gua, mode, input);
    this.result = r;
    input.summary = r.meta.summary;
    r.payload.input.summary = r.meta.summary;
    this.render(r, gua);
  },

  /** 把三爻/六爻转成可渲染的行（自上而下，阳爻实线，阴爻断开） */
  buildLines: function (yaoArr, markIdx) {
    var arr = yaoArr.slice().reverse(); // 变为自上而下
    return arr.map(function (v, i) {
      var pos = yaoArr.length - i; // 原始自下而上的爻位（1 起）
      return { idx: i, yang: v === 1, mark: markIdx === pos };
    });
  },

  render: function (r, gua) {
    // 注意：引擎返回的 up/down/huUpperGua... 都是八卦对象（含 n/name/wx/sym/yao），不是序号
    var up = gua.up;
    var down = gua.down;
    var huUp = gua.huUpperGua;
    var huDown = gua.huLowerGua;
    var bianUp = gua.bianUpperGua;
    var bianDown = gua.bianLowerGua;
    var MH_64 = Y.dict('MH_64') || {};

    var benKey = up.n * 10 + down.n;
    var huKey = huUp.n * 10 + huDown.n;
    var bianKey = bianUp.n * 10 + bianDown.n;

    // 变卦：本卦自下而上第 moveYao 爻翻转
    var benYao = down.yao.concat(up.yao);
    var bianYao = benYao.slice();
    bianYao[gua.moveYao - 1] = bianYao[gua.moveYao - 1] === 1 ? 0 : 1;

    var hexes = [
      {
        title: '本卦', num: (MH_64[benKey] || {}).num || 0, moveYao: gua.moveYao,
        lines: this.buildLines(benYao, gua.moveYao),
        name: (MH_64[benKey] || {}).full || '未知卦',
        sub: up.name + '上' + down.name + '下 · ' + up.wx + down.wx
      },
      {
        title: '互卦', num: (MH_64[huKey] || {}).num || 0, moveYao: 0,
        lines: this.buildLines(huDown.yao.concat(huUp.yao), 0),
        name: (MH_64[huKey] || {}).full || '未知卦',
        sub: huUp.name + '上' + huDown.name + '下'
      },
      {
        title: '变卦', num: (MH_64[bianKey] || {}).num || 0, moveYao: 0,
        lines: this.buildLines(bianYao, gua.moveYao),
        name: (MH_64[bianKey] || {}).full || '未知卦',
        sub: bianUp.name + '上' + bianDown.name + '下'
      }
    ];

    var rel = '';
    if (Y.engine && Y.engine.mhWxRel) {
      try { rel = Y.engine.mhWxRel(gua.yongGua.wx, gua.tiGua.wx) || ''; } catch (e) { rel = ''; }
    }

    this.setData({
      built: true,
      hexes: hexes,
      gua: { moveYao: gua.moveYao, up: gua.up, down: gua.down },
      tiYong: {
        tiName: gua.tiGua.name,
        tiWx: gua.tiGua.wx,
        yongName: gua.yongGua.name,
        yongWx: gua.yongGua.wx,
        rel: rel
      },
      summary: {
        ben: (MH_64[benKey] || {}).full || '',
        hu: (MH_64[huKey] || {}).full || '',
        bian: (MH_64[bianKey] || {}).full || ''
      }
    });
  },

  openGua: function (e) {
    var num = Number(e.currentTarget.dataset.num);
    var yao = Number(e.currentTarget.dataset.yao || 0);
    if (!num) { wx.showToast({ title: '未找到卦序', icon: 'none' }); return; }
    wx.navigateTo({ url: '/uniApp/pages/gua/gua?num=' + num + '&yao=' + yao });
  },

  previewPrompt: function () {
    var self = this;
    if (!this.result) return;
    wx.showLoading({ title: '生成中…' });
    paipan.fetchPromptText({ meihua: this.result.payload }).then(function (r) {
      wx.hideLoading();
      self.setData({ hint: r.hint || r.texts.meihua || '（盘面数据组装为空）', showHint: true });
    }).catch(function (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '预览失败', icon: 'none' });
    });
  },

  closeHint: function () { this.setData({ showHint: false }); },

  onBind: function () {
    if (!this.result) return;
    var app = getApp();
    app.globalData.paipan = app.globalData.paipan || {};
    app.globalData.paipan.meihua = { payload: this.result.payload, meta: this.result.meta };
    wx.showToast({ title: '已关联到提问', icon: 'none' });
    setTimeout(function () { wx.navigateBack(); }, 400);
  }
});
