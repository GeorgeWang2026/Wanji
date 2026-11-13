/* ============================================================
 * 档案栏公共逻辑（DF-61 奇门 / DF-85 八字共用）
 * 只封装与页面无关的部分：拉取档案、chip 文案、新增标记消费、点选行为、去创建入口；
 * 「回填后如何排盘」的差异由页面通过 hooks（applyArchive / useNow / rebuild）注入。
 * 视觉与交互基准以奇门页为准，两页不得各写一份。
 * ============================================================ */
var api = require('./api.js');

function p2(n) { return n < 10 ? '0' + n : '' + n; }

/** 出生文案：有生日显示 YYYY-MM-DD，否则「未填生日」 */
function birthText(a) {
  if (!a || a.birth_year == null || a.birth_year === '') return '未填生日';
  return String(a.birth_year) + '-' + p2(Number(a.birth_month) || 1) + '-' + p2(Number(a.birth_day) || 1);
}

/** 拉取档案（复用 /archives），生成「昵称 + 出生」chip；未登录/失败均降级为空列表 */
function loadArchives(page) {
  if (!api.getToken()) { page.setData({ archives: [] }); return Promise.resolve([]); }
  return api.request('/archives').then(function (res) {
    var list = (res && res.code === 0 && res.data) ? res.data : [];
    var chips = list.map(function (a) {
      return {
        id: String(a.id),
        nickname: a.nickname || a.name || ('档案' + a.id),
        sub: birthText(a),
        raw: a
      };
    });
    page.setData({ archives: chips });
    return chips;
  }).catch(function () { /* 档案栏加载失败不打扰用户 */ return []; });
}

/** 优先按 id、其次按昵称+出生字段组匹配 chip */
function _matchChip(chips, id, key) {
  var i;
  if (id) {
    for (i = 0; i < chips.length; i++) if (chips[i].id === String(id)) return chips[i];
  }
  if (key) {
    for (i = 0; i < chips.length; i++) {
      var a = chips[i].raw || {};
      if (String(a.nickname || '') === String(key.nickname || '') &&
          String(a.birth_year || '') === String(key.birth_year || '') &&
          String(a.birth_month || '') === String(key.birth_month || '') &&
          String(a.birth_day || '') === String(key.birth_day || '') &&
          String(a.birth_hour || '') === String(key.birth_hour || '') &&
          String(a.birth_minute || '') === String(key.birth_minute || '')) return chips[i];
    }
  }
  return null;
}

/**
 * 消费 chat 新增档案后写入的标记（优先按 id、其次按出生字段组匹配）：
 * 命中且已填生日 → 选中并回填排盘；命中但未填生日 → 仅选中；匹配不到只刷新不选中；
 * 标记读取后立即清除，避免二次触发。
 */
function consumeNewArchive(page, chips, hooks) {
  var g = getApp().globalData;
  var id = g._newArchiveId;
  var key = g._newArchiveKey;
  if (!id && !key) return;
  g._newArchiveId = null;
  g._newArchiveKey = null;
  chips = chips || page.data.archives || [];
  var hit = _matchChip(chips, id, key);
  if (!hit) return;
  var raw = hit.raw || {};
  page.setData({ activeArchiveId: hit.id });
  if (raw.birth_year == null || raw.birth_year === '') return;
  hooks.applyArchive(raw);
  hooks.rebuild();
}

/** 点档案：再点取消→回此刻；未填生日→提示；有生日→回填并立即排盘 */
function onArchiveTap(page, id, hooks) {
  id = String(id);
  if (page.data.activeArchiveId === id) {
    page.setData({ activeArchiveId: '' });
    hooks.useNow();
    return;
  }
  var chips = page.data.archives || [];
  var chip = null;
  for (var i = 0; i < chips.length; i++) if (chips[i].id === id) { chip = chips[i]; break; }
  if (!chip) return;
  var a = chip.raw || {};
  if (a.birth_year == null || a.birth_year === '') {
    wx.showToast({ title: '该档案尚未填写出生信息', icon: 'none' });
    return;
  }
  page.setData({ activeArchiveId: id });
  hooks.applyArchive(a);
  hooks.rebuild();
}

/** 空档案「去创建」：标记后回 chat 打开新增档案编辑器 */
function goCreate() {
  var g = getApp().globalData;
  g._openNewArchive = true;
  if (getCurrentPages().length > 1) {
    wx.navigateBack();
  } else {
    wx.reLaunch({ url: '/uniApp/pages/chat/chat?openNewArchive=1' });
  }
}

module.exports = {
  birthText: birthText,
  loadArchives: loadArchives,
  consumeNewArchive: consumeNewArchive,
  onArchiveTap: onArchiveTap,
  goCreate: goCreate
};
