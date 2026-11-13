/* ============================================================
 * DF-82：奇门 / 梅花 时间栏共用参数（同源，禁止两份分别维护）
 * 提供：年份范围、月/日/时/分选项、两位补零、时间归一化与钳制
 * 现行口径：年份 1900-2100；分 0-59；「两位补零」统一走 p2
 * ============================================================ */

function p2(n) { return n < 10 ? '0' + n : '' + n; }

/** 当月天数（m 为 1-12） */
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

/** 年份下拉范围 1900-2100 */
function yearRange() {
  var arr = [];
  for (var y = 1900; y <= 2100; y++) arr.push(String(y));
  return arr;
}

/** 月选项：01-12 */
function monthOptions() {
  var arr = [];
  for (var i = 1; i <= 12; i++) arr.push(p2(i));
  return arr;
}

/** 日选项：01-当月天数（随年月联动，不出现非法日期） */
function dayOptions(y, m) {
  var arr = [];
  var dim = daysInMonth(y, m);
  for (var i = 1; i <= dim; i++) arr.push(p2(i));
  return arr;
}

/**
 * 归一化时间：分缺失 / 非数字 / NaN → 0，越界钳制 0-59；日按当月天数钳制；
 * 时钳制 0-23。返回 { y, m, d, h, mi, clampedDay }（clampedDay 表示日被月末钳制）
 */
function normalize(t) {
  t = t || {};
  var y = Number(t.y);
  var m = Number(t.m);
  var d = Number(t.d);
  var h = Number(t.h);
  var mi = Number(t.mi);
  if (!y) y = 1900;
  if (!m || m < 1) m = 1;
  if (m > 12) m = 12;
  var dim = daysInMonth(y, m);
  var clampedDay = false;
  if (!d || d < 1) d = 1;
  if (d > dim) { d = dim; clampedDay = true; }
  if (!h || h < 0) h = 0;
  if (h > 23) h = 23;
  if (isNaN(mi)) mi = 0;
  mi = Math.floor(mi);
  if (mi < 0) mi = 0;
  if (mi > 59) mi = 59;
  return { y: y, m: m, d: d, h: h, mi: mi, clampedDay: clampedDay };
}

module.exports = {
  p2: p2,
  daysInMonth: daysInMonth,
  yearRange: yearRange,
  monthOptions: monthOptions,
  dayOptions: dayOptions,
  normalize: normalize
};
