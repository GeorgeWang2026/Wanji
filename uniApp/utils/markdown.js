/* ============================================================
 * markdown.js（适配层）—— 复用工程根目录的 markdown.js（网页版 public 库复制件）
 * ------------------------------------------------------------
 * 网页版通过 <script src="/markdown.js"> 把 window.QimenMarkdown 挂到全局；
 * 小程序里用 require 加载同一个文件（先由 window-shim 补好 window 壳），
 * 再从这里统一导出，避免任何页面重复实现 Markdown。
 *
 * 渲染结果直接交给 <rich-text nodes="{{html}}">，因此额外经过 md-rich.js 做
 * 「行内样式补全」（rich-text 不支持外部 class 样式表）。
 * ============================================================ */
var g = require('./window-shim.js');
var rich = require('./md-rich.js');

try {
  require('../../markdown.js');
} catch (e) {
  console.error('[markdown] 加载工程根 markdown.js 失败：', e);
}

var lib = g.QimenMarkdown || (typeof window !== 'undefined' ? window.QimenMarkdown : null);

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallback(md) {
  return escHtml(md).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

/**
 * 对话回复 → rich-text HTML
 * 用 chatMdToHtml 的富文本版（rich:true）：支持表格 / 代码块 / 引用，
 * 与网页版悬浮助手 assistant-widget.js 的渲染分支一致。
 */
function chatHtml(md) {
  if (!md) return '';
  if (lib && typeof lib.chatMdToHtml === 'function') {
    try {
      return rich.decorate(lib.chatMdToHtml(md, { rich: true }));
    } catch (e) {
      console.warn('[markdown] chatMdToHtml 失败，回退纯文本：', e);
    }
  }
  return rich.decorate('<p>' + fallback(md) + '</p>');
}

/**
 * 卦典 Markdown → rich-text HTML
 * 用简版（无折叠卡片）：rich-text 不支持 onclick，折叠交互在小程序里由页面自己实现。
 * @param {string} md 卦典正文
 * @param {number} highlightYao 动爻（1~6），0 表示不高亮
 */
function guaHtml(md, highlightYao) {
  if (!md) return '';
  if (lib && typeof lib.guaMdToHtml === 'function') {
    try {
      return rich.decorate(lib.guaMdToHtml(md, highlightYao || 0));
    } catch (e) {
      console.warn('[markdown] guaMdToHtml 失败，回退纯文本：', e);
    }
  }
  return rich.decorate('<p>' + fallback(md) + '</p>');
}

/**
 * 咨询记录「深度解读」→ rich-text HTML
 * 标签内联样式与 xiaoxuan.html .chat-item-reply 的标签规则一一对应（rich-text 不支持外部选择器）。
 */
function historyHtml(mdText) {
  if (!mdText) return '';
  if (lib && typeof lib.chatMdToHtml === 'function') {
    try {
      return rich.decorateHistory(lib.chatMdToHtml(mdText, { rich: true }));
    } catch (e) {
      console.warn('[markdown] chatMdToHtml 失败，回退纯文本：', e);
    }
  }
  return rich.decorateHistory('<p>' + fallback(mdText) + '</p>');
}

/** 纯文本（用于 TTS 朗读 / 列表摘要） */
function plain(md) {
  return String(md || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*`_~]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

module.exports = {
  available: !!lib,
  chatHtml: chatHtml,
  historyHtml: historyHtml,
  guaHtml: guaHtml,
  plain: plain,
  escHtml: escHtml
};
