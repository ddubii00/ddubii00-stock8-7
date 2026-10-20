import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateThreeLineBreak } from '../public/three-line-break.js';
import { mergeCandleHistory } from '../public/chart-history.js';
const bars = (values, step = 60) => values.map((close, i) => ({time: 1700000000 + i * step, open: close, high: close + 100, low: close - 100, close, volume: 10}));
const bodies = rows => rows.map(({open, close}) => [open, close]);

test('minute, daily and weekly bars obey the same three-close reversal rules in either direction', () => {
  const closes = [100,110,120,130,129,101,100,99,98,97,119,130,131,132];
  const expected = [[100,110],[110,120],[120,130],[120,99],[99,98],[98,97],[98,130],[130,131],[131,132]];
  for (const step of [60,86400,604800]) {
    assert.deepEqual(bodies(calculateThreeLineBreak(bars(closes, step))), expected);
    const mirror = calculateThreeLineBreak(bars(closes.map(value => 300 - value), step));
    assert.deepEqual(bodies(mirror), expected.map(([open,close]) => [300-open,300-close]));
  }
});

test('equal boundaries, intrabar highs/lows and sub-cent rounding never create extra lines', () => {
  const prices = [100,110,120,130,100,100.000000001,99.999999999,99.99];
  assert.deepEqual(bodies(calculateThreeLineBreak(bars(prices), 2)), [[100,110],[110,120],[120,130],[120,99.99]]);
  const ticks = bars([100,110,120,130,100]);
  ticks.at(-1).high = 1000; ticks.at(-1).low = 1;
  assert.equal(calculateThreeLineBreak(ticks).length, 3);
});

test('out-of-order and duplicate source timestamps use the latest correction once', () => {
  const rows = bars([100,110,120,130,99]);
  const expected = calculateThreeLineBreak(bars([100,110,120,130,105]));
  assert.deepEqual(calculateThreeLineBreak([...rows].reverse().concat({...rows.at(-1),close:105})), expected);
  assert.equal(calculateThreeLineBreak([...rows, {time:Infinity,close:9999}]).length, 4);
});

test('rolling source windows preserve the seed and match a full-history calculation', () => {
  const rows = bars([100,110,120,130,129,101,100,99,98,97,119,130,131,132]);
  let history = rows.slice(0, 8);
  for (let end = 9; end <= rows.length; end++) history = mergeCandleHistory(history, rows.slice(end-8,end));
  assert.deepEqual(calculateThreeLineBreak(history), calculateThreeLineBreak(rows));
  assert.equal(history[0].time, rows[0].time);
});

test('corrected or removed candles do not leave phantom reversals in accumulated history', () => {
  const original = bars([100,110,120,130,99]);
  const corrected = mergeCandleHistory(original, [original[2], original[3], {...original[4],close:105}]);
  assert.equal(calculateThreeLineBreak(corrected).length, 3);
  const removed = mergeCandleHistory(original, [original[2], original[3]]);
  assert.equal(removed.length, 4);
  assert.equal(calculateThreeLineBreak(removed).length, 3);
  assert.equal(original.at(-1).close, 99);
  const disjoint = bars([200,210]).map(row => ({...row,time:row.time+10000}));
  assert.deepEqual(mergeCandleHistory(original,disjoint), disjoint);
});
