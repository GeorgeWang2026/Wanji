/* ============================================================
 * DF-156 · 问卷 demo（按 case5-choice-form 渲染，§14）
 * ------------------------------------------------------------
 * 入参：data/card-samples.js 里的 choiceForm（后端样例原样副本）
 * 范围：单选、多选、整卷一次提交回传；问答题（input）本轮不做。
 * 形态：一次下发全部题目；每题有「不确定/跳过」，性别题「不便回答」；
 *       必填未答只提示、不阻断提交。
 * 回传：card_id + action_id + card_answers；幂等键 = 动作 + 归一答案指纹。
 * 调试：?live=1 时真实 POST /api/v1/chat，否则本地回执。
 * ============================================================ */

var samples = require('../../data/card-samples.js');
var layoutUtil = require('../../utils/card-layout.js');
var formUtil = require('../../utils/survey-form.js');
var submitUtil = require('../../utils/survey-submit.js');
var api = require('../../utils/api.js');

Page({
  data: {
    status: 'idle',
    message: '',
    title: '',
    intro: '',
    notice: '',
    questions: [],
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
    this.submitter = submitUtil.createSubmitter(this.buildSender(live));

    var actionId = (buttonsNode && buttonsNode.items[0] && buttonsNode.items[0].action_id) || 'submit_all';
    var emptyPayload = formUtil.buildPayload(card.card_id, actionId, formNode, this.answers);

    this.setData({
      status: 'ok',
      title: (card.layout && card.layout.title) || '问卷',
      intro: intro.join(' '),
      notice: notice,
      questions: formUtil.buildView(formNode, this.answers),
      missingHint: formUtil.missingHint(formNode, this.answers),
      cardId: card.card_id,
      submitActionId: actionId,
      keyText: formUtil.fingerprint(emptyPayload),
      modeText: live ? '联调模式（POST /api/v1/chat）' : '演示模式（本地回执，不落服务端）'
    });
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

  refresh: function () {
    this.setData({
      questions: formUtil.buildView(this.formNode, this.answers),
      missingHint: formUtil.missingHint(this.formNode, this.answers)
    });
  },

  onTapOption: function (e) {
    var ds = e.currentTarget.dataset || {};
    this.answers = formUtil.toggleAnswer(this.formNode, this.answers, ds.qid, ds.value);
    this.refresh();
  },

  onSubmit: function () {
    if (this.data.submitting) return;
    var self = this;
    var payload = formUtil.buildPayload(this.card.card_id, this.data.submitActionId, this.formNode, this.answers);
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
    this.refresh();
    this.setData({ resultTitle: '', resultText: '', payloadText: '', costMs: 0 });
  }
});
