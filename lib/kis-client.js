// Credentials and OAuth tokens stay in the server process.
export function createKisClient({ appKey, appSecret, baseUrl, fetcher, now = Date.now }) {
  let token, tokenUntil = 0, tokenTask, tokenError, tokenRetryAt = 0, approvalKey, approvalUntil = 0, approvalTask;
  async function accessToken() {
    if (token && tokenUntil - 60000 > now()) return token;
    if (tokenError && tokenRetryAt > now()) throw tokenError;
    if (!tokenTask) tokenTask = (async () => {
      const res = await fetcher(`${baseUrl}/oauth2/tokenP`, 6000, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret })
      });
      if (!res.ok) throw new Error(`KIS token HTTP ${res.status}`);
      const json = await res.json();
      if (!json.access_token) throw new Error('KIS 토큰 발급 실패: API 키와 이용 권한을 확인하세요.');
      token = json.access_token; tokenUntil = now() + Number(json.expires_in || 86400) * 1000;
      return token;
    })().catch(error => { tokenError = error; tokenRetryAt = now() + 60000; throw error; }).finally(() => { tokenTask = null; });
    return tokenTask;
  }
  async function approval() {
    // KIS requires an access-token issuance to synchronize paid market-data rights.
    await accessToken();
    if (approvalKey && approvalUntil > now()) return approvalKey;
    if (!approvalTask) approvalTask = (async () => {
      const res = await fetcher(`${baseUrl}/oauth2/Approval`, 6000, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, secretkey: appSecret })
      });
      if (!res.ok) throw new Error(`KIS approval HTTP ${res.status}`);
      const json = await res.json();
      if (!json.approval_key) throw new Error('KIS 실시간 접속키 발급 실패');
      approvalKey = json.approval_key; approvalUntil = now() + 23 * 60 * 60 * 1000;
      return approvalKey;
    })().finally(() => { approvalTask = null; });
    return approvalTask;
  }
  async function request(path, trId, params) {
    const bearer = await accessToken();
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const res = await fetcher(url, 5000, { headers: { authorization: `Bearer ${bearer}`, appkey: appKey, appsecret: appSecret, tr_id: trId, custtype: 'P' } });
    if (!res.ok) throw new Error(`KIS ${trId} HTTP ${res.status}`);
    const json = await res.json();
    if (json.rt_cd && json.rt_cd !== '0') throw new Error(`KIS ${trId} 조회 실패 (${String(json.msg_cd || json.rt_cd).slice(0, 30)}): API 권한과 CME 시세 신청을 확인하세요.`);
    return json;
  }
  return { request, approval };
}
