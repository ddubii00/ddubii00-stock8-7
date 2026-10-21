import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKisClient } from '../lib/kis-client.js';
import { createKisTokenStore } from '../lib/kis-token-store.js';

test('KIS access token survives a server restart without another issuance request', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'stock8-kis-token-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baseUrl = 'https://kis.example';
  const tokenStore = createKisTokenStore(directory, baseUrl, 'test-key', 'test-secret');
  let issuance = 0;
  const fetcher = async url => {
    if (String(url).endsWith('/oauth2/tokenP')) {
      issuance++;
      return Response.json({ access_token: 'saved-token', expires_in: 86400 });
    }
    return Response.json({ rt_cd: '0', output1: [] });
  };
  const options = { appKey: 'test-key', appSecret: 'test-secret', baseUrl, fetcher, tokenStore };
  await createKisClient(options).request('/quote', 'TEST', {});
  await createKisClient(options).request('/quote', 'TEST', {});
  assert.equal(issuance, 1);
  assert.equal(await createKisTokenStore(directory, baseUrl, 'other-key', 'test-secret').read(), null);
  const folder = join(directory, '.kis-tokens');
  const [name] = await readdir(folder);
  assert.equal((await stat(folder)).mode & 0o777, 0o700);
  assert.equal((await stat(join(folder, name))).mode & 0o777, 0o600);
});
