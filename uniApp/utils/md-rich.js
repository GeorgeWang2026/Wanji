/* ============================================================
 * md-rich.js —— Markdown HTML → rich-text 可用的 HTML
 * ------------------------------------------------------------
 * <rich-text> 只认内联 style（不支持外部样式表 / class 选择器），
 * 而 markdown.js 输出的是纯语义标签。这里统一给标签补深色主题样式，
 * 保持与 xiaoxuan.html 暗色版一致的观感，且不修改 markdown.js 的渲染逻辑。
 *
 * 单位说明：rich-text 的内联样式按 px 解析最稳妥，这里不用 rpx。
 * ============================================================ */
var INLINE = {
  h1: 'font-size:18px;font-weight:700;color:#efe6ff;margin:11px 0 6px;line-height:1.4;',
  h2: 'font-size:16px;font-weight:700;color:#e8dff5;margin:10px 0 5px;line-height:1.4;',
  h3: 'font-size:15px;font-weight:600;color:#d9c9f2;margin:8px 0 4px;line-height:1.4;',
  h4: 'font-size:14px;font-weight:600;color:#cbbbe8;margin:7px 0 4px;',
  h5: 'font-size:13px;font-weight:600;color:#cbbbe8;margin:6px 0 3px;',
  h6: 'font-size:13px;font-weight:600;color:#cbbbe8;margin:6px 0 3px;',
  p: 'margin:4px 0;line-height:1.78;font-size:14px;color:#e3d9f0;',
  li: 'margin:2px 0;line-height:1.7;font-size:14px;color:#e3d9f0;',
  ul: 'padding-left:18px;margin:3px 0;',
  ol: 'padding-left:18px;margin:3px 0;',
  blockquote: 'margin:5px 0;padding:4px 8px;border-left:2px solid rgba(147,112,219,.6);background:rgba(147,112,219,.10);color:#c9bce2;font-size:13px;',
  pre: 'margin:5px 0;padding:8px;background:rgba(0,0,0,.35);border-radius:5px;overflow-x:auto;',
  code: 'font-family:Menlo,Consolas,monospace;font-size:12px;color:#f0d8a8;background:rgba(147,112,219,.16);padding:0 3px;border-radius:3px;',
  hr: 'border:none;border-top:1px solid rgba(147,112,219,.35);margin:8px 0;',
  table: 'border-collapse:collapse;width:100%;margin:5px 0;font-size:12px;',
  th: 'border:1px solid rgba(147,112,219,.35);padding:4px;background:rgba(147,112,219,.18);color:#e8dff5;text-align:left;',
  td: 'border:1px solid rgba(147,112,219,.28);padding:4px;color:#ddd2ee;',
  a: 'color:#a98bff;text-decoration:none;',
  strong: 'font-weight:700;color:#f3ecff;',
  b: 'font-weight:700;color:#f3ecff;',
  em: 'font-style:italic;color:#d9c9f2;',
  i: 'font-style:italic;color:#d9c9f2;'
};

var TAG_RE = /<(h1|h2|h3|h4|h5|h6|p|li|ul|ol|blockquote|pre|code|hr|table|thead|tbody|tr|th|td|a|strong|b|em|i)(\s[^>]*)?>/gi;

/* 咨询记录「深度解读」专用：与 xiaoxuan.html .chat-item-reply 内的标签规则逐条对应
 * （rich-text 不能命中页面选择器，只能把同样的值内联到标签上）。
 * 只写参考页显式声明的属性，未写的（font-size / line-height）由容器继承。 */
var HISTORY_INLINE = {
  h1: 'color:#e8dff5;margin:10px 0 6px;font-weight:700;font-size:15px;',
  h2: 'color:#e8dff5;margin:10px 0 6px;font-weight:700;font-size:14px;border-left:3px solid #b886e0;padding-left:8px;',
  h3: 'color:#c8b8e8;margin:10px 0 6px;font-weight:700;font-size:13px;',
  b: 'color:#ffc0cb;font-weight:700;',
  strong: 'color:#ffc0cb;font-weight:700;',
  ul: 'margin:4px 0;padding-left:18px;',
  ol: 'margin:4px 0;padding-left:18px;',
  li: 'margin:2px 0;',
  hr: 'border:none;border-top:1px solid rgba(180,140,220,.2);margin:10px 0;',
  p: 'margin:4px 0;'
};

var HISTORY_TAG_RE = /<(h1|h2|h3|b|strong|ul|ol|li|hr|p)(\s[^>]*)?>/gi;

function decorateHistory(html) {
  if (!html) return '';
  return String(html).replace(HISTORY_TAG_RE, function (m, tag, attrs) {
    var t = String(tag).toLowerCase();
    var style = HISTORY_INLINE[t];
    if (!style) return m;
    if (t === 'hr') {
      return /style=/i.test(attrs || '') ? m : '<hr style="' + style + '">';
    }
    if (attrs && /style=/i.test(attrs)) return m;
    return '<' + t + (attrs || '') + ' style="' + style + '">';
  });
}

/**
 * 给 markdown 生成的标签补内联样式。
 * - 标签自带 style 时不覆盖（保留 markdown.js 的原意，如动爻高亮）
 */
function decorate(html) {
  if (!html) return '';
  return String(html).replace(TAG_RE, function (m, tag, attrs) {
    var t = String(tag).toLowerCase();
    var style = INLINE[t];
    if (!style) return m;
    if (t === 'hr') {
      return /style=/i.test(attrs || '') ? m : '<hr style="' + style + '">';
    }
    if (attrs && /style=/i.test(attrs)) return m;
    return '<' + t + (attrs || '') + ' style="' + style + '">';
  });
}

module.exports = { decorate: decorate, decorateHistory: decorateHistory };
