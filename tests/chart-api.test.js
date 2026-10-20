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
  const child=spawn(process.execPath,['--import',fixture,'server.js'],{cwd:root,env:{...process.env,PORT:'0',STOCK8_DATA_DIR:data,STOCK8_PASSWORD:'1222',KIS_APP_KEY:'',KIS_APP_SECRET:''},stdio:['ignore','pipe','pipe']});
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
