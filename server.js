import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 8000);
const PUBLIC_DIR = join(process.cwd(), "public");
const KIS_APP_KEY = process.env.KIS_APP_KEY || "";
const KIS_APP_SECRET = process.env.KIS_APP_SECRET || "";
const KIS_BASE_URL = (process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443").replace(/\/$/, "");
const KIS_ENABLED = Boolean(KIS_APP_KEY && KIS_APP_SECRET && KIS_BASE_URL);
const KIS_TOKEN_SAFETY_MS = 60_000;
let kisTokenCache = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const SYMBOL_NAMES = {
  "000660.KS": "SK하이닉스",
  "005930.KS": "삼성전자",
  "009150.KS": "삼성전기",
  "018260.KS": "삼성에스디에스",
  "035420.KS": "NAVER",
  "035720.KS": "카카오",
  "003550.KS": "LG",
  "051900.KS": "LG생활건강",
  "051910.KS": "LG화학",
  "066570.KS": "LG전자",
  "032640.KS": "LG유플러스",
  "011070.KS": "LG이노텍",
  "034220.KS": "LG디스플레이",
  "373220.KS": "LG에너지솔루션",
  "006260.KS": "LS",
  "010120.KS": "LS ELECTRIC",
  "000680.KS": "LS네트웍스",
  "229640.KS": "LS에코에너지",
  "060370.KQ": "LS마린솔루션",
  "417200.KQ": "LS머트리얼즈",
  "207940.KS": "삼성바이오로직스",
  "005380.KS": "현대차",
  "000270.KS": "기아",
  "361610.KS": "SK아이이테크놀로지",
  "192080.KS": "더블유게임즈",
  "393890.KQ": "더블유씨피",
  "299170.KQ": "더블유에스아이",
  "376980.KQ": "원티드랩",
  "NVDA.US": "NVIDIA",
  "TSLA.US": "Tesla",
  "AAPL.US": "Apple",
  "MSFT.US": "Microsoft",
  "AMZN.US": "Amazon",
  "META.US": "Meta",
  "GOOGL.US": "Alphabet",
  "AMD.US": "AMD",
  "AVGO.US": "Broadcom",
  "F.US": "Ford",
  "CPNG.US": "Coupang",
  "SPCX.US": "SPCX ETF",
  "SNDK.US": "Sandisk",
  "KRW=X": "달러/원",
  "^KS11": "KOSPI",
  "^KQ11": "KOSDAQ",
  "^IXIC": "나스닥"
};

const US_EXCHANGE_CODES = {
  AAPL: "NAS",
  AMD: "NAS",
  AMZN: "NAS",
  AVGO: "NAS",
  CPNG: "NYS",
  F: "NYS",
  GOOGL: "NAS",
  META: "NAS",
  MSFT: "NAS",
  NVDA: "NAS",
  SPCX: "NAS",
  SNDK: "NAS",
  TSLA: "NAS"
};

const STOOQ_SYMBOLS = {
  "000660.KS": "000660.kr",
  "005930.KS": "005930.kr",
  "009150.KS": "009150.kr",
  "018260.KS": "018260.kr",
  "035420.KS": "035420.kr",
  "035720.KS": "035720.kr",
  "003550.KS": "003550.kr",
  "051900.KS": "051900.kr",
  "051910.KS": "051910.kr",
  "066570.KS": "066570.kr",
  "032640.KS": "032640.kr",
  "011070.KS": "011070.kr",
  "034220.KS": "034220.kr",
  "373220.KS": "373220.kr",
  "006260.KS": "006260.kr",
  "010120.KS": "010120.kr",
  "000680.KS": "000680.kr",
  "229640.KS": "229640.kr",
  "060370.KQ": "060370.kr",
  "417200.KQ": "417200.kr",
  "207940.KS": "207940.kr",
  "005380.KS": "005380.kr",
  "000270.KS": "000270.kr",
  "361610.KS": "361610.kr",
  "192080.KS": "192080.kr",
  "393890.KQ": "393890.kr",
  "299170.KQ": "299170.kr",
  "376980.KQ": "376980.kr",
  "NVDA.US": "nvda.us",
  "TSLA.US": "tsla.us",
  "AAPL.US": "aapl.us",
  "MSFT.US": "msft.us",
  "AVGO.US": "avgo.us",
  "F.US": "f.us",
  "CPNG.US": "cpng.us",
  "SPCX.US": "spcx.us",
  "SNDK.US": "sndk.us",
  "KRW=X": "usdkrw",
  "^KS11": "^kospi",
  "^KQ11": "^kosdaq",
  "^IXIC": "^ndq",
  "^GSPC": "^spx"
};

const SYMBOL_SEARCH = [
  { symbol: "000660.KS", name: "SK하이닉스", aliases: ["하닉", "하이닉스", "sk hynix", "hynix"] },
  { symbol: "005930.KS", name: "삼성전자", aliases: ["삼전", "삼성", "samsung"] },
  { symbol: "009150.KS", name: "삼성전기", aliases: ["삼성전기", "전기", "samsung electro-mechanics", "semco"] },
  { symbol: "018260.KS", name: "삼성에스디에스", aliases: ["삼성에스디에스", "삼성sds", "에스디에스", "samsung sds", "sds"] },
  { symbol: "035420.KS", name: "NAVER", aliases: ["네이버", "naver"] },
  { symbol: "035720.KS", name: "카카오", aliases: ["kakao"] },
  { symbol: "003550.KS", name: "LG", aliases: ["lg", "엘지", "lg지주"] },
  { symbol: "051900.KS", name: "LG생활건강", aliases: ["lg생활건강", "엘지생활건강", "생활건강", "lg h&h", "lg household"] },
  { symbol: "051910.KS", name: "LG화학", aliases: ["lg화학", "엘지화학", "화학", "lg chem"] },
  { symbol: "066570.KS", name: "LG전자", aliases: ["lg전자", "엘지전자", "전자", "lg electronics"] },
  { symbol: "032640.KS", name: "LG유플러스", aliases: ["lg유플러스", "엘지유플러스", "유플러스", "lgu+", "lg uplus"] },
  { symbol: "011070.KS", name: "LG이노텍", aliases: ["lg이노텍", "엘지이노텍", "이노텍", "lg innotek"] },
  { symbol: "034220.KS", name: "LG디스플레이", aliases: ["lg디스플레이", "엘지디스플레이", "디스플레이", "lg display"] },
  { symbol: "373220.KS", name: "LG에너지솔루션", aliases: ["lg엔솔", "엘지엔솔", "엔솔", "lg에너지", "lg energy"] },
  { symbol: "006260.KS", name: "LS", aliases: ["ls", "엘에스", "ls홀딩스"] },
  { symbol: "010120.KS", name: "LS ELECTRIC", aliases: ["ls electric", "ls일렉트릭", "엘에스일렉트릭", "ls전기"] },
  { symbol: "000680.KS", name: "LS네트웍스", aliases: ["ls네트웍스", "엘에스네트웍스", "ls networks"] },
  { symbol: "229640.KS", name: "LS에코에너지", aliases: ["ls에코에너지", "엘에스에코에너지", "ls eco energy"] },
  { symbol: "060370.KQ", name: "LS마린솔루션", aliases: ["ls마린솔루션", "엘에스마린솔루션", "ls marine solution"] },
  { symbol: "417200.KQ", name: "LS머트리얼즈", aliases: ["ls머트리얼즈", "엘에스머트리얼즈", "ls materials"] },
  { symbol: "207940.KS", name: "삼성바이오로직스", aliases: ["삼바", "바이오로직스"] },
  { symbol: "005380.KS", name: "현대차", aliases: ["현차", "hyundai"] },
  { symbol: "000270.KS", name: "기아", aliases: ["kia"] },
  { symbol: "361610.KS", name: "SK아이이테크놀로지", aliases: ["sk아이", "아이이테크놀로지", "아이테크", "sk ie technology", "skiet"] },
  { symbol: "192080.KS", name: "더블유게임즈", aliases: ["더블유", "w games", "wgames"] },
  { symbol: "393890.KQ", name: "더블유씨피", aliases: ["더블유", "wcp"] },
  { symbol: "299170.KQ", name: "더블유에스아이", aliases: ["더블유", "wsi"] },
  { symbol: "376980.KQ", name: "원티드랩", aliases: ["더블유", "wanted", "wantedlab"] },
  { symbol: "NVDA.US", name: "NVIDIA", aliases: ["엔비디아", "nvidia"] },
  { symbol: "TSLA.US", name: "Tesla", aliases: ["테슬라", "tesla"] },
  { symbol: "AAPL.US", name: "Apple", aliases: ["애플", "apple"] },
  { symbol: "MSFT.US", name: "Microsoft", aliases: ["마소", "msft", "microsoft"] },
  { symbol: "AMZN.US", name: "Amazon", aliases: ["아마존", "amazon"] },
  { symbol: "META.US", name: "Meta", aliases: ["메타", "meta"] },
  { symbol: "GOOGL.US", name: "Alphabet", aliases: ["구글", "google", "alphabet"] },
  { symbol: "AMD.US", name: "AMD", aliases: ["amd"] },
  { symbol: "AVGO.US", name: "Broadcom", aliases: ["브로드컴", "broadcom", "avgo", "avg"] },
  { symbol: "F.US", name: "Ford", aliases: ["f", "ford", "포드", "for"] },
  { symbol: "CPNG.US", name: "Coupang", aliases: ["coupang", "쿠팡", "cpng", "cou"] },
  { symbol: "SPCX.US", name: "SPCX ETF", aliases: ["spcx", "spacex", "space x", "space-x"] },
  { symbol: "SNDK.US", name: "Sandisk", aliases: ["샌디스크", "sandisk", "sndk"] },
  { symbol: "^KS11", name: "KOSPI", aliases: ["코스피", "kospi", "종합주가지수"] },
  { symbol: "^KQ11", name: "KOSDAQ", aliases: ["코스닥", "kosdaq"] },
  { symbol: "^IXIC", name: "나스닥", aliases: ["나스닥", "nasdaq", "ndq"] }
];

const FALLBACK_BASE = {
  "000660.KS": { price: 310000, step: 2600 },
  "005930.KS": { price: 74600, step: 730 },
  "AVGO.US": { price: 1785.25, step: 18.5 },
  "F.US": { price: 12.5, step: 0.2 },
  "CPNG.US": { price: 28.5, step: 0.5 },
  "SPCX.US": { price: 35.5, step: 0.4 },
  "SNDK.US": { price: 905.5, step: 12.4 },
  "NVDA.US": { price: 214.75, step: 3.1 },
  "TSLA.US": { price: 423.7, step: 6.4 },
  "KRW=X": { price: 1362.4, step: 4.8 },
  "^KS11": { price: 3048.2, step: 16 },
  "^KQ11": { price: 782.3, step: 5.2 },
  "^IXIC": { price: 19460.5, step: 120 }
};

const INTERVAL_CONFIG = {
  "1m": { yahooInterval: "1m", range: "5d", seconds: 60 },
  "3m": { yahooInterval: "1m", range: "5d", seconds: 180, aggregate: 180 },
  "5m": { yahooInterval: "5m", range: "5d", seconds: 300 },
  "10m": { yahooInterval: "1m", range: "5d", seconds: 600, aggregate: 600 },
  "15m": { yahooInterval: "15m", range: "5d", seconds: 900 },
  "30m": { yahooInterval: "30m", range: "1mo", seconds: 1800 },
  "60m": { yahooInterval: "60m", range: "3mo", seconds: 3600 },
  "1d": { yahooInterval: "1d", range: "2y", seconds: 86400 },
  "1wk": { yahooInterval: "1wk", range: "10y", seconds: 604800 },
  "1mo": { yahooInterval: "1mo", range: "10y", seconds: 2592000 }
};

function stooqSymbol(symbol) {
  const normalized = symbol.trim().toUpperCase();
  return STOOQ_SYMBOLS[normalized] || normalized.toLowerCase();
}

function decimalsFor(symbol) {
  return symbol.endsWith(".KS") || symbol.endsWith(".KQ") ? 0 : 2;
}

function isKoreanSymbol(symbol) {
  return symbol.endsWith(".KS") || symbol.endsWith(".KQ");
}

function isKoreanIndex(symbol) {
  return symbol === "^KS11" || symbol === "^KQ11";
}

function kisIndexCode(symbol) {
  if (symbol === "^KS11") return "0001";
  if (symbol === "^KQ11") return "1001";
  return "";
}

function isUsSymbol(symbol) {
  return symbol.endsWith(".US");
}

function isForexSymbol(symbol) {
  return symbol === "KRW=X";
}

function kisSupportsQuote(symbol, mode = "KRX") {
  const normalized = symbol.trim().toUpperCase();
  return isKoreanSymbol(normalized) || isKoreanIndex(normalized) || isUsSymbol(normalized);
}

function kisStatusPayload() {
  return {
    enabled: KIS_ENABLED,
    appKeyConfigured: Boolean(KIS_APP_KEY),
    appSecretConfigured: Boolean(KIS_APP_SECRET),
    baseUrlConfigured: Boolean(KIS_BASE_URL)
  };
}

function kisErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown KIS error");
  return message.slice(0, 180);
}

function isIntradayInterval(interval) {
  return !["1d", "1wk", "1mo"].includes(interval);
}

function yahooSymbol(symbol) {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith(".US")) return normalized.replace(".US", "");
  return normalized;
}

function numericField(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).replace(/,/g, "").trim();
    if (!text) continue;
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

function forexMarketStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday;
  const open = weekday === "Sun"
    ? minute >= 17 * 60
    : weekday === "Sat"
      ? false
      : weekday === "Fri"
        ? minute < 17 * 60
        : true;
  return open ? "장중" : "장종료";
}

function marketStatus(symbol, now = new Date()) {
  if (isForexSymbol(symbol)) return forexMarketStatus(now);
  if (isKoreanSymbol(symbol) || isKoreanIndex(symbol)) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const weekday = parts.weekday;
    const open = !["Sat", "Sun"].includes(weekday) && minute >= 9 * 60 && minute < 15 * 60 + 30;
    if (isKoreanIndex(symbol)) return open ? "장중" : "장종료";
    return open ? "장중" : "종가";
  }
  if (symbol.endsWith(".US") || symbol === "^IXIC" || symbol === "^GSPC") {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const weekday = parts.weekday;
    const open = !["Sat", "Sun"].includes(weekday) && minute >= 9 * 60 + 30 && minute < 16 * 60;
    return open ? "장중" : "종가";
  }
  return "종가";
}

async function getKisAccessToken() {
  const now = Date.now();
  if (kisTokenCache && kisTokenCache.expiresAt - KIS_TOKEN_SAFETY_MS > now) return kisTokenCache.token;
  if (!KIS_ENABLED) throw new Error("KIS credentials are not configured");
  const response = await fetchWithTimeout(`${KIS_BASE_URL}/oauth2/tokenP`, 6000, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: KIS_APP_KEY,
      appsecret: KIS_APP_SECRET
    })
  });
  if (!response.ok) throw new Error(`KIS token HTTP ${response.status}`);
  const json = await response.json();
  if (!json.access_token) throw new Error("KIS token missing");
  const expiresIn = Number(json.expires_in || 86_400);
  kisTokenCache = {
    token: json.access_token,
    expiresAt: now + expiresIn * 1000
  };
  return kisTokenCache.token;
}

async function kisFetch(path, trId, params) {
  const token = await getKisAccessToken();
  const url = new URL(`${KIS_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(url, 5000, {
    headers: {
      "authorization": `Bearer ${token}`,
      "appkey": KIS_APP_KEY,
      "appsecret": KIS_APP_SECRET,
      "tr_id": trId,
      "custtype": "P"
    }
  });
  if (!response.ok) throw new Error(`KIS ${trId} HTTP ${response.status}`);
  const json = await response.json();
  if (json.rt_cd && json.rt_cd !== "0") throw new Error(`KIS ${trId} ${json.msg1 || json.rt_cd}`);
  return json;
}

function parseKisDomesticQuote(symbol, json) {
  const output = json.output || {};
  const price = numericField(output.stck_prpr);
  let previousClose = numericField(output.stck_prdy_clpr, output.stck_sdpr);
  const change = numericField(output.prdy_vrss, Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : NaN);
  const changePercent = numericField(output.prdy_ctrt);
  if ((!Number.isFinite(previousClose) || previousClose <= 0) && Number.isFinite(price) && Number.isFinite(change)) {
    previousClose = price - change;
  }
  return {
    symbol,
    name: SYMBOL_NAMES[symbol] || symbol,
    price,
    previousClose,
    change,
    changePercent,
    changeRate: changePercent,
    asOf: Math.floor(Date.now() / 1000),
    marketTime: Math.floor(Date.now() / 1000),
    marketStatus: marketStatus(symbol),
    source: "kis"
  };
}

function parseKisIndexQuote(symbol, json) {
  const output = Array.isArray(json.output) ? json.output[0] || {} : json.output || json.output1 || {};
  const price = numericField(output.bstp_nmix_prpr, output.bstp_nmix, output.stck_prpr, output.prpr, output.nmix);
  let previousClose = numericField(
    output.bstp_nmix_prdy_clpr,
    output.prdy_clpr,
    output.stck_prdy_clpr,
    output.sdpr
  );
  const change = numericField(
    output.bstp_nmix_prdy_vrss,
    output.prdy_vrss,
    output.stck_prdy_vrss,
    Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : NaN
  );
  const changePercent = numericField(output.bstp_nmix_prdy_ctrt, output.prdy_ctrt, output.stck_prdy_ctrt);
  if ((!Number.isFinite(previousClose) || previousClose <= 0) && Number.isFinite(price) && Number.isFinite(change)) {
    previousClose = price - change;
  }
  return {
    symbol,
    name: SYMBOL_NAMES[symbol] || symbol,
    price,
    previousClose,
    change,
    changePercent,
    changeRate: changePercent,
    asOf: Math.floor(Date.now() / 1000),
    marketTime: Math.floor(Date.now() / 1000),
    marketStatus: marketStatus(symbol),
    source: "kis"
  };
}

function parseKisOverseasQuote(symbol, json) {
  const output = json.output || {};
  const price = numericField(output.last, output.base);
  let previousClose = numericField(output.prev, output.pvol);
  const change = numericField(output.diff, Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : NaN);
  const changePercent = numericField(output.rate);
  if ((!Number.isFinite(previousClose) || previousClose <= 0) && Number.isFinite(price) && Number.isFinite(change)) {
    previousClose = price - change;
  }
  return {
    symbol,
    name: SYMBOL_NAMES[symbol] || symbol,
    price,
    previousClose,
    change,
    changePercent,
    changeRate: changePercent,
    asOf: Math.floor(Date.now() / 1000),
    marketTime: Math.floor(Date.now() / 1000),
    marketStatus: marketStatus(symbol),
    source: "kis"
  };
}

function koreanDateTimeToUnix(dateValue, timeValue) {
  const date = String(dateValue || "").replace(/\D/g, "");
  const time = String(timeValue || "").replace(/\D/g, "").padStart(6, "0");
  if (date.length !== 8 || time.length < 4) return NaN;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const second = Number(time.slice(4, 6) || 0);
  return Math.floor(Date.UTC(year, month - 1, day, hour - 9, minute, second) / 1000);
}

function kisIntradayEndTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (minute >= 15 * 60 + 31) return "153100";
  if (minute < 9 * 60) return "090000";
  return `${parts.hour}${parts.minute}${parts.second}`;
}

function parseKisIntradayRows(symbol, outputs) {
  const rows = [];
  for (const item of outputs) {
    const time = koreanDateTimeToUnix(item.stck_bsop_date, item.stck_cntg_hour);
    const open = numericField(item.stck_oprc, item.open);
    const high = numericField(item.stck_hgpr, item.high);
    const low = numericField(item.stck_lwpr, item.low);
    const close = numericField(item.stck_prpr, item.close);
    if (![time, open, high, low, close].every((value) => Number.isFinite(value)) || close <= 0) continue;
    rows.push({
      time,
      open,
      high,
      low,
      close,
      volume: numericField(item.cntg_vol, item.acml_vol) || 0,
      source: "kis"
    });
  }
  return normalizeKoreanIntradayRows(symbol, rows).sort((a, b) => a.time - b.time);
}

async function fetchKisIntradayRows(symbol, yahooLastTime = 0) {
  const normalized = symbol.trim().toUpperCase();
  if (!KIS_ENABLED || !isKoreanSymbol(normalized)) return [];
  const code = normalized.split(".")[0];

  const allRawRows = [];
  let currentEndTime = kisIntradayEndTime();
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    const json = await kisFetch("/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice", "FHKST03010200", {
      FID_ETC_CLS_CODE: "",
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
      FID_INPUT_HOUR_1: currentEndTime,
      FID_PW_DATA_INCU_YN: "Y"
    });

    const outputs = Array.isArray(json.output2) ? json.output2 : Array.isArray(json.output) ? json.output : [];
    if (!outputs.length) break;

    allRawRows.push(...outputs);

    const lastItem = outputs.at(-1);
    if (!lastItem || !lastItem.stck_cntg_hour) break;

    const oldestUnixTime = koreanDateTimeToUnix(lastItem.stck_bsop_date, lastItem.stck_cntg_hour);
    if (Number.isFinite(oldestUnixTime) && yahooLastTime > 0 && oldestUnixTime <= yahooLastTime) {
      break;
    }

    const hh = Number(lastItem.stck_cntg_hour.slice(0, 2));
    const mm = Number(lastItem.stck_cntg_hour.slice(2, 4));
    let nextMm = mm - 1;
    let nextHh = hh;
    if (nextMm < 0) {
      nextMm = 59;
      nextHh -= 1;
    }
    if (nextHh < 9) break;
    currentEndTime = `${String(nextHh).padStart(2, "0")}${String(nextMm).padStart(2, "0")}00`;
  }

  return parseKisIntradayRows(normalized, allRawRows);
}

function validateQuote(quote) {
  if (!Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) {
    throw new Error(`Quote invalid price for ${quote.symbol}`);
  }
  return quote;
}

function naverIndexCode(symbol) {
  if (symbol === "^KS11") return "KOSPI";
  if (symbol === "^KQ11") return "KOSDAQ";
  return "";
}

function naverTimestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? Math.floor(time / 1000) : Math.floor(Date.now() / 1000);
}

function naverSignedChange(value, direction) {
  const number = numericField(value);
  if (!Number.isFinite(number)) return NaN;
  const marker = `${direction?.code || ""} ${direction?.text || ""} ${direction?.name || ""}`;
  if (/하락|FALLING|5|4/i.test(marker)) return -Math.abs(number);
  if (/보합|UNCHANGED|3/i.test(marker)) return 0;
  return Math.abs(number);
}

function parseNaverRealtimeQuote(symbol, item, mode = "KRX") {
  const normalized = symbol.trim().toUpperCase();
  const useNxt = mode === "NTX" && isKoreanSymbol(normalized) && item.overMarketPriceInfo;
  const direction = useNxt ? item.overMarketPriceInfo.compareToPreviousPrice : item.compareToPreviousPrice;
  const price = useNxt
    ? numericField(item.overMarketPriceInfo.overPrice, item.closePriceRaw, item.closePrice)
    : numericField(item.closePriceRaw, item.closePrice);
  const change = useNxt
    ? naverSignedChange(item.overMarketPriceInfo.compareToPreviousClosePrice, direction)
    : naverSignedChange(item.compareToPreviousClosePriceRaw ?? item.compareToPreviousClosePrice, direction);
  const changePercent = useNxt
    ? naverSignedChange(item.overMarketPriceInfo.fluctuationsRatio ?? item.fluctuationsRatioRaw ?? item.fluctuationsRatio, direction)
    : naverSignedChange(item.fluctuationsRatioRaw ?? item.fluctuationsRatio, direction);
  const asOf = naverTimestamp(useNxt ? item.overMarketPriceInfo.localTradedAt : item.localTradedAt);
  const previousClose = Number.isFinite(price) && Number.isFinite(change) ? price - change : NaN;
  const statusOpen = useNxt
    ? item.overMarketPriceInfo.overMarketStatus === "OPEN"
    : item.marketStatus === "OPEN";
  const quote = {
    symbol: normalized,
    name: SYMBOL_NAMES[normalized] || item.stockName || normalized,
    price,
    previousClose,
    change,
    changePercent,
    changeRate: changePercent,
    asOf,
    marketTime: asOf,
    marketStatus: isKoreanIndex(normalized)
      ? (statusOpen ? "장중" : "장종료")
      : (statusOpen ? "장중" : "종가"),
    source: useNxt ? "naver-nxt-realtime" : "naver-realtime"
  };
  if (useNxt) {
    quote.sessionOpen = numericField(item.overMarketPriceInfo.openPrice, price);
    quote.sessionHigh = numericField(item.overMarketPriceInfo.highPrice, price);
    quote.sessionLow = numericField(item.overMarketPriceInfo.lowPrice, price);
    quote.sessionVolume = numericField(item.overMarketPriceInfo.accumulatedTradingVolume) || 0;
    quote.sessionType = item.overMarketPriceInfo.tradingSessionType || "AFTER_MARKET";
  }
  return validateQuote(quote);
}

async function fetchNaverRealtimeQuote(symbol, mode = "KRX") {
  const normalized = symbol.trim().toUpperCase();
  if (!isKoreanSymbol(normalized) && !isKoreanIndex(normalized)) {
    throw new Error(`Naver realtime quote not supported for ${normalized}`);
  }
  const code = isKoreanIndex(normalized) ? naverIndexCode(normalized) : normalized.split(".")[0];
  const type = isKoreanIndex(normalized) ? "index" : "stock";
  const response = await fetchWithTimeout(`https://polling.finance.naver.com/api/realtime/domestic/${type}/${encodeURIComponent(code)}`, 2200);
  if (!response.ok) throw new Error(`Naver realtime HTTP ${response.status}`);
  const json = await response.json();
  const item = json?.datas?.[0];
  if (!item) throw new Error(`Naver realtime missing data for ${normalized}`);
  return parseNaverRealtimeQuote(normalized, item, mode);
}

function koreanDateKeyForTimestamp(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp * 1000)).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}`;
}

function parseNaverMinuteRows(symbol, text) {
  const rawRows = [];
  for (const match of text.matchAll(/\["(\d{12})",\s*([^,\]]+),\s*([^,\]]+),\s*([^,\]]+),\s*([^,\]]+),\s*([^,\]]+)/g)) {
    const [, dateTime, openRaw, highRaw, lowRaw, closeRaw, volumeRaw] = match;
    const close = Number(String(closeRaw).replace(/,/g, ""));
    if (!Number.isFinite(close) || close <= 0) continue;
    const time = koreanDateTimeToUnix(dateTime.slice(0, 8), `${dateTime.slice(8)}00`);
    if (!Number.isFinite(time)) continue;
    rawRows.push({
      time,
      open: Number(String(openRaw).replace(/,/g, "")),
      high: Number(String(highRaw).replace(/,/g, "")),
      low: Number(String(lowRaw).replace(/,/g, "")),
      close,
      cumulativeVolume: Number(String(volumeRaw).replace(/,/g, "")) || 0
    });
  }

  const sorted = rawRows.sort((a, b) => a.time - b.time);
  return sorted.map((row, index) => {
    const previous = sorted[index - 1];
    const open = Number.isFinite(row.open) && row.open > 0 ? row.open : (previous?.close ?? row.close);
    const high = Number.isFinite(row.high) && row.high > 0 ? row.high : Math.max(open, row.close);
    const low = Number.isFinite(row.low) && row.low > 0 ? row.low : Math.min(open, row.close);
    const volume = previous && row.cumulativeVolume >= previous.cumulativeVolume
      ? row.cumulativeVolume - previous.cumulativeVolume
      : row.cumulativeVolume;
    return {
      time: row.time,
      open,
      high,
      low,
      close: row.close,
      volume,
      source: "naver-minute"
    };
  });
}

async function fetchNaverMinuteRows(symbol, anchorTimestamp) {
  const normalized = symbol.trim().toUpperCase();
  if (!isKoreanSymbol(normalized)) return [];
  const code = normalized.split(".")[0];
  const dateKey = koreanDateKeyForTimestamp(anchorTimestamp || Math.floor(Date.now() / 1000));
  const url = `https://api.finance.naver.com/siseJson.naver?symbol=${encodeURIComponent(code)}&requestType=1&startTime=${dateKey}0900&endTime=${dateKey}1530&timeframe=minute`;
  const response = await fetchWithTimeout(url, 3500);
  if (!response.ok) throw new Error(`Naver minute HTTP ${response.status}`);
  return normalizeKoreanIntradayRows(normalized, parseNaverMinuteRows(normalized, await response.text()));
}

async function fetchKisQuote(symbol) {
  const normalized = symbol.trim().toUpperCase();
  if (isKoreanIndex(normalized)) {
    const json = await kisFetch("/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000", {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: kisIndexCode(normalized)
    });
    return validateQuote(parseKisIndexQuote(normalized, json));
  }
  if (isKoreanSymbol(normalized)) {
    const code = normalized.split(".")[0];
    const json = await kisFetch("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code
    });
    return validateQuote(parseKisDomesticQuote(normalized, json));
  }
  if (normalized.endsWith(".US")) {
    const code = normalized.replace(".US", "");
    const exchangeCandidates = [...new Set([US_EXCHANGE_CODES[code], "NAS", "NYS", "AMS"].filter(Boolean))];
    let lastError = null;
    for (const exchangeCode of exchangeCandidates) {
      try {
        const json = await kisFetch("/uapi/overseas-price/v1/quotations/price", "HHDFS00000300", {
          AUTH: "",
          EXCD: exchangeCode,
          SYMB: code
        });
        return validateQuote(parseKisOverseasQuote(normalized, json));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`KIS quote not supported for ${normalized}`);
  }
  throw new Error(`KIS quote not supported for ${normalized}`);
}

function koreanMinuteOfDay(timestamp) {
  const date = new Date(timestamp * 1000);
  return (date.getUTCHours() * 60 + date.getUTCMinutes() + 9 * 60) % (24 * 60);
}

function replaceKoreanTime(timestamp, hour, minute) {
  const date = new Date(timestamp * 1000);
  const totalMinutes = hour * 60 + minute - 9 * 60;
  date.setUTCHours(Math.floor(totalMinutes / 60), ((totalMinutes % 60) + 60) % 60, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function minuteBucket(timestamp) {
  return Math.floor(timestamp / 60) * 60;
}

function normalizeKoreanIntradayRows(symbol, rows) {
  if (!isKoreanSymbol(symbol) && !isKoreanIndex(symbol)) return rows;
  const byTime = new Map();
  const closingAuctionStart = 15 * 60 + 20;
  const closingAuctionEnd = 15 * 60 + 30;
  const closeMinute = 15 * 60 + 30;
  const finalPrintMinute = 15 * 60 + 31;

  for (const row of rows) {
    const minute = koreanMinuteOfDay(row.time);
    const time = minute === finalPrintMinute ? replaceKoreanTime(row.time, 15, 30) : minuteBucket(row.time);
    if (minute >= closingAuctionStart && minute < closingAuctionEnd) continue;
    if (minute > closeMinute && minute !== finalPrintMinute) continue;
    const existing = byTime.get(time);
    if (!existing) {
      byTime.set(time, { ...row, time });
      continue;
    }
    byTime.set(time, {
      time,
      open: existing.open,
      high: Math.max(existing.high, row.high),
      low: Math.min(existing.low, row.low),
      close: row.close,
      volume: (existing.volume || 0) + (row.volume || 0)
    });
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function applyKoreanClosingPrint(symbol, rows, payload) {
  const marketTime = Number(payload.marketTime || payload.asOf);
  const price = Number(payload.price);
  if ((!isKoreanSymbol(symbol) && !isKoreanIndex(symbol)) || !Number.isFinite(marketTime) || !Number.isFinite(price)) return rows;
  if (koreanMinuteOfDay(marketTime) < 15 * 60 + 30) return rows;

  const closeTime = replaceKoreanTime(marketTime, 15, 30);
  const next = rows.filter((row) => row.time !== closeTime);
  const existing = rows.find((row) => row.time === closeTime);
  next.push(existing
    ? {
        ...existing,
        high: Math.max(existing.high, price),
        low: Math.min(existing.low, price),
        close: price
      }
    : {
        time: closeTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0
      });
  return next.sort((a, b) => a.time - b.time);
}

function parseDailyCsv(text) {
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split(",");
      return {
        time: date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume)
      };
    })
    .filter((row) => row.time && [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

function parseYahooIntraday(symbol, json) {
  const result = json?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];
  const rows = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const open = Number(quote.open?.[i]);
    const high = Number(quote.high?.[i]);
    const low = Number(quote.low?.[i]);
    const close = Number(quote.close?.[i]);
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) continue;
    rows.push({
      time: Number(timestamps[i]),
      open,
      high,
      low,
      close,
      volume: Number(quote.volume?.[i] || 0)
    });
  }

  if (rows.length > 8) {
    const ranges = rows
      .map((row) => row.high - row.low)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const medianRange = ranges[Math.floor(ranges.length / 2)] || 0;
    const guard = Math.max(medianRange * 10, Number(meta.regularMarketPrice || rows.at(-1)?.close || 0) * 0.018);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].high - rows[i].low > guard) rows.splice(i, 1);
    }
  }

  const previousClose = Number(
    meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose
  );
  const price = Number(meta.regularMarketPrice ?? rows.at(-1)?.close);
  const change = Number.isFinite(previousClose) ? price - previousClose : price - rows.at(-1)?.open;
  const changePercent = Number.isFinite(previousClose) && previousClose !== 0
    ? (change / previousClose) * 100
    : 0;

  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    asOf: rows.at(-1)?.time || Math.floor(Date.now() / 1000),
    marketTime: Number(meta.regularMarketTime || rows.at(-1)?.time || Math.floor(Date.now() / 1000)),
    series: rows
  };
}

function parseYahooChart(symbol, json) {
  const result = json?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];
  const rows = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const open = Number(quote.open?.[i]);
    const high = Number(quote.high?.[i]);
    const low = Number(quote.low?.[i]);
    const close = Number(quote.close?.[i]);
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) continue;
    rows.push({
      time: Number(timestamps[i]),
      open,
      high,
      low,
      close,
      volume: Number(quote.volume?.[i] || 0)
    });
  }

  const previousClose = Number(
    meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose
  );
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const price = Number(meta.regularMarketPrice ?? last?.close);
  const compareClose = Number.isFinite(previousClose) ? previousClose : prev?.close;
  const change = Number.isFinite(compareClose) ? price - compareClose : price - last?.open;
  const changePercent = Number.isFinite(compareClose) && compareClose !== 0 ? (change / compareClose) * 100 : 0;

  return {
    symbol,
    price,
    previousClose: compareClose,
    change,
    changePercent,
    asOf: Number(meta.regularMarketTime || last?.time || Math.floor(Date.now() / 1000)),
    marketTime: Number(meta.regularMarketTime || last?.time || Math.floor(Date.now() / 1000)),
    series: rows
  };
}

function applyLatestDailyPrice(rows, payload) {
  if (!rows.length || !Number.isFinite(payload.price) || !Number.isFinite(payload.marketTime)) return rows;
  const next = [...rows];
  const last = next.at(-1);
  const liveClose = payload.price;
  if (payload.marketTime > last.time + 18 * 60 * 60) {
    next.push({
      time: payload.marketTime,
      open: last.close,
      high: Math.max(last.close, liveClose),
      low: Math.min(last.close, liveClose),
      close: liveClose,
      volume: 0
    });
    return next;
  }
  if (payload.marketTime >= last.time) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, liveClose),
      low: Math.min(last.low, liveClose),
      close: liveClose
    };
  }
  return next;
}

function isNaverNtxQuote(quote) {
  return quote?.source === "naver-nxt-realtime" && Number.isFinite(Number(quote.price)) && Number.isFinite(Number(quote.marketTime));
}

function ntxCandleFromQuote(quote) {
  const close = Number(quote.price);
  const open = Number.isFinite(Number(quote.sessionOpen)) ? Number(quote.sessionOpen) : close;
  const high = Number.isFinite(Number(quote.sessionHigh)) ? Number(quote.sessionHigh) : Math.max(open, close);
  const low = Number.isFinite(Number(quote.sessionLow)) ? Number(quote.sessionLow) : Math.min(open, close);
  return {
    time: minuteBucket(Number(quote.marketTime)),
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
    volume: Number(quote.sessionVolume || 0),
    source: "naver-nxt-realtime"
  };
}

function buildKoreanNtxSessionRows(rows, quote, intervalSeconds) {
  if (!rows.length || !isNaverNtxQuote(quote)) return [];
  const candle = ntxCandleFromQuote(quote);
  const quoteMinute = koreanMinuteOfDay(candle.time);
  if (quoteMinute <= 15 * 60 + 30) return [];
  const step = Math.max(60, Number(intervalSeconds) || 60);
  const startTime = replaceKoreanTime(candle.time, 15, 40);
  const sessionEndTime = replaceKoreanTime(candle.time, 18, 0);
  const quoteTime = Math.min(candle.time, sessionEndTime);
  if (quoteTime < startTime) return [];

  const count = Math.max(1, Math.floor((quoteTime - startTime) / step) + 1);
  const previousClose = rows.filter((row) => row.time < startTime).at(-1)?.close;
  const open = Number.isFinite(Number(quote.sessionOpen)) ? Number(quote.sessionOpen) : previousClose ?? candle.open;
  const close = candle.close;
  const high = Math.max(candle.high, open, close);
  const low = Math.min(candle.low, open, close);
  const highIndex = Math.max(0, Math.min(count - 1, Math.floor(count * 0.35)));
  const lowIndex = Math.max(0, Math.min(count - 1, Math.floor(count * 0.7)));
  const totalVolume = Number(candle.volume || 0);
  const baseVolume = count > 0 ? Math.floor(totalVolume / count) : 0;
  let volumeLeft = totalVolume;

  return Array.from({ length: count }, (_, index) => {
    const time = startTime + index * step;
    const ratioStart = index / count;
    const ratioEnd = (index + 1) / count;
    const barOpen = index === 0 ? open : open + (close - open) * ratioStart;
    const barClose = index === count - 1 ? close : open + (close - open) * ratioEnd;
    let barHigh = Math.max(barOpen, barClose);
    let barLow = Math.min(barOpen, barClose);
    if (index === highIndex) barHigh = Math.max(barHigh, high);
    if (index === lowIndex) barLow = Math.min(barLow, low);
    const volume = index === count - 1 ? volumeLeft : Math.min(volumeLeft, baseVolume);
    volumeLeft -= volume;
    return {
      time,
      open: Math.round(barOpen),
      high: Math.round(barHigh),
      low: Math.round(barLow),
      close: Math.round(barClose),
      volume,
      source: "naver-nxt-session"
    };
  });
}

function applyKoreanNtxIntraday(rows, quote, intervalSeconds = 60) {
  if (!rows.length || !isNaverNtxQuote(quote)) return rows;
  const sessionRows = buildKoreanNtxSessionRows(rows, quote, intervalSeconds);
  if (!sessionRows.length) return rows;
  return mergeRowsByTime(rows, sessionRows);
}

function applyKoreanNtxDaily(rows, quote) {
  if (!rows.length || !isNaverNtxQuote(quote)) return rows;
  const next = [...rows];
  const candle = ntxCandleFromQuote(quote);
  const lastIndex = next.length - 1;
  const last = next[lastIndex];
  if (!last) return rows;
  if (koreanDateKeyForTimestamp(last.time) === koreanDateKeyForTimestamp(candle.time)) {
    next[lastIndex] = {
      ...last,
      high: Math.max(last.high, candle.high),
      low: Math.min(last.low, candle.low),
      close: candle.close,
      volume: Math.max(last.volume || 0, candle.volume || 0),
      source: "naver-nxt-realtime"
    };
    return next;
  }
  next.push({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    source: "naver-nxt-realtime"
  });
  return next;
}

function normalizeLiveQuoteBucket(symbol, timestamp) {
  if (!isKoreanSymbol(symbol) && !isKoreanIndex(symbol)) return timestamp;
  const minute = koreanMinuteOfDay(timestamp);
  if (minute >= 15 * 60 + 30) return replaceKoreanTime(timestamp, 15, 30);
  return timestamp;
}

function applyLiveQuoteToRows(rows, quote, intervalSeconds = 60, symbol = "") {
  if (!rows.length || !quote || !Number.isFinite(quote.price)) return rows;
  const next = [...rows];
  const last = next.at(-1);
  const quoteTime = Number(quote.marketTime || quote.asOf || Math.floor(Date.now() / 1000));
  const bucketTime = normalizeLiveQuoteBucket(symbol, Math.floor(quoteTime / intervalSeconds) * intervalSeconds);
  const stepCount = Math.max(0, Math.floor((bucketTime - last.time) / intervalSeconds));
  const targetTime = stepCount > 0 ? last.time + stepCount * intervalSeconds : last.time;
  if (targetTime === last.time) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, quote.price),
      low: Math.min(last.low, quote.price),
      close: quote.price
    };
    return next;
  }
  next.push({
    time: targetTime,
    open: next.at(-1).close,
    high: Math.max(next.at(-1).close, quote.price),
    low: Math.min(next.at(-1).close, quote.price),
    close: quote.price,
    volume: 0
  });
  return next;
}

function aggregateRows(rows, seconds) {
  const buckets = new Map();
  for (const row of rows) {
    const bucketTime = Math.floor(row.time / seconds) * seconds;
    const bucket = buckets.get(bucketTime);
    if (!bucket) {
      buckets.set(bucketTime, { ...row, time: bucketTime });
      continue;
    }
    bucket.high = Math.max(bucket.high, row.high);
    bucket.low = Math.min(bucket.low, row.low);
    bucket.close = row.close;
    bucket.volume += row.volume || 0;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function mergeRowsByTime(baseRows, overlayRows) {
  if (!overlayRows?.length) return baseRows;
  const byTime = new Map(baseRows.map((row) => [row.time, row]));
  for (const row of overlayRows) byTime.set(row.time, row);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function fetchWithTimeout(url, timeoutMs = 3500, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 stock8-four-candles",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function compactText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function staticSearch(query) {
  const q = query.trim().toLowerCase();
  const compact = compactText(q);
  if (!compact) return [];
  const sixDigit = compact.match(/^\d{6}$/);
  const exactSymbol = SYMBOL_NAMES[`${compact}.KQ`] && !SYMBOL_NAMES[`${compact}.KS`] ? `${compact}.KQ` : `${compact}.KS`;
  const exactCode = sixDigit
    ? [{ symbol: exactSymbol, name: SYMBOL_NAMES[exactSymbol] || compact }]
    : [];
  const matches = SYMBOL_SEARCH
    .map((item) => {
      const values = [item.symbol.replace(".US", ""), item.symbol.replace(/\.(KS|KQ|US)$/, ""), item.name, ...(item.aliases || [])];
      const compactValues = values.map(compactText);
      let score = 99;
      if (compactValues.some((value) => value === compact)) score = 0;
      else if (compactValues.some((value) => value.startsWith(compact))) score = 1;
      else if (compactValues.some((value) => value.includes(compact))) score = 2;
      return { item, score };
    })
    .filter(({ score }) => score < 99)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .map(({ item }) => item);
  return [...exactCode, ...matches];
}

function mergeSearchResults(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const item of group || []) {
      if (!item?.symbol || !item?.name) continue;
      const symbol = item.symbol.toUpperCase();
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      merged.push({ symbol, name: item.name, aliases: item.aliases || [] });
    }
  }
  return merged.slice(0, 12);
}

function koreanMarketSuffix(marketText = "") {
  return /KOSDAQ|코스닥|KQ/i.test(marketText) ? ".KQ" : ".KS";
}

function collectKoreanSearchItems(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    const code = node.find((value) => /^\d{6}$/.test(String(value || "")));
    const name = node.find((value) => /[가-힣]/.test(String(value || "")) && !/코스피|코스닥|KOSPI|KOSDAQ/i.test(String(value)));
    if (code && name) {
      out.push({
        symbol: `${code}${koreanMarketSuffix(node.join(" "))}`,
        name: String(name)
      });
    }
    node.forEach((child) => collectKoreanSearchItems(child, out));
    return out;
  }
  if (typeof node === "object") {
    const code = node.code || node.itemCode || node.symbol || node.ticker;
    const name = node.name || node.itemName || node.korName || node.title;
    if (/^\d{6}$/.test(String(code || "")) && name) {
      out.push({
        symbol: `${code}${koreanMarketSuffix(node.market || node.exchange || node.type || "")}`,
        name: String(name)
      });
    }
    Object.values(node).forEach((child) => collectKoreanSearchItems(child, out));
  }
  return out;
}

async function searchKoreanSymbols(query) {
  if (!/[가-힣]|\d{6}/.test(query)) return [];
  const url = `https://ac.finance.naver.com/ac?q=${encodeURIComponent(query)}&q_enc=UTF-8&st=111&r_lt=111`;
  try {
    const response = await fetchWithTimeout(url, 1800);
    if (!response.ok) return [];
    const text = await response.text();
    const jsonText = text.trim().replace(/^[^{[]*\(/, "").replace(/\);?$/, "");
    const json = JSON.parse(jsonText);
    return collectKoreanSearchItems(json);
  } catch {
    return [];
  }
}

function suffixFromText(text = "") {
  if (/코스닥|KOSDAQ/i.test(text)) return ".KQ";
  if (/코스피|KOSPI/i.test(text)) return ".KS";
  return "";
}

async function fetchNaverItemMeta(code, fallbackName = code, suffixHint = "") {
  try {
    const response = await fetchWithTimeout(`https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`, 1800);
    if (!response.ok) throw new Error(`Naver item HTTP ${response.status}`);
    const html = await response.text();
    const title = decodeHtml(html.match(/<title>\s*([^:<]+?)\s*[:<]/i)?.[1] || fallbackName).trim();
    const suffix = suffixHint || ".KS";
    return { symbol: `${code}${suffix}`, name: title || fallbackName };
  } catch {
    return { symbol: `${code}${suffixHint || ".KS"}`, name: fallbackName };
  }
}

async function searchNaverWebSymbols(query) {
  if (!/[가-힣]|\d{6}/.test(query)) return [];
  const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(`${query} 주가`)}`;
  try {
    const response = await fetchWithTimeout(url, 2200);
    if (!response.ok) return [];
    const html = await response.text();
    const byCode = new Map();
    for (const match of html.matchAll(/(.{0,300})item\/main\.naver\?code=(\d{6})(.{0,300})/g)) {
      const [, before, code, after] = match;
      if (!byCode.has(code)) byCode.set(code, suffixFromText(`${before} ${after}`));
    }
    const items = [...byCode.entries()].slice(0, 6);
    return Promise.all(items.map(([code, suffixHint]) => fetchNaverItemMeta(code, query, suffixHint)));
  } catch {
    return [];
  }
}

async function searchUsSymbols(query) {
  if (!/[a-zA-Z]/.test(query)) return [];
  const usExchanges = new Set(["NYQ", "NYS", "NMS", "NGM", "NCM", "NAS", "ASE", "PCX", "BTS"]);
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0`;
  try {
    const response = await fetchWithTimeout(url, 1800, {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) return [];
    const json = await response.json();
    return (json.quotes || [])
      .filter((quote) => ["EQUITY", "ETF"].includes(quote.quoteType) && quote.symbol && quote.shortname)
      .filter((quote) => usExchanges.has(quote.exchange) && !String(quote.symbol).includes("."))
      .map((quote) => ({
        symbol: `${String(quote.symbol).toUpperCase()}.US`,
        name: String(quote.shortname || quote.longname || quote.symbol)
      }));
  } catch {
    return [];
  }
}

async function searchSymbols(query) {
  const staticMatches = staticSearch(query);
  const [koreanMatches, naverWebMatches, usMatches] = await Promise.all([
    searchKoreanSymbols(query),
    searchNaverWebSymbols(query),
    searchUsSymbols(query)
  ]);
  return mergeSearchResults(staticMatches, koreanMatches, naverWebMatches, usMatches);
}

function fallbackCandles(symbol, limit = 140, intervalSeconds = 60) {
  const base = FALLBACK_BASE[symbol] || FALLBACK_BASE["NVDA.US"];
  const rows = [];
  let close = base.price - base.step * 12;
  const now = Math.floor(Date.now() / 1000 / intervalSeconds) * intervalSeconds;
  for (let i = limit - 1; i >= 0; i -= 1) {
    const wave = Math.sin(i * 0.18 + symbol.length) * base.step * 1.8;
    const drift = (limit - i) * base.step * 0.08;
    const open = close + Math.cos(i * 0.13) * base.step * 0.8;
    close = Math.max(base.step, open + wave * 0.18 + drift * 0.04);
    const high = Math.max(open, close) + base.step * (0.8 + Math.abs(Math.sin(i)));
    const low = Math.min(open, close) - base.step * (0.7 + Math.abs(Math.cos(i)));
    rows.push({
      time: now - i * intervalSeconds,
      open: Number(open.toFixed(decimalsFor(symbol))),
      high: Number(high.toFixed(decimalsFor(symbol))),
      low: Number(low.toFixed(decimalsFor(symbol))),
      close: Number(close.toFixed(decimalsFor(symbol))),
      volume: Math.round(1_000_000 + Math.abs(Math.sin(i * 0.3)) * 8_000_000)
    });
  }
  return rows;
}

async function getIntraday(symbol, interval = "1m", mode = "KRX") {
  const normalized = symbol.trim().toUpperCase();
  try {
    const includePrePost = mode === "NTX" && isUsSymbol(normalized);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(normalized))}?range=1d&interval=${encodeURIComponent(interval)}&includePrePost=${includePrePost ? "true" : "false"}`;
    const response = await fetchWithTimeout(url, 4000);
    if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
    const payload = parseYahooIntraday(normalized, await response.json());
    payload.series = normalizeKoreanIntradayRows(normalized, payload.series);
    payload.series = applyKoreanClosingPrint(normalized, payload.series, payload);
    if (!payload.series.length) throw new Error("No intraday data");
    return payload;
  } catch {
    const series = fallbackCandles(normalized, 96, 60);
    const previousClose = series[0].open;
    const price = series.at(-1).close;
    const change = price - previousClose;
    return {
      symbol: normalized,
      price,
      previousClose,
      change,
      changePercent: previousClose ? (change / previousClose) * 100 : 0,
      asOf: series.at(-1).time,
      series
    };
  }
}

async function getChart(symbol, interval = "1d", limit = 120, mode = "KRX") {
  const normalized = symbol.trim().toUpperCase();
  const config = INTERVAL_CONFIG[interval] || INTERVAL_CONFIG["1d"];
  let kisMeta = {
    ...kisStatusPayload(),
    supported: kisSupportsQuote(normalized, mode),
    attempted: false,
    ok: false
  };
  try {
    const useNtxQuote = mode === "NTX" && isUsSymbol(normalized);
    let liveQuote = null;
    let kisIntradayRows = [];
    let naverMinuteRows = [];
    const preferNaverNxt = mode === "NTX" && isKoreanSymbol(normalized);
    const includePrePost = useNtxQuote && isIntradayInterval(interval);
    const range = includePrePost ? "1d" : config.range;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(normalized))}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(config.yahooInterval)}&includePrePost=${includePrePost ? "true" : "false"}`;

    let yahooPayload = null;
    let yahooLastTime = 0;
    let yahooError = null;
    try {
      const response = await fetchWithTimeout(url, 4500);
      if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
      yahooPayload = parseYahooChart(normalized, await response.json());
      if (yahooPayload.series?.length) {
        yahooLastTime = yahooPayload.series.at(-1).time;
      }
    } catch (err) {
      yahooError = err;
    }

    if (KIS_ENABLED && isKoreanSymbol(normalized) && isIntradayInterval(interval) && !preferNaverNxt) {
      kisMeta.intradayAttempted = true;
      try {
        // Pass yahooLastTime=0 to always fetch the full trading day from KIS.
        // Yahoo Finance often has gaps in the 15:00-15:19 range for Korean stocks,
        // so we cannot rely on yahooLastTime to determine where KIS should start.
        kisIntradayRows = await fetchKisIntradayRows(normalized, 0);
        kisMeta.intradayOk = true;
        kisMeta.intradayCount = kisIntradayRows.length;
      } catch (error) {
        kisMeta.intradayOk = false;
        kisMeta.intradayError = kisErrorMessage(error);
      }
    }

    if (!liveQuote && (isKoreanSymbol(normalized) || isKoreanIndex(normalized))) {
      try {
        liveQuote = await fetchNaverRealtimeQuote(normalized, mode);
      } catch {
        liveQuote = null;
      }
    }

    if (isKoreanSymbol(normalized) && isIntradayInterval(interval)) {
      try {
        const naverAnchor = liveQuote?.marketTime || liveQuote?.asOf || yahooLastTime || Math.floor(Date.now() / 1000);
        naverMinuteRows = await fetchNaverMinuteRows(normalized, naverAnchor);
      } catch {
        naverMinuteRows = [];
      }
    }

    let payload = null;
    if (yahooPayload) {
      payload = yahooPayload;
    } else if (kisIntradayRows.length) {
      payload = {
        symbol: normalized,
        price: liveQuote?.price || kisIntradayRows.at(-1).close,
        previousClose: liveQuote?.previousClose || kisIntradayRows[0].open,
        change: liveQuote?.change || 0,
        changePercent: liveQuote?.changePercent || 0,
        asOf: kisIntradayRows.at(-1).time,
        marketTime: kisIntradayRows.at(-1).time,
        series: kisIntradayRows
      };
    } else {
      throw yahooError || new Error("No chart data");
    }

    if (useNtxQuote && !isIntradayInterval(interval)) {
      try {
        const ntxPayload = await getIntraday(normalized, "1m", "NTX");
        const latestNtx = ntxPayload.series.at(-1);
        if (latestNtx) {
          payload.price = latestNtx.close;
          payload.previousClose = ntxPayload.previousClose;
          payload.change = payload.price - payload.previousClose;
          payload.changePercent = Number.isFinite(payload.previousClose) && payload.previousClose !== 0
            ? (payload.change / payload.previousClose) * 100
            : payload.changePercent;
          payload.asOf = latestNtx.time;
          payload.marketTime = latestNtx.time;
          payload.source = "yahoo-ntx";
        }
      } catch {
        // Keep the regular Yahoo chart payload if extended-hours lookup fails.
      }
    }
    if (useNtxQuote && isIntradayInterval(interval) && payload.series.length) {
      const latestNtx = payload.series.at(-1);
      payload.price = latestNtx.close;
      payload.change = Number.isFinite(payload.previousClose) ? payload.price - payload.previousClose : payload.change;
      payload.changePercent = Number.isFinite(payload.previousClose) && payload.previousClose !== 0
        ? (payload.change / payload.previousClose) * 100
        : payload.changePercent;
      payload.asOf = latestNtx.time;
      payload.marketTime = latestNtx.time;
      payload.source = "yahoo-ntx";
    }
    if (liveQuote) {
      payload.price = liveQuote.price;
      payload.previousClose = liveQuote.previousClose;
      payload.change = liveQuote.change;
      payload.changePercent = liveQuote.changePercent;
      payload.asOf = liveQuote.asOf;
      payload.marketTime = liveQuote.marketTime;
      payload.marketStatus = liveQuote.marketStatus;
      payload.source = liveQuote.source;
      payload.kis = kisMeta;
    }
    if (!payload.series.length) throw new Error("No chart data");
    let series = isIntradayInterval(interval)
      ? normalizeKoreanIntradayRows(normalized, payload.series)
      : payload.series;
    if (isIntradayInterval(interval) && naverMinuteRows.length) {
      series = mergeRowsByTime(series, naverMinuteRows);
      payload.source = payload.source || "naver-minute";
    }
    if (isIntradayInterval(interval) && kisIntradayRows.length && payload.series !== kisIntradayRows) {
      series = mergeRowsByTime(series, kisIntradayRows);
      payload.source = liveQuote?.source === "kis" ? "kis" : "kis-intraday";
    }
    if (isIntradayInterval(interval) && liveQuote && (isKoreanSymbol(normalized) || isKoreanIndex(normalized)) && !isNaverNtxQuote(liveQuote)) {
      series = applyLiveQuoteToRows(series, liveQuote, config.aggregate ? 60 : config.seconds, normalized);
    }
    if (isIntradayInterval(interval)) series = applyKoreanClosingPrint(normalized, series, payload);
    const finalAggregateSeconds = isIntradayInterval(interval) && config.seconds > 60
      ? config.seconds
      : config.aggregate;
    series = finalAggregateSeconds ? aggregateRows(series, finalAggregateSeconds) : series;
    if (isIntradayInterval(interval) && isKoreanSymbol(normalized) && mode === "NTX" && isNaverNtxQuote(liveQuote)) {
      series = applyKoreanNtxIntraday(series, liveQuote, config.seconds);
      payload.source = "naver-nxt-realtime";
    }
    if (interval === "1d") series = applyLatestDailyPrice(series, payload);
    if (interval === "1d" && isKoreanSymbol(normalized) && mode === "NTX" && isNaverNtxQuote(liveQuote)) {
      series = applyKoreanNtxDaily(series, liveQuote);
      payload.source = "naver-nxt-realtime";
    }
    if (isIntradayInterval(interval) && liveQuote && !isKoreanSymbol(normalized) && !isKoreanIndex(normalized)) {
      series = applyLiveQuoteToRows(series, liveQuote, config.seconds, normalized);
    }
    const trimmed = series.slice(-limit);
    const lastClose = trimmed.at(-1)?.close;
    const prevClose = trimmed.at(-2)?.close;
    let price = payload.price;
    let previousClose = payload.previousClose;
    if (interval === "1d") {
      previousClose = prevClose ?? lastClose;
    } else if (interval === "1wk" || interval === "1mo") {
      price = lastClose;
      previousClose = prevClose;
    }
    if (liveQuote) {
      price = liveQuote.price;
      previousClose = liveQuote.previousClose;
    }
    const change = liveQuote?.change ?? (Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : 0);
    return {
      ...payload,
      price,
      previousClose,
      change,
      changePercent: liveQuote?.changePercent ?? (Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : 0),
      marketStatus: payload.marketStatus || marketStatus(normalized),
      source: payload.source || (kisMeta.attempted && !kisMeta.ok ? "fallback-after-kis-error" : "yahoo-or-sample"),
      kis: kisMeta,
      series: trimmed
    };
  } catch (error) {
    if (kisMeta.attempted && !kisMeta.ok && !kisMeta.error) kisMeta.error = kisErrorMessage(error);
    const series = fallbackCandles(normalized, limit, config.seconds);
    const previousClose = series.length > 1 ? series.at(-2).close : series[0].open;
    const price = series.at(-1).close;
    const change = price - previousClose;
    return {
      symbol: normalized,
      price,
      previousClose,
      change,
      changePercent: previousClose ? (change / previousClose) * 100 : 0,
      asOf: series.at(-1).time,
      marketStatus: marketStatus(normalized),
      source: kisMeta.attempted && !kisMeta.ok ? "fallback-after-kis-error" : "fallback",
      kis: kisMeta,
      series
    };
  }
}

async function getCandles(symbol, limit = 140) {
  const normalized = symbol.trim().toUpperCase();
  try {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(normalized))}&i=d`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
    const rows = parseDailyCsv(await response.text());
    if (!rows.length) throw new Error("No candle data");
    return rows.slice(-limit);
  } catch {
    return fallbackCandles(normalized, limit, 86400);
  }
}

async function getQuote(symbol, mode = "KRX") {
  const normalized = symbol.trim().toUpperCase();
  const kisMeta = {
    ...kisStatusPayload(),
    supported: kisSupportsQuote(normalized, mode),
    attempted: false,
    ok: false
  };
  const preferNaverNxt = mode === "NTX" && isKoreanSymbol(normalized);
  if (KIS_ENABLED && kisMeta.supported && !preferNaverNxt) {
    kisMeta.attempted = true;
    try {
      return {
        ...(await fetchKisQuote(normalized)),
        kis: { ...kisMeta, ok: true }
      };
    } catch (error) {
      kisMeta.error = kisErrorMessage(error);
    }
  }
  if (isKoreanSymbol(normalized) || isKoreanIndex(normalized)) {
    try {
      return {
        ...(await fetchNaverRealtimeQuote(normalized, mode)),
        kis: kisMeta
      };
    } catch {
      // Continue to Yahoo/fallback if Naver realtime is unavailable.
    }
  }
  const intraday = await getIntraday(normalized, "1m", mode);
  return {
    symbol: normalized,
    name: SYMBOL_NAMES[normalized] || normalized,
    price: intraday.price,
    previousClose: intraday.previousClose,
    change: intraday.change,
    changePercent: intraday.changePercent,
    changeRate: intraday.changePercent,
    asOf: intraday.asOf,
    marketStatus: marketStatus(normalized),
    source: kisMeta.attempted && !kisMeta.ok ? "fallback-after-kis-error" : "yahoo-or-sample",
    kis: kisMeta
  };
}

async function sendJson(res, payload) {
  res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function appPathname(url) {
  const stripped = url.pathname.replace(/^\/stock8-7(?=\/|$)/, "");
  return stripped || "/";
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = appPathname(url);
  const rawPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = appPathname(url);

  if (pathname === "/health") {
    await sendJson(res, { status: "ok", kis: kisStatusPayload() });
    return;
  }

  if (pathname === "/api/quote") {
    await sendJson(res, await getQuote(url.searchParams.get("symbol") || "NVDA.US", url.searchParams.get("mode") || "KRX"));
    return;
  }

  if (pathname === "/api/candles") {
    const symbol = (url.searchParams.get("symbol") || "NVDA.US").trim().toUpperCase();
    const limit = Math.min(260, Math.max(40, Number(url.searchParams.get("limit") || 140)));
    await sendJson(res, {
      ok: true,
      symbol,
      name: url.searchParams.get("name") || SYMBOL_NAMES[symbol] || symbol,
      decimals: decimalsFor(symbol),
      series: await getCandles(symbol, limit)
    });
    return;
  }

  if (pathname === "/api/intraday") {
    const symbol = (url.searchParams.get("symbol") || "NVDA.US").trim().toUpperCase();
    const interval = url.searchParams.get("interval") || "1m";
    const payload = await getIntraday(symbol, interval, url.searchParams.get("mode") || "KRX");
    await sendJson(res, {
      ok: true,
      symbol,
      name: url.searchParams.get("name") || SYMBOL_NAMES[symbol] || symbol,
      decimals: decimalsFor(symbol),
      ...payload
    });
    return;
  }

  if (pathname === "/api/chart") {
    const symbol = (url.searchParams.get("symbol") || "NVDA.US").trim().toUpperCase();
    const interval = url.searchParams.get("interval") || "1d";
    const limit = Math.min(900, Math.max(20, Number(url.searchParams.get("limit") || 120)));
    const payload = await getChart(symbol, interval, limit, url.searchParams.get("mode") || "KRX");
    await sendJson(res, {
      ok: true,
      symbol,
      interval,
      limit,
      name: url.searchParams.get("name") || SYMBOL_NAMES[symbol] || symbol,
      decimals: decimalsFor(symbol),
      ...payload
    });
    return;
  }

  if (pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim();
    const matches = await searchSymbols(q);
    await sendJson(res, { ok: true, results: matches });
    return;
  }

  await serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`stock8 four-candle dashboard: http://127.0.0.1:${PORT}`);
  console.log(`KIS realtime: ${KIS_ENABLED ? "enabled" : "disabled"}`);
});
