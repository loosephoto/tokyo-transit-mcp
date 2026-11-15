/**
 * バス停の英語表記を **ODPT の BusstopPole（title.en / odpt:kana）** から補完する。
 *
 * 使い方:
 *   node scripts/fill-bus-en-odpt.mjs --dry     # 何件埋まるかだけ表示
 *   node scripts/fill-bus-en-odpt.mjs
 *
 * なぜ ODPT か:
 *   Wikipedia にはコミュニティバス・都営バスの停留所の記事がほとんど無く、あっても
 *   同名の別記事（姓・中世用語）に飛ぶため読みを取り違える（実測）。
 *   ODPT の BusstopPole は **公式の英語名（title.en）と読み（odpt:kana）** を持つ。
 *     例: 二天門 { en: "Nitemmon (Nitemmon Gate)", kana: "にてんもん" }
 */
import fs from 'node:fs';
import { kanaToRomaji, titleCase, simplify } from '../src/lib/kana-romaji.mjs';
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { COMMUNITY_BUS_ROUTES, BUS_OPERATORS } from '../src/data/bus-routes.mjs';

const OUT = 'src/data/bus-station-display-names.mjs';
const API = 'https://api.odpt.org/api/v4';
const dryRun = process.argv.includes('--dry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const KEY = (process.env.ODPT_API_KEY || env.match(/^ODPT_API_KEY=(.+)$/m)?.[1] || '').trim();
if (!KEY) { console.error('ODPT_API_KEY が見つかりません'); process.exit(1); }

async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch { await sleep(1200 * (i + 1)); }
  }
  return null;
}

// ODPT の全バス事業者から停留所（ ja → { en, kana } ）を集める
// リポジトリの BUS_OPERATORS に加えて、ODPT にある他のバス事業者も引く
// （コミュニティバス停留所の一部は京王・西東京・小田急・東急・相鉄の停留所と同名）
const EXTRA_OPERATORS = ['KeioBus', 'NishiTokyoBus', 'OdakyuBus', 'TokyuBus', 'SotetsuBus'];
const operatorIds = [...new Set([...BUS_OPERATORS.map((o) => o.id), ...EXTRA_OPERATORS])];

const odptStops = new Map();
for (const id of operatorIds) {
  const op = { id };
  const url = `${API}/odpt:BusstopPole?acl:consumerKey=${KEY}&odpt:operator=odpt.Operator:${op.id}`;
  const j = await fetchJson(url);
  const arr = Array.isArray(j) ? j : [];
  for (const s of arr) {
    const ja = s['dc:title'] || s.title?.ja;
    if (!ja) continue;
    const en = s.title?.en || null;
    const kana = s['odpt:kana'] || s.title?.['ja-Hrkt'] || null;
    if (!odptStops.has(ja) || (!odptStops.get(ja).en && en)) odptStops.set(ja, { en, kana });
  }
  console.log(`  ${op.id}: ${arr.length} 停留所（累計 ${odptStops.size}）`);
  await sleep(600);
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

const stops = collectStops().filter((s) => !BUS_STATION_DISPLAY_NAMES[s]?.en);
console.log(`ODPT 停留所 ${odptStops.size} 件 / 英語が要る停留所 ${stops.length} 件`);

// odpt:kana からのローマ字は語間が崩れることがあるため、公式表記が分かるものは手で直す
const OVERRIDE = {
  '第四小学校前': { en: 'Daiyon Elementary School-mae' },
  '市立病院入口': { en: 'Shiritsu Hospital Entrance' },
  'キヤノン本社通用門前': { en: 'Canon HQ Main Gate' },
};

const added = {};
const unmatched = [];
for (const name of stops) {
  if (OVERRIDE[name]) { added[name] = OVERRIDE[name]; continue; }
  const hit = odptStops.get(name);
  if (!hit) { unmatched.push(name); continue; }
  let en = hit.en ? String(hit.en).trim() : null;
  // ODPT の英語名は長音記号付き（Ōmon / Kōkō）なので ASCII に正規化する
  if (en) en = en.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (en && /[\u3000-\u9fff]/.test(en)) en = null; // 日本語が混ざる英語名は採用しない
  if (!en && hit.kana) en = titleCase(simplify(kanaToRomaji(hit.kana), { ouAtEndOnly: true }));
  if (!en) { unmatched.push(name); continue; }
  added[name] = { en };
  if (!hit.en) added[name].source = 'kana';
}

console.log(`\nODPT から補完: ${Object.keys(added).length} 件 / 未一致: ${unmatched.length} 件`);
console.log('例:', Object.entries(added).slice(0, 20).map(([k, v]) => `${k}→${v.en}`).join(' | '));
console.log('未一致:', unmatched.slice(0, 20).join(' / '));

if (dryRun) {
  fs.writeFileSync('C:/Users/oresama/AppData/Local/hermes/cache/scratch/bus-odpt-en.json', JSON.stringify({ added, unmatched }, null, 2), 'utf8');
  process.exit(0);
}

const merged = { ...BUS_STATION_DISPLAY_NAMES };
for (const [k, v] of Object.entries(added)) merged[k] = { en: v.en };
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
 * ⚠️ 生成と手修正が混在。機械生成分は次の 4 本で再生成できる。
 *   node scripts/fill-bus-en.mjs        （駅名・自治体名＋接尾辞）
 *   node scripts/fill-bus-en-odpt.mjs   （ODPT BusstopPole の title.en / odpt:kana）
 *   node scripts/fill-bus-en-wiki.mjs   （記事タイトル推定＋振り仮名）
 *   node scripts/fill-bus-en-search.mjs （Wikipedia 検索＋振り仮名）
 */
export const BUS_STATION_DISPLAY_NAMES = {
`;
fs.writeFileSync(OUT, `${header}${body}\n};\n`, 'utf8');
console.log(`wrote ${OUT}: ${keys.length} 件（+${Object.keys(added).length}）`);
