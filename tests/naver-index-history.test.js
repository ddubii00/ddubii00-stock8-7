import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNaverIndexMinutes, createNaverIndexHistory } from '../lib/naver-index-history.js';
import { calculateThreeLineBreak } from '../public/three-line-break.js';
const point = (stamp, close = 5700, volume = 100) => ({ localDateTime: stamp, currentPrice: close,
  openPrice: close, highPrice: close + 1, lowPrice: close - 1, accumulatedTradingVolume: volume });

test('Naver index feed preserves every minute regardless of line-break conditions, OHLC and Korean timestamps', () => {
  const payload = { priceInfos: Array.from({ length: 31 }, (_, i) => point(`2026102110${String(i).padStart(2,'0')}00`, 5700 + (i % 2), 100 + i * 10)) };
  const original = structuredClone(payload);
  const rows = parseNaverIndexMinutes(payload);
  assert.equal(rows.length, 31);
  assert.equal(rows[0].time, Date.parse('2026-10-21T10:00:00+09:00') / 1000);
  assert.equal(rows.at(-1).time - rows[0].time, 30 * 60);
  assert.ok(rows.slice(1).every((row, index) => row.time - rows[index].time === 60 && row.volume === 10));
  assert.deepEqual([rows[0].open, rows[0].high, rows[0].low, rows[0].close], [5700,5701,5699,5700]);
  assert.equal(calculateThreeLineBreak(rows).length, 1);
  assert.equal(rows.length, 31);
  assert.deepEqual(payload, original);
});

test('out-of-order index minutes are deduplicated and invalid points are not filled with fake bars', () => {
  const rows = parseNaverIndexMinutes({ priceInfos: [point('20261021100100', 5701, 120), point('20261021095900', 5700, 100),
    point('20261021100100', 5702, 130), point('bad'), point('20261021100200', 0)] });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].close, 5702);
  assert.equal(rows[1].time - rows[0].time, 120);
  assert.equal(rows[1].volume, 30);
});

test('candle/line-break requests share cached index history while KOSPI and KOSDAQ remain separate', async () => {
  let now = 0, calls = 0;
  const load = createNaverIndexHistory({ now: () => now, fetcher: async url => {
    calls++; assert.match(url, /chart\/domestic\/index\/(KOSPI|KOSDAQ)\?periodType=day/);
    return Response.json({ priceInfos: [point('20261021103000')] });
  }});
  const [a, b] = await Promise.all([load('^KS11'), load('^KS11')]);
  assert.equal(calls, 1); assert.deepEqual(a,b);
  await load('^KS11'); assert.equal(calls,1);
  await load('^KQ11'); assert.equal(calls,2);
  now=7001; await load('^KS11'); assert.equal(calls,3);
  assert.deepEqual(await load('AAPL.US'),[]); assert.equal(calls,3);
});

test('failed index feed requests back off and recover without generating prices', async () => {
  let now=0, calls=0;
  const load=createNaverIndexHistory({now:()=>now,fetcher:async()=>{
    calls++; return calls===1 ? new Response('unavailable',{status:503}) : Response.json({priceInfos:[point('20261021103000')]});
  }});
  await assert.rejects(load('^KS11'), /503/);
  await assert.rejects(load('^KS11'), /503/); assert.equal(calls,1);
  now=2001; assert.equal((await load('^KS11')).length,1); assert.equal(calls,2);
});
