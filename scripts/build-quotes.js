/**
 * 把金句源文件转成小程序可 require 的数据文件。
 * 用法：node scripts/build-quotes.js [--src design/quotes.md] [--out uniApp/data/quotes.js]
 *       默认生成主力池 design/quotes.md → uniApp/data/quotes.js；
 *       证券条件池：node scripts/build-quotes.js --src design/quotes-stock.md --out uniApp/data/quotes-stock.js
 * 源文件是唯一真源；解析失败时以非 0 退出且不覆盖旧产物。
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DEFAULT_SRC = 'design/quotes.md';
var DEFAULT_OUT = 'uniApp/data/quotes.js';

function argValue(name, def) {
  var args = process.argv.slice(2);
  for (var i = 0; i < args.length; i++) {
    var m = new RegExp('^' + name + '=(.+)$').exec(args[i]);
    if (m) return m[1];
    if (args[i] === name && args[i + 1] && args[i + 1].indexOf('--') !== 0) return args[i + 1];
  }
  return def;
}

var SRC = path.resolve(ROOT, argValue('--src', DEFAULT_SRC));
var OUT = path.resolve(ROOT, argValue('--out', DEFAULT_OUT));
var LANGS = ['zh', 'en', 'la', 'fr'];

function fail(msg) {
  console.error('[quotes] ' + msg);
  process.exitCode = 1;
}

if (!fs.existsSync(SRC)) {
  fail('找不到源文件 ' + SRC);
  return;
}

var lines = fs.readFileSync(SRC, 'utf8').replace(/\r\n?/g, '\n').split('\n');
var items = [];
var cur = null;
var errors = [];
var inComment = false;

lines.forEach(function (raw, i) {
  var line = raw.trim();
  if (inComment) {
    if (line.indexOf('-->') >= 0) inComment = false;
    return;
  }
  if (!line) return;
  if (line.indexOf('<!--') === 0) {
    if (line.indexOf('-->') < 0) inComment = true;
    return;
  }
  if (line.indexOf('## ') === 0) {
    cur = { title: line.slice(3).trim(), line: i + 1 };
    items.push(cur);
    return;
  }
  if (line.indexOf('#') === 0) return;
  if (!cur) return;
  var m = /^-\s*([A-Za-z_]+)\s*:\s*(.+)$/.exec(line);
  if (!m) {
    errors.push('第 ' + (i + 1) + ' 行格式不对（应为 - key: value）：' + line);
    return;
  }
  cur[m[1].toLowerCase()] = m[2].trim();
});

if (!items.length) {
  fail('没有解析到任何条目，文件需以「## 标题」开始每条');
  return;
}

var out = items.map(function (it, idx) {
  var n = idx + 1;
  if (!it.text || !it.author || !it.lang) {
    errors.push('第 ' + n + ' 条（' + (it.title || '无标题') + '）缺少 text/author/lang');
    return null;
  }
  if (LANGS.indexOf(it.lang.toLowerCase()) < 0) {
    errors.push('第 ' + n + ' 条 lang 非法：' + it.lang + '（可用 zh/en/la/fr）');
    return null;
  }
  var lang = it.lang.toLowerCase();
  if (lang !== 'zh' && !it.translation) {
    errors.push('第 ' + n + ' 条是外文，必须写 translation（仅文字显示，不播）');
    return null;
  }
  return {
    text: it.text,
    translation: it.translation || '',
    speech: it.text,
    author: it.author,
    lang: lang
  };
}).filter(Boolean);

if (errors.length) {
  errors.forEach(function (e) { console.error('[quotes] ' + e); });
  fail('共 ' + errors.length + ' 处错误，未生成新文件（旧文件保留）');
  return;
}

var relSrc = path.relative(ROOT, SRC).split(path.sep).join('/');
var relOut = path.relative(ROOT, OUT).split(path.sep).join('/');
var regen = 'node scripts/build-quotes.js';
if (relSrc !== DEFAULT_SRC || relOut !== DEFAULT_OUT) {
  regen += ' --src ' + relSrc + ' --out ' + relOut;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  '// 自动生成，请勿手改。源文件：' + relSrc + '；重新生成：' + regen + '\n'
    + 'module.exports = ' + JSON.stringify(out, null, 2) + ';\n',
  'utf8'
);
console.log('[quotes] 已生成 ' + OUT + '，共 ' + out.length + ' 条');
