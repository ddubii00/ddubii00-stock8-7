const now = Math.floor(Date.now() / 60000) * 60;
const date = new Date(Date.now()-86400000);
while ([0,6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate()-1);
const dateKey = date.toISOString().slice(0,10).replaceAll('-','');
// Most recent business date at 10:30 KST, never in the future.
const indexDate = new Date();
indexDate.setUTCHours(1,30,0,0);
if (indexDate.getTime() > Date.now()) indexDate.setUTCDate(indexDate.getUTCDate()-1);
while ([0,6].includes(indexDate.getUTCDay())) indexDate.setUTCDate(indexDate.getUTCDate()-1);
const indexNow = indexDate.getTime()/1000;
const indexDateKey = indexDate.toISOString().slice(0,10).replaceAll('-','');
globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.hostname==='polling.finance.naver.com' && url.pathname.endsWith('/futures/NQcv1')) return Response.json({datas:[{reutersCode:'NQcv1',closePrice:'25,499.75',compareToPreviousClosePrice:'-1.25',fluctuationsRatio:'-0.005',localTradedAt:new Date((now-600)*1000).toISOString(),stockExchangeType:{delayTime:10}}]});
  if (url.hostname==='api.stock.naver.com' && url.pathname.includes('/foreign/futures/')) return Response.json([{localDate:'20261022',openPrice:25500,highPrice:25510,lowPrice:25490,closePrice:25499.75,accumulatedTradingVolume:10}]);
  if (url.hostname==='api.stock.naver.com' && /chart\/domestic\/index\/(KOSPI|KOSDAQ)$/.test(url.pathname)) {
    return Response.json({priceInfos:Array.from({length:91},(_,i)=>({localDateTime:`${indexDateKey}${String(9+Math.floor(i/60)).padStart(2,'0')}${String(i%60).padStart(2,'0')}00`,currentPrice:5700+(i%2),openPrice:5700,highPrice:5702,lowPrice:5699,accumulatedTradingVolume:100+i*10}))});
  }
  if (url.hostname==='m.stock.naver.com' && url.pathname==='/api/stock/196170/basic') return Response.json({itemCode:'196170',stockName:'알테오젠',stockExchangeType:{code:'KQ'}});
  if (url.hostname==='finance.naver.com' && url.pathname==='/api/sise/etfItemList.nhn') {
    return Response.json({result:{etfItemList:[...Array.from({length:15},(_,i)=>({itemcode:String(100000+i),itemname:`하이닉스 관련 ETF ${i}`})),{itemcode:'133690',itemname:'TIGER 미국나스닥100'}]}}, {headers:{'Content-Type':'application/json; charset=UTF-8'}});
  }
  if (url.hostname.includes('finance.yahoo.com') && url.pathname.includes('/v8/finance/chart/')) {
    const symbol=decodeURIComponent(url.pathname.split('/').at(-1));
    if (['FAIL','FAIL=F','005930.KS','KODEX','999999.KS'].includes(symbol)) return new Response('unavailable',{status:503});
    if (symbol==='EMPTY') return Response.json({chart:{result:[]}});
    const step=url.searchParams.get('interval')==='1wk'?604800:url.searchParams.get('interval')==='1d'?86400:60;
    const end = ['^KS11','^KQ11'].includes(symbol) ? indexNow - 20*60 : now;
    const timestamp=Array.from({length:2000},(_,i)=>end-(1999-i)*step);
    const close=timestamp.map((_,i)=>symbol==='NQ=F'?25000+i*.25:100+i*.01);
    return Response.json({chart:{result:[{meta:{symbol,regularMarketPrice:close.at(-1),chartPreviousClose:close.at(-2),regularMarketTime:now},timestamp,indicators:{quote:[{open:close,high:close.map(p=>p+1),low:close.map(p=>p-1),close,volume:close.map(()=>100)}]}}]}});
  }
  if (url.hostname==='api.finance.naver.com' && url.searchParams.get('symbol')==='005930') {
    const rows=Array.from({length:60},(_,i)=>`["${dateKey}09${String(i).padStart(2,'0')}",90000,90100,89900,${90000+i},${100*(i+1)}]`);
    return new Response('['+rows.join(',')+']');
  }
  if (url.hostname==='stooq.com' && url.searchParams.get('s')==='aapl.us') {
    return new Response('Date,Open,High,Low,Close,Volume\n2026-10-21,100,104,99,103,1000\n2026-10-22,103,106,101,105,2000\n');
  }
  return new Response('unavailable',{status:503});
};
