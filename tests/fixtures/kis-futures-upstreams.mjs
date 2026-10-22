// No real keys or external network calls in integration tests.
globalThis.WebSocket = undefined;
const now = Math.floor(Date.now() / 1000);
const parts = time => {
  const value = new Date(time * 1000 + 9 * 3600000).toISOString();
  return { date: value.slice(0, 10).replaceAll('-', ''), clock: value.slice(11, 19).replaceAll(':', '') };
};
const current = parts(now);
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.hostname.endsWith('finance.yahoo.com')) {
    if (process.env.FIXTURE_YAHOO_DOWN === '1') return Response.json({}, { status: 429 });
    const timestamps = Array.from({ length: 160 }, (_, i) => Math.floor(now / 60) * 60 - (159 - i) * 60);
    const prices = timestamps.map((_, i) => 29960 + i * 0.25);
    return Response.json({ chart: { result: [{ meta: { chartPreviousClose: 29900, regularMarketPrice: prices.at(-1) }, timestamp: timestamps,
      indicators: { quote: [{ open: prices, high: prices.map(p => p + 0.25), low: prices.map(p => p - 0.25), close: prices, volume: prices.map(() => 12) }] } }] } });
  }
  if (url.hostname === 'polling.finance.naver.com') {
    if (process.env.FIXTURE_NAVER_DOWN === '1') return Response.json({}, { status: 503 });
    return Response.json({ datas: [{ reutersCode: 'NQcv1', closePrice: '29,950.25',
      compareToPreviousClosePrice: '-149.75', fluctuationsRatio: '-0.50',
      localTradedAt: new Date((now - 600) * 1000).toISOString(),
      stockExchangeType: { delayTime: 10 }, marketStatus: 'OPEN' }] });
  }
  if (url.hostname === 'api.stock.naver.com') {
    if (process.env.FIXTURE_NAVER_DOWN === '1') return Response.json({}, { status: 503 });
    return Response.json([{ localDate: '20261021', openPrice: 30010, highPrice: 30050, lowPrice: 29940, closePrice: 30020, accumulatedTradingVolume: 10 },
      { localDate: '20261022', openPrice: 30020, highPrice: 30030, lowPrice: 29940, closePrice: 29950.25, accumulatedTradingVolume: 15 }]);
  }
  if (url.hostname !== 'openapi.koreainvestment.com') throw new Error('Unexpected non-KIS source ' + url.hostname);
  if (url.pathname.endsWith('tokenP')) return process.env.KIS_NQ_CONTRACT === 'NQU27'
    ? Response.json({ msg_cd: 'EGW00133', msg1: '접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)' }, { status: 403 })
    : Response.json({ access_token: 'fixture-token', expires_in: 86400 });
  if (url.pathname.endsWith('Approval')) return Response.json({ approval_key: 'fixture-approval' });
  if (url.searchParams.get('SRS_CD') === 'NQH27') return new Response('{rt_cd:"1","msg1":"CME SUB거래소 신청 계좌가 아닙니다.","msg_cd":"EGW00550"}',
    { status: 500, headers: { 'Content-Type': 'application/json' } });
  if (url.searchParams.get('SRS_CD') === 'NQM27') return Response.json({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' }, {status:500});
  if (url.searchParams.get('SRS_CD') === 'NQZ27' && url.pathname.endsWith('inquire-price')) return Response.json({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '일시적 현재가 오류' }, { status: 500 });
  if (url.pathname.endsWith('inquire-price')) return Response.json({ rt_cd: '0', output1: {
    proc_date: current.date, proc_time: current.clock, sbsnsdate: current.date,
    last_price: '30000.75', prev_price: '30100', open_price: '30100', high_price: '30200', low_price: '29900'
  } });
  const intraday = url.pathname.endsWith('inquire-time-futurechartprice');
  const secondPage = url.searchParams.get('QRY_TP') === 'P';
  const rows = Array.from({ length: 120 }, (_, i) => {
    const time = Math.floor(now / 60) * 60 - (i + (secondPage ? 120 : 0)) * (intraday ? 60 : 86400);
    const p = parts(time);
    return { data_date: p.date, data_time: p.clock, open_price: '30000.25', high_price: '30001', low_price: '29999', last_price: '30000.5', vol: '20' };
  });
  if (!options.headers.authorization || !options.headers.appkey) throw new Error('missing KIS authentication');
  return Response.json({ rt_cd: '0', output1: rows, output2: { index_key: secondPage ? '' : 'next' } });
};
