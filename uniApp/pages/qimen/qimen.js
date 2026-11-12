/* ============================================================
 * 奇门遁甲页（对应 xiaoxuan.html 的奇门弹窗）
 * 算法全部复用工程根 yishu.js：getBazi + qimenPaiPan
 * ============================================================ */
var Y = require('../../utils/yishu.js');
var paipan = require('../../utils/paipan.js');

var GONG_CELL = [4, 9, 2, 3, 5, 7, 8, 1, 6];
var CLS = { 4: 'c-mu', 9: 'c-huo', 2: 'c-tu', 3: 'c-mu', 5: 'center', 7: 'c-jin', 8: 'c-tu', 1: 'c-shui', 6: 'c-jin' };

function p2(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    date: '',
    time: '',
    built: false,
    info: {},
    cells: [],
    detail: null,
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
      wx.showModal({ title: '引擎未就绪', content: '术数引擎 yishu.js 未加载成功，请检查小程序打包配置。', showCancel: false });
      return;
    }
    var t = this.parseTime();
    try {
      var r = paipan.buildQimen(t.y, t.m, t.d, t.h, t.mi);
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
    var GANCOLOR = Y.dict('GANCOLOR') || {};
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
      var badges = [];
      if (g === pan.zfGongN) badges.push({ t: pan.zfGongRaw === 5 ? '值符·寄中' : '值符', cls: 'hb-zf' });
      if (g === pan.zsGongN) badges.push({ t: pan.zsGongRaw === 5 ? '值使·寄中' : '值使', cls: 'hb-zs' });
      if (g === pan.tianGN) badges.push({ t: '时干', cls: 'hb-hg' });

      cells.push({
        g: g,
        cls: CLS[g] || '',
        tg: tp.tg || '',
        tgColor: GANCOLOR[String(tp.tg || '').charAt(0)] || '#e8dff5',
        dg: (pan.di_pan_view && pan.di_pan_view[g]) || tp.dg || '',
        dgColor: GANCOLOR[String(((pan.di_pan_view && pan.di_pan_view[g]) || tp.dg || '')).charAt(0)] || '#cdbce8',
        xing: tp.xing || '',
        shen: pan.sp[g] || '',
        men: pan.rp[g] || '',
        gname: GONGNAME[g] || '',
        flags: flags,
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

  onBind: function () {
    if (!this.result) return;
    var app = getApp();
    app.globalData.paipan = app.globalData.paipan || {};
    app.globalData.paipan.qimen = { payload: this.result.payload, meta: this.result.meta };
    wx.showToast({ title: '已关联到提问', icon: 'none' });
    setTimeout(function () { wx.navigateBack(); }, 400);
  }
});
