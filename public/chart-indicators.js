export const MA_PERIODS = [5, 10, 20, 60, 120, 200];
export const MA_COLORS = {
  5: "#f59e0b",
  10: "#22c55e",
  20: "#a855f7",
  60: "#06b6d4",
  120: "#64748b",
  200: "#92400e"
};

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
