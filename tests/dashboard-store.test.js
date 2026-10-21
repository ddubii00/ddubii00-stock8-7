import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardStore } from '../lib/dashboard-store.js';
import { createDashboard, applyChanges, LAYOUTS, adjacentPage, layoutViews, layoutChartCount, isComparisonLayout } from '../public/dashboard-model.js';
const line = (id) => ({id,start:{time:1700000000,price:100},end:{time:1700086400,price:120},width:1});

test('ten independent pages default to four charts and the exact layout cycle', () => {
  const state = createDashboard();
  assert.equal(state.slots.length, 40);
  assert.deepEqual(LAYOUTS, ['2x2','1x3','3x1','1x1','2x1','1x2','4x4','1x2-paired']);
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
  await assert.rejects(store.update({id:'bad',changes:[{type:'slot',index:40,patch:{name:'oops'}}]}));
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


test('previous/next wrap around all ten pages', () => {
  assert.equal(adjacentPage(0, -1), 9);
  assert.equal(adjacentPage(9, 1), 0);
  for (let page = 0; page < 10; page++) assert.equal(adjacentPage(adjacentPage(page, 1), -1), page);
});

test('five-page storage expands atomically without losing slots, shared lines or deduplication IDs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'stock8-migrate-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const state = createDashboard(); state.slots = state.slots.slice(0, 20);
  state.initialized = true; state.revision = 17;
  state.slots[19] = {...state.slots[19], symbol:'AAPL.US', name:'Custom Apple', interval:'5m', limit:400};
  state.lines['AAPL.US'] = [line('kept')];
  const applied = ['saved-operation'];
  const path = join(directory, 'dashboard.json');
  await writeFile(path, JSON.stringify({state, applied}));
  const store = await createDashboardStore(directory);
  assert.deepEqual(store.get().slots.slice(0, 20), state.slots);
  assert.deepEqual(store.get().lines, state.lines);
  assert.equal(store.get().slots.length, 40);
  assert.equal(store.get().revision, 17);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).applied, applied);
  await store.update({id:'saved-operation', changes:[{type:'slot', index:0, patch:{name:'must not apply'}}]});
  assert.equal(store.get().slots[0].name, state.slots[0].name);
  await store.update({id:'tenth-page', changes:[{type:'slot', index:39, patch:{symbol:'AAPL.US', name:'Apple page 10'}}]});
  const reopened = await createDashboardStore(directory);
  assert.deepEqual(reopened.get(), store.get());
  assert.deepEqual(reopened.get().lines[reopened.get().slots[39].symbol], state.lines['AAPL.US']);
});

test('paired layout shows only the first two saved slots on every page, with fixed modes', () => {
  const dashboard = createDashboard();
  const views = layoutViews('4x4');
  assert.equal(layoutChartCount('4x4'), 4);
  assert.deepEqual(views.map(view => [view.slot, view.chartType, view.macdSignals]), [
    [0, 'candles', true], [0, 'line-break', false], [1, 'candles', true], [1, 'line-break', false]
  ]);
  for (let page = 0; page < 10; page++) {
    const items = views.map(view => dashboard.slots[page * 4 + view.slot]);
    assert.equal(items[0], items[1]);
    assert.equal(items[2], items[3]);
    assert.equal(items[2], dashboard.slots[page * 4 + 1]);
  }
  for (const layout of LAYOUTS.filter(layout => !isComparisonLayout(layout))) {
    assert.deepEqual(layoutViews(layout).map(view => view.slot), Array.from({ length: layoutChartCount(layout) }, (_, index) => index));
    assert.ok(layoutViews(layout).every(view => view.chartType === null && view.macdSignals));
  }
});

test('last comparison layout uses only the first saved instrument with candles above line break on all ten pages', () => {
  assert.equal(LAYOUTS.at(-1), '1x2-paired');
  assert.ok(isComparisonLayout('1x2-paired'));
  assert.equal(isComparisonLayout('1x2'), false);
  assert.equal(layoutChartCount('1x2-paired'), 2);
  assert.deepEqual(layoutViews('1x2-paired'), [
    { slot: 0, chartType: 'candles', macdSignals: true },
    { slot: 0, chartType: 'line-break', macdSignals: false }
  ]);
  const state = createDashboard();
  for (let page = 0; page < 10; page++) {
    assert.deepEqual(layoutViews('1x2-paired').map(view => state.slots[page*4+view.slot]), [state.slots[page*4],state.slots[page*4]]);
  }
  assert.deepEqual(layoutViews('4x4').map(view => view.slot), [0,0,1,1]);
  assert.deepEqual(layoutViews('1x2').map(view => view.slot), [0,1]);
});
