/* ============================================================
 * DF-156 · 问卷 demo（按 case5-choice-form 渲染，§14/§15）
 * ------------------------------------------------------------
 * 入参：data/card-samples.js 里的 choiceForm（后端样例原样副本）
 * 范围：单选、多选、整卷一次提交回传；问答题（input）本轮不做。
 * 形态：分页——每屏最多 3 题（§15.2 选「三五题一屏」）；
 *       切页/回退只改页下标，答案常驻内存，不清空、不发请求；
 *       最后一页才出「整卷提交」，本地收齐后一次回传。
 * 回传：card_id + action_id + card_answers；幂等键 = 动作 + 归一答案指纹。
 * 调试：?live=1 时真实 POST /api/v1/chat，否则本地回执。
 * ============================================================ */

var samples = require('../../data/card-samples.js');
var layoutUtil = require('../../utils/card-layout.js');
var formUtil = require('../../utils/survey-form.js');
var submitUtil = require('../../utils/survey-submit.js');
var api = require('../../utils/api.js');

/* 每屏题数：3 题在 750rpx 宽、选项换行的情况下可视高度够用，
   4 题的固定卷即 3+1 两页；题数 ≤3 时不分页。 */
var PAGE_SIZE = 3;

Page({
  data: {
    status: 'idle',
    message: '',
    title: '',
    intro: '',
    notice: '',
    pageQuestions: [],
    pageIndex: 0,
    pageCount: 1,
    pageNoText: '1 / 1',
    progressPct: 100,
    answeredText: '',
    isLastPage: true,
    missingHint: '',
    cardId: '',
    submitActionId: '',
    keyText: '',
    modeText: '演示模式（本地回执，不落服务端）',
    payloadText: '',
    resultTitle: '',
    resultText: '',
    costMs: 0,
    submitting: false
  },

  onLoad: function (options) {
    var opts = options || {};
    var live = opts.live === '1';
    var card = samples.choiceForm && samples.choiceForm.card;
    var res = layoutUtil.normalizeCard(card);

    if (!res.ok) {
      this.setData({ status: 'rejected', message: '问卷卡无法渲染：' + (res.message || res.reason) });
      return;
    }

    var formNode = null;
    var buttonsNode = null;
    var intro = [];
    var notice = '';
    res.nodes.forEach(function (n) {
      if (n.type === 'form' && !formNode) formNode = n;
      else if (n.type === 'buttons' && !buttonsNode) buttonsNode = n;
      else if (n.type === 'text') intro.push(n.text);
      else if (n.type === 'notice') notice = n.text;
    });

    if (!formNode) {
      this.setData({ status: 'rejected', message: '问卷卡缺 form 组件' });
      return;
    }

    this.card = card;
    this.formNode = formNode;
    this.answers = {};
    this.pageIndex = 0;
    this.submitter = submitUtil.createSubmitter(this.buildSender(live));
    this.submitActionId = (buttonsNode && buttonsNode.items[0] && buttonsNode.items[0].action_id) || 'submit_all';

    this.setData({
      status: 'ok',
      title: (card.layout && card.layout.title) || '问卷',
      intro: intro.join(' '),
      notice: notice,
      cardId: card.card_id,
      submitActionId: this.submitActionId,
      modeText: live ? '联调模式（POST /api/v1/chat）' : '演示模式（本地回执，不落服务端）'
    });

    this.refreshAll();
  },

  buildSender: function (live) {
    if (live) {
      return function (payload) {
        return api.request('/chat', { method: 'POST', data: payload });
      };
    }
    return function (payload) {
      return Promise.resolve({
        mock: true,
        accepted: true,
        card_id: payload.card_id,
        action_id: payload.action_id,
        received: payload.card_answers,
        idempotency_key: formUtil.fingerprint(payload)
      });
    };
  },

  /** 重算整卷视图并按当前页切片；只读 answers，不发请求 */
  refreshAll: function () {
    var view = formUtil.buildView(this.formNode, this.answers);
    var total = view.length;
    var pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (this.pageIndex > pageCount - 1) this.pageIndex = pageCount - 1;
    if (this.pageIndex < 0) this.pageIndex = 0;

    var start = this.pageIndex * PAGE_SIZE;
    var answered = 0;
    for (var i = 0; i < view.length; i++) {
      if (view[i].answered) answered++;
    }

    var payload = formUtil.buildPayload(this.card.card_id, this.submitActionId, this.formNode, this.answers);

    this.setData({
      pageQuestions: view.slice(start, start + PAGE_SIZE),
      pageIndex: this.pageIndex,
      pageCount: pageCount,
      pageNoText: (this.pageIndex + 1) + ' / ' + pageCount,
      progressPct: Math.round(((this.pageIndex + 1) / pageCount) * 100),
      answeredText: '已答 ' + answered + '/' + total,
      isLastPage: this.pageIndex === pageCount - 1,
      missingHint: formUtil.missingHint(this.formNode, this.answers),
      keyText: formUtil.fingerprint(payload)
    });
  },

  onTapOption: function (e) {
    var ds = e.currentTarget.dataset || {};
    this.answers = formUtil.toggleAnswer(this.formNode, this.answers, ds.qid, ds.value);
    this.refreshAll();
  },

  /** 上一页：回退不清答案，也不发请求 */
  onPrevPage: function () {
    if (this.pageIndex <= 0) return;
    this.pageIndex -= 1;
    this.refreshAll();
  },

  onNextPage: function () {
    if (this.pageIndex >= this.data.pageCount - 1) return;
    this.pageIndex += 1;
    this.refreshAll();
  },

  onSubmit: function () {
    if (!this.data.isLastPage || this.data.submitting) return;
    var self = this;
    var payload = formUtil.buildPayload(this.card.card_id, this.submitActionId, this.formNode, this.answers);
    var key = formUtil.fingerprint(payload);
    var t0 = Date.now();

    this.setData({
      submitting: true,
      keyText: key,
      payloadText: JSON.stringify(payload, null, 2),
      resultTitle: '',
      resultText: ''
    });

    this.submitter.submit(payload).then(function (record) {
      self.setData({
        submitting: false,
        costMs: Date.now() - t0,
        resultTitle: record.replayed
          ? '同一份答案：回放首次结果（未再发请求）'
          : '新一次提交：已回传',
        resultText: JSON.stringify(record.response, null, 2)
      });
    }, function (err) {
      self.setData({
        submitting: false,
        costMs: Date.now() - t0,
        resultTitle: '提交失败',
        resultText: (err && err.message) || String(err)
      });
    });
  },

  onResetAnswers: function () {
    this.answers = {};
    this.pageIndex = 0;
    this.refreshAll();
    this.setData({ resultTitle: '', resultText: '', payloadText: '', costMs: 0 });
  }
});
