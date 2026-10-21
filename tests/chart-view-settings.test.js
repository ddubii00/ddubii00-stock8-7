import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialViewLimit, initialViewInterval, initialComparisonChanges, slotPatchForView, viewLimitsFromShared } from '../public/chart-view-settings.js';
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
  assert.deepEqual(slotPatchForView({chartType:'line-break'},{interval:'5m',limit:60}),{lineBreakInterval:'5m',lineBreakLimit:60});
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


test('paired intervals initialize once and remain independent in both layouts, including page reopen and normal layouts', () => {
  for (const layout of ['4x4','1x2-paired']) {
    let dashboard=createDashboard();
    dashboard.slots[0].interval='1m';
    dashboard.slots[0].lineBreakLimit=85; // Existing count preference survives interval migration.
    dashboard.slots[1].interval='1d';
    const defaults=initialComparisonChanges(dashboard.slots,0,layoutViews(layout));
    assert.deepEqual(defaults[0].patch,{lineBreakInterval:'1m'});
    dashboard=applyChanges(dashboard,defaults);
    const selected=()=>layoutViews(layout).map(view=>initialViewInterval(dashboard.slots[view.slot],view.chartType));
    assert.deepEqual(selected(),layout==='4x4'?['1m','1m','1d','1d']:['1m','1m']);
    dashboard=applyChanges(dashboard,[{type:'slot',index:0,patch:slotPatchForView({chartType:'line-break'},{interval:'5m',limit:60})}]);
    assert.deepEqual(selected().slice(0,2),['1m','5m']);
    assert.equal(dashboard.slots[0].limit,120);
    dashboard=applyChanges(dashboard,[{type:'slot',index:0,patch:slotPatchForView({chartType:'candles'},{interval:'1d',limit:400})}]);
    assert.deepEqual(selected().slice(0,2),['1d','5m']);
    assert.equal(dashboard.slots[0].lineBreakLimit,60);
    assert.deepEqual(initialComparisonChanges(dashboard.slots,0,layoutViews(layout)),[]);
    assert.equal(initialViewInterval(dashboard.slots[0],null),'1d'); // Ordinary/global line-break layout keeps its own slot interval.
    assert.equal(initialViewInterval(dashboard.slots[0],'line-break'),'5m'); // Own restore interval when global weekly is disabled.
    if(layout==='4x4') {
      dashboard=applyChanges(dashboard,[{type:'slot',index:1,patch:slotPatchForView({chartType:'line-break'},{interval:'1mo'})}]);
      assert.deepEqual(selected(),['1d','5m','1d','1mo']);
    }
  }
});

test('independent line-break intervals persist across server restarts and accept only supported timeframes', async t=>{
  const directory=await mkdtemp(join(tmpdir(),'stock8-intervals-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=await createDashboardStore(directory);
  await Promise.all([
    store.update({id:'candle-interval',changes:[{type:'slot',index:0,patch:{interval:'1d',limit:400}}]}),
    store.update({id:'line-interval',changes:[{type:'slot',index:0,patch:{lineBreakInterval:'5m',lineBreakLimit:140}}]})
  ]);
  const slot=(await createDashboardStore(directory)).get().slots[0];
  assert.deepEqual([slot.interval,slot.lineBreakInterval,slot.limit,slot.lineBreakLimit],['1d','5m',400,140]);
  assert.equal(store.get().slots[1].lineBreakInterval,undefined);
  for(const value of ['2m','day','',null,1]) assert.throws(()=>applyChanges(store.get(),[{type:'slot',index:0,patch:{lineBreakInterval:value}}]));
});
