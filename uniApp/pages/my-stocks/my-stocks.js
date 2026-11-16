/**
 * 我的证券（DF-69）
 * ------------------------------------------------------------
 * 独立全屏页，替代 DF-68 的弹层列表：
 *   - 列表：GET /stocks?group=my（三态：loading/ready|empty/error）
 *   - 点行＝关联：写 globalData.paipan.stock（结构对齐 chipDetail/restoreThread）后返回首页
 *   - 长按行＝删除：确认后 DELETE /stocks/{id}
 *   - 最右「查看」：跳 stock 页并带 ?code=&name=（不进关联）
 *   - 底部悬浮「新增」：名称+代码+所属板块+相关指数（代码必填，对齐网站 stocks.js 新增股票编辑器）
 *     · 名称/代码联想 GET /bkgn/search?keyword=（返回 stock_name/stock_code）
 *     · 板块/指数候选 GET /bkgn/sectors、GET /bkgn/indexes，选股后反查 GET /bkgn/industry?code=
 * 复用 DF-68 已定的取数/字段/绑定/详情带参，不新增第二套 stock 写入逻辑。
 * ============================================================ */
var api = require('../../utils/api.js');

Page({
  data: {
    /* DF-69：本页 navigationStyle=custom，无原生栏兜底，需自注入状态栏高度 */
    statusBarH: 0,
    state: 'loading',
    errMsg: '',
    list: [],
    // 新增弹窗（对齐网站 stocks.js 新增股票编辑器：名称/代码/所属板块/相关指数）
    showAdd: false,
    addName: '',
    addCode: '',
    addBk: '',
    addBkCode: '',
    addBkName: '',
    addZs: '',
    addZsCode: '',
    addZsName: '',
    sugs: [],
    bkSugs: [],
    zsSugs: [],
    addErr: '',
    // 删除确认
    showDel: false,
    delCode: '',
    delName: '',
    // 未登录兜底
    needLogin: false
  },

  _myStocks: [],      // 服务端原始列表（用于绑定/删除按 code 反查）
  _sectorOptions: [], // 板块候选（/bkgn/sectors，板块输入联想用）
  _indexOptions: [],  // 指数候选（/bkgn/indexes）
  _sugTimer: null,
  _bkTimer: null,
  _zsTimer: null,
  _lastLongPress: 0,

  /** DF-69：注入状态栏高度，使 .fs-header 顶部起点与聊天页全屏层一致 */
  onLoad: function () {
    var statusBarH = 0;
    try {
      var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      statusBarH = (info && info.statusBarHeight) || 0;
    } catch (e) { statusBarH = 0; }
    this.setData({ statusBarH: statusBarH });
  },

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
    if (this._bkTimer) { clearTimeout(this._bkTimer); this._bkTimer = null; }
    if (this._zsTimer) { clearTimeout(this._zsTimer); this._zsTimer = null; }
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
      zs_code: s.zs_code || '',
      zs_name: s.zs_name || '',
      bk_code: s.bk_code || '',
      bk_name: s.bk_name || '',
      sub: sub.join(' · '),
      zdfText: text,
      zdfCls: cls,
      grade: grade
    };
  },

  /** 点行＝进入证券详情页；长按抬手后的 tap 抑制，避免误跳转 */
  onView: function (e) {
    if (Date.now() - this._lastLongPress < 600) return;
    var ds = e.currentTarget.dataset;
    var code = String(ds.code || '').trim().toUpperCase();
    var name = ds.name || '';
    if (!code) return;
    // 天时/地利代码一起带过去，详情页拼提示词时与网站 selectStock 同口径
    wx.navigateTo({
      url: '/uniApp/pages/stock/stock?code=' + encodeURIComponent(code)
        + '&name=' + encodeURIComponent(name)
        + '&zs_code=' + encodeURIComponent(ds.zsCode || '')
        + '&zs_name=' + encodeURIComponent(ds.zsName || '')
        + '&bk_code=' + encodeURIComponent(ds.bkCode || '')
        + '&bk_name=' + encodeURIComponent(ds.bkName || '')
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
    this.setData({
      showAdd: true, addName: '', addCode: '',
      addBk: '', addBkCode: '', addBkName: '',
      addZs: '', addZsCode: '', addZsName: '',
      sugs: [], bkSugs: [], zsSugs: [], addErr: ''
    });
    this._loadGroupOptions();
  },

  closeAdd: function () {
    if (this._sugTimer) { clearTimeout(this._sugTimer); this._sugTimer = null; }
    if (this._bkTimer) { clearTimeout(this._bkTimer); this._bkTimer = null; }
    if (this._zsTimer) { clearTimeout(this._zsTimer); this._zsTimer = null; }
    this.setData({
      showAdd: false, addName: '', addCode: '',
      addBk: '', addBkCode: '', addBkName: '',
      addZs: '', addZsCode: '', addZsName: '',
      sugs: [], bkSugs: [], zsSugs: [], addErr: ''
    });
  },

  /** 打开弹窗时预载板块/指数候选（与网站 loadSectorOptions/loadIndexOptions 同源） */
  _loadGroupOptions: function () {
    var self = this;
    api.request('/bkgn/sectors').then(function (r) {
      self._sectorOptions = (r && r.code === 0 && Array.isArray(r.data)) ? r.data : [];
    }).catch(function () { self._sectorOptions = []; });
    api.request('/bkgn/indexes').then(function (r) {
      self._indexOptions = (r && r.code === 0 && Array.isArray(r.data)) ? r.data : [];
    }).catch(function () { self._indexOptions = []; });
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
      // 网站 stocks.js autocompleteStock 口径：后端返回 stock_name/stock_code（不是 name/code）
      var list = arr.slice(0, 10).map(function (x) {
        return {
          name: x.stock_name || '',
          code: String(x.stock_code || '').toUpperCase()
        };
      });
      self.setData({ sugs: list });
      // 唯一且完全匹配 → 自动回填名称并反查板块/指数
      var q = String(kw).trim().toUpperCase();
      if (list.length === 1 && list[0].code === q) {
        self.setData({ addName: list[0].name || self.data.addName, addCode: list[0].code });
        self._resolveIndustry(list[0].code);
      }
    }).catch(function () {
      self.setData({ sugs: [] });
    });
  },

  /** 点候选：回填名称+代码并反查板块/指数（对齐网站 applyStockMatch） */
  pickSug: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    var it = (this.data.sugs || [])[idx];
    if (!it) return;
    this.setData({ addName: it.name || '', addCode: it.code || '', sugs: [], addErr: '' });
    if (it.code) this._resolveIndustry(it.code);
  },

  /** 反查股票所属板块/相关指数并自动回填（网站 resolveSector/resolveIndex 合并） */
  _resolveIndustry: function (code) {
    var self = this;
    if (!code) return;
    api.request('/bkgn/industry?code=' + encodeURIComponent(code)).then(function (r) {
      var d = (r && r.code === 0 && r.data) ? r.data : null;
      if (!d) return;
      var patch = {};
      if (d.tdx_code) {
        patch.addBk = d.tdx_name || d.tdx_code;
        patch.addBkCode = d.tdx_code;
        patch.addBkName = d.tdx_name || '';
      }
      if (d.zs_code) {
        patch.addZs = d.zs_name || d.zs_code;
        patch.addZsCode = d.zs_code;
        patch.addZsName = d.zs_name || '';
      }
      if (Object.keys(patch).length) self.setData(patch);
    }).catch(function () {});
  },

  /* ---- 所属板块 / 相关指数 联想（与网站 filterSectorOptions/filterIndexOptions 同源） ---- */

  onAddBk: function (e) {
    this.setData({ addBk: e.detail.value, addBkCode: '', addBkName: '', addErr: '' });
    this._scheduleBkFilter(e.detail.value);
  },

  onAddZs: function (e) {
    this.setData({ addZs: e.detail.value, addZsCode: '', addZsName: '', addErr: '' });
    this._scheduleZsFilter(e.detail.value);
  },

  _scheduleBkFilter: function (kw) {
    var self = this;
    if (this._bkTimer) { clearTimeout(this._bkTimer); this._bkTimer = null; }
    var q = String(kw || '').trim();
    if (!q) { this.setData({ bkSugs: [] }); return; }
    this._bkTimer = setTimeout(function () {
      var q2 = q.toLowerCase();
      var list = (self._sectorOptions || []).filter(function (b) {
        var nm = String(b.tdx_name || '').toLowerCase();
        var cd = String(b.tdx_code || '').toLowerCase();
        return nm.indexOf(q2) >= 0 || cd.indexOf(q2) >= 0;
      }).slice(0, 10).map(function (b) {
        return { name: b.tdx_name || '', code: String(b.tdx_code || '').toUpperCase() };
      });
      self.setData({ bkSugs: list });
    }, 200);
  },

  _scheduleZsFilter: function (kw) {
    var self = this;
    if (this._zsTimer) { clearTimeout(this._zsTimer); this._zsTimer = null; }
    var q = String(kw || '').trim();
    if (!q) { this.setData({ zsSugs: [] }); return; }
    this._zsTimer = setTimeout(function () {
      var q2 = q.toLowerCase();
      var list = (self._indexOptions || []).filter(function (b) {
        var nm = String(b.zs_name || '').toLowerCase();
        var cd = String(b.zs_code || '').toLowerCase();
        return nm.indexOf(q2) >= 0 || cd.indexOf(q2) >= 0;
      }).slice(0, 10).map(function (b) {
        return { name: b.zs_name || '', code: String(b.zs_code || '').toUpperCase() };
      });
      self.setData({ zsSugs: list });
    }, 200);
  },

  pickBkSug: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    var it = (this.data.bkSugs || [])[idx];
    if (!it) return;
    this.setData({ addBk: it.name || it.code, addBkCode: it.code, addBkName: it.name, bkSugs: [], addErr: '' });
  },

  pickZsSug: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    var it = (this.data.zsSugs || [])[idx];
    if (!it) return;
    this.setData({ addZs: it.name || it.code, addZsCode: it.code, addZsName: it.name, zsSugs: [], addErr: '' });
  },

  saveAdd: function () {
    var self = this;
    var name = String(this.data.addName || '').trim();
    var code = String(this.data.addCode || '').trim().toUpperCase();
    if (!code) { this.setData({ addErr: '请填写股票代码' }); return; }
    // 网站 saveMyStock：名称非必填；板块/指数若未选中代码，则按输入文本精确匹配回填
    var bkCode = String(this.data.addBkCode || '').trim();
    var bkName = String(this.data.addBkName || '').trim();
    if (!bkCode) {
      var bkTyped = String(this.data.addBk || '').trim();
      if (bkTyped) {
        var bm = (this._sectorOptions || []).filter(function (b) {
          return (b.tdx_name || '') === bkTyped || String(b.tdx_code || '').toUpperCase() === bkTyped.toUpperCase();
        })[0];
        if (bm) { bkCode = bm.tdx_code || ''; bkName = bm.tdx_name || ''; }
      }
    }
    var zsCode = String(this.data.addZsCode || '').trim();
    var zsName = String(this.data.addZsName || '').trim();
    if (!zsCode) {
      var zsTyped = String(this.data.addZs || '').trim();
      if (zsTyped) {
        var zm = (this._indexOptions || []).filter(function (b) {
          return (b.zs_name || '') === zsTyped || String(b.zs_code || '').toUpperCase() === zsTyped.toUpperCase();
        })[0];
        if (zm) { zsCode = zm.zs_code || ''; zsName = zm.zs_name || ''; }
      }
    }
    api.request('/stocks', {
      method: 'POST',
      data: { name: name, code: code, bk_code: bkCode, bk_name: bkName, zs_code: zsCode, zs_name: zsName }
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
