/* ============================================================
 * DF-156 · 通用卡片页（三段式里的第三层：预置渲染器）
 * ------------------------------------------------------------
 * 入参二选一：
 *   ?d=<encodeURIComponent(JSON)>  真实链路：后端随消息下发 card
 *   ?sample=normal|unknown|oversize|no_card   离线自测
 *
 * 职责边界（§13.2）：
 *   - 只按 type 映射到 8 个预编译模板，不执行任何脚本或 HTML
 *   - 未知组件降级为文本块，不白屏
 *   - layout 超限整卡拒绝，给可见提示
 *   - action_id 只回传，幂等与 card_id 归属由服务端校验
 * ============================================================ */

var layoutUtil = require('../../utils/card-layout.js');
var samples = require('../../data/card-samples.js');

Page({
  data: {
    status: 'idle',      // idle | ok | skipped | rejected | error
    message: '',
    nodes: [],
    meta: null,
    stats: null,
    notice: '',
    costMs: 0
  },

  onLoad: function (options) {
    var card = null;
    var opts = options || {};

    if (opts.d) {
      try {
        card = JSON.parse(decodeURIComponent(opts.d));
      } catch (e) {
        this.setData({ status: 'error', message: '卡片参数无法解析：' + (e && e.message ? e.message : e) });
        return;
      }
    } else {
      var name = opts.sample || 'normal';
      card = (name === 'no_card') ? samples.noCard : (samples[name] || samples.normal);
    }

    this.renderCard(card);
  },

  renderCard: function (card) {
    var t0 = Date.now();
    var res = layoutUtil.normalizeCard(card);

    if (!res.ok) {
      if (res.skipped) {
        // 无 card 字段：调用方按纯文本消息渲染，这里不画卡片
        this.setData({
          status: 'skipped',
          message: '本条消息无 card 字段，按纯文本渲染',
          nodes: [],
          stats: res.stats || null
        });
        return;
      }
      this.setData({
        status: 'rejected',
        message: res.message || '卡片无法渲染',
        nodes: [],
        stats: res.stats || null
      });
      return;
    }

    var s = res.stats;
    var notice = '';
    if (s.downgrades && s.downgrades.length) {
      notice = s.downgrades.length + ' 个未知组件已降级为文本';
    }

    this.setData({
      status: 'ok',
      nodes: res.nodes,
      meta: layoutUtil.cardMeta(card),
      stats: s,
      notice: notice,
      message: '',
      costMs: Date.now() - t0
    });
  },

  onTapAction: function (e) {
    var id = e.currentTarget.dataset.actionId;
    if (!id) return;
    // 只回传，不在这里判重；幂等与归属由服务端校验
    wx.showToast({ title: '已选 ' + id, icon: 'none' });
  },

  onInputChange: function (e) {
    var key = e.currentTarget.dataset.key;
    var value = e.detail.value;
    var nodes = this.data.nodes.map(function (n) {
      if (n.key === key) {
        var copy = {};
        for (var k in n) { if (Object.prototype.hasOwnProperty.call(n, k)) copy[k] = n[k]; }
        copy.value = value;
        return copy;
      }
      return n;
    });
    this.setData({ nodes: nodes });
  },

  onRetry: function () {
    this.onLoad(this.options || {});
  }
});
