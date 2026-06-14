const INITIAL_CHARTS = [
  { symbol: "000660.KS", name: "SK하이닉스", decimals: 0 },
  { symbol: "005930.KS", name: "삼성전자", decimals: 0 },
  { symbol: "AVGO.US", name: "Broadcom", decimals: 2 },
  { symbol: "SNDK.US", name: "Sandisk", decimals: 2 }
];

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
  { label: "달러/원", symbol: "KRW=X", decimals: 2 },
  { label: "KOSPI", symbol: "^KS11", decimals: 2 },
  { label: "KOSDAQ", symbol: "^KQ11", decimals: 2 },
  { label: "나스닥", symbol: "^IXIC", decimals: 2 }
];

const DEFAULT_INTERVAL = "1d";
const DEFAULT_LIMIT = 120;
const STORAGE_KEY = "stock8.selectedCharts.v2";
const SESSION_MODE_KEY = "stock8.sessionMode.v1";
const MA_PERIODS = [5, 10, 20, 60, 120, 240];
const WARMUP_BARS = Math.max(...MA_PERIODS);
const CHART_PRICE_DECIMALS = 0;
const UPDATE_INTERVAL_MS = 1_000;
const CHART_RIGHT_OFFSET = 2;
const CHART_BAR_SPACING = 6;
const PRICE_SCALE_WIDTH = 82;
const MA_COLORS = {
  5: "#d92c2c",
  10: "#1f5bd8",
  20: "#0a9d58",
  60: "#e4a11b",
  120: "#8040a0",
  240: "#606060"
};

const chartGrid = document.querySelector("#chartGrid");
const marketSummary = document.querySelector("#marketSummary");
const sessionButtons = document.querySelectorAll(".session-button");
const template = document.querySelector("#chart-card-template");
const chartState = new Map();
let marketRefreshInFlight = false;
let chartRefreshInFlight = false;
let sessionMode = "KRX";

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatChange(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(decimals)}%`;
}

function isKoreanSymbol(symbol) {
  return symbol?.endsWith(".KS") || symbol?.endsWith(".KQ");
}

function priceDecimalsForSymbol(symbol) {
  return symbol?.endsWith(".US") ? 2 : CHART_PRICE_DECIMALS;
}

function priceFormatForSymbol(symbol) {
  const precision = priceDecimalsForSymbol(symbol);
  return { type: "price", precision, minMove: precision === 2 ? 0.01 : 1 };
}

function loadSavedCharts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed) || parsed.length !== INITIAL_CHARTS.length) return INITIAL_CHARTS;
    return parsed.map((item, index) => ({
      symbol: String(item.symbol || INITIAL_CHARTS[index].symbol).toUpperCase(),
      name: String(item.name || INITIAL_CHARTS[index].name),
      decimals: Number.isFinite(Number(item.decimals)) ? Number(item.decimals) : INITIAL_CHARTS[index].decimals
    }));
  } catch {
    return INITIAL_CHARTS;
  }
}

function saveCharts() {
  const items = [...chartState.values()].map((state) => state.item);
  if (items.length === INITIAL_CHARTS.length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }
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

function isSymbolEditing(state) {
  const input = state.card.querySelector(".symbol-input");
  return state.isEditingSymbol || document.activeElement === input;
}

function formatTooltipTime(interval, time) {
  const date = new Date(time * 1000);
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (!isIntraday(interval)) return datePart;
  return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isIntraday(interval) {
  return !["1d", "1wk", "1mo"].includes(interval);
}

function tickFormatter(interval, time) {
  const date = new Date(time * 1000);
  if (!isIntraday(interval)) {
    return `${String(date.getFullYear()).slice(2)}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function calcSma(rows, period) {
  const result = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = 0; j < period; j += 1) sum += rows[i - j].close;
    result.push({ time: rows[i].time, value: sum / period });
  }
  return result;
}

function ema(values, period) {
  const out = [];
  const k = 2 / (period + 1);
  let current = values[0];
  for (const value of values) {
    current = current == null ? value : value * k + current * (1 - k);
    out.push(current);
  }
  return out;
}

function calcMacd(rows) {
  const closes = rows.map((row) => row.close);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  return rows.map((row, index) => ({
    time: row.time,
    value: ema12[index] - ema26[index]
  }));
}

function createLwChart(container, state) {
  const priceFormat = priceFormatForSymbol(state.item.symbol);
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      backgroundColor: "transparent",
      textColor: "#172033",
      fontFamily: "Inter, Pretendard, sans-serif"
    },
    localization: {
      timeFormatter: (time) => tickFormatter(state.interval, time),
      priceFormatter: (price) => formatAxisPrice(price, state.item.symbol)
    },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "#cbd5e1", width: 1, style: 3 },
      horzLine: { color: "#cbd5e1", width: 1, style: 3 }
    },
    rightPriceScale: {
      borderColor: "#dbe3f1",
      scaleMargins: { top: 0.19, bottom: 0.08 },
      minimumWidth: PRICE_SCALE_WIDTH
    },
    timeScale: {
      borderColor: "#dbe3f1",
      timeVisible: isIntraday(state.interval),
      secondsVisible: false,
      rightOffset: CHART_RIGHT_OFFSET,
      barSpacing: CHART_BAR_SPACING,
      tickMarkFormatter: (time) => tickFormatter(state.interval, time)
    }
  });

  new ResizeObserver((entries) => {
    if (!entries.length) return;
    const { width, height } = entries[0].contentRect;
    chart.applyOptions({ width, height });
  }).observe(container);

  const candleSeries = chart.addCandlestickSeries({
    upColor: "#d92c2c",
    downColor: "#1f5bd8",
    borderVisible: false,
    wickUpColor: "#d92c2c",
    wickDownColor: "#1f5bd8",
    lastValueVisible: false,
    priceLineVisible: false,
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

  return { chart, candleSeries, maSeries };
}

function rowByTime(state, time) {
  return state.rows.find((row) => row.time === time);
}

function marketDateKey(symbol, time) {
  const date = typeof time === "number" ? new Date(time * 1000) : new Date(time);
  const timeZone = isKoreanSymbol(symbol) ? "Asia/Seoul" : "America/New_York";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function marketMinute(symbol, time) {
  const date = typeof time === "number" ? new Date(time * 1000) : new Date(time);
  const timeZone = isKoreanSymbol(symbol) ? "Asia/Seoul" : "America/New_York";
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
  if (isKoreanSymbol(symbol)) return minute >= 9 * 60 && minute <= 15 * 60 + 30;
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
  const open = regularOpenForRow(state, row);
  const close = row.close;
  const previousClose = previousRegularCloseForRow(state, row);
  const changePct = Number.isFinite(previousClose) && previousClose !== 0
    ? ((close - previousClose) / previousClose) * 100
    : NaN;
  return { open, close, changePct };
}

function showTooltip(state, param) {
  const tooltip = state.card.querySelector(".price-tooltip");
  if (!param?.time || !param.point || param.point.x < 0 || param.point.y < 0) {
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
    <div class="tooltip-date">${formatTooltipTime(state.interval, row.time)}</div>
    <div class="tooltip-row"><span>시가</span><strong>${formatNumber(open, decimals)}</strong></div>
    <div class="tooltip-row"><span>종가</span><strong>${formatNumber(close, decimals)}</strong></div>
    <div class="tooltip-row ${direction}"><span>등락률</span><strong>${formatChange(changePct, 2)}</strong></div>
  `;

  const cardRect = state.card.getBoundingClientRect();
  const tooltipWidth = 142;
  const tooltipHeight = 86;
  const left = Math.min(Math.max(8, param.point.x + 14), cardRect.width - tooltipWidth - 8);
  const top = Math.min(Math.max(8, param.point.y + 14), cardRect.height - tooltipHeight - 8);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.display = "block";
}

function visibleRows(state) {
  return state.rows?.slice(-state.limit) || [];
}

function keepLatestVisible(state) {
  const rows = visibleRows(state);
  if (!rows.length) return;
  const to = state.rows.length - 1 + CHART_RIGHT_OFFSET;
  state.instance.chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, state.rows.length - rows.length),
    to
  });
}

function drawMacdBackground(state) {
  const { bgCanvas, rows, macd, instance } = state;
  if (!bgCanvas || !rows?.length || !macd?.length) return;
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

  const timeScale = instance.chart.timeScale();
  const points = rows
    .map((row, index) => {
      const x = timeScale.timeToCoordinate(row.time);
      return Number.isFinite(x) ? { index, x: x * dpr } : null;
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
}

function updateSeriesVisibility(state) {
  if (!state.rows?.length) return;
  const { instance, visible } = state;
  instance.candleSeries.setData(visible.candle ? state.rows : []);
  for (const period of MA_PERIODS) {
    instance.maSeries[period].setData(visible[`ma${period}`] ? calcSma(state.rows, period) : []);
  }
}

function renderLegend(state, payload) {
  const rows = visibleRows(state);
  const last = rows.at(-1);
  const changePct = Number(payload.changePercent ?? 0);
  const direction = changePct >= 0 ? "up" : "down";
  const decimals = priceDecimalsForSymbol(payload.symbol || state.item.symbol);
  const card = state.card;

  if (!isSymbolEditing(state)) {
    card.querySelector(".symbol-input").value = payload.name || payload.symbol;
  }
  card.querySelector(".symbol-code").textContent = payload.symbol;
  const priceEl = card.querySelector(".last-price");
  priceEl.textContent = formatNumber(payload.price ?? last?.close, decimals);
  priceEl.className = `last-price ${direction}`;
  const statusEl = card.querySelector(".market-status");
  statusEl.textContent = payload.marketStatus || "종가";
  statusEl.className = `market-status ${direction}`;
  card.querySelector(".last-change").textContent = formatChange(changePct, 2);
  card.querySelector(".last-change").className = `last-change ${direction}`;
}

function applyPayload(state, payload, initial = false) {
  const rows = payload.series || [];
  if (!rows.length) return;
  const previousLastTime = state.rows?.at(-1)?.time;
  const latest = rows.at(-1);

  state.rows = rows;
  state.macd = calcMacd(rows);
  state.previousClose = Number(payload.previousClose);
  const priceFormat = priceFormatForSymbol(state.item.symbol);
  state.instance.chart.applyOptions({
    localization: {
      timeFormatter: (time) => tickFormatter(state.interval, time),
      priceFormatter: (price) => formatAxisPrice(price, state.item.symbol)
    },
    timeScale: {
      timeVisible: isIntraday(state.interval),
      rightOffset: CHART_RIGHT_OFFSET,
      barSpacing: CHART_BAR_SPACING,
      tickMarkFormatter: (time) => tickFormatter(state.interval, time)
    }
  });
  state.instance.candleSeries.applyOptions({ priceFormat });
  for (const period of MA_PERIODS) {
    state.instance.maSeries[period].applyOptions({ priceFormat });
  }

  if (!initial && isIntraday(state.interval) && previousLastTime === latest.time && state.visible.candle) {
    state.instance.candleSeries.update(latest);
  } else {
    state.instance.candleSeries.setData(state.visible.candle ? rows : []);
  }

  for (const period of MA_PERIODS) {
    state.instance.maSeries[period].setData(state.visible[`ma${period}`] ? calcSma(rows, period) : []);
  }

  renderLegend(state, payload);
  keepLatestVisible(state);
  setTimeout(() => drawMacdBackground(state), 0);
  state.card.classList.add("loaded");
}

async function fetchChart(state) {
  const params = new URLSearchParams({
    symbol: state.item.symbol,
    name: state.item.name,
    interval: state.interval,
    limit: String(state.limit + WARMUP_BARS),
    mode: sessionMode
  });
  const response = await fetch(`/api/chart?${params.toString()}`);
  if (!response.ok) throw new Error(`chart ${response.status}`);
  return response.json();
}

async function refreshCard(state, initial = false) {
  if (initial) {
    state.card.classList.remove("loaded");
    state.card.querySelector(".loading").textContent = "불러오는 중";
  }
  try {
    const payload = await fetchChart(state);
    state.item = {
      symbol: payload.symbol,
      name: payload.name,
      decimals: payload.decimals
    };
    applyPayload(state, payload, initial);
  } catch {
    state.card.querySelector(".loading").textContent = "데이터 오류";
  }
}

function closeSuggestions(card) {
  card.querySelector(".suggestions").classList.remove("open");
}

document.addEventListener("pointerdown", (event) => {
  document.querySelectorAll(".chart-card").forEach((card) => {
    if (!card.querySelector(".symbol-search")?.contains(event.target)) closeSuggestions(card);
  });
});

async function showSuggestions(card, query) {
  const suggestions = card.querySelector(".suggestions");
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const json = await response.json();
  suggestions.replaceChildren(
    ...json.results.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion";
      button.innerHTML = `<b>${item.name}</b><span>${item.symbol}</span>`;
      button.addEventListener("mousedown", async (event) => {
        event.preventDefault();
        const state = chartState.get(card.dataset.cardId);
        const input = card.querySelector(".symbol-input");
        state.item = {
          symbol: item.symbol,
          name: item.name,
          decimals: item.symbol.endsWith(".KS") || item.symbol.endsWith(".KQ") ? 0 : 2
        };
        state.isEditingSymbol = false;
        input.value = item.name;
        input.blur();
        closeSuggestions(card);
        saveCharts();
        await refreshCard(state, true);
      });
      return button;
    })
  );
  suggestions.classList.toggle("open", json.results.length > 0);
}

function bindSearch(card) {
  const input = card.querySelector(".symbol-input");
  const suggestions = card.querySelector(".suggestions");
  const state = chartState.get(card.dataset.cardId);
  suggestions.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("focus", () => {
    state.isEditingSymbol = true;
    showSuggestions(card, input.value);
  });
  input.addEventListener("input", () => {
    state.isEditingSymbol = true;
    showSuggestions(card, input.value);
  });
  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    const first = card.querySelector(".suggestion");
    if (first) first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      closeSuggestions(card);
      state.isEditingSymbol = false;
    }, 240);
  });
}

function bindLegend(card, state) {
  card.querySelectorAll(".ma-legend button").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.series;
      state.visible[key] = !state.visible[key];
      button.classList.toggle("off", !state.visible[key]);
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
        renderTimeframeButtons(card, state);
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
    const next = Math.min(500, Math.max(20, Number(input.value || DEFAULT_LIMIT)));
    input.value = String(next);
    state.limit = next;
    await refreshCard(state, true);
  };
  input.addEventListener("change", apply);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
}

async function createCard(item, index) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".chart-card");
  const stage = fragment.querySelector(".chart-stage");
  const bgCanvas = fragment.querySelector(".macd-bg");
  const id = `card-${index}`;
  card.dataset.cardId = id;
  chartGrid.append(card);

  const state = {
    card,
    bgCanvas,
    item,
    interval: DEFAULT_INTERVAL,
    limit: DEFAULT_LIMIT,
    rows: [],
    macd: [],
    visible: {
      candle: true,
      ma5: true,
      ma10: true,
      ma20: true,
      ma60: true,
      ma120: true,
      ma240: true
    }
  };
  state.instance = createLwChart(stage, state);
  state.instance.chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawMacdBackground(state));
  state.instance.chart.timeScale().subscribeSizeChange(() => drawMacdBackground(state));
  state.instance.chart.subscribeCrosshairMove((param) => showTooltip(state, param));

  chartState.set(id, state);
  bindSearch(card);
  bindLegend(card, state);
  renderTimeframeButtons(card, state);
  bindPeriod(card, state);
  await refreshCard(state, true);
}

function renderMarketItem(item, quote) {
  const change = Number(quote.changePercent ?? quote.changeRate ?? 0);
  const direction = change >= 0 ? "up" : "down";
  const status = quote.marketStatus === "장중" ? "장중" : "장종료";
  const span = document.createElement("span");
  span.className = `market-item ${direction}`;
  span.innerHTML = `${item.label}<strong>${formatNumber(quote.price, item.decimals)}</strong><span class="market-change">(${formatChange(change, 2)})</span><span class="market-session ${direction}">${status}</span>`;
  return span;
}

async function loadMarketSummary() {
  if (marketRefreshInFlight) return;
  marketRefreshInFlight = true;
  try {
    const results = await Promise.all(MARKET_ITEMS.map(async (item) => {
      try {
        const response = await fetch(`/api/quote?symbol=${encodeURIComponent(item.symbol)}&mode=${sessionMode}`);
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
  } finally {
    marketRefreshInFlight = false;
  }
}

async function refreshAll(initial = false) {
  if (!initial && chartRefreshInFlight) return;
  chartRefreshInFlight = true;
  try {
    const states = [...chartState.values()].filter((state) => initial || !isSymbolEditing(state));
    await Promise.all(states.map((state) => refreshCard(state, initial)));
  } finally {
    chartRefreshInFlight = false;
  }
}

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

updateSessionButtons();
await Promise.all([loadMarketSummary(), ...loadSavedCharts().map(createCard)]);

setInterval(loadMarketSummary, UPDATE_INTERVAL_MS);
setInterval(() => {
  refreshAll(false);
}, UPDATE_INTERVAL_MS);
