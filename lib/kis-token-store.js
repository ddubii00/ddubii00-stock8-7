import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createKisTokenStore(directory, baseUrl, appKey, appSecret) {
  const name = createHash('sha256').update(`${baseUrl}\0${appKey}\0${appSecret}`).digest('hex') + '.json';
  const folder = join(directory, '.kis-tokens');
  const file = join(folder, name);
  return {
    async read() {
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        return typeof saved.accessToken === 'string' && Number.isFinite(saved.expiresAt) ? saved : null;
      } catch { return null; }
    },
    async write(value) {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await chmod(folder, 0o700);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    }
  };
}
