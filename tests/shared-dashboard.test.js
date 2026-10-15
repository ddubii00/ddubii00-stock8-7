import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDashboard, applyChanges } from '../public/dashboard-model.js';
import { SharedDashboard } from '../public/shared-dashboard.js';
const settle = () => new Promise(resolve=>setTimeout(resolve,0));

test('offline edits remain queued, merge remote fields, and persist after retry',async t=>{
  const originalFetch=globalThis.fetch, originalStorage=globalThis.localStorage;
  const storage=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  let server=createDashboard(), offline=false;
  globalThis.fetch=async (_url,options)=>{
    if(offline) throw new Error('offline');
    if(options?.method==='PATCH') {const op=JSON.parse(options.body);server=applyChanges(server,op.changes);server.revision++;}
    return Response.json(server);
  };
  const statuses=[];
  const client=new SharedDashboard(()=>{},status=>statuses.push(status));
  t.after(()=>{clearInterval(client.timer);clearTimeout(client.retry);globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;});
  await client.start();
  offline=true;
  client.change([{type:'slot',index:4,patch:{symbol:'000660.KS',name:'SK하이닉스'}}]);
  await settle();
  assert.equal(client.pending.length,1);
  assert.equal(client.state.slots[4].symbol,'000660.KS');
  assert.equal(statuses.at(-1),'error');
  assert.equal(JSON.parse(storage.get('stock8.pendingChanges.v1')).length,1);
  server=applyChanges(server,[{type:'slot',index:19,patch:{limit:450}}]);server.revision++;
  offline=false;clearTimeout(client.retry);await client.flush();
  assert.equal(client.pending.length,0);
  assert.equal(server.slots[4].symbol,'000660.KS');
  assert.equal(client.state.slots[19].limit,450);
  assert.equal(statuses.at(-1),'saved');
});

test('a rejected operation rolls back without blocking subsequent valid edits',async t=>{
  const originalFetch=globalThis.fetch, originalStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
  let server=createDashboard(), reject=true;
  globalThis.fetch=async (_url,options)=>{
    if(options?.method==='PATCH') {
      if(reject) return Response.json({error:'rejected'},{status:400});
      server=applyChanges(server,JSON.parse(options.body).changes);server.revision++;
    }
    return Response.json(server);
  };
  const client=new SharedDashboard(()=>{},()=>{});
  t.after(()=>{clearInterval(client.timer);clearTimeout(client.retry);globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;});
  await client.start();client.change([{type:'slot',index:0,patch:{limit:450}}]);await settle();
  assert.equal(client.pending.length,0);
  assert.equal(client.state.slots[0].limit,120);
  reject=false;client.change([{type:'slot',index:0,patch:{limit:250}}]);await settle();
  assert.equal(server.slots[0].limit,250);
});
