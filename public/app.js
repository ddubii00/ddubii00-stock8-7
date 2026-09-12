const INITIAL_CHARTS = [
  { symbol: "000660.KS", name: "SK하이닉스" }, { symbol: "005930.KS", name: "삼성전자" },
  { symbol: "AVGO.US", name: "Broadcom" }, { symbol: "SNDK.US", name: "Sandisk" }
];
const TIMEFRAMES = [["1분", "1m"], ["3분", "3m"], ["5분", "5m"], ["10분", "10m"], ["15분", "15m"], ["30분", "30m"], ["1시간", "60m"], ["일", "1d"], ["주", "1wk"], ["월", "1mo"]];
const MARKET_ITEMS = [{ label: "달러/원", symbol: "KRW=X", decimals: 2 }, { label: "KOSPI", symbol: "^KS11", decimals: 2 }, { label: "KOSDAQ", symbol: "^KQ11", decimals: 2 }, { label: "나스닥", symbol: "^IXIC", decimals: 2 }];
const DEFAULT_LIMIT_BY_INTERVAL = { "1m": 400, "3m": 150, "5m": 120, "10m": 100, "15m": 100, "30m": 100, "60m": 100, "1d": 120, "1wk": 120, "1mo": 120 };
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

// This deliberately uses closing prices only. A reversal waits until price moves
// past the high or low of the previous three completed lines.
function threeLineBreak(rows) {
  if (!rows.length) return [];
  const lines = [{ open: Number(rows[0].close), close: Number(rows[0].close), time: rows[0].time, direction: 0 }];
  for (const row of rows.slice(1)) {
    const close = Number(row.close); const recent = lines.slice(-3).map((line) => line.close);
    const shouldRise = close > Math.max(...recent); const shouldFall = close < Math.min(...recent);
    if (shouldRise || shouldFall) { const last = lines[lines.length - 1]; lines.push({ open: last.close, close, time: row.time, direction: shouldRise ? 1 : -1 }); }
  }
  return lines;
}
function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio)); const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  return { width: rect.width, height: rect.height, ratio };
}
function drawChart(state) {
  const { canvas, rows, lines, macdValues } = state; if (!canvas || !rows?.length || !lines?.length) return;
  const { width, height, ratio } = resizeCanvas(canvas); const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  const pad = { top: 52, right: 70, bottom: 30, left: 12 }; const chartW = Math.max(1, width - pad.left - pad.right); const chartH = Math.max(1, height - pad.top - pad.bottom);
  const values = lines.flatMap((line) => [line.open, line.close]); const min = Math.min(...values); const max = Math.max(...values); const spread = Math.max(max - min, Math.abs(max || 1) * .015); const low = min - spread * .09; const high = max + spread * .09;
  const y = (value) => pad.top + (high - value) / (high - low) * chartH; const xForRow = (index) => pad.left + index / Math.max(rows.length - 1, 1) * chartW;
  const magnitude = Math.max(...macdValues.map((value) => Math.abs(value)), 1);
  for (let index = 0; index < rows.length; index += 1) {
    const value = macdValues[index] || 0; const alpha = .035 + Math.min(Math.abs(value) / magnitude, 1) * .12; ctx.fillStyle = value >= 0 ? `rgba(239,83,80,${alpha})` : `rgba(21,101,192,${alpha})`;
    const next = index === rows.length - 1 ? pad.left + chartW : xForRow(index + 1); ctx.fillRect(xForRow(index), pad.top, Math.max(1, next - xForRow(index) + 1), chartH);
  }
  ctx.strokeStyle = "rgba(111,132,161,.2)"; ctx.lineWidth = 1; ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "left";
  for (let row = 0; row <= 4; row += 1) { const lineY = pad.top + chartH * row / 4; ctx.beginPath(); ctx.moveTo(pad.left, lineY); ctx.lineTo(pad.left + chartW, lineY); ctx.stroke(); ctx.fillStyle = "#68758b"; ctx.fillText(formatNumber(high - (high - low) * row / 4, decimalsFor(state.item.symbol)), pad.left + chartW + 8, lineY + 4); }
  const visibleLines = lines.slice(-Math.min(lines.length, 130)); const step = chartW / Math.max(visibleLines.length, 1); const brickWidth = Math.max(3, Math.min(18, step * .72));
  state.drawnLines = visibleLines.map((line, index) => ({ ...line, x: pad.left + step * (index + .5), width: brickWidth, y1: y(line.open), y2: y(line.close) }));
  state.drawnLines.forEach((line) => { const top = Math.min(line.y1, line.y2); const brickHeight = Math.max(2, Math.abs(line.y2 - line.y1)); const rising = line.direction >= 0; ctx.fillStyle = rising ? "#ef5350" : "#1565c0"; ctx.fillRect(line.x - line.width / 2, top, line.width, brickHeight); ctx.strokeStyle = rising ? "#c62828" : "#0d47a1"; ctx.strokeRect(line.x - line.width / 2, top, line.width, brickHeight); });
  ctx.fillStyle = "#68758b"; const labels = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]; labels.forEach((row, index) => ctx.fillText(timeText(row.time, state.interval).slice(2), pad.left + chartW * index / 2, height - 10));
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
  state.card.querySelector(".last-price").textContent = formatNumber(price, payload.decimals ?? decimalsFor(state.item.symbol)); const changeEl = state.card.querySelector(".last-change"); changeEl.textContent = Number.isFinite(change) ? `${up ? "+" : ""}${change.toFixed(2)}%` : "--"; changeEl.className = `last-change ${up ? "up" : "down"}`;
  const source = payload.source?.startsWith("kis") ? "KIS 실시간" : payload.source?.startsWith("naver") ? "네이버 실시간" : "Yahoo / 공개 시세"; state.card.querySelector(".market-status").textContent = `${source} · ${payload.marketStatus || "갱신"}`;
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
  const lineCount = state.lines.length;
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
  try { const params = new URLSearchParams({ symbol: state.item.symbol, name: state.item.name, interval: state.interval, limit: String(state.limit), mode: sessionMode }); const payload = await fetchJson(`/chart?${params}`); const rows = (payload.series || []).filter((row) => Number.isFinite(Number(row.close))).slice(-state.limit); if (!rows.length) throw new Error("empty series"); state.rows = rows; state.lines = threeLineBreak(rows); state.macdValues = macd(rows); drawChart(state); updateQuote(state, payload); evaluateSignals(state); state.card.classList.remove("error"); }
  catch (error) { state.card.classList.add("error"); state.card.querySelector(".market-status").textContent = "데이터 재시도 중"; console.warn("Chart refresh failed", error); }
  finally { state.loading = false; state.loadingEl.classList.remove("visible"); }
}
function renderTimeframes(state) {
  const holder = state.card.querySelector(".timeframe-buttons"); holder.replaceChildren(...TIMEFRAMES.map(([label, value]) => { const button = document.createElement("button"); button.type = "button"; button.className = `tf-button ${state.interval === value ? "active" : ""}`; button.textContent = label; button.addEventListener("click", () => { state.interval = value; state.limit = defaultLimit(value); state.previousMacdSign = null; state.pendingTwoLineAlert = null; state.card.querySelector(".period-input").value = state.limit; renderTimeframes(state); refreshChart(state, true); }); return button; }));
}
async function suggestSymbols(state, query) {
  const box = state.card.querySelector(".suggestions"); if (query.trim().length < 1) { box.replaceChildren(); return; }
  try { const payload = await fetchJson(`/search?q=${encodeURIComponent(query)}`); box.replaceChildren(...(payload.results || []).slice(0, 8).map((item) => { const button = document.createElement("button"); button.type = "button"; button.innerHTML = `<b>${item.name}</b><small>${item.symbol}</small>`; button.addEventListener("mousedown", (event) => { event.preventDefault(); state.item = { symbol: item.symbol, name: item.name }; state.card.querySelector(".symbol-input").value = item.name; state.card.querySelector(".symbol-code").textContent = item.symbol; box.replaceChildren(); saveCharts(); refreshChart(state, true); }); return button; })); } catch { box.replaceChildren(); }
}
function createCard(item, index) {
  const card = template.content.firstElementChild.cloneNode(true); chartGrid.append(card);
  const state = { item, card, canvas: card.querySelector("canvas"), tooltip: card.querySelector(".price-tooltip"), loadingEl: card.querySelector(".loading"), alert: card.querySelector(".signal-alert"), interval: "1d", limit: 120, rows: [], lines: [], macdValues: [], drawnLines: [], previousMacdSign: null, pendingTwoLineAlert: null };
  card.querySelector(".symbol-input").value = item.name; card.querySelector(".symbol-code").textContent = item.symbol; state.canvas.addEventListener("pointermove", (event) => showTooltip(state, event)); state.canvas.addEventListener("pointerleave", () => state.tooltip.classList.remove("visible"));
  const input = card.querySelector(".symbol-input"); let searchTimer; input.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => suggestSymbols(state, input.value), 180); }); input.addEventListener("focus", () => suggestSymbols(state, input.value)); input.addEventListener("blur", () => setTimeout(() => card.querySelector(".suggestions").replaceChildren(), 150));
  const period = card.querySelector(".period-input"); period.addEventListener("change", () => { state.limit = Math.min(700, Math.max(20, Number(period.value) || defaultLimit(state.interval))); period.value = state.limit; state.previousMacdSign = null; state.pendingTwoLineAlert = null; refreshChart(state, true); }); state.alert.querySelector("button").addEventListener("click", () => state.alert.classList.remove("visible")); chartState.set(index, state); renderTimeframes(state); refreshChart(state, true); return state;
}
async function refreshMarket() {
  try { const quotes = await Promise.all(MARKET_ITEMS.map(async (item) => ({ item, quote: await fetchJson(`/quote?symbol=${encodeURIComponent(item.symbol)}&mode=${sessionMode}`) }))); marketSummary.replaceChildren(...quotes.map(({ item, quote }) => { const rate = Number(quote.changePercent ?? quote.changeRate); const up = rate >= 0; const el = document.createElement("div"); el.className = `market-item ${up ? "up" : "down"}`; el.innerHTML = `<span>${item.label}</span><strong>${formatNumber(quote.price, item.decimals)}</strong><em>${Number.isFinite(rate) ? `${up ? "+" : ""}${rate.toFixed(2)}%` : "--"}</em>`; return el; })); } catch { marketSummary.textContent = "시장 요약을 갱신 중입니다"; }
}
document.querySelectorAll(".session-button").forEach((button) => button.addEventListener("click", () => { sessionMode = button.dataset.mode; localStorage.setItem(SESSION_MODE_KEY, sessionMode); document.querySelectorAll(".session-button").forEach((item) => item.classList.toggle("active", item === button)); refreshMarket(); chartState.forEach((state) => refreshChart(state, true)); }));
const states = loadSavedCharts().map(createCard); const resizeObserver = new ResizeObserver(() => chartState.forEach(drawChart)); resizeObserver.observe(chartGrid); refreshMarket(); setInterval(() => { refreshMarket(); chartState.forEach((state) => refreshChart(state)); }, REFRESH_MS); window.addEventListener("focus", () => { refreshMarket(); states.forEach((state) => refreshChart(state)); });
