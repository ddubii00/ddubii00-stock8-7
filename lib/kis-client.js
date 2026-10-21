// Credentials never leave the server; the optional token store survives restarts.
export function createKisClient({ appKey, appSecret, baseUrl, fetcher, tokenStore, now = Date.now }) {
  let token, tokenUntil = 0, tokenTask, tokenError, tokenRetryAt = 0, approvalKey, approvalUntil = 0, approvalTask;
  function safeText(value, length) {
    let text = String(value || '');
    for (const secret of [appKey, appSecret, token, approvalKey].filter(Boolean)) {
      for (const variant of new Set([secret, encodeURIComponent(secret)])) text = text.split(variant).join('[redacted]');
    }
    return text.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]').replace(/\s+/g, ' ').trim().slice(0, length);
  }
  async function responseJson(res, stage) {
    let json;
    try {
      const body = await res.text();
      try { json = JSON.parse(body); }
      catch {
        // KIS sometimes omits the quotes around rt_cd in error responses.
        if (!res.ok && body.length <= 4096 && /^\s*\{\s*rt_cd\s*:/.test(body)) {
          try { json = JSON.parse(body.replace(/^(\s*\{\s*)rt_cd(?=\s*:)/, '$1"rt_cd"')); }
          catch { /* Never expose an unparsed provider response. */ }
        }
      }
    } catch { /* Never return a raw HTML/error body. */ }
    const failed = !res.ok || (json?.rt_cd != null && String(json.rt_cd) !== '0');
    if (failed) {
      const code = safeText(json?.msg_cd || json?.error_code, 40);
      const detail = safeText(json?.msg1 || json?.error_description, 180);
      const hint = /초당|거래건수|요청.*초과|rate.limit|too many/i.test(detail)
        ? ' API 호출 한도를 확인하세요.'
        : /권한|이용신청|미신청|SUB거래소 신청 계좌가 아닙니다|not.subscrib|permission|entitle|NO_RIGHTS|EGW00550/i.test(`${code} ${detail}`)
          ? (/HHDFC|HDFFF/.test(stage) ? ' 해외선물 API 권한과 CME 시세 신청 상태를 확인하세요.' : ' API 사용 권한을 확인하세요.') : '';
      const error = new Error(`KIS ${stage}${res.ok ? '' : ` HTTP ${res.status}`}${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}${hint}`);
      error.kisCode = code; error.kisHttpStatus = res.status;
      throw error;
    }
    if (!json) throw new Error(`KIS ${stage} 응답 형식 오류`);
    return json;
  }
  async function accessToken() {
    if (token && tokenUntil - 60000 > now()) return token;
    if (tokenError && tokenRetryAt > now()) throw tokenError;
    if (!tokenTask) tokenTask = (async () => {
      const saved = await tokenStore?.read().catch(() => null);
      if (saved?.accessToken && saved.expiresAt - 60000 > now()) {
        token = saved.accessToken;
        tokenUntil = saved.expiresAt;
        return token;
      }
      const res = await fetcher(`${baseUrl}/oauth2/tokenP`, 6000, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret })
      });
      const json = await responseJson(res, 'token');
      if (!json.access_token) throw new Error('KIS 토큰 발급 실패: API 키와 이용 권한을 확인하세요.');
      token = json.access_token; tokenUntil = now() + Number(json.expires_in || 86400) * 1000;
      await tokenStore?.write({ accessToken: token, expiresAt: tokenUntil }).catch(() => {});
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
      const json = await responseJson(res, 'approval');
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
    return responseJson(res, trId);
  }
  return { request, approval };
}
