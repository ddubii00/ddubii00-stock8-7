const LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn";
const CACHE_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const compact = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");

export function parseEtfList(payload) {
  const unique = new Map();
  for (const item of payload?.result?.etfItemList || []) {
    const code = String(item.itemcode || "").trim().toUpperCase();
    const name = String(item.itemname || "").trim();
    if (!/^[0-9][A-Z0-9]{5}$/.test(code) || !name) continue;
    unique.set(code, { symbol: `${code}.KS`, name, aliases: ["ETF"] });
  }
  return [...unique.values()];
}

export function matchEtfs(items, query) {
  const q = compact(query);
  if (!q) return [];
  return items.map((item) => {
    const values = [item.symbol, item.symbol.slice(0, 6), item.name, "ETF"].map(compact);
    const score = values.some((value) => value === q) ? 0
      : values.some((value) => value.startsWith(q)) ? 1
      : values.some((value) => value.includes(q)) ? 2 : 99;
    return { item, score };
  }).filter(({ score }) => score < 99)
    .sort((a, b) => a.score - b.score)
    .slice(0, 12).map(({ item }) => item);
}

export function createEtfSearch(fetcher, now = Date.now, { readCache, saveCache } = {}) {
  let items = [];
  let symbols = new Set();
  let cacheRead = false;
  let nextLoadAt = 0;
  let pending = null;
  function useList(payload) {
    const fresh = parseEtfList(payload);
    if (!fresh.length) throw new Error("Empty ETF list");
    items = fresh;
    symbols = new Set(items.map(item => item.symbol));
  }
  async function load() {
    if (now() >= nextLoadAt && !pending) {
      pending = (async () => {
        if (!cacheRead) {
          cacheRead = true;
          try { if (readCache) useList(await readCache()); } catch { /* Refresh a missing or invalid cache. */ }
        }
        try {
          const response = await fetcher(LIST_URL, 2600);
          if (!response.ok) throw new Error(`ETF list HTTP ${response.status}`);
          const bytes = await response.arrayBuffer();
          const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(response.headers.get("content-type") || "")?.[1];
          // Naver's list uses EUC-KR; honor UTF-8 if the provider switches.
          const payload = JSON.parse(new TextDecoder(charset || "euc-kr").decode(bytes));
          useList(payload);
          nextLoadAt = now() + CACHE_MS;
          try { await saveCache?.(payload); } catch { /* In-memory classification remains usable. */ }
        } catch {
          // Keep the last successful list during provider outages.
          nextLoadAt = now() + RETRY_MS;
        } finally {
          pending = null;
        }
      })();
    }
    if (pending) await pending;
  }
  async function searchEtfs(query) {
    if (!compact(query)) return [];
    await load();
    return matchEtfs(items, query);
  }
  searchEtfs.has = symbol => symbols.has(String(symbol).toUpperCase());
  searchEtfs.isEtf = async symbol => {
    if (!/^[0-9][A-Z0-9]{5}\.KS$/i.test(symbol)) return false;
    await load();
    return searchEtfs.has(symbol);
  };
  return searchEtfs;
}
