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
  if (url.hostname !== 'openapi.koreainvestment.com') throw new Error('Unexpected non-KIS source ' + url.hostname);
  if (url.pathname.endsWith('tokenP')) return Response.json({ access_token: 'fixture-token', expires_in: 86400 });
  if (url.pathname.endsWith('Approval')) return Response.json({ approval_key: 'fixture-approval' });
  if (url.searchParams.get('SRS_CD') === 'NQH27') return Response.json({ rt_cd: '1', msg_cd: 'NO_RIGHTS', msg1: 'not subscribed' });
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
