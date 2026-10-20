// Close-based three-line break. Time is the source bar that creates a line;
// the reversal opens at the previous body's edge, not its closing extreme.
// Rules: https://www.tradingview.com/support/solutions/43000502273-introduction-to-line-break-charts/
export function calculateThreeLineBreak(candles, precision = 8) {
  const factor = 10 ** precision;
  const byTime = new Map();
  for (const candle of candles || []) {
    if (!Number.isFinite(candle?.close) || !Number.isFinite(candle.time) || candle.close <= 0) continue;
    byTime.set(candle.time, { ...candle, close: Math.round(candle.close * factor) / factor });
  }
  const lines = [];
  let seed = null;
  let volume = 0;
  let volumeKnown = true;
  let sourceCount = 0;
  let startTime = null;
  for (const candle of [...byTime.values()].sort((a, b) => a.time - b.time)) {
    if (!sourceCount) startTime = candle.time;
    sourceCount++;
    if (typeof candle.volume === 'number' && Number.isFinite(candle.volume) && candle.volume >= 0) volume += candle.volume;
    else volumeKnown = false;
    if (seed == null) { seed = candle.close; continue; }
    const previous = lines.at(-1);
    let open;
    if (!previous) {
      if (candle.close === seed) continue;
      open = seed;
    } else {
      const recent = lines.slice(-3);
      const highest = Math.max(...recent.map(line => line.high));
      const lowest = Math.min(...recent.map(line => line.low));
      const rising = previous.close > previous.open;
      if (rising && candle.close > previous.close) open = previous.close;
      else if (!rising && candle.close < previous.close) open = previous.close;
      else if (rising && candle.close < lowest) open = previous.open;
      else if (!rising && candle.close > highest) open = previous.open;
      else continue; // Equality is not a break. Only closes confirm a reversal.
    }
    lines.push({
      time: candle.time, open, close: candle.close,
      high: Math.max(open, candle.close), low: Math.min(open, candle.close),
      volume: volumeKnown ? volume : null, startTime, sourceCount,
    });
    volume = 0;
    volumeKnown = true;
    sourceCount = 0;
  }
  // Pending volume after the last breakout belongs to the next line, not the
  // last completed line. Do not invent a line simply to plot pending volume.
  return lines;
}
