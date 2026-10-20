// A slow provider must not hold back local or already completed results.
export function createProgressiveSearch({ initial, providers, finish, now = Date.now, budgetMs = 100 }) {
  const cache = new Map();
  return async query => {
    const key = query.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    let entry = cache.get(key);
    if (!entry || (!entry.pending && entry.until <= now())) {
      entry = { groups: [initial(query)], pending: true, until: Infinity };
      cache.set(key, entry);
      if (cache.size > 500) {
        const oldest = [...cache].find(([candidate, item]) => candidate !== key && !item.pending)?.[0];
        if (oldest) cache.delete(oldest);
      }
      const task = Promise.allSettled(providers.map((provider, index) => Promise.resolve().then(() => provider(query)).then(items => {
        entry.groups[index + 1] = items || [];
      }))).then(() => {
        entry.pending = false;
        entry.until = now() + (finish(query, entry.groups, false).length ? 300000 : 30000);
      });
      let timer;
      await Promise.race([task, new Promise(resolve => { timer = setTimeout(resolve, budgetMs); })]);
      clearTimeout(timer);
    }
    return { results: finish(query, entry.groups, entry.pending), pending: entry.pending };
  };
}
