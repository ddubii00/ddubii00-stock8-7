import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realChartRows } from '../public/chart-history.js';

const payload = { symbol: 'AAPL.US', series: [{time: 1, open: 100, high: 102, low: 99, close: 101}] };

test('legacy synthetic chart responses are rejected before they enter candles or line-break histories', () => {
  for (const source of ['fallback', 'fallback-after-kis-error', 'yahoo-or-sample', 'synthetic', 'demo', 'mock']) {
    assert.throws(() => realChartRows({...payload, source}, 'AAPL.US'), /실제 시세/);
  }
  assert.throws(() => realChartRows({...payload, source:'yahoo', synthetic:true}, 'AAPL.US'), /실제 시세/);
});

test('actual alternate providers remain valid, while mismatched instruments and empty histories cannot replace a chart', () => {
  for (const source of ['yahoo', 'kis', 'kis-intraday', 'naver-minute', 'naver-futures']) {
    assert.equal(realChartRows({...payload, source}, 'AAPL.US'), payload.series);
  }
  assert.throws(() => realChartRows(payload, '005930.KS'), /종목.*일치/);
  assert.throws(() => realChartRows({...payload, series:[]}, 'AAPL.US'), /시세 데이터/);
  assert.throws(() => realChartRows({...payload, series:null}, 'AAPL.US'), /시세 데이터/);
  assert.equal(payload.series[0].close, 101);
});
