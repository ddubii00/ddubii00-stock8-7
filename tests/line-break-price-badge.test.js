import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineBreakPriceState } from '../public/line-break-price-badge.js';
import { calculateThreeLineBreak } from '../public/three-line-break.js';

test('badge uses the last line price/direction and marks both reversal directions, not continuations', () => {
  const up = { open:100, close:110 }, down = { open:110, close:100 };
  assert.equal(lineBreakPriceState([]), null);
  assert.deepEqual(lineBreakPriceState([up]), {price:110,color:'#d92c2c',reversal:false});
  assert.deepEqual(lineBreakPriceState([up,down]), {price:100,color:'#1f5bd8',reversal:true});
  assert.equal(lineBreakPriceState([down,up]).reversal,true);
  assert.equal(lineBreakPriceState([up,{open:110,close:120}]).reversal,false);
  assert.equal(lineBreakPriceState([down,{open:100,close:90}]).reversal,false);
});

test('unfinished source reversals remove the reversal notice again; unchanged source candles do not create one', () => {
  const source = [100,110,120,130,99].map((close,index)=>({time:index+1,close}));
  assert.equal(lineBreakPriceState(calculateThreeLineBreak(source)).reversal,true);
  source.at(-1).close = 105;
  assert.equal(lineBreakPriceState(calculateThreeLineBreak(source)).reversal,false);
  assert.equal(lineBreakPriceState(calculateThreeLineBreak(source)).price,130);
  source.at(-1).close = 99; source.push({time:6,close:98});
  assert.equal(lineBreakPriceState(calculateThreeLineBreak(source)).reversal,false);
  assert.equal(lineBreakPriceState(calculateThreeLineBreak(source)).color,'#1f5bd8');
});
