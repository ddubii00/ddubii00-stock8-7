// Two sets of 400 bars can contain different missing minutes or closing prints.
// Share real timestamps and leave gaps as whitespace, never invented OHLC.
export function buildTimeAlignments(charts, layout = '2x2') {
  const groups = new Map();
  for (const chart of charts) {
    if (!chart.rows?.length) continue;
    const column = layout === '2x2' ? chart.slotIndex % 2 : 0;
    const key = `${layout}:${column}:${chart.interval}:${chart.limit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chart);
  }
  return [...groups.entries()].filter(([, members]) => members.length > 1).map(([key, members]) => {
    const times = [...new Set(members.flatMap(chart => chart.rows.map(row => row.time)))].sort((a, b) => a - b);
    const firstVisible = Math.min(...members.map(chart => chart.rows[Math.max(0, chart.rows.length - chart.visibleLimit)].time));
    return { key, members, timeline: times.map(time => ({ time })),
      range: { from: times.indexOf(firstVisible), to: times.length - 1 + 2 },
      signature: `${key}:${members.map(chart => chart.slotIndex).join(',')}:${times.join(',')}:${firstVisible}` };
  });
}
