import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function server(t, session = 'after', kis = false) {
  const data = await mkdtemp(join(tmpdir(), 'stock8-us-price-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = fileURLToPath(new URL('./fixtures/us-price-upstreams.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', fixture, 'server.js'], { cwd: root, env: { ...process.env, PORT: '0', STOCK8_DATA_DIR: data,
    STOCK8_PASSWORD: '1222', TEST_US_SESSION: session, KIS_APP_KEY: kis ? 'fixture-key' : '', KIS_APP_SECRET: kis ? 'fixture-secret' : '',
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
  return async path => { const response = await fetch(base + path, { headers }); assert.equal(response.status, 200); return response.json(); };
}

test('US chart amount/rate use prior regular close for all periods and extended sessions, including ETFs', async t => {
  const get = await server(t);
  for (const symbol of ['AAPL.US', 'QQQ.US']) for (const interval of ['1m', '5m', '1d', '1wk', '1mo']) for (const mode of ['KRX', 'NTX']) {
    const p = await get(`/api/chart?symbol=${symbol}&interval=${interval}&mode=${mode}`);
    assert.equal(p.previousClose, 120, `${symbol} ${interval} ${mode}`);
    assert.equal(p.previousCloseDate, '2026-10-19');
    assert.equal(p.price, mode === 'NTX' ? 132 : 130);
    assert.equal(p.change, p.price - 120);
    assert.ok(Math.abs(p.changePercent - (p.price - 120) / 120 * 100) < 1e-10);
    assert.equal(p.changeBasis, 'previous-regular-close');
  }
  for (const endpoint of ['quote', 'intraday']) {
    const p = await get(`/api/${endpoint}?symbol=AAPL.US&mode=NTX`);
    assert.equal(p.previousClose, 120); assert.equal(p.price, 132); assert.equal(p.change, 12); assert.equal(p.changePercent, 10);
  }
});

test('Monday premarket compares Friday regular close, excluding the unfinished Monday daily candle', async t => {
  const get = await server(t, 'pre');
  for (const interval of ['1m', '1d', '1wk']) {
    const p = await get(`/api/chart?symbol=AAPL.US&interval=${interval}&mode=NTX`);
    assert.equal(p.price, 126); assert.equal(p.previousClose, 120); assert.equal(p.previousCloseDate, '2026-10-16');
    assert.equal(p.change, 6); assert.equal(p.changePercent, 5);
  }
});

test('KIS US quotes calculate amount and rate from base (regular close), never pvol (volume)', async t => {
  const get = await server(t, 'after', true);
  const p = await get('/api/quote?symbol=AAPL.US');
  assert.equal(p.source, 'kis'); assert.equal(p.kis.ok, true);
  assert.equal(p.price, 95); assert.equal(p.previousClose, 100);
  assert.equal(p.change, -5); assert.equal(p.changePercent, -5); assert.equal(p.changeRate, -5);
});
