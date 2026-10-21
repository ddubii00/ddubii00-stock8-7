const INDEX_CODES = { '^KS11': 'KOSPI', '^KQ11': 'KOSDAQ' };

export function parseNaverIndexMinutes(payload) {
  const byTime = new Map();
  for (const point of payload?.priceInfos || []) {
    const stamp = String(point.localDateTime || '');
    if (!/^\d{14}$/.test(stamp)) continue;
    const time = Date.parse(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}+09:00`) / 1000;
    const [open, high, low, close] = [point.openPrice, point.highPrice, point.lowPrice, point.currentPrice].map(Number);
    if (!Number.isFinite(time) || ![open, high, low, close].every(value => Number.isFinite(value) && value > 0)) continue;
    const cumulative = Number(point.accumulatedTradingVolume);
    byTime.set(time, { time, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close,
      cumulative: Number.isFinite(cumulative) && cumulative >= 0 ? cumulative : 0, date: stamp.slice(0,8) });
  }
  const rows = [...byTime.values()].sort((a, b) => a.time - b.time);
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const volume = previous?.date === row.date && row.cumulative >= previous.cumulative
      ? row.cumulative - previous.cumulative : row.cumulative;
    return { time: row.time, open: row.open, high: row.high, low: row.low, close: row.close, volume, source: 'naver-index-minute' };
  });
}

// One shared current-session request for both candle and line-break views.
export function createNaverIndexHistory({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  return async symbol => {
    const code = INDEX_CODES[symbol];
    if (!code) return [];
    const saved = cache.get(code);
    if (saved?.pending) return saved.pending;
    if (saved?.until > now()) {
      if (saved.error) throw saved.error;
      return saved.rows;
    }
    const entry = {};
    cache.set(code, entry);
    entry.pending = (async () => {
      try {
        const response = await fetcher(`https://api.stock.naver.com/chart/domestic/index/${code}?periodType=day`, 3500);
        if (!response.ok) throw new Error(`Naver index minutes HTTP ${response.status}`);
        const rows = parseNaverIndexMinutes(await response.json());
        if (!rows.length) throw new Error('Naver index minutes unavailable');
        entry.rows = rows;
        entry.until = now() + 7000;
        return rows;
      } catch (error) {
        entry.error = error;
        entry.until = now() + 2000;
        throw error;
      } finally { entry.pending = null; }
    })();
    return entry.pending;
  };
}
