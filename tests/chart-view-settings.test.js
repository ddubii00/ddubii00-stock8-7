import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialViewLimit, initialComparisonChanges, slotPatchForView, viewLimitsFromShared } from '../public/chart-view-settings.js';
import { createDashboard, applyChanges, layoutViews } from '../public/dashboard-model.js';
import { createDashboardStore } from '../lib/dashboard-store.js';
const viewState = (slot, chartType) => ({ chartType, limit: initialViewLimit(slot,chartType),
  restoreLimit: initialViewLimit(slot,chartType), savedLineBreakLimit:slot.lineBreakLimit??null });

test('both comparison layouts default line-break count to half of its own candle count, including legacy and small counts', () => {
  for(const layout of ['4x4','1x2-paired']) {
    const slots=[{limit:400},{limit:121}];
    assert.deepEqual(layoutViews(layout).map(view=>initialViewLimit(slots[view.slot],view.chartType)), layout==='4x4'?[400,200,121,60]:[400,200]);
  }
  assert.equal(initialViewLimit({limit:20},'line-break'),10);
  assert.equal(initialViewLimit({limit:400},'line-break',120),60);
  assert.equal(initialViewLimit({limit:400,lineBreakLimit:75},'line-break'),75);
  assert.equal(initialViewLimit({limit:400,lineBreakLimit:75},null),400);
});

test('changing either count or publishing unrelated state never resizes the other view', () => {
  let dashboard=createDashboard(); dashboard.slots[0].limit=400;
  const candle=viewState(dashboard.slots[0],'candles'), line=viewState(dashboard.slots[0],'line-break');
  const sync=()=>{for(const state of [candle,line])Object.assign(state,viewLimitsFromShared(state,dashboard.slots[0]));};
  dashboard=applyChanges(dashboard,[{type:'slot',index:0,patch:slotPatchForView(candle,{limit:600})}]); sync();
  assert.deepEqual([candle.limit,line.limit],[600,200]);
  dashboard=applyChanges(dashboard,[{type:'slot',index:1,patch:{limit:99}}]); sync();
  assert.deepEqual([candle.limit,line.limit],[600,200]);
  dashboard=applyChanges(dashboard,[{type:'slot',index:0,patch:slotPatchForView(line,{limit:85})}]); sync();
  assert.deepEqual([candle.limit,line.limit],[600,85]);
  dashboard=applyChanges(dashboard,[{type:'slot',index:0,patch:{interval:'5m',limit:120}}]); sync();
  assert.deepEqual([candle.limit,line.limit],[120,85]);
  assert.equal(initialViewLimit(dashboard.slots[0],'line-break'),85); // Reopen on another computer.
});

test('line-break timeframe edits save their own limit and weekly overrides restore independent counts', () => {
  assert.deepEqual(slotPatchForView({chartType:'line-break'},{interval:'5m',limit:60}),{interval:'5m',lineBreakLimit:60});
  assert.deepEqual(slotPatchForView({chartType:null},{interval:'5m',limit:120}),{interval:'5m',limit:120});
  const slot={limit:400,lineBreakLimit:80};
  const state=viewState(slot,'line-break'); state.limit=60;
  const result=viewLimitsFromShared(state,{...slot,limit:500,lineBreakLimit:90},true);
  assert.deepEqual(result,{limit:60,restoreLimit:90});
});

test('independent counts persist atomically without changing legacy slots, and invalid line counts are rejected', async t=>{
  const directory=await mkdtemp(join(tmpdir(),'stock8-counts-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=await createDashboardStore(directory);
  await Promise.all([
    store.update({id:'candle-count',changes:[{type:'slot',index:0,patch:{limit:480}}]}),
    store.update({id:'line-count',changes:[{type:'slot',index:0,patch:{lineBreakLimit:140}}]})
  ]);
  const slot=(await createDashboardStore(directory)).get().slots[0];
  assert.deepEqual([slot.limit,slot.lineBreakLimit],[480,140]);
  assert.equal(store.get().slots[1].lineBreakLimit,undefined);
  for(const value of [0,701,1.5,'100',null]) assert.throws(()=>applyChanges(store.get(),[{type:'slot',index:0,patch:{lineBreakLimit:value}}]));
  assert.equal(applyChanges(store.get(),[{type:'slot',index:0,patch:{lineBreakLimit:1}}]).slots[0].limit,480);
});

test('initial half-count defaults are saved once, so a later candle edit and page reopen never reset the line count', () => {
  let state=createDashboard(); state.slots[0].limit=400;
  const views=layoutViews('4x4');
  const changes=initialComparisonChanges(state.slots,0,views);
  assert.deepEqual(changes.map(change=>[change.index,change.patch.lineBreakLimit]),[[0,200],[1,60]]);
  state=applyChanges(state,changes);
  state=applyChanges(state,[{type:'slot',index:0,patch:{limit:500}}]);
  assert.deepEqual(initialComparisonChanges(state.slots,0,views),[]);
  assert.equal(initialViewLimit(state.slots[0],'line-break'),200);
  assert.deepEqual(initialComparisonChanges(state.slots,4,layoutViews('1x2-paired')).map(change=>change.index),[4]);
  assert.deepEqual(initialComparisonChanges(state.slots,0,layoutViews('2x2')),[]);
});
