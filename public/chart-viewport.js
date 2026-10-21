import { visibleLogicalRange } from './chart-alignment.js';

// Snapshot before replacing data: the old logical indices refer to the old
// timeline, which can lose its first bar when the live history window rolls.
export function captureViewport(scale, rows, rightOffset = 2) {
  const range = scale.getVisibleLogicalRange();
  return {
    range,
    following: !range || !rows.length || range.to >= rows.length - 1 + rightOffset - 0.5
  };
}

export function refreshedViewport(previousRows, rows, snapshot, initial, limit, rightOffset = 2) {
  if (initial || !snapshot.range) return visibleLogicalRange(rows.length, limit, rightOffset);
  const { range } = snapshot;
  if (!previousRows.length || !rows.length) return range;
  // Keep the same zoom when following live data, including on a new line-break
  // box. A manually panned historical view instead stays anchored to its time.
  const span = range.to - range.from;
  if (snapshot.following) {
    const to = rows.length - 1 + (range.to - (previousRows.length - 1));
    return { from: to - span, to };
  }
  const anchor = Math.min(previousRows.length - 1, Math.max(0, Math.ceil(range.from)));
  const time = previousRows[anchor].time;
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time < time) low = mid + 1;
    else high = mid;
  }
  const from = Math.min(rows.length - 1, low) + range.from - anchor;
  return { from, to: from + span };
}
