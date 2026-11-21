/* ============================================================
 * DF-156 · JSON 驱动卡片 · 布局解析与校验（纯逻辑，无 wx API）
 * ------------------------------------------------------------
 * 口径来源：《JSON 驱动卡片与 AI 布局》§13 已定稿
 *   1) card 可选：缺省时返回 skipped，调用方按纯文本消息走，不受影响
 *   2) schema_version 必填
 *   3) 只认 8 个原子组件白名单，未知类型降级为文本块，不能白屏
 *   4) layout 设大小上限：节点数 / 深度 / 序列化字符数
 *
 * 同一份文件同时被小程序（require）与 node 自测脚本加载，
 * 所以这里只用 ES5 + module.exports，不碰任何运行时专有对象。
 * ============================================================ */

var SCHEMA_VERSION = '1.0';

var LIMITS = {
  maxNodes: 200,        // 单张卡最多节点数
  maxDepth: 6,          // 分组容器最大嵌套层数
  maxChars: 32768       // JSON.stringify(layout) 的最大字符数
};

// 8 个原子组件（白名单）。未列出的 type 一律降级为文本块。
var TYPES = {
  text: '文本块',
  buttons: '按键组',
  list: '单选/多选列表',
  input: '输入框',
  image: '图片',
  status: '状态/进度',
  group: '分组容器',
  tip: '提示条'
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asText(v, fallback) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback == null ? '' : fallback;
}

function clamp01(n) {
  var x = Number(n);
  if (!isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/* ---------- 单节点归一 ----------
 * 返回 {node, warn, downgraded}
 * node 一定是 8 类之一；不合规的一律落成 text，保证渲染器拿到就能画。
 */
function normalizeNode(raw, depth, ctx) {
  var warn = null;
  if (!isPlainObject(raw)) {
    return { node: { type: 'text', text: asText(raw, ''), depth: depth }, warn: '节点不是对象，按文本处理', downgraded: true };
  }
  var type = asText(raw.type, '').trim();
  var key = asText(raw.key, '');

  if (!TYPES[type]) {
    var label = asText(raw.text || raw.title || raw.label, '');
    var shown = label ? label : '[' + (type || '未命名') + ']';
    ctx.downgrades.push({ type: type || '(空)', key: key });
    return {
      node: { type: 'text', text: shown, depth: depth, key: key, downgraded: true, originalType: type || '(空)' },
      warn: null,
      downgraded: true
    };
  }

  if (type === 'text') {
    return { node: { type: 'text', text: asText(raw.text, ''), depth: depth, key: key, muted: !!raw.muted }, warn: null };
  }

  if (type === 'tip') {
    return {
      node: {
        type: 'tip',
        text: asText(raw.text, ''),
        level: (raw.level === 'warn' || raw.level === 'error') ? raw.level : 'info',
        depth: depth,
        key: key
      },
      warn: null
    };
  }

  if (type === 'buttons') {
    var btns = Array.isArray(raw.buttons) ? raw.buttons : [];
    var out = [];
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!isPlainObject(b)) continue;
      var id = asText(b.action_id, '');
      if (!id) { warn = '按键缺 action_id，已丢弃'; continue; }
      out.push({
        text: asText(b.text, ''),
        action_id: id,
        style: b.style === 'primary' ? 'primary' : 'default',
        disabled: !!b.disabled
      });
    }
    if (!out.length) {
      return { node: { type: 'text', text: asText(raw.text, '（无可用按键）'), depth: depth, key: key, downgraded: true }, warn: '按键组无有效按键', downgraded: true };
    }
    return { node: { type: 'buttons', buttons: out, depth: depth, key: key }, warn: warn };
  }

  if (type === 'list') {
    var items = Array.isArray(raw.items) ? raw.items : [];
    var opts = [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (!isPlainObject(it)) continue;
      var oid = asText(it.action_id, '');
      if (!oid) { warn = '列表项缺 action_id，已丢弃'; continue; }
      opts.push({ text: asText(it.text, ''), action_id: oid, checked: !!it.checked, disabled: !!it.disabled });
    }
    if (!opts.length) {
      return { node: { type: 'text', text: asText(raw.title, '（无可用选项）'), depth: depth, key: key, downgraded: true }, warn: '列表无有效选项', downgraded: true };
    }
    return {
      node: {
        type: 'list',
        mode: raw.mode === 'multi' ? 'multi' : 'single',
        title: asText(raw.title, ''),
        items: opts,
        depth: depth,
        key: key
      },
      warn: warn
    };
  }

  if (type === 'input') {
    return {
      node: {
        type: 'input',
        label: asText(raw.label, ''),
        placeholder: asText(raw.placeholder, ''),
        value: asText(raw.value, ''),
        action_id: asText(raw.action_id, ''),
        maxlength: Number(raw.maxlength) > 0 ? Number(raw.maxlength) : 200,
        depth: depth,
        key: key
      },
      warn: null
    };
  }

  if (type === 'image') {
    var src = asText(raw.src, '');
    if (!src) {
      return { node: { type: 'text', text: asText(raw.alt, '（图片缺失）'), depth: depth, key: key, downgraded: true }, warn: '图片缺 src', downgraded: true };
    }
    return {
      node: { type: 'image', src: src, alt: asText(raw.alt, ''), mode: asText(raw.mode, 'aspectFill'), depth: depth, key: key },
      warn: null
    };
  }

  if (type === 'status') {
    return {
      node: {
        type: 'status',
        label: asText(raw.label, ''),
        value: asText(raw.value, ''),
        percent: raw.percent == null ? null : clamp01(Number(raw.percent) / (Number(raw.percent) > 1 ? 100 : 1)),
        state: (raw.state === 'done' || raw.state === 'error') ? raw.state : 'running',
        depth: depth,
        key: key
      },
      warn: null
    };
  }

  // group
  var children = Array.isArray(raw.children) ? raw.children : [];
  return {
    node: {
      type: 'group',
      title: asText(raw.title, ''),
      collapsed: !!raw.collapsed,
      children: children,
      depth: depth,
      key: key
    },
    warn: null
  };
}

/* ---------- 主入口 ----------
 * normalizeCard(card) →
 *   { ok:true, nodes:[扁平节点], stats:{...} }
 *   { ok:false, skipped:true, reason:'no_card' }         // 无 card 字段：调用方照旧走文本
 *   { ok:false, reason:'...', message:'...' }            // 拒绝渲染，页面上给可见提示
 */
function normalizeCard(card) {
  var t0 = now();

  if (card == null) {
    return { ok: false, skipped: true, reason: 'no_card', message: '本条消息无 card 字段', stats: { ms: round3(now() - t0) } };
  }
  if (!isPlainObject(card)) {
    return { ok: false, reason: 'card_invalid', message: 'card 不是对象', stats: { ms: round3(now() - t0) } };
  }

  var ver = asText(card.schema_version, '');
  if (!ver) {
    return { ok: false, reason: 'schema_version_missing', message: '缺少 schema_version', stats: { ms: round3(now() - t0) } };
  }
  if (ver !== SCHEMA_VERSION) {
    return { ok: false, reason: 'schema_version_unsupported', message: '不支持的 schema_version：' + ver, stats: { ms: round3(now() - t0) } };
  }

  var layout = card.layout;
  if (!isPlainObject(layout) || !Array.isArray(layout.nodes)) {
    return { ok: false, reason: 'layout_invalid', message: 'layout.nodes 必须为数组', stats: { ms: round3(now() - t0) } };
  }

  var chars = 0;
  try { chars = JSON.stringify(layout).length; } catch (e) { chars = LIMITS.maxChars + 1; }
  if (chars > LIMITS.maxChars) {
    return {
      ok: false,
      reason: 'layout_too_large',
      message: '布局超限：' + chars + ' 字符，上限 ' + LIMITS.maxChars,
      stats: { chars: chars, ms: round3(now() - t0) }
    };
  }

  var ctx = { downgrades: [], warnings: [], count: 0, maxDepth: 0, actions: [], actionSet: {} };
  var flat = [];

  var overflow = null;

  function walk(list, depth) {
    if (overflow) return;
    if (depth > LIMITS.maxDepth) { overflow = 'layout_too_deep'; return; }
    for (var i = 0; i < list.length; i++) {
      if (overflow) return;
      ctx.count++;
      if (ctx.count > LIMITS.maxNodes) { overflow = 'layout_too_many_nodes'; return; }
      if (depth > ctx.maxDepth) ctx.maxDepth = depth;

      var r = normalizeNode(list[i], depth, ctx);
      if (r.warn) ctx.warnings.push(r.warn);
      var node = r.node;

      // 收集可回传动作，顺带做前端侧去重（服务端仍需幂等）
      if (node.type === 'buttons') {
        for (var b = 0; b < node.buttons.length; b++) pushAction(node.buttons[b].action_id);
      } else if (node.type === 'list') {
        for (var k = 0; k < node.items.length; k++) pushAction(node.items[k].action_id);
      } else if (node.type === 'input' && node.action_id) {
        pushAction(node.action_id);
      }

      flat.push(node);
      if (node.type === 'group') {
        if (node.children && node.children.length) walk(node.children, depth + 1);
      }
    }
  }

  function pushAction(id) {
    if (!id) return;
    if (ctx.actionSet[id]) { ctx.warnings.push('action_id 重复：' + id); return; }
    ctx.actionSet[id] = 1;
    ctx.actions.push(id);
  }

  walk(layout.nodes, 0);

  if (overflow) {
    return {
      ok: false,
      reason: overflow,
      message: overflow === 'layout_too_deep'
        ? '布局超限：嵌套超过 ' + LIMITS.maxDepth + ' 层'
        : '布局超限：节点数超过 ' + LIMITS.maxNodes,
      stats: { chars: chars, count: ctx.count, ms: round3(now() - t0) }
    };
  }

  return {
    ok: true,
    nodes: flat,
    stats: {
      chars: chars,
      count: ctx.count,
      maxDepth: ctx.maxDepth,
      downgrades: ctx.downgrades,
      warnings: ctx.warnings,
      actions: ctx.actions,
      ms: round3(now() - t0)
    }
  };
}

/* 供页面取卡片的身份字段（服务端校验归属，前端只透传） */
function cardMeta(card) {
  if (!isPlainObject(card)) return null;
  return { card_id: asText(card.card_id, ''), schema_version: asText(card.schema_version, '') };
}

function now() {
  if (typeof Date !== 'undefined' && Date.now) return Date.now();
  return 0;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  LIMITS: LIMITS,
  TYPES: TYPES,
  normalizeCard: normalizeCard,
  cardMeta: cardMeta
};
