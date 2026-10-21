export function halfCandleLimit(limit) {
  return Math.max(1, Math.floor(limit / 2));
}

export function initialViewLimit(slot, chartType, candleLimit = slot.limit) {
  return chartType === 'line-break' ? slot.lineBreakLimit ?? halfCandleLimit(candleLimit) : candleLimit;
}

export function initialViewInterval(slot, chartType) {
  return chartType === 'line-break' ? slot.lineBreakInterval ?? slot.interval : slot.interval;
}

export function initialComparisonChanges(slots, start, views, candleLimit) {
  const indices = [...new Set(views.filter(view => view.chartType === 'line-break').map(view => start + view.slot))];
  return indices.flatMap(index => {
    const slot = slots[index];
    const patch = {};
    if (slot.lineBreakLimit == null) patch.lineBreakLimit = halfCandleLimit(candleLimit ?? slot.limit);
    if (slot.lineBreakInterval == null) patch.lineBreakInterval = slot.interval;
    return Object.keys(patch).length ? [{ type: 'slot', index, patch }] : [];
  });
}

export function slotPatchForView(state, patch) {
  if (state.chartType !== 'line-break') return patch;
  const { limit, interval, ...result } = patch;
  if ('limit' in patch) result.lineBreakLimit = limit;
  if ('interval' in patch) result.lineBreakInterval = interval;
  return result;
}

// A shared candle-count update must not overwrite an already displayed paired
// line-break count. Only an explicit lineBreakLimit edit changes that view.
export function viewLimitsFromShared(state, slot, keepCurrent = false) {
  if (state.chartType !== 'line-break') return { limit: keepCurrent ? state.limit : slot.limit, restoreLimit: slot.limit };
  const saved = slot.lineBreakLimit ?? null;
  const changed = saved !== state.savedLineBreakLimit;
  state.savedLineBreakLimit = saved;
  return {
    limit: !keepCurrent && changed ? initialViewLimit(slot, 'line-break') : state.limit,
    restoreLimit: slot.lineBreakLimit ?? state.restoreLimit
  };
}
