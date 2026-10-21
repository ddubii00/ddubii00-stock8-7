import { isFuturesSymbol } from './instrument-catalog.js';

export const PAGE_COUNT = 10;
export const SLOTS_PER_PAGE = 4;
export const SLOT_COUNT = PAGE_COUNT * SLOTS_PER_PAGE;
export function adjacentPage(page, direction) {
  return (page + direction + PAGE_COUNT) % PAGE_COUNT;
}
export const LAYOUTS = ['2x2', '1x3', '3x1', '1x1', '2x1', '1x2', '4x4'];
export function layoutChartCount(layout) {
  if (layout === '4x4') return 4; // Two instruments, each with candles above line break.
  const [columns, rows] = layout.split('x').map(Number);
  return columns * rows;
}
// Column-major display order. Repeated views use the same saved instrument slot.
export function layoutViews(layout) {
  if (layout === '4x4') return [
    { slot: 0, chartType: 'candles', macdSignals: true },
    { slot: 0, chartType: 'line-break', macdSignals: false },
    { slot: 1, chartType: 'candles', macdSignals: true },
    { slot: 1, chartType: 'line-break', macdSignals: false }
  ];
  return Array.from({ length: layoutChartCount(layout) }, (_, slot) => ({ slot, chartType: null, macdSignals: false }));
}
export const INTERVALS = ['1m', '3m', '5m', '10m', '15m', '30m', '60m', '1d', '1wk', '1mo'];
const DEFAULTS = [
  ['000660.KS', 'SK하이닉스'], ['005930.KS', '삼성전자'], ['AVGO.US', 'Broadcom'], ['SNDK.US', 'Sandisk'],
  ['NVDA.US', 'NVIDIA'], ['TSLA.US', 'Tesla'], ['AAPL.US', 'Apple'], ['MSFT.US', 'Microsoft'],
  ['035420.KS', 'NAVER'], ['035720.KS', '카카오'], ['005380.KS', '현대차'], ['000270.KS', '기아'],
  ['069500.KS', 'KODEX 200'], ['229200.KS', 'KODEX 코스닥150'], ['360750.KS', 'TIGER 미국S&P500'], ['133690.KS', 'TIGER 미국나스닥100'],
  ['AMZN.US', 'Amazon'], ['META.US', 'Meta'], ['GOOGL.US', 'Alphabet'], ['AMD.US', 'AMD']
];
const invalid = () => { throw new Error('저장할 정보 형식이 올바르지 않습니다.'); };
export function validSymbol(symbol) {
  return isFuturesSymbol(symbol) || (typeof symbol === 'string' && /^(?:[0-9][A-Z0-9]{5}\.(?:KS|KQ)|[A-Z][A-Z0-9.-]{0,12}\.US|\^[A-Z0-9]{1,12}|KRW=X)$/.test(symbol));
}
export function createDashboard() {
  return {
    version: 1, revision: 0, initialized: false,
    slots: Array.from({ length: SLOT_COUNT }, (_, index) => {
      const [symbol, name] = DEFAULTS[index % DEFAULTS.length];
      return { symbol, name, decimals: /\.(KS|KQ)$/.test(symbol) ? 0 : 2, interval: '1d', limit: 120 };
    }),
    lines: {}
  };
}
export function cleanLine(value) {
  if (!value || typeof value.id !== 'string' || !/^[\w-]{1,100}$/.test(value.id)) invalid();
  for (const point of [value.start, value.end]) {
    if (!point || !Number.isFinite(point.time) || point.time < 0 || point.time > 32_503_680_000 || !Number.isFinite(point.price) || Math.abs(point.price) > 1e12) invalid();
  }
  if (![1, 2, 3].includes(value.width)) invalid();
  return { id: value.id, start: {time:value.start.time, price:value.start.price}, end: {time:value.end.time, price:value.end.price}, width:value.width };
}
export function cleanSlotPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) invalid();
  const result = {};
  if ('symbol' in patch) { if (!validSymbol(patch.symbol)) invalid(); result.symbol = patch.symbol; }
  if ('name' in patch) { if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 100) invalid(); result.name = patch.name.trim(); }
  if ('decimals' in patch) { if (![0, 2].includes(patch.decimals)) invalid(); result.decimals = patch.decimals; }
  if ('interval' in patch) { if (!INTERVALS.includes(patch.interval)) invalid(); result.interval = patch.interval; }
  if ('limit' in patch) { if (!Number.isInteger(patch.limit) || patch.limit < 20 || patch.limit > 700) invalid(); result.limit = patch.limit; }
  if (!Object.keys(result).length) invalid();
  return result;
}
export function applyChanges(state, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) invalid();
  const next = structuredClone(state);
  for (const change of changes) {
    if (change?.type === 'slot') {
      if (!Number.isInteger(change.index) || change.index < 0 || change.index >= SLOT_COUNT) invalid();
      next.slots[change.index] = { ...next.slots[change.index], ...cleanSlotPatch(change.patch) };
    } else if (change?.type === 'upsertLine') {
      if (!validSymbol(change.symbol)) invalid();
      const line = cleanLine(change.line);
      const lines = next.lines[change.symbol] || [];
      if (lines.length >= 100 && !lines.some(item => item.id === line.id)) throw new Error('종목당 선은 최대 100개입니다.');
      next.lines[change.symbol] = [...lines.filter(item => item.id !== line.id), line];
    } else if (change?.type === 'deleteLine') {
      if (!validSymbol(change.symbol) || typeof change.id !== 'string') invalid();
      next.lines[change.symbol] = (next.lines[change.symbol] || []).filter(item => item.id !== change.id);
    } else if (change?.type === 'importLegacy') {
      if (!next.initialized) {
        if (!Array.isArray(change.items) || change.items.length !== 4) invalid();
        change.items.forEach((item, index) => { next.slots[index] = { ...next.slots[index], ...cleanSlotPatch(item) }; });
      }
    } else invalid();
  }
  next.initialized = true;
  return next;
}
