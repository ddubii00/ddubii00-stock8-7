import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKisClient } from '../lib/kis-client.js';
import { createKisFutures, futuresTimestamp, parseFuturesRows, parseFuturesQuote, parseFuturesTicks, selectNasdaqContract, readFuturesMasterZip } from '../lib/kis-futures.js';

const at = Date.parse('2026-10-20T04:36:12Z');
const output = { proc_date: '20261020', proc_time: '133612', sbsnsdate: '20261020', last_price: '25000.75', prev_price: '25100', open_price: '25090', high_price: '25120', low_price: '24900' };
const row = (clock, price = '25000.25', date = '20261020') => ({ data_date: date, data_time: clock, open_price: price, high_price: '25200', low_price: '24800', last_price: price, vol: '100' });
function frame(price = '25001.25', clock = '133613', code = 'NQZ26') {
  const f = Array(25).fill('');
  Object.assign(f, { 0: code, 1: '20261020', 6: '25100', 7: '20261020', 8: clock, 10: price, 11: '2', 14: '25090', 15: '25120', 16: '24900' });
  return '0|HDFFF020|001|' + f.join('^');
}
class Socket extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; Socket.instances.push(this); }
  send(message) { this.sent.push(message); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  message(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

test('KIS master selects only the real NQ near-month contract, excluding micro and spread contracts', () => {
  const line = (code, near, active, product = 'NQ') => {
    const chars = Array(223).fill(' ');
    const put = (start, value) => [...value].forEach((v, i) => { chars[start + i] = v; });
    put(0, code); put(132, 'CME'); put(142, product); put(217, active); put(218, near);
    return chars.join('') + '\n';
  };
  const data = line('MNQZ26', '1', '1', 'MNQ') + line('NQZ26-H27', '1', '1', 'NQNQ') + line('NQH27', '0', '0') + line('NQZ26', '1', '1');
  assert.equal(selectNasdaqContract(data), 'NQZ26');
  assert.equal(selectNasdaqContract(line('NQH27', '0', '1')), 'NQH27');
  assert.equal(selectNasdaqContract(line('NQZ26', '0', '0')), null);
  assert.throws(() => readFuturesMasterZip(Buffer.from('bad zip')), /종목파일/);
});

test('KIS futures preserve fractional prices, negative changes, source timestamps and configurable time zones', () => {
  assert.equal(futuresTimestamp('20261020', '133612'), at / 1000);
  assert.equal(futuresTimestamp('20260701', '093000', 'America/New_York'), Date.parse('2026-07-01T13:30:00Z') / 1000);
  assert.equal(futuresTimestamp('20260101', '093000', 'America/New_York'), Date.parse('2026-01-01T14:30:00Z') / 1000);
  assert.ok(Number.isNaN(futuresTimestamp('20260230', '133612')));
  assert.ok(Number.isNaN(futuresTimestamp('20261020', '250000')));
  const quote = parseFuturesQuote(output, 'NQZ26');
  assert.equal(quote.price, 25000.75); assert.equal(quote.change, -99.25); assert.equal(quote.marketTime, at / 1000);
  assert.equal(quote.realtime, false);
  assert.throws(() => parseFuturesQuote({ ...output, last_price: '' }, 'NQZ26'));
  const parsed = parseFuturesRows({ output1: [row('133600'), row('133500'), row('133500', '25001.75'), row('250000')], output2: { index_key: 'next' } }, true);
  assert.equal(parsed.length, 2); assert.equal(parsed[0].close, 25001.75); assert.equal(parsed[1].close, 25000.25);
  const ticks = parseFuturesTicks(frame(), 'NQZ26');
  assert.equal(ticks.length, 1); assert.equal(ticks[0].source, 'kis-futures-websocket'); assert.equal(ticks[0].marketTime, at / 1000 + 1);
  assert.equal(parseFuturesTicks(frame('25001', '133613', 'NQH27'), 'NQZ26').length, 0);
  assert.equal(parseFuturesTicks('1|HDFFF020|001|encrypted', 'NQZ26').length, 0);
});

test('KIS client shares concurrent token issuance, authenticates only to KIS, and never returns credentials in errors', async () => {
  let tokens = 0, approvals = 0, calls = 0;
  const client = createKisClient({ appKey: 'test-key', appSecret: 'test-secret', baseUrl: 'https://kis.example', now: () => at,
    fetcher: async (input, timeout, options) => {
      const url = new URL(input);
      if (url.pathname.endsWith('tokenP')) { tokens++; return Response.json({ access_token: 'test-token', expires_in: 86400 }); }
      if (url.pathname.endsWith('Approval')) { approvals++; assert.equal(JSON.parse(options.body).secretkey, 'test-secret'); return Response.json({ approval_key: 'test-approval' }); }
      calls++; assert.equal(options.headers.authorization, 'Bearer test-token'); assert.equal(options.headers.tr_id, 'TEST');
      return Response.json({ rt_cd: '0', output1: output });
    } });
  await Promise.all(Array.from({ length: 4 }, () => client.request('/quote', 'TEST', { SRS_CD: 'NQZ26' })));
  assert.equal(tokens, 1); assert.equal(calls, 4);
  assert.deepEqual(await Promise.all([client.approval(), client.approval()]), ['test-approval', 'test-approval']);
  assert.equal(approvals, 1); assert.equal(tokens, 1);
  let failures = 0;
  const bad = createKisClient({ appKey: 'secret-key', appSecret: 'secret-value', baseUrl: 'https://kis.example', now: () => at,
    fetcher: async () => { failures++; return Response.json({ msg1: 'secret-key secret-value' }); } });
  await assert.rejects(bad.request('/quote', 'TEST', {}), error => !/secret-key|secret-value/.test(error.message));
  await assert.rejects(bad.request('/quote', 'TEST', {})); assert.equal(failures, 1);
});

test('futures chart paginates and shares REST history; websocket ticks update OHLC without ten-minute Yahoo gaps', async t => {
  let clock = at, historyCalls = 0, quotes = 0;
  const api = createKisFutures({ contractOverride: 'NQZ26', now: () => clock, WebSocketImpl: Socket, approval: async () => 'approval',
    request: async (path, tr, params) => {
      assert.equal(params.SRS_CD, 'NQZ26');
      if (path.endsWith('inquire-price')) { quotes++; assert.equal(tr, 'HHDFC55010000'); return { output1: output }; }
      historyCalls++; assert.equal(params.EXCH_CD, 'CME'); assert.equal(tr, 'HHDFC55020400');
      return params.QRY_TP === 'Q' ? { output1: [row('133600'), row('133500')], output2: { index_key: 'page2' } }
        : { output2: [row('133500'), row('133400')], output1: { index_key: '' } };
    } });
  t.after(() => api.close());
  const results = await Promise.all([api.chart('1m', 121), api.chart('1m', 121)]);
  assert.equal(historyCalls, 2); assert.equal(quotes, 1); assert.equal(results[0].series.length, 3);
  assert.equal(results[0].series.at(-1).close, 25000.75); assert.equal(results[0].realtime, false);
  const ws = Socket.instances.at(-1); ws.open();
  const subscription = JSON.parse(ws.sent[0]); assert.equal(subscription.body.input.tr_id, 'HDFFF020'); assert.equal(subscription.body.input.tr_key, 'NQZ26');
  clock += 1000; ws.message(frame('25010.75'));
  clock += 1000; ws.message(frame('24990.25', '133614'));
  const streamed = await api.chart('1m', 121);
  assert.equal(streamed.source, 'kis-futures-websocket'); assert.equal(streamed.marketStatus, '실시간');
  assert.equal(streamed.series.at(-1).open, 25000.25); assert.equal(streamed.series.at(-1).high, 25200);
  assert.equal(streamed.series.at(-1).low, 24800); assert.equal(streamed.series.at(-1).close, 24990.25);
  assert.equal(quotes, 1); assert.equal(historyCalls, 2);
  ws.message(JSON.stringify({ header: { tr_id: 'PINGPONG' } })); assert.equal(JSON.parse(ws.sent.at(-1)).header.tr_id, 'PINGPONG');
  ws.message(JSON.stringify({ header: { tr_id: 'HDFFF020' }, body: { rt_cd: '1', msg1: 'mci send failed' } }));
  const rejected = await api.quote(); assert.equal(rejected.realtime, false); assert.match(rejected.streamError, /CME 유료시세/);
});

test('three-minute and daily/weekly/monthly charts retain KIS history and update the matching session', async t => {
  const paths = [];
  const api = createKisFutures({ contractOverride: 'NQZ26', now: () => at, WebSocketImpl: null,
    request: async (path, tr, params) => {
      paths.push(path);
      if (path.endsWith('inquire-price')) return { output1: output };
      assert.equal(params.QRY_GAP, path.includes('futurechartprice') ? '1' : '');
      return { output2: [row('133600'), row('133500'), row('133400'), row('133300')], output1: { index_key: '' } };
    } });
  t.after(() => api.close());
  const three = await api.chart('3m', 400);
  assert.equal(three.series.length, 2); assert.equal(three.series[0].volume, 300); assert.equal(three.series.at(-1).close, 25000.75);
  for (const interval of ['1d', '1wk', '1mo']) {
    const daily = await api.chart(interval, 400);
    assert.equal(daily.series.length, 1); assert.equal(daily.series.at(-1).close, 25000.75);
  }
  for (const endpoint of ['daily-ccnl', 'weekly-ccnl', 'monthly-ccnl']) assert.ok(paths.some(path => path.endsWith(endpoint)));
});

test('failed KIS history is an error, never synthetic candles or delayed Yahoo data', async () => {
  const api = createKisFutures({ contractOverride: 'NQZ26', now: () => at, WebSocketImpl: null,
    request: async path => path.endsWith('inquire-price') ? { output1: output } : { output1: [] } });
  await assert.rejects(api.chart('1m', 400), /KIS 선물 차트/);
  const invalid = createKisFutures({ contractOverride: '../NQZ26', request: async () => assert.fail() });
  await assert.rejects(invalid.quote(), /월물코드/);
});

test('KIS history still displays real futures candles when only the quote endpoint returns HTTP 500', async () => {
  const api = createKisFutures({ contractOverride: 'NQZ26', now: () => at, WebSocketImpl: null,
    request: async path => {
      if (path.endsWith('inquire-price')) throw Object.assign(new Error('KIS HHDFC55010000 HTTP 500'), { kisHttpStatus: 500 });
      return { output1: [row('133500'), row('133600')], output2: { index_key: '' } };
    } });
  const result = await api.chart('1m', 40);
  assert.equal(result.source, 'kis-futures-history');
  assert.equal(result.marketStatus, 'KIS 봉 시세 (현재가 오류)');
  assert.equal(result.price, 25000.25);
  assert.equal(result.previousClose, null);
  assert.equal(result.changePercent, null);
  assert.equal(result.series.length, 2);
});

test('an appkey used by stock5-8 is left alone and retries wait five minutes; websocket paths are not duplicated', async t => {
  let clock = at;
  const api = createKisFutures({ contractOverride: 'NQZ26', now: () => clock, WebSocketImpl: Socket,
    wsUrl: 'ws://kis.example:21000/tryitout', approval: async () => 'approval', request: async () => ({ output1: output }) });
  t.after(() => api.close());
  await api.quote();
  const ws = Socket.instances.at(-1), before = Socket.instances.length;
  assert.equal(ws.url, 'ws://kis.example:21000/tryitout'); ws.open();
  ws.message(JSON.stringify({ header: { tr_id: 'HDFFF020' }, body: { rt_cd: '1', msg1: 'ALREADY IN USE appkey' } }));
  clock += 31000;
  const unavailable = await api.quote();
  assert.match(unavailable.streamError, /다른 앱/); assert.equal(Socket.instances.length, before);
  clock += 5 * 60000;
  await api.quote(); await Promise.resolve();
  assert.equal(Socket.instances.length, before + 1);
  assert.equal((await api.quote()).marketStatus, 'KIS 지연/마감');
});

test('automatic NQ rollover checks the master every five minutes, changes subscription and isolates contract prices/history', async t => {
  let clock = at, selected = 'NQZ26', downloads = 0;
  const masterZip = code => {
    const chars = Array(223).fill(' ');
    for (const [start, value] of [[0,code],[132,'CME'],[142,'NQ'],[217,'1'],[218,'1']]) [...value].forEach((v,i) => { chars[start+i] = v; });
    const data = Buffer.from(chars.join('') + '\n'), name = Buffer.from('ffcode.mst');
    const local = Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    const central = Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
    const end = Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);
    return Buffer.concat([local,name,data,central,name,end]);
  };
  const requested = [];
  const api = createKisFutures({ now:()=>clock, WebSocketImpl:Socket, approval:async ()=>'approval',
    fetcher:async () => { downloads++; return new Response(masterZip(selected)); },
    request:async (path,tr,params) => {
      requested.push(params.SRS_CD);
      const price = params.SRS_CD === 'NQZ26' ? 25000 : 35000;
      const p = { ...output, last_price:String(price), prev_price:String(price-100), open_price:String(price), high_price:String(price+10), low_price:String(price-10) };
      return path.endsWith('inquire-price') ? {output1:p} : {output2:[{...p, data_date:'20261020', data_time:'133600', vol:'10'}]};
    } });
  t.after(()=>api.close());
  const first = await api.chart('1m',40);
  assert.equal(first.contract,'NQZ26');assert.equal(first.contractMode,'automatic');assert.equal(first.price,25000);
  await Promise.resolve();const oldSocket=Socket.instances.at(-1);oldSocket.open();
  oldSocket.message(frame('25005.75'));
  selected='NQH27';clock+=4*60000;
  assert.equal(await api.contract(),'NQZ26');assert.equal(downloads,1);
  clock+=60001;
  const second=await api.chart('1m',40);
  assert.equal(downloads,2);assert.equal(second.contract,'NQH27');assert.equal(second.price,35000);
  assert.ok(second.series.every(r=>r.low>34000));assert.equal(oldSocket.readyState,3);
  await Promise.resolve();const newSocket=Socket.instances.at(-1);newSocket.open();
  assert.equal(JSON.parse(newSocket.sent[0]).body.input.tr_key,'NQH27');
  oldSocket.message(frame('99999.75'));
  assert.equal((await api.chart('1m',40)).price,35000);
  assert.ok(requested.includes('NQZ26')&&requested.includes('NQH27'));
});
