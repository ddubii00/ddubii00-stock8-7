import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instrumentChanges } from '../public/instrument-settings.js';
import { createDashboard, applyChanges } from '../public/dashboard-model.js';
import { manualSearchItem } from '../public/symbol-input.js';
import { parseYahooSearchResults } from '../lib/symbol-search.js';

test('settings save exactly 20 slots while preserving timeframes and symbol-shared lines', () => {
  const state = createDashboard();
  state.slots[19].interval = '1m'; state.slots[19].limit = 400;
  state.lines['000660.KS'] = [{ id: 'kept' }];
  const draft = structuredClone(state.slots);
  draft[3] = manualSearchItem('S&P500');
  draft[19] = manualSearchItem('QQQ');
  const changes = instrumentChanges(draft, state.slots);
  assert.deepEqual(changes.map(change => change.index), [3, 19]);
  const saved = applyChanges(state, changes);
  assert.equal(saved.slots[3].symbol, '^GSPC');
  assert.equal(saved.slots[19].symbol, 'QQQ.US');
  assert.equal(saved.slots[19].interval, '1m');
  assert.equal(saved.slots[19].limit, 400);
  assert.deepEqual(saved.lines, state.lines);
  assert.equal(state.slots[19].symbol, 'AMD.US');
  assert.deepEqual(instrumentChanges(saved.slots, saved.slots), []);
});

test('settings reject missing, invalid and unnamed instruments before changing server state', () => {
  const { slots } = createDashboard();
  assert.throws(() => instrumentChanges(slots.slice(0, 19), slots));
  for (const item of [{symbol:'../bad',name:'bad'}, {symbol:'AAPL.US',name:''}, null]) {
    const draft = [...slots]; draft[4] = item;
    assert.throws(() => instrumentChanges(draft, slots));
  }
});

test('major US and Korean indices and ETFs resolve alongside numeric stocks', () => {
  const examples = { '코스피':'^KS11', '코스닥':'^KQ11', 'S&P500':'^GSPC', '다우':'^DJI', '나스닥100':'^NDX', '^VIX':'^VIX', 'QQQ':'QQQ.US', 'spy':'SPY.US', 'VOO':'VOO.US', '069500':'069500.KS', 'AAPL':'AAPL.US' };
  for (const [query, symbol] of Object.entries(examples)) assert.equal(manualSearchItem(query).symbol, symbol);
  assert.equal(manualSearchItem('미국 ETF'), null);
});

test('provider search accepts US equities, ETFs and indices but never foreign stocks as US tickers', () => {
  const result = parseYahooSearchResults([
    {symbol:'AAPL',quoteType:'EQUITY',exchange:'NMS',shortname:'Apple'},
    {symbol:'QQQ',quoteType:'ETF',exchange:'NMS',shortname:'Invesco'},
    {symbol:'^GSPC',quoteType:'INDEX',exchange:'SNP',shortname:'S&P 500'},
    {symbol:'005930.KS',quoteType:'EQUITY',exchange:'KSC',shortname:'Samsung'},
    {symbol:'ABC.L',quoteType:'EQUITY',exchange:'LSE',shortname:'London'},
    {symbol:'BTC-USD',quoteType:'CRYPTOCURRENCY',exchange:'CCC',shortname:'Bitcoin'}
  ]);
  assert.deepEqual(result.map(item => item.symbol), ['AAPL.US','QQQ.US','^GSPC']);
});
