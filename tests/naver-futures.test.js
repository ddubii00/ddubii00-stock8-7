import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNaverFutures, parseNaverFuturesQuote, parseNaverFuturesHistory } from '../lib/naver-futures.js';

const item = { reutersCode: 'NQcv1', closePrice: '29,533.25', compareToPreviousClosePrice: '-473.75',
  fluctuationsRatio: '-1.58', localTradedAt: '2026-10-22T07:11:36-05:00',
  stockExchangeType: { delayTime: 10 }, marketStatus: 'OPEN' };
const candle = { localDate: '20261022', openPrice: 29984, highPrice: 29993.25, lowPrice: 29417,
  closePrice: 29533.25, accumulatedTradingVolume: 164975 };

test('Naver futures preserve the exchange timestamp, signed change and provider delay without claiming realtime', () => {
  const q = parseNaverFuturesQuote({ datas: [item] });
  assert.equal(q.price, 29533.25);
  assert.equal(q.previousClose, 30007);
  assert.equal(q.change, -473.75);
  assert.equal(q.marketTime, Date.parse('2026-10-22T12:11:36Z') / 1000);
  assert.equal(q.realtime, false);
  assert.equal(q.marketStatus, '네이버 10분 지연');
  const winter = parseNaverFuturesQuote({ datas: [{ ...item, localTradedAt: '2026-12-22T07:11:36-06:00' }] });
  assert.equal(winter.marketTime, Date.parse('2026-12-22T13:11:36Z') / 1000);
  assert.throws(() => parseNaverFuturesQuote({ datas: [{ ...item, reutersCode: 'EScv1' }] }));
  assert.throws(() => parseNaverFuturesQuote({ datas: [{ ...item, closePrice: '', localTradedAt: '' }] }));
});

test('Naver history only accepts actual OHLC, sorts and deduplicates without manufacturing candles from close-only samples', () => {
  const rows = parseNaverFuturesHistory([candle, { ...candle, localDate: '20261021' }, candle,
    { localDate: '20261020', closePrice: 30000 }, { ...candle, highPrice: 1 }, { ...candle, localDate: 'bad' }]);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].time < rows[1].time);
  assert.equal(rows[1].volume, 164975);
});

test('Naver quote requests coalesce and cache while timeframes keep separate genuine candle sources', async () => {
  let time = Date.parse('2026-10-22T12:21:36Z'), quoteCalls = 0, historyCalls = 0;
  const urls = [];
  const api = createNaverFutures({ now: () => time, fetcher: async url => {
    urls.push(url);
    if (url.includes('/realtime/')) { quoteCalls++; return Response.json({ datas: [item] }); }
    historyCalls++; return Response.json([candle]);
  }, loadIntraday: async interval => ({ series: [{ time: 1792667400, open: 29530, high: 29540, low: 29520, close: 29533, volume: 10 }], seriesSource: 'yahoo-futures-history', interval }) });
  const values = await Promise.all([api.chart('1d', 400), api.chart('1d', 400), api.quote()]);
  assert.equal(quoteCalls, 1); assert.equal(historyCalls, 1);
  assert.equal(values[0].seriesSource, 'naver-futures-history');
  assert.match(urls.find(url => url.includes('startDateTime')), /startDateTime=2023/);
  const minute = await api.chart('3m', 400);
  assert.equal(minute.seriesSource, 'yahoo-futures-history');
  assert.equal(minute.price, item.closePrice.replaceAll(',', '') * 1);
  assert.equal(minute.series[0].close, 29533); // Quote must not overwrite OHLC history.
  assert.match(minute.historyNotice, /분봉 이력: Yahoo/);
  await api.chart('1wk', 400); await api.chart('1mo', 400);
  assert.equal(historyCalls, 3);
  time += 7001;
  await api.chart('1d', 400);
  assert.equal(quoteCalls, 2); assert.equal(historyCalls, 3);
});

test('failed Naver requests back off briefly, recover, and never return fabricated or cached-as-new prices', async () => {
  let time = 0, calls = 0;
  const api = createNaverFutures({ now: () => time, fetcher: async () => {
    calls++; return calls === 1 ? new Response('', { status: 503 }) : Response.json({ datas: [item] });
  } });
  await assert.rejects(api.quote(), /503/);
  await assert.rejects(api.quote(), /503/);
  assert.equal(calls, 1);
  time = 2001;
  assert.equal((await api.quote()).source, 'naver-futures');
  assert.equal(calls, 2);
});
