import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCursorGroups, cursorTimeForChart, cursorTimeForLineBreak, visibleLogicalRange } from '../public/chart-alignment.js';

const chart = (slotIndex, times, extra = {}) => ({ slotIndex, interval: '1m', limit: 400, rows: times.map(time => ({ time, open: 100, high: 101, low: 99, close: 100 })), ...extra });

test('400 means 400 real bars for each chart, including missing minutes and extended-session history', () => {
  const times = Array.from({ length: 750 }, (_, i) => i * 60);
  const a = chart(2, times.filter((_, i) => i % 29 !== 0).slice(-700));
  const b = chart(3, times.filter((_, i) => i % 31 !== 0).slice(-700));
  const original = JSON.stringify([a.rows, b.rows]);
  buildCursorGroups([a, b]);
  for (const state of [a, b]) {
    const range = visibleLogicalRange(state.rows.length, state.limit);
    const actualBars = state.rows.filter((_, index) => index >= range.from && index <= range.to);
    assert.equal(actualBars.length, 400);
    assert.deepEqual(actualBars, state.rows.slice(-400));
  }
  assert.equal(JSON.stringify([a.rows, b.rows]), original);
  assert.equal(620 - visibleLogicalRange(620, 400).from, 400);
});

test('all visible charts share cursor time in every layout, including both 2x2 columns', () => {
  const charts = Array.from({ length: 4 }, (_, i) => chart(i, [1, 2, 3 + i]));
  assert.deepEqual(buildCursorGroups(charts, '2x2').map(group => group.members.map(item => item.slotIndex)), [[0, 1, 2, 3]]);
  for (const layout of ['1x3', '3x1']) assert.deepEqual(buildCursorGroups(charts.slice(0, 3), layout)[0].members.map(item => item.slotIndex), [0, 1, 2]);
  assert.equal(buildCursorGroups(charts.slice(0, 1), '1x1').length, 0);
  for (const layout of ['2x1', '1x2']) assert.deepEqual(buildCursorGroups(charts.slice(0, 2), layout)[0].members.map(item => item.slotIndex), [0, 1]);
  assert.deepEqual(buildCursorGroups(charts.map(item => ({ ...item, slotIndex: item.slotIndex + 4 })), '2x2').map(group => group.members.map(item => item.slotIndex)), [[4, 5, 6, 7]]);
});

test('changing the bottom-right bar count or timeframe cannot change the top-right viewport', () => {
  const top = chart(2, Array.from({ length: 700 }, (_, i) => i * 60));
  const bottom = chart(3, Array.from({ length: 700 }, (_, i) => i * 60));
  const original = visibleLogicalRange(top.rows.length, top.limit);
  assert.equal(buildCursorGroups([top, bottom]).length, 1);
  bottom.limit = 80;
  assert.equal(buildCursorGroups([top, bottom]).length, 1);
  assert.deepEqual(visibleLogicalRange(top.rows.length, top.limit), original);
  assert.equal(bottom.rows.length - visibleLogicalRange(bottom.rows.length, bottom.limit).from, 80);
  bottom.limit = 400; bottom.interval = '1d';
  assert.equal(buildCursorGroups([top, bottom]).length, 1);
  assert.deepEqual(visibleLogicalRange(top.rows.length, top.limit), original);
  assert.deepEqual(visibleLogicalRange(30, 400), { from: 0, to: 31 });
  assert.equal(visibleLogicalRange(0, 400), null);
});

test('one-minute 14:30 and 14:31 cursors map to the target five-minute 14:30 candle without changing its view', () => {
  const time = Date.parse('2026-10-20T05:30:00Z') / 1000; // 14:30 KST
  const source = chart(0, [time, time + 60, time + 120]);
  const target = chart(1, [time - 300, time, time + 300], { interval: '5m', limit: 120 });
  const view = visibleLogicalRange(target.rows.length, target.limit);
  assert.equal(buildCursorGroups([source, target]).length, 1);
  assert.equal(cursorTimeForChart(target.rows, '5m', time), time);
  assert.equal(cursorTimeForChart(target.rows, '5m', time + 60), time);
  assert.equal(cursorTimeForChart(target.rows, '5m', time + 299), time);
  assert.equal(cursorTimeForChart(target.rows, '5m', time + 300), time + 300);
  assert.equal(cursorTimeForChart(source.rows, '1m', time), time);
  assert.deepEqual(visibleLogicalRange(target.rows.length, target.limit), view);
});

test('cursor matching does not bridge a session gap or point at a nonexistent candle', () => {
  const rows = [{ time: 0 }, { time: 300 }, { time: 86400 }];
  assert.equal(cursorTimeForChart(rows, '5m', -1), null);
  assert.equal(cursorTimeForChart(rows, '5m', 600), null);
  assert.equal(cursorTimeForChart(rows, '5m', 86400 + 300), null);
  assert.equal(cursorTimeForChart([{time: 0}, {time: 86400}], '1d', 172800), null);
  assert.equal(cursorTimeForChart(rows, '1d', 86400), 86400);
  assert.equal(cursorTimeForChart([], '5m', 300), null);
});


test('intraday cursors select the corresponding daily, weekly and monthly trading-date bar', () => {
  const source = Date.parse('2026-10-20T14:31:00+09:00') / 1000;
  const daily = Date.parse('2026-10-20T00:00:00Z') / 1000;
  const weekly = Date.parse('2026-10-19T00:00:00Z') / 1000;
  const monthly = Date.parse('2026-10-01T00:00:00Z') / 1000;
  for (const [interval, time] of [['1d', daily], ['1wk', weekly], ['1mo', monthly]]) {
    assert.equal(cursorTimeForChart([{time}], interval, source, 'Asia/Seoul'), time);
  }
  assert.equal(cursorTimeForChart([{time: daily - 86400}], '1d', source, 'Asia/Seoul'), null);
  const usOpen = Date.parse('2026-10-20T13:30:00Z') / 1000;
  const usPremarket = Date.parse('2026-10-20T12:00:00Z') / 1000;
  assert.equal(cursorTimeForChart([{time: usOpen}], '1d', usPremarket, 'America/New_York'), usOpen);
});

test('paired line-break cursor uses the box active at the candle time, including the latest unfinished interval', () => {
  const time = value => Date.parse(`2026-10-21T${value}:00+09:00`) / 1000;
  const rows = ['09:00', '09:50', '10:10'].map(value => ({ time: time(value) }));
  const original = structuredClone(rows);
  assert.equal(cursorTimeForLineBreak(rows.slice(0, 2), time('10:03')), time('09:50'));
  assert.equal(cursorTimeForLineBreak(rows, time('10:03')), time('09:50'));
  assert.equal(cursorTimeForLineBreak(rows, time('10:09')), time('09:50')); // No jump to a future box.
  assert.equal(cursorTimeForLineBreak(rows, time('10:10')), time('10:10'));
  assert.equal(cursorTimeForLineBreak(rows, time('09:50')), time('09:50'));
  assert.equal(cursorTimeForLineBreak(rows, time('08:59')), null);
  assert.equal(cursorTimeForLineBreak([], time('10:03')), null);
  assert.equal(cursorTimeForLineBreak(rows, NaN), null);
  assert.deepEqual(rows, original);
});
