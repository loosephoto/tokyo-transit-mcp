// 実在性検証プローブ（Wikipedia API）: 内蔵 RAILWAY_LINES の各駅について
// Wikipedia(ja) の駅記事が存在するかを一括確認し、記事が無い駅（=実在性の要確認）を検出。
// ※ Wikipedia 記事が無い = 必ずしも駅が存在しない、ではない（記事未作成の駅もある）。
//   検出結果は「要確認」として、事業者公式サイト等で最終確認する。
// 使い方: node scripts/check-station-wikipedia.mjs
import fs from 'fs';

// 内蔵 RAILWAY_LINES をパース
const src = fs.readFileSync(new URL('../src/data/railway-lines.mjs', import.meta.url), 'utf-8');
const seg = src.match(/export const RAILWAY_LINES = \{(.*?)\n\};/s);
const lines = [];
for (const m of seg[1].matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)) {
  lines.push({ name: m[1], stations: m[2].split(',').map(s => s.trim().replace(/^'(.*)'$/, '$1')).filter(Boolean) });
}
const stToLines = {};
for (const l of lines) for (const s of l.stations) { (stToLines[s] = stToLines[s] || []).push(l.name); }
const stations = Object.keys(stToLines);
console.log(`[内蔵] 駅 ${stations.length} 駅`);

const API = 'https://ja.wikipedia.org/w/api.php';

// 1バッチ50タイトル、title（既定=駅名+駅）の記事存在を確認（失敗バッチは単一リトライ）
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function batchExistence(titles) {
  const result = {};
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const url = `${API}?action=query&format=json&redirects=1&titles=${encodeURIComponent(chunk.join('|'))}`;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'audit/2.35.0' }, signal: AbortSignal.timeout(15000) });
        const data = await res.json();
        const pages = data?.query?.pages ?? {};
        if (Object.keys(pages).length) {
          for (const id in pages) {
            const p = pages[id];
            result[p.title] = !('missing' in p);
          }
          ok = true;
        }
      } catch (e) { /* リトライ */ }
      if (!ok) await sleep(1000 * (attempt + 1));
    }
    if (!ok) {
      // バッチ全体が失敗: 単一リトライで確実に結果を得る
      for (const t of chunk) {
        try {
          const u = `${API}?action=query&format=json&redirects=1&titles=${encodeURIComponent(t)}`;
          const r = await fetch(u, { headers: { 'User-Agent': 'audit/2.35.0' }, signal: AbortSignal.timeout(10000) });
          const d = await r.json();
          for (const id in (d?.query?.pages ?? {})) result[d.query.pages[id].title] = !('missing' in d.query.pages[id]);
        } catch (e) {}
        await sleep(300);
      }
    }
    await sleep(500); // レート制限対策
  }
  return result;
}

async function run() {
  const fullTitles = stations.map(s => `${s}駅`);
  const full = await batchExistence(fullTitles);

  const missing = [];
  for (let i = 0; i < stations.length; i++) {
    if (!full[`${stations[i]}駅`]) missing.push(stations[i]);
  }

  console.log(`\n===== Wikipedia(ja)「${missing.length ? '（駅名）駅' : ''}」記事が無い駅（実在性の要確認） =====`);
  for (const s of missing) {
    console.log(`  ⚠ ${s} [${(stToLines[s] || []).join('/')}]`);
  }
  console.log(`\n※ 記事が「駅」外のタイトル形式（例：英文・曖昧名）の実在駅も含まれ得る。グレーリストとして事業者公式で最終確認。`);
}
run();