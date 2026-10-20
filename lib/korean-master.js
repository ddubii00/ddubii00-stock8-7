import { readKisMasterZip } from './kis-master.js';

export function parseKoreanMaster(text, market) {
  // Official KIS Python layouts count decoded CP949 characters, including LF.
  const tail = market === 'kospi' ? 228 : 222;
  const suffix = market === 'kospi' ? '.KS' : '.KQ';
  return text.split(/\r?\n/).flatMap(line => {
    const code = line.slice(0, 9).trim();
    const name = (line + '\n').slice(21, -tail).trim();
    return /^[0-9][A-Z0-9]{5}$/.test(code) && name ? [{symbol:code + suffix, name}] : [];
  });
}

export async function fetchKoreanMasterSymbols(fetcher) {
  const groups = await Promise.all(['kospi', 'kosdaq'].map(async market => {
    const file = `${market}_code.mst`;
    const response = await fetcher(`https://new.real.download.dws.co.kr/common/master/${file}.zip`, 4500);
    if (!response.ok) throw new Error('Korean master unavailable');
    const rows = parseKoreanMaster(readKisMasterZip(await response.arrayBuffer(), file), market);
    if (!rows.length) throw new Error('Empty Korean master');
    return rows;
  }));
  return groups.flat();
}
