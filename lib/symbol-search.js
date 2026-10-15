import { parseKoreanCode } from '../public/symbol-input.js';

export function parseKoreanMetadata(payload, code) {
  if (!payload || String(payload.itemCode || '').toUpperCase() !== code) return null;
  const name = String(payload.stockName || '').trim();
  const exchange = payload.stockExchangeType || {};
  const market = `${exchange.code || ''} ${exchange.nameEng || ''} ${exchange.name || ''}`;
  const suffix = /\bKQ\b|KOSDAQ/i.test(market) ? '.KQ' : /\bKS\b|KOSPI/i.test(market) ? '.KS' : null;
  if (!name || !suffix) return null;
  return {symbol:`${code}${suffix}`, name};
}

export function createKoreanCodeResolver(fetcher, knownNames = {}, now = Date.now) {
  const cache = new Map();
  const pending = new Map();
  return async function resolveCode(query) {
    const parsed = parseKoreanCode(query);
    if (!parsed) return null;
    const code = parsed.code;
    for (const suffix of ['.KS', '.KQ']) {
      const symbol = `${code}${suffix}`;
      if (knownNames[symbol]) return {symbol, name:knownNames[symbol]};
    }
    const cached = cache.get(code);
    if (cached && cached.until > now()) return cached.item;
    if (pending.has(code)) return pending.get(code);
    const task = (async () => {
      let item = null;
      try {
        const response = await fetcher(`https://m.stock.naver.com/api/stock/${code}/basic`, 2000);
        if (response.ok) item = parseKoreanMetadata(await response.json(), code);
      } catch { /* Existing search providers remain available during outages. */ }
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(code, {item, until:now() + (item ? 12 * 60 * 60 * 1000 : 30_000)});
      return item;
    })();
    pending.set(code, task);
    try { return await task; } finally { pending.delete(code); }
  };
}
