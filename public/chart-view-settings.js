export function halfCandleLimit(limit) {
  return Math.max(1, Math.floor(limit / 2));
}

export function initialViewLimit(slot, chartType, candleLimit = slot.limit) {
  return chartType === 'line-break' ? slot.lineBreakLimit ?? halfCandleLimit(candleLimit) : candleLimit;
}

export function initialComparisonChanges(slots, start, views, candleLimit) {
  const indices = [...new Set(views.filter(view => view.chartType === 'line-break').map(view => start + view.slot))];
  return indices.filter(index => slots[index].lineBreakLimit == null).map(index => ({
    type: 'slot', index, patch: { lineBreakLimit: halfCandleLimit(candleLimit ?? slots[index].limit) }
  }));
}

export function slotPatchForView(state, patch) {
  if (state.chartType !== 'line-break' || !('limit' in patch)) return patch;
  const { limit, ...rest } = patch;
  return { ...rest, lineBreakLimit: limit };
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
