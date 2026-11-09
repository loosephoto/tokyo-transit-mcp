/**
 * 駅名の読み（かな）を Wikipedia 日本語版から取得して src/data/station-readings.mjs を生成する。
 *
 * 使い方:
 *   node scripts/build-station-readings.mjs
 *
 * やること:
 *   1. RAILWAY_LINES の全ユニーク駅について「◯◯駅」の記事冒頭（intro）を取得
 *   2. 「◯◯駅（読みえき）」の形式から読みを抜き出す（「〜えき」は除く）
 *   3. 読みが1件に決まらない記事（曖昧さ回避ページ等）はスキップする
 *   4. src/data/station-readings.mjs を書き出す
 *
 * ※ 記事の読みは Wikipedia の冒頭文に依存するため、記事の書き換わりで変わる場合がある。
 *    src/data/station-readings.mjs は生成物。手で編集しないこと。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RAILWAY_LINES } from '../src/data/railway-lines.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'src', 'data', 'station-readings.mjs');
const UA = 'tokyo-transit-mcp-dev/1.0 (station reading table; contact: repo maintainer)';

const uniq = [...new Set(Object.values(RAILWAY_LINES).flat())].sort();
const readings = {};
let skipped = 0;
const BATCH = 20;

for (let i = 0; i < uniq.length; i += BATCH) {
  const batch = uniq.slice(i, i + BATCH);
  const titles = batch.map((s) => encodeURIComponent(`${s}駅`)).join('|');
  const url = `https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&format=json&formatversion=2&redirects=1&titles=${titles}`;
  let json = null;
  for (let retry = 0; retry < 5; retry++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) { json = await res.json(); break; }
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 1200 * (retry + 1)));
  }
  if (!json) { console.error(`batch failed at ${i}`); skipped += batch.length; continue; }
  const byTitle = new Map((json.query?.pages || []).map((p) => [p.title, p]));
  for (const st of batch) {
    const extract = (byTitle.get(`${st}駅`)?.extract || '').slice(0, 400);
    const matches = [...extract.matchAll(/[（(]([ぁ-んァ-ヶー]+)(?:えき)?[）)]/g)].map((m) => m[1]);
    if (matches.length === 1) readings[st] = matches[0].replace(/えき$/, '');
    else skipped++;
  }
  if (i % 200 === 0) process.stdout.write(`\r${i + batch.length}/${uniq.length}`);
  await new Promise((r) => setTimeout(r, 150));
}

const lines = [
  '/**',
  ' * 駅名の読み（ひらがな・カタカナ）— かな入力の解決に使う権威読み。',
  ' *',
  ' * 出典: Wikipedia 日本語版の各駅記事の冒頭（「◯◯駅（読みえき）」）。',
  ' * scripts/build-station-readings.mjs で生成する（手で編集しないこと）。',
  ' * 「〜えき」は除いた読みを値に持つ。',
  ' */',
  'export const STATION_READINGS = {',
];
for (const [k, v] of Object.entries(readings).sort((a, b) => a[0].localeCompare(b[0], 'ja'))) {
  lines.push(`  '${k.replace(/'/g, "\\'")}': '${v.replace(/'/g, "\\'")}',`);
}
lines.push('};', '');
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`\nwrite ${OUT}: ${Object.keys(readings).length} 件（スキップ ${skipped} 件）`);
