// Chart settings and visible ranges are independent. Only cursor timestamps
// are shared between charts with matching timeframe and requested bar count.
export function buildCursorGroups(charts, layout = '2x2') {
  const groups = new Map();
  for (const chart of charts) {
    if (!chart.rows?.length) continue;
    const column = layout === '2x2' ? Math.floor((chart.slotIndex % 4) / 2) : 0;
    const key = `${layout}:${column}:${chart.interval}:${chart.limit}`;
    if (!groups.has(key)) groups.set(key, { key, members: [] });
    groups.get(key).members.push(chart);
  }
  return [...groups.values()].filter(group => group.members.length > 1);
}

export function visibleLogicalRange(rowCount, requestedCount, rightOffset = 2) {
  if (!rowCount) return null;
  return { from: Math.max(0, rowCount - requestedCount), to: rowCount - 1 + rightOffset };
}
