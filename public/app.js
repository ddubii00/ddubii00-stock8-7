import { MA_PERIODS, MA_COLORS, calcSma, calcBollinger, setWeekly, calcMacd, macdCrossMarkers } from "./chart-indicators.js";
import { calculateThreeLineBreak } from "./three-line-break.js";
import { SharedDashboard } from "./shared-dashboard.js";
import { PAGE_COUNT, SLOTS_PER_PAGE, LAYOUTS, layoutChartCount, layoutViews, isComparisonLayout, adjacentPage } from "./dashboard-model.js";
import { TrendEditor } from "./trend-editor.js";
import { InstrumentSettings } from "./instrument-settings.js";
import { mergeCandleHistory } from "./chart-history.js";
import { isFuturesSymbol } from "./instrument-catalog.js";
import { buildCursorGroups, cursorTimeForChart, cursorTimeForLineBreak, visibleLogicalRange } from "./chart-alignment.js";

const TIMEFRAMES = [
  { label: "1분", value: "1m" },
  { label: "3분", value: "3m" },
  { label: "5분", value: "5m" },
  { label: "10분", value: "10m" },
  { label: "15분", value: "15m" },
  { label: "30분", value: "30m" },
  { label: "1시간", value: "60m" },
  { label: "일", value: "1d" },
  { label: "주", value: "1wk" },
  { label: "월", value: "1mo" }
];

const MARKET_ITEMS = [
  { label: "달러/원", symbol: "KRW=X", decimals: 0 },
  { label: "KOSPI", symbol: "^KS11", decimals: 0 },
  { label: "KOSDAQ", symbol: "^KQ11", decimals: 0 },
  { label: "나스닥", symbol: "^IXIC", decimals: 0 }
];

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 700;
const DEFAULT_LIMIT_BY_INTERVAL = {
  "1m": 400,
  "3m": 150,
  "5m": 120,
  "10m": 100,
  "15m": 100,
  "30m": 100,
  "60m": 100,
  "1d": 120,
  "1wk": 120,
  "1mo": 120
};
const STORAGE_KEY = "stock8.selectedCharts.v2";
const SESSION_MODE_KEY = "stock8.sessionMode.v1";
let activePage = 0;
let layoutIndex = 0;
let sharedState;
const shared = new SharedDashboard(applySharedState, showSaveStatus);
const WARMUP_BARS = Math.max(...MA_PERIODS);
const CHART_PRICE_DECIMALS = 0;
const UPDATE_INTERVAL_MS = 1_000;
const CHART_RIGHT_OFFSET = 2;
const CHART_BAR_SPACING = 6;
const PRICE_SCALE_WIDTH = 82;
const FETCH_LIMIT = 700;
const LINE_BREAK_FETCH_LIMIT = 10000;
const candleHistories = new Map();
const INTERVAL_SECONDS = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "10m": 600,
  "15m": 900,
  "30m": 1800,
  "60m": 3600
};

const chartGrid = document.querySelector("#chartGrid");
const marketSummary = document.querySelector("#marketSummary");
const sessionButtons = document.querySelectorAll(".session-button");
const template = document.querySelector("#chart-card-template");
const chartState = new Map();
let marketRefreshInFlight = false;
let chartRefreshInFlight = false;
let sessionMode = "KRX";
let showBollinger = true;
const comparisonBollinger = new Map();
let globalWeekly = false;
let showLineBreak = false;
let chartFitFrame = 0;
let priceScaleFitFrame = 0;
let priceScaleWidth = PRICE_SCALE_WIDTH;
let alignmentFrame = 0;
let hoveredChart = null;

function isLineBreak(state) {
  return state.chartType ? state.chartType === 'line-break' : showLineBreak;
}

function bollingerEnabled() {
  return isComparisonLayout(LAYOUTS[layoutIndex]) ? comparisonBollinger.get(LAYOUTS[layoutIndex]) ?? false : showBollinger;
}

function updateMacdMarkers(state) {
  const markers = state.macdSignals && !isLineBreak(state) && state.visible.candle ? macdCrossMarkers(state.macd) : [];
  // Native markers stack at the same time/position. An invisible spacer adds
  // breathing room from the wick while following pan, zoom and price scaling.
  state.instance.candleSeries.setMarkers(markers.flatMap(marker => [
    { time: marker.time, position: marker.position, shape: 'circle', color: 'transparent', size: 0.65 },
    marker
  ]));
  state.card.dataset.macdSignals = String(markers.length);
}

function syncVerticalCursor() {
  for (const state of chartState.values()) {
    const source = hoveredChart?.state;
    const pairedLineBreak = isComparisonLayout(LAYOUTS[layoutIndex]) && isLineBreak(state) && source?.slotIndex === state.slotIndex;
    const sameGroup = source && !isLineBreak(source) && (!isLineBreak(state) || pairedLineBreak)
      && state !== source && state.alignment && state.alignment === source.alignment;
    const timeZone = isKoreanSymbol(state.item.symbol) || isKoreanIndex(state.item.symbol) ? 'Asia/Seoul' : 'America/New_York';
    const targetTime = !sameGroup ? null : pairedLineBreak
      ? cursorTimeForLineBreak(state.rows, hoveredChart.time)
      : cursorTimeForChart(state.rows, state.interval, hoveredChart.time, timeZone);
    const x = targetTime != null ? state.instance.chart.timeScale().timeToCoordinate(targetTime) : null;
    const visible = Number.isFinite(x) && x >= 0 && x <= state.instance.chart.timeScale().width();
    state.syncCursor.hidden = !visible;
    if (visible) {
      state.syncCursor.style.left = `${x}px`;
      state.syncCursor.style.bottom = `${state.instance.chart.timeScale().height()}px`;
      state.syncCursor.dataset.time = String(targetTime);
      state.syncCursor.dataset.sourceTime = String(hoveredChart.time);
    }
  }
}

function scheduleTimeAlignment() {
  if (alignmentFrame) return;
  alignmentFrame = requestAnimationFrame(() => {
    alignmentFrame = 0;
    const states = [...chartState.values()].filter(state => !state.disposed);
    const ready = states.filter(state => state.rows.length && state.lastPayloadKey === chartRequestKey(state));
    // Share only the cursor timestamp. Every chart owns its data and viewport.
    const groups = buildCursorGroups(ready.filter(state => isComparisonLayout(LAYOUTS[layoutIndex]) || !isLineBreak(state)), LAYOUTS[layoutIndex]);
    for (const state of states) state.alignment = null;
    for (const group of groups) for (const state of group.members) state.alignment = group;
    syncVerticalCursor();
  });
}

function handleVisibleRangeChange(state) {
  drawMacdBackground(state);
  renderPointerCursor(state);
  syncVerticalCursor();
}

function renderPointerCursor(state) {
  if (!state.pointerInside || !state.pointerPoint || !state.rows.length) return;
  const point = state.pointerPoint;
  const scale = state.instance.chart.timeScale();
  const time = scale.coordinateToTime(point.x);
  if (time == null || point.x < 0 || point.x > scale.width() || point.y < 0) return;
  showTooltip(state, { time, point });
  hoveredChart = { state, time };
  syncVerticalCursor();
  const price = state.instance.candleSeries.coordinateToPrice(point.y);
  if (Number.isFinite(price)) state.instance.chart.setCrosshairPosition(price, time, state.instance.candleSeries);
}

function syncPriceScaleWidths() {
  if (priceScaleFitFrame) return;
  priceScaleFitFrame = requestAnimationFrame(() => {
    priceScaleFitFrame = 0;
    const scales = [...chartState.values()]
      .filter((state) => !state.disposed)
      .map((state) => state.instance.chart.priceScale("right"));
    // Share the widest label area, including prices that exceed the baseline.
    // Keep that width when switching symbols/pages so the plot does not jump.
    priceScaleWidth = Math.ceil(Math.max(priceScaleWidth, ...scales.map((scale) => scale.width())));
    for (const scale of scales) {
      if (scale.options().minimumWidth !== priceScaleWidth) {
        scale.applyOptions({ minimumWidth: priceScaleWidth });
      }
    }
  });
}

function fitChartsToSlots() {
  cancelAnimationFrame(chartFitFrame);
  chartFitFrame = requestAnimationFrame(() => {
    for (const state of chartState.values()) {
      if (state.disposed) continue;
      const stage = state.card.querySelector(".chart-stage");
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) continue;
      const options = state.instance.chart.options();
      if (options.width !== width || options.height !== height) {
        state.instance.chart.applyOptions({ width, height });
      }
      drawMacdBackground(state);
      state.trendEditor?.schedule();
    }
  });
}

window.addEventListener("resize", fitChartsToSlots);
window.visualViewport?.addEventListener("resize", fitChartsToSlots);

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatChange(value, decimals = 2) {
  if (value == null) return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(decimals)}%`;
}

function isKoreanSymbol(symbol) {
  return symbol?.endsWith(".KS") || symbol?.endsWith(".KQ");
}

function isKoreanIndex(symbol) {
  return symbol === "^KS11" || symbol === "^KQ11";
}

function priceDecimalsForSymbol(symbol) {
  if (symbol?.startsWith("^") || symbol === "KRW=X" || symbol?.endsWith(".US") || isFuturesSymbol(symbol)) {
    return 2;
  }
  return CHART_PRICE_DECIMALS;
}

function priceFormatForSymbol(symbol) {
  const precision = priceDecimalsForSymbol(symbol);
  return { type: "price", precision, minMove: symbol === "NQ=F" ? 0.25 : precision === 2 ? 0.01 : 1 };
}

function showSaveStatus(status, message = "") {
  const root = document.querySelector("#saveStatus");
  root.dataset.status = status;
  root.hidden = status !== "error";
  root.textContent = status === "error" ? "저장 연결 오류" : "";
  root.title = message;
}

function persistSlot(state, patch) {
  shared.change([{ type: "slot", index: state.slotIndex, patch }]);
}

function applySharedState(value) {
  const first = !sharedState;
  sharedState = value;
  document.querySelector("#instrumentsButton").disabled = false;
  if (first) { void renderPage(); return; }
  for (const state of chartState.values()) {
    if (state.disposed) continue;
    const slot = value.slots[state.slotIndex];
    const interval = globalWeekly && !state.weeklyLocal ? "1wk" : slot.interval;
    const limit = globalWeekly && !state.weeklyLocal ? state.limit : slot.limit;
    const changed = state.item.symbol !== slot.symbol || state.interval !== interval || state.limit !== limit;
    const symbolChanged = state.item.symbol !== slot.symbol;
    state.item = { symbol: slot.symbol, name: slot.name, decimals: slot.decimals };
    state.restoreInterval = slot.interval;
    state.restoreLimit = slot.limit;
    state.interval = interval;
    state.limit = limit;
    if (changed) {
      if (symbolChanged) state.trendEditor?.reset();
      state.card.querySelector(".symbol-title").textContent = slot.name;
      state.card.querySelector(".period-input").value = String(limit);
      renderTimeframeButtons(state.card, state);
      void refreshCard(state, true);
    }
    state.trendEditor?.schedule();
  }
}

function disposeCard(state) {
  if (hoveredChart?.state === state) hoveredChart = null;
  state.disposed = true;
  state.requestId = (state.requestId || 0) + 1;
  state.trendEditor?.destroy();
  state.instance.observer.disconnect();
  state.instance.chart.remove();
  chartState.delete(state.card.dataset.cardId);
  state.card.remove();
  scheduleTimeAlignment();
}

async function renderPage() {
  for (const state of chartState.values()) disposeCard(state);
  chartState.clear();
  chartGrid.replaceChildren();
  document.querySelector("#pageIndicator").textContent = `${activePage + 1} / ${PAGE_COUNT}`;
  const start = activePage * SLOTS_PER_PAGE;
  await Promise.all(layoutViews(LAYOUTS[layoutIndex]).map((view, position) =>
    createCard(sharedState.slots[start + view.slot], start + view.slot, view, position)));
  fitChartsToSlots();
}

function updateSessionButtons() {
  sessionButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === sessionMode);
  });
}

function formatAxisPrice(value, symbol) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (isKoreanSymbol(symbol) && Math.abs(number) >= 1_000) {
    return `${formatNumber(Math.round(number / 1_000), 0)}k`;
  }
  return formatNumber(number, priceDecimalsForSymbol(symbol));
}

function isIntraday(interval) {
  return !["1d", "1wk", "1mo"].includes(interval);
}

function minimumLimitForInterval(interval) {
  return 20;
}

function defaultLimitForInterval(interval) {
  return DEFAULT_LIMIT_BY_INTERVAL[interval] || DEFAULT_LIMIT;
}

function tickFormatter(interval, time) {
  const date = new Date(time * 1000);
  if (!isIntraday(interval)) {
    return `${String(date.getFullYear()).slice(2)}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function calcVisibleSma(state, period) {
  return calcSma(state.rows || [], period);
}

function updateBollinger(state) {
  const visible = !isLineBreak(state) && state.visible.bb;
  const bands = visible ? calcBollinger(state.rows || []) : [];
  for (const key of ["upper", "middle", "lower"]) {
    state.instance.bbSeries[key].applyOptions({ visible });
    state.instance.bbSeries[key].setData(bands.map((row) => ({ time: row.time, value: row[key] })));
  }
}

function createLwChart(container, state) {
  const priceFormat = priceFormatForSymbol(state.item.symbol);
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      attributionLogo: false,
      background: { type: LightweightCharts.ColorType.Solid, color: "transparent" },
      textColor: "#172033",
      fontFamily: "Inter, Pretendard, sans-serif"
    },
    localization: {
      timeFormatter: (time) => tickFormatter(state.interval, time),
      priceFormatter: (price) => formatAxisPrice(price, state.item.symbol)
    },
    handleScale: {
      mouseWheel: false,
      pinch: true,
      axisPressedMouseMove: { time: false, price: true },
      axisDoubleClickReset: true
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "#64748b", width: 1, style: 3 },
      horzLine: { color: "#64748b", width: 1, style: 3 }
    },
    rightPriceScale: {
      borderColor: "#dbe3f1",
      scaleMargins: { top: 0.19, bottom: 0.08 },
      minimumWidth: priceScaleWidth,
      ticksVisible: true
    },
    timeScale: {
      borderColor: "#dbe3f1",
      timeVisible: isIntraday(state.interval),
      secondsVisible: false,
      rightOffset: CHART_RIGHT_OFFSET,
      barSpacing: CHART_BAR_SPACING,
      // Keep the same bars visible as the viewport or chart layout narrows.
      lockVisibleTimeRangeOnResize: true,
      minBarSpacing: 0.001,
      tickMarkFormatter: (time) => tickFormatter(state.interval, time)
    }
  });

  const observer = new ResizeObserver((entries) => {
    if (!entries.length) return;
    const { width, height } = entries[0].contentRect;
    chart.applyOptions({ width, height });
  });
  observer.observe(container);

  const candleSeries = chart.addCandlestickSeries({
    upColor: "#d92c2c",
    downColor: "#1f5bd8",
    borderVisible: true,
    borderUpColor: "#d92c2c",
    borderDownColor: "#1f5bd8",
    wickUpColor: "#d92c2c",
    wickDownColor: "#1f5bd8",
    lastValueVisible: true,
    priceLineVisible: !isLineBreak(state),
    // An empty override uses the last plotted bar's red/blue color for its
    // price label, including live candle changes and line-break reversals.
    priceLineColor: "",
    priceLineStyle: LightweightCharts.LineStyle.Dotted,
    priceLineWidth: 1,
    priceFormat
  });

  const maSeries = {};
  for (const period of MA_PERIODS) {
    maSeries[period] = chart.addLineSeries({
      color: MA_COLORS[period],
      lineWidth: 2,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat
    });
  }

  const bbSeries = {};
  for (const key of ["upper", "middle", "lower"]) {
    bbSeries[key] = chart.addLineSeries({
      color: "#2563eb", lineWidth: 1, lineStyle: key === "middle" ? 0 : 2,
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      priceFormat
    });
  }
  const timelineSeries = chart.addLineSeries({ visible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
  return { chart, candleSeries, maSeries, bbSeries, timelineSeries, observer };
}

function rowByTime(state, time) {
  return state.rows.find((row) => row.time === time);
}

function marketDateKey(symbol, time) {
  const date = typeof time === "number" ? new Date(time * 1000) : new Date(time);
  const timeZone = (isKoreanSymbol(symbol) || isKoreanIndex(symbol)) ? "Asia/Seoul" : "America/New_York";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function marketMinute(symbol, time) {
  const date = typeof time === "number" ? new Date(time * 1000) : new Date(time);
  const timeZone = (isKoreanSymbol(symbol) || isKoreanIndex(symbol)) ? "Asia/Seoul" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isRegularSessionRow(symbol, row) {
  const minute = marketMinute(symbol, row.time);
  if (isKoreanSymbol(symbol) || isKoreanIndex(symbol)) return minute >= 9 * 60 && minute <= 15 * 60 + 30;
  return minute >= 9 * 60 + 30 && minute <= 16 * 60;
}

function sameMarketDateRows(state, row) {
  const key = marketDateKey(state.item.symbol, row.time);
  return state.rows.filter((candidate) => marketDateKey(state.item.symbol, candidate.time) === key);
}

function regularOpenForRow(state, row) {
  if (!isIntraday(state.interval)) return row.open;
  const dayRows = sameMarketDateRows(state, row);
  return (dayRows.find((candidate) => isRegularSessionRow(state.item.symbol, candidate)) || dayRows[0] || row).open;
}

function previousRegularCloseForRow(state, row) {
  const index = state.rows.findIndex((candidate) => candidate.time === row.time);
  if (!isIntraday(state.interval)) return Number(state.rows[index - 1]?.close);
  if (Number.isFinite(Number(state.previousClose))) return Number(state.previousClose);
  const currentKey = marketDateKey(state.item.symbol, row.time);
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = state.rows[i];
    if (marketDateKey(state.item.symbol, candidate.time) !== currentKey && isRegularSessionRow(state.item.symbol, candidate)) {
      return Number(candidate.close);
    }
  }
  return NaN;
}

function tooltipValues(state, row) {
  const open = isLineBreak(state) || isIntraday(state.interval) ? row.open : regularOpenForRow(state, row);
  const close = row.close;
  const base = isLineBreak(state) || isIntraday(state.interval) ? open : previousRegularCloseForRow(state, row);
  const changePct = Number.isFinite(base) && base !== 0
    ? ((close - base) / base) * 100
    : NaN;
  return { open, close, changePct };
}

function showTooltip(state, param) {
  const tooltip = state.card.querySelector(".price-tooltip");
  if (!param?.time || !param.point || param.point.x < 0 || param.point.y < 0 || param.point.x > state.instance.chart.timeScale().width()) {
    tooltip.style.display = "none";
    return;
  }

  const row = rowByTime(state, param.time);
  if (!row) {
    tooltip.style.display = "none";
    return;
  }

  const decimals = priceDecimalsForSymbol(state.item.symbol);
  const { open, close, changePct } = tooltipValues(state, row);
  const direction = !Number.isFinite(changePct) || changePct >= 0 ? "up" : "down";
  tooltip.innerHTML = `
    <div class="tooltip-row"><span>시가</span><strong>${formatNumber(open, decimals)}</strong></div>
    <div class="tooltip-row"><span>종가</span><strong>${formatNumber(close, decimals)}</strong></div>
    <div class="tooltip-row ${direction}"><span>등락률</span><strong>${formatChange(changePct, 2)}</strong></div>
  `;

  const controls = state.card.querySelector('.card-controls');
  tooltip.style.left = `${state.instance.chart.timeScale().width() + 2}px`;
  tooltip.style.width = `${state.instance.chart.priceScale('right').width() - 4}px`;
  tooltip.style.top = `${controls.offsetTop}px`;
  tooltip.style.display = "block";
}

function visibleRows(state) {
  return state.rows?.slice(-state.limit) || [];
}

function localDateKeyForSymbol(symbol, timestamp) {
  const timeZone = (isKoreanSymbol(symbol) || isKoreanIndex(symbol)) ? "Asia/Seoul" : "America/New_York";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function shouldIgnoreIntradayPayload(state, rows, initial) {
  const previous = state.latestSourceRows || state.sourceRows;
  if (initial || !isIntraday(state.interval) || !previous?.length || !rows?.length) return false;
  const previousLatest = previous.at(-1);
  const nextLatest = rows.at(-1);
  if (!previousLatest || !nextLatest) return false;
  const previousTime = Number(previousLatest.time);
  const nextTime = Number(nextLatest.time);
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) return false;
  if (nextTime < previousTime) return true;
  const seconds = INTERVAL_SECONDS[state.interval] || 60;
  const priorNext = rows.at(-2);
  const priorNextTime = Number(priorNext?.time);
  const sameTailDate = Number.isFinite(priorNextTime)
    && localDateKeyForSymbol(state.item.symbol, priorNextTime) === localDateKeyForSymbol(state.item.symbol, nextTime);
  // KRX's 15:30 auction close and 16:00 after-market opening are separated
  // by a real session break; sparse/first after-market prints remain valid.
  if (!isKoreanSymbol(state.item.symbol) && sameTailDate && nextTime - priorNextTime > seconds * 2.5) return true;
  if (rows.length < Math.max(30, previous.length * 0.75)) return true;
  return false;
}

function keepLatestVisible(state) {
  const range = visibleLogicalRange(state.rows.length, state.limit, CHART_RIGHT_OFFSET);
  if (range) state.instance.chart.timeScale().setVisibleLogicalRange(range);
}

function isViewAtLatest(state) {
  try {
    const range = state.instance.chart.timeScale().getVisibleLogicalRange();
    if (!range || !state.rows?.length) return true;
    const lastIndex = state.rows.length - 1 + CHART_RIGHT_OFFSET;
    return range.to >= lastIndex - 3;
  } catch {
    return true;
  }
}

function drawMacdBackground(state) {
  const { bgCanvas, rows, macd, instance } = state;
  if (state.disposed || !bgCanvas) return;
  const rect = bgCanvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (bgCanvas.width !== width || bgCanvas.height !== height) {
    bgCanvas.width = width;
    bgCanvas.height = height;
  }

  const ctx = bgCanvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  if (isLineBreak(state) || !rows?.length || !macd?.length) return;

  const timeScale = instance.chart.timeScale();
  const points = rows
    .map((row, index) => {
      const x = timeScale.timeToCoordinate(row.time);
      return Number.isFinite(x) ? { index, x: x * dpr, row } : null;
    })
    .filter((point) => point && point.x >= -width * 0.05 && point.x <= width * 1.05);

  if (!points.length) return;

  const gaps = points
    .slice(1)
    .map((point, index) => point.x - points[index].x)
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((a, b) => a - b);
  const barWidth = gaps[Math.floor(gaps.length / 2)] || width / Math.max(1, visibleRows(state).length);

  function boundaryLeft(point, index) {
    if (index === 0) return point.x - barWidth / 2;
    return (points[index - 1].x + point.x) / 2;
  }

  function boundaryRight(point, index) {
    if (index === points.length - 1) return point.x + barWidth / 2;
    return (point.x + points[index + 1].x) / 2;
  }

  function paintSegment(fromX, toX, positive) {
    const x = Math.max(0, Math.round(fromX));
    const nextX = Math.min(width, Math.round(toX));
    const segmentWidth = Math.max(0, nextX - x);
    if (!segmentWidth) return;
    ctx.fillStyle = positive ? "rgba(239, 83, 80, 0.16)" : "rgba(21, 101, 192, 0.16)";
    ctx.fillRect(x, 0, segmentWidth, height);
  }

  let segmentStartX = 0;
  let segmentPositive = (macd[points[0].index]?.value ?? 0) >= 0;

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const positive = (macd[point.index]?.value ?? 0) >= 0;
    if (positive === segmentPositive) continue;
    paintSegment(segmentStartX, boundaryLeft(point, i), segmentPositive);
    segmentStartX = boundaryLeft(point, i);
    segmentPositive = positive;
  }

  paintSegment(segmentStartX, width, segmentPositive);

  // Draw blue vertical lines for date changes in intraday charts
  if (isIntraday(state.interval)) {
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      if (point.index === 0) continue;
      const prevRow = rows[point.index - 1];
      const currentDate = marketDateKey(state.item.symbol, point.row.time);
      const prevDate = marketDateKey(state.item.symbol, prevRow.time);
      if (currentDate !== prevDate) {
        ctx.strokeStyle = "rgba(31, 91, 216, 0.75)"; // blue color with 0.75 opacity
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]); // Dashed line
        ctx.beginPath();
        ctx.moveTo(point.x, 0);
        ctx.lineTo(point.x, height);
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash
      }
    }
  }
}

function syncIndicatorMode(state) {
  state.instance.candleSeries.applyOptions({ priceLineVisible: !isLineBreak(state) });
  state.card.setAttribute('aria-label', `${state.item.name || state.item.symbol} ${isLineBreak(state) ? '삼선전환도' : '캔들차트'}`);
  for (const period of MA_PERIODS) {
    state.instance.maSeries[period].applyOptions({ visible: !isLineBreak(state) && state.visible[`ma${period}`] });
    if (isLineBreak(state)) state.instance.maSeries[period].setData([]);
  }
  updateBollinger(state);
}

function updateSeriesVisibility(state) {
  syncIndicatorMode(state);
  const { instance, visible } = state;
  instance.candleSeries.setData(visible.candle ? state.rows : []);
  for (const period of MA_PERIODS) {
    instance.maSeries[period].setData(!isLineBreak(state) && visible[`ma${period}`] ? calcVisibleSma(state, period) : []);
  }
  updateBollinger(state);
  updateMacdMarkers(state);
}

function renderLegend(state, payload) {
  const rows = visibleRows(state);
  const last = rows.at(-1);
  const changePct = payload.changePercent == null ? NaN : Number(payload.changePercent);
  const direction = changePct >= 0 ? "up" : "down";
  const decimals = priceDecimalsForSymbol(payload.symbol || state.item.symbol);
  const card = state.card;

  card.querySelector(".symbol-title").textContent = state.item.name || payload.name || payload.symbol;
  card.querySelector(".symbol-title").title = state.item.name || payload.name || payload.symbol;
  const priceEl = card.querySelector(".last-price");
  priceEl.textContent = formatNumber(payload.price ?? last?.close, decimals);
  priceEl.className = `last-price ${direction}`;
  const statusEl = card.querySelector(".market-status");
  statusEl.textContent = payload.marketStatus || "종가";
  statusEl.className = `market-status ${direction}`;
  statusEl.title = isFuturesSymbol(state.item.symbol)
    ? [payload.contract ? `월물 ${payload.contract}${payload.contractMode === 'automatic' ? ' · 자동 교체' : payload.contractMode === 'fixed' ? ' · 고정' : ''}` : 'Yahoo Finance 지연 시세',
      payload.marketTime || payload.asOf ? `시세 시각 ${new Date((payload.marketTime || payload.asOf) * 1000).toLocaleString('ko-KR')}` : '', payload.streamError || ''].filter(Boolean).join('\n') : '';
  card.querySelector(".last-change").textContent = formatChange(changePct, 2);
  card.querySelector(".last-change").className = `last-change ${direction}`;
  card.querySelector(".last-change").title = payload.changeBasis === 'previous-regular-close' && Number.isFinite(payload.previousClose)
    ? `직전 거래일 정규장 종가${payload.previousCloseDate ? ` (${payload.previousCloseDate})` : ''}: ${formatNumber(payload.previousClose, decimals)} · 등락폭: ${payload.change > 0 ? '+' : ''}${formatNumber(payload.change, decimals)}` : '';
}

function applyPayload(state, payload, initial = false) {
  if (payload.contract && state.lastPayload?.contract && payload.contract !== state.lastPayload.contract) {
    // A different contract starts its own price range and line-break history.
    initial = true;
    state.trendEditor?.reset();
  }
  let sourceRows = payload.series || [];
  if (!sourceRows.length) throw new Error("시세 데이터가 없습니다.");
  if (isLineBreak(state) && /^fallback/.test(payload.source || "")) throw new Error("실제 시세 데이터를 받지 못했습니다.");
  const previousRows = state.rows || [];
  const previousLastTime = previousRows.at(-1)?.time;
  if (shouldIgnoreIntradayPayload(state, sourceRows, initial)) return;
  state.latestSourceRows = sourceRows;
  if (isLineBreak(state)) {
    const historyKey = `${state.item.symbol}:${payload.contract || ''}:${state.interval}:${sessionMode}`;
    sourceRows = mergeCandleHistory(candleHistories.get(historyKey) || [], sourceRows);
    if (!candleHistories.has(historyKey) && candleHistories.size >= 60) candleHistories.delete(candleHistories.keys().next().value);
    candleHistories.set(historyKey, sourceRows);
  }
  const rows = isLineBreak(state) ? calculateThreeLineBreak(sourceRows, priceDecimalsForSymbol(state.item.symbol)) : sourceRows;
  const latest = rows.at(-1);
  state.lastPayload = payload;
  state.lastPayloadKey = chartRequestKey(state);

  state.sourceRows = sourceRows;
  state.rows = rows;
  state.timeline = rows;
  state.macd = isLineBreak(state) ? [] : calcMacd(rows);
  state.previousClose = Number(payload.previousClose);
  syncIndicatorMode(state);

  // isTickUpdate: same last candle time = only price updated, not a new bar
  const isTickUpdate = !isLineBreak(state) && !initial && isIntraday(state.interval) && previousLastTime === latest?.time
    && previousRows.length === rows.length && rows.every((row, index) => row.time === previousRows[index].time);

  // Only apply chart/series options on full reloads to avoid resetting pan/zoom state
  if (!isTickUpdate) {
    const priceFormat = priceFormatForSymbol(state.item.symbol);
    state.instance.chart.applyOptions({
      localization: {
        timeFormatter: (time) => tickFormatter(state.interval, time),
        priceFormatter: (price) => formatAxisPrice(price, state.item.symbol)
      },
      timeScale: {
        timeVisible: isIntraday(state.interval),
        tickMarkFormatter: (time) => tickFormatter(state.interval, time)
      }
    });
    state.instance.candleSeries.applyOptions({ priceFormat, wickVisible: !isLineBreak(state) });
    for (const series of Object.values(state.instance.bbSeries)) series.applyOptions({ priceFormat });
    for (const period of MA_PERIODS) {
      state.instance.maSeries[period].applyOptions({ priceFormat });
    }
  }

  // A new symbol/timeframe starts fitted; ordinary quote refreshes preserve
  // the manually dragged price range.
  if (initial) state.instance.chart.priceScale("right").applyOptions({ autoScale: true });

  if (!isTickUpdate) state.instance.timelineSeries.setData(rows.map(({ time }) => ({ time })));

  if (isTickUpdate && state.visible.candle) {
    state.instance.candleSeries.update(latest);
  } else {
    state.instance.candleSeries.setData(state.visible.candle ? rows : []);
  }

  if (isTickUpdate) {
    for (const period of MA_PERIODS) {
      if (!state.visible[`ma${period}`]) continue;
      const maData = calcVisibleSma(state, period);
      const lastMa = maData.at(-1);
      if (lastMa) state.instance.maSeries[period].update(lastMa);
    }
  } else {
    for (const period of MA_PERIODS) {
      state.instance.maSeries[period].setData(!isLineBreak(state) && state.visible[`ma${period}`] ? calcVisibleSma(state, period) : []);
    }
  }

  updateBollinger(state);
  updateMacdMarkers(state);
  state.card.querySelector('[data-series="candle"] .candle-label').textContent = isLineBreak(state) ? "삼선" : "캔들";
  state.card.querySelector(".price-tooltip").style.display = "none";
  renderLegend(state, payload);
  if (initial || isIntraday(state.interval)) keepLatestVisible(state);
  requestAnimationFrame(() => drawMacdBackground(state));
  state.card.classList.add("loaded");
  state.card.classList.toggle("no-line-break", isLineBreak(state) && !rows.length);
  if (isLineBreak(state) && !rows.length) state.card.querySelector(".loading").textContent = "삼선 돌파가 없습니다";
  syncPriceScaleWidths();
  scheduleTimeAlignment();
  state.trendEditor?.schedule();
  renderPointerCursor(state);
}

async function fetchChart(state) {
  const params = new URLSearchParams({
    symbol: state.item.symbol,
    name: state.item.name,
    interval: state.interval,
    limit: String(isLineBreak(state) ? LINE_BREAK_FETCH_LIMIT : Math.max(FETCH_LIMIT, state.limit + WARMUP_BARS)),
    chartType: isLineBreak(state) ? "line-break" : "candles",
    mode: sessionMode
  });
  const response = await fetch(`/stock8-7/api/chart?${params.toString()}`);
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `chart ${response.status}`);
  }
  return response.json();
}

function chartRequestKey(state) {
  return `${state.item.symbol}:${state.interval}:${state.limit}:${sessionMode}:${isLineBreak(state)}`;
}

async function refreshCard(state, initial = false) {
  if (state.disposed) return;
  const key = chartRequestKey(state);
  if (!initial && state.pendingKey === key) return;
  const requestId = state.requestId = (state.requestId || 0) + 1;
  state.pendingKey = key;
  if (initial) {
    state.card.classList.remove("loaded");
    state.card.querySelector(".loading").textContent = "불러오는 중";
  }
  try {
    const payload = await fetchChart(state);
    if (state.disposed || requestId !== state.requestId || key !== chartRequestKey(state)) return;
    state.item = {
      symbol: payload.symbol,
      name: state.item.name || payload.name,
      decimals: payload.decimals
    };
    applyPayload(state, payload, initial);
    state.card.querySelector('.market-status').classList.remove('data-error');
  } catch (error) {
    if (!state.disposed && requestId === state.requestId && key === chartRequestKey(state)) {
      state.card.querySelector(".loading").textContent = error.message || "데이터 오류";
      if (isFuturesSymbol(state.item.symbol)) {
        const status = state.card.querySelector('.market-status');
        status.textContent = '수신 오류';
        status.title = error.message;
        status.classList.add('data-error');
      }
    }
  } finally {
    if (requestId === state.requestId) state.pendingKey = null;
  }
}

function bindLegend(card, state) {
  card.querySelectorAll(".ma-legend button[data-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.series;
      state.visible[key] = !state.visible[key];
      button.classList.toggle("off", !state.visible[key]);
      button.setAttribute("aria-pressed", String(state.visible[key]));
      updateSeriesVisibility(state);
    });
  });
}

function renderTimeframeButtons(card, state) {
  const root = card.querySelector(".timeframe-buttons");
  root.replaceChildren(
    ...TIMEFRAMES.map((timeframe) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tf-button${timeframe.value === state.interval ? " active" : ""}`;
      button.textContent = timeframe.label;
      button.addEventListener("click", async () => {
        state.interval = timeframe.value;
        state.limit = defaultLimitForInterval(state.interval);
        if (globalWeekly) {
          state.restoreInterval = state.interval;
          state.restoreLimit = state.limit;
          state.weeklyLocal = true;
        }
        card.querySelector(".period-input").value = String(state.limit);
        renderTimeframeButtons(card, state);
        state.trendEditor?.reset();
        persistSlot(state, { interval: state.interval, limit: state.limit });
        await refreshCard(state, true);
      });
      return button;
    })
  );
}

function bindPeriod(card, state) {
  const input = card.querySelector(".period-input");
  input.value = String(state.limit);
  const apply = async () => {
    const next = Math.min(MAX_LIMIT, Math.max(minimumLimitForInterval(state.interval), Math.trunc(Number(input.value || DEFAULT_LIMIT))));
    input.value = String(next);
    state.limit = next;
    if (globalWeekly && state.restoreInterval === state.interval) state.restoreLimit = next;
    if (!globalWeekly || state.weeklyLocal) persistSlot(state, { limit: next });
    await refreshCard(state, true);
  };
  input.addEventListener("change", apply);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
}

async function createCard(item, index, view = {}, position = index) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".chart-card");
  const stage = fragment.querySelector(".chart-stage");
  const bgCanvas = fragment.querySelector(".macd-bg");
  const id = `card-${position}`;
  card.dataset.cardId = id;
  card.dataset.slotIndex = String(index);
  card.dataset.chartType = view.chartType || 'global';
  card.setAttribute('aria-label', `${item.name || item.symbol} ${view.chartType === 'line-break' ? '삼선전환도' : '캔들차트'}`);
  card.querySelector('.symbol-title').textContent = item.name || item.symbol;
  card.querySelector('.symbol-title').title = item.name || item.symbol;
  card.tabIndex = -1;
  chartGrid.append(card);

  const state = {
    card,
    bgCanvas,
    item: {symbol:item.symbol, name:item.name, decimals:item.decimals},
    slotIndex: index,
    chartType: view.chartType || null,
    macdSignals: Boolean(view.macdSignals),
    interval: globalWeekly ? "1wk" : item.interval,
    restoreInterval: item.interval,
    restoreLimit: item.limit,
    weeklyLocal: false,
    limit: globalWeekly ? defaultLimitForInterval("1wk") : item.limit,
    sourceRows: [],
    rows: [],
    macd: [],
    visible: {
      candle: true,
      ma5: true,
      ma10: true,
      ma20: true,
      ma60: true,
      ma120: true,
      ma200: true,
      bb: bollingerEnabled()
    }
  };
  state.instance = createLwChart(stage, state);
  syncIndicatorMode(state);
  state.syncCursor = document.createElement('div');
  state.syncCursor.className = 'synced-crosshair';
  state.syncCursor.hidden = true;
  state.syncCursor.setAttribute('aria-hidden', 'true');
  card.append(state.syncCursor);
  state.instance.chart.timeScale().subscribeVisibleLogicalRangeChange(() => handleVisibleRangeChange(state));
  state.instance.chart.timeScale().subscribeSizeChange(() => {
    drawMacdBackground(state);
    syncPriceScaleWidths();
    syncVerticalCursor();
  });
  const pointerMove = event => {
    const rect = stage.getBoundingClientRect();
    state.pointerInside = true;
    state.pointerPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    renderPointerCursor(state);
  };
  stage.addEventListener('pointerenter', pointerMove);
  stage.addEventListener('pointermove', pointerMove);
  stage.addEventListener('pointerleave', () => {
    state.pointerInside = false;
    state.card.querySelector('.price-tooltip').style.display = 'none';
    state.instance.chart.clearCrosshairPosition();
    if (hoveredChart?.state === state) { hoveredChart = null; syncVerticalCursor(); }
  });

  chartState.set(id, state);
  card.querySelectorAll(".ma-legend button[data-series]").forEach((button) => {
    button.setAttribute("aria-pressed", String(state.visible[button.dataset.series]));
    button.classList.toggle("off", !state.visible[button.dataset.series]);
    const period = Number(button.dataset.series.replace("ma", ""));
    if (MA_COLORS[period]) {
      button.style.color = MA_COLORS[period];
      button.querySelector("i").style.backgroundColor = MA_COLORS[period];
    }
  });
  bindLegend(card, state);
  renderTimeframeButtons(card, state);
  bindPeriod(card, state);
  state.trendEditor = new TrendEditor(state, () => sharedState.lines[state.item.symbol] || [], (changes) => shared.change(changes));
  await refreshCard(state, true);
}

function renderMarketItem(item, quote) {
  const change = Number(quote.changePercent ?? quote.changeRate ?? 0);
  const direction = change >= 0 ? "up" : "down";
  const status = quote.marketStatus === "장중" ? "장중" : "장종료";
  const amount = quote.change != null && Number.isFinite(Number(quote.change))
    ? Number(quote.change)
    : quote.previousClose != null ? Number(quote.price) - Number(quote.previousClose) : NaN;
  const rounded = Math.sign(amount) * Math.round(Math.abs(amount));
  const delta = Number.isFinite(rounded) ? `${rounded > 0 ? "+" : ""}${formatNumber(rounded === 0 ? 0 : rounded, 0)}` : "--";
  const span = document.createElement("span");
  span.className = `market-item ${direction}`;
  span.dataset.symbol = item.symbol;
  span.innerHTML = `<span class="market-label">${item.label}</span><strong>${formatNumber(quote.price, item.decimals)}</strong><span class="market-delta" title="등락폭">${delta}</span><span class="market-change">(${formatChange(change, 2)})</span><span class="market-session ${direction}">${status}</span>`;
  return span;
}

function fitMarketNumbers() {
  for (const field of marketSummary.querySelectorAll("strong, .market-delta, .market-change")) {
    const range = document.createRange();
    range.selectNodeContents(field);
    const textWidth = range.getBoundingClientRect().width;
    const available = field.clientWidth - 1;
    // Rare large values fit the same fixed slot without shifting the header.
    if (available > 0 && textWidth > available) {
      const fontSize = parseFloat(getComputedStyle(field).fontSize);
      field.style.fontSize = `${fontSize * available / textWidth}px`;
    }
  }
}

async function loadMarketSummary() {
  if (marketRefreshInFlight) return;
  marketRefreshInFlight = true;
  try {
    const results = await Promise.all(MARKET_ITEMS.map(async (item) => {
      try {
        const response = await fetch(`/stock8-7/api/quote?symbol=${encodeURIComponent(item.symbol)}&mode=${sessionMode}`);
        return { item, quote: await response.json() };
      } catch {
        return { item, quote: null };
      }
    }));
    marketSummary.replaceChildren(
      ...results
        .filter(({ quote }) => quote && Number.isFinite(Number(quote.price)))
        .map(({ item, quote }) => renderMarketItem(item, quote))
    );
    fitMarketNumbers();
  } finally {
    marketRefreshInFlight = false;
  }
}

async function refreshAll(initial = false) {
  if (!initial && chartRefreshInFlight) return;
  chartRefreshInFlight = true;
  try {
    const states = [...chartState.values()];
    await Promise.all(states.map((state) => refreshCard(state, initial)));
  } finally {
    chartRefreshInFlight = false;
  }
}

document.querySelectorAll(".chart-toggle").forEach((button) => {
  button.addEventListener("click", async () => {
    const feature = button.dataset.feature;
    if (feature === 'line-break' && isComparisonLayout(LAYOUTS[layoutIndex])) return;
    if (feature === "bb") {
      if (isComparisonLayout(LAYOUTS[layoutIndex])) comparisonBollinger.set(LAYOUTS[layoutIndex], !bollingerEnabled());
      else showBollinger = !showBollinger;
    }
    if (feature === "weekly") globalWeekly = !globalWeekly;
    if (feature === "line-break") showLineBreak = !showLineBreak;
    if (feature === "line-break") syncVerticalCursor();
    const enabled = feature === "bb" ? bollingerEnabled() : feature === "weekly" ? globalWeekly : showLineBreak;
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    await Promise.all([...chartState.values()].map(async (state) => {
      if (feature === "bb") {
        state.visible.bb = bollingerEnabled();
        const local = state.card.querySelector('[data-series="bb"]');
        local.classList.toggle("off", !state.visible.bb);
        local.setAttribute("aria-pressed", String(state.visible.bb));
        updateBollinger(state);
      } else if (feature === "weekly") {
        state.weeklyLocal = false;
        state.trendEditor?.reset();
        setWeekly(state, globalWeekly);
        if (globalWeekly) state.limit = defaultLimitForInterval("1wk");
        state.card.querySelector(".period-input").value = String(state.limit);
        renderTimeframeButtons(state.card, state);
        await refreshCard(state, true);
      } else if (feature === "line-break") {
        syncIndicatorMode(state);
        state.trendEditor?.reset();
        await refreshCard(state, true);
      }
      requestAnimationFrame(() => drawMacdBackground(state));
    }));
  });
});

sessionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const nextMode = button.dataset.mode === "NTX" ? "NTX" : "KRX";
    if (nextMode === sessionMode) return;
    sessionMode = nextMode;
    localStorage.setItem(SESSION_MODE_KEY, sessionMode);
    updateSessionButtons();
    await Promise.all([loadMarketSummary(), refreshAll(true)]);
  });
});

document.querySelector("#layoutButton").addEventListener("click", () => {
  const previousLayout = LAYOUTS[layoutIndex];
  layoutIndex = (layoutIndex + 1) % LAYOUTS.length;
  chartGrid.dataset.layout = LAYOUTS[layoutIndex];
  const paired = isComparisonLayout(LAYOUTS[layoutIndex]);
  const bbButton = document.querySelector('.header-actions [data-feature="bb"]');
  bbButton.classList.toggle('active', bollingerEnabled());
  bbButton.setAttribute('aria-pressed', String(bollingerEnabled()));
  const lineBreakButton = document.querySelector('[data-feature="line-break"]');
  lineBreakButton.disabled = paired;
  lineBreakButton.classList.toggle('active', !paired && showLineBreak);
  lineBreakButton.setAttribute('aria-pressed', String(!paired && showLineBreak));
  if (paired || isComparisonLayout(previousLayout)) {
    if (sharedState) void renderPage();
  } else {
    const start = activePage * SLOTS_PER_PAGE;
    const count = layoutChartCount(LAYOUTS[layoutIndex]);
    for (const state of chartState.values()) {
      if (state.slotIndex < start || state.slotIndex >= start + count) disposeCard(state);
    }
    const pending = [];
    for (let offset = 0; offset < count; offset++) {
      const index = start + offset;
      if (!chartState.has(`card-${offset}`) && sharedState) pending.push(createCard(sharedState.slots[index], index, {}, offset));
    }
    void Promise.all(pending).then(() => { fitChartsToSlots(); scheduleTimeAlignment(); });
    fitChartsToSlots();
    scheduleTimeAlignment();
  }
  const button = document.querySelector("#layoutButton");
  const singleComparison = LAYOUTS[layoutIndex] === '1x2-paired';
  button.title = singleComparison ? '한 종목 캔들·삼선 배치: 각 장의 첫 종목을 위 캔들·아래 삼선으로 표시. 클릭하면 기존 2x2 배치'
    : paired ? '4x4 캔들·삼선 배치: 첫 두 종목을 위 캔들·아래 삼선으로 표시. 클릭하면 한 종목 캔들·삼선 배치'
    : `현재 ${LAYOUTS[layoutIndex]} (가로 × 세로). 클릭하면 다음 배치`;
  button.setAttribute("aria-label", singleComparison ? "배치 한 종목 캔들·삼선" : paired ? "배치 4x4 캔들·삼선" : `배치 ${LAYOUTS[layoutIndex]}`);
});
document.querySelector("#nextButton").addEventListener("click", () => {
  activePage = adjacentPage(activePage, 1);
  void renderPage();
});
document.querySelector("#previousButton").addEventListener("click", () => {
  activePage = adjacentPage(activePage, -1);
  void renderPage();
});

new InstrumentSettings(() => sharedState, (changes) => shared.change(changes));

updateSessionButtons();
try {
  await shared.start();
  if (!shared.state.initialized) {
    try {
      const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(legacy) && legacy.length === 4) shared.change([{type:"importLegacy", items:legacy}]);
    } catch { /* Invalid legacy browser state must not replace server data. */ }
  }
  showSaveStatus(shared.pending.length ? "saving" : "saved");
  void loadMarketSummary();
} catch (error) {
  showSaveStatus("error", error.message);
  const retry = document.createElement("button");
  retry.className = "load-retry";
  retry.textContent = "저장 정보를 불러오지 못했습니다. 다시 시도";
  retry.addEventListener("click", () => location.reload());
  chartGrid.replaceChildren(retry);
}

setInterval(loadMarketSummary, UPDATE_INTERVAL_MS);
setInterval(() => {
  refreshAll(false);
}, UPDATE_INTERVAL_MS);
