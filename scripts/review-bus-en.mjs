// 残りのバス停（110 件）について、候補記事と読みの候補を表示する（人手レビュー用）
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';

const API = 'https://ja.wikipedia.org/w/api.php';
const UA = 'tokyo-transit-mcp-dev/1.0 (review)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const offsetArg = process.argv.find((a) => a.startsWith('--offset='));
const OFFSET = offsetArg ? parseInt(offsetArg.split('=')[1], 10) : 0;
const countArg = process.argv.find((a) => a.startsWith('--count='));
const COUNT = countArg ? parseInt(countArg.split('=')[1], 10) : 25;

const SUFFIX = ['老人福祉館', '区民事務所', 'スポーツセンター', '生涯学習センター', '地区センター', 'ふれあいセンター', '総合支所', '区役所', '市役所', '出張所', '記念館入口', '記念館', '福祉会館', '公民館', '郵便局', '保健所', '病院', '小学校', '中学校', '学園', '神社前', '神社', '公園', '商店街', '市場', '団地', '会館', 'センター', '通り', '入口', '駅', '橋', '前'];

function baseOf(name) {
  const m = name.match(/^(.+?)([一二三四五六七八九十]{1,3})丁目$/);
  if (m) return { base: m[1], kind: 'chome' };
  for (const s of SUFFIX) if (name.length > s.length && name.endsWith(s)) return { base: name.slice(0, -s.length), kind: 'suffix' };
  return { base: name, kind: 'plain' };
}

const muniOf = new Map();
const names = new Set();
for (const bus of COMMUNITY_BUS_ROUTES) {
  for (const r of bus.routes || []) for (const s of r.stops || []) { if (typeof s !== 'string') continue; names.add(s); if (bus.municipality && !muniOf.has(s)) muniOf.set(s, bus.municipality); }
  const st = Array.isArray(bus.stations) ? bus.stations : Object.keys(bus.stations || {});
  for (const s of st) { if (typeof s !== 'string') continue; names.add(s); if (bus.municipality && !muniOf.has(s)) muniOf.set(s, bus.municipality); }
}
const missing = [...names].filter((s) => !BUS_STATION_DISPLAY_NAMES[s]?.en);
const slice = missing.slice(OFFSET, OFFSET + COUNT);
console.log(`残り ${missing.length} 件中 ${OFFSET}〜${OFFSET + slice.length - 1} を確認`);

async function get(title) {
  const url = `${API}?${new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '1', format: 'json', formatversion: '2', redirects: '1', titles: title })}`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    if (!res.ok) return null;
    const j = await res.json();
    const p = j?.query?.pages?.[0];
    if (!p || p.missing) return null;
    return { title: p.title, text: p.extract || '' };
  }
  return null;
}

for (const name of slice) {
  const { base } = baseOf(name);
  const muni = muniOf.get(name);
  const cands = [];
  if (muni) cands.push(`${base} (${muni})`);
  cands.push(base, name);
  const out = [];
  for (const c of cands.slice(0, 3)) {
    const p = await get(c);
    await sleep(1000);
    if (!p) continue;
    const head = p.text.slice(0, 400);
    const m = head.match(/([^\s（(、。]{2,20})\s*[（(]([ぁ-んァ-ヶー・]{2,}?)[）)]/);
    out.push(`${p.title}${m ? ` → ${m[1]}(${m[2]})` : ' (読み不明)'}`);
  }
  console.log(`${name}  [${out.join(' | ') || '記事なし'}]`);
}
