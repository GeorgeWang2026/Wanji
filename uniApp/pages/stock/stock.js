/* ============================================================
 * 证券详情（原生页，DF-99）
 * ------------------------------------------------------------
 * 参照物：网站 static/xiaoxuan.html 的证券详情页（#stockDetailModal）
 *   - 信息区 #stockDetailInfo（股票/涨跌幅/方向/级别/结构/态势/空间/行业）
 *   - K 线区：占位入口，点击进入全屏图表页（web-view 加载网站同款 kline.html，
 *     图表与画线能力由站点 TV 组件提供，小程序不再自绘）
 *   - 底部工具栏（预览提示词 / 关联到提问）保持原样
 * ============================================================ */
var stock = require('../../utils/stock.js');
var paipan = require('../../utils/paipan.js');

Page({
  data: {
    code: '',
    name: '',

    infoStatus: 'loading',   // loading | ready | empty
    info: null,

    hint: '',
    showHint: false
  },

  onLoad: function (options) {
    this._detail = null;

    var opt = options || {};
    var code = opt.code ? String(opt.code).trim() : '';
    var name = opt.name ? String(opt.name).trim() : '';
    // 市场前缀优先用数据源给的字段（自选表 / 路由参数），没有则由 utils 按代码规则推断
    var pfx = code.toUpperCase().match(/^(?:A:)?([A-Z]{2})\.(\d{6})$/);
    this._market = opt.market || opt.exchange || (pfx ? pfx[1] : '');
    if (pfx) {
      code = pfx[2];
    } else {
      var mm = code.match(/\d{6}/);
      if (mm) code = mm[0];
    }
    if (!code) code = '600519';   // 无参进入时的兜底（与页面上线前一致）

    // 天时(大盘) / 地利(板块) 口径：路由参数优先，其次沿用已绑定证券的同名卡片
    // （网站 selectStock 把 zs_ 与 bk_ 字段存在绑定数据里，进详情后原样带进提示词）
    var bound = null;
    try {
      var g = getApp().globalData || {};
      bound = (g.paipan && g.paipan.stock && g.paipan.stock.stock) || null;
    } catch (e) { bound = null; }
    var boundSame = bound && String(bound.code || '').toUpperCase().indexOf(code) >= 0;
    this._meta = {
      zs_code: opt.zs_code || (boundSame ? bound.zs_code : '') || '',
      zs_name: opt.zs_name || (boundSame ? bound.zs_name : '') || '',
      bk_code: opt.bk_code || (boundSame ? bound.bk_code : '') || '',
      bk_name: opt.bk_name || (boundSame ? bound.bk_name : '') || ''
    };
    if (!name && boundSame && bound.name) name = String(bound.name).trim();

    this.setData({ code: code, name: name });
    this.applyTitle();
    this.loadInfo();
  },

  onPullDownRefresh: function () {
    this.loadInfo().then(function () { wx.stopPullDownRefresh(); });
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
      return Promise.resolve();
    }
    this.setData({ infoStatus: 'loading', info: null });
    return stock.fetchDetail(code, this._market).then(function (d) {
      self._detail = (d && d.code) ? d : null;
      var info = stock.buildInfo(d, { name: self.data.name, code: code });
      if (!info) {
        self.setData({ infoStatus: 'empty', info: null });
        return;
      }
      self.setData({ infoStatus: 'ready', info: info, name: info.name || self.data.name });
      self.applyTitle();
    }).catch(function () {
      // 与网站一致：接口失败按「暂无该证券详情数据」展示
      self.setData({ infoStatus: 'empty', info: null });
    });
  },

  /* ---------------- K 线：进入全屏图表页（站点 TV 组件） ---------------- */
  openChart: function () {
    var code = String(this.data.code || '').trim().toUpperCase();
    if (!code) return;
    var full = stock.withMarket(code, this._market) || code;
    wx.navigateTo({
      url: '/uniApp/pages/stock-chart/stock-chart?code=' + encodeURIComponent(full)
        + '&name=' + encodeURIComponent(this.data.name || '')
    });
  },

  /* ---------------- 置底工具条：提示词预览 / 关联到提问 ---------------- */
  /**
   * 组装 paipan_data.stock —— 逐条对齐网站 selectStock（xiaoxuan.html L6194-L6238）：
   *   1) 个股：GET /stocks/detail?code=，回填 zs_ 与 bk_ 字段后作为 stock_detail
   *   2) 天时：GET /stocks/detail?code=<zs_code> → index_detail
   *   3) 地利：GET /stocks/detail?code=<bk_code> → industry_detail
   * 三个 detail 都是 total_space / level_space 的缓存快照，缺一个提示词就会缺段。
   */
  buildStockPayload: function () {
    var code = String(this.data.code || '').trim().toUpperCase();
    var full = stock.withMarket(code, this._market) || code;
    var meta = this._meta || {};
    var base = {
      name: this.data.name || code,
      code: full,
      zs_code: meta.zs_code || '',
      zs_name: meta.zs_name || '',
      bk_code: meta.bk_code || '',
      bk_name: meta.bk_name || ''
    };

    // 与网站一致：detail 请求原样传代码（已带前缀的直接用，6 位纯数字才补市场前缀）
    var detailOf = function (c) {
      var cc = String(c || '').trim().toUpperCase();
      if (!cc) return Promise.resolve(null);
      var norm = /^\d{6}$/.test(cc) ? stock.withMarket(cc) : cc;
      return stock.fetchDetail(norm).then(function (d) {
        return (d && d.code) ? d : null;
      }).catch(function () { return null; });
    };

    // 优先用页面已取的详情（对应网站「优先用已缓存的 stock_detail」）
    var stockDetail = (this._detail && this._detail.code)
      ? Promise.resolve(this._detail)
      : detailOf(full);

    return stockDetail.then(function (d) {
      if (d && d.code) {
        if (base.zs_code) d.zs_code = base.zs_code;
        if (base.zs_name) d.zs_name = base.zs_name;
        if (base.bk_code) d.bk_code = base.bk_code;
        if (base.bk_name) d.bk_name = base.bk_name;
        base.stock_detail = d;
      }
      return base.zs_code ? detailOf(base.zs_code) : null;
    }).then(function (zd) {
      if (zd) base.index_detail = zd;
      return base.bk_code ? detailOf(base.bk_code) : null;
    }).then(function (bd) {
      if (bd) base.industry_detail = bd;
      return base;
    });
  },

  previewPrompt: function () {
    var self = this;
    var code = String(this.data.code || '').trim().toUpperCase();
    if (!code) return;
    wx.showLoading({ title: '生成中…' });
    // 与网站 _buildPreviewPaipanDataFor('stock') 同结构：个股 + 天时 + 地利
    this.buildStockPayload().then(function (payload) {
      return paipan.fetchPromptText({ stock: payload });
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
    var self = this;
    var code = String(this.data.code || '').trim().toUpperCase();
    if (!code) return;
    // 与网站 selectStock 一致：绑定数据里同时带个股/大盘/板块三个 detail
    this.buildStockPayload().then(function (payload) {
      var app = getApp();
      app.globalData.paipan = app.globalData.paipan || {};
      app.globalData.paipan.stock = {
        stock: payload,
        meta: { type: 'stock' }
      };
      wx.showToast({ title: '已关联到提问', icon: 'none' });
      // DF-72：回主界面后自动展开咨询面板 + 问题列表，便于看到刚关联的证券信息卡片
      app.globalData._openPanelOnChat = true;
      // 关联成功后直接回到主界面（对话首页），跳过中间的证券列表
      setTimeout(function () { self._backToChat(); }, 400);
    }).catch(function () {
      wx.showToast({ title: '关联失败', icon: 'none' });
    });
  },

  /** 选中证券关联到提问后直接回主界面：在页面栈里找 chat 首页，一路 navigateBack 过去 */
  _backToChat: function () {
    var pages = getCurrentPages() || [];
    var target = -1;
    for (var i = pages.length - 1; i >= 0; i--) {
      var r = (pages[i] && pages[i].route) || '';
      if (r.indexOf('pages/chat/chat') >= 0) {
        target = i;
        break;
      }
    }
    if (target >= 0) {
      wx.navigateBack({ delta: pages.length - 1 - target });
    } else {
      // 兜底：栈里没有 chat 页（如分享/重进直达证券详情）则重启到首页
      wx.reLaunch({ url: '/uniApp/pages/chat/chat' });
    }
  }
});
