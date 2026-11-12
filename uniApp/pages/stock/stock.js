/* ============================================================
 * 证券行情（原生页，canvas 2d 绘制 K 线）
 * ------------------------------------------------------------
 * 入口：首页排盘圆钮第 4 个「📈 证券」→ openPaipan 跳 /uniApp/pages/stock/stock
 *
 * 数据接入（关键限制，正式发布前必须处理）：
 *   行情来自东方财富公开接口，代码见 utils/stock.js。
 *   1) 小程序后台「开发管理 → 服务器域名 → request 合法域名」需加入
 *      push2.eastmoney.com 与 push2his.eastmoney.com；
 *      开发者工具里可先勾「不校验合法域名」看效果。
 *   2) 公开接口无 SLA、无鉴权，字段可能变动。若后端补了行情代理，
 *      只改 utils/stock.js 里的 QUOTE_URL / KLINE_URL，本页无需改动。
 *   3) 取不到数据时不空转：页面给出明确的加载中 / 无数据 / 失败三态，
 *      失败态可直接点击重试，并提示域名白名单的排查路径。
 *
 * 与网页版的差异：
 *   - 小程序 canvas 2d 是静态绘制，没有逐帧动画；十字线跟随手指重绘。
 *   - 没有 iframe / web-view，纯原生绘制。
 * ============================================================ */
var stock = require('../../utils/stock.js');

var PRESETS = [
  { code: '600519', name: '贵州茅台' },
  { code: '000001', name: '平安银行' },
  { code: '600028', name: '中国石化' },
  { code: '300750', name: '宁德时代' }
];

var PERIODS = [
  { k: 'day', t: '日K' },
  { k: 'week', t: '周K' },
  { k: 'month', t: '月K' }
];

var UP_COLOR = '#ff6478';   // 红涨
var DOWN_COLOR = '#50c88c'; // 绿跌
var MA_COLORS = ['#e8b84a', '#b088e0', '#50a8ff'];

function fixed(n, d) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(d === undefined ? 2 : d);
}

function signed(n, suffix) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + Number(n).toFixed(2) + (suffix || '');
}

function fmtVol(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿手';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万手';
  return v + '手';
}

function fmtAmt(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return fixed(v, 0);
}

function maList(list, n) {
  var out = [];
  var sum = 0;
  for (var i = 0; i < list.length; i++) {
    sum += list[i].close;
    if (i >= n) sum -= list[i - n].close;
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

Page({
  data: {
    code: '600519',
    codeInput: '600519',
    period: 'day',
    periods: PERIODS,
    presets: PRESETS,

    name: '',
    priceText: '—',
    changeText: '—',
    pctText: '—',
    colorClass: 'flat',
    quoteRows: [],

    status: 'loading',   // loading | ready | empty | error
    errMsg: '',
    cursorText: '',
    maText: 'MA5 —  MA10 —  MA20 —'
  },

  onLoad: function () {
    this._klines = [];
    this._cursor = -1;
    this._seq = 0;
    this.load();
  },

  onReady: function () {
    var self = this;
    this.initCanvas().then(function () { self.draw(); });
  },

  onUnload: function () {
    this._canvas = null;
    this._ctx = null;
  },

  onPullDownRefresh: function () {
    this.load(true).then(function () { wx.stopPullDownRefresh(); });
  },

  /* ---------------- 数据 ---------------- */
  load: function (force) {
    var self = this;
    var code = this.data.code;
    var period = this.data.period;
    var seq = ++this._seq;

    this.setData({ status: 'loading', errMsg: '', cursorText: '' });
    this._cursor = -1;
    this._klines = [];

    return stock.load(code, period, 90, force).then(function (d) {
      if (seq !== self._seq) return;
      var q = d.quote || {};
      self.applyQuote(q);
      self._klines = d.klines || [];
      self.setData({
        status: self._klines.length ? 'ready' : 'empty',
        codeInput: code
      });
      self.initCanvas().then(function () { self.draw(); });
    }).catch(function (err) {
      if (seq !== self._seq) return;
      self.setData({
        status: 'error',
        errMsg: (err && err.message) || '网络请求失败'
      });
      self.draw();
    });
  },

  applyQuote: function (q) {
    var price = q.price;
    var change = q.change;
    var pct = q.changePct;
    var cls = 'flat';
    if (change > 0) cls = 'up';
    else if (change < 0) cls = 'down';

    this.setData({
      name: q.name || '',
      priceText: fixed(price),
      changeText: signed(change),
      pctText: signed(pct, '%'),
      colorClass: cls,
      quoteRows: [
        { k: '今开', v: fixed(q.open) },
        { k: '最高', v: fixed(q.high) },
        { k: '最低', v: fixed(q.low) },
        { k: '昨收', v: fixed(q.prevClose) },
        { k: '成交量', v: fmtVol(q.volume) },
        { k: '成交额', v: fmtAmt(q.amount) }
      ]
    });
  },

  /* ---------------- 交互 ---------------- */
  onCodeInput: function (e) {
    this.setData({ codeInput: String(e.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },

  onSearch: function () {
    var code = this.data.codeInput;
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: '请输入 6 位股票代码', icon: 'none' });
      return;
    }
    if (code === this.data.code && this.data.status === 'ready') return;
    this.setData({ code: code });
    this.load();
  },

  onPreset: function (e) {
    var code = e.currentTarget.dataset.code;
    if (code === this.data.code) return;
    this.setData({ code: code, codeInput: code });
    this.load();
  },

  onPeriod: function (e) {
    var k = e.currentTarget.dataset.k;
    if (k === this.data.period) return;
    this.setData({ period: k, cursorText: '' });
    this._cursor = -1;
    this.load();
  },

  onRetry: function () {
    this.load(true);
  },

  /* ---------------- Canvas ---------------- */
  initCanvas: function () {
    if (this._canvas) return Promise.resolve();
    var self = this;
    return new Promise(function (resolve) {
      wx.createSelectorQuery().in(self).select('#kline').fields({ node: true, size: true, rect: true }).exec(function (res) {
        var r = res && res[0];
        if (!r || !r.node || !r.width) { resolve(); return; }
        var dpr = 1;
        try {
          var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          dpr = info.pixelRatio || 1;
        } catch (e) { /* 忽略 */ }
        r.node.width = r.width * dpr;
        r.node.height = r.height * dpr;
        var ctx = r.node.getContext('2d');
        ctx.scale(dpr, dpr);
        self._canvas = r.node;
        self._ctx = ctx;
        self._cw = r.width;
        self._ch = r.height;
        self._canvasLeft = r.left || 0;
        resolve();
      });
    });
  },

  draw: function () {
    var ctx = this._ctx;
    if (!ctx) return;
    var w = this._cw;
    var h = this._ch;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    var list = this._klines;
    var n = list.length;
    if (!n) {
      this.geo = null;
      return;
    }

    var padL = 6;
    var padR = 48;
    var padT = 8;
    var padB = 16;
    var chartH = h - padT - padB;
    var mainH = chartH * 0.72;
    var volH = chartH * 0.24;
    var volTop = padT + mainH + chartH * 0.04;
    var plotW = w - padL - padR;
    var xStep = plotW / n;
    var candleW = Math.max(1, Math.min(xStep * 0.66, 12));

    var ma5 = maList(list, 5);
    var ma10 = maList(list, 10);
    var ma20 = maList(list, 20);

    var minP = Infinity;
    var maxP = -Infinity;
    var maxV = 0;
    for (var i = 0; i < n; i++) {
      if (list[i].low < minP) minP = list[i].low;
      if (list[i].high > maxP) maxP = list[i].high;
      if (list[i].volume > maxV) maxV = list[i].volume;
    }
    [ma5, ma10, ma20].forEach(function (arr) {
      for (var j = 0; j < arr.length; j++) {
        if (arr[j] === null) continue;
        if (arr[j] < minP) minP = arr[j];
        if (arr[j] > maxP) maxP = arr[j];
      }
    });
    if (!isFinite(minP) || !isFinite(maxP)) {
      minP = 0;
      maxP = 1;
    }
    if (maxP - minP < 0.01) maxP = minP + 0.01;
    var padP = (maxP - minP) * 0.04;
    minP -= padP;
    maxP += padP;
    var spanP = maxP - minP;

    function yOf(p) {
      return padT + (maxP - p) / spanP * mainH;
    }
    function xOf(i) {
      return padL + xStep * (i + 0.5);
    }

    // 价格网格 + 右侧价格标签
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(147,112,219,.18)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = padT + mainH * g / 4;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();
      ctx.fillStyle = '#7f6fa8';
      ctx.fillText((maxP - spanP * g / 4).toFixed(2), padL + plotW + 6, gy);
    }
    ctx.setLineDash([]);

    // 成交量区基线
    ctx.strokeStyle = 'rgba(147,112,219,.18)';
    ctx.beginPath();
    ctx.moveTo(padL, volTop);
    ctx.lineTo(padL + plotW, volTop);
    ctx.stroke();

    // 蜡烛 + 成交量
    for (var k = 0; k < n; k++) {
      var c = list[k];
      var color = c.close >= c.open ? UP_COLOR : DOWN_COLOR;
      var cx = xOf(k);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yOf(c.high));
      ctx.lineTo(cx, yOf(c.low));
      ctx.stroke();

      var top = yOf(Math.max(c.open, c.close));
      var bot = yOf(Math.min(c.open, c.close));
      var bodyH = Math.max(1, bot - top);
      // 小尺寸下实心比空心更清晰，涨跌统一实心、以颜色区分
      ctx.fillRect(cx - candleW / 2, top, candleW, bodyH);

      if (maxV > 0) {
        var vh = (c.volume / maxV) * volH;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(cx - candleW / 2, volTop + volH - vh, candleW, vh);
        ctx.globalAlpha = 1;
      }
    }

    // 均线
    function drawMA(arr, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      var started = false;
      for (var m = 0; m < arr.length; m++) {
        if (arr[m] === null) { started = false; continue; }
        var px = xOf(m);
        var py = yOf(arr[m]);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    drawMA(ma5, MA_COLORS[0]);
    drawMA(ma10, MA_COLORS[1]);
    drawMA(ma20, MA_COLORS[2]);

    // 底部日期（首 / 中 / 末）
    ctx.fillStyle = '#7f6fa8';
    ctx.textBaseline = 'top';
    var marks = [0, Math.floor((n - 1) / 2), n - 1];
    for (var t = 0; t < marks.length; t++) {
      var idx = marks[t];
      var label = String(list[idx].date || '').slice(2);
      ctx.textAlign = t === 0 ? 'left' : (t === marks.length - 1 ? 'right' : 'center');
      ctx.fillText(label, t === 0 ? padL : (t === marks.length - 1 ? padL + plotW : padL + plotW / 2), padT + mainH + chartH * 0.04 + volH + 4);
    }

    // 十字线（手指按住时）
    if (this._cursor >= 0 && this._cursor < n) {
      var ci = this._cursor;
      var ccx = xOf(ci);
      var ccy = yOf(list[ci].close);
      ctx.strokeStyle = 'rgba(232,224,240,.55)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ccx, padT);
      ctx.lineTo(ccx, padT + mainH);
      ctx.moveTo(padL, ccy);
      ctx.lineTo(padL + plotW, ccy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e8dff5';
      ctx.beginPath();
      ctx.arc(ccx, ccy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // MA 图例文本
    var lastMa5 = ma5[ma5.length - 1];
    var lastMa10 = ma10[ma10.length - 1];
    var lastMa20 = ma20[ma20.length - 1];
    var legend = 'MA5 ' + (lastMa5 === null ? '—' : lastMa5.toFixed(2))
      + '  MA10 ' + (lastMa10 === null ? '—' : lastMa10.toFixed(2))
      + '  MA20 ' + (lastMa20 === null ? '—' : lastMa20.toFixed(2));
    if (legend !== this.data.maText) this.setData({ maText: legend });

    this.geo = {
      padL: padL,
      plotW: plotW,
      xStep: xStep,
      n: n
    };
  },

  /* ---------------- 十字线触摸 ---------------- */
  onTouch: function (e) {
    var geo = this.geo;
    var list = this._klines;
    if (!geo || !list.length) return;
    var t = e.touches && e.touches[0];
    if (!t) return;
    var x = t.x;
    if (typeof x !== 'number' || isNaN(x)) {
      if (typeof t.clientX !== 'number') return;
      x = t.clientX - (this._canvasLeft || 0);
    }
    var idx = Math.floor((x - geo.padL) / geo.xStep);
    if (idx < 0) idx = 0;
    if (idx > geo.n - 1) idx = geo.n - 1;
    if (idx === this._cursor) return;

    this._cursor = idx;
    var c = list[idx];
    this.setData({
      cursorText: c.date + '　开 ' + fixed(c.open) + '　收 ' + fixed(c.close)
        + '　高 ' + fixed(c.high) + '　低 ' + fixed(c.low) + '　量 ' + fmtVol(c.volume)
    });
    this.draw();
  },

  onTouchEnd: function () {
    if (this._cursor < 0) return;
    this._cursor = -1;
    this.setData({ cursorText: '' });
    this.draw();
  }
});
