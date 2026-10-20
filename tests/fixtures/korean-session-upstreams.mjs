const RealDate = Date;
const now = RealDate.parse(process.env.TEST_MARKET_TIME || '2026-10-20T16:10:00+09:00');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const unix = (date, hour) => RealDate.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${hour.slice(0, 2)}:${hour.slice(2, 4)}:00+09:00`) / 1000;
const rows = [];
for (const date of ['20261019', '20261020']) {
  for (let minute = 9 * 60; minute <= 20 * 60; minute++) {
    const hour = `${String(Math.floor(minute / 60)).padStart(2, '0')}${String(minute % 60).padStart(2, '0')}`;
    const time = unix(date, hour);
    if (time * 1000 > now) continue;
    // Deliberately include auction/closed/future-looking provider entries:
    // the application must retain only actual session windows.
    const close = minute >= 16 * 60 ? 190 + minute % 7 : minute >= 15 * 60 + 30 ? 150 : 100 + minute % 7;
    rows.push({ time, date, hour, close });
  }
}
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.pathname === '/oauth2/tokenP') return Response.json({ access_token: 'test-token', expires_in: 86400 });
  if (url.pathname.endsWith('/inquire-time-dailychartprice')) {
    if (options.headers.tr_id !== 'FHKST03010230' || url.searchParams.get('FID_COND_MRKT_DIV_CODE') !== 'J'
      || url.searchParams.get('FID_FAKE_TICK_INCU_YN') !== 'N') throw Error('Incorrect KIS history request');
    const end = url.searchParams.get('FID_INPUT_DATE_1') + url.searchParams.get('FID_INPUT_HOUR_1').slice(0, 4);
    const selected = rows.filter(row => row.date + row.hour <= end).slice(-120).reverse();
    return Response.json({ rt_cd: '0', output2: selected.map(row => ({ stck_bsop_date: row.date, stck_cntg_hour: row.hour + '00', stck_oprc: String(row.close), stck_hgpr: String(row.close + 1), stck_lwpr: String(row.close - 1), stck_prpr: String(row.close), cntg_vol: '10' })) });
  }
  if (url.hostname.includes('finance.yahoo.com')) {
    // Reproduce Yahoo's missing Korean data after yesterday 14:59.
    const selected = rows.filter(row => row.hour <= '1459');
    return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 106, chartPreviousClose: 99, regularMarketTime: selected.at(-1).time }, timestamp: selected.map(row => row.time), indicators: { quote: [{ open: selected.map(row => row.close), high: selected.map(row => row.close + 1), low: selected.map(row => row.close - 1), close: selected.map(row => row.close), volume: selected.map(() => 10) }] } }] } });
  }
  if (url.hostname === 'api.finance.naver.com') {
    const start = url.searchParams.get('startTime'), end = url.searchParams.get('endTime');
    const selected = rows.filter(row => row.date + row.hour >= start && row.date + row.hour <= end);
    return new Response('[' + selected.map(row => `["${row.date}${row.hour}",${row.close},${row.close + 1},${row.close - 1},${row.close},10]`).join(',') + ']');
  }
  if (url.hostname === 'polling.finance.naver.com') {
    const local = new RealDate(now + 9 * 3600000).toISOString();
    const minute = +local.slice(11, 13) * 60 + +local.slice(14, 16);
    const lastTime = minute < 15 * 60 + 30 ? (minute >= 15 * 60 + 20 ? '1519' : local.slice(11, 16).replace(':', '')) : minute <= 15 * 60 + 32 ? local.slice(11, 16).replace(':', '') : '1610';
    const time = unix('20261020', lastTime);
    return Response.json({ datas: [{ closePrice: minute >= 16 * 60 ? '192' : minute >= 15 * 60 + 30 ? '150' : '106', compareToPreviousClosePrice: '7', fluctuationsRatio: '7.07', marketStatus: 'OPEN', localTradedAt: new RealDate(time * 1000).toISOString(), stockName: '테스트' }] });
  }
  return new Response('unavailable', { status: 503 });
};
