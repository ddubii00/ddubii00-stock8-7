import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function server(t, code, extraEnv = {}) {
  const data = await mkdtemp(join(tmpdir(), 'stock8-kis-futures-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = fileURLToPath(new URL('./fixtures/kis-futures-upstreams.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', fixture, 'server.js'], { cwd: root, env: { ...process.env, PORT: '0', STOCK8_DATA_DIR: data,
    STOCK8_PASSWORD: '1222', KIS_APP_KEY: 'fixture-key', KIS_APP_SECRET: 'fixture-secret', KIS_BASE_URL: 'https://openapi.koreainvestment.com:9443',
    KIS_FUTURES_APP_KEY: '', KIS_FUTURES_APP_SECRET: '', KIS_NQ_CONTRACT: code, KIS_FUTURES_TIME_ZONE: 'Asia/Seoul', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); await rm(data, { recursive: true, force: true }); });
  const port = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('server did not start')), 10000);
    child.on('error', reject); child.once('exit', code => { clearTimeout(timer); reject(Error('server exited ' + code)); });
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const base = `http://127.0.0.1:${port}/stock8-7`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '1222' }) });
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  return path => fetch(base + path, { headers });
}

test('configured KIS routes NQ quotes and every chart timeframe through authenticated KIS data', async t => {
  const get = await server(t, 'NQZ26');
  const responses = await Promise.all(Array.from({ length: 4 }, () => get('/api/chart?symbol=NQ%3DF&interval=1m&limit=121')));
  for (const response of responses) {
    assert.equal(response.status, 200);
    const p = await response.json();
    assert.equal(p.symbol, 'NQ=F'); assert.equal(p.contract, 'NQZ26'); assert.equal(p.price, 30000.75);
    assert.equal(p.source, 'kis-futures-rest'); assert.equal(p.kis.ok, true); assert.equal(p.kis.futuresEnabled, true);
    assert.equal(p.series.length, 121); assert.equal(p.series.at(-1).close, 30000.75); assert.equal(p.decimals, 2);
    assert.ok(Math.abs(Date.now() / 1000 - p.marketTime) < 10); assert.equal(p.realtime, false);
    assert.doesNotMatch(JSON.stringify(p), /fixture-key|fixture-secret|fixture-token/);
  }
  for (const interval of ['3m', '5m', '10m', '15m', '30m', '60m', '1d', '1wk', '1mo']) {
    const response = await get(`/api/chart?symbol=NQ%3DF&interval=${interval}&limit=120`);
    assert.equal(response.status, 200, interval);
    const p = await response.json(); assert.equal(p.source, 'kis-futures-rest'); assert.equal(p.price, 30000.75); assert.ok(p.series.length);
  }
  const quote = await (await get('/api/quote?symbol=NQ%3DF')).json();
  assert.equal(quote.contract, 'NQZ26'); assert.equal(quote.price, 30000.75); assert.equal(quote.change, -99.25);
  const intraday = await (await get('/api/intraday?symbol=NQ%3DF')).json();
  assert.equal(intraday.source, 'kis-futures-rest'); assert.ok(intraday.series.length > 120);
});

test('KIS entitlement failures are visible errors and cannot silently turn into Yahoo or sample prices', async t => {
  const get = await server(t, 'NQH27');
  for (const path of ['/api/chart?symbol=NQ%3DF&interval=1m', '/api/quote?symbol=NQ%3DF']) {
    const response = await get(path); assert.equal(response.status, 503);
    const p = await response.json(); assert.match(p.error, /KIS.*CME/); assert.equal(p.series, undefined);
    assert.doesNotMatch(JSON.stringify(p), /fixture-secret|fixture-token/);
  }
});

test('HTTP 500 preserves the KIS error code and reason instead of labeling all failures as CME permission errors', async t => {
  const get = await server(t, 'NQM27');
  for (const path of ['/api/chart?symbol=NQ%3DF&interval=1m', '/api/quote?symbol=NQ%3DF']) {
    const response = await get(path); assert.equal(response.status, 503);
    const p = await response.json();
    assert.match(p.error, /HHDFC55010000 HTTP 500.*EGW00201.*초당/);
    assert.doesNotMatch(p.error, /CME|fixture-key|fixture-secret|fixture-token/);
    assert.equal(p.series, undefined);
  }
});

test('token issuance limit falls back only to real, visibly delayed Yahoo futures bars', async t => {
  const get = await server(t, 'NQU27');
  for (const path of ['/api/chart?symbol=NQ%3DF&interval=1m&limit=80', '/api/quote?symbol=NQ%3DF', '/api/intraday?symbol=NQ%3DF']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const payload = await response.json();
    assert.equal(payload.source, 'yahoo-futures-fallback');
    assert.equal(payload.marketStatus, 'Yahoo 지연 시세');
    assert.equal(payload.realtime, false);
    assert.equal(payload.kis.ok, false);
    assert.match(payload.kis.error, /EGW00133/);
    assert.ok(payload.price > 0);
    if (path.includes('chart') || path.includes('intraday')) assert.ok(payload.series.length > 0);
    assert.doesNotMatch(JSON.stringify(payload), /fixture-key|fixture-secret|fixture-token/);
  }
});

test('token limit with no real alternate source remains an error, never sample futures data', async t => {
  const get = await server(t, 'NQU27', { FIXTURE_YAHOO_DOWN: '1' });
  const response = await get('/api/chart?symbol=NQ%3DF&interval=1m');
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /EGW00133/);
  assert.equal(payload.series, undefined);
});

test('a quote-only KIS HTTP 500 still shows actual KIS history without inventing a change rate', async t => {
  const get = await server(t, 'NQZ27');
  const response = await get('/api/chart?symbol=NQ%3DF&interval=1m&limit=80');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source, 'kis-futures-history');
  assert.equal(payload.marketStatus, 'KIS 봉 시세 (현재가 오류)');
  assert.equal(payload.changePercent, null);
  assert.equal(payload.series.length, 80);
  assert.equal(payload.price, payload.series.at(-1).close);
  const quote = await get('/api/quote?symbol=NQ%3DF');
  assert.equal(quote.status, 503);
});
