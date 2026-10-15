// Store dates/prices, never screen pixels or a bar's moving array index.
export function candleTimestamp(time) {
  if (typeof time === 'number') return time;
  if (typeof time === 'string') return Date.parse(time) / 1000;
  if (time && typeof time === 'object') return Date.UTC(time.year, time.month - 1, time.day) / 1000;
  return NaN;
}

export function timeAtLogical(candles, logical) {
  if (!candles.length || !Number.isFinite(logical)) return null;
  // Snap to actual trading dates, including shortened holiday weeks.
  const index = Math.max(0, Math.min(candles.length - 1, Math.round(logical)));
  const time = candleTimestamp(candles[index].time);
  return Number.isFinite(time) ? time : null;
}

export function logicalAtTime(candles, time) {
  if (!candles.length || !Number.isFinite(time)) return null;
  let low = 0;
  let high = candles.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = candleTimestamp(candles[mid].time);
    if (value === time) return mid;
    if (value < time) low = mid + 1;
    else high = mid - 1;
  }
  // An endpoint outside the loaded history is hidden, not moved to a new date.
  if (low === 0 || low === candles.length) return null;
  const before = candleTimestamp(candles[low - 1].time);
  const after = candleTimestamp(candles[low].time);
  return low - 1 + (time - before) / (after - before);
}

// Hit-test the visible segment without placing a mouse-catching SVG over the chart.
export function distanceToTrendLine(point, line) {
  if (![point.x, point.y, line.a.x, line.a.y, line.b.x, line.b.y].every(Number.isFinite)) return Infinity;
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - line.a.x - t * dx, point.y - line.a.y - t * dy);
}

