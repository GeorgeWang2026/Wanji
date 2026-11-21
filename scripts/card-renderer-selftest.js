#!/usr/bin/env node
/* ============================================================
 * DF-156 · 卡片渲染器离线自测（对照张良 manifest 四份样例）
 * ------------------------------------------------------------
 * 契约：wanji `static/cards/samples/manifest.json`（schema_version "1"）
 * 用法：node scripts/card-renderer-selftest.js
 * 只跑纯逻辑层（card-layout.js），不连服务端、不开开发者工具。
 * 样例来源：uniApp/data/card-samples/ 下张良那四份 JSON 的原样副本。
 * ============================================================ */

var path = require('path');
var fs = require('fs');
var layoutUtil = require(path.join(__dirname, '..', 'uniApp', 'utils', 'card-layout.js'));
var samples = require(path.join(__dirname, '..', 'uniApp', 'data', 'card-samples.js'));

var SAMPLE_DIR = path.join(__dirname, '..', 'uniApp', 'data', 'card-samples');

var pass = 0;
var fail = 0;

function assert(cond, name) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

/* manifest 里 case2/case3 只给了 layout 根，自测时补上 card 外壳 */
function wrap(layout, cardId) {
  return { schema_version: '1', card_id: cardId, layout: layout };
}

function run(name, card, expect) {
  console.log('\n[' + name + ']');
  var t0 = Date.now();
  var res = layoutUtil.normalizeCard(card);
  var ms = Date.now() - t0;

  if (!res.ok) {
    console.log('  ok=false skipped=' + !!res.skipped + ' reason=' + res.reason +
      ' message=' + (res.message || '') + ' 耗时=' + ms + 'ms');
    expect(res, ms);
    return res;
  }

  var s = res.stats;
  console.log('  ok=true 节点=' + s.count + ' 最大深度=' + s.maxDepth +
    ' 字节=' + s.bytes + ' 降级=' + s.downgrades.length + ' 丢弃=' + s.dropped.length +
    ' 动作=' + s.actions.length + ' 耗时=' + ms + 'ms');
  if (s.downgrades.length) {
    console.log('  降级清单: ' + s.downgrades.map(function (d) { return d.type; }).join(', '));
  }
  if (s.dropped.length) {
    console.log('  丢弃清单: ' + s.dropped.join(' | '));
  }
  if (s.warnings.length) {
    console.log('  警告: ' + s.warnings.join(' | '));
  }
  console.log('  渲染顺序: ' + res.nodes.map(function (n) {
    return (n.depth ? '  '.repeat(n.depth) : '') + n.type +
      (n.downgraded ? '(降级:' + n.originalType + ')' : '');
  }).join(' → '));
  expect(res, ms);
  return res;
}

function typesOf(res) {
  return res.nodes.map(function (n) { return n.type; });
}

var results = {};

/* 1) 正常：8 类组件各一，layout 根是 group */
results.normal = run('case1 正常', samples.normal, function (res, ms) {
  assert(res.ok === true, '正常卡可渲染');
  assert(res.reason === undefined, '无拒绝原因');
  var t = typesOf(res);
  ['group', 'notice', 'text', 'image', 'status', 'choice', 'input', 'buttons'].forEach(function (c) {
    assert(t.indexOf(c) >= 0, '含组件 ' + c);
  });
  assert(res.stats.count === 9, '节点数=9（根 group+8 子），实际 ' + res.stats.count);
  assert(res.stats.maxDepth === 1, '最大深度=1，实际 ' + res.stats.maxDepth);
  assert(res.stats.downgrades.length === 0 && res.stats.dropped.length === 0, '无降级、无丢弃');
  assert(res.stats.actions.length === 6, '收集动作 6 个（choice 4 + buttons 2），实际 ' + res.stats.actions.length);
  assert(res.stats.bytes > 0 && res.stats.bytes <= layoutUtil.LIMITS.maxLayoutBytes,
    '字节 ' + res.stats.bytes + ' 在 16384 内');
  assert(ms < 50, '耗时 ' + ms + 'ms < 50ms');
});

/* 2) 含未知组件：carousel 有文本→降级文本块；video 无文本→丢弃 */
results.unknown = run('case2 含未知组件', wrap(samples.unknown.layout, 'c_case2_unknown'), function (res, ms) {
  assert(res.ok === true, '含未知组件仍可渲染，不白屏');
  assert(res.stats.downgrades.length === 1, '恰有 1 个未知组件被降级，实际 ' + res.stats.downgrades.length);
  assert(res.stats.downgrades[0].type === 'carousel', '被降级的是 carousel');
  assert(res.stats.dropped.length === 1, '恰有 1 个被丢弃，实际 ' + res.stats.dropped.length);
  assert(res.stats.dropped[0].indexOf('video') >= 0, '被丢弃的是 video（无文本）：' + res.stats.dropped[0]);
  var dg = res.nodes.filter(function (n) { return n.downgraded; });
  assert(dg.length === 1 && dg[0].type === 'text' && dg[0].tone === 'muted' && !!dg[0].text,
    '降级节点是可见文本块（muted），文字=' + (dg[0] && dg[0].text));
  assert(typesOf(res).indexOf('video') < 0, '渲染层不出现 video');
  assert(ms < 50, '耗时 ' + ms + 'ms < 50ms');
});

/* 3) 超限：layout 60785 字节 > 16384，整卡拒 */
results.oversize = run('case3 超限', wrap(samples.oversize.layout, 'c_case3_oversize'), function (res) {
  assert(res.ok === false, '超限卡被整卡拒绝');
  assert(res.reason === 'layout_too_large', '拒绝原因=layout_too_large，实际 ' + res.reason);
  assert(res.stats.bytes > layoutUtil.LIMITS.maxLayoutBytes,
    '字节 ' + res.stats.bytes + ' > ' + layoutUtil.LIMITS.maxLayoutBytes);
  assert(!!res.message, '拒因有可见文案：' + res.message);
  assert(res.nodes === undefined, '被拒时不产出任何节点（页面走纯文本）');
  var raw = fs.readFileSync(path.join(SAMPLE_DIR, 'case3-oversize.input.json'), 'utf8');
  console.log('  样例原始文件 ' + Buffer.byteLength(raw, 'utf8') + ' 字节');
});

/* 4) 无 card：null → skipped，调用方照旧走纯文本 */
results.noCard = run('case4 无 card', samples.noCard, function (res) {
  assert(res.ok === false && res.skipped === true, '无 card 走 skipped，不当错误');
  assert(res.reason === 'no_card', '原因=no_card（旧纯文本消息路径不变）');
  assert(res.nodes === undefined, '不产出节点，页面保留原文本渲染');
});

/* 额外：契约边界，无样例覆盖的那几条 */
console.log('\n[extra 边界]');
var m1 = layoutUtil.normalizeCard({ layout: { type: 'text', text: 'x' } });
assert(m1.ok === false && m1.reason === 'schema_version_missing', '缺 schema_version 被拒');

var m2 = layoutUtil.normalizeCard({ schema_version: '0.9', layout: { type: 'text', text: 'x' } });
assert(m2.ok === false && m2.reason === 'schema_version_unsupported', '不支持版本 0.9 被拒');

var m3 = layoutUtil.normalizeCard({ schema_version: '1', layout: { type: 'buttons', items: [{ label: '无 id' }] } });
assert(m3.ok === false && m3.reason === 'layout_invalid' || m3.ok === true, '全无效按键不崩溃');
assert(m3.ok !== true || m3.nodes.every(function (n) { return n.type !== 'buttons'; }), '全无效按键不留空按键组');

var m4 = layoutUtil.normalizeCard({
  schema_version: '1',
  layout: { type: 'buttons', items: [
    { label: 'a', action_id: 'dup' },
    { label: 'b', action_id: 'dup' },
    { label: 'c', action_id: 'c3' },
    { label: 'd', action_id: 'd4' },
    { label: 'e', action_id: 'e5' }
  ] }
});
assert(m4.ok === true && m4.stats.actions.length === 3, 'action_id 去重后剩 3 个、按键截到 4 个，实际 ' + (m4.ok && m4.stats.actions.length));
assert(m4.ok === true && m4.stats.warnings.length >= 2, '重复与截断都记 warning');

var m5 = layoutUtil.normalizeCard({
  schema_version: '1',
  layout: { type: 'group', children: [
    { type: 'group', children: [
      { type: 'group', children: [
        { type: 'group', children: [{ type: 'text', text: '太深' }] }
      ] }
    ] }
  ] }
});
assert(m5.ok === false && m5.reason === 'layout_too_deep', '嵌套 4 层被拒');

var many = [];
for (var i = 0; i < 201; i++) many.push({ type: 'text', text: 'n' + i });
var m6 = layoutUtil.normalizeCard({ schema_version: '1', layout: { type: 'group', children: many } });
assert(m6.ok === false && m6.reason === 'layout_too_many_nodes', '节点 202 个被拒');

var m7 = layoutUtil.normalizeCard({ schema_version: '1', layout: { type: 'text', text: new Array(600).join('字') } });
assert(m7.ok === true && m7.nodes[0].text.length === layoutUtil.LIMITS.maxTextLen, '超长文本截到 500 字');

assert(layoutUtil.utf8Bytes('abc') === 3 && layoutUtil.utf8Bytes('汉字') === 6 &&
  layoutUtil.utf8Bytes('😀') === 4, 'UTF-8 字节口径与后端一致');

/* 汇总四份样例 */
console.log('\n[四份样例汇总]');
[['case1 正常', results.normal], ['case2 含未知组件', results.unknown],
 ['case3 超限', results.oversize], ['case4 无 card', results.noCard]].forEach(function (p) {
  var r = p[1];
  var verdict = r.ok ? ('渲染 ' + r.stats.count + ' 节点')
    : (r.skipped ? 'skipped→纯文本' : '拒绝(' + r.reason + ')→纯文本');
  console.log('  ' + p[0] + '：' + verdict + '，耗时 ' + r.stats.ms + 'ms');
});

console.log('\n合计 PASS=' + pass + ' FAIL=' + fail);
process.exit(fail === 0 ? 0 : 1);
