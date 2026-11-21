#!/usr/bin/env node
/* ============================================================
 * DF-156 · 卡片渲染器离线自测（四份样例）
 * ------------------------------------------------------------
 * 用法：node scripts/card-renderer-selftest.js
 * 只跑纯逻辑层（card-layout.js），不需要开发者工具、不连服务端。
 * 四份样例与张良那侧共用同一套 data/card-samples.js。
 * ============================================================ */

var path = require('path');
var layoutUtil = require(path.join(__dirname, '..', 'uniApp', 'utils', 'card-layout.js'));
var samples = require(path.join(__dirname, '..', 'uniApp', 'data', 'card-samples.js'));

var pass = 0;
var fail = 0;

function assert(cond, name) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

function run(name, card, expect) {
  console.log('\n[' + name + ']');
  var t0 = Date.now();
  var res = layoutUtil.normalizeCard(card);
  var ms = Date.now() - t0;

  if (!res.ok) {
    console.log('  ok=false reason=' + res.reason + ' message=' + (res.message || '') + ' 耗时=' + ms + 'ms');
    expect(res, ms);
    return res;
  }

  console.log('  ok=true 节点=' + res.stats.count + ' 最大深度=' + res.stats.maxDepth +
    ' 字符=' + res.stats.chars + ' 降级=' + res.stats.downgrades.length +
    ' 动作=' + res.stats.actions.length + ' 耗时=' + ms + 'ms');
  if (res.stats.downgrades.length) {
    console.log('  降级清单: ' + res.stats.downgrades.map(function (d) { return d.type; }).join(', '));
  }
  if (res.stats.warnings.length) {
    console.log('  警告: ' + res.stats.warnings.join(' | '));
  }
  console.log('  渲染顺序: ' + res.nodes.map(function (n) {
    return (n.depth ? '  '.repeat(n.depth) : '') + n.type + (n.downgraded ? '(降级:' + n.originalType + ')' : '');
  }).join(' → '));
  expect(res, ms);
  return res;
}

var results = {};

/* 1) 正常：8 类齐全 */
results.normal = run('normal', samples.normal, function (res, ms) {
  assert(res.ok === true, '正常卡可渲染');
  assert(res.stats.count > 0 && res.stats.count <= layoutUtil.LIMITS.maxNodes, '节点数在限内');
  assert(res.stats.actions.length >= 5, '收集到可回传动作 ' + res.stats.actions.length + ' 个');
  var types = res.nodes.map(function (n) { return n.type; });
  ['text', 'tip', 'group', 'list', 'status', 'buttons', 'input'].forEach(function (t) {
    assert(types.indexOf(t) >= 0, '含组件 ' + t);
  });
  assert(res.stats.maxDepth >= 1, '分组容器展开出子层 depth=' + res.stats.maxDepth);
  assert(ms < 50, '耗时 ' + ms + 'ms < 50ms');
});

/* 2) 未知组件降级 */
results.unknown = run('unknown', samples.unknown, function (res, ms) {
  assert(res.ok === true, '含未知组件仍可渲染');
  assert(res.stats.downgrades.length === 2, '两个未知组件被降级：' + res.stats.downgrades.map(function (d) { return d.type; }).join(','));
  var d = res.nodes.filter(function (n) { return n.downgraded; });
  assert(d.length === 2, '渲染层出现 2 个降级文本节点');
  assert(d.every(function (n) { return n.type === 'text' && !!n.text; }), '降级节点都有可见文字，不白屏');
  assert(ms < 50, '耗时 ' + ms + 'ms < 50ms');
});

/* 3) 超限整卡拒绝 */
results.oversize = run('oversize', samples.oversize, function (res) {
  assert(res.ok === false, '超限卡被拒');
  assert(res.reason === 'layout_too_many_nodes', '拒绝原因=' + res.reason);
  assert(!!res.message, '拒因有可见文案：' + res.message);
});

/* 4) 无 card 字段 */
results.no_card = run('no_card', samples.noCard, function (res) {
  assert(res.ok === false && res.skipped === true, '无 card 字段走 skipped，不报错');
  assert(res.reason === 'no_card', '原因=no_card（旧纯文本消息不受影响）');
});

/* 额外：schema_version 缺失 / 不支持 */
console.log('\n[extra]');
var m1 = layoutUtil.normalizeCard({ layout: { nodes: [] } });
assert(m1.ok === false && m1.reason === 'schema_version_missing', '缺 schema_version 被拒');
var m2 = layoutUtil.normalizeCard({ schema_version: '0.9', layout: { nodes: [] } });
assert(m2.ok === false && m2.reason === 'schema_version_unsupported', '不支持的版本被拒');
var m3 = layoutUtil.normalizeCard({ schema_version: '1.0', layout: { nodes: [{ type: 'buttons', buttons: [{ text: '无id' }] }] } });
assert(m3.ok === true && m3.nodes[0].type === 'text', '按键组全无效时降级为文本，不白屏');
var m4 = layoutUtil.normalizeCard({
  schema_version: '1.0',
  layout: { nodes: [{ type: 'buttons', buttons: [{ text: 'a', action_id: 'dup' }, { text: 'b', action_id: 'dup' }] }] }
});
assert(m4.ok === true && m4.stats.actions.length === 1, 'action_id 重复只计一次（前端侧去重）');

console.log('\n合计 PASS=' + pass + ' FAIL=' + fail);
process.exit(fail === 0 ? 0 : 1);
