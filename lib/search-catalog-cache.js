// Single shared refresh with bounded concurrency, stale data and restart cache.
export function createCatalogLoader({ loadPage, loadAll, readCache = async () => null, saveCache = async () => {}, now = Date.now, concurrency = 4 }) {
  let items = [], loadedAt = 0, retryAt = 0, pending;
  const valid = item => /^[0-9][A-Z0-9]{5}\.(KS|KQ)$/.test(item?.symbol) && typeof item.name === 'string' && item.name.trim() && item.name.length <= 100;
  const hydration = Promise.resolve().then(readCache).then(saved => {
    if (Array.isArray(saved?.items) && saved.items.every(valid) && Number.isFinite(saved.loadedAt)) {
      items = saved.items; loadedAt = saved.loadedAt;
    }
  }).catch(() => {});
  return async () => {
    await hydration;
    if (items.length && now() - loadedAt < 43200000) return items;
    if (now() < retryAt) return items;
    if (!pending) pending = (async () => {
      if (loadAll) {
        try {
          const fresh = (await loadAll()).filter(valid);
          if (fresh.length) {
            items = fresh; loadedAt = now();
            try { await saveCache({ items, loadedAt }); } catch { /* Memory cache still works. */ }
            return items;
          }
        } catch { /* Keep the legacy page provider as a bounded fallback. */ }
      }
      const jobs = [0, 1].flatMap(market => Array.from({ length: 45 }, (_, index) => [market, index + 1]));
      const results = new Array(jobs.length);
      let next = 0, failed = false;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < jobs.length) {
          const index = next++;
          try { results[index] = await loadPage(...jobs[index]); }
          catch { results[index] = []; failed = true; }
        }
      }));
      const fresh = [...new Map(results.flat().filter(valid).map(item => [item.symbol, item])).values()];
      if (fresh.length && (!items.length || !failed)) {
        items = fresh; loadedAt = failed ? now() - 43200000 : now();
        try { await saveCache({ items, loadedAt }); } catch { /* Memory cache still works. */ }
      }
      if (failed || !fresh.length) retryAt = now() + 60000;
      return items;
    })().finally(() => { pending = null; });
    return items.length ? items : pending;
  };
}
