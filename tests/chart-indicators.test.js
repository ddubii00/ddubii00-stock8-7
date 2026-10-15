import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcSma, calcBollinger, setWeekly } from '../public/chart-indicators.js';
import { calculateThreeLineBreak } from '../public/three-line-break.js';

const bars = (values) => values.map((close, i) => ({ time: 1000 + i * 60, open: close - 1, high: close + 20, low: close - 20, close, volume: 10 }));

test('200-period SMA starts at the 200th bar and rolls forward', () => {
  const rows = bars(Array.from({ length: 205 }, (_, i) => i + 1));
  assert.deepEqual(calcSma(rows.slice(0, 199), 200), []);
  const averages = calcSma(rows, 200);
  assert.equal(averages.length, 6);
  assert.deepEqual(averages[0], { time: rows[199].time, value: 100.5 });
  assert.equal(averages.at(-1).value, 105.5);
});

test('BB uses population deviation with warmup and handles flat prices', () => {
  assert.deepEqual(calcBollinger(bars([1, 2, 3])), []);
  const band = calcBollinger(bars(Array.from({ length: 20 }, (_, i) => i + 1)))[0];
  assert.equal(band.middle, 10.5);
  assert.ok(Math.abs(band.upper - (10.5 + 2 * Math.sqrt(33.25))) < 1e-10);
  assert.ok(Math.abs(band.lower - (10.5 - 2 * Math.sqrt(33.25))) < 1e-10);
  const flat = calcBollinger(bars(Array(20).fill(100)))[0];
  assert.equal(flat.upper, 100);
  assert.equal(flat.lower, 100);
});

test('three-line break ignores intrabar wicks and requires strict reversals', () => {
  const source = bars([100, 110, 120, 130, 129, 101, 100, 99, 98]);
  const original = structuredClone(source);
  const result = calculateThreeLineBreak(source);
  assert.deepEqual(result.map(row => [row.open, row.close]), [[100, 110], [110, 120], [120, 130], [120, 99], [99, 98]]);
  assert.equal(result[3].time, source[7].time);
  assert.equal(result[3].volume, 40);
  assert.deepEqual(source, original);
  assert.deepEqual(calculateThreeLineBreak(bars([100, 100, 100])), []);
  const down = calculateThreeLineBreak(bars([100, 90, 80, 70, 71, 100, 101]));
  assert.deepEqual(down.at(-1), { time: 1360, open: 80, close: 101, high: 101, low: 80, volume: 30, sourceCount: 3, startTime: 1240 });
});

test('revising an unfinished candle can remove a line without modifying history', () => {
  const source = bars([100, 110, 120, 130, 99]);
  assert.equal(calculateThreeLineBreak(source).length, 4);
  source.at(-1).close = 105;
  assert.equal(calculateThreeLineBreak(source).length, 3);
});

test('global weekly restores each independent timeframe and query limit', () => {
  const states = [{ interval: '1d', limit: 120 }, { interval: '5m', limit: 350 }];
  states.forEach(state => setWeekly(state, true));
  assert.ok(states.every(state => state.interval === '1wk'));
  states.forEach(state => setWeekly(state, false));
  assert.deepEqual(states.map(({ interval, limit }) => ({ interval, limit })), [{ interval: '1d', limit: 120 }, { interval: '5m', limit: 350 }]);
});
