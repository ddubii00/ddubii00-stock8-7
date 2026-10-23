const KST_OFFSET = 9 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const CLOSE_SECONDS = 15 * 60 * 60 + 30 * 60;
const dateFormatters = new Map();

// A compressed line-break timeline marks a new date at its first actual box.
export function lineBreakDateBoundaries(rows, interval, timeZone) {
  if (!/^(1|3|5|10|15|30|60)m$/.test(interval)) return [];
  if (!dateFormatters.has(timeZone)) dateFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }));
  const formatter = dateFormatters.get(timeZone);
  const boundaries = [];
  let previousDate;
  for (const { time } of rows) {
    if (!Number.isFinite(time)) continue;
    const date = formatter.format(new Date(time * 1000));
    if (previousDate && date !== previousDate) boundaries.push({ time, from: time, to: time, fraction: 0 });
    previousDate = date;
  }
  return boundaries;
}

// Return real timeline anchors for each 15:30 KST boundary. When the exact
// minute is missing (e.g. hourly bars), interpolate only within the same day.
// Never add candles or project a boundary beyond the received history.
export function koreanClosingBoundaries(rows, symbol, interval, { regularSessionOnly = false } = {}) {
  if (regularSessionOnly || !/^[0-9][A-Z0-9]{5}\.(KS|KQ)$/.test(symbol)
      || !/^(1|3|5|10|15|30|60)m$/.test(interval)) return [];
  const boundaries = [];
  let previous;
  for (const row of rows) {
    const time = row.time;
    if (!Number.isFinite(time)) continue;
    const day = Math.floor((time + KST_OFFSET) / DAY_SECONDS);
    const close = day * DAY_SECONDS - KST_OFFSET + CLOSE_SECONDS;
    if (time === close) {
      boundaries.push({ time: close, from: time, to: time, fraction: 0 });
    } else if (previous && previous.time < close && time > close
        && previous.day === day) {
      boundaries.push({ time: close, from: previous.time, to: time, fraction: (close - previous.time) / (time - previous.time) });
    }
    previous = { time, day };
  }
  return boundaries;
}
