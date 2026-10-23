export const MA_PERIODS = [5, 10, 20, 60, 120, 200];
export const MA_COLORS = {
  5: "#f59e0b",
  10: "#22c55e",
  20: "#a855f7",
  60: "#06b6d4",
  120: "#64748b",
  200: "#92400e"
};

export function maVisibilityForInterval(interval, overrides = {}) {
  const intraday = /^(1|3|5|10|15|30|60)m$/.test(interval);
  return Object.fromEntries(MA_PERIODS.map(period => {
    const key = `ma${period}`;
    return [key, typeof overrides[key] === 'boolean' ? overrides[key] : !intraday || [5, 20, 60].includes(period)];
  }));
}

export function calcSma(rows, period) {
  const result = [];
  for (let i = period - 1; i < rows.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < period; j += 1) sum += rows[i - j].close;
    result.push({ time: rows[i].time, value: sum / period });
  }
  return result;
}

// Same population deviation and 20-period / 2-sigma settings as stock5-8.
export function calcBollinger(rows, period = 20, multiplier = 2) {
  return calcSma(rows, period).map(({ time, value: middle }, index) => {
    const window = rows.slice(index, index + period);
    const variance = window.reduce((sum, row) => sum + (row.close - middle) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * multiplier;
    return { time, middle, upper: middle + deviation, lower: middle - deviation };
  });
}

// Global weekly is a command; local selections remain available while enabled.
export function setWeekly(state, enabled) {
  if (enabled) {
    state.restoreInterval = state.interval;
    state.restoreLimit = state.limit;
    state.interval = "1wk";
  } else {
    state.interval = state.restoreInterval;
    state.limit = state.restoreLimit;
  }
}

function ema(values, period) {
  const factor = 2 / (period + 1);
  let value = values[0];
  return values.map(next => (value = value == null ? next : next * factor + value * (1 - factor)));
}

// MACD(12, 26), with its 9-period EMA signal. Preserve all warmup bars.
export function calcMacd(rows) {
  const closes = rows.map(row => row.close);
  const fast = ema(closes, 12), slow = ema(closes, 26);
  const values = fast.map((value, index) => value - slow[index]);
  const signals = ema(values, 9);
  return rows.map((row, index) => ({ time: row.time, value: values[index], signal: signals[index] }));
}

export function macdCrossMarkers(macd) {
  const markers = [];
  // Wait for the slow EMA and signal warmup; equality alone is not a cross.
  for (let index = 33; index < macd.length; index++) {
    const previous = macd[index - 1].value - macd[index - 1].signal;
    const current = macd[index].value - macd[index].signal;
    if (previous <= 0 && current > 0) markers.push({
      time: macd[index].time, position: 'belowBar', color: '#dc2626', shape: 'arrowUp', size: 1.05
    });
    else if (previous >= 0 && current < 0) markers.push({
      time: macd[index].time, position: 'aboveBar', color: '#2563eb', shape: 'arrowDown', size: 1.05
    });
  }
  return markers;
}

// Keep cross detection independent of the display mode. Native markers at the
// same time/position stack, so a transparent spacer keeps arrows off the wick.
export function macdDisplayMarkers(macd, mode) {
  const scale = mode === 1 ? 1 : mode === 2 ? 2 : 0;
  if (!scale) return [];
  return macdCrossMarkers(macd).flatMap(marker => [
    { time: marker.time, position: marker.position, shape: 'circle', color: 'transparent', size: 0.65 * scale },
    { ...marker, size: marker.size * scale }
  ]);
}
