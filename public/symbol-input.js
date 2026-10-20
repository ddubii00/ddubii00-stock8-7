import { exactCatalogItem } from './instrument-catalog.js';

export function normalizeSearchQuery(value) {
  return String(value || '').normalize('NFKC').trim();
}

export function parseKoreanCode(value) {
  const query = normalizeSearchQuery(value).toUpperCase();
  const match = query.match(/^(?:A([0-9][A-Z0-9]{5})|([0-9][A-Z0-9]{5}|[0-9]{1,5}))(?:\.(KS|KQ))?$/);
  if (!match) return null;
  return { code: (match[1] || match[2]).padStart(6, '0'), suffix: match[3] ? `.${match[3]}` : '' };
}

export function parseUsTicker(value) {
  const query = normalizeSearchQuery(value).toUpperCase();
  if (parseKoreanCode(query)) return null;
  const ticker = query.endsWith('.US') ? query.slice(0, -3) : query;
  if (!/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/.test(ticker) || ticker.length > 12) return null;
  return ticker.replace('.', '-');
}

export function manualSearchItem(value) {
  const query = normalizeSearchQuery(value);
  if (!query) return null;
  const upper = query.toUpperCase();
  const known = exactCatalogItem(query);
  if (known) return { symbol: known.symbol, name: known.name };
  if (/^\^[A-Z0-9]{1,12}$/.test(upper)) return { symbol: upper, name: upper };
  if (['KOSPI', '코스피', '^KS11'].includes(upper)) return {symbol:'^KS11', name:'KOSPI'};
  if (['KOSDAQ', '코스닥', '^KQ11'].includes(upper)) return {symbol:'^KQ11', name:'KOSDAQ'};
  if (['NASDAQ', '나스닥', '^IXIC'].includes(upper)) return {symbol:'^IXIC', name:'나스닥'};
  const korean = parseKoreanCode(query);
  if (korean) return {symbol:`${korean.code}${korean.suffix || '.KS'}`, name:korean.code};
  const ticker = parseUsTicker(query);
  return ticker ? {symbol:`${ticker}.US`, name:ticker} : null;
}

export function searchResultsWithFallback(results, query) {
  const items = [...(results || [])];
  const manual = manualSearchItem(query);
  if (!manual) return items;
  const korean = parseKoreanCode(query);
  // A verified KOSDAQ result must not gain a second, guessed KOSPI entry.
  const exists = items.some(item => item.symbol === manual.symbol || (korean && /^\w{6}\.(KS|KQ)$/.test(item.symbol) && item.symbol.slice(0, 6) === korean.code));
  if (!exists) items.push(manual);
  return items;
}

export function prioritizeExactInstrument(results, query) {
  const korean = parseKoreanCode(query);
  const ticker = parseUsTicker(query);
  const exact = item => korean
    ? item.symbol?.slice(0, 6) === korean.code && /\.(KS|KQ)$/.test(item.symbol)
    : ticker ? item.symbol === `${ticker}.US` : false;
  return [...results.filter(exact), ...results.filter(item => !exact(item))];
}
