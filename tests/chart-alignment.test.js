import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCursorGroups, visibleLogicalRange } from '../public/chart-alignment.js';

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

test('cursor groups use left column slots 1/2 and right column slots 3/4; every other layout respects its visible cards', () => {
  const charts = Array.from({ length: 4 }, (_, i) => chart(i, [1, 2, 3 + i]));
  assert.deepEqual(buildCursorGroups(charts, '2x2').map(group => group.members.map(item => item.slotIndex)), [[0, 1], [2, 3]]);
  for (const layout of ['1x3', '3x1']) assert.deepEqual(buildCursorGroups(charts.slice(0, 3), layout)[0].members.map(item => item.slotIndex), [0, 1, 2]);
  assert.equal(buildCursorGroups(charts.slice(0, 1), '1x1').length, 0);
  assert.deepEqual(buildCursorGroups(charts.slice(0, 2), '2x1')[0].members.map(item => item.slotIndex), [0, 1]);
  assert.deepEqual(buildCursorGroups(charts.map(item => ({ ...item, slotIndex: item.slotIndex + 4 })), '2x2').map(group => group.members.map(item => item.slotIndex)), [[4, 5], [6, 7]]);
});

test('changing the bottom-right bar count or timeframe cannot change the top-right viewport', () => {
  const top = chart(2, Array.from({ length: 700 }, (_, i) => i * 60));
  const bottom = chart(3, Array.from({ length: 700 }, (_, i) => i * 60));
  const original = visibleLogicalRange(top.rows.length, top.limit);
  assert.equal(buildCursorGroups([top, bottom]).length, 1);
  bottom.limit = 80;
  assert.equal(buildCursorGroups([top, bottom]).length, 0);
  assert.deepEqual(visibleLogicalRange(top.rows.length, top.limit), original);
  assert.equal(bottom.rows.length - visibleLogicalRange(bottom.rows.length, bottom.limit).from, 80);
  bottom.limit = 400; bottom.interval = '1d';
  assert.equal(buildCursorGroups([top, bottom]).length, 0);
  assert.deepEqual(visibleLogicalRange(top.rows.length, top.limit), original);
  assert.deepEqual(visibleLogicalRange(30, 400), { from: 0, to: 31 });
  assert.equal(visibleLogicalRange(0, 400), null);
});
