export const INSTRUMENT_CATALOG = [
  { symbol: '^KS11', name: 'KOSPI', aliases: ['코스피', '종합주가지수'] },
  { symbol: '^KQ11', name: 'KOSDAQ', aliases: ['코스닥'] },
  { symbol: '^IXIC', name: '나스닥', aliases: ['NASDAQ', '나스닥종합'] },
  { symbol: '^GSPC', name: 'S&P 500', aliases: ['S&P500', 'SP500', 'SPX', '에스앤피500'] },
  { symbol: '^DJI', name: '다우존스', aliases: ['다우', 'DOW', 'DJI', 'DOW JONES'] },
  { symbol: '^NDX', name: '나스닥 100', aliases: ['나스닥100', 'NASDAQ100', 'NDX'] },
  { symbol: '^RUT', name: '러셀 2000', aliases: ['러셀2000', 'RUSSELL2000'] },
  { symbol: '^VIX', name: 'VIX', aliases: ['변동성지수', '공포지수'] },
  { symbol: 'SPY.US', name: 'SPDR S&P 500 ETF', aliases: ['SPY', '미국 ETF'] },
  { symbol: 'QQQ.US', name: 'Invesco QQQ ETF', aliases: ['QQQ', '미국 ETF'] },
  { symbol: 'VOO.US', name: 'Vanguard S&P 500 ETF', aliases: ['VOO', '미국 ETF'] },
  { symbol: 'IVV.US', name: 'iShares Core S&P 500 ETF', aliases: ['IVV', '미국 ETF'] },
  { symbol: 'DIA.US', name: 'SPDR Dow Jones ETF', aliases: ['DIA', '미국 ETF'] },
  { symbol: 'IWM.US', name: 'iShares Russell 2000 ETF', aliases: ['IWM', '미국 ETF'] },
  { symbol: 'TQQQ.US', name: 'ProShares UltraPro QQQ ETF', aliases: ['TQQQ', '미국 ETF'] },
  { symbol: 'SQQQ.US', name: 'ProShares UltraPro Short QQQ ETF', aliases: ['SQQQ', '미국 ETF'] },
  { symbol: 'SOXL.US', name: 'Direxion Semiconductor Bull 3X ETF', aliases: ['SOXL', '미국 ETF'] },
  { symbol: 'SOXS.US', name: 'Direxion Semiconductor Bear 3X ETF', aliases: ['SOXS', '미국 ETF'] }
];
export function exactCatalogItem(query) {
  const compact = value => String(value).normalize('NFKC').toUpperCase().replace(/\s+/g, '');
  const q = compact(query);
  const matches = INSTRUMENT_CATALOG.filter(item => [item.symbol, item.name, ...item.aliases].some(value => compact(value) === q));
  return matches.length === 1 ? matches[0] : undefined;
}
