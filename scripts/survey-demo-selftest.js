#!/usr/bin/env node
/* ============================================================
 * DF-156 · 问卷 demo 自测（§14 四项回执，按 case5-choice-form）
 * ------------------------------------------------------------
 * 1) 单选渲染      2) 多选渲染
 * 3) 整卷提交回传  4) 重复提交回放（幂等键 = 动作 + 归一答案指纹）
 * 用法：node scripts/survey-demo-selftest.js
 * ============================================================ */

var path = require('path');
var samples = require(path.join(__dirname, '..', 'uniApp', 'data', 'card-samples.js'));
var layoutUtil = require(path.join(__dirname, '..', 'uniApp', 'utils', 'card-layout.js'));
var formUtil = require(path.join(__dirname, '..', 'uniApp', 'utils', 'survey-form.js'));
var submitUtil = require(path.join(__dirname, '..', 'uniApp', 'utils', 'survey-submit.js'));

var pass = 0;
var fail = 0;

function assert(cond, name) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

function jsonEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function qOf(view, id) { return view.filter(function (q) { return q.id === id; })[0]; }
function optOf(q, label) { return q.options.filter(function (o) { return o.label === label; })[0]; }

async function main() {
  var t0 = Date.now();
  var card = samples.choiceForm.card;
  var tNorm = Date.now();
  var res = layoutUtil.normalizeCard(card);
  var normMs = Date.now() - tNorm;

  assert(res.ok === true, '问卷卡通过校验，节点 ' + (res.ok ? res.stats.count : res.reason));
  var formNode = null;
  var buttonsNode = null;
  res.nodes.forEach(function (n) {
    if (n.type === 'form' && !formNode) formNode = n;
    if (n.type === 'buttons' && !buttonsNode) buttonsNode = n;
  });
  assert(!!formNode && formNode.questions.length === 4, 'form 组件带 4 道题');
  assert(!!buttonsNode && buttonsNode.items[0].action_id === 'submit_all', '整卷提交按钮 action_id=submit_all');

  /* ---------- 1) 单选渲染 ---------- */
  console.log('\n[1] 单选渲染');
  var t1 = Date.now();
  var view = formUtil.buildView(formNode, {});
  var singleMs = Date.now() - t1;

  var q1 = qOf(view, 'q1');
  assert(q1.multiple === false && q1.required === true, 'q1 是必填单选');
  assert(q1.options.length === 5, 'q1 有 5 个选项，实际 ' + q1.options.length);
  assert(!!optOf(q1, '不确定/跳过') && optOf(q1, '不确定/跳过').skip === true, 'q1 带「不确定/跳过」并标记为跳过');

  var q3 = qOf(view, 'q3');
  assert(q3.options.map(function (o) { return o.label; }).join('/') === '男/女/不便回答',
    '性别题：男/女/不便回答');
  assert(optOf(q3, '不便回答').skip === true, '「不便回答」按跳过处理');

  var answers = {};
  answers = formUtil.toggleAnswer(formNode, answers, 'q1', 'career');
  assert(jsonEqual(answers.q1, ['career']), '选中「事业发展」');
  answers = formUtil.toggleAnswer(formNode, answers, 'q1', 'love');
  assert(jsonEqual(answers.q1, ['love']), '单选互斥：改选后只剩「感情婚姻」');
  answers = formUtil.toggleAnswer(formNode, answers, 'q3', 'male');
  answers = formUtil.toggleAnswer(formNode, answers, 'q3', '__skip__');
  assert(jsonEqual(answers.q3, ['__skip__']), '性别选「不便回答」覆盖前项');
  var q1Back = qOf(formUtil.buildView(formNode, answers), 'q1');
  assert(q1Back.answered === true && optOf(q1Back, '感情婚姻').selected === true, '选中态回显');
  console.log('  单选：4 题中 3 单选，q1 5 选项、q3 3 选项，渲染模型 ' + singleMs + 'ms（卡片校验 ' + normMs + 'ms）');

  /* ---------- 2) 多选渲染 ---------- */
  console.log('\n[2] 多选渲染');
  var t2 = Date.now();
  var q2 = qOf(formUtil.buildView(formNode, {}), 'q2');
  var multiMs = Date.now() - t2;

  assert(q2.multiple === true && q2.required === true, 'q2 是必填多选');
  assert(q2.options.length === 5 && !!optOf(q2, '不确定/跳过'), 'q2 有 4 个方向 + 跳过');

  answers = {};
  answers = formUtil.toggleAnswer(formNode, answers, 'q2', 'timing');
  answers = formUtil.toggleAnswer(formNode, answers, 'q2', 'risk');
  assert(jsonEqual(answers.q2, ['timing', 'risk']), '多选可同时选中两项');
  answers = formUtil.toggleAnswer(formNode, answers, 'q2', 'timing');
  assert(jsonEqual(answers.q2, ['risk']), '再点一次取消该项');
  answers = formUtil.toggleAnswer(formNode, answers, 'q2', '__skip__');
  assert(jsonEqual(answers.q2, ['__skip__']), '选跳过清空其它项');
  answers = formUtil.toggleAnswer(formNode, answers, 'q2', 'cause');
  assert(jsonEqual(answers.q2, ['cause']), '跳过后再选正常项，跳过被移除');
  var q2Back = qOf(formUtil.buildView(formNode, answers), 'q2');
  assert(q2Back.answered === true && optOf(q2Back, '因果解释').selected === true, '多选选中态回显');
  console.log('  多选：5 选项，切换/互斥/回显 ' + multiMs + 'ms');

  /* ---------- 3) 整卷提交回传 ---------- */
  console.log('\n[3] 整卷提交回传');
  var full = {};
  full = formUtil.toggleAnswer(formNode, full, 'q1', 'career');
  full = formUtil.toggleAnswer(formNode, full, 'q2', 'timing');
  full = formUtil.toggleAnswer(formNode, full, 'q2', 'risk');
  full = formUtil.toggleAnswer(formNode, full, 'q3', 'male');

  var emptyMiss = formUtil.missingRequired(formNode, {});
  assert(emptyMiss.length === 2 && emptyMiss[0].id === 'q1' && emptyMiss[1].id === 'q2',
    '空白卷提示 q1、q2 两道必填');
  assert(formUtil.missingHint(formNode, {}).indexOf('可继续提交') >= 0, '缺失提示写明「可继续提交」');

  var sent = [];
  var submitter = submitUtil.createSubmitter(function (payload) {
    sent.push(payload);
    return Promise.resolve({
      accepted: true,
      card_id: payload.card_id,
      action_id: payload.action_id,
      idempotency_key: formUtil.fingerprint(payload)
    });
  });

  var payload = formUtil.buildPayload(card.card_id, 'submit_all', formNode, full);
  var t3 = Date.now();
  var r3 = await submitter.submit(payload);
  var submitMs = Date.now() - t3;

  assert(sent.length === 1, '整卷只发一次请求');
  assert(payload.card_id === 'c_20261121_0005', '载荷带 card_id');
  assert(payload.action_id === 'submit_all', '载荷带 action_id');
  assert(jsonEqual(payload.card_answers, { q1: 'career', q2: ['timing', 'risk'], q3: 'male' }),
    'card_answers={题号: 值或值列表}，未答的 q4 不带');
  assert(r3.ok === true && r3.replayed === false, '首次提交 ok、非回放');
  assert(r3.response.idempotency_key === formUtil.fingerprint(payload), '回执带幂等指纹');
  console.log('  整卷：4 题一次回传（3 答 1 未答），缺必填不阻断，' + submitMs + 'ms');

  /* ---------- 4) 重复提交回放 ---------- */
  console.log('\n[4] 重复提交回放');
  var t4 = Date.now();
  var r4 = await submitter.submit(payload);
  var replayMs = Date.now() - t4;

  assert(sent.length === 1, '同答案重复提交没有再发（发送次数仍为 1）');
  assert(r4.replayed === true, '第二次标记 replayed=true');
  assert(r4.key === r3.key, '命中同一幂等指纹');
  assert(jsonEqual(r4.response, r3.response), '回放响应与首次逐字一致');

  var reordered = formUtil.buildPayload(card.card_id, 'submit_all', formNode, {
    q1: ['career'], q2: ['risk', 'timing'], q3: ['male']
  });
  assert(formUtil.fingerprint(reordered) === formUtil.fingerprint(payload),
    '多选顺序不同视为同一份答案（指纹归一）');
  var r5 = await submitter.submit(reordered);
  assert(sent.length === 1 && r5.replayed === true, '换顺序再提交仍回放，不重发');

  var changed = formUtil.buildPayload(card.card_id, 'submit_all', formNode, {
    q1: ['love'], q2: ['timing', 'risk'], q3: ['male']
  });
  assert(formUtil.fingerprint(changed) !== formUtil.fingerprint(payload), '改答案后指纹变化');
  var r6 = await submitter.submit(changed);
  assert(sent.length === 2 && r6.replayed === false, '改答案再提交算新一次，正常发送');

  var sent2 = [];
  var submitter2 = submitUtil.createSubmitter(function (p) {
    sent2.push(p);
    return new Promise(function (resolve) {
      setTimeout(function () { resolve({ accepted: true, idempotency_key: formUtil.fingerprint(p) }); }, 30);
    });
  });
  var both = await Promise.all([submitter2.submit(payload), submitter2.submit(payload)]);
  assert(sent2.length === 1, '并发双击只发一次');
  assert(both[0].ok && both[1].ok, '并发双击共用同一结果');

  var bad1 = await submitter2.submit({ action_id: 'submit_all', card_answers: {} })
    .then(function () { return null; }, function (e) { return e; });
  assert(bad1 instanceof Error, '缺 card_id 直接拒绝，不发请求');
  var bad2 = await submitter2.submit({ card_id: 'c_x', card_answers: {} })
    .then(function () { return null; }, function (e) { return e; });
  assert(bad2 instanceof Error, '缺 action_id 直接拒绝，不发请求');
  assert(sent2.length === 1, '两次拒绝都没有产生请求');
  console.log('  回放：0 次网络、响应一致；改答案算新一次；' + replayMs + 'ms');

  /* ---------- 汇总 ---------- */
  console.log('\n[四项汇总]');
  console.log('  1 单选渲染：PASS（q1 5 选项、q3 男/女/不便回答）');
  console.log('  2 多选渲染：PASS（q2 5 选项，切换与跳过互斥）');
  console.log('  3 整卷提交回传：PASS（card_id + action_id + card_answers，缺必填不阻断）');
  console.log('  4 重复提交回放：PASS（动作 + 归一答案指纹，同答案 0 次重发）');
  console.log('\n合计 PASS=' + pass + ' FAIL=' + fail + '，总耗时 ' + (Date.now() - t0) + 'ms');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('自测异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
