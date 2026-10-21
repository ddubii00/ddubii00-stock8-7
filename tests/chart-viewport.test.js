import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureViewport, refreshedViewport } from '../public/chart-viewport.js';

const rows = (start, count, step = 60) => Array.from({ length: count }, (_, i) => ({ time: start + i * step, close: 100 }));
const snapshot = (data, range) => captureViewport({ getVisibleLogicalRange: () => range }, data);

test('live price ticks preserve a historical pan and zoom on every timeframe', () => {
  for (const step of [60, 300, 86400, 604800]) {
    const before = rows(0, 400, step);
    const range = { from: 45.25, to: 145.75 };
    const view = snapshot(before, range);
    assert.equal(view.following, false);
    const next = structuredClone(before); next.at(-1).close = 101;
    assert.deepEqual(refreshedViewport(before, next, view, false, 400), range);
  }
});

test('rolling candle histories stay anchored to timestamps instead of shifted logical indices', () => {
  const before = rows(0, 400), after = rows(60, 400);
  const range = { from: 45.25, to: 145.75 };
  const result = refreshedViewport(before, after, snapshot(before, range), false, 400);
  assert.deepEqual(result, { from: 44.25, to: 144.75 });
  assert.equal(before[Math.ceil(range.from)].time, after[Math.ceil(result.from)].time);
  assert.equal(result.to - result.from, range.to - range.from);
});

test('line-break history additions and corrected reversals preserve the historical anchor', () => {
  const before = rows(0, 200, 300), range = { from: 60.5, to: 100.5 };
  const appended = [...before, { time: 60000 }];
  assert.deepEqual(refreshedViewport(before, appended, snapshot(before, range), false, 60), range);
  const prepended = [{ time: -300 }, ...before];
  assert.deepEqual(refreshedViewport(before, prepended, snapshot(before, range), false, 60), { from: 61.5, to: 101.5 });
  const corrected = before.filter((_, i) => i !== 10);
  assert.deepEqual(refreshedViewport(before, corrected, snapshot(before, range), false, 60), { from: 59.5, to: 99.5 });
});

test('live-follow keeps its zoom and right margin when a new candle or line-break box arrives', () => {
  const before = rows(0, 400), range = { from: 300.5, to: 401 };
  assert.equal(snapshot(before, range).following, true);
  assert.deepEqual(refreshedViewport(before, rows(0, 401), snapshot(before, range), false, 400), { from: 301.5, to: 402 });
  assert.deepEqual(refreshedViewport(before, rows(60, 400), snapshot(before, range), false, 400), range);
  const panned = { from: 299, to: 400 };
  assert.equal(snapshot(before, panned).following, false); // Even a small deliberate pan stays put.
});

test('explicit chart setting changes fit the requested count while blank charts remain safe', () => {
  const before = rows(0, 400), range = { from: 45, to: 145 };
  assert.deepEqual(refreshedViewport(before, before, snapshot(before, range), true, 120), { from: 280, to: 401 });
  assert.deepEqual(refreshedViewport([], rows(0, 30), snapshot([], null), true, 400), { from: 0, to: 31 });
  assert.equal(refreshedViewport([], [], snapshot([], null), true, 400), null);
});
