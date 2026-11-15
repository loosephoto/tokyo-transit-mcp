/**
 * 未翻訳のバス停を CSV に書き出し / 書き戻す。
 *
 *   node scripts/bus-en-todo.mjs export   # docs/bus-en-todo.csv を生成（ja, en, zh, municipality, bus, official_url）
 *   node scripts/bus-en-todo.mjs import   # CSV の en 列が埋まっている行を取り込む
 *
 * なぜ CSV か:
 *   残りはコミュニティバス独自の停留所で、ODPT にも Wikipedia にも存在しない。
 *   各自治体の公式サイト表記を人が確認するしかないため、作業対象を一覧で出す。
 *   en を書いて import すれば辞書に反映される（空欄の行は触らない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';

const OUT = 'docs/bus-en-todo.csv';
const DATA = 'src/data/bus-station-display-names.mjs';
const mode = process.argv[2] || 'export';

function collect() {
  const rows = new Map();
  for (const bus of COMMUNITY_BUS_ROUTES) {
    const busName = bus.bus || '';
    const muni = bus.municipality || '';
    const url = bus.url || '';
    for (const route of bus.routes || []) {
      for (const stop of route.stops || []) {
        if (typeof stop !== 'string' || !stop) continue;
        if (!rows.has(stop)) rows.set(stop, { municipality: muni, bus: busName, url });
      }
    }
    const st = Array.isArray(bus.stations) ? bus.stations : Object.keys(bus.stations || {});
    for (const s of st) {
      if (typeof s !== 'string' || !s) continue;
      if (!rows.has(s)) rows.set(s, { municipality: muni, bus: busName, url });
    }
  }
  return rows;
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const unesc = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

if (mode === 'export') {
  const rows = collect();
  const missing = [...rows.entries()].filter(([ja]) => !BUS_STATION_DISPLAY_NAMES[ja]?.en);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const header = 'ja,en,zh,municipality,bus,official_url';
  const body = missing.map(([ja, m]) => [ja, '', '', m.municipality, m.bus, m.url].map(esc).join(','));
  fs.writeFileSync(OUT, `${header}\n${body.join('\n')}\n`, 'utf8');
  console.log(`wrote ${OUT}: ${missing.length} 行（en / zh は空欄。公式サイトで確認して記入）`);
  process.exit(0);
}

if (mode === 'import') {
  if (!fs.existsSync(OUT)) { console.error(`${OUT} がありません。先に export してください。`); process.exit(1); }
  const lines = fs.readFileSync(OUT, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = unesc(lines[0]);
  const iJa = header.indexOf('ja'), iEn = header.indexOf('en'), iZh = header.indexOf('zh');
  if (iJa < 0 || iEn < 0) { console.error('CSV のヘッダに ja / en が必要です'); process.exit(1); }
  const added = {};
  for (const line of lines.slice(1)) {
    const cols = unesc(line);
    const ja = (cols[iJa] || '').trim();
    const en = (cols[iEn] || '').trim();
    const zh = (cols[iZh] || '').trim();
    if (!ja || !en) continue;
    if (!/^[\x20-\x7E]+$/.test(en)) { console.error(`ASCII 以外の en: ${ja} = ${en}`); continue; }
    added[ja] = zh ? { en, zh } : { en };
  }
  const n = Object.keys(added).length;
  if (!n) { console.log('取り込む行がありません（en 列が空）'); process.exit(0); }

  const merged = { ...BUS_STATION_DISPLAY_NAMES, ...added };
  const keys = Object.keys(merged).sort((a, b) => a.localeCompare(b, 'ja'));
  const body = keys.map((k) => {
    const v = merged[k];
    const parts = [`en: ${JSON.stringify(v.en)}`];
    if (v.zh) parts.push(`zh: ${JSON.stringify(v.zh)}`);
    return `  ${JSON.stringify(k)}: { ${parts.join(', ')} },`;
  }).join('\n');
  const head = `/**
 * バス停・標柱および主要行先表示名辞書（多言語対応）
 *
 * ⚠️ 生成と手修正が混在。機械生成分は次の 4 本、人手分は docs/bus-en-todo.csv 経由。
 *   node scripts/fill-bus-en.mjs         （駅名・自治体名＋接尾辞）
 *   node scripts/fill-bus-en-odpt.mjs    （ODPT BusstopPole の title.en / odpt:kana）
 *   node scripts/fill-bus-en-search.mjs  （Wikipedia 検索＋振り仮名）
 *   node scripts/fill-bus-en-wiki.mjs    （記事タイトル推定＋振り仮名）
 *   node scripts/bus-en-todo.mjs import  （人が確認した en/zh の取り込み）
 */
export const BUS_STATION_DISPLAY_NAMES = {
`;
  fs.writeFileSync(DATA, `${head}${body}\n};\n`, 'utf8');
  console.log(`wrote ${DATA}: ${keys.length} 件（+${n}）`);
  process.exit(0);
}

console.error('usage: node scripts/bus-en-todo.mjs [export|import]');
process.exit(1);
