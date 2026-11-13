/**
 * 我的证券（DF-69）
 * ------------------------------------------------------------
 * 独立全屏页，替代 DF-68 的弹层列表：
 *   - 列表：GET /stocks?group=my（三态：loading/ready|empty/error）
 *   - 点行＝关联：写 globalData.paipan.stock（结构对齐 chipDetail/restoreThread）后返回首页
 *   - 长按行＝删除：确认后 DELETE /stocks/{id}
 *   - 最右「查看」：跳 stock 页并带 ?code=&name=（不进关联）
 *   - 底部悬浮「新增」：名称+代码（代码必填），代码联想 GET /bkgn/search?keyword=
 * 复用 DF-68 已定的取数/字段/绑定/详情带参，不新增第二套 stock 写入逻辑。
 * ============================================================ */
var api = require('../../utils/api.js');

Page({
  data: {
    state: 'loading',
    errMsg: '',
    list: [],
    // 新增弹窗
    showAdd: false,
    addName: '',
    addCode: '',
    sugs: [],
    addErr: '',
    // 删除确认
    showDel: false,
    delCode: '',
    delName: '',
    // 未登录兜底
    needLogin: false
  },

  _myStocks: [],      // 服务端原始列表（用于绑定/删除按 code 反查）
  _sugTimer: null,
  _lastLongPress: 0,

  onShow: function () {
    if (!api.getToken()) {
      this.setData({ needLogin: true, state: 'ready', list: [] });
      return;
    }
    this.setData({ needLogin: false });
    this.loadList();
  },

  onUnload: function () {
    if (this._sugTimer) { clearTimeout(this._sugTimer); this._sugTimer = null; }
  },

  onBack: function () { wx.navigateBack(); },
  noop: function () {},

  /** GET /stocks?group=my → 三态 */
  loadList: function () {
    var self = this;
    this.setData({ state: 'loading', errMsg: '' });
    api.request('/stocks?group=my').then(function (r) {
      if (r && r.code !== undefined && r.code !== 0) {
        self.setData({ state: 'error', errMsg: r.detail || r.msg || r.error || ('错误码 ' + r.code) });
        return;
      }
      var list = (r && Array.isArray(r.data)) ? r.data : [];
      self._myStocks = list;
      self.setData({
        list: list.map(function (s) { return self._vm(s); }),
        state: list.length ? 'ready' : 'empty'
      });
    }).catch(function (err) {
      self.setData({ state: 'error', errMsg: (err && (err.message || err.errMsg)) || '网络请求失败' });
    });
  },

  /** 列表项视图模型（与 DF-68 弹层字段一致） */
  _vm: function (s) {
    var sub = [];
    if (s.zs_name) sub.push('大盘:' + s.zs_name);
    if (s.bk_name) sub.push('板块:' + s.bk_name);
    var hasZdf = !(s.zdf === null || s.zdf === undefined || s.zdf === '');
    var num = hasZdf ? Number(s.zdf) : NaN;
    var text, cls;
    if (!hasZdf || isNaN(num)) { text = '—'; cls = 'flat'; }
    else { text = (num > 0 ? '+' : '') + s.zdf + '%'; cls = num > 0 ? 'up' : (num < 0 ? 'down' : 'flat'); }
    var grade = (s.grade !== null && s.grade !== undefined && s.grade !== '') ? ('级别 ' + s.grade) : '';
    return {
      name: s.name || s.code || '',
      code: s.code || '',
      sub: sub.join(' · '),
      zdfText: text,
      zdfCls: cls,
      grade: grade
    };
  },

  /** 点行＝关联：写 globalData.paipan.stock 后返回首页（再次选另一只＝覆盖，不叠加） */
  onPick: function (e) {
    // 长按抬手后紧随的 tap 抑制，避免误触发关联
    if (Date.now() - this._lastLongPress < 600) return;
    var code = String((e.currentTarget.dataset.code) || '').trim().toUpperCase();
    if (!code) return;
    var arr = this._myStocks || [];
    var cached = null;
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].code || '').toUpperCase() === code) { cached = arr[i]; break; }
    }
    cached = cached || {};
    var stock = {
      name: cached.name || code,
      code: code,
      zs_code: cached.zs_code || '',
      zs_name: cached.zs_name || '',
      bk_code: cached.bk_code || '',
      bk_name: cached.bk_name || ''
    };
    var g = getApp().globalData;
    g.paipan = g.paipan || {};
    g.paipan.stock = { stock: stock, meta: { type: 'stock' } };
    wx.navigateBack();
  },

  /** 最右「查看」：跳详情页并带 code/name（catchtap，不触发关联） */
  onView: function (e) {
    var code = String((e.currentTarget.dataset.code) || '').trim().toUpperCase();
    var name = e.currentTarget.dataset.name || '';
    if (!code) return;
    wx.navigateTo({
      url: '/uniApp/pages/stock/stock?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name)
    });
  },

  /** 长按行＝删除确认 */
  onLongPress: function (e) {
    this._lastLongPress = Date.now();
    var code = String((e.currentTarget.dataset.code) || '').trim().toUpperCase();
    var name = e.currentTarget.dataset.name || '';
    if (!code) return;
    this.setData({ showDel: true, delCode: code, delName: name });
  },

  cancelDel: function () { this.setData({ showDel: false, delCode: '', delName: '' }); },

  confirmDel: function () {
    var self = this;
    var code = this.data.delCode;
    this.setData({ showDel: false });
    if (!code) return;
    var arr = self._myStocks || [];
    var target = null;
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].code || '').toUpperCase() === code) { target = arr[i]; break; }
    }
    var id = target && (target.id !== undefined && target.id !== null ? target.id : (target.stock_id !== undefined ? target.stock_id : target._id));
    if (id === undefined || id === null || id === '') {
      wx.showToast({ title: '删除失败', icon: 'none' });
      return;
    }
    api.request('/stocks/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
      if (r && r.code !== undefined && r.code !== 0) {
        wx.showToast({ title: r.detail || r.msg || '删除失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已删除', icon: 'none' });
      self.loadList();
    }).catch(function (err) {
      wx.showToast({ title: (err && (err.message || err.errMsg)) || '删除失败', icon: 'none' });
    });
  },

  /* ---------------- 新增 ---------------- */

  openAdd: function () {
    this.setData({ showAdd: true, addName: '', addCode: '', sugs: [], addErr: '' });
  },

  closeAdd: function () {
    if (this._sugTimer) { clearTimeout(this._sugTimer); this._sugTimer = null; }
    this.setData({ showAdd: false, addName: '', addCode: '', sugs: [], addErr: '' });
  },

  onAddName: function (e) {
    this.setData({ addName: e.detail.value, addErr: '' });
    this._scheduleSearch(e.detail.value);
  },

  onAddCode: function (e) {
    this.setData({ addCode: e.detail.value, addErr: '' });
    this._scheduleSearch(e.detail.value);
  },

  /** 300ms 防抖联想 */
  _scheduleSearch: function (kw) {
    var self = this;
    if (this._sugTimer) { clearTimeout(this._sugTimer); this._sugTimer = null; }
    var q = String(kw || '').trim();
    if (!q) { this.setData({ sugs: [] }); return; }
    this._sugTimer = setTimeout(function () { self._search(q); }, 300);
  },

  _search: function (kw) {
    var self = this;
    api.request('/bkgn/search?keyword=' + encodeURIComponent(kw)).then(function (r) {
      var arr = (r && Array.isArray(r.data)) ? r.data : (Array.isArray(r) ? r : []);
      var list = arr.slice(0, 10).map(function (x) {
        return { name: x.name || '', code: String(x.code || '').toUpperCase() };
      });
      self.setData({ sugs: list });
      // 唯一且完全匹配 → 自动回填名称
      var q = String(kw).trim().toUpperCase();
      if (list.length === 1 && list[0].code === q) {
        self.setData({ addName: list[0].name || self.data.addName, addCode: list[0].code });
      }
    }).catch(function () {
      self.setData({ sugs: [] });
    });
  },

  /** 点候选：回填名称+代码 */
  pickSug: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    var it = (this.data.sugs || [])[idx];
    if (!it) return;
    this.setData({ addName: it.name || '', addCode: it.code || '', sugs: [], addErr: '' });
  },

  saveAdd: function () {
    var self = this;
    var name = String(this.data.addName || '').trim();
    var code = String(this.data.addCode || '').trim().toUpperCase();
    if (!code) { this.setData({ addErr: '请填写股票代码' }); return; }
    if (!name) { this.setData({ addErr: '请填写股票名称' }); return; }
    api.request('/stocks', {
      method: 'POST',
      data: { name: name, code: code, bk_code: '', bk_name: '', zs_code: '', zs_name: '' }
    }).then(function (r) {
      if (r && r.code !== undefined && r.code !== 0) {
        // 重复代码由后端返回「该股票已在列表中」等 detail，弹窗不关闭
        self.setData({ addErr: r.detail || r.msg || r.error || '保存失败' });
        return;
      }
      wx.showToast({ title: '已添加', icon: 'none' });
      self.closeAdd();
      self.loadList();
    }).catch(function (err) {
      self.setData({ addErr: (err && (err.message || err.errMsg)) || '保存失败' });
    });
  }
});
