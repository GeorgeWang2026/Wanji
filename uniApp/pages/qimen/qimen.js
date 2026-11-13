/* ============================================================
 * 奇门遁甲页（对应 xiaoxuan.html 的奇门弹窗）
 * 算法全部复用工程根 yishu.js：getBazi + qimenPaiPan
 * ============================================================ */
var Y = require('../../utils/yishu.js');
var paipan = require('../../utils/paipan.js');
var api = require('../../utils/api.js');
/* DF-82：时间栏参数（年/月/日/时/分）与梅花同源，统一走 timebar */
var TB = require('../../utils/timebar.js');
/* DF-85：档案栏公共逻辑（与八字页共用一套，见 utils/archives.js） */
var ARCH = require('../../utils/archives.js');

var GONG_CELL = [4, 9, 2, 3, 5, 7, 8, 1, 6];
var CLS = { 4: 'c-mu', 9: 'c-huo', 2: 'c-tu', 3: 'c-mu', 5: 'center', 7: 'c-jin', 8: 'c-tu', 1: 'c-shui', 6: 'c-jin' };

function p2(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    built: false,
    info: {},
    cells: [],
    detail: null,
    hint: '',
    showHint: false,
    /* DF-60/DF-82：时间栏（年/月/日/时(HH:mm) 四格一排，改完自动重排，无「起局」按钮） */
    years: [],
    months: [],
    days: [],
    time: '',
    yearIdx: 0,
    monthIdx: 0,
    dayIdx: 0,
    /* DF-61：档案栏（九宫格上方）+ 关联态 */
    archives: [],
    activeArchiveId: '',
    bound: false
  },

  onLoad: function () {
    this.years = TB.yearRange();
    var saved = wx.getStorageSync('qimen_last_time');
    var now = new Date();
    var t = (saved && saved.y)
      ? { y: saved.y, m: saved.m, d: saved.d, h: saved.h, mi: (typeof saved.mi === 'number' ? saved.mi : 0) }
      : { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), mi: now.getMinutes() };
    this._setTime(t, { silent: true });
    this.buildPan();
  },

  onShow: function () {
    var app = getApp();
    this.setData({ bound: !!(app.globalData.paipan && app.globalData.paipan.qimen) });
    var self = this;
    // DF-61：档案加载完成后再消费 chat「新增档案」标记，避免竞态（DF-85：公共逻辑见 utils/archives.js）
    ARCH.loadArchives(this).then(function (chips) {
      ARCH.consumeNewArchive(self, chips, {
        applyArchive: function (raw) { self._applyArchiveFields(raw); },
        rebuild: function () { self.buildPan(); }
      });
    });
  },

  onUnload: function () {
    if (this._buildTimer) { clearTimeout(this._buildTimer); this._buildTimer = null; }
  },

  noop: function () {},

  /* ---------------- DF-60 / DF-82：时间栏（年/月/日 + 时含分 自动排盘） ---------------- */

  /** 写入当前时间（年/月/日/时/分），刷新下拉选项与索引；日越界自动钳制到月末 */
  _setTime: function (t, opts) {
    opts = opts || {};
    var n = TB.normalize(t);
    this.time = { y: n.y, m: n.m, d: n.d, h: n.h, mi: n.mi };
    this._buildRanges(n.y, n.m);
    /* DF-82：时与分合并为一个时间控件，显示 HH:mm */
    this.setData({ yearIdx: n.y - 1900, monthIdx: n.m - 1, dayIdx: n.d - 1, time: p2(n.h) + ':' + p2(n.mi) });
    /* DF-82：缓存扩展 mi，旧缓存无 mi 已在 onLoad 兜底为 0 */
    wx.setStorageSync('qimen_last_time', { y: n.y, m: n.m, d: n.d, h: n.h, mi: n.mi });
    if (n.clampedDay && !opts.silent) {
      wx.showToast({ title: '已按当月天数调整到 ' + n.d + ' 日', icon: 'none' });
    }
  },

  _buildRanges: function (y, m) {
    this.setData({
      years: this.years,
      months: TB.monthOptions(),
      days: TB.dayOptions(y, m)
    });
  },

  onYearChange: function (e) { this._onFieldChange({ y: 1900 + Number(e.detail.value) }); },
  onMonthChange: function (e) { this._onFieldChange({ m: Number(e.detail.value) + 1 }); },
  onDayChange: function (e) { this._onFieldChange({ d: Number(e.detail.value) + 1 }); },
  /** DF-82：时间控件一次给出 HH:mm，时与分同时写入 */
  onTimeChange: function (e) {
    var parts = String(e.detail.value || '').split(':');
    this._onFieldChange({ h: Number(parts[0]), mi: Number(parts[1]) });
  },

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

  /** 「此刻」：一键回到当前时间（含当前分钟）并立即排盘（并清除档案选中） */
  useNow: function () {
    var d = new Date();
    this.setData({ activeArchiveId: '' });
    this._setTime({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() });
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

  /* ---------------- DF-61/DF-85：档案栏（公共逻辑见 utils/archives.js） ---------------- */

  /** 点档案：再点取消→回此刻；未填生日→提示；有生日→回填并立即排盘 */
  onArchiveTap: function (e) {
    var self = this;
    ARCH.onArchiveTap(this, e.currentTarget.dataset.id, {
      applyArchive: function (raw) { self._applyArchiveFields(raw); },
      useNow: function () { self.useNow(); },
      rebuild: function () { self.buildPan(); }
    });
  },

  /** 把档案出生字段写入时间栏（奇门无性别维度；DF-85：两页差异仅供页面保留） */
  _applyArchiveFields: function (raw) {
    var h = (raw.birth_hour == null || raw.birth_hour === '') ? 12 : Number(raw.birth_hour);
    var mi = (raw.birth_minute == null || raw.birth_minute === '') ? 0 : Number(raw.birth_minute);
    this._setTime({ y: Number(raw.birth_year), m: Number(raw.birth_month) || 1, d: Number(raw.birth_day) || 1, h: h, mi: mi });
  },

  /** 空档案「去创建」：标记后回 chat 打开新增档案编辑器 */
  onGoCreate: function () { ARCH.goCreate(); },

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
