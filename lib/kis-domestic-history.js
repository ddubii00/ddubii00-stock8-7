// Date-based KIS history includes previous sessions; the older itemchart API
// only serves today's bars, even when PW_DATA_INCU_YN is Y.
export function createKisDomesticHistory({ request, now = Date.now }) {
  const pages = new Map();
  const tasks = new Map();
  let queue = Promise.resolve();
  const stamp = value => String(value || '').replace(/\D/g, '');
  const keyFor = row => stamp(row.stck_bsop_date) + stamp(row.stck_cntg_hour).padStart(6, '0');
  const clockKey = value => new Date(value + 9 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  function previousMinute(key) {
    return clockKey(Date.parse(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T${key.slice(8, 10)}:${key.slice(10, 12)}:00+09:00`) - 60000);
  }
  async function page(code, market, cursor) {
    const key = `${code}:${market}:${cursor}`;
    const cached = pages.get(key);
    if (cached && cached.until > now()) return cached.value;
    if (!tasks.has(key)) tasks.set(key, (async () => {
      const fetchPage = () => request('/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice', 'FHKST03010230', {
        FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: cursor.slice(0, 8), FID_INPUT_HOUR_1: cursor.slice(8),
        FID_PW_DATA_INCU_YN: 'Y', FID_FAKE_TICK_INCU_YN: 'N'
      });
      // Four visible charts share a paced queue and identical page requests.
      const pending = queue.then(fetchPage);
      queue = pending.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 110)));
      const json = await pending;
      const value = (Array.isArray(json.output2) ? json.output2 : []).filter(row => /^\d{14}$/.test(keyFor(row)) && keyFor(row) <= cursor);
      const closedDate = cursor.slice(0, 8) < clockKey(now()).slice(0, 8);
      pages.set(key, { value, until: now() + (closedDate ? 86400000 : 15000) });
      if (pages.size > 1000) pages.delete(pages.keys().next().value);
      return value;
    })().finally(() => tasks.delete(key)));
    return tasks.get(key);
  }
  return async function history(code, count, market = 'J') {
    const current = clockKey(now());
    let cursor = current.slice(0, 8) + (current.slice(8) > '200000' ? '200000' : current.slice(8, 12) + '00');
    const rows = new Map();
    const dates = new Set();
    let emptyDays = 0;
    // Two trading dates preserve yesterday's after-market bars as well as today.
    for (let index = 0; index < 120 && (rows.size < Math.min(10000, count) || dates.size < 2); index++) {
      const output = await page(code, market, cursor);
      if (!output.length && ++emptyDays >= 10) break;
      if (output.length) emptyDays = 0;
      for (const row of output) {
        const key = keyFor(row);
        const time = key.slice(8);
        const regular = time >= '090000' && (time < '152000' || (time >= '153000' && time <= '153259'));
        const after = time >= '160000' && time <= '200000';
        const pre = market === 'NX' && time >= '080000' && time <= '085000';
        if (!regular && !after && !pre) continue;
        const slot = time >= '153000' && time <= '153259' ? key.slice(0, 8) + '153000' : key;
        if (!rows.has(slot)) rows.set(slot, row);
        dates.add(key.slice(0, 8));
      }
      const oldest = output.map(keyFor).sort()[0];
      let next = oldest ? previousMinute(oldest) : previousMinute(cursor.slice(0, 8) + '000000').slice(0, 8) + '200000';
      // Skip the closed part of the night, not the actual trading history.
      if (next.slice(8) < '080000') next = previousMinute(next.slice(0, 8) + '000000').slice(0, 8) + '200000';
      if (next >= cursor || Number(current.slice(0, 4)) - Number(next.slice(0, 4)) > 1) break;
      cursor = next;
    }
    return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
  };
}
