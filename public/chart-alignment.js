// Chart settings and visible ranges are independent. All visible charts share
// only the source timestamp; each target resolves its own containing bar.
export function buildCursorGroups(charts, layout = '2x2') {
  const members = charts.filter(chart => chart.rows?.length);
  return members.length > 1 ? [{ key: layout, members }] : [];
}

const dateFormats = new Map();
function calendarBucket(time, interval, timeZone) {
  if (!dateFormats.has(timeZone)) dateFormats.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }));
  const parts = Object.fromEntries(dateFormats.get(timeZone).formatToParts(new Date(time * 1000)).map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(+parts.year, +parts.month - 1, interval === '1mo' ? 1 : +parts.day));
  if (interval === '1wk') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.getTime();
}

// Use the target bar containing the source time: 14:31 on a one-minute chart
// maps to the 14:30 five-minute bar. Never jump across an untraded session gap.
export function cursorTimeForChart(rows, interval, sourceTime, timeZone = 'UTC') {
  if (!rows?.length || !Number.isFinite(sourceTime)) return null;
  const calendar = ['1d', '1wk', '1mo'].includes(interval);
  const key = time => calendar ? calendarBucket(time, interval, timeZone) : time;
  const sourceKey = key(sourceTime);
  let low = 0, high = rows.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (key(rows[mid].time) <= sourceKey) low = mid + 1;
    else high = mid - 1;
  }
  if (high < 0) return null;
  const time = rows[high].time;
  if (key(time) === sourceKey) return time;
  if (calendar) return null;
  const minutes = /^(1|3|5|10|15|30|60)m$/.exec(interval);
  return minutes && sourceTime < time + Number(minutes[1]) * 60 ? time : null;
}

// A line-break box represents the interval until the next box forms. Map to
// the latest box at or before the hovered candle, including an unfinished tail.
export function cursorTimeForLineBreak(rows, sourceTime) {
  if (!rows?.length || !Number.isFinite(sourceTime)) return null;
  let low = 0, high = rows.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time <= sourceTime) low = mid + 1;
    else high = mid - 1;
  }
  return high < 0 ? null : rows[high].time;
}

export function visibleLogicalRange(rowCount, requestedCount, rightOffset = 2) {
  if (!rowCount) return null;
  return { from: Math.max(0, rowCount - requestedCount), to: rowCount - 1 + rightOffset };
}
