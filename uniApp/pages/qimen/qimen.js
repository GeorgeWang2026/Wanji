/* ============================================================
 * 奇门遁甲页（对应 xiaoxuan.html 的奇门弹窗）
 * 算法全部复用工程根 yishu.js：getBazi + qimenPaiPan
 * ============================================================ */
var Y = require('../../utils/yishu.js');
var paipan = require('../../utils/paipan.js');
var api = require('../../utils/api.js');

var GONG_CELL = [4, 9, 2, 3, 5, 7, 8, 1, 6];
var CLS = { 4: 'c-mu', 9: 'c-huo', 2: 'c-tu', 3: 'c-mu', 5: 'center', 7: 'c-jin', 8: 'c-tu', 1: 'c-shui', 6: 'c-jin' };

function p2(n) { return n < 10 ? '0' + n : '' + n; }

/** DF-60：当月天数（m 为 1-12） */
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

/** DF-60：年份下拉范围 1900-2100 */
function buildYearRange() {
  var arr = [];
  for (var y = 1900; y <= 2100; y++) arr.push(String(y));
  return arr;
}

Page({
  data: {
    built: false,
    info: {},
    cells: [],
    detail: null,
    hint: '',
    showHint: false,
    /* DF-60：时间栏（年/月/日/时 四个下拉，改完自动重排，无「起局」按钮） */
    years: [],
    months: [],
    days: [],
    hours: [],
    yearIdx: 0,
    monthIdx: 0,
    dayIdx: 0,
    hourIdx: 0,
    /* DF-61：档案栏（九宫格上方）+ 关联态 */
    archives: [],
    activeArchiveId: '',
    bound: false
  },

  onLoad: function () {
    this.years = buildYearRange();
    var saved = wx.getStorageSync('qimen_last_time');
    var now = new Date();
    var t = (saved && saved.y)
      ? { y: saved.y, m: saved.m, d: saved.d, h: saved.h, mi: 0 }
      : { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), mi: 0 };
    this._setTime(t, { silent: true });
    this.buildPan();
  },

  onShow: function () {
    var app = getApp();
    this.setData({ bound: !!(app.globalData.paipan && app.globalData.paipan.qimen) });
    this.loadArchives();
  },

  onUnload: function () {
    if (this._buildTimer) { clearTimeout(this._buildTimer); this._buildTimer = null; }
  },

  noop: function () {},

  /* ---------------- DF-60：时间栏（四输入自动排盘） ---------------- */

  /** 写入当前时间（年/月/日/时 + 分钟），刷新下拉选项与索引；日越界自动钳制到月末 */
  _setTime: function (t, opts) {
    opts = opts || {};
    var y = t.y, m = t.m, d = t.d, h = t.h, mi = t.mi || 0;
    var dim = daysInMonth(y, m);
    var clamped = false;
    if (d > dim) { d = dim; clamped = true; }
    if (d < 1) d = 1;
    this.time = { y: y, m: m, d: d, h: h, mi: mi };
    this._buildRanges(y, m);
    this.setData({ yearIdx: y - 1900, monthIdx: m - 1, dayIdx: d - 1, hourIdx: h });
    wx.setStorageSync('qimen_last_time', { y: y, m: m, d: d, h: h });
    if (clamped && !opts.silent) {
      wx.showToast({ title: '已按当月天数调整到 ' + d + ' 日', icon: 'none' });
    }
  },

  _buildRanges: function (y, m) {
    var days = [], months = [], hours = [], i;
    var dim = daysInMonth(y, m);
    for (i = 1; i <= dim; i++) days.push(p2(i));
    for (i = 1; i <= 12; i++) months.push(p2(i));
    for (i = 0; i < 24; i++) hours.push(p2(i));
    this.setData({ years: this.years, months: months, days: days, hours: hours });
  },

  onYearChange: function (e) { this._onFieldChange({ y: 1900 + Number(e.detail.value) }); },
  onMonthChange: function (e) { this._onFieldChange({ m: Number(e.detail.value) + 1 }); },
  onDayChange: function (e) { this._onFieldChange({ d: Number(e.detail.value) + 1 }); },
  onHourChange: function (e) { this._onFieldChange({ h: Number(e.detail.value) }); },

  _onFieldChange: function (patch) {
    var t = { y: this.time.y, m: this.time.m, d: this.time.d, h: this.time.h, mi: this.time.mi };
    for (var k in patch) { if (patch.hasOwnProperty(k)) t[k] = patch[k]; }
    this._setTime(t);
    this._scheduleBuild();
  },

  /** 连续改动合并为一次排盘（300ms 防抖） */
  _scheduleBuild: function () {
    var self = this;
    if (this._buildTimer) clearTimeout(this._buildTimer);
    this._buildTimer = setTimeout(function () { self.buildPan(); }, 300);
  },

  /** 「此刻」：一键回到当前时间并立即排盘 */
  useNow: function () {
    var d = new Date();
    this._setTime({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: 0 });
    this.buildPan();
  },

  buildPan: function () {
    if (!Y.available) {
      wx.showModal({ title: '引擎未就绪', content: '术数引擎 yishu.js 未加载成功，请检查小程序打包配置。', showCancel: false });
      return;
    }
    var t = this.time;
    try {
      var r = paipan.buildQimen(t.y, t.m, t.d, t.h, t.mi || 0);
      this.result = r;
      this.render(r);
    } catch (e) {
      console.error('[qimen] 排盘失败', e);
      wx.showModal({ title: '排盘失败', content: (e && e.message) || String(e), showCancel: false });
    }
  },

  render: function (r) {
    var pan = r.pan;
    var bazi = r.bazi;
    var GONGNAME = Y.dict('GONGNAME') || {};
    var cells = [];

    for (var i = 0; i < GONG_CELL.length; i++) {
      var g = GONG_CELL[i];
      if (g === 5) {
        var tags = [];
        if (pan.zfGongRaw === 5) tags.push('值符');
        if (pan.zsGongRaw === 5) tags.push('值使');
        cells.push({ g: 5, cls: 'center', centerTag: tags.length ? tags.join('·') + '寄坤' : '' });
        continue;
      }
      var tp = pan.tp[g] || {};
      var flags = pan.flags[g] || [];
      // DF-59：值符/值使/时干 落宫高亮边框（对齐网站 .qm-cell.hl-*）
      var hl = [];
      if (g === pan.zfGongN) hl.push('hl-zf');
      if (g === pan.zsGongN) hl.push('hl-zs');
      if (g === pan.tianGN) hl.push('hl-hg');
      var badges = [];
      if (g === pan.zfGongN) badges.push({ t: pan.zfGongRaw === 5 ? '值符·寄中' : '值符', cls: 'zf' });
      if (g === pan.zsGongN) badges.push({ t: pan.zsGongRaw === 5 ? '值使·寄中' : '值使', cls: 'zs' });
      if (g === pan.tianGN) badges.push({ t: '时干', cls: 'hg' });

      cells.push({
        g: g,
        cls: (CLS[g] || '') + (hl.length ? ' ' + hl.join(' ') : ''),
        tg: tp.tg || '',
        dg: (pan.di_pan_view && pan.di_pan_view[g]) || tp.dg || '',
        xing: tp.xing || '',
        shen: pan.sp[g] || '',
        men: pan.rp[g] || '',
        gname: GONGNAME[g] || '',
        flags: flags,
        flagsText: flags.join('·'),
        badges: badges
      });
    }

    this.setData({
      built: true,
      cells: cells,
      info: {
        bazi: [bazi.year, bazi.month, bazi.day, bazi.hour].join(' '),
        jieqi: bazi.jieqi || '',
        yuan: pan.yuan || '',
        dun: pan.dun || '',
        ju: pan.ju || '',
        zf: pan.zfXing ? (pan.zfXing + ' · ' + pan.zfGong) : pan.zfGong,
        zs: pan.zsMen ? (pan.zsMen + ' · ' + pan.zsGong) : pan.zsGong
      }
    });
  },

  onCellTap: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    var cell = this.data.cells[idx];
    if (!cell) return;
    if (cell.g === 5) {
      wx.showToast({ title: '中五寄坤，不列八神八门', icon: 'none' });
      return;
    }
    var pan = this.result && this.result.pan;
    if (!pan) return;

    var D = Y.dict('QM_DETAIL') || {};
    var GANMEAN = Y.dict('GANMEAN') || {};
    var FLAGMEAN = Y.dict('FLAGMEAN') || {};
    var GONGWX = Y.dict('GONGWX') || {};
    var GANWX = Y.dict('GANWX') || {};
    var gongJudge = Y.engine ? Y.engine.gongJudge : null;
    var gongOverview = Y.engine ? Y.engine.gongOverview : null;

    var rows = [];
    rows.push({ k: '八神', v: cell.shen, d: D[cell.shen] || '' });
    rows.push({ k: '九星', v: cell.xing, d: D[cell.xing] || '' });
    rows.push({ k: '八门', v: cell.men, d: D[cell.men] || '' });

    var ganTxt = cell.tg ? ((GANMEAN[cell.tg.charAt(0)] || '') + '；' + (GANWX[cell.tg.charAt(0)] || '')) : '';
    if (gongJudge) {
      try {
        ganTxt += '（' + gongJudge(cell.tg.charAt(0), GANWX[cell.tg.charAt(0)], GONGWX[cell.g]) + '）';
      } catch (err) { /* 忽略 */ }
    }
    rows.push({ k: '天盘干', v: cell.tg, d: ganTxt });

    var dgTxt = GANMEAN[String(cell.dg).replace(/[^甲乙丙丁戊己庚辛壬癸]/g, '').charAt(0)] || '';
    rows.push({ k: '地盘干', v: cell.dg, d: dgTxt });

    if (cell.flags && cell.flags.length) {
      var fs = [];
      for (var i = 0; i < cell.flags.length; i++) {
        var f = cell.flags[i];
        var key = String(f).replace(/[甲乙丙丁戊己庚辛壬癸]/g, '').replace(/[^符使马空迫墓刑库]/g, '');
        var desc = FLAGMEAN[String(f).charAt(0)] || FLAGMEAN[key] || '';
        fs.push(f + (desc ? '：' + desc : ''));
      }
      rows.push({ k: '宫位标记', v: cell.flags.join(' '), d: fs.join('\n') });
    }

    this.setData({
      detail: {
        title: cell.gname + '宫 · ' + (GONGWX[cell.g] || '') + (gongOverview ? '｜' + gongOverview(cell.g) : ''),
        rows: rows
      }
    });
  },

  closeDetail: function () { this.setData({ detail: null }); },

  /* 预览：后端会把盘面组装成喂给模型的提示词片段（与网页版「提示词预览」一致） */
  previewPrompt: function () {
    var self = this;
    if (!this.result) return;
    wx.showLoading({ title: '生成中…' });
    paipan.fetchPromptText({ qimen: this.result.payload }).then(function (r) {
      wx.hideLoading();
      self.setData({ hint: r.hint || r.texts.qimen || '（盘面数据组装为空）', showHint: true });
    }).catch(function (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '预览失败', icon: 'none' });
    });
  },

  closeHint: function () { this.setData({ showHint: false }); },

  /* ---------------- DF-61：档案栏 + 信息栏「关联 / 取消 / 提示词」 ---------------- */

  /** 拉取档案（复用 /archives），生成「昵称 + 出生」chip */
  loadArchives: function () {
    var self = this;
    if (!api.getToken()) { this.setData({ archives: [] }); return; }
    api.request('/archives').then(function (res) {
      var list = (res && res.code === 0 && res.data) ? res.data : [];
      var chips = list.map(function (a) {
        return {
          id: String(a.id),
          nickname: a.nickname || a.name || ('档案' + a.id),
          sub: self._birthText(a),
          raw: a
        };
      });
      self.setData({ archives: chips });
    }).catch(function () { /* 档案栏加载失败不打扰用户 */ });
  },

  _birthText: function (a) {
    if (!a || a.birth_year == null || a.birth_year === '') return '未填生日';
    return String(a.birth_year) + '-' + p2(Number(a.birth_month) || 1) + '-' + p2(Number(a.birth_day) || 1);
  },

  /** 点档案：再点取消→回此刻；未填生日→提示；有生日→填入时间栏并自动排盘 */
  onArchiveTap: function (e) {
    var id = String(e.currentTarget.dataset.id);
    if (this.data.activeArchiveId === id) {
      this.setData({ activeArchiveId: '' });
      this.useNow();
      return;
    }
    var chip = null;
    for (var i = 0; i < this.data.archives.length; i++) {
      if (this.data.archives[i].id === id) { chip = this.data.archives[i]; break; }
    }
    if (!chip) return;
    var a = chip.raw || {};
    if (a.birth_year == null || a.birth_year === '') {
      wx.showToast({ title: '该档案尚未填写出生信息', icon: 'none' });
      return;
    }
    var h = (a.birth_hour == null || a.birth_hour === '') ? 12 : Number(a.birth_hour);
    var mi = (a.birth_minute == null || a.birth_minute === '') ? 0 : Number(a.birth_minute);
    this.setData({ activeArchiveId: id });
    this._setTime({ y: Number(a.birth_year), m: Number(a.birth_month) || 1, d: Number(a.birth_day) || 1, h: h, mi: mi });
    this.buildPan();
  },

  /** 空档案「去创建」：标记后回 chat 打开新增档案编辑器 */
  onGoCreate: function () {
    var g = getApp().globalData;
    g._openNewArchive = true;
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/uniApp/pages/chat/chat?openNewArchive=1' });
    }
  },

  onBind: function () {
    if (!this.result || this.data.bound) return;
    var app = getApp();
    app.globalData.paipan = app.globalData.paipan || {};
    app.globalData.paipan.qimen = { payload: this.result.payload, meta: this.result.meta };
    this.setData({ bound: true });
    wx.showToast({ title: '已关联到提问', icon: 'none' });
  },

  onUnbind: function () {
    if (!this.data.bound) return;
    var app = getApp();
    if (app.globalData.paipan) { delete app.globalData.paipan.qimen; }
    this.setData({ bound: false });
    wx.showToast({ title: '已取消关联', icon: 'none' });
  }
});
