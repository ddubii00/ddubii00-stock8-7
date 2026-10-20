const now = Math.floor(Date.now() / 60000) * 60;
const date = new Date(Date.now()-86400000);
while ([0,6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate()-1);
const dateKey = date.toISOString().slice(0,10).replaceAll('-','');
globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.hostname==='m.stock.naver.com' && url.pathname==='/api/stock/196170/basic') return Response.json({itemCode:'196170',stockName:'알테오젠',stockExchangeType:{code:'KQ'}});
  if (url.hostname==='finance.naver.com' && url.pathname==='/api/sise/etfItemList.nhn') {
    return Response.json({result:{etfItemList:[...Array.from({length:15},(_,i)=>({itemcode:String(100000+i),itemname:`하이닉스 관련 ETF ${i}`})),{itemcode:'133690',itemname:'TIGER 미국나스닥100'}]}}, {headers:{'Content-Type':'application/json; charset=UTF-8'}});
  }
  if (url.hostname.includes('finance.yahoo.com') && url.pathname.includes('/v8/finance/chart/')) {
    const symbol=decodeURIComponent(url.pathname.split('/').at(-1));
    if (symbol==='FAIL' || symbol==='FAIL=F' || symbol==='005930.KS') return new Response('unavailable',{status:503});
    const step=url.searchParams.get('interval')==='1wk'?604800:url.searchParams.get('interval')==='1d'?86400:60;
    const timestamp=Array.from({length:2000},(_,i)=>now-(1999-i)*step);
    const close=timestamp.map((_,i)=>symbol==='NQ=F'?25000+i*.25:100+i*.01);
    return Response.json({chart:{result:[{meta:{symbol,regularMarketPrice:close.at(-1),chartPreviousClose:close.at(-2),regularMarketTime:now},timestamp,indicators:{quote:[{open:close,high:close.map(p=>p+1),low:close.map(p=>p-1),close,volume:close.map(()=>100)}]}}]}});
  }
  if (url.hostname==='api.finance.naver.com' && url.searchParams.get('symbol')==='005930') {
    const rows=Array.from({length:60},(_,i)=>`["${dateKey}09${String(i).padStart(2,'0')}",90000,90100,89900,${90000+i},${100*(i+1)}]`);
    return new Response('['+rows.join(',')+']');
  }
  return new Response('unavailable',{status:503});
};
