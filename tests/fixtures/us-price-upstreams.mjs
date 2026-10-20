const at = value => Date.parse(value) / 1000;
const pre = process.env.TEST_US_SESSION === 'pre';
const regularTime = at(pre ? '2026-10-16T20:00:00Z' : '2026-10-20T19:00:00Z');
const extendedTime = at(pre ? '2026-10-19T12:00:00Z' : '2026-10-20T22:00:00Z');
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.pathname === '/oauth2/tokenP') return Response.json({ access_token: 'fixture-token', expires_in: 86400 });
  if (url.pathname === '/uapi/overseas-price/v1/quotations/price') {
    if (options.headers.tr_id !== 'HHDFS00000300') throw Error('Incorrect KIS quote TR');
    // Inconsistent diff/rate and large pvol catch use of the wrong KIS fields.
    return Response.json({ rt_cd: '0', output: { last: '95', base: '100', pvol: '900000', diff: '999', rate: '888' } });
  }
  if (url.hostname.includes('finance.yahoo.com')) {
    const daily = url.searchParams.get('interval') === '1d' && url.searchParams.get('range') === '1mo';
    const extended = url.searchParams.get('includePrePost') === 'true';
    const timestamp = daily ? (pre ? ['2026-10-15', '2026-10-16', '2026-10-19'] : ['2026-10-16', '2026-10-19', '2026-10-20']).map(date => at(date + 'T13:30:00Z'))
      : [regularTime - 120, regularTime - 60, regularTime, ...(extended ? [extendedTime] : [])];
    const close = daily ? [110, 120, 130] : [70, 90, pre ? 120 : 130, ...(extended ? [pre ? 126 : 132] : [])];
    return Response.json({ chart: { result: [{ meta: { regularMarketTime: regularTime, regularMarketPrice: pre ? 120 : 130, chartPreviousClose: 50, previousClose: 110 }, timestamp,
      indicators: { quote: [{ open: close, high: close, low: close, close, volume: close.map(() => 100) }], adjclose: [{ adjclose: [60, 70, 80] }] } }] } });
  }
  return new Response('unavailable', { status: 503 });
};
