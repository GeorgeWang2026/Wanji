/* ============================================================
 * 卦典详情页
 * 复刻网页版 _mhOpenGuaDetail：先取缓存 Markdown，未命中再触发抓取
 * ============================================================ */
var api = require('../../utils/api.js');
var md = require('../../utils/markdown.js');

Page({
  data: {
    num: 1,
    yao: 0,
    loading: true,
    error: '',
    html: ''
  },

  onLoad: function (query) {
    var num = parseInt(query && query.num, 10) || 1;
    var yao = parseInt(query && query.yao, 10) || 0;
    this.setData({ num: num, yao: yao });
    wx.setNavigationBarTitle({ title: '第 ' + num + ' 卦 · 卦典' });
    this.load(num, yao, false);
  },

  retry: function () {
    this.load(this.data.num, this.data.yao, false);
  },

  load: function (num, yao, fromFetch) {
    var self = this;
    this.setData({ loading: true, error: '' });

    var url = fromFetch ? ('/gua/fetch/' + num) : ('/gua/' + num);
    api.request(url, { auth: false, timeout: 30000 }).then(function (r) {
      if (r && r.code === 0 && r.data && r.data.content) {
        self.render(r.data.content, yao);
        return;
      }
      // 404 / 空内容：回退到抓取接口
      if (!fromFetch) {
        self.load(num, yao, true);
        return;
      }
      self.setData({ loading: false, error: '卦典内容为空，稍后再试' });
    }).catch(function (e) {
      if (!fromFetch) {
        self.load(num, yao, true);
        return;
      }
      self.setData({
        loading: false,
        error: '卦典加载失败：' + ((e && e.message) || '网络异常')
      });
    });
  },

  render: function (content, yao) {
    var html = '';
    try {
      // 注意：markdown.js 的简版卦典渲染会把「动爻」标签二次转义成字面 HTML，
      // 所以这里不传 yao，动爻信息改由页面顶部徽标展示。
      html = md.guaHtml(content, 0);
    } catch (e) {
      console.error('[gua] 渲染失败', e);
      html = md.escHtml ? md.escHtml(content) : content;
    }
    this.setData({ loading: false, html: html });
  }
});
