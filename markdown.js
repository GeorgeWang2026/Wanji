/* ============================================================
 * markdown.js — 万机前端 Markdown → HTML 唯一实现（单一数据源）
 * 供 paipan-modal.js / analysis.html / xiaoxuan.html / assistant-widget.js 共用，
 * 消除原先 5 份各写一套的渲染器（报告·中度 17）。
 *
 * 对外暴露 window.QimenMarkdown：
 *   guaMdToHtml(md, highlightYao, opts)  卦典渲染
 *       opts.yaoCards=true → analysis 的「爻详解折叠卡片」增强版（默认 false = 简版）
 *   chatMdToHtml(md, opts)               对话回复渲染
 *       opts.rich=false → xiaoxuan 暗色简版（默认 true = 悬浮助手富文本版）
 *
 * 各分支均逐字节复刻原实现，调用方仅做等价委托，渲染输出不变。
 * ============================================================ */
"use strict";
(function (global) {
  /* ---------------- 统一转义（先转义再渲染：模型输出里的原始 HTML 一律当文本） ---------------- */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------- 卦典 · 简版（原 paipan-modal.mhMdToHtml / xiaoxuan._mhMdToHtml） ---------------- */
  function guaInlineSimple(s) {
    if (!s) return '';
    s = escHtml(s);
    s = s.replace(/\*\*([^*]+)\*\*\s*[：:]/g, '<b>$1</b>：');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return s;
  }

  function guaSimple(md, highlightYao) {
    if (!md) return '';
    md = md.replace(/★★★\s*/g, '');
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let inOl = false;
    lines.forEach(function (raw) {
      const line = raw.trim();
      if (!line) { if (inOl) { html += '</ol>'; inOl = false; } return; }
      if (line.startsWith('## ')) { if (inOl) { html += '</ol>'; inOl = false; } html += '<h2>' + guaInlineSimple(line.slice(3)) + '</h2>'; return; }
      const olMatch = line.match(/^(\d+)\.\s+(.*)/);
      if (olMatch) {
        if (!inOl) { html += '<ol>'; inOl = true; }
        let content = olMatch[2];
        const curYao = parseInt(olMatch[1], 10);
        if (highlightYao > 0 && curYao === highlightYao) content = '<span style="color:#ff8888;font-weight:700;">🔥 动爻 · </span>' + content;
        content = guaInlineSimple(content);
        html += '<li>' + content + '</li>';
        return;
      }
      if (inOl) { html += '</ol>'; inOl = false; }
      html += '<p>' + guaInlineSimple(line) + '</p>';
    });
    if (inOl) html += '</ol>';
    return html;
  }

  /* ---------------- 卦典 · 增强版（原 analysis.mdToHtml，爻详解折叠卡片） ---------------- */
  function guaInlineRich(s) {
    if (!s) return "";
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // 先处理整行的 **key**：value 模式
    s = s.replace(/\*\*([^*]+)\*\*\s*[：:]/g, '<b style="color:#7a3b1d;">$1</b>：');
    // 再处理剩余的 **加粗**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return s;
  }

  function guaRenderBlock(lines, highlightYao) {
    let html = "";
    let inList = false, openLi = false, liCount = 0;
    const closeLi = () => { if (openLi) { html += '</li>'; openLi = false; } };
    const openList = () => { if (!inList) { html += '<ol style="padding-left:20px;margin:6px 0;">'; inList = true; } };
    const closeList = () => { closeLi(); if (inList) { html += '</ol>'; inList = false; liCount = 0; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const trimmed = l.trim();
      if (/^##\s+/.test(trimmed)) {
        closeList();
        const t = trimmed.replace(/^##\s+/, "").replace(/^【|】$/g, "").trim();
        html += '<div style="font-size:17px;font-weight:700;color:#7a3b1d;margin:16px 0 8px;padding-left:10px;border-left:3px solid #b8860b;letter-spacing:0.5px;">' + guaInlineRich(t) + '</div>';
        continue;
      }
      if (/^###\s+/.test(trimmed)) {
        closeList();
        html += '<div style="font-size:15px;font-weight:600;color:#7a3b1d;margin:12px 0 6px;">' + guaInlineRich(trimmed.replace(/^###\s+/, "")) + '</div>';
        continue;
      }
      if (/^\s*\d+\.\s+/.test(l)) {
        closeLi();
        openList();
        liCount++;
        const content = l.replace(/^\s*\d+\.\s+/, "");
        const isHighlight = (highlightYao === liCount);
        const liStyle = isHighlight ? 'margin:4px 0;background:#fff7e6;padding:3px 8px;border-radius:6px;border:1.5px solid #b8860b;font-weight:600;' : 'margin:4px 0;font-size:14px;';
        html += '<li style="' + liStyle + '">' + guaInlineRich(content);
        if (isHighlight) html += ' <span style="color:#b8860b;">★★★ 动爻</span>';
        openLi = true;
        continue;
      }
      if (openLi && /^\s{4,}/.test(l)) {
        html += '<div style="margin:2px 0 2px 14px;line-height:1.9;font-size:12.5px;color:#5b4a2d;">' + guaInlineRich(trimmed) + '</div>';
        continue;
      }
      if (!trimmed) { closeList(); continue; }
      closeList();
      if (/^\*\*[^*]+\*\*[：:]/.test(trimmed)) {
        const m = trimmed.match(/^\*\*([^*]+)\*\*[：:]\s*(.*)$/);
        if (m) {
          html += '<div style="font-size:14px;color:#7a3b1d;font-weight:600;margin:8px 0 2px;">' + '<b>' + escHtml(m[1]) + '</b>' + '</div>';
          if (m[2]) html += '<div style="font-size:13px;margin:2px 0 6px;line-height:1.9;color:#3b2f1d;">' + guaInlineRich(m[2]) + '</div>';
          continue;
        }
      }
      html += '<div style="margin:4px 0;line-height:1.9;font-size:13px;color:#3b2f1d;">' + guaInlineRich(trimmed) + '</div>';
    }
    closeList();
    return html;
  }

  function guaRich(md, highlightYao) {
    if (!md) return "";
    md = md.replace(/★★★\s*/g, "");
    const rawLines = md.replace(/\r\n/g, "\n").split("\n");

    // ===== 阶段一：按 ### 分割成块（非爻块 / 爻详解块）=====
    const blocks = [];
    let curType = "top"; // "top"（总览区）| "yao"（某爻详解）
    let curLines = [];
    let yaoIdx = 0;
    for (const l of rawLines) {
      const t = l.trim();
      if (/^###\s+/.test(t) && (/爻详解|爻辞/.test(t))) {
        // 遇到新爻 → 保存前块、开新块
        if (curLines.length) blocks.push({ type: curType, lines: curLines });
        curType = "yao";
        curLines = [l];
        yaoIdx++;
      } else if (/^###\s+/.test(t)) {
        // 非爻的 ### → 归到 top 块
        curLines.push(l);
      } else {
        curLines.push(l);
      }
    }
    if (curLines.length) blocks.push({ type: curType, lines: curLines });

    // ===== 阶段二：每块独立渲染 =====
    let html = "";
    blocks.forEach((bk, bi) => {
      const inner = guaRenderBlock(bk.lines, highlightYao);
      if (bk.type === "yao") {
        // 爻详解 → 折叠卡片
        const isFirstYao = (bi === 1); // 第一个爻默认展开
        const headerMatch = bk.lines[0].match(/^###\s+(.+)$/);
        const headerText = headerMatch ? headerMatch[1] : "爻详解";
        const hYao = yaoIdx; // 递增计数器
        const isHighlight = highlightYao === hYao;
        const highlightBar = isHighlight ? '<span style="display:inline-block;width:6px;height:16px;background:#b8860b;margin-right:6px;border-radius:3px;"></span>' : '<span style="display:inline-block;width:6px;height:16px;background:#d8ccb0;margin-right:6px;border-radius:3px;"></span>';
        const starMark = isHighlight ? ' <span style="color:#b8860b;font-size:11px;">★ 动爻</span>' : '';
        const arrow = isFirstYao ? '▼' : '▶';
        html += `<div class="yao-block" data-yao="${hYao}" style="margin:6px 0;border:1px solid #e3d7bd;border-radius:8px;overflow:hidden;background:#fffaf0;">
        <div class="yao-head" onclick="(function(el){var parent=el.closest('.guaMdContent')||document;parent.querySelectorAll('.yao-block.open').forEach(b=>{if(b!==el.parentElement){b.classList.remove('open');b.querySelector('.yao-body').style.display='none';b.querySelector('.yao-arrow').textContent='▶';}});var body=el.nextElementSibling;var arrow=el.querySelector('.yao-arrow');var isOpen=el.parentElement.classList.toggle('open');body.style.display=isOpen?'block':'none';arrow.textContent=isOpen?'▼':'▶';})(this)" style="display:flex;align-items:center;gap:6px;padding:10px 14px;cursor:pointer;background:${isHighlight ? '#fff7e6' : '#faf3e6'};user-select:none;">
          ${highlightBar}
          <span class="yao-arrow" style="font-size:10px;color:#8a7a5f;width:14px;text-align:center;">${arrow}</span>
          <span style="font-size:14px;font-weight:600;color:#7a3b1d;">${escHtml(headerText)}${starMark}</span>
        </div>
        <div class="yao-body" style="display:${isFirstYao ? 'block' : 'none'};padding:12px 14px;border-top:1px solid #e3d7bd;">
          ${inner}
        </div>
      </div>`;
      } else {
        html += inner;
      }
    });
    return html;
  }

  function guaMdToHtml(md, highlightYao, opts) {
    opts = opts || {};
    return opts.yaoCards ? guaRich(md, highlightYao) : guaSimple(md, highlightYao);
  }

  /* ---------------- 对话 · 暗色简版（原 xiaoxuan._chatMdToHtml） ---------------- */
  function chatInlineDark(s) {
    if (!s) return '';
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(147,112,219,.15);padding:0 4px;border-radius:3px;font-size:11px;">$1</code>');
    return s;
  }

  function chatDark(md) {
    if (!md) return '';
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let lines = md.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let inOl = false, inUl = false;
    const closeLists = () => { if (inOl) { html += '</ol>'; inOl = false; } if (inUl) { html += '</ul>'; inUl = false; } };

    lines.forEach(raw => {
      let line = raw.trimEnd();
      let trimmed = line.trim();
      if (!trimmed) { closeLists(); return; }

      // ## 二级标题
      if (/^##\s+/.test(trimmed)) { closeLists(); html += `<h2>${esc(trimmed.slice(3))}</h2>`; return; }
      // ### 三级标题
      if (/^###\s+/.test(trimmed)) { closeLists(); html += `<h3>${esc(trimmed.slice(4))}</h3>`; return; }
      // # 一级标题
      if (/^#\s+/.test(trimmed)) { closeLists(); html += `<h1>${esc(trimmed.slice(2))}</h1>`; return; }
      // --- / *** 分隔线
      if (/^[-*]{3,}$/.test(trimmed)) { closeLists(); html += '<hr>'; return; }
      // 有序列表
      const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (olMatch) {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (!inOl) { html += '<ol>'; inOl = true; }
        html += `<li>${chatInlineDark(esc(olMatch[2]))}</li>`;
        return;
      }
      // 无序列表
      const ulMatch = trimmed.match(/^[-•*]\s+(.*)/);
      if (ulMatch) {
        if (inOl) { html += '</ol>'; inOl = false; }
        if (!inUl) { html += '<ul>'; inUl = true; }
        html += `<li>${chatInlineDark(esc(ulMatch[1]))}</li>`;
        return;
      }
      // 普通段落
      closeLists();
      html += `<p>${chatInlineDark(esc(line))}</p>`;
    });
    closeLists();
    return html;
  }

  /* ---------------- 对话 · 富文本版（原 assistant-widget.mdToHtml） ---------------- */
  function mdEscapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function mdInline(s) {
    let t = mdEscapeHtml(s);
    // 链接 [文字](url)
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // 粗体
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体（单个 *，不碰列表符）
    t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    // 行内代码
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    return t;
  }
  function mdSplitRow(r) {
    let s = String(r).trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  }
  function mdTableHTML(tab) {
    const rows = tab.split('\n').filter(r => r.trim() !== '');
    if (rows.length < 2) return mdEscapeHtml(tab);
    const th = mdSplitRow(rows[0]);
    const body = rows.slice(2);
    let h = '<table><thead><tr>' + th.map(c => '<th>' + mdInline(c) + '</th>').join('') + '</tr></thead><tbody>';
    h += body.map(r => '<tr>' + mdSplitRow(r).map(c => '<td>' + mdInline(c) + '</td>').join('') + '</tr>').join('');
    h += '</tbody></table>';
    return h;
  }

  function chatRich(text) {
    if (!text) return '';
    let src = String(text);
    const codeBlocks = [];
    src = src.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, function (m, code) {
      codeBlocks.push(code.replace(/^\n+|\s+$/g, ''));
      return '\u0000CODE' + (codeBlocks.length - 1) + '\u0000';
    });
    const tables = [];
    src = src.replace(/(^|\n)(\|[^\n]+\|\n\|[\s:|-]+\|\n(?:\|[^\n]*\|\n?)+)/g, function (m, nl, tab) {
      tables.push(mdTableHTML(tab));
      return nl + '\u0000TABLE' + (tables.length - 1) + '\u0000';
    });
    const lines = src.split(/\r?\n/);
    let html = '', inList = false, listType = '';
    const closeList = () => { if (inList) { html += listType === 'ol' ? '</ol>' : '</ul>'; inList = false; } };
    let para = [];
    const flushPara = () => { if (para.length) { html += '<p>' + para.map(mdInline).join('<br>') + '</p>'; para = []; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let ph = line.match(/^\u0000(CODE|TABLE)(\d+)\u0000$/);
      if (ph) {
        flushPara(); closeList();
        const i = +ph[2];
        html += (ph[1] === 'CODE') ? ('<pre><code>' + mdEscapeHtml(codeBlocks[i]) + '</code></pre>') : tables[i];
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flushPara(); closeList(); const lvl = Math.min(h[1].length, 4); html += '<h' + lvl + '>' + mdInline(h[2]) + '</h' + lvl + '>'; continue; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; continue; }
      if (/^\s*>\s?/.test(line)) { flushPara(); closeList(); html += '<blockquote>' + mdInline(line.replace(/^\s*>\s?/, '')) + '</blockquote>'; continue; }
      const ul = line.match(/^\s*[-*•]\s+(.*)$/);
      if (ul) { flushPara(); if (!inList || listType !== 'ul') { closeList(); html += '<ul>'; inList = true; listType = 'ul'; } html += '<li>' + mdInline(ul[1]) + '</li>'; continue; }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) { flushPara(); if (!inList || listType !== 'ol') { closeList(); html += '<ol>'; inList = true; listType = 'ol'; } html += '<li>' + mdInline(ol[1]) + '</li>'; continue; }
      if (/^\s*$/.test(line)) { flushPara(); closeList(); continue; }
      para.push(line);
    }
    flushPara(); closeList();
    html = html.replace(/\u0000CODE(\d+)\u0000/g, function (m, i) { return '<pre><code>' + mdEscapeHtml(codeBlocks[+i]) + '</code></pre>'; });
    html = html.replace(/\u0000TABLE(\d+)\u0000/g, function (m, i) { return tables[+i]; });
    return html;
  }

  function chatMdToHtml(md, opts) {
    opts = opts || {};
    return opts.rich === false ? chatDark(md) : chatRich(md);
  }

  global.QimenMarkdown = { guaMdToHtml: guaMdToHtml, chatMdToHtml: chatMdToHtml };
})(typeof window !== "undefined" && window ? window : (typeof globalThis !== "undefined" ? globalThis : {}));
