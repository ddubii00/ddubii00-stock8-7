import { INSTRUMENT_CATALOG } from "./instrument-catalog.js";
const compactText = value => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export const SYMBOL_SEARCH = [
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

export function staticSearch(query, savedItems = []) {
  const q = query.trim().toLowerCase();
  const compact = compactText(q);
  if (!compact) return [];
  const matches = [...INSTRUMENT_CATALOG, ...SYMBOL_SEARCH, ...savedItems]
    .map((item) => {
      const values = [item.symbol, item.symbol.replace(".US", ""), item.symbol.replace(/\.(KS|KQ|US)$/, ""), item.name, ...(item.aliases || [])];
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
  return [...new Map(matches.map(item => [item.symbol, item])).values()];
}

