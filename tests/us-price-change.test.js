import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsPriceChange, previousUsRegularClose, usChangeFromBase, usTradingDate } from '../lib/us-price-change.js';
const time = value => Date.parse(value) / 1000;
const row = (date, close) => ({ time: time(date + 'T13:30:00Z'), close });

test('US prior close follows New York trading dates across weekends, holidays and DST', () => {
  const rows = [row('2026-07-01', 90), row('2026-07-02', 100), row('2026-07-06', 110)];
  assert.equal(previousUsRegularClose(rows, time('2026-07-06T08:00:00-04:00')).close, 100);
  assert.equal(previousUsRegularClose(rows, time('2026-07-06T18:00:00-04:00')).close, 100);
  assert.equal(previousUsRegularClose(rows, time('2026-07-07T00:30:00+09:00')).close, 100);
  assert.equal(previousUsRegularClose(rows, time('2026-07-01T12:00:00Z')), null);
  assert.equal(usTradingDate(time('2026-11-03T00:30:00Z')), '2026-11-02');
  const winter = [row('2026-10-30', 120), row('2026-11-02', 130)];
  assert.equal(previousUsRegularClose(winter, time('2026-11-02T09:00:00-05:00')).close, 120);
});

test('amount and percent use the same verified regular close, including losses and absent bases', () => {
  const p = usChangeFromBase({ price: 95, change: 999, changePercent: 999 }, 100, '2026-10-19');
  assert.equal(p.change, -5); assert.equal(p.changePercent, -5); assert.equal(p.changeRate, -5);
  assert.equal(p.previousCloseDate, '2026-10-19');
  assert.equal(usChangeFromBase({ price: 100 }, 100).changePercent, 0);
  assert.equal(usChangeFromBase({ price: 100 }, NaN).changePercent, null);
});

test('daily regular close is cached/shared, never adjusted close or a chart-range starting price', async () => {
  let calls = 0;
  const normalize = createUsPriceChange({ fetcher: async url => {
    calls++;
    const query = new URL(url);
    assert.equal(query.searchParams.get('interval'), '1d'); assert.equal(query.searchParams.get('includePrePost'), 'false');
    return Response.json({ chart: { result: [{ timestamp: [row('2026-10-16', 100).time, row('2026-10-19', 120).time, row('2026-10-20', 130).time], indicators: { quote: [{ close: [100, 120, 130] }], adjclose: [{ adjclose: [70, 80, 90] }] } }] } });
  } });
  const p = { symbol: 'AAPL.US', price: 132, previousClose: 50, marketTime: time('2026-10-20T18:00:00-04:00') };
  for (const result of await Promise.all([normalize(p), normalize(p)])) {
    assert.equal(result.previousClose, 120); assert.equal(result.previousCloseDate, '2026-10-19');
    assert.equal(result.change, 12); assert.equal(result.changePercent, 10);
  }
  assert.equal(calls, 1);
  assert.equal((await normalize({ ...p, price: 126 })).changePercent, 5); assert.equal(calls, 1);
  const korean = { symbol: '005930.KS', price: 100 };
  assert.equal(await normalize(korean), korean); assert.equal(calls, 1);
});
