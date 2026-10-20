import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardStore } from '../lib/dashboard-store.js';
import { createDashboard, applyChanges, LAYOUTS } from '../public/dashboard-model.js';
const line = (id) => ({id,start:{time:1700000000,price:100},end:{time:1700086400,price:120},width:1});

test('five independent pages default to four charts and the exact layout cycle', () => {
  const state = createDashboard();
  assert.equal(state.slots.length, 20);
  assert.deepEqual(LAYOUTS, ['2x2','1x3','3x1','1x1']);
  const next = applyChanges(state,[{type:'slot',index:4,patch:{symbol:'000660.KS',name:'SK하이닉스'}}]);
  assert.equal(next.slots[0].symbol, next.slots[4].symbol);
  assert.equal(state.slots[4].symbol,'NVDA.US');
});

test('atomic queued writes preserve independent clients, share lines by symbol and survive reopening', async t => {
  const directory = await mkdtemp(join(tmpdir(),'stock8-state-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const store = await createDashboardStore(directory);
  await Promise.all([
    store.update({id:'client-a',changes:[{type:'slot',index:4,patch:{symbol:'000660.KS',name:'SK하이닉스'}}]}),
    store.update({id:'client-b',changes:[{type:'slot',index:19,patch:{limit:350,interval:'5m'}}]}),
    store.update({id:'line-a',changes:[{type:'upsertLine',symbol:'000660.KS',line:line('a')}]}),
    store.update({id:'line-b',changes:[{type:'upsertLine',symbol:'000660.KS',line:line('b')}]}),
  ]);
  const saved = store.get();
  assert.equal(saved.slots[4].symbol,'000660.KS');
  assert.equal(saved.slots[19].limit,350);
  assert.equal(saved.lines[saved.slots[0].symbol].length,2);
  assert.deepEqual(saved.lines[saved.slots[0].symbol],saved.lines[saved.slots[4].symbol]);
  const reopened = await createDashboardStore(directory);
  assert.deepEqual(reopened.get(),saved);
  await reopened.update({id:'line-b',changes:[{type:'upsertLine',symbol:'000660.KS',line:line('b')}]});
  assert.equal(reopened.get().revision,saved.revision);
  await reopened.update({id:'delete',changes:[{type:'deleteLine',symbol:'000660.KS',id:'a'}]});
  assert.deepEqual(reopened.get().lines['000660.KS'].map(l=>l.id),['b']);
});

test('invalid writes do not corrupt storage or block later updates; legacy import cannot replace saved data', async t => {
  const directory = await mkdtemp(join(tmpdir(),'stock8-invalid-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const store = await createDashboardStore(directory);
  await assert.rejects(store.update({id:'bad',changes:[{type:'slot',index:20,patch:{name:'oops'}}]}));
  const items = Array.from({length:4},()=>({symbol:'TSLA.US',name:'Tesla'}));
  await store.update({id:'legacy',changes:[{type:'importLegacy',items}]});
  await store.update({id:'good',changes:[{type:'slot',index:0,patch:{symbol:'AAPL.US',name:'Apple'}}]});
  await store.update({id:'legacy-again',changes:[{type:'importLegacy',items}]});
  assert.equal(store.get().slots[0].symbol,'AAPL.US');
  assert.equal(JSON.parse(await readFile(join(directory,'dashboard.json'),'utf8')).state.slots[0].symbol,'AAPL.US');
  assert.throws(()=>applyChanges(store.get(),[{type:'upsertLine',symbol:'../../secrets',line:line('x')}]));
  assert.throws(()=>applyChanges(store.get(),[{type:'upsertLine',symbol:'NVDA.US',line:{...line('x'),width:100}}]));
});

test('a malformed saved file is preserved instead of being silently reset', async t => {
  const directory = await mkdtemp(join(tmpdir(),'stock8-broken-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path = join(directory,'dashboard.json');
  await writeFile(path,'broken-json');
  await assert.rejects(createDashboardStore(directory),/원본을 보존/);
  assert.equal(await readFile(path,'utf8'),'broken-json');
});
