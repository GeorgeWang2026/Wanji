/* ============================================================
 * DF-156 · 问卷形态（纯逻辑，无 wx API）
 * ------------------------------------------------------------
 * 契约：wanji `static/cards/samples/case5-choice-form.json` + manifest
 *   - card.layout 里的 form 组件，一次下发全部题目
 *   - 每题都有「不确定/跳过」；性别题「不便回答」
 *   - required 只做前端提示，缺答不阻断提交
 *   - 整卷回传：card_id + action_id + card_answers = {题号: 值或值列表}
 *   - 幂等键 = 动作 + 归一后答案指纹
 * 页面与 node 自测脚本共用，只用 ES5 + module.exports。
 * ============================================================ */

var SKIP_LABEL = '不确定/跳过';
var SKIP_VALUE = '__skip__';

function str(v, d) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return d == null ? '' : d;
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function findQuestion(formNode, qid) {
  var qs = (formNode && formNode.questions) || [];
  for (var i = 0; i < qs.length; i++) if (qs[i].id === qid) return qs[i];
  return null;
}

function findOption(q, value) {
  for (var i = 0; i < q.options.length; i++) if (q.options[i].value === value) return q.options[i];
  return null;
}

/** 渲染模型：每题带 selected，页面直接照单渲染 */
function buildView(formNode, answers) {
  answers = answers || {};
  var qs = (formNode && formNode.questions) || [];
  return qs.map(function (q, idx) {
    var picked = answers[q.id] || [];
    return {
      id: q.id,
      index: idx + 1,
      title: q.text,
      required: !!q.required,
      multiple: !!q.multiple,
      typeLabel: q.multiple ? '多选' : '单选',
      answered: picked.length > 0,
      options: q.options.map(function (o) {
        return {
          label: o.label,
          value: o.value,
          action_id: o.action_id,
          skip: !!o.skip,
          selected: picked.indexOf(o.value) >= 0
        };
      })
    };
  });
}

/** 点选：单选覆盖；多选切换；「跳过」清空其它项 */
function toggleAnswer(formNode, answers, qid, value) {
  var next = clone(answers || {});
  var q = findQuestion(formNode, qid);
  if (!q) return next;
  var opt = findOption(q, value);
  if (!opt) return next;

  if (!q.multiple) {
    next[qid] = [value];
    return next;
  }

  if (opt.skip) {
    next[qid] = [value];
    return next;
  }

  var cur = (next[qid] || []).filter(function (v) {
    var o = findOption(q, v);
    return o && !o.skip;
  });
  var at = cur.indexOf(value);
  if (at >= 0) cur.splice(at, 1);
  else cur.push(value);
  next[qid] = cur;
  return next;
}

/** 必填缺失：只用于提示，不参与拦截 */
function missingRequired(formNode, answers) {
  answers = answers || {};
  var out = [];
  var qs = (formNode && formNode.questions) || [];
  qs.forEach(function (q, idx) {
    if (!q.required) return;
    if (!(answers[q.id] || []).length) out.push({ id: q.id, index: idx + 1, title: q.text });
  });
  return out;
}

function missingHint(formNode, answers) {
  var miss = missingRequired(formNode, answers);
  if (!miss.length) return '';
  var names = miss.map(function (m) { return m.index + '. ' + m.title; }).join('；');
  return '必填未答：' + names + '（可继续提交）';
}

/** 整卷答案：{题号: 值或值列表}，只带已答题目 */
function buildCardAnswers(formNode, answers) {
  answers = answers || {};
  var out = {};
  var qs = (formNode && formNode.questions) || [];
  qs.forEach(function (q) {
    var picked = (answers[q.id] || []).slice();
    if (!picked.length) return;
    out[q.id] = q.multiple ? picked : picked[0];
  });
  return out;
}

/** 整卷回传载荷：与 card_id、action_id 同用 */
function buildPayload(cardId, actionId, formNode, answers) {
  return {
    card_id: str(cardId, ''),
    action_id: str(actionId, ''),
    card_answers: buildCardAnswers(formNode, answers)
  };
}

/** 归一答案：题号排序、多选值排序去重，用于指纹与比较 */
function normalizeAnswers(cardAnswers) {
  var src = cardAnswers || {};
  var ids = Object.keys(src).sort();
  var out = {};
  ids.forEach(function (id) {
    var v = src[id];
    var arr = (Array.isArray(v) ? v : [v]).map(function (x) { return String(x).trim(); })
      .filter(function (x) { return x !== ''; });
    arr.sort();
    var uniq = [];
    arr.forEach(function (x) { if (uniq.indexOf(x) < 0) uniq.push(x); });
    if (uniq.length) out[id] = uniq;
  });
  return out;
}

function hash32(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 幂等键：动作 + 归一后答案指纹 */
function fingerprint(payload) {
  var p = payload || {};
  var body = JSON.stringify([str(p.action_id, ''), normalizeAnswers(p.card_answers)]);
  return 'fp_' + hash32(body) + '_' + body.length;
}

module.exports = {
  SKIP_LABEL: SKIP_LABEL,
  SKIP_VALUE: SKIP_VALUE,
  buildView: buildView,
  toggleAnswer: toggleAnswer,
  missingRequired: missingRequired,
  missingHint: missingHint,
  buildCardAnswers: buildCardAnswers,
  buildPayload: buildPayload,
  normalizeAnswers: normalizeAnswers,
  fingerprint: fingerprint
};
