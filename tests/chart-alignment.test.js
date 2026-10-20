import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeAlignments } from '../public/chart-alignment.js';
import { logicalAtTime, timeAtLogical } from '../public/trend-geometry.js';

const chart = (slotIndex, times, extra = {}) => ({ slotIndex, interval: '1m', limit: 400, visibleLimit: 400, rows: times.map(time => ({ time, open: 100, high: 101, low: 99, close: 100 })), ...extra });

test('400 candles with different missing minutes share the same 09:00 position while retaining every real candle', () => {
  const nine = Date.parse('2026-10-20T00:00:00Z') / 1000;
  const times = Array.from({ length: 625 }, (_, i) => nine + (i - 300) * 60);
  const top = chart(0, times.filter((_, i) => i % 29 !== 0).slice(-700));
  const bottom = chart(2, times.filter((_, i) => i % 31 !== 0).slice(-700));
  const originals = JSON.stringify([top.rows, bottom.rows]);
  const [group] = buildTimeAlignments([top, bottom]);
  assert.equal(JSON.stringify([top.rows, bottom.rows]), originals);
  assert.ok(group.timeline.every(row => Object.keys(row).join() === 'time'));
  for (const state of [top, bottom]) for (const row of state.rows.slice(-400)) assert.ok(group.timeline.slice(group.range.from).some(point => point.time === row.time));
  const index = logicalAtTime(group.timeline, nine);
  assert.ok(Number.isFinite(index)); assert.equal(timeAtLogical(group.timeline, index), nine);
  assert.ok(index >= group.range.from && index <= group.range.to);
  assert.equal(logicalAtTime(group.timeline, top.rows.at(-1).time), logicalAtTime(group.timeline, bottom.rows.at(-1).time));
});

test('2x2 synchronizes matching top/bottom pairs; 1x3 and 3x1 synchronize all three matching charts', () => {
  const charts = Array.from({ length: 4 }, (_, i) => chart(i, [1, 2, 3 + i]));
  assert.deepEqual(buildTimeAlignments(charts, '2x2').map(group => group.members.map(item => item.slotIndex)), [[0, 2], [1, 3]]);
  for (const layout of ['1x3', '3x1']) assert.deepEqual(buildTimeAlignments(charts.slice(0, 3), layout)[0].members.map(item => item.slotIndex), [0, 1, 2]);
  assert.equal(buildTimeAlignments([chart(0, [1]), chart(2, [1], { limit: 200 })]).length, 0);
  assert.equal(buildTimeAlignments([chart(0, [1]), chart(2, [1], { interval: '1d' })]).length, 0);
});

test('daily gaps, independent warmup lengths and trend anchors use the common timeline without changing prices', () => {
  const a = chart(0, [10, 20, 40, 50], { interval: '1d', limit: 3, visibleLimit: 3 });
  const b = chart(2, [20, 30, 40, 50], { interval: '1d', limit: 3, visibleLimit: 3 });
  const [group] = buildTimeAlignments([a, b]);
  assert.deepEqual(group.timeline, [10, 20, 30, 40, 50].map(time => ({ time })));
  assert.equal(group.range.from, 1); assert.equal(group.range.to, 6);
  assert.equal(logicalAtTime(group.timeline, 40), 3);
  assert.equal(timeAtLogical(group.timeline, 3), 40);
  assert.notEqual(logicalAtTime(a.rows, 40), logicalAtTime(group.timeline, 40));
});
