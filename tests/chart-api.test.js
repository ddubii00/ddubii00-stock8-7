import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('chart API supplies longer real history for line breaks and never fabricates failed source data', async t => {
  const data=await mkdtemp(join(tmpdir(),'stock8-chart-api-'));
  const root=fileURLToPath(new URL('../',import.meta.url));
  const fixture=fileURLToPath(new URL('./fixtures/chart-upstreams.mjs',import.meta.url));
  const child=spawn(process.execPath,['--import',fixture,'server.js'],{cwd:root,env:{...process.env,PORT:'0',STOCK8_DATA_DIR:data,STOCK8_PASSWORD:'1222',KIS_APP_KEY:'',KIS_APP_SECRET:'',KIS_FUTURES_APP_KEY:'',KIS_FUTURES_APP_SECRET:''},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(data,{recursive:true,force:true})});
  const port=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('test server did not start')),10000);
    child.on('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code))});
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(match[1])}});
  });
  const base=`http://127.0.0.1:${port}/stock8-7`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'1222'})});
  const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
  for (const query of ['하이닉스','SK하이닉스','하닉']) {
    const response=await fetch(base+'/api/search?q='+encodeURIComponent(query),{headers});
    const {results}=await response.json();
    assert.equal(results[0].symbol,'000660.KS');
    assert.equal(results[0].name,'SK하이닉스');
    if (query==='하이닉스') assert.ok(results.some(item=>item.name.includes('ETF')));
  }
  const chart=path=>fetch(base+'/api/chart?'+path,{headers});
  const resolved=await(await fetch(base+'/api/search?q=196170',{headers})).json();
  assert.equal(resolved.results.length,1);assert.equal(resolved.results[0].symbol,'196170.KQ');assert.equal(resolved.results[0].name,'알테오젠');
  const family=await(await fetch(base+'/api/search?q='+encodeURIComponent('나스닥'),{headers})).json();
  for(const symbol of ['^IXIC','^NDX','NQ=F','QQQ.US','QQQM.US','TQQQ.US','SQQQ.US','133690.KS'])assert.ok(family.results.some(item=>item.symbol===symbol),symbol);
  for(const query of ['나스닥100 선물','NQ','NQ=F']) {
    const search=await(await fetch(base+'/api/search?q='+encodeURIComponent(query),{headers})).json();
    assert.equal(search.results[0].symbol,'NQ=F');
  }
  for(const interval of ['1m','1d','1wk']) {
    const response=await chart(`symbol=NQ%3DF&interval=${interval}&limit=400`);
    assert.equal(response.status,200);
    const future=await response.json();assert.equal(future.symbol,'NQ=F');assert.equal(future.decimals,2);
    assert.equal(future.marketStatus,'네이버 10분 지연');assert.ok(future.series.every(row=>Number.isInteger(row.close*4)));
  }
  const save=await fetch(base+'/api/state',{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:'register-futures',changes:[{type:'slot',index:0,patch:{symbol:'NQ=F',name:'나스닥100 선물',decimals:2}}]})});
  assert.equal(save.status,200);assert.equal((await save.json()).slots[0].symbol,'NQ=F');
  const unavailableFuture=await chart('symbol=FAIL%3DF&interval=1m');
  assert.equal(unavailableFuture.status,503);assert.match((await unavailableFuture.json()).error,/선물 시세/);
  const futureQuote=await(await fetch(base+'/api/quote?symbol=NQ%3DF',{headers})).json();
  assert.equal(futureQuote.symbol,'NQ=F');assert.equal(futureQuote.marketStatus,'네이버 10분 지연');
  const futureLines=await(await chart('symbol=NQ%3DF&interval=1m&limit=10000&chartType=line-break')).json();
  assert.equal(futureLines.series.length,2000);assert.equal(futureLines.decimals,2);
  assert.equal((await(await fetch(base+'/api/state',{headers})).json()).slots[0].symbol,'NQ=F');
  // A delayed Yahoo tail must not leave a 20-minute hole in either view's raw data.
  for (const symbol of ['^KS11','^KQ11']) {
    const [candles, lineSource] = await Promise.all(['candles','line-break'].map(async type =>
      (await chart(`symbol=${encodeURIComponent(symbol)}&interval=1m&limit=${type==='candles'?400:10000}&chartType=${type}`)).json()));
    assert.equal(candles.series.length,400);
    const tail=candles.series.slice(-21);
    assert.ok(tail.every(row=>row.source==='naver-index-minute'));
    assert.ok(tail.slice(1).every((row,index)=>row.time-tail[index].time===60));
    const rawByTime=new Map(lineSource.series.map(row=>[row.time,row]));
    for(const row of tail) assert.equal(rawByTime.get(row.time)?.close,row.close);
  }
  const normal=await(await chart('symbol=AAPL.US&interval=1m&limit=10000')).json();
  assert.equal(normal.series.length,700);
  for (const interval of ['1m','1d','1wk']) {
    const response=await chart(`symbol=AAPL.US&interval=${interval}&limit=10000&chartType=line-break`);
    assert.equal(response.status,200);assert.equal((await response.json()).series.length,2000);
  }
  const unavailable=await chart('symbol=FAIL.US&interval=1m&chartType=line-break&limit=10000');
  assert.equal(unavailable.status,503);assert.match((await unavailable.json()).error,/실제 시세/);
  const alternate=await chart('symbol=005930.KS&interval=1m&limit=10000&chartType=line-break');
  assert.equal(alternate.status,200);
  const naver=await alternate.json();assert.equal(naver.series.length,60);assert.equal(naver.source,'naver-minute');
});
