import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEtfSearch, parseEtfList, matchEtfs } from '../lib/etf-search.js';

const payload = { result: { etfItemList: [
  { itemcode: '069500', itemname: 'KODEX 200' },
  { itemcode: '360750', itemname: 'TIGER 미국S&P500' },
  { itemcode: '1234A0', itemname: '테스트 ETF' },
  { itemcode: '069500', itemname: 'KODEX 200' },
  { itemcode: 'invalid', itemname: 'Invalid' }
] } };
const response = () => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json; charset=UTF-8' } });

test('ETF names, English brands, whitespace, numeric and alphanumeric codes are searchable', () => {
  const items = parseEtfList(payload);
  assert.equal(items.length, 3);
  for (const query of ['kodex', ' KODEX 200 ', '069500', '069500.KS']) {
    assert.equal(matchEtfs(items, query)[0].symbol, '069500.KS');
  }
  assert.equal(matchEtfs(items, '미국 S&P500')[0].symbol, '360750.KS');
  assert.equal(matchEtfs(items, '1234a0')[0].name, '테스트 ETF');
  assert.equal(matchEtfs(items, 'ETF').length, 3);
  assert.deepEqual(matchEtfs(items, ''), []);
  assert.deepEqual(matchEtfs(items, '없는펀드'), []);
});

test('parallel keystrokes share one list request and cached results', async () => {
  let calls = 0;
  const search = createEtfSearch(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return response(); });
  const results = await Promise.all([search('kodex'), search('TIGER'), search('069500')]);
  assert.equal(calls, 1);
  assert.equal(results[0][0].name, 'KODEX 200');
  assert.equal(results[1][0].symbol, '360750.KS');
  await search('ETF');
  assert.equal(calls, 1);
});

test('failed refresh preserves the last good list, backs off, then recovers', async () => {
  let clock = 0;
  let calls = 0;
  let fail = false;
  const search = createEtfSearch(async () => { calls++; if (fail) throw new Error('offline'); return response(); }, () => clock);
  await search('KODEX');
  clock = 13 * 60 * 60 * 1000;
  fail = true;
  assert.equal((await search('KODEX'))[0].symbol, '069500.KS');
  await search('KODEX');
  assert.equal(calls, 2);
  clock += 60_001;
  fail = false;
  assert.equal((await search('TIGER'))[0].symbol, '360750.KS');
  assert.equal(calls, 3);
});

test('a provider error or empty query does not fail the combined stock search', async () => {
  let calls = 0;
  const search = createEtfSearch(async () => { calls++; return new Response('down', { status: 503 }); });
  assert.deepEqual(await search(''), []);
  assert.equal(calls, 0);
  assert.deepEqual(await search('TIGER'), []);
  assert.equal(calls, 1);
});
