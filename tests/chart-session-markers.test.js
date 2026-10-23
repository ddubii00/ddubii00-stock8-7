import assert from 'node:assert/strict';
import { test } from 'node:test';
import { koreanClosingBoundaries, lineBreakDateBoundaries } from '../public/chart-session-markers.js';

const time = date => Date.parse(date) / 1000;
const rows = dates => dates.map(date => ({ time: time(date) }));

test('domestic stock intraday charts mark each actual 15:30 KST close', () => {
  const source = rows(['2026-10-22T15:29:00+09:00', '2026-10-22T15:30:00+09:00',
    '2026-10-22T16:00:00+09:00', '2026-10-23T09:00:00+09:00', '2026-10-23T15:30:00+09:00', '2026-10-23T20:00:00+09:00']);
  const original = structuredClone(source);
  const closes = [time('2026-10-22T06:30:00Z'), time('2026-10-23T06:30:00Z')];
  for (const symbol of ['000660.KS', '005930.KS', '247540.KQ']) {
    for (const interval of ['1m', '3m', '5m', '10m', '15m', '30m', '60m']) {
      assert.deepEqual(koreanClosingBoundaries(source, symbol, interval), closes.map(time => ({ time, from: time, to: time, fraction: 0 })));
    }
  }
  assert.deepEqual(source, original);
});

test('ETFs and indices ending at 15:30 have no closing marker, while date separators remain available', () => {
  const source = rows(['2026-10-22T15:30:00+09:00', '2026-10-23T09:00:00+09:00', '2026-10-23T15:30:00+09:00']);
  for (const symbol of ['069500.KS', '0052D0.KS', '^KS11', '^KQ11']) {
    for (const interval of ['1m', '3m', '5m', '10m', '15m', '30m', '60m']) {
      assert.deepEqual(koreanClosingBoundaries(source, symbol, interval, { regularSessionOnly: true }), []);
    }
  }
  const time = source[1].time;
  assert.deepEqual(lineBreakDateBoundaries(source, '1m', 'Asia/Seoul'), [{ time, from: time, to: time, fraction: 0 }]);
});

test('hourly and sparse candle timelines position 15:30 between real same-day anchors', () => {
  const hourly = rows(['2026-10-23T15:00:00+09:00', '2026-10-23T16:00:00+09:00']);
  assert.deepEqual(koreanClosingBoundaries(hourly, '000660.KS', '60m'), [{
    time: time('2026-10-23T15:30:00+09:00'), from: hourly[0].time, to: hourly[1].time, fraction: 0.5
  }]);
  const sparse = rows(['2026-10-23T15:20:00+09:00', '2026-10-23T16:00:00+09:00']);
  assert.equal(koreanClosingBoundaries(sparse, '000660.KS', '1m')[0].fraction, 0.25);
});

test('intraday line breaks mark the first actual box on a new local date, including overnight gaps', () => {
  const source = rows(['2026-10-22T15:30:00+09:00', '2026-10-22T19:50:00+09:00',
    '2026-10-23T09:07:00+09:00', '2026-10-23T15:30:00+09:00', '2026-10-26T10:20:00+09:00']);
  const original = structuredClone(source);
  for (const interval of ['1m', '3m', '5m', '10m', '15m', '30m', '60m']) {
    assert.deepEqual(lineBreakDateBoundaries(source, interval, 'Asia/Seoul'), [source[2].time, source[4].time].map(time => ({ time, from: time, to: time, fraction: 0 })));
  }
  for (const interval of ['1d', '1wk', '1mo']) assert.deepEqual(lineBreakDateBoundaries(source, interval, 'Asia/Seoul'), []);
  assert.deepEqual(lineBreakDateBoundaries([], '1m', 'Asia/Seoul'), []);
  assert.deepEqual(lineBreakDateBoundaries(source.slice(0, 1), '1m', 'Asia/Seoul'), []);
  assert.deepEqual(source, original);
});

test('US line-break date separators follow New York midnight instead of UTC or Korea dates', () => {
  const source = rows(['2026-10-23T23:59:00-04:00', '2026-10-24T00:02:00-04:00', '2026-10-24T03:00:00-04:00']);
  const time = source[1].time;
  assert.deepEqual(lineBreakDateBoundaries(source, '1m', 'America/New_York'), [{ time, from: time, to: time, fraction: 0 }]);
  assert.deepEqual(lineBreakDateBoundaries(source, '1m', 'Asia/Seoul'), []);
});

test('no closing marker is invented across overnight gaps, outside history, or on other markets and calendar bars', () => {
  for (const source of [[], rows(['2026-10-23T15:29:00+09:00']),
    rows(['2026-10-22T15:20:00+09:00', '2026-10-23T09:00:00+09:00']),
    rows(['2026-10-23T16:00:00+09:00', '2026-10-23T20:00:00+09:00'])]) {
    assert.deepEqual(koreanClosingBoundaries(source, '000660.KS', '1m'), []);
  }
  const source = rows(['2026-10-23T15:00:00+09:00', '2026-10-23T16:00:00+09:00']);
  for (const symbol of ['AAPL.US', 'NQ=F', 'USTECH100', 'KRW=X', '^KS11', '^KQ11']) {
    assert.deepEqual(koreanClosingBoundaries(source, symbol, '1m'), []);
  }
  for (const interval of ['1d', '1wk', '1mo']) {
    assert.deepEqual(koreanClosingBoundaries(source, '000660.KS', interval), []);
  }
});
