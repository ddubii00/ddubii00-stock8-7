// Keep an overlapping source window anchored as live queries roll forward.
// The incoming window is authoritative, including corrected/deleted candles.
export function mergeCandleHistory(previous, incoming, maxRows = 20000) {
  const clean = new Map();
  for (const row of incoming || []) {
    if (Number.isFinite(row?.time) && Number.isFinite(row.close) && row.close > 0) clean.set(row.time, { ...row });
  }
  const fresh = [...clean.values()].sort((a, b) => a.time - b.time);
  if (!fresh.length) return [];
  const first = fresh[0].time;
  // A disjoint window cannot safely carry a prior line-break state across a gap.
  const overlaps = previous.some(row => clean.has(row.time));
  const prefix = overlaps ? previous.filter(row => row.time < first) : [];
  return [...prefix, ...fresh].slice(-maxRows);
}
