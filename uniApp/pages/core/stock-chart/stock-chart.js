/* ============================================================
 * 全屏 K 线图表页（DF-99，方案 B）
 * ------------------------------------------------------------
 * 用 web-view 加载网站 static/mystock/kline.html（TradingView 组件 + 画线），
 * 与站点证券详情页嵌入的地址、参数完全一致：
 *   /mystock/kline.html?symbol=a:<带市场前缀代码>&interval=1D&simple=1
 * 说明：web-view 需要在小程序后台把 estock.space 配为「业务域名」，
 *      未配置时页面打不开（账号级配置，代码无法绕过）。
 * ============================================================ */
var stock = require('../../../utils/stock.js');

var KLINE_BASE = 'https://estock.space/mystock/kline.html';

Page({
  data: {
    src: '',
    name: '',
    code: '',
    loadError: false      // DF-99：web-view 加载失败（业务域名未配置等）→ 降级为复制链接
  },

  onLoad: function (options) {
    var opt = options || {};
    var code = opt.code ? String(opt.code).trim() : '';
    var name = opt.name ? String(opt.name).trim() : '';
    var full = stock.withMarket(code) || code;

    // 与网站 xiaoxuan.html 证券详情页 K 线 iframe 同参数：symbol=a:<代码>、日线、simple 模式
    var src = KLINE_BASE
      + '?symbol=' + encodeURIComponent('a:' + full)
      + '&interval=1D&simple=1';

    this.setData({ src: src, name: name, code: full });
    wx.setNavigationBarTitle({ title: '📈 ' + (name || full) + ' 日K' });
  },

  // web-view 打不开（最常见：estock.space 未配为「业务域名」）→ 显示降级提示
  onWebError: function () {
    this.setData({ loadError: true });
  },

  copyLink: function () {
    wx.setClipboardData({
      data: this.data.src,
      success: function () {
        wx.showToast({ title: '链接已复制，请用浏览器打开', icon: 'none' });
      }
    });
  }
});
