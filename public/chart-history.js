// Reject legacy sample responses before they can reach a chart or its history.
export function realChartRows(payload, symbol) {
  if (payload?.symbol !== symbol) throw new Error('요청한 종목과 시세 종목이 일치하지 않습니다.');
  if (/fallback|sample|synthetic|demo|mock/i.test(payload.source || '') || payload.synthetic === true) {
    throw new Error('실제 시세 데이터가 아닙니다. 종목 코드와 데이터 연결을 확인해 주세요.');
  }
  if (!Array.isArray(payload.series) || !payload.series.length) throw new Error('시세 데이터가 없습니다.');
  return payload.series;
}

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
