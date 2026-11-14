/**
 * コミュニティバス停留所の en/zh 表記を「駅名辞書から決定論的に」補完する。
 *
 * 使い方:
 *   node scripts/fill-bus-en.mjs            # 欠落分を追記して書き込む
 *   node scripts/fill-bus-en.mjs --dry      # 何件増えるかだけ表示
 *
 * 方針（重要）:
 *   停留所名の多くは「◯◯駅前」「◯◯駅北口」のように駅名＋接尾辞でできている。
 *   駅名の英語表記は STATION_DISPLAY_NAMES（人手で整備済み）にあるため、
 *   そこから機械的に作れる分だけを補完する。読みの推定が必要な名前
 *   （「芝浦四丁目」「三ノ輪二丁目」など）は**機械翻訳しない**。
 *   実測で pykakasi は「堀ノ内→Hori no Nai」「三ノ輪→San no wa」「イオンモール→Ionmooru」
 *   のような誤読を出し、LLM も「柴崎町→Kibazaki」「町田→Matsuda」と外したため、
 *   誤った英語を出すより日本語のまま出す方がましと判断した。
 */
import fs from 'node:fs';
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { STATION_DISPLAY_NAMES } from '../src/data/station-names.mjs';
import { COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';
import { MUNICIPALITY_DISPLAY_NAMES } from '../src/data/municipality-names.mjs';

const OUT = 'src/data/bus-station-display-names.mjs';
const dryRun = process.argv.includes('--dry');

// 長い接尾辞から順に判定する（「駅北口」を「駅」で食わないため）
const RULES = [
  ['駅北口', ' Station North Exit', '站北口'],
  ['駅南口', ' Station South Exit', '站南口'],
  ['駅東口', ' Station East Exit', '站东口'],
  ['駅西口', ' Station West Exit', '站西口'],
  ['駅入口', ' Station Entrance', '站入口'],
  ['駅前', ' Station', '站前'],
  ['駅通り', ' Station Dori', '站通'],
  ['駅上', ' Station Kami', '站上'],
  ['駅下', ' Station Shita', '站下'],
  ['駅北', ' Station North', '站北'],
  ['駅南', ' Station South', '站南'],
  ['駅東', ' Station East', '站东'],
  ['駅西', ' Station West', '站西'],
  ['駅', ' Station', '站'],
];

function collectStops() {
  const names = new Set();
  for (const bus of COMMUNITY_BUS_ROUTES) {
    for (const route of bus.routes || []) {
      for (const stop of route.stops || []) if (typeof stop === 'string') names.add(stop);
    }
    const stations = Array.isArray(bus.stations) ? bus.stations : Object.keys(bus.stations || {});
    for (const s of stations) if (typeof s === 'string') names.add(s);
  }
  return [...names].filter(Boolean);
}

// 自治体名＋役所（港区役所前 / 立川市役所 など）は自治体辞書から決定論的に作れる。
//   MUNICIPALITY_DISPLAY_NAMES は「港区→Minato City」「立川市→Tachikawa City」を持つ。
const MUNI_RULES = [
  [/^(.+区)役所前$/, 'ward', true],
  [/^(.+区)役所$/, 'ward', false],
  [/^(.+市)役所前$/, 'city', true],
  [/^(.+市)役所$/, 'city', false],
];

function deriveMunicipality(name) {
  for (const [re, kind, mae] of MUNI_RULES) {
    const m = name.match(re);
    if (!m) continue;
    const mun = MUNICIPALITY_DISPLAY_NAMES[m[1]];
    if (!mun?.en) continue;
    // 「Minato City」→「Minato」+「Ward Office」、「Tachikawa City」→「Tachikawa City Hall」
    const stem = mun.en.replace(/ City$/, '');
    const label = kind === 'ward' ? 'Ward Office' : 'City Hall';
    const en = kind === 'ward' ? `${stem} ${label}${mae ? '-mae' : ''}` : `${stem} ${label}${mae ? '-mae' : ''}`;
    const zh = kind === 'ward' ? `${m[1]}役所${mae ? '前' : ''}` : `${m[1]}政府${mae ? '前' : ''}`;
    return { en, zh };
  }
  return null;
}

function derive(name) {
  if (BUS_STATION_DISPLAY_NAMES[name]?.en) return null;
  const muni = deriveMunicipality(name);
  if (muni) return muni;
  const bare = name.replace(/^JR/, '');
  // 「田町」「三田」のように停留所名がそのまま駅名のこともある
  if (STATION_DISPLAY_NAMES[bare]?.en) {
    const st = STATION_DISPLAY_NAMES[bare];
    return st.zh ? { en: st.en, zh: st.zh } : { en: st.en };
  }
  for (const [jp, enSuffix, zhSuffix] of RULES) {
    if (!bare.endsWith(jp)) continue;
    const base = bare.slice(0, -jp.length);
    const station = STATION_DISPLAY_NAMES[base] || STATION_DISPLAY_NAMES[base.replace(/駅$/, '')];
    if (!station?.en) continue;
    const entry = { en: `${station.en}${enSuffix}` };
    if (station.zh) entry.zh = `${station.zh}${zhSuffix}`;
    return entry;
  }
  return null;
}

const stops = collectStops();
const added = {};
for (const stop of stops) {
  const entry = derive(stop);
  if (entry) added[stop] = entry;
}
const missing = stops.filter((s) => !BUS_STATION_DISPLAY_NAMES[s]?.en && !added[s]);

console.log(`停留所 ${stops.length} 件 / 既存 ${stops.length - missing.length - Object.keys(added).length} 件 / 追加 ${Object.keys(added).length} 件 / 残り ${missing.length} 件`);
if (Object.keys(added).length) {
  const sample = Object.entries(added).slice(0, 12).map(([k, v]) => `${k}→${v.en}`).join(' | ');
  console.log('追加例:', sample);
}
if (dryRun) process.exit(0);

const merged = { ...BUS_STATION_DISPLAY_NAMES, ...added };
const keys = Object.keys(merged).sort((a, b) => a.localeCompare(b, 'ja'));
const body = keys
  .map((k) => {
    const v = merged[k];
    const parts = [`en: ${JSON.stringify(v.en)}`];
    if (v.zh) parts.push(`zh: ${JSON.stringify(v.zh)}`);
    return `  ${JSON.stringify(k)}: { ${parts.join(', ')} },`;
  })
  .join('\n');

const header = `/**
 * バス停・標柱および主要行先表示名辞書（多言語対応）
 * 標柱時刻表（odpt:BusstopPoleTimetable）およびバス路線案内で出現する
 * バス停留所・行先名の en/zh 表記。
 *
 * ⚠️ 生成と手修正が混在している。駅名由来の機械生成分は
 *    node scripts/fill-bus-en.mjs で再生成できる（既存は保持）。
 */
export const BUS_STATION_DISPLAY_NAMES = {
`;

fs.writeFileSync(OUT, `${header}${body}\n};\n`, 'utf8');
console.log(`wrote ${OUT}: ${keys.length} 件（+${Object.keys(added).length}）`);
