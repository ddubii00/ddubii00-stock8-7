const QUOTE_URL = 'https://polling.finance.naver.com/api/realtime/worldstock/futures/NQcv1';
const number = value => value == null || value === '' ? NaN : Number(String(value).replaceAll(',', ''));

export function parseNaverFuturesQuote(payload) {
  const item = payload?.datas?.find(row => row.reutersCode === 'NQcv1' || row.symbolCode === 'NQcv1');
  const price = number(item?.closePriceRaw ?? item?.closePrice);
  const change = number(item?.compareToPreviousClosePriceRaw ?? item?.compareToPreviousClosePrice);
  const changePercent = number(item?.fluctuationsRatioRaw ?? item?.fluctuationsRatio);
  // This timestamp includes the exchange's UTC offset, including DST.
  const time = Date.parse(item?.localTradedAt) / 1000;
  if (!(price > 0) || !Number.isFinite(time)) throw new Error('네이버 NQ 선물 현재가를 받지 못했습니다.');
  const delay = number(item.stockExchangeType?.delayTime);
  return { symbol: 'NQ=F', price, change: Number.isFinite(change) ? change : null,
    previousClose: Number.isFinite(change) ? price - change : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    marketTime: time, asOf: time, contract: 'NQcv1', contractMode: 'continuous',
    marketStatus: Number.isFinite(delay) ? `네이버 ${delay}분 지연` : '네이버 지연 시세',
    source: 'naver-futures', quoteSource: 'naver-futures', realtime: false,
    delayMinutes: Number.isFinite(delay) ? delay : null, exchangeStatus: item.marketStatus };
}

export function parseNaverFuturesHistory(payload) {
  if (!Array.isArray(payload)) throw new Error('네이버 선물 봉 데이터 형식 오류');
  const rows = new Map();
  for (const point of payload) {
    const date = String(point.localDate || '');
    if (!/^\d{8}$/.test(date)) continue;
    const time = Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00Z`) / 1000;
    const [open, high, low, close] = [point.openPrice, point.highPrice, point.lowPrice, point.closePrice].map(number);
    if (!Number.isFinite(time) || ![open, high, low, close].every(v => Number.isFinite(v) && v > 0)
      || high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
    const volume = number(point.accumulatedTradingVolume);
    rows.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : 0 });
  }
  return [...rows.values()].sort((a,b) => a.time - b.time);
}

export function createNaverFutures({ fetcher = url => fetch(url), loadIntraday, now = Date.now } = {}) {
  const cache = new Map();
  async function cached(key, ttl, load) {
    const saved = cache.get(key);
    if (saved?.pending) return saved.pending;
    if (saved?.until > now()) {
      if (saved.error) throw saved.error;
      return saved.value;
    }
    const entry = {};
    cache.set(key, entry);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    entry.pending = (async () => {
      try { entry.value = await load(); entry.until = now() + ttl; return entry.value; }
      catch (error) { entry.error = error; entry.until = now() + 2000; throw error; }
      finally { entry.pending = null; }
    })();
    return entry.pending;
  }
  const quote = () => cached('quote', 7000, async () => {
    const response = await fetcher(QUOTE_URL, 3500);
    if (!response.ok) throw new Error(`네이버 선물 현재가 HTTP ${response.status}`);
    return parseNaverFuturesQuote(await response.json());
  });
  async function chart(interval, limit) {
    const latest = await quote();
    const intraday = !['1d', '1wk', '1mo'].includes(interval);
    const history = await cached(`history:${interval}:${limit}`, intraday ? 15000 : 60000, async () => {
      if (intraday) {
        // Naver's public intraday futures feed contains only close samples.
        // Keep real NQ OHLC history; never manufacture candle wicks from samples.
        return loadIntraday(interval, limit);
      }
      const period = { '1d': 'day', '1wk': 'week', '1mo': 'month' }[interval];
      const start = new Date(now());
      start.setUTCFullYear(start.getUTCFullYear() - Math.max(3, Math.ceil(limit * ({ '1d': 2, '1wk': 8, '1mo': 32 }[interval]) / 365)));
      const stamp = date => date.toISOString().slice(0,10).replaceAll('-', '');
      const response = await fetcher(`https://api.stock.naver.com/chart/foreign/futures/NQcv1/${period}?startDateTime=${stamp(start)}0000&endDateTime=${stamp(new Date(now()))}2359`, 4500);
      if (!response.ok) throw new Error(`네이버 선물 봉 HTTP ${response.status}`);
      const series = parseNaverFuturesHistory(await response.json()).slice(-limit);
      return { series, seriesSource: 'naver-futures-history' };
    });
    if (!history.series?.length) throw new Error('실제 NQ 선물 봉 데이터를 받지 못했습니다.');
    return { ...latest, ...history, historyNotice: intraday ? '현재가: 네이버 지연 시세 · 분봉 이력: Yahoo NQ=F' : '현재가·봉 이력: 네이버 지연 시세' };
  }
  return { quote, chart };
}
