const INITIAL_CHARTS = [
  { symbol: "000660.KS", name: "SK하이닉스" }, { symbol: "005930.KS", name: "삼성전자" },
  { symbol: "AVGO.US", name: "Broadcom" }, { symbol: "SNDK.US", name: "Sandisk" }
];
const TIMEFRAMES = [["1분", "1m"], ["3분", "3m"], ["5분", "5m"], ["10분", "10m"], ["15분", "15m"], ["30분", "30m"], ["1시간", "60m"], ["일", "1d"], ["주", "1wk"], ["월", "1mo"]];
const CHART_TYPES = [["삼선전환도", "three-line"], ["Renko", "renko"], ["P&F", "pnf"]];
const MARKET_ITEMS = [{ label: "달러/원", symbol: "KRW=X", decimals: 2 }, { label: "KOSPI", symbol: "^KS11", decimals: 2 }, { label: "KOSDAQ", symbol: "^KQ11", decimals: 2 }, { label: "나스닥", symbol: "^IXIC", decimals: 2 }];
// Naver's 3-minute view covers roughly five trading days. Keep the same usable
// range by default; users can still lower or raise it with 조회기간.
const DEFAULT_LIMIT_BY_INTERVAL = { "1m": 700, "3m": 700, "5m": 500, "10m": 300, "15m": 240, "30m": 180, "60m": 150, "1d": 120, "1wk": 120, "1mo": 120 };
const STORAGE_KEY = "stock12.threeLineBreak.charts.v1";
const SESSION_MODE_KEY = "stock12.threeLineBreak.session.v1";
const REFRESH_MS = 30_000;
const chartGrid = document.querySelector("#chartGrid");
const marketSummary = document.querySelector("#marketSummary");
const template = document.querySelector("#chart-card-template");
const chartState = new Map();
const apiBase = location.pathname === "/stock12" || location.pathname.startsWith("/stock12/") ? "/stock12/api" : "/api";
let sessionMode = localStorage.getItem(SESSION_MODE_KEY) || "KRX";

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "--";
}
function isKorean(symbol) { return symbol.endsWith(".KS") || symbol.endsWith(".KQ"); }
function isIntraday(interval) { return !["1d", "1wk", "1mo"].includes(interval); }
function decimalsFor(symbol) { return isKorean(symbol) ? 0 : 2; }
function tickerFor(symbol) { return String(symbol || "").replace(/\.(KS|KQ|US)$/i, ""); }
function defaultLimit(interval) { return DEFAULT_LIMIT_BY_INTERVAL[interval] || 120; }
function timeText(time, interval) {
  const date = new Date(time * 1000);
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return ["1d", "1wk", "1mo"].includes(interval) ? dateText : `${dateText} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function loadSavedCharts() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); if (Array.isArray(saved) && saved.length === INITIAL_CHARTS.length) return saved; } catch { /* optional */ }
  return INITIAL_CHARTS;
}
function saveCharts() { localStorage.setItem(STORAGE_KEY, JSON.stringify([...chartState.values()].map((state) => state.item))); }
function ema(values, period) {
  const weight = 2 / (period + 1); let previous = values[0] || 0;
  return values.map((value) => (previous = value * weight + previous * (1 - weight)));
}
function macd(rows) { const closes = rows.map((row) => Number(row.close)); const fast = ema(closes, 12); const slow = ema(closes, 26); return fast.map((value, index) => value - slow[index]); }

// Standard three-line-break construction (the same convention used by Naver):
// continuation follows the prior line's close; a reversal needs a close beyond
// the high/low of the previous three completed lines. Input is closing prices.
function threeLineBreak(rows) {
  if (!rows.length) return [];
  const firstClose = Number(rows[0].close);
  const lines = [{ open: firstClose, close: firstClose, high: firstClose, low: firstClose, time: rows[0].time, direction: 0 }];
  for (const row of rows.slice(1)) {
    const close = Number(row.close);
    const last = lines[lines.length - 1];
    const recent = lines.slice(-3);
    const reversalHigh = Math.max(...recent.map((line) => line.high));
    const reversalLow = Math.min(...recent.map((line) => line.low));
    const risingContinuation = (last.direction >= 0 && close > last.close);
    const fallingContinuation = (last.direction <= 0 && close < last.close);
    const risingReversal = last.direction < 0 && close > reversalHigh;
    const fallingReversal = last.direction > 0 && close < reversalLow;
    if (!risingContinuation && !fallingContinuation && !risingReversal && !fallingReversal) continue;
    const direction = risingContinuation || risingReversal ? 1 : -1;
    lines.push({ open: last.close, close, high: Math.max(last.close, close), low: Math.min(last.close, close), time: row.time, direction });
  }
  return lines;
}
function tickSize(price, symbol) {
  if (!isKorean(symbol)) return price >= 10 ? .1 : .01;
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}
function roundToTick(value, tick) { return Math.max(tick, Math.round(value / tick) * tick); }
function autoBoxSize(rows, symbol) {
  const changes = rows.slice(1).map((row, index) => Math.abs(Number(row.close) - Number(rows[index].close))).filter((value) => value > 0).sort((a, b) => a - b);
  const median = changes[Math.floor(changes.length / 2)] || Math.abs(Number(rows.at(-1)?.close || 1)) * .003;
  return roundToTick(Math.max(median * 2, tickSize(Number(rows.at(-1)?.close || 1), symbol)), tickSize(Number(rows.at(-1)?.close || 1), symbol));
}
function renko(rows, symbol) {
  if (!rows.length) return [];
  const box = autoBoxSize(rows, symbol); const first = Number(rows[0].close);
  const bricks = []; let close = Math.round(first / box) * box; let direction = 0;
  for (const row of rows.slice(1)) {
    const value = Number(row.close);
    const add = (next, nextDirection) => { bricks.push({ open: close, close: next, high: Math.max(close, next), low: Math.min(close, next), time: row.time, direction: nextDirection }); close = next; direction = nextDirection; };
    if (direction >= 0 && value >= close + box) while (value >= close + box) add(close + box, 1);
    else if (direction <= 0 && value <= close - box) while (value <= close - box) add(close - box, -1);
    else if (direction > 0 && value <= close - box * 2) { add(close - box, -1); while (value <= close - box) add(close - box, -1); }
    else if (direction < 0 && value >= close + box * 2) { add(close + box, 1); while (value >= close + box) add(close + box, 1); }
  }
  return bricks.length ? bricks : [{ open: close, close, high: close, low: close, time: rows[0].time, direction: 0 }];
}
function pointAndFigure(rows, symbol) {
  if (!rows.length) return [];
  const box = autoBoxSize(rows, symbol); let level = Math.round(Number(rows[0].close) / box) * box; let direction = 0; const columns = [];
  const makeColumn = (nextDirection, time) => { const column = { direction: nextDirection, time, levels: [] }; columns.push(column); direction = nextDirection; return column; };
  for (const row of rows.slice(1)) {
    const value = Number(row.close); let column = columns.at(-1);
    if (!direction && value >= level + box) { column = makeColumn(1, row.time); while (value >= level + box) { level += box; column.levels.push(level); } }
    else if (!direction && value <= level - box) { column = makeColumn(-1, row.time); while (value <= level - box) { level -= box; column.levels.push(level); } }
    else if (direction > 0 && value >= level + box) { while (value >= level + box) { level += box; column.levels.push(level); } column.time = row.time; }
    else if (direction < 0 && value <= level - box) { while (value <= level - box) { level -= box; column.levels.push(level); } column.time = row.time; }
    else if (direction > 0 && value <= level - box * 3) { column = makeColumn(-1, row.time); while (value <= level - box) { level -= box; column.levels.push(level); } }
    else if (direction < 0 && value >= level + box * 3) { column = makeColumn(1, row.time); while (value >= level + box) { level += box; column.levels.push(level); } }
  }
  return columns.length ? columns : [{ direction: 1, time: rows[0].time, levels: [level] }];
}
function updateChartGeometry(state) {
  state.threeLines = threeLineBreak(state.rows);
  state.lines = state.chartType === "renko" ? renko(state.rows, state.item.symbol) : state.threeLines;
  state.pnfColumns = state.chartType === "pnf" ? pointAndFigure(state.rows, state.item.symbol) : [];
}
function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio)); const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  return { width: rect.width, height: rect.height, ratio };
}
function drawLegacyChart(state) {
  const { canvas, rows, lines, macdValues } = state; if (!canvas || !rows?.length || !lines?.length) return;
  const { width, height, ratio } = resizeCanvas(canvas); const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  // Reserve a header lane for the symbol and current price on narrow cards.
  const pad = { top: 88, right: 70, bottom: 30, left: 12 }; const chartW = Math.max(1, width - pad.left - pad.right); const chartH = Math.max(1, height - pad.top - pad.bottom);
  const values = lines.flatMap((line) => [line.open, line.close]); const min = Math.min(...values); const max = Math.max(...values); const spread = Math.max(max - min, Math.abs(max || 1) * .015); const low = min - spread * .09; const high = max + spread * .09;
  const y = (value) => pad.top + (high - value) / (high - low) * chartH; const xForRow = (index) => pad.left + index / Math.max(rows.length - 1, 1) * chartW;
  // MACD background is a flat color by sign, never a magnitude gradient.
  let regionStart = 0;
  let sign = (macdValues[0] || 0) >= 0 ? 1 : -1;
  for (let index = 1; index <= rows.length; index += 1) {
    const nextSign = index < rows.length && (macdValues[index] || 0) >= 0 ? 1 : -1;
    if (index < rows.length && nextSign === sign) continue;
    const left = xForRow(regionStart);
    const right = index >= rows.length ? pad.left + chartW : xForRow(index);
    ctx.fillStyle = sign > 0 ? "rgba(239,83,80,.09)" : "rgba(21,101,192,.09)";
    ctx.fillRect(left, pad.top, Math.max(1, right - left), chartH);
    regionStart = index; sign = nextSign;
  }
  ctx.strokeStyle = "rgba(111,132,161,.2)"; ctx.lineWidth = 1; ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "left";
  for (let row = 0; row <= 4; row += 1) { const lineY = pad.top + chartH * row / 4; ctx.beginPath(); ctx.moveTo(pad.left, lineY); ctx.lineTo(pad.left + chartW, lineY); ctx.stroke(); ctx.fillStyle = "#68758b"; ctx.fillText(formatNumber(high - (high - low) * row / 4, decimalsFor(state.item.symbol)), pad.left + chartW + 8, lineY + 4); }
  const visibleLines = lines.slice(-Math.min(lines.length, 130)); const step = chartW / Math.max(visibleLines.length, 1); const brickWidth = Math.max(3, Math.min(18, step * .72));
  state.drawnLines = visibleLines.map((line, index) => ({ ...line, x: pad.left + step * (index + .5), width: brickWidth, y1: y(line.open), y2: y(line.close) }));
  state.drawnLines.forEach((line) => { const top = Math.min(line.y1, line.y2); const brickHeight = Math.max(2, Math.abs(line.y2 - line.y1)); const rising = line.direction >= 0; ctx.fillStyle = rising ? "#ef5350" : "#1565c0"; ctx.fillRect(line.x - line.width / 2, top, line.width, brickHeight); ctx.strokeStyle = rising ? "#c62828" : "#0d47a1"; ctx.strokeRect(line.x - line.width / 2, top, line.width, brickHeight); });
  ctx.fillStyle = "#68758b"; const labels = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]; labels.forEach((row, index) => ctx.fillText(timeText(row.time, state.interval).slice(2), pad.left + chartW * index / 2, height - 10));
}
function drawChart(state) {
  const { canvas, rows, lines, macdValues, pnfColumns } = state;
  if (!canvas || !rows?.length) return;
  const { width, height, ratio } = resizeCanvas(canvas); const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  const pad = { top: 106, right: 70, bottom: 30, left: 12 }; const chartW = Math.max(1, width - pad.left - pad.right); const chartH = Math.max(1, height - pad.top - pad.bottom);
  const plotValues = state.chartType === "pnf" ? pnfColumns.flatMap((column) => column.levels) : lines.flatMap((line) => [line.open, line.close]);
  if (!plotValues.length) return;
  const min = Math.min(...plotValues); const max = Math.max(...plotValues); const spread = Math.max(max - min, Math.abs(max || 1) * .015); const low = min - spread * .09; const high = max + spread * .09;
  const y = (value) => pad.top + (high - value) / (high - low) * chartH; const xForRow = (index) => pad.left + index / Math.max(rows.length - 1, 1) * chartW;

  // Keep the MACD background flat, and extend it under the timeframe/type controls.
  let regionStart = 0; let sign = (macdValues[0] || 0) >= 0 ? 1 : -1;
  for (let index = 1; index <= rows.length; index += 1) {
    const nextSign = index < rows.length && (macdValues[index] || 0) >= 0 ? 1 : -1;
    if (index < rows.length && nextSign === sign) continue;
    const left = xForRow(regionStart); const right = index >= rows.length ? width : xForRow(index);
    ctx.fillStyle = sign > 0 ? "rgba(239,83,80,.09)" : "rgba(21,101,192,.09)";
    ctx.fillRect(left, 0, Math.max(1, right - left), height - pad.bottom);
    regionStart = index; sign = nextSign;
  }
  ctx.strokeStyle = "rgba(111,132,161,.2)"; ctx.lineWidth = 1; ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "left";
  for (let row = 0; row <= 4; row += 1) { const lineY = pad.top + chartH * row / 4; ctx.beginPath(); ctx.moveTo(pad.left, lineY); ctx.lineTo(pad.left + chartW, lineY); ctx.stroke(); ctx.fillStyle = "#68758b"; ctx.fillText(formatNumber(high - (high - low) * row / 4, decimalsFor(state.item.symbol)), pad.left + chartW + 8, lineY + 4); }

  if (state.chartType === "pnf") {
    const visibleCount = 80; const maxOffset = Math.max(0, pnfColumns.length - visibleCount); state.viewOffset = Math.min(maxOffset, Math.max(0, state.viewOffset || 0)); state.maxViewOffset = maxOffset;
    const end = pnfColumns.length - state.viewOffset; const columns = pnfColumns.slice(Math.max(0, end - visibleCount), end); const step = chartW / Math.max(columns.length, 1); const glyph = Math.max(9, Math.min(16, step * .9)); state.drawnLines = [];
    columns.forEach((column, index) => column.levels.forEach((level) => { const x = pad.left + step * (index + .5); const lineY = y(level); ctx.fillStyle = column.direction > 0 ? "#d93434" : "#1761b5"; ctx.font = `700 ${glyph}px Inter, sans-serif`; ctx.textAlign = "center"; ctx.fillText(column.direction > 0 ? "X" : "O", x, lineY + glyph * .34); state.drawnLines.push({ open: level, close: level, time: column.time, direction: column.direction, x, width: step, y1: lineY, y2: lineY }); }));
  } else {
    const visibleCount = 130; const maxOffset = Math.max(0, lines.length - visibleCount); state.viewOffset = Math.min(maxOffset, Math.max(0, state.viewOffset || 0)); state.maxViewOffset = maxOffset;
    const end = lines.length - state.viewOffset; const visibleLines = lines.slice(Math.max(0, end - visibleCount), end); const step = chartW / Math.max(visibleLines.length, 1); const brickWidth = Math.max(3, Math.min(18, step * .72));
    state.drawnLines = visibleLines.map((line, index) => ({ ...line, x: pad.left + step * (index + .5), width: brickWidth, y1: y(line.open), y2: y(line.close) }));
    state.drawnLines.forEach((line) => { const top = Math.min(line.y1, line.y2); const brickHeight = Math.max(2, Math.abs(line.y2 - line.y1)); const rising = line.direction >= 0; ctx.fillStyle = rising ? "#ef5350" : "#1565c0"; ctx.fillRect(line.x - line.width / 2, top, line.width, brickHeight); ctx.strokeStyle = rising ? "#c62828" : "#0d47a1"; ctx.strokeRect(line.x - line.width / 2, top, line.width, brickHeight); });
  }
  const timeline = state.drawnLines.length ? [state.drawnLines[0], state.drawnLines[Math.floor(state.drawnLines.length / 2)], state.drawnLines[state.drawnLines.length - 1]] : [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]];
  ctx.fillStyle = "#68758b"; ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "left"; timeline.forEach((row, index) => ctx.fillText(timeText(row.time, state.interval).slice(2), pad.left + chartW * index / 2, height - 10));
}
function showTooltip(state, event) {
  const rect = state.canvas.getBoundingClientRect(); const x = event.clientX - rect.left;
  const nearest = state.drawnLines?.reduce((best, line) => !best || Math.abs(line.x - x) < Math.abs(best.x - x) ? line : best, null); if (!nearest) return;
  const change = ((nearest.close / nearest.open - 1) * 100) || 0;
  state.tooltip.innerHTML = `<b>${timeText(nearest.time, state.interval)}</b><br>시가 ${formatNumber(nearest.open, decimalsFor(state.item.symbol))} · 종가 ${formatNumber(nearest.close, decimalsFor(state.item.symbol))}<br><span class="${change >= 0 ? "up" : "down"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</span>`;
  state.tooltip.style.left = `${Math.min(rect.width - 180, Math.max(8, x + 12))}px`; state.tooltip.style.top = `${Math.max(55, event.clientY - rect.top - 58)}px`; state.tooltip.classList.add("visible");
}
async function fetchJson(path) { const response = await fetch(`${apiBase}${path}`, { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
function updateQuote(state, payload) {
  const latest = payload.series?.[payload.series.length - 1]; const price = Number(payload.price || latest?.close); const change = Number(payload.changePercent ?? payload.changeRate ?? ((price / Number(payload.previousClose) - 1) * 100)); const up = change >= 0;
  const priceEl = state.card.querySelector(".last-price"); priceEl.textContent = formatNumber(price, payload.decimals ?? decimalsFor(state.item.symbol)); priceEl.className = `last-price ${up ? "up" : "down"}`; const changeEl = state.card.querySelector(".last-change"); changeEl.textContent = Number.isFinite(change) ? `${up ? "+" : ""}${change.toFixed(2)}%` : "--"; changeEl.className = `last-change ${up ? "up" : "down"}`;
  state.card.querySelector(".market-status").textContent = "";
}
function showSignalAlert(state, kind, time) {
  const alert = state.alert;
  const rising = kind === "turn-up";
  const twoLines = kind === "two-lines";
  alert.className = `signal-alert visible ${twoLines ? "two-lines" : rising ? "turn-up" : "turn-down"}`;
  alert.querySelector(".signal-alert-title").textContent = twoLines ? "삼선전환도 2봉 확인" : rising ? "MACD 빨강 전환" : "MACD 파랑 전환";
  alert.querySelector(".signal-alert-message").textContent = twoLines
    ? `${timeText(time, state.interval)} · 색 전환 뒤 삼선전환도 봉 2개가 생성되었습니다.`
    : `${timeText(time, state.interval)} · MACD 배경이 ${rising ? "파랑에서 빨강" : "빨강에서 파랑"}으로 전환되었습니다.`;
}
function evaluateSignals(state) {
  if (!isIntraday(state.interval) || !state.rows.length) { state.previousMacdSign = null; return; }
  const sign = (state.macdValues[state.macdValues.length - 1] || 0) >= 0 ? 1 : -1;
  const lastTime = state.rows[state.rows.length - 1].time;
  const lineCount = state.threeLines.length;
  if (state.previousMacdSign == null) { state.previousMacdSign = sign; return; }
  if (sign !== state.previousMacdSign) {
    showSignalAlert(state, sign > 0 ? "turn-up" : "turn-down", lastTime);
    state.pendingTwoLineAlert = { sign, baselineLineCount: lineCount };
  } else if (state.pendingTwoLineAlert?.sign === sign && lineCount >= state.pendingTwoLineAlert.baselineLineCount + 2) {
    showSignalAlert(state, "two-lines", lastTime);
    state.pendingTwoLineAlert = null;
  }
  state.previousMacdSign = sign;
}
async function refreshChart(state, showLoading = false) {
  if (state.loading) return; state.loading = true; if (showLoading) state.loadingEl.classList.add("visible");
  try { const params = new URLSearchParams({ symbol: state.item.symbol, name: state.item.name, interval: state.interval, limit: String(state.limit), mode: sessionMode }); const payload = await fetchJson(`/chart?${params}`); const rows = (payload.series || []).filter((row) => Number.isFinite(Number(row.close))).slice(-state.limit); if (!rows.length) throw new Error("empty series"); state.rows = rows; state.macdValues = macd(rows); updateChartGeometry(state); drawChart(state); updateQuote(state, payload); evaluateSignals(state); state.card.classList.remove("error"); }
  catch (error) { state.card.classList.add("error"); state.card.querySelector(".market-status").textContent = "데이터 재시도 중"; console.warn("Chart refresh failed", error); }
  finally { state.loading = false; state.loadingEl.classList.remove("visible"); }
}
function renderTimeframes(state) {
  const holder = state.card.querySelector(".timeframe-buttons"); holder.replaceChildren(...TIMEFRAMES.map(([label, value]) => { const button = document.createElement("button"); button.type = "button"; button.className = `tf-button ${state.interval === value ? "active" : ""}`; button.textContent = label; button.addEventListener("click", () => { state.interval = value; state.limit = defaultLimit(value); state.viewOffset = 0; state.previousMacdSign = null; state.pendingTwoLineAlert = null; state.card.querySelector(".period-input").value = state.limit; renderTimeframes(state); refreshChart(state, true); }); return button; }));
}
function renderChartTypes(state) {
  const holder = state.card.querySelector(".chart-type-buttons");
  holder.replaceChildren(...CHART_TYPES.map(([label, value]) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `chart-type-button ${state.chartType === value ? "active" : ""}`; button.textContent = label;
    button.addEventListener("click", () => { state.chartType = value; state.viewOffset = 0; updateChartGeometry(state); state.card.querySelector(".chart-note").firstChild.textContent = `${label} · MACD 양수 `; renderChartTypes(state); drawChart(state); });
    return button;
  }));
}
async function suggestSymbols(state, query) {
  const box = state.card.querySelector(".suggestions"); if (query.trim().length < 1) { box.replaceChildren(); return; }
  try { const payload = await fetchJson(`/search?q=${encodeURIComponent(query)}`); box.replaceChildren(...(payload.results || []).slice(0, 8).map((item) => { const button = document.createElement("button"); button.type = "button"; button.innerHTML = `<b>${item.name}</b><small>${item.symbol}</small>`; button.addEventListener("mousedown", (event) => { event.preventDefault(); state.item = { symbol: item.symbol, name: item.name }; state.card.querySelector(".symbol-input").value = item.name; state.card.querySelector(".symbol-code").textContent = `티커 ${tickerFor(item.symbol)}`; box.replaceChildren(); saveCharts(); refreshChart(state, true); }); return button; })); } catch { box.replaceChildren(); }
}
function createCard(item, index) {
  const card = template.content.firstElementChild.cloneNode(true); chartGrid.append(card);
  const state = { item, card, canvas: card.querySelector("canvas"), tooltip: card.querySelector(".price-tooltip"), loadingEl: card.querySelector(".loading"), alert: card.querySelector(".signal-alert"), interval: "1d", limit: 120, chartType: "three-line", rows: [], lines: [], threeLines: [], pnfColumns: [], macdValues: [], drawnLines: [], viewOffset: 0, maxViewOffset: 0, previousMacdSign: null, pendingTwoLineAlert: null };
  card.querySelector(".symbol-input").value = item.name; card.querySelector(".symbol-code").textContent = `티커 ${tickerFor(item.symbol)}`;
  state.canvas.addEventListener("pointermove", (event) => { if (state.dragStartX != null) { const delta = state.dragStartX - event.clientX; const step = Math.max(4, state.canvas.clientWidth / 100); state.viewOffset = Math.min(state.maxViewOffset, Math.max(0, state.dragOriginOffset + Math.round(delta / step))); drawChart(state); return; } showTooltip(state, event); });
  state.canvas.addEventListener("pointerdown", (event) => { state.dragStartX = event.clientX; state.dragOriginOffset = state.viewOffset; state.canvas.setPointerCapture(event.pointerId); state.tooltip.classList.remove("visible"); });
  state.canvas.addEventListener("pointerup", (event) => { state.dragStartX = null; state.canvas.releasePointerCapture?.(event.pointerId); });
  state.canvas.addEventListener("pointercancel", () => { state.dragStartX = null; }); state.canvas.addEventListener("pointerleave", () => { if (state.dragStartX == null) state.tooltip.classList.remove("visible"); });
  const input = card.querySelector(".symbol-input"); let searchTimer; input.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => suggestSymbols(state, input.value), 180); }); input.addEventListener("focus", () => suggestSymbols(state, input.value)); input.addEventListener("blur", () => setTimeout(() => card.querySelector(".suggestions").replaceChildren(), 150));
  const period = card.querySelector(".period-input"); period.addEventListener("change", () => { state.limit = Math.min(700, Math.max(20, Number(period.value) || defaultLimit(state.interval))); period.value = state.limit; state.previousMacdSign = null; state.pendingTwoLineAlert = null; refreshChart(state, true); }); state.alert.querySelector("button").addEventListener("click", () => state.alert.classList.remove("visible")); chartState.set(index, state); renderTimeframes(state); renderChartTypes(state); refreshChart(state, true); return state;
}
async function refreshMarket() {
  try { const quotes = await Promise.all(MARKET_ITEMS.map(async (item) => ({ item, quote: await fetchJson(`/quote?symbol=${encodeURIComponent(item.symbol)}&mode=${sessionMode}`) }))); marketSummary.replaceChildren(...quotes.map(({ item, quote }) => { const rate = Number(quote.changePercent ?? quote.changeRate); const up = rate >= 0; const el = document.createElement("div"); el.className = `market-item ${up ? "up" : "down"}`; el.innerHTML = `<span>${item.label}</span><strong>${formatNumber(quote.price, item.decimals)}</strong><em>${Number.isFinite(rate) ? `${up ? "+" : ""}${rate.toFixed(2)}%` : "--"}</em>`; return el; })); } catch { marketSummary.textContent = "시장 요약을 갱신 중입니다"; }
}
document.querySelectorAll(".session-button").forEach((button) => button.addEventListener("click", () => { sessionMode = button.dataset.mode; localStorage.setItem(SESSION_MODE_KEY, sessionMode); document.querySelectorAll(".session-button").forEach((item) => item.classList.toggle("active", item === button)); refreshMarket(); chartState.forEach((state) => refreshChart(state, true)); }));
const states = loadSavedCharts().map(createCard); const resizeObserver = new ResizeObserver(() => chartState.forEach(drawChart)); resizeObserver.observe(chartGrid); refreshMarket(); setInterval(() => { refreshMarket(); chartState.forEach((state) => refreshChart(state)); }, REFRESH_MS); window.addEventListener("focus", () => { refreshMarket(); states.forEach((state) => refreshChart(state)); });
