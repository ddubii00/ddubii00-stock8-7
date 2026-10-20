const tradingDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
});
export function usTradingDate(time) {
  return tradingDate.format(new Date(time * 1000));
}

export function previousUsRegularClose(rows, quoteTime) {
  if (!Number.isFinite(quoteTime)) return null;
  const date = usTradingDate(quoteTime);
  return rows.filter(row => Number.isFinite(row.close) && row.close > 0 && usTradingDate(row.time) < date)
    .sort((a, b) => a.time - b.time).at(-1) || null;
}

export function usChangeFromBase(payload, base, date = null) {
  const valid = Number.isFinite(base) && base > 0 && Number.isFinite(payload.price);
  const change = valid ? Math.round((payload.price - base) * 1e10) / 1e10 : null;
  const changePercent = valid ? change / base * 100 : null;
  return { ...payload, previousClose: valid ? base : null, previousCloseDate: date,
    change, changePercent, changeRate: changePercent, changeBasis: 'previous-regular-close' };
}

export function createUsPriceChange({ fetcher, now = Date.now }) {
  const cache = new Map();
  async function dailyRows(symbol) {
    const saved = cache.get(symbol);
    if (saved?.task) return saved.task;
    if (saved?.until > now()) return saved.rows;
    const entry = {};
    entry.task = (async () => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.slice(0, -3))}?range=1mo&interval=1d&includePrePost=false`;
      const response = await fetcher(url, 4000);
      if (!response.ok) throw new Error('US regular-close history unavailable');
      const result = (await response.json())?.chart?.result?.[0];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      // Raw regular-session close, not dividend-adjusted close or the range's
      // chartPreviousClose. Actual trading dates handle weekends/holidays/DST.
      entry.rows = (result?.timestamp || []).map((time, index) => ({ time: Number(time), close: closes[index] == null ? NaN : Number(closes[index]) }))
        .filter(row => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0);
      entry.until = now() + 60000;
      return entry.rows;
    })().catch(() => {
      entry.rows = saved?.rows || [];
      entry.until = now() + 15000;
      return entry.rows;
    }).finally(() => { entry.task = null; });
    cache.set(symbol, entry);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return entry.task;
  }
  return async payload => {
    if (!payload.symbol?.endsWith('.US')) return payload;
    const time = Number(payload.marketTime || payload.asOf);
    const previous = previousUsRegularClose(await dailyRows(payload.symbol), time);
    return usChangeFromBase(payload, previous?.close ?? payload.previousClose,
      previous ? usTradingDate(previous.time) : payload.previousCloseDate || null);
  };
}
