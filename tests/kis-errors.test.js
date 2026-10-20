import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKisClient } from '../lib/kis-client.js';

test('KIS errors retain safe HTTP/body diagnostics and redact credentials, encoded secrets and bearer tokens', async () => {
  const client = createKisClient({ appKey:'private-key', appSecret:'private/secret', baseUrl:'https://kis.example',
    fetcher:async url => String(url).endsWith('tokenP') ? Response.json({access_token:'private-token', expires_in:86400})
      : Response.json({rt_cd:'1',msg_cd:'TEST_ERROR',msg1:'request failed private-key private/secret private%2Fsecret private-token Bearer unknown-token'}, {status:500}) });
  await assert.rejects(client.request('/quote','HHDFC55010000',{}), error => {
    assert.match(error.message,/HHDFC55010000 HTTP 500.*TEST_ERROR.*request failed/);
    assert.doesNotMatch(error.message,/private-key|private\/secret|private%2Fsecret|private-token|unknown-token/);
    return true;
  });
});

test('token failures retain KIS response codes without returning raw non-JSON bodies', async () => {
  const client = createKisClient({ appKey:'private-key', appSecret:'private-secret', baseUrl:'https://kis.example',
    fetcher:async () => Response.json({error_code:'TOKEN_ERROR',error_description:'토큰 발급 실패 private-key private-secret'}, {status:500}) });
  await assert.rejects(client.request('/quote','TEST',{}), error => {
    assert.match(error.message,/token HTTP 500.*TOKEN_ERROR.*토큰/);
    assert.doesNotMatch(error.message,/private-key|private-secret/);return true;
  });
  const html = createKisClient({ appKey:'private-key', appSecret:'private-secret', baseUrl:'https://kis.example',
    fetcher:async () => new Response('<html>private-key private-secret</html>',{status:502}) });
  await assert.rejects(html.request('/quote','TEST',{}), error => {
    assert.match(error.message,/token HTTP 502/);assert.doesNotMatch(error.message,/html|private/);return true;
  });
});
