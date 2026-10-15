import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = value => createHash('sha256').update(String(value)).digest();
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const COOKIE = 'stock8_session';
export async function createAuth(directory, password = '1222', now = Date.now) {
  const keyPath = join(directory, 'session-key');
  let secret;
  try { secret = await readFile(keyPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await writeFile(keyPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    secret = await readFile(keyPath, 'utf8');
  }
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('저장된 로그인 키가 올바르지 않습니다.');
  const sign = text => createHmac('sha256', secret).update(text).update(digest(password)).digest('base64url');
  const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
  const attempts = new Map();
  return {
    login(req, supplied) {
      const key = req.socket.remoteAddress || 'unknown';
      const record = attempts.get(key);
      if (record?.until > now() && record.count >= 10) return { status: 429 };
      if (!equal(supplied, password)) {
        if (attempts.size > 10000) for (const [ip, value] of attempts) if (value.until <= now()) attempts.delete(ip);
        const previous = record?.until > now() ? record : { count: 0, until: now() + 60_000 };
        attempts.set(key, { ...previous, count: previous.count + 1 });
        return { status: 401 };
      }
      attempts.delete(key);
      const token = `${Math.floor(now() / 1000) + SESSION_SECONDS}.${randomBytes(16).toString('hex')}`;
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
      return { status: 200, cookie: `${COOKIE}=${token}.${sign(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}` };
    },
    authorized(req) {
      const value = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
      if (value.length > 200) return false;
      const parts = value.split('.');
      if (parts.length !== 3) return false;
      const [expires, nonce, signature] = parts;
      if (!/^\d{10,12}$/.test(expires || '') || !/^[a-f0-9]{32}$/.test(nonce || '') || !signature || Number(expires) <= now() / 1000) return false;
      return equal(signature, sign(`${expires}.${nonce}`));
    }
  };
}
export async function readJsonBody(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('요청 크기가 너무 큽니다.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 형식이 올바르지 않습니다.'), { status: 400 }); }
}
