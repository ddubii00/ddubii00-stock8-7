// Chart settings and visible ranges are independent. Only cursor timestamps
// are shared between intraday charts even when their periods/counts differ.
export function buildCursorGroups(charts, layout = '2x2') {
  const groups = new Map();
  for (const chart of charts) {
    if (!chart.rows?.length) continue;
    const column = layout === '2x2' ? Math.floor((chart.slotIndex % 4) / 2) : 0;
    const intervalKind = /^\d+m$/.test(chart.interval) ? 'intraday' : chart.interval;
    const key = `${layout}:${column}:${intervalKind}`;
    if (!groups.has(key)) groups.set(key, { key, members: [] });
    groups.get(key).members.push(chart);
  }
  return [...groups.values()].filter(group => group.members.length > 1);
}

// Use the target bar containing the source time: 14:31 on a one-minute chart
// maps to the 14:30 five-minute bar. Never jump across an untraded session gap.
export function cursorTimeForChart(rows, interval, sourceTime) {
  if (!rows?.length || !Number.isFinite(sourceTime)) return null;
  let low = 0, high = rows.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time <= sourceTime) low = mid + 1;
    else high = mid - 1;
  }
  if (high < 0) return null;
  const time = rows[high].time;
  if (time === sourceTime) return time;
  const minutes = /^(1|3|5|10|15|30|60)m$/.exec(interval);
  return minutes && sourceTime < time + Number(minutes[1]) * 60 ? time : null;
}

export function visibleLogicalRange(rowCount, requestedCount, rightOffset = 2) {
  if (!rowCount) return null;
  return { from: Math.max(0, rowCount - requestedCount), to: rowCount - 1 + rightOffset };
}
