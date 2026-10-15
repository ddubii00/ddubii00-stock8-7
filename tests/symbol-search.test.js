import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKoreanCode, parseUsTicker, manualSearchItem, searchResultsWithFallback, prioritizeExactInstrument } from '../public/symbol-input.js';
import { createKoreanCodeResolver, parseKoreanMetadata } from '../lib/symbol-search.js';

test('domestic ticker codes preserve zeros and accept short, prefixed and full-width input',()=>{
  for(const query of ['005930','5930',' A005930 ','００５９３０','005930.KS']) assert.equal(parseKoreanCode(query).code,'005930');
  assert.deepEqual(parseKoreanCode('196170.kq'),{code:'196170',suffix:'.KQ'});
  assert.equal(parseKoreanCode('1234a0').code,'1234A0');
  assert.equal(parseKoreanCode('AAPL'),null);
  assert.equal(parseKoreanCode('1961709'),null);
});

test('US ticker input recognizes Apple, lowercase, suffixes and share classes',()=>{
  for(const query of ['AAPL','aapl',' AAPL.US ','ａａｐｌ']) assert.equal(parseUsTicker(query),'AAPL');
  assert.deepEqual(manualSearchItem('aapl'),{symbol:'AAPL.US',name:'AAPL'});
  assert.equal(parseUsTicker('BRK.B'),'BRK-B');
  assert.equal(parseUsTicker('brk-b.us'),'BRK-B');
  assert.equal(parseUsTicker('005930'),null);
  assert.equal(parseUsTicker('애플'),null);
  assert.equal(manualSearchItem('코스피').symbol,'^KS11');
});

test('a verified KOSDAQ code is not duplicated by a guessed KOSPI fallback',()=>{
  const verified={symbol:'196170.KQ',name:'알테오젠'};
  assert.deepEqual(searchResultsWithFallback([verified],'196170'),[verified]);
  assert.deepEqual(searchResultsWithFallback([verified],'196170.KS'),[verified]);
  const results=prioritizeExactInstrument([{symbol:'000660.KS',name:'SK하이닉스'},verified],'196170');
  assert.deepEqual(results[0],verified);
});

test('exact US ticker wins over partial results before selecting with Enter',()=>{
  const results=[{symbol:'AAPLX.US',name:'Partial'},{symbol:'AAP.US',name:'Advance Auto Parts'},{symbol:'AAPL.US',name:'Apple Inc.'}];
  for(const query of ['AAPL','aapl','AAPL.US']) assert.equal(prioritizeExactInstrument(results,query)[0].name,'Apple Inc.');
  assert.equal(searchResultsWithFallback(results,'aapl').length,3);
  assert.equal(prioritizeExactInstrument([{symbol:'BRK-A.US'},{symbol:'BRK-B.US'}],'BRK.B')[0].symbol,'BRK-B.US');
});

test('numeric lookup identifies the actual name and market, caches and coalesces requests',async()=>{
  let calls=0;
  const resolve=createKoreanCodeResolver(async()=>{
    calls++;await new Promise(r=>setTimeout(r,5));
    return Response.json({itemCode:'196170',stockName:'알테오젠',stockExchangeType:{code:'KQ',nameEng:'KOSDAQ'}});
  });
  const result=await Promise.all([resolve('196170'),resolve('196170.KS')]);
  assert.equal(calls,1);
  assert.deepEqual(result[0],{symbol:'196170.KQ',name:'알테오젠'});
  assert.deepEqual(result[1],result[0]);
  await resolve('196170');assert.equal(calls,1);
});

test('known codes work offline and invalid metadata cannot substitute another stock',async()=>{
  const resolve=createKoreanCodeResolver(async()=>{throw Error('offline');},{'005930.KS':'삼성전자','060370.KQ':'LS마린솔루션'});
  assert.deepEqual(await resolve('5930'),{symbol:'005930.KS',name:'삼성전자'});
  assert.equal((await resolve('060370')).symbol,'060370.KQ');
  assert.equal(await resolve('196170'),null);
  assert.equal(parseKoreanMetadata({itemCode:'005930',stockName:'Wrong',stockExchangeType:{code:'KS'}},'196170'),null);
  assert.equal(parseKoreanMetadata({itemCode:'196170',stockName:'알테오젠'},'196170'),null);
});
