import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function server(t, time, kis = false) {
  const data = await mkdtemp(join(tmpdir(), 'stock8-session-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = fileURLToPath(new URL('./fixtures/korean-session-upstreams.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', fixture, 'server.js'], { cwd: root, env: { ...process.env, PORT: '0', STOCK8_DATA_DIR: data,
    STOCK8_PASSWORD: '1222', TEST_MARKET_TIME: time, KIS_APP_KEY: kis ? 'test-key' : '', KIS_APP_SECRET: kis ? 'test-secret' : '',
    KIS_FUTURES_APP_KEY: '', KIS_FUTURES_APP_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); await rm(data, { recursive: true, force: true }); });
  const port = await new Promise((resolve, reject) => {
    let output = '', errors = ''; const timer = setTimeout(() => reject(Error('server did not start: ' + errors)), 10000);
    child.on('error', reject); child.once('exit', code => { clearTimeout(timer); reject(Error('server exited ' + code + ': ' + errors)); });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const base = `http://127.0.0.1:${port}/stock8-7`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '1222' }) });
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  return async (symbol = '000660.KS', interval = '1m', limit = 700, mode = 'KRX', endpoint = 'chart') => {
    const response = await fetch(`${base}/api/${endpoint}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}&mode=${mode}`, { headers });
    assert.equal(response.status, 200);
    return response.json();
  };
}
const at = (date, time) => Date.parse(`${date}T${time}:00+09:00`) / 1000;

for (const kis of [false, true]) test(`KRX prior 20:00 bars and current after-market survive ${kis ? 'KIS dated history' : 'Naver fallback'} and aggregation`, async t => {
  const chart = await server(t, '2026-10-20T16:10:00+09:00', kis);
  const payload = await chart();
  assert.equal(payload.regularSessionOnly, false);
  assert.equal(payload.series.length, 700);
  assert.ok(payload.series.some(row => row.time === at('2026-10-19', '20:00')));
  assert.ok(payload.series.some(row => row.time === at('2026-10-19', '15:19')));
  assert.equal(payload.series.find(row => row.time === at('2026-10-20', '15:30')).close, 150);
  assert.equal(payload.series.at(-1).time, at('2026-10-20', '16:10'));
  assert.equal(payload.series.at(-1).close, 192);
  assert.equal(payload.marketStatus, '장후');
  assert.ok(payload.series.every(row => { const min = (row.time / 60 + 9 * 60) % 1440; return min < 920 || min === 930 || min >= 960; }));
  if (kis) { assert.equal(payload.kis.intradayOk, true); assert.ok(payload.kis.intradayCount > 700); }
  const five = await chart('000660.KS', '5m');
  assert.equal(five.series.find(row => row.time === at('2026-10-20', '15:30')).close, 150);
  assert.equal(five.series.at(-1).time, at('2026-10-20', '16:10'));
  const small = await chart('000660.KS', '1m', 80);
  assert.equal(small.series.length, 80);
  const index = await chart('^KS11');
  assert.equal(index.regularSessionOnly, true);
  assert.ok(index.series.every(row => (row.time / 60 + 9 * 60) % 1440 <= 930));
});

test('closing auction creates no artificial 15:20–15:29 candles; delayed print settles at 15:30', async t => {
  const auction = await server(t, '2026-10-20T15:25:00+09:00');
  const before = await auction();
  assert.equal(before.series.at(-1).time, at('2026-10-20', '15:19'));
  assert.equal(before.marketStatus, '동시호가');
  const settled = await server(t, '2026-10-20T15:32:00+09:00');
  const after = await settled();
  assert.equal(after.series.at(-1).time, at('2026-10-20', '15:30'));
  assert.equal(after.series.at(-1).close, 150);
});

test('stale quotes on a closed business date do not create current-date or after-market candles', async t => {
  const chart = await server(t, '2026-10-21T16:10:00+09:00');
  const payload = await chart();
  assert.equal(payload.marketStatus, '종가');
  assert.equal(payload.series.at(-1).time, at('2026-10-20', '20:00'));
});

for (const kis of [false, true]) test(`domestic ETFs stop at 15:30 in both market modes with ${kis ? 'KIS' : 'Naver'} history, including prior dates and delayed closing prints`, async t => {
  const chart = await server(t, '2026-10-20T16:10:00+09:00', kis);
  for (const symbol of ['069500.KS', '1234A0.KS']) {
    for (const mode of ['KRX', 'NTX']) {
      for (const interval of ['1m', '5m', '10m', '60m']) {
        const payload = await chart(symbol, interval, 700, mode);
        assert.ok(payload.series.length);
        assert.equal(payload.regularSessionOnly, true);
        assert.ok(payload.series.every(row => (row.time / 60 + 9 * 60) % 1440 <= 930));
        assert.equal(payload.price, 150);
        assert.equal(payload.marketTime, at('2026-10-20', '15:30'));
        assert.equal(payload.marketStatus, '종가');
        assert.equal(payload.change, payload.price - payload.previousClose);
        if (interval === '1m') {
          assert.equal(payload.series.length, 700);
          for (const date of ['2026-10-19', '2026-10-20']) {
            assert.equal(payload.series.find(row => row.time === at(date, '15:30')).close, 150);
            assert.ok(!payload.series.some(row => row.time > at(date, '15:30') && row.time <= at(date, '20:00')));
          }
        }
      }
    }
    const quote = await chart(symbol, '1m', 1, 'NTX', 'quote');
    assert.equal(quote.price, 150);
    assert.equal(quote.marketStatus, '종가');
    const intraday = await chart(symbol, '1m', 400, 'NTX', 'intraday');
    assert.equal(intraday.series.at(-1).time, at('2026-10-20', '15:30'));
  }
});

test('ETF closing auction can arrive one minute late and updates the 15:30 candle rather than adding a 15:31 bar', async t => {
  const chart = await server(t, '2026-10-20T15:31:00+09:00');
  const payload = await chart('069500.KS');
  assert.equal(payload.series.at(-1).time, at('2026-10-20', '15:30'));
  assert.equal(payload.series.at(-1).close, 150);
  assert.equal(payload.marketStatus, '종가');
});
