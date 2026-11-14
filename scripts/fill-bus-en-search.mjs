/**
 * バス停名の英語表記を「Wikipedia 検索 → 記事冒頭の振り仮名 → 自前ローマ字化」で補完する。
 *
 * 使い方:
 *   node scripts/fill-bus-en-search.mjs --dry            # 全件を試して結果を表示（書き込みなし）
 *   node scripts/fill-bus-en-search.mjs --limit=40       # 先頭 40 件だけ
 *   node scripts/fill-bus-en-search.mjs                  # 辞書へ追記
 *
 * なぜ検索を使うか:
 *   記事タイトルを推測する方式（fill-bus-en-wiki.mjs）では「清川 → 清川 (台東区)」のような
 *   地名記事に届かず、逆に同名の姓・中世用語の記事を拾って誤読する危険があった。
 *   MediaWiki の検索で候補を出し、**記事タイトルが地名と前方一致し、かつ読みが取れたものだけ**
 *   採用する。取れない名前は日本語のまま（推測で埋めない）。
 */
import fs from 'node:fs';
import { kanaToRomaji, titleCase, simplify } from '../src/lib/kana-romaji.mjs';
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';

const API = 'https://ja.wikipedia.org/w/api.php';
const UA = 'tokyo-transit-mcp-dev/1.0 (bus stop names)';
const OUT = 'src/data/bus-station-display-names.mjs';
const dryRun = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 接尾辞: [日本語, 英語, 中国語]（長い順）
const SUFFIX = [
  ['老人福祉館', ' Elderly Welfare Center', '老人福利馆'],
  ['区民事務所', ' Ward Citizens Office', '区民事务所'],
  ['スポーツセンター', ' Sports Center', '体育中心'],
  ['生涯学習センター', ' Lifelong Learning Center', '终身学习中心'],
  ['地区センター', ' District Center', '地区中心'],
  ['ふれあいセンター', ' Fureai Center', '交流中心'],
  ['総合支所', ' General Branch Office', '综合支所'],
  ['区役所', ' Ward Office', '区政府'],
  ['市役所', ' City Hall', '市政府'],
  ['出張所', ' Branch Office', '办事处'],
  ['記念館', ' Memorial Hall', '纪念馆'],
  ['美術館', ' Museum', '美术馆'],
  ['福祉会館', ' Welfare Hall', '福利会馆'],
  ['公民館', ' Community Center', '公民馆'],
  ['郵便局', ' Post Office', '邮局'],
  ['保健所', ' Health Center', '保健所'],
  ['病院', ' Hospital', '医院'],
  ['小学校', ' Elementary School', '小学'],
  ['中学校', ' Junior High School', '初中'],
  ['高校', ' High School', '高中'],
  ['学園', ' Gakuen', '学园'],
  ['神社', ' Shrine', '神社'],
  ['公園', ' Park', '公园'],
  ['商店街', ' Shopping Street', '商店街'],
  ['市場', ' Market', '市场'],
  ['団地', ' Danchi', '团地'],
  ['会館', ' Hall', '会馆'],
  ['センター', ' Center', '中心'],
  ['通り', ' Dori', '通'],
  ['入口', ' Entrance', '入口'],
  ['駅', ' Station', '站'],
  ['橋', ' Bridge', '桥'],
  ['大門', ' Daimon', '大门'],
  ['坂', ' Saka', '坂'],
  ['前', '-mae', '前'],
];

const NUMS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

async function fetchJson(params, tries = 3) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) { await sleep(1800 * (i + 1)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch { await sleep(1200 * (i + 1)); }
  }
  return null;
}

function splitName(name) {
  const chome = name.match(/^(.+?)([一二三四五六七八九十]{1,3})丁目$/);
  if (chome && NUMS[chome[2]]) return { base: chome[1], kind: 'chome', num: NUMS[chome[2]] };
  for (const [jp, en, zh] of SUFFIX) {
    if (name.length > jp.length && name.endsWith(jp)) {
      return { base: name.slice(0, -jp.length), kind: 'suffix', en, zh, jp };
    }
  }
  return { base: name, kind: 'plain' };
}

/** 記事冒頭の「'''タイトル'''（かな）」から読みを取る（タイトル前方一致のときのみ） */
function readingFor(title, text, base) {
  if (!text) return null;
  const head = text.slice(0, 4000);
  const bare = title.replace(/\s*[（(].*?[）)]\s*$/, '');
  if (!(bare.startsWith(base) || base.startsWith(bare))) return null;
  const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = head.match(new RegExp("'''\\s*" + esc + "\\s*'''\\s*[（(]([ぁ-んァ-ヶー・]{2,}?)(?:ていりゅうじょう|えき)[）)]"));
  return m ? m[1] : null;
}

async function searchTitles(query) {
  const j = await fetchJson({ action: 'query', list: 'search', srsearch: query, srlimit: '3', srnamespace: '0' });
  return (j?.query?.search || []).map((s) => s.title);
}

function collectStops() {
  const names = new Set();
  for (const bus of COMMUNITY_BUS_ROUTES) {
    for (const route of bus.routes || []) for (const s of route.stops || []) if (typeof s === 'string') names.add(s);
    const st = Array.isArray(bus.stations) ? bus.stations : Object.keys(bus.stations || {});
    for (const s of st) if (typeof s === 'string') names.add(s);
  }
  return [...names].filter(Boolean);
}

let stops = collectStops().filter((s) => !BUS_STATION_DISPLAY_NAMES[s]?.en);
if (LIMIT > 0) stops = stops.slice(0, LIMIT);
console.log(`対象: ${stops.length} 件`);

const added = {};
const unresolved = [];
for (const name of stops) {
  const sp = splitName(name);
  const query = sp.base.length >= 2 ? sp.base : name;
  const titles = await searchTitles(query);
  await sleep(1200);
  let reading = null;
  let srcTitle = null;
  for (const t of titles.slice(0, 3)) {
    const j = await fetchJson({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '1', redirects: '1', titles: t });
    await sleep(1000);
    const p = j?.query?.pages?.[0];
    if (!p || p.missing) continue;
    const r = readingFor(p.title, p.extract, sp.base);
    if (r) { reading = r; srcTitle = p.title; break; }
  }
  if (!reading) { unresolved.push(name); console.log(`× ${name}`); continue; }
  const romaji = titleCase(simplify(kanaToRomaji(reading)));
  let en; let zh;
  if (sp.kind === 'chome') { en = `${romaji} ${sp.num}-chome`; zh = `${romaji} ${sp.num}丁目`; }
  else if (sp.kind === 'suffix') { en = `${romaji}${sp.en}`; zh = `${romaji}${sp.zh}`; }
  else { en = romaji; zh = romaji; }
  added[name] = { en, zh };
  console.log(`○ ${name} → ${en}（${srcTitle} / ${reading}）`);
}

console.log(`\n生成 ${Object.keys(added).length} 件 / 未解決 ${unresolved.length} 件`);
if (dryRun) {
  fs.writeFileSync('C:/Users/oresama/AppData/Local/hermes/cache/scratch/bus-search-en.json', JSON.stringify({ added, unresolved }, null, 2), 'utf8');
  process.exit(0);
}

const merged = { ...BUS_STATION_DISPLAY_NAMES, ...added };
const keys = Object.keys(merged).sort((a, b) => a.localeCompare(b, 'ja'));
const body = keys.map((k) => {
  const v = merged[k];
  const parts = [`en: ${JSON.stringify(v.en)}`];
  if (v.zh) parts.push(`zh: ${JSON.stringify(v.zh)}`);
  return `  ${JSON.stringify(k)}: { ${parts.join(', ')} },`;
}).join('\n');
const header = `/**
 * バス停・標柱および主要行先表示名辞書（多言語対応）
 *
 * ⚠️ 生成と手修正が混在。機械生成分は次の 3 本で再生成できる。
 *   node scripts/fill-bus-en.mjs        （駅名・自治体名＋接尾辞）
 *   node scripts/fill-bus-en-wiki.mjs   （記事タイトル推定＋振り仮名）
 *   node scripts/fill-bus-en-search.mjs （Wikipedia 検索＋振り仮名）
 */
export const BUS_STATION_DISPLAY_NAMES = {
`;
fs.writeFileSync(OUT, `${header}${body}\n};\n`, 'utf8');
console.log(`wrote ${OUT}: ${keys.length} 件（+${Object.keys(added).length}）`);
