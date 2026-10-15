import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timeAtLogical,logicalAtTime,distanceToTrendLine } from '../public/trend-geometry.js';

test('line anchors follow actual trading dates across history refreshes and timeframes',()=>{
  const rows = [1000,1100,1400,2000].map(time=>({time}));
  assert.equal(timeAtLogical(rows,1.3),1100);
  assert.equal(logicalAtTime(rows,1250),1.5);
  assert.equal(logicalAtTime(rows,999),null);
  assert.equal(logicalAtTime(rows,2001),null);
  assert.equal(logicalAtTime([{time:900},...rows],1400),3);
  assert.equal(logicalAtTime([{time:1000},{time:2000}],1400),0.4);
});

test('selection targets visible line segments and endpoints',()=>{
  const line = {a:{x:10,y:20},b:{x:30,y:20}};
  assert.equal(distanceToTrendLine({x:20,y:23},line),3);
  assert.equal(distanceToTrendLine({x:40,y:20},line),10);
  assert.equal(distanceToTrendLine({x:10,y:20},{a:{x:10,y:20},b:{x:10,y:20}}),0);
});
