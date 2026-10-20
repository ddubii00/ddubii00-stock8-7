import { inflateRawSync } from 'node:zlib';

// Read the official master in memory; never extract archive paths to disk.
export function readKisMasterZip(input, expectedName) {
  const zip = Buffer.from(input);
  let end = zip.length - 22;
  for (; end >= Math.max(0, zip.length - 65557); end--) if (zip.readUInt32LE(end) === 0x06054b50) break;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw new Error('KIS 종목파일 형식 오류');
  let pos = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let i = 0; i < count && pos + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) break;
    const size = zip.readUInt32LE(pos + 20), expanded = zip.readUInt32LE(pos + 24);
    const nameLength = zip.readUInt16LE(pos + 28), extra = zip.readUInt16LE(pos + 30), comment = zip.readUInt16LE(pos + 32);
    const name = zip.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    if (name === expectedName) {
      if (expanded > 10_000_000) throw new Error('KIS 종목파일 크기 오류');
      const offset = zip.readUInt32LE(pos + 42);
      if (offset + 30 > zip.length || zip.readUInt32LE(offset) !== 0x04034b50) break;
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      if (start + size > zip.length) break;
      const data = zip.subarray(start, start + size);
      const method = zip.readUInt16LE(pos + 10);
      const raw = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 10_000_000 }) : null;
      if (!raw || raw.length !== expanded) break;
      return new TextDecoder('euc-kr').decode(raw);
    }
    pos += 46 + nameLength + extra + comment;
  }
  throw new Error('KIS 종목파일을 읽지 못했습니다.');
}

