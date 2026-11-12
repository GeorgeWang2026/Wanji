/* ============================================================
 * 四柱八字页（对应 xiaoxuan.html 的八字弹窗）
 * 算法全部复用工程根 yishu.js：getBazi / calcDayun / dayMasterProfile / dayunTendency
 * ============================================================ */
var Y = require('../../utils/yishu.js');
var paipan = require('../../utils/paipan.js');

function p2(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    years: [],
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    days: [],
    yearIdx: 0,
    monthIdx: 0,
    dayIdx: 0,
    time: '',
    genders: ['男', '女'],
    genderIdx: 0,
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
    var thisYear = d.getFullYear();
    var years = [];
    for (var y = 1900; y <= thisYear + 1; y++) years.push(y);
    this.setData({
      years: years,
      yearIdx: years.indexOf(thisYear),
      monthIdx: d.getMonth(),
      days: this._daysInMonth(thisYear, d.getMonth() + 1),
      dayIdx: d.getDate() - 1,
      time: p2(d.getHours()) + ':' + p2(d.getMinutes())
    });
    this.buildPan();
  },

  onUnload: function () {
    if (this._rebuildTimer) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
    }
  },

  noop: function () {},

  onYearChange: function (e) { this._applyDate({ yearIdx: Number(e.detail.value) }); },
  onMonthChange: function (e) { this._applyDate({ monthIdx: Number(e.detail.value) }); },

  onDayChange: function (e) {
    var idx = Number(e.detail.value);
    if (idx === this.data.dayIdx) return;
    this.setData({ dayIdx: idx });
    this._scheduleRebuild();
  },

  onTimeChange: function (e) {
    if (e.detail.value === this.data.time) return;
    this.setData({ time: e.detail.value });
    this._scheduleRebuild();
  },

  onGenderChange: function (e) {
    var idx = Number(e.detail.value);
    if (idx === this.data.genderIdx) return;
    this.setData({ genderIdx: idx });
    this._scheduleRebuild();
  },

  /** 某年某月的天数列表（含闰年 2/29） */
  _daysInMonth: function (y, m) {
    var n = new Date(y, m, 0).getDate();
    var arr = [];
    for (var i = 1; i <= n; i++) arr.push(i);
    return arr;
  },

  /** 改年/改月：重算当月天数，当前日超界时钳制到月末（1/31 → 2/28） */
  _applyDate: function (patch) {
    var yearIdx = patch.yearIdx !== undefined ? patch.yearIdx : this.data.yearIdx;
    var monthIdx = patch.monthIdx !== undefined ? patch.monthIdx : this.data.monthIdx;
    if (yearIdx === this.data.yearIdx && monthIdx === this.data.monthIdx) return;
    var days = this._daysInMonth(this.data.years[yearIdx], this.data.months[monthIdx]);
    var dayIdx = this.data.dayIdx;
    if (dayIdx > days.length - 1) dayIdx = days.length - 1;
    patch.yearIdx = yearIdx;
    patch.monthIdx = monthIdx;
    patch.days = days;
    patch.dayIdx = dayIdx;
    this.setData(patch);
    this._scheduleRebuild();
  },

  /** 改完即排：300ms 防抖，连续修改只跑最后一次 */
  _scheduleRebuild: function () {
    var self = this;
    if (this._rebuildTimer) clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(function () {
      self._rebuildTimer = null;
      self.buildPan();
    }, 300);
  },

  parseTime: function () {
    var y = this.data.years[this.data.yearIdx] || new Date().getFullYear();
    var m = this.data.months[this.data.monthIdx] || 1;
    var d = this.data.days[this.data.dayIdx] || 1;
    var tp = String(this.data.time || '').split(':');
    return {
      y: y,
      m: m,
      d: d,
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
      var r = paipan.buildBazi(t.y, t.m, t.d, t.h, t.mi, gender, '');
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
