import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgressiveSearch } from '../lib/progressive-search.js';
import { createCatalogLoader } from '../lib/search-catalog-cache.js';
import { staticSearch } from '../public/search-catalog.js';
import { prioritizeExactInstrument } from '../public/symbol-input.js';
import { parseKoreanMaster } from '../lib/korean-master.js';
import { readKisMasterZip } from '../lib/kis-master.js';
const deferred = () => { let resolve; const task = new Promise(done => { resolve = done; }); return { task, resolve }; };
const finish = (q, groups) => prioritizeExactInstrument([...new Map(groups.flat().filter(Boolean).map(item => [item.symbol, item])).values()], q);

test('local and fast provider results return before slow providers, then enrich without repeating requests', async () => {
  const slow = deferred(); let calls = 0, clock = 0;
  const search = createProgressiveSearch({ initial: staticSearch, budgetMs: 15, now: () => clock, finish,
    providers: [async () => [{symbol:'123456.KQ', name:'빠른 주식'}], () => { calls++; return slow.task; }] });
  const first = await search('하이닉스');
  assert.equal(first.pending, true); assert.equal(first.results[0].symbol, '000660.KS');
  assert.ok(first.results.some(item => item.symbol === '123456.KQ'));
  for (const result of await Promise.all([search('하이닉스'), search(' 하이닉스 ')])) assert.equal(result.pending, true);
  assert.equal(calls, 1);
  slow.resolve([{symbol:'333333.KS', name:'하이닉스 ETF'}]);
  await new Promise(resolve => setImmediate(resolve));
  const final = await search('하이닉스');
  assert.equal(final.pending, false); assert.equal(final.results[0].symbol, '000660.KS');
  assert.ok(final.results.some(item => item.symbol === '333333.KS'));
  await search('하이닉스'); assert.equal(calls, 1);
  clock = 300001; await search('하이닉스'); assert.equal(calls, 2);
});

test('provider failures do not discard valid search results or trigger immediate retries', async () => {
  let calls = 0;
  const search = createProgressiveSearch({ initial: staticSearch, finish,
    providers: [async () => { calls++; throw Error('offline'); }] });
  assert.equal((await search('삼전')).results[0].symbol, '005930.KS');
  assert.equal((await search('삼전')).pending, false); assert.equal(calls, 1);
});

test('catalog cold refresh is single-flight and never has more than four network requests at once', async () => {
  let active = 0, peak = 0, calls = 0, saved;
  const load = createCatalogLoader({ saveCache: async value => { saved = value; }, loadPage: async (market, page) => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return [{symbol:`${String(100000 + market * 100 + page)}.${market ? 'KQ' : 'KS'}`, name:`종목 ${market} ${page}`}];
  } });
  const result = await Promise.all([load(), load(), load()]);
  assert.equal(calls, 90); assert.equal(peak, 4); assert.equal(result[0].length, 90);
  assert.deepEqual(result[1], result[0]); assert.equal(saved.items.length, 90);
  const reopened = createCatalogLoader({ readCache: async () => saved, loadPage: () => assert.fail('warm restart must use disk cache') });
  assert.deepEqual(await reopened(), result[0]);
});

test('stale catalog is returned immediately during failed refresh and retained with retry backoff', async () => {
  const wait = deferred(); let clock = 50000000, calls = 0;
  const old = [{symbol:'196170.KQ', name:'알테오젠'}];
  const load = createCatalogLoader({ now: () => clock, readCache: async () => ({ items: old, loadedAt: 0 }),
    loadPage: async () => { calls++; await wait.task; throw Error('offline'); } });
  assert.deepEqual(await load(), old); assert.equal(calls, 4);
  assert.deepEqual(await load(), old); assert.equal(calls, 4);
  wait.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 90); assert.deepEqual(await load(), old); assert.equal(calls, 90);
  clock += 60001; await load(); assert.ok(calls > 90);
});

test('local browser search includes Korean aliases, US tickers, saved symbols and the Nasdaq family', () => {
  assert.equal(staticSearch('하닉')[0].symbol, '000660.KS');
  assert.equal(staticSearch('aapl')[0].symbol, 'AAPL.US');
  assert.equal(staticSearch('특별종목', [{symbol:'196170.KQ', name:'특별종목'}])[0].symbol, '196170.KQ');
  for (const symbol of ['^IXIC', '^NDX', 'NQ=F', 'QQQ.US']) assert.ok(staticSearch('나스닥').some(item => item.symbol === symbol));
});

test('official complete catalog takes one shared bulk load and avoids the 90-page fallback', async () => {
  let calls = 0;
  const items = [{symbol:'196170.KQ', name:'알테오젠'}];
  const load = createCatalogLoader({ loadAll: async () => { calls++; return items; }, loadPage: () => assert.fail('bulk success must not scrape pages') });
  const results = await Promise.all([load(), load(), load()]);
  assert.equal(calls, 1); assert.deepEqual(results[0], items);
});

test('official KOSPI/KOSDAQ names retain Korean characters, numeric/alphanumeric codes and market suffix', () => {
  const record = (code, name, tail) => code.padEnd(9) + 'KR7000000000' + name + ' '.repeat(tail - 1) + '\n';
  assert.deepEqual(parseKoreanMaster(record('196170', '알테오젠', 222), 'kosdaq'), [{symbol:'196170.KQ', name:'알테오젠'}]);
  assert.deepEqual(parseKoreanMaster(record('1234A0', '테스트 ETF', 228), 'kospi'), [{symbol:'1234A0.KS', name:'테스트 ETF'}]);
  assert.deepEqual(parseKoreanMaster('broken row\n', 'kospi'), []);
  assert.throws(() => readKisMasterZip(Buffer.from('bad zip'), 'kosdaq_code.mst'), /종목파일/);
});
