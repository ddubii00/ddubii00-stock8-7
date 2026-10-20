import { readKisMasterZip } from './kis-master.js';

const ROOT = '/uapi/overseas-futureoption/v1/quotations/';
const MASTER_URL = 'https://new.real.download.dws.co.kr/common/master/ffcode.mst.zip';
const number = value => value === '' || value == null ? NaN : Number(String(value).replaceAll(',', ''));
const list = value => Array.isArray(value) ? value : value ? [value] : [];
const failure = message => Object.assign(new Error(message), { status: 503 });

export const readFuturesMasterZip = input => readKisMasterZip(input, 'ffcode.mst');

export function selectNasdaqContract(master) {
  const contracts = master.split(/\r?\n/).filter(Boolean).map(line => {
    // Official fixed-width offsets include the final newline.
    const row = line + '\n';
    return { code: row.slice(0, 32).trim(), exchange: row.slice(-92, -82).trim(),
      product: row.slice(-82, -72).trim(), near: row.slice(-6, -5), active: row.slice(-7, -6) };
  }).filter(item => /^NQ[HMUZ]\d{2}$/.test(item.code) && item.exchange === 'CME' && item.product === 'NQ');
  return contracts.find(item => item.near === '1')?.code || contracts.find(item => item.active === '1')?.code || null;
}

export function futuresTimestamp(date, time = '000000', timeZone = 'Asia/Seoul') {
  const day = String(date || '').trim(), clock = String(time || '0').trim().padStart(6, '0');
  if (!/^\d{8}$/.test(day) || !/^\d{6}$/.test(clock)) return NaN;
  const parts = [day.slice(0, 4), day.slice(4, 6), day.slice(6), clock.slice(0, 2), clock.slice(2, 4), clock.slice(4)].map(Number);
  const [year, month, d, hour, minute, second] = parts;
  const wall = Date.UTC(year, month - 1, d, hour, minute, second);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== d || hour > 23 || minute > 59 || second > 59) return NaN;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(utc)).map(x => [x.type, x.value]));
    const displayed = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    utc += wall - displayed;
  }
  return utc / 1000;
}

export function parseFuturesRows(json, intraday, timeZone = 'Asia/Seoul') {
  const rows = new Map();
  for (const item of [...list(json.output1), ...list(json.output2)]) {
    const time = futuresTimestamp(item.data_date, intraday ? item.data_time : '000000', intraday ? timeZone : 'UTC');
    const [open, high, low, close] = ['open_price', 'high_price', 'low_price', 'last_price'].map(key => number(item[key]));
    if (!Number.isFinite(time) || ![open, high, low, close].every(x => Number.isFinite(x) && x > 0) || high < Math.max(open, close) || low > Math.min(open, close)) continue;
    rows.set(time, { time, open, high, low, close, volume: Math.max(0, number(item.vol) || 0) });
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

export function parseFuturesQuote(output, contract, timeZone = 'Asia/Seoul') {
  const price = number(output.last_price), previousClose = number(output.prev_price);
  const time = futuresTimestamp(output.proc_date, output.proc_time, timeZone);
  if (![price, previousClose].every(x => Number.isFinite(x) && x > 0) || !Number.isFinite(time)) throw failure('KIS 선물 현재가 또는 시각이 올바르지 않습니다.');
  const change = price - previousClose;
  return { symbol: 'NQ=F', contract, price, previousClose, change, changePercent: change / previousClose * 100,
    changeRate: change / previousClose * 100, marketTime: time, asOf: time,
    sessionDate: String(output.sbsnsdate || output.proc_date), open: number(output.open_price), high: number(output.high_price), low: number(output.low_price),
    marketStatus: 'KIS 시세', source: 'kis-futures-rest', realtime: false };
}

export function parseFuturesTicks(message, contract, timeZone = 'Asia/Seoul') {
  const [encrypted, tr, count, data] = String(message).split('|');
  if (encrypted !== '0' || tr !== 'HDFFF020' || !data || !/^\d+$/.test(count)) return [];
  const fields = data.split('^'), ticks = [];
  for (let i = 0; i < Math.min(Number(count), 1000); i++) {
    const f = fields.slice(i * 25, (i + 1) * 25);
    if (f.length !== 25 || f[0].trim() !== contract) continue;
    try {
      ticks.push({ ...parseFuturesQuote({ proc_date: f[7], proc_time: f[8], sbsnsdate: f[1], last_price: f[10], prev_price: f[6], open_price: f[14], high_price: f[15], low_price: f[16] }, contract, timeZone),
        volume: Math.max(0, number(f[11]) || 0), marketStatus: '실시간', source: 'kis-futures-websocket', realtime: true });
    } catch { /* Ignore incomplete ticks without corrupting the last valid quote. */ }
  }
  return ticks;
}

export function createKisFutures({ request, approval, fetcher, contractOverride = '', wsUrl = 'ws://ops.koreainvestment.com:21000',
  timeZone = 'Asia/Seoul', WebSocketImpl = globalThis.WebSocket, now = Date.now }) {
  let contractCache, contractTask, socket, connecting, nextConnect = 0, lastRead = 0, socketError = '', tick, tickReceived = 0, activeContract;
  const caches = new Map(), pending = new Map(), tickRows = new Map();
  async function cached(key, ttl, work) {
    const value = caches.get(key);
    if (value && value.until > now()) { if (value.error) throw value.error; return value.data; }
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try { const data = await work(); caches.set(key, { data, until: now() + ttl }); return data; }
      catch (error) { caches.set(key, { error, until: now() + 3000 }); throw error; }
      finally { pending.delete(key); }
    })();
    pending.set(key, task);
    return task;
  }
  async function contract() {
    if (contractOverride) {
      if (!/^NQ[HMUZ]\d{2}$/.test(contractOverride)) throw failure('KIS_NQ_CONTRACT 월물코드가 올바르지 않습니다.');
      return contractOverride;
    }
    if (contractCache?.until > now()) return contractCache.code;
    if (!contractTask) contractTask = (async () => {
      const res = await fetcher(MASTER_URL, 6000);
      if (!res.ok) throw failure('KIS 선물 종목파일을 받지 못했습니다.');
      const code = selectNasdaqContract(readFuturesMasterZip(await res.arrayBuffer()));
      if (!code) throw failure('KIS 나스닥100 최근월물을 찾지 못했습니다.');
      contractCache = { code, until: now() + 6 * 60 * 60 * 1000 };
      return code;
    })().finally(() => { contractTask = null; });
    return contractTask;
  }
  function acceptTick(next) {
    if (next.marketTime > now() / 1000 + 120 || (tick && tick.contract === next.contract && next.marketTime < tick.marketTime)) return;
    tick = next; tickReceived = now(); socketError = '';
    const bucket = Math.floor(next.marketTime / 60) * 60;
    const old = tickRows.get(bucket);
    tickRows.set(bucket, old ? { ...old, high: Math.max(old.high, next.price), low: Math.min(old.low, next.price), close: next.price, volume: old.volume + next.volume }
      : { time: bucket, open: next.price, high: next.price, low: next.price, close: next.price, volume: next.volume });
    if (tickRows.size > 10000) tickRows.delete(tickRows.keys().next().value);
  }
  function ensureSocket(code) {
    if (activeContract !== code) { socket?.close(); socket = null; tick = null; tickRows.clear(); activeContract = code; nextConnect = 0; }
    if (!WebSocketImpl || !approval || connecting || now() < nextConnect) return;
    if (socket?.contract === code && [0, 1].includes(socket.readyState)) return;
    if (socket) { socket.close(); socket = null; tick = null; tickRows.clear(); }
    connecting = (async () => {
      const key = await approval();
      const endpoint = wsUrl.replace(/\/$/, '');
      const ws = new WebSocketImpl(endpoint.endsWith('/tryitout') ? endpoint : endpoint + '/tryitout');
      socket = ws; ws.contract = code;
      const timeout = setTimeout(() => { if (ws.readyState === 0) ws.close(); }, 10000); timeout.unref?.();
      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        ws.send(JSON.stringify({ header: { approval_key: key, custtype: 'P', tr_type: '1', 'content-type': 'utf-8' }, body: { input: { tr_id: 'HDFFF020', tr_key: code } } }));
      });
      ws.addEventListener('message', event => {
        if (socket !== ws) return;
        if (now() - lastRead > 120000) { ws.close(); return; }
        const message = String(event.data);
        if (message.startsWith('{')) {
          try {
            const json = JSON.parse(message);
            if (json.header?.tr_id === 'PINGPONG') ws.send(message);
            else if (json.body?.rt_cd && json.body.rt_cd !== '0') {
              const inUse = /ALREADY IN USE appkey/i.test(json.body.msg1 || '');
              socketError = inUse ? '같은 API 키를 다른 앱에서 사용 중입니다. 해외선물용 별도 키를 설정하세요.'
                : '실시간 구독 실패: 해외선물 API 권한과 CME 유료시세 신청을 확인하세요.';
              if (inUse) ws.blockedUntil = now() + 5 * 60000;
              tick = null; ws.close();
            }
          } catch { /* Ignore non-price control frames. */ }
        } else for (const next of parseFuturesTicks(message, code, timeZone)) acceptTick(next);
      });
      ws.addEventListener('error', () => { socketError = 'KIS 실시간 연결을 확인하세요.'; });
      ws.addEventListener('close', () => { clearTimeout(timeout); if (socket === ws) { socket = null; nextConnect = Math.max(now() + 30000, ws.blockedUntil || 0); } });
    })().catch(() => { socketError = 'KIS 실시간 접속키를 받지 못했습니다.'; nextConnect = now() + 30000; }).finally(() => { connecting = null; });
  }
  async function quote() {
    lastRead = now();
    const code = await contract();
    ensureSocket(code);
    if (tick?.contract === code && now() - tickReceived < 15000 && now() / 1000 - tick.marketTime < 120) return { ...tick, streamError: socketError };
    const value = await cached('quote:' + code, 800, async () => {
      let json;
      try { json = await request(ROOT + 'inquire-price', 'HHDFC55010000', { SRS_CD: code }); }
      catch (error) { throw failure(`[${code}] ${error.message}`); }
      return parseFuturesQuote(list(json.output1)[0] || {}, code, timeZone);
    });
    return { ...value, marketStatus: now() / 1000 - value.marketTime > 120 ? 'KIS 지연/마감' : 'KIS 시세',
      streamError: socketError || (!WebSocketImpl ? '실시간 연결에는 Node.js 22 이상이 필요합니다.' : '실시간 체결 수신 대기 중') };
  }
  async function history(code, interval, limit) {
    const intraday = !['1d', '1wk', '1mo'].includes(interval);
    // KIS has no three-minute request; aggregate one-minute data for that interval.
    const spec = intraday ? ['inquire-time-futurechartprice', 'HHDFC55020400', 120] : interval === '1wk' ? ['weekly-ccnl', 'HHDFC55020000', 40] : interval === '1mo' ? ['monthly-ccnl', 'HHDFC55020300', 40] : ['daily-ccnl', 'HHDFC55020100', 40];
    const minutes = intraday ? Math.max(1, Number.parseInt(interval)) : 1;
    const gap = intraday && minutes !== 3 ? minutes : 1;
    const needed = Math.min(10000, limit * (minutes / gap));
    return cached(`history:${code}:${interval}:${limit}`, intraday ? 15000 : 60000, async () => {
      const byTime = new Map();
      let index = '';
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now())).replaceAll('-', '');
      for (let page = 0; page < Math.ceil(needed / spec[2]); page++) {
        const json = await request(ROOT + spec[0], spec[1], { SRS_CD: code, EXCH_CD: 'CME', START_DATE_TIME: '', CLOSE_DATE_TIME: date,
          QRY_TP: index ? 'P' : 'Q', QRY_CNT: String(spec[2]), QRY_GAP: intraday ? String(gap) : '', INDEX_KEY: index });
        const rows = parseFuturesRows(json, intraday, timeZone);
        const before = byTime.size;
        // Keep the newest page's overlap rather than an older repeated copy.
        for (const row of rows) if (!byTime.has(row.time)) byTime.set(row.time, row);
        const meta = [...list(json.output1), ...list(json.output2)].find(item => item.index_key);
        const next = String(meta?.index_key || '').trim();
        if (!next || next === index || byTime.size === before || byTime.size >= needed) break;
        index = next;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const series = [...byTime.values()].sort((a, b) => a.time - b.time);
      if (!series.length) throw failure('KIS 선물 차트 데이터를 받지 못했습니다. 해외선물 API 권한을 확인하세요.');
      return series;
    });
  }
  async function chart(interval = '1m', limit = 400) {
    const current = await quote();
    let series = (await history(current.contract, interval, limit)).map(row => ({ ...row }));
    const intraday = !['1d', '1wk', '1mo'].includes(interval);
    if (intraday) {
      const seconds = Number.parseInt(interval) * 60;
      const aggregated = new Map();
      for (const row of series) {
        const time = Math.floor(row.time / seconds) * seconds, old = aggregated.get(time);
        aggregated.set(time, old ? { ...old, high: Math.max(old.high, row.high), low: Math.min(old.low, row.low), close: row.close, volume: old.volume + row.volume } : { ...row, time });
      }
      const historyLastTime = series.at(-1).time;
      // REST supplies complete candles; ticks only extend its latest bucket.
      for (const row of [...tickRows.values()].sort((a, b) => a.time - b.time)) {
        if (row.time < historyLastTime) continue;
        const time = Math.floor(row.time / seconds) * seconds, old = aggregated.get(time);
        aggregated.set(time, old ? { ...old, high: Math.max(old.high, row.high), low: Math.min(old.low, row.low), close: row.close } : { ...row, time });
      }
      const time = Math.floor(current.marketTime / seconds) * seconds, old = aggregated.get(time);
      if (current.marketTime >= historyLastTime) aggregated.set(time, old ? { ...old, high: Math.max(old.high, current.price), low: Math.min(old.low, current.price), close: current.price }
        : { time, open: current.price, high: current.price, low: current.price, close: current.price, volume: 0 });
      series = [...aggregated.values()].sort((a, b) => a.time - b.time);
    } else {
      const periodStart = time => {
        const d = new Date(time * 1000);
        return interval === '1wk' ? time - ((d.getUTCDay() + 6) % 7) * 86400
          : interval === '1mo' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 : time;
      };
      const periods = new Map();
      for (const row of series) {
        const time = periodStart(row.time), old = periods.get(time);
        periods.set(time, old ? { ...old, high: Math.max(old.high, row.high), low: Math.min(old.low, row.low), close: row.close, volume: old.volume + row.volume } : { ...row, time });
      }
      series = [...periods.values()];
      const day = futuresTimestamp(current.sessionDate, '000000', 'UTC');
      const bucket = Number.isFinite(day) ? periodStart(day) : NaN;
      const last = series.at(-1);
      if (Number.isFinite(bucket) && bucket >= last.time && [current.open, current.high, current.low].every(x => Number.isFinite(x) && x > 0)) {
        if (bucket === last.time) series[series.length - 1] = { ...last, high: Math.max(last.high, current.high, current.price), low: Math.min(last.low, current.low, current.price), close: current.price };
        else series.push({ time: bucket, open: current.open, high: Math.max(current.high, current.price), low: Math.min(current.low, current.price), close: current.price, volume: 0 });
      }
    }
    return { ...current, series: series.slice(-limit) };
  }
  return { quote, chart, contract, close() { nextConnect = Infinity; socket?.close(); } };
}
