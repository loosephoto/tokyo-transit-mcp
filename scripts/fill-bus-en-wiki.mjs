/**
 * バス停名の残り（読みの推定が要るもの）を、Wikipedia 日本語版の記事冒頭の振り仮名から
 * 読みを取り、自前のかな→ローマ字変換で英語表記を作る。
 *
 * 使い方:
 *   node scripts/fill-bus-en-wiki.mjs --dry     # 差分確認のみ
 *   node scripts/fill-bus-en-wiki.mjs           # 辞書へ追記
 *
 * 方針（実測に基づく）:
 *   読み（かな）は Wikipedia の記事冒頭「'''◯◯'''（かな）は…」から取る。
 *   ローマ字化は src/lib/kana-romaji.mjs（駅読み 1,449 件 × 駅名英字表記で 94.1% 一致）。
 *   接尾辞（駅・公園・区役所…）は**かなの末尾で切り分けて**英訳を付けるので、
 *   「隅田公園→Sumida Park」「府中競馬正門前駅→Fuchu Keiba Seimon-mae Station」のように出る。
 *   読みが取れない名前は**日本語のまま**にする（推測で埋めない）。
 */
import fs from 'node:fs';
import { kanaToRomaji, titleCase, simplify } from '../src/lib/kana-romaji.mjs';
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';

const API = 'https://ja.wikipedia.org/w/api.php';
const UA = 'tokyo-transit-mcp-dev/1.0 (bus stop reading enrichment)';
const dryRun = process.argv.includes('--dry');
const OUT = 'src/data/bus-station-display-names.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 接尾辞: [日本語, かな, 英語, 中国語]（かなで切り分けるので誤爆しない）
const SUFFIX = [
  ['駅北口', 'えききたぐち', ' Station North Exit', '站北口'],
  ['駅南口', 'えきみなみぐち', ' Station South Exit', '站南口'],
  ['駅東口', 'えきひがしぐち', ' Station East Exit', '站东口'],
  ['駅西口', 'えきにしぐち', ' Station West Exit', '站西口'],
  ['駅入口', 'えきいりぐち', ' Station Entrance', '站入口'],
  ['駅前', 'えきまえ', ' Station', '站前'],
  ['駅', 'えき', ' Station', '站'],
  ['市役所前', 'しやくしまえ', ' City Hall-mae', '市政府前'],
  ['市役所', 'しやくしょ', ' City Hall', '市政府'],
  ['区役所前', 'くやくしまえ', ' Ward Office-mae', '区政府前'],
  ['区役所', 'くやくしょ', ' Ward Office', '区政府'],
  ['小学校前', 'しょうがっこうまえ', ' Elementary School-mae', '小学前'],
  ['小学校', 'しょうがっこう', ' Elementary School', '小学'],
  ['中学校前', 'ちゅうがっこうまえ', ' Junior High School-mae', '初中前'],
  ['中学校', 'ちゅうがっこう', ' Junior High School', '初中'],
  ['病院前', 'びょういんまえ', ' Hospital-mae', '医院前'],
  ['病院', 'びょういん', ' Hospital', '医院'],
  ['神社前', 'じんじゃまえ', ' Shrine-mae', '神社前'],
  ['神社', 'じんじゃ', ' Shrine', '神社'],
  ['公園前', 'こうえんまえ', ' Park-mae', '公园前'],
  ['公園', 'こうえん', ' Park', '公园'],
  ['記念館入口', 'きねんかんいりぐち', ' Memorial Hall Entrance', '纪念馆入口'],
  ['記念館', 'きねんかん', ' Memorial Hall', '纪念馆'],
  ['商店街', 'しょうてんがい', ' Shopping Street', '商店街'],
  ['センター前', 'せんたーまえ', ' Center-mae', '中心前'],
  ['センター', 'せんたー', ' Center', '中心'],
  ['老人福祉館', 'ろうじんふくしかん', ' Elderly Welfare Center', '老人福利馆'],
  ['団地', 'だんち', ' Danchi', '团地'],
  ['通り', 'どおり', ' Dori', '通'],
  ['入口', 'いりぐち', ' Entrance', '入口'],
  ['橋', 'ばし', ' Bridge', '桥'],
  ['警察署前', 'けいさつしょまえ', ' Police Station-mae', '警察署前'],
  ['警察署', 'けいさつしょ', ' Police Station', '警察署'],
  ['郵便局前', 'ゆうびんきょくまえ', ' Post Office-mae', '邮局前'],
  ['郵便局', 'ゆうびんきょく', ' Post Office', '邮局'],
  ['消防署', 'しょうぼうしょ', ' Fire Station', '消防署'],
  ['保健所', 'ほけんじょ', ' Health Center', '保健所'],
  ['福祉会館', 'ふくしかいかん', ' Welfare Hall', '福利会馆'],
  ['区民事務所', 'くみんじむしょ', ' Ward Citizens Office', '区民事务所'],
  ['スポーツセンター前', 'すぽーつせんたーまえ', ' Sports Center-mae', '体育中心前'],
  ['スポーツセンター', 'すぽーつせんたー', ' Sports Center', '体育中心'],
  ['陸橋', 'りっきょう', ' Overpass', '天桥'],
  ['美術館', 'びじゅつかん', ' Museum', '美术馆'],
  ['団地中央', 'だんちちゅうおう', ' Danchi Chuo', '团地中央'],
  ['前', 'まえ', '-mae', '前'],
];

// 個別の読み・表記が定型化できないものだけ手で持つ（根拠は駅名辞書と同じ運用）
const OVERRIDE = {
  '府中競馬正門前駅': { en: 'Fuchu Keiba Seimon-mae Station', zh: '府中赛马正门前站' },
  '三鷹の森ジブリ美術館': { en: 'Mitaka no Mori Ghibli Museum', zh: '三鹰之森吉卜力美术馆' },
};

const NUMS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

async function fetchJson(params, tries = 4) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1200 * (i + 1)); }
  }
  return null;
}

function chomeOf(name) {
  const m = name.match(/^(.+?)([一二三四五六七八九十]{1,3})丁目$/);
  if (!m) return null;
  const num = NUMS[m[2]];
  if (!num) return null;
  return { base: m[1], num };
}

function stripSuffix(name) {
  for (const [jp, kana, en, zh] of SUFFIX) {
    if (name.length > jp.length && name.endsWith(jp)) {
      return { base: name.slice(0, -jp.length), kana, en, zh };
    }
  }
  return null;
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

function kanaOf(title, text) {
  if (!text) return null;
  const head = text.slice(0, 300);
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = head.match(new RegExp('^\\s*' + esc + '\\s*[（(]([ぁ-んァ-ヶー]{2,})[）)]'));
  return m ? m[1] : null;
}

const stops = collectStops().filter((s) => !BUS_STATION_DISPLAY_NAMES[s]?.en);
console.log(`読みが要る停留所: ${stops.length} 件`);

const titles = [];
for (const name of stops) {
  const chome = chomeOf(name);
  const sp = stripSuffix(name);
  for (const t of [chome?.base, sp?.base, name]) if (t && !titles.includes(t)) titles.push(t);
}

const extracts = new Map();
for (let i = 0; i < titles.length; i += 20) {
  const chunk = titles.slice(i, i + 20);
  const json = await fetchJson({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: 'max', redirects: '1', titles: chunk.join('|') });
  for (const p of json?.query?.pages || []) {
    if (p.missing || !p.extract) continue;
    extracts.set(p.title, p.extract);
  }
  await sleep(1200);
}
console.log(`記事冒頭: ${extracts.size} ページ / タイトル候補 ${titles.length}`);

const romajiOf = (kana) => titleCase(simplify(kanaToRomaji(kana)));

const added = {};
const unresolved = [];
for (const name of stops) {
  const chome = chomeOf(name);
  const sp = stripSuffix(name);
  if (OVERRIDE[name]) { added[name] = OVERRIDE[name]; continue; }
  let hit = null;

  if (chome) {
    const kana = kanaOf(chome.base, extracts.get(chome.base));
    if (kana) hit = { en: `${romajiOf(kana)} ${chome.num}-chome`, zh: `${romajiOf(kana)} ${chome.num}丁目` };
  } else if (sp) {
    const full = kanaOf(name, extracts.get(name));
    if (full && full.endsWith(sp.kana) && full.length > sp.kana.length) {
      const baseKana = full.slice(0, -sp.kana.length);
      hit = { en: `${romajiOf(baseKana)}${sp.en}`, zh: `${romajiOf(baseKana)}${sp.zh}` };
    } else {
      const baseKana = kanaOf(sp.base, extracts.get(sp.base));
      if (baseKana) hit = { en: `${romajiOf(baseKana)}${sp.en}`, zh: `${romajiOf(baseKana)}${sp.zh}` };
    }
  } else {
    const kana = kanaOf(name, extracts.get(name));
    if (kana) hit = { en: romajiOf(kana), zh: romajiOf(kana) };
  }

  if (hit && /^[\x20-\x7E]+$/.test(hit.en)) added[name] = hit;
  else unresolved.push(name);
}

console.log(`読みから生成: ${Object.keys(added).length} 件 / 未解決: ${unresolved.length} 件`);
console.log('例:', Object.entries(added).slice(0, 18).map(([k, v]) => `${k}→${v.en}`).join(' | '));
console.log('未解決:', unresolved.slice(0, 20).join(' / '));

if (dryRun) {
  fs.writeFileSync('C:/Users/oresama/AppData/Local/hermes/cache/scratch/bus-wiki-en.json', JSON.stringify({ added, unresolved }, null, 0), 'utf8');
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
 * 標柱時刻表（odpt:BusstopPoleTimetable）およびバス路線案内で出現する
 * バス停留所・行先名の en/zh 表記。
 *
 * ⚠️ 生成と手修正が混在している。機械生成分は
 *    node scripts/fill-bus-en.mjs（駅名＋接尾辞）と
 *    node scripts/fill-bus-en-wiki.mjs（Wikipedia の振り仮名＋かな→ローマ字）で再生成できる。
 */
export const BUS_STATION_DISPLAY_NAMES = {
`;
fs.writeFileSync(OUT, `${header}${body}\n};\n`, 'utf8');
console.log(`wrote ${OUT}: ${keys.length} 件（+${Object.keys(added).length}）`);
