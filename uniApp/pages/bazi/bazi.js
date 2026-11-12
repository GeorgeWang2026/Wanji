/* ============================================================
 * 四柱八字页（对应 xiaoxuan.html 的八字弹窗）
 * 算法全部复用工程根 yishu.js：getBazi / calcDayun / dayMasterProfile / dayunTendency
 * ============================================================ */
var Y = require('../../utils/yishu.js');
var paipan = require('../../utils/paipan.js');

function p2(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    date: '',
    time: '',
    genders: ['男', '女'],
    genderIdx: 0,
    name: '',
    built: false,
    pillars: [],
    dayGan: '',
    info: {},
    prof: {},
    yun: {},
    dayun: [],
    hint: '',
    showHint: false
  },

  onLoad: function () {
    var d = new Date();
    this.setData({
      date: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()),
      time: p2(d.getHours()) + ':' + p2(d.getMinutes())
    });
    this.buildPan();
  },

  noop: function () {},

  onDateChange: function (e) { this.setData({ date: e.detail.value }); },
  onTimeChange: function (e) { this.setData({ time: e.detail.value }); },
  onGenderChange: function (e) { this.setData({ genderIdx: Number(e.detail.value) }); },
  onName: function (e) { this.setData({ name: e.detail.value }); },

  useNow: function () {
    var d = new Date();
    this.setData({
      date: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()),
      time: p2(d.getHours()) + ':' + p2(d.getMinutes())
    });
    this.buildPan();
  },

  parseTime: function () {
    var dp = String(this.data.date || '').split('-');
    var tp = String(this.data.time || '').split(':');
    return {
      y: parseInt(dp[0], 10) || new Date().getFullYear(),
      m: parseInt(dp[1], 10) || 1,
      d: parseInt(dp[2], 10) || 1,
      h: parseInt(tp[0], 10) || 0,
      mi: parseInt(tp[1], 10) || 0
    };
  },

  buildPan: function () {
    if (!Y.available) {
      wx.showModal({ title: '引擎未就绪', content: '术数引擎 yishu.js 未加载成功。', showCancel: false });
      return;
    }
    var t = this.parseTime();
    var gender = this.data.genders[this.data.genderIdx] || '男';
    try {
      var r = paipan.buildBazi(t.y, t.m, t.d, t.h, t.mi, gender, this.data.name);
      this.result = r;
      this.render(r, t);
    } catch (e) {
      console.error('[bazi] 排盘失败', e);
      wx.showModal({ title: '排盘失败', content: (e && e.message) || String(e), showCancel: false });
    }
  },

  render: function (r, t) {
    var pb = r.pb;
    var prof = r.prof;
    var dy = r.dy;
    var E = Y.engine || {};
    var GANCOLOR = Y.dict('GANCOLOR') || {};
    var ZHIWX = Y.dict('ZHIWX') || {};
    var GANWX = Y.dict('GANWX') || {};
    var dayGan = pb.day[0];

    function god(gz) {
      if (!E.ganRel) return '';
      try { return (E.ganRel(dayGan, gz) || {}).god || ''; } catch (e) { return ''; }
    }
    function zhiGod(z) {
      if (!E.zhiRel) return '';
      try { return (E.zhiRel(dayGan, z) || {}).god || ''; } catch (e) { return ''; }
    }
    function ganColor(g) { return GANCOLOR[g] || '#e8dff5'; }
    function zhiColor(z) {
      var wx = ZHIWX[z];
      return ({
        '木': '#7fd4a0', '火': '#ff8fb5', '土': '#e8b84a', '金': '#c9d6ff', '水': '#8fb5ff'
      })[wx] || '#cdbce8';
    }

    var pillars = [
      { name: '年柱', gan: pb.year[0], zhi: pb.year[1] },
      { name: '月柱', gan: pb.month[0], zhi: pb.month[1] },
      { name: '日柱', gan: pb.day[0], zhi: pb.day[1] },
      { name: '时柱', gan: pb.hour[0], zhi: pb.hour[1] }
    ].map(function (p, i) {
      return {
        name: p.name,
        gan: p.gan,
        zhi: p.zhi,
        ganGod: i === 2 ? '日主' : god(p.gan),
        zhiGod: zhiGod(p.zhi),
        ganColor: ganColor(p.gan),
        zhiColor: zhiColor(p.zhi),
        wx: (GANWX[p.gan] || '') + (ZHIWX[p.zhi] || '')
      };
    });

    var nowYear = new Date().getFullYear();
    var dayun = (dy.yun || []).map(function (y) {
      var tend = null;
      if (E.dayunTendency) {
        try { tend = E.dayunTendency(prof, y.gz); } catch (e) { tend = null; }
      }
      var tendency = tend ? tend.tendency : '';
      return {
        gz: y.gz,
        from: y.from,
        to: y.to,
        age: y.ageStart,
        tendency: tendency || '',
        cls: tendency === '上坡路' ? 't-up' : (tendency === '下坡路' ? 't-down' : 't-flat'),
        current: nowYear >= y.from && nowYear < y.to
      };
    });

    this.setData({
      built: true,
      pillars: pillars,
      dayGan: dayGan,
      info: {
        jieqi: pb.jieqi || '',
        solarDate: pb.solar_date || ''
      },
      prof: {
        level: prof.level,
        score: prof.score,
        xi: prof.xi,
        ji: prof.ji,
        text: prof.text
      },
      yun: {
        direction: dy.shun ? '顺排' : '逆排',
        ageStart: dy.ageStart,
        startYear: dy.startYear
      },
      dayun: dayun
    });
  },

  previewPrompt: function () {
    var self = this;
    if (!this.result) return;
    wx.showLoading({ title: '生成中…' });
    paipan.fetchPromptText({ bazi: this.result.payload }).then(function (r) {
      wx.hideLoading();
      self.setData({ hint: r.hint || r.texts.bazi || '（盘面数据组装为空）', showHint: true });
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
    app.globalData.paipan.bazi = { payload: this.result.payload, meta: this.result.meta };
    wx.showToast({ title: '已关联到提问', icon: 'none' });
    setTimeout(function () { wx.navigateBack(); }, 400);
  }
});
