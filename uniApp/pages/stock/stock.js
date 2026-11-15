/* ============================================================
 * 证券详情（原生页，DF-99）
 * ------------------------------------------------------------
 * 参照物：网站 static/xiaoxuan.html 的证券详情页（#stockDetailModal）
 *   - 信息区 #stockDetailInfo（股票/涨跌幅/方向/级别/结构/态势/空间/行业）
 *   - K 线 embed（kline.html，simple 模式）；单据要求：只做日 K、方形满宽
 *   - 底部工具栏（预览提示词 / 关联到提问）保持原样
 * 画线：B 方案 —— 小程序本地绘制、本地保存（wx.setStorageSync），不读网站已画线
 * ============================================================ */
var stock = require('../../utils/stock.js');
var paipan = require('../../utils/paipan.js');

var UP_COLOR = '#EF5350';    // 与 kline.html klineColors 一致
var DOWN_COLOR = '#26A69A';
var MA_COLORS = ['#c9a227', '#3b82c4', '#8a6fbf'];
var DRAW_COLOR = '#2962FF';  // TradingView 手绘趋势线默认色
var TREND_KEY = 'kline_draw_v1:';    // 对齐站点「symbol|级别」的画线存储口径
var VISIBLE_BARS = 90;       // 绘制窗口（取数 300 根与站点一致，小程序无平移只画最近一段）

function fixed(n, d) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(d === undefined ? 2 : d);
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

/** canvas 触摸点 → 画布内坐标 */
function touchXY(e, left, top) {
  var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  if (!t) return null;
  var x = t.x;
  var y = t.y;
  if (typeof x !== 'number' || isNaN(x)) {
    if (typeof t.clientX !== 'number') return null;
    x = t.clientX - (left || 0);
  }
  if (typeof y !== 'number' || isNaN(y)) {
    if (typeof t.clientY !== 'number') return null;
    y = t.clientY - (top || 0);
  }
  return { x: x, y: y };
}

Page({
  data: {
    code: '',
    name: '',

    infoStatus: 'loading',   // loading | ready | empty
    info: null,

    status: 'loading',       // loading | ready | empty | error
    chartTip: 'K线图加载中…',  // 与 kline.html #kline_tip 同文案，文字随状态切换

    drawMode: false,
    drawTool: 'h',           // h 水平线 | t 趋势线

    hint: '',
    showHint: false
  },

  onLoad: function (options) {
    this._klines = [];
    this._drawings = [];
    this._pending = null;
    this._cursor = -1;
    this._seq = 0;

    var opt = options || {};
    var code = opt.code ? String(opt.code).trim() : '';
    var name = opt.name ? String(opt.name).trim() : '';
    var mm = code.match(/\d{6}/);
    if (mm) code = mm[0];
    if (!code) code = '600519';   // 无参进入时的兜底（与页面上线前一致）

    this.setData({ code: code, name: name });
    this.applyTitle();
    this.load();
    this.loadInfo();
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
    var self = this;
    this.load(true).then(function () {
      self.loadInfo();
      wx.stopPullDownRefresh();
    });
  },

  /** 标题：与网站弹框标题同格式「📈 名称（代码）」 */
  applyTitle: function () {
    var name = this.data.name || this.data.code;
    var code = this.data.code;
    wx.setNavigationBarTitle({
      title: '📈 ' + (name || '证券详情') + (code ? '（' + code + '）' : '')
    });
  },

  /* ---------------- 详情信息 ---------------- */
  loadInfo: function () {
    var self = this;
    var code = this.data.code;
    if (!code) {
      this.setData({ infoStatus: 'empty', info: null });
      return;
    }
    this.setData({ infoStatus: 'loading', info: null });
    stock.fetchDetail(code).then(function (d) {
      var info = stock.buildInfo(d, { name: self.data.name, code: code });
      if (!info) {
        self.setData({ infoStatus: 'empty', info: null });
        return;
      }
      self.setData({ infoStatus: 'ready', info: info, name: info.name || self.data.name });
      self.applyTitle();
    }).catch(function () {
      // 与网站一致：接口失败按「暂无该证券详情数据」展示，不阻断 K 线
      self.setData({ infoStatus: 'empty', info: null });
    });
  },

  /* ---------------- 日 K（/tv/history，与站点同一接口） ---------------- */
  load: function (force) {
    var self = this;
    var code = this.data.code;
    var seq = ++this._seq;

    this.setData({ status: 'loading', chartTip: 'K线图加载中…' });
    this._klines = [];
    this._pending = null;

    return stock.load(code, force).then(function (klines) {
      if (seq !== self._seq) return;
      self._klines = klines || [];
      self._drawings = self.readDrawings();
      if (self._klines.length) {
        self.setData({ status: 'ready' });
      } else {
        // 与站点 showKlineError 的 no_data 分支同文案
        self.setData({ status: 'empty', chartTip: '暂无 K 线数据，请稍后重试' });
      }
      self.initCanvas().then(function () { self.draw(); });
    }).catch(function () {
      if (seq !== self._seq) return;
      // 与站点 showKlineError 的请求异常分支同文案
      self.setData({ status: 'error', chartTip: 'K线数据加载失败，请稍后重试' });
      self.draw();
    });
  },

  /* ---------------- 本地画线（B 方案） ---------------- */
  /** 存储键与站点一致按「symbol|级别」区分：kline_draw_v1:a:600519|1D */
  drawKey: function () {
    return TREND_KEY + 'a:' + this.data.code + '|1D';
  },

  readDrawings: function () {
    try {
      var raw = wx.getStorageSync(this.drawKey());
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },

  saveDrawings: function () {
    try {
      wx.setStorageSync(this.drawKey(), JSON.stringify(this._drawings || []));
    } catch (e) { /* 忽略 */ }
  },

  toggleDraw: function () {
    var on = !this.data.drawMode;
    this._pending = null;
    this._cursor = -1;
    this.setData({ drawMode: on, drawTool: on ? (this.data.drawTool === 't' ? 't' : 'h') : 'none' });
    this.draw();
  },

  pickTool: function (e) {
    var t = e.currentTarget.dataset.tool || 'h';
    this._pending = null;
    this.setData({ drawMode: true, drawTool: t });
    this.draw();
  },

  undoDraw: function () {
    if (!this._drawings.length) return;
    this._drawings.pop();
    this.saveDrawings();
    this.draw();
  },

  clearDraw: function () {
    if (!this._drawings.length) return;
    this._drawings = [];
    this.saveDrawings();
    this.draw();
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
        self._canvasTop = r.top || 0;
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

    var all = this._klines;
    var total = all.length;
    if (!total) {
      this.geo = null;
      return;
    }
    // 绘制窗口：取数条数与站点一致（/tv/history countback=300），
    // 小程序无平移，固定展示最近 VISIBLE_BARS 根，均线仍用全量数据计算。
    var n = Math.min(total, VISIBLE_BARS);
    var start = total - n;
    var list = all.slice(start);

    var padL = 8;
    var padR = 54;
    var padT = 10;
    var padB = 18;
    var chartH = h - padT - padB;
    var mainH = chartH * 0.72;
    var volH = chartH * 0.24;
    var volTop = padT + mainH + chartH * 0.04;
    var plotW = w - padL - padR;
    var xStep = plotW / n;
    var candleW = Math.max(1, Math.min(xStep * 0.66, 14));

    var ma5 = maList(all, 5).slice(start);
    var ma10 = maList(all, 10).slice(start);
    var ma20 = maList(all, 20).slice(start);

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
    /** 全量数据里的绝对序号 → 画布 x（画线锚点按日期绑定，可能早于绘制窗口） */
    function xOfAbs(absIdx) {
      return padL + xStep * (absIdx - start + 0.5);
    }
    function xOf(idx) {
      return xOfAbs(start + idx);
    }

    // 价格网格 + 右侧价格标签（浅色主题：底 #fffdf7 / 线 #e6dcc6 / 字 #8a7a5f）
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(214,201,170,.9)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = padT + mainH * g / 4;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();
      ctx.fillStyle = '#8a7a5f';
      ctx.fillText((maxP - spanP * g / 4).toFixed(2), padL + plotW + 6, gy);
    }
    ctx.setLineDash([]);

    // 成交量区基线
    ctx.strokeStyle = 'rgba(214,201,170,.9)';
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
      ctx.fillRect(cx - candleW / 2, top, candleW, bodyH);

      if (maxV > 0) {
        var vh = (c.volume / maxV) * volH;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(cx - candleW / 2, volTop + volH - vh, candleW, vh);
        ctx.globalAlpha = 1;
      }
    }

    // 均线
    function drawMA(arr, color2) {
      ctx.strokeStyle = color2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var started = false;
      for (var m = 0; m < arr.length; m++) {
        if (arr[m] === null) continue;
        var mx = xOf(m);
        var my = yOf(arr[m]);
        if (!started) { ctx.moveTo(mx, my); started = true; }
        else ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }
    drawMA(ma5, MA_COLORS[0]);
    drawMA(ma10, MA_COLORS[1]);
    drawMA(ma20, MA_COLORS[2]);

    // 手绘趋势线（本地保存，锚点用日期 + 价格）
    if (this._drawings && this._drawings.length) {
      var dateMap = {};
      for (var mi = 0; mi < total; mi++) dateMap[all[mi].date] = mi;
      var idxOf = function (pt) {
        if (!pt) return 0;
        if (pt.d && dateMap[pt.d] !== undefined) return dateMap[pt.d];
        return pt.i || 0;
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, mainH);
      ctx.clip();
      ctx.strokeStyle = DRAW_COLOR;
      ctx.fillStyle = DRAW_COLOR;
      ctx.lineWidth = 1.5;
      for (var di = 0; di < this._drawings.length; di++) {
        var dr = this._drawings[di];
        if (dr.t === 'h') {
          var hy = yOf(Number(dr.p));
          ctx.beginPath();
          ctx.moveTo(padL, hy);
          ctx.lineTo(padL + plotW, hy);
          ctx.stroke();
        } else if (dr.t === 't' && dr.a && dr.b) {
          var x1 = xOfAbs(idxOf(dr.a));
          var y1 = yOf(Number(dr.a.p));
          var x2 = xOfAbs(idxOf(dr.b));
          var y2 = yOf(Number(dr.b.p));
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x1, y1, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x2, y2, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 趋势线第一个锚点
      if (this._pending) {
        var px = xOfAbs(idxOf(this._pending));
        var py = yOf(Number(this._pending.p));
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 底部日期（首 / 中 / 末）
    ctx.fillStyle = '#8a7a5f';
    ctx.textBaseline = 'top';
    var marks = [0, Math.floor((n - 1) / 2), n - 1];
    for (var t = 0; t < marks.length; t++) {
      var idx2 = marks[t];
      var label = String(list[idx2].date || '').slice(2);
      ctx.textAlign = t === 0 ? 'left' : (t === marks.length - 1 ? 'right' : 'center');
      ctx.fillText(label, t === 0 ? padL : (t === marks.length - 1 ? padL + plotW : padL + plotW / 2), padT + mainH + chartH * 0.04 + volH + 4);
    }

    // 十字线（手指按住时）
    if (this._cursor >= 0 && this._cursor < n) {
      var ci = this._cursor;
      var ccx = xOf(ci);
      var ccy = yOf(list[ci].close);
      ctx.strokeStyle = 'rgba(107,91,62,.5)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ccx, padT);
      ctx.lineTo(ccx, padT + mainH);
      ctx.moveTo(padL, ccy);
      ctx.lineTo(padL + plotW, ccy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6b5b3e';
      ctx.beginPath();
      ctx.arc(ccx, ccy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 图例（对齐 TradingView：左上角两行，含 OHLC 与均线值）
    var bar = (this._cursor >= 0 && this._cursor < n) ? list[this._cursor] : list[n - 1];
    var line1 = String(bar.date || '') + '  开 ' + fixed(bar.open) + '  高 ' + fixed(bar.high)
      + '  低 ' + fixed(bar.low) + '  收 ' + fixed(bar.close);
    var line2 = 'MA5 ' + fixed(ma5[n - 1]) + '  MA10 ' + fixed(ma10[n - 1]) + '  MA20 ' + fixed(ma20[n - 1]);
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    var lw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    ctx.fillStyle = 'rgba(255,253,247,.82)';
    ctx.fillRect(padL, padT, lw + 6, 24);
    ctx.fillStyle = '#6b5b3e';
    ctx.fillText(line1, padL + 3, padT + 2);
    ctx.fillText(line2, padL + 3, padT + 13);

    this.geo = {
      padL: padL,
      padT: padT,
      plotW: plotW,
      mainH: mainH,
      xStep: xStep,
      n: n,
      start: start,     // 绘制窗口在全量数据里的起始序号
      total: total,
      maxP: maxP,
      spanP: spanP
    };
  },

  /* ---------------- 交互 ---------------- */
  onTouchStart: function (e) {
    if (this.data.drawMode) { this.addPoint(e); return; }
    this.moveCross(e);
  },

  onTouchMove: function (e) {
    if (this.data.drawMode) return;
    this.moveCross(e);
  },

  onTouchEnd: function () {
    if (this.data.drawMode) return;
    if (this._cursor < 0) return;
    this._cursor = -1;
    this.draw();
  },

  moveCross: function (e) {
    var geo = this.geo;
    var list = this._klines;
    if (!geo || !list.length) return;
    var pt = touchXY(e, this._canvasLeft, this._canvasTop);
    if (!pt) return;
    var idx = Math.floor((pt.x - geo.padL) / geo.xStep);
    if (idx < 0) idx = 0;
    if (idx > geo.n - 1) idx = geo.n - 1;
    if (idx === this._cursor) return;
    this._cursor = idx;
    this.draw();
  },

  /** 画线模式下的一次点击：水平线一次成线，趋势线两次成线 */
  addPoint: function (e) {
    var geo = this.geo;
    if (!geo) return;
    var pt = touchXY(e, this._canvasLeft, this._canvasTop);
    if (!pt) return;
    if (pt.y < geo.padT || pt.y > geo.padT + geo.mainH) return;

    var idx = Math.floor((pt.x - geo.padL) / geo.xStep);
    if (idx < 0) idx = 0;
    if (idx > geo.n - 1) idx = geo.n - 1;

    var price = geo.maxP - (pt.y - geo.padT) / geo.mainH * geo.spanP;
    var absIdx = geo.start + idx;   // 锚点存全量数据绝对序号，日期用于重新定位
    var anchor = {
      p: Math.round(price * 100) / 100,
      d: (this._klines[absIdx] || {}).date || '',
      i: absIdx
    };

    if (this.data.drawTool === 'h') {
      this._drawings.push({ t: 'h', p: anchor.p, d: anchor.d, i: absIdx });
      this.saveDrawings();
      this.draw();
      return;
    }

    if (!this._pending) {
      this._pending = anchor;
      this.draw();
      return;
    }

    this._drawings.push({ t: 't', a: this._pending, b: anchor });
    this._pending = null;
    this.saveDrawings();
    this.draw();
  },

  /* ---------------- 置底工具条：提示词预览 / 关联到提问 ---------------- */
  previewPrompt: function () {
    var self = this;
    var code = String(this.data.code || '').trim().toUpperCase();
    if (!code) return;
    wx.showLoading({ title: '生成中…' });
    // 与网站 _buildPreviewPaipanDataFor('stock') 同结构：个股 + 天时 + 地利
    paipan.fetchPromptText({
      stock: {
        name: this.data.name || code,
        code: code,
        zs_code: '',
        zs_name: '',
        bk_code: '',
        bk_name: ''
      }
    }).then(function (r) {
      wx.hideLoading();
      // 网站只渲染后端 hint 全文（pre 原样展示），不做截断；空时给同一句占位
      self.setData({ hint: r.hint || '（当前排盘数据组装为空）', showHint: true });
    }).catch(function (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '预览失败', icon: 'none' });
    });
  },

  closeHint: function () { this.setData({ showHint: false }); },

  noop: function () {},

  onBind: function () {
    var code = String(this.data.code || '').trim().toUpperCase();
    if (!code) return;
    var app = getApp();
    app.globalData.paipan = app.globalData.paipan || {};
    app.globalData.paipan.stock = {
      stock: { name: this.data.name || code, code: code },
      meta: { type: 'stock' }
    };
    wx.showToast({ title: '已关联到提问', icon: 'none' });
    setTimeout(function () { wx.navigateBack(); }, 400);
  }
});
