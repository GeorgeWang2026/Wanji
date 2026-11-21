/* ============================================================
 * DF-156 · JSON 驱动卡片 · 布局解析与校验（纯逻辑，无 wx API）
 * ------------------------------------------------------------
 * 契约来源：wanji `static/cards/samples/manifest.json`
 *   schema_version : "1"
 *   components     : group / text / buttons / choice / input / image / status / notice
 *   limits         : max_layout_bytes 16384 / max_nodes 200 / max_depth 3
 *                    max_text_len 500 / max_label_len 40 / max_buttons 4 / max_options 20
 *   未知组件       : 降级为文本块；text 取不出来则丢弃，不白屏
 *
 * 同一份文件同时被小程序（require）与 node 自测脚本加载，
 * 所以只用 ES5 + module.exports。
 * ============================================================ */

var SCHEMA_VERSION = '1';

var LIMITS = {
  maxLayoutBytes: 16384,
  maxNodes: 200,
  maxDepth: 3,
  maxTextLen: 500,
  maxLabelLen: 40,
  maxButtons: 4,
  maxOptions: 20
};

var COMPONENTS = ['group', 'text', 'buttons', 'choice', 'input', 'image', 'status', 'notice'];

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v, fallback) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback == null ? '' : fallback;
}

/* 中英混排按 UTF-8 字节算，与后端 max_layout_bytes 同口径 */
function utf8Bytes(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

function cut(s, max) {
  var t = str(s, '');
  if (t.length <= max) return t;
  return t.substring(0, max - 1) + '…';
}

function num(v, def) {
  var n = Number(v);
  return isFinite(n) ? n : def;
}

/* ---------- 单节点归一 ----------
 * 返回 {node|null, downgrade?, dropped?, warn?}
 */
function normalizeNode(raw, depth, ctx) {
  if (!isPlainObject(raw)) {
    return { dropped: '节点不是对象' };
  }

  var type = str(raw.type, '').trim();
  var key = str(raw.key, '');

  if (COMPONENTS.indexOf(type) < 0) {
    var label = str(raw.text || raw.label || raw.title, '').trim();
    if (!label) {
      // 取不出文本就丢弃，不白屏也不留空壳；丢弃不计入降级清单
      return { downgrade: true, dropped: '未知组件无文本：' + (type || '(空)') };
    }
    ctx.downgrades.push({ type: type || '(空)', key: key });
    return {
      downgrade: true,
      node: {
        type: 'text',
        text: cut(label, LIMITS.maxTextLen),
        tone: 'muted',
        depth: depth,
        key: key,
        downgraded: true,
        originalType: type || '(空)'
      }
    };
  }

  if (type === 'text') {
    var tx = cut(raw.text, LIMITS.maxTextLen);
    if (!tx.trim()) return { dropped: '空文本块' };
    return { node: { type: 'text', text: tx, tone: raw.tone === 'muted' ? 'muted' : 'default', depth: depth, key: key } };
  }

  if (type === 'notice') {
    var nt = cut(raw.text, LIMITS.maxTextLen);
    if (!nt.trim()) return { dropped: '空提示条' };
    var lv = (raw.level === 'warn' || raw.level === 'error') ? raw.level : 'info';
    return { node: { type: 'notice', text: nt, level: lv, depth: depth, key: key } };
  }

  if (type === 'image') {
    var url = str(raw.url, '');
    if (!url) return { dropped: '图片缺 url' };
    return { node: { type: 'image', url: url, alt: cut(raw.alt, LIMITS.maxLabelLen), depth: depth, key: key } };
  }

  if (type === 'status') {
    var pct = num(raw.value, 0);
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return {
      node: {
        type: 'status',
        label: cut(raw.label, LIMITS.maxLabelLen),
        text: cut(raw.text, LIMITS.maxLabelLen),
        value: pct,
        depth: depth,
        key: key
      }
    };
  }

  if (type === 'buttons') {
    var items = Array.isArray(raw.items) ? raw.items : [];
    var btns = [];
    for (var i = 0; i < items.length && btns.length < LIMITS.maxButtons; i++) {
      var b = items[i];
      if (!isPlainObject(b)) continue;
      var bid = str(b.action_id, '');
      var blabel = cut(b.label, LIMITS.maxLabelLen);
      if (!bid || !blabel) { ctx.warnings.push('按键缺 action_id 或 label，已丢弃'); continue; }
      btns.push({ label: blabel, action_id: bid, style: b.style === 'primary' ? 'primary' : 'default' });
    }
    if (!btns.length) return { dropped: '按键组无有效按键' };
    if (items.length > LIMITS.maxButtons) ctx.warnings.push('按键超上限 ' + LIMITS.maxButtons + '，已截断');
    return { node: { type: 'buttons', items: btns, depth: depth, key: key } };
  }

  if (type === 'choice') {
    var opts = Array.isArray(raw.options) ? raw.options : [];
    var out = [];
    for (var j = 0; j < opts.length && out.length < LIMITS.maxOptions; j++) {
      var o = opts[j];
      if (!isPlainObject(o)) continue;
      var oid = str(o.action_id, '');
      var olabel = cut(o.label, LIMITS.maxLabelLen);
      if (!oid || !olabel) { ctx.warnings.push('选项缺 action_id 或 label，已丢弃'); continue; }
      out.push({
        label: olabel,
        value: str(o.value, ''),
        action_id: oid,
        description: cut(o.description, LIMITS.maxTextLen)
      });
    }
    if (!out.length) return { dropped: '选择列表无有效选项' };
    if (opts.length > LIMITS.maxOptions) ctx.warnings.push('选项超上限 ' + LIMITS.maxOptions + '，已截断');
    return { node: { type: 'choice', multiple: !!raw.multiple, options: out, depth: depth, key: key } };
  }

  if (type === 'input') {
    return {
      node: {
        type: 'input',
        name: str(raw.name, ''),
        placeholder: cut(raw.placeholder, LIMITS.maxTextLen),
        max_length: num(raw.max_length, 200) > 0 ? num(raw.max_length, 200) : 200,
        value: str(raw.value, ''),
        depth: depth,
        key: key
      }
    };
  }

  // group
  var children = Array.isArray(raw.children) ? raw.children : [];
  return {
    node: {
      type: 'group',
      title: cut(raw.title, LIMITS.maxLabelLen),
      children: children,
      depth: depth,
      key: key
    }
  };
}

/* ---------- 主入口 ----------
 * normalizeCard(card) →
 *   { ok:true, nodes:[扁平节点], stats }
 *   { ok:false, skipped:true, reason:'no_card' }   // 无 card：调用方照旧走纯文本
 *   { ok:false, reason, message, stats }           // 整卡拒渲染，页面给可见提示
 */
function normalizeCard(card) {
  var t0 = now();

  if (card == null) {
    return { ok: false, skipped: true, reason: 'no_card', message: '本条消息无 card 字段', stats: { ms: round3(now() - t0) } };
  }
  if (!isPlainObject(card)) {
    return { ok: false, reason: 'card_invalid', message: 'card 不是对象', stats: { ms: round3(now() - t0) } };
  }

  var ver = str(card.schema_version, '');
  if (!ver) {
    return { ok: false, reason: 'schema_version_missing', message: '缺少 schema_version', stats: { ms: round3(now() - t0) } };
  }
  if (ver !== SCHEMA_VERSION) {
    return { ok: false, reason: 'schema_version_unsupported', message: '不支持的 schema_version：' + ver, stats: { ms: round3(now() - t0) } };
  }

  var layout = card.layout;
  if (!isPlainObject(layout) || !layout.type) {
    return { ok: false, reason: 'layout_invalid', message: 'layout 必须是带 type 的节点', stats: { ms: round3(now() - t0) } };
  }

  var json = '';
  try { json = JSON.stringify(layout); } catch (e) { json = null; }
  if (json == null) {
    return { ok: false, reason: 'layout_invalid', message: 'layout 无法序列化', stats: { ms: round3(now() - t0) } };
  }

  var bytes = utf8Bytes(json);
  if (bytes > LIMITS.maxLayoutBytes) {
    return {
      ok: false,
      reason: 'layout_too_large',
      message: '布局超限：' + bytes + ' 字节，上限 ' + LIMITS.maxLayoutBytes,
      stats: { bytes: bytes, ms: round3(now() - t0) }
    };
  }

  var ctx = { downgrades: [], dropped: [], warnings: [], count: 0, maxDepth: 0, actions: [], actionSet: {} };
  var flat = [];
  var overflow = null;

  function pushAction(id) {
    if (!id) return;
    if (ctx.actionSet[id]) { ctx.warnings.push('action_id 重复：' + id); return; }
    ctx.actionSet[id] = 1;
    ctx.actions.push(id);
  }

  function visit(raw, depth) {
    if (overflow) return;
    if (depth > LIMITS.maxDepth) { overflow = 'layout_too_deep'; return; }
    ctx.count++;
    if (ctx.count > LIMITS.maxNodes) { overflow = 'layout_too_many_nodes'; return; }
    if (depth > ctx.maxDepth) ctx.maxDepth = depth;

    var r = normalizeNode(raw, depth, ctx);
    if (r.warn) ctx.warnings.push(r.warn);
    if (r.dropped) { ctx.dropped.push(r.dropped); return; }
    var node = r.node;
    if (!node) return;

    if (node.type === 'buttons') {
      for (var b = 0; b < node.items.length; b++) pushAction(node.items[b].action_id);
    } else if (node.type === 'choice') {
      for (var k = 0; k < node.options.length; k++) pushAction(node.options[k].action_id);
    }

    flat.push(node);

    if (node.type === 'group') {
      var kids = node.children || [];
      for (var c = 0; c < kids.length; c++) {
        if (overflow) return;
        visit(kids[c], depth + 1);
      }
    }
  }

  visit(layout, 0);

  if (overflow) {
    return {
      ok: false,
      reason: overflow,
      message: overflow === 'layout_too_deep'
        ? '布局超限：嵌套超过 ' + LIMITS.maxDepth + ' 层'
        : '布局超限：节点数超过 ' + LIMITS.maxNodes,
      stats: { bytes: bytes, count: ctx.count, ms: round3(now() - t0) }
    };
  }

  return {
    ok: true,
    nodes: flat,
    stats: {
      bytes: bytes,
      count: ctx.count,
      maxDepth: ctx.maxDepth,
      downgrades: ctx.downgrades,
      dropped: ctx.dropped,
      warnings: ctx.warnings,
      actions: ctx.actions,
      ms: round3(now() - t0)
    }
  };
}

function cardMeta(card) {
  if (!isPlainObject(card)) return null;
  return { card_id: str(card.card_id, ''), schema_version: str(card.schema_version, '') };
}

function now() {
  return (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
}

function round3(n) { return Math.round(n * 1000) / 1000; }

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  LIMITS: LIMITS,
  COMPONENTS: COMPONENTS,
  normalizeCard: normalizeCard,
  cardMeta: cardMeta,
  utf8Bytes: utf8Bytes
};
