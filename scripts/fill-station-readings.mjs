/**
 * 駅名の読み（かな）の「不足分だけ」を Wikipedia 日本語版から補完する。
 *
 * 使い方:
 *   node scripts/fill-station-readings.mjs [--limit N] [--dry]
 *
 * 背景:
 *   build-station-readings.mjs は毎回全駅を取得してファイルを丸ごと書き換えるため、
 *   Wikipedia 側のレート制限や曖昧さ回避ページの増加で「既存より少ない件数」に置き換わり、
 *   かな入力の解決が退行する（実測: 1,249 件 → 1,109 件）。
 *   このスクリプトは既存の STATION_READINGS を保持したまま、欠落駅だけを足す。
 *
 * 取得の順序:
 *   1. 「◯◯駅」の記事冒頭から読みを抽出（バッチ 10 件）
 *   2. 取れない場合、識別子（括弧・山括弧）を外した名前で再試行
 *   3. それでも取れない場合、Wikipedia 検索で駅記事を探して冒頭から抽出
 *   4. 名前自体がかなだけの駅は、その名前を読みとして採用
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RAILWAY_LINES } from '../src/data/railway-lines.mjs';
import { STATION_READINGS } from '../src/data/station-readings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'src', 'data', 'station-readings.mjs');
const UA = 'tokyo-transit-mcp-dev/1.0 (station reading table; contact: repo maintainer)';
const API = 'https://ja.wikipedia.org/w/api.php';

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();
const DRY = args.includes('--dry');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 識別子（（路線名）・〈別名〉）を外した基本駅名 */
function baseName(st) {
  return String(st).replace(/[（(][^）)]*[）)]/g, '').replace(/[〈<][^〉>]*[〉>]/g, '').trim();
}

/** かなだけの駅名はそのまま読みにできる（カタカナはひらがなへ） */
function kanaOnly(st) {
  const s = String(st).replace(/[・\s]/g, '');
  if (!/^[ぁ-んァ-ヶー]+$/.test(s)) return null;
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 記事冒頭から「（読みえき）」を抽出する
 *  🔴 記事タイトル直後の括弧を最優先する。従来は「候補が 1 つだけ」を条件にしていたため、
 *     大塚駅 (東京都) のように本文に別の読み（大塚駅前停留場）が混ざる記事で拾えなかった。
 *     曖昧さ回避ページはタイトル直後に括弧が来ない（行頭が「◯◯駅 (東京都) （…）」）ので、
 *     この規則でも誤採用しない。
 */
function extractReading(extract, title) {
  if (!extract) return null;
  const head = extract.slice(0, 400);
  if (title) {
    const t = String(title);
    // 曖昧さ回避の記事（「大塚駅 (東京都)」）は本文が「大塚駅（おおつかえき）」で始まるため、
    // 識別子を外した基本名でも前方一致を見る。
    const tBase = t.replace(/\s*[（(][^）)]*[）)]\s*$/, '');
    for (const cand of new Set([t, tBase])) {
      if (!cand || !head.startsWith(cand)) continue;
      const rest = head.slice(cand.length).trimStart();
      const m = rest.match(/^[（(]([ぁ-んァ-ヶー]{2,}?)(?:えき|ていりゅうじょう)?[）)]/);
      if (m) return m[1].replace(/(ていりゅうじょう|えき)$/, '');
    }
  }
  const uniq = [...new Set([...head.matchAll(/[（(]([ぁ-んァ-ヶー]{2,}?)(?:えき|ていりゅうじょう)?[）)]/g)].map((x) => x[1]))];
  return uniq.length === 1 ? uniq[0].replace(/(ていりゅうじょう|えき)$/, '') : null;
}

async function fetchJson(params, { tries = 4 } = {}) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      return null;
    } catch {
      await sleep(1200 * (i + 1));
    }
  }
  return null;
}

/** タイトル配列 → { title: extract }（最大 50 件） */
async function extractsFor(titles) {
  const json = await fetchJson({
    action: 'query', prop: 'extracts', exintro: '1', explaintext: '1',
    // 🔴 exlimit を指定しないと 1 ページ分しか extract が返らない（既定 1）。
    //    これが「まとめて取ったのに大半が未解決」の原因だった。
    exlimit: 'max',
    redirects: '1', titles: titles.join('|'),
  });
  const out = {};
  for (const p of json?.query?.pages || []) out[p.title] = p.extract || '';
  return out;
}

const uniq = [...new Set(Object.values(RAILWAY_LINES).flat())].sort();
const existing = { ...STATION_READINGS };
const missing = uniq.filter((s) => !existing[s]).slice(0, LIMIT);
console.log(`既存 ${Object.keys(existing).length} 件 / 全 ${uniq.length} 駅 / 欠落 ${uniq.filter((s) => !existing[s]).length} 件（今回 ${missing.length} 件を処理）`);

const found = {};
const unresolved = [];

// --- 1 + 2: 「◯◯駅」「基本名駅」の記事冒頭をまとめて取得 ---
// --- 1 + 2: 「◯◯駅」「基本名駅」の記事冒頭をまとめて取得 ---
// Wikimedia のレート制限は「短時間のリクエスト数」で掛かるため、titles は API 上限の 50 件まで
// まとめ、間隔を 2 秒あける（実測: 10 件ずつだと 429 を食らう）。
const TITLES_PER_REQ = 20; // extracts の exlimit=max は 20 件まで
const allTitles = [...new Set(missing.flatMap((s) => [`${s}駅`, `${baseName(s)}駅`]))];
const extractMap = {};
for (let i = 0; i < allTitles.length; i += TITLES_PER_REQ) {
  const chunk = allTitles.slice(i, i + TITLES_PER_REQ);
  const got = await extractsFor(chunk);
  if (!Object.keys(got).length) {
    console.warn(`
  警告: 抽出に失敗（レート制限の可能性）: ${i}-${i + chunk.length}`);
    await sleep(5000);
    continue;
  }
  Object.assign(extractMap, got);
  process.stdout.write(`
  取得 ${Math.min(i + TITLES_PER_REQ, allTitles.length)}/${allTitles.length} タイトル`);
  await sleep(2000);
}
console.log('');
for (const st of missing) {
  const r = extractReading(extractMap[`${st}駅`], `${st}駅`) || extractReading(extractMap[`${baseName(st)}駅`], `${baseName(st)}駅`);
  if (r) found[st] = r; else unresolved.push(st);
}
console.log(`  記事冒頭から判明 ${Object.keys(found).length} 件 / 未解決 ${unresolved.length} 件`);

// --- 2b: 曖昧さ回避ページ対応（--disambig） ---
//   同名駅（三田・大塚・日本橋・大島…）は「◯◯駅」が曖昧さ回避ページで、本文冒頭からは
//   読みを決められない。手順は 3 段:
//     (1) 曖昧さ回避ページの wikitext を prop=revisions でまとめて取得（1 リクエスト 40 件）
//     (2) 各行「[[◯◯駅 (都道府県)|◯◯駅]] … 路線名」から、その駅の路線名（RAILWAY_LINES 由来）が
//         同じ行に現れる候補を選ぶ。曖昧さ回避の行には読みが書かれていないことが多い
//         （例: 「[[大塚駅 (東京都)]] - 東京都豊島区にある…山手線の駅。」）ため、
//     (3) 選んだ候補の記事冒頭だけ extracts でまとめて取り、読みを抽出する。
//   ⚠️ 駅ごとに extracts を叩く方式は 429 で大半が失敗し、prop=links のバッチは
//   pllimit の上限で後方ページがリンク 0 件になった（いずれも実測）。
if (args.includes('--disambig') && unresolved.length) {
  const OPERATORS = /(都営|東京メトロ|京王|小田急|東急|西武|東武|京成|相鉄|名鉄|近鉄|阪急|阪神|京急|東葉|ゆりかもめ|多摩モノレール|みなとみらい|日暮里・舎人)/;
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokensByStation = new Map();
  for (const [line, stations] of Object.entries(RAILWAY_LINES)) {
    const core = String(line).replace(/^JR/, '').replace(/（.*?）/g, '').trim();
    const toks = new Set([core]);
    const op = core.match(OPERATORS);
    if (op) toks.add(core.slice(op[0].length));
    if (core.length > 3) toks.add(core.slice(-3));
    for (const st of stations) {
      if (!tokensByStation.has(st)) tokensByStation.set(st, new Set());
      for (const t of toks) if (t && t.length >= 3) tokensByStation.get(st).add(t);
    }
  }

  const targets = unresolved.slice();
  const titles = [];
  for (const st of targets) {
    const base = baseName(st);
    const cands = [
      `${base}駅`,
      `${base}停留場`,
      `${base.replace(/ヶ/g, 'ケ')}駅`,
      `${base.replace(/ケ/g, 'ヶ')}駅`,
      `${base.replace(/^モノレール/, '')}駅`,
    ];
    for (const t of cands) if (t && !titles.includes(t)) titles.push(t);
  }

  const pageText = new Map();
  for (let k = 0; k < titles.length; k += 40) {
    const chunk = titles.slice(k, k + 40);
    const json = await fetchJson({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: chunk.join('|') });
    for (const pg of json?.query?.pages || []) {
      if (pg.missing) continue;
      const slot = pg.revisions?.[0]?.slots?.main;
      const text = typeof slot === 'string' ? slot : slot?.content || slot?.['*'] || '';
      if (text) pageText.set(pg.title, text);
    }
    await sleep(1200);
  }

  // (2) 曖昧さ回避ページの行から候補（読みが無くても拾う）
  const entries = [];
  for (const [, text] of pageText) {
    for (const line of text.split('\n')) {
      if (!line.includes('駅 (') && !line.includes('駅（')) continue;
      const tm = line.match(/\[\[([^\]|#]+)/);
      if (!tm) continue;
      const rm = line.match(/[（(]([ぁ-んァ-ヶー]{2,}?)(?:えき|ていりゅうじょう)[）)]/);
      entries.push({ title: tm[1].trim(), reading: rm ? rm[1] : null, line });
    }
  }

  // 記事そのものが駅記事（曖昧さ回避でない）場合の冒頭読み
  const introOf = (text, title) => {
    const head = text.slice(0, 1500);
    const base = title.replace(/[（(].*?[）)]\s*$/, '');
    const m = head.match(new RegExp("'''\\s*" + escapeRe(base) + "\\s*'''\\s*[（(]([ぁ-んァ-ヶー]{2,}?)(?:えき|ていりゅうじょう)[）)]"));
    return m ? m[1] : null;
  };

  const pending = new Map(); // station -> candidate title
  let got = 0;
  for (const st of targets) {
    const base = baseName(st);
    // (a) 記事がそのまま駅記事なら冒頭から
    let done = false;
    for (const t of [`${base}駅`, `${base.replace(/ヶ/g, 'ケ')}駅`, `${base}停留場`]) {
      const text = pageText.get(t) || pageText.get(t.replace(/^モノレール/, ''));
      if (!text) continue;
      const r = introOf(text, t);
      if (r) { found[st] = r; got++; done = true; break; }
    }
    if (done) continue;
    // (b) 曖昧さ回避の候補から路線名一致で選ぶ
    const toks = [...(tokensByStation.get(st) || [])];
    let best = null;
    let bestScore = 0;
    for (const e of entries) {
      if (!e.title.startsWith(base)) continue;
      let score = 0;
      for (const t of toks) if (e.line.includes(t)) score += 2;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) continue;
    if (best.reading) { found[st] = best.reading; got++; }
    else pending.set(st, best.title);
  }

  // (3) 候補記事の冒頭だけまとめて取得して読みを確定
  const pendTitles = [...new Set(pending.values())];
  if (pendTitles.length) {
    const exMap = {};
    for (let k = 0; k < pendTitles.length; k += 20) {
      Object.assign(exMap, await extractsFor(pendTitles.slice(k, k + 20)));
      await sleep(1200);
    }
    for (const [st, title] of pending) {
      const r = extractReading(exMap[title] || '', title);
      if (r) { found[st] = r; got++; }
    }
  }
  console.log(`  曖昧さ回避から判明 ${got} 件 / 残り ${unresolved.length - got} 件`);
}

// --- 3: 検索で駅記事を探す ---
if (unresolved.length && args.includes('--search')) {
  console.log(`検索フォールバック: ${unresolved.length} 件`);
  const still = [];
  for (const st of unresolved) {
    const base = baseName(st);
    const s = await fetchJson({ action: 'query', list: 'search', srsearch: `${base}駅`, srlimit: '3' });
    const titles = (s?.query?.search || []).map((x) => x.title).filter((t) => t.includes(base) && !t.includes('曖昧さ回避'));
    let r = null;
    if (titles.length) {
      const map = await extractsFor(titles);
      for (const t of titles) { r = extractReading(map[t]); if (r) break; }
    }
    if (r) found[st] = r; else still.push(st);
    await sleep(350);
  }
  unresolved.length = 0;
  unresolved.push(...still);
  console.log(`  検索で判明 ${Object.keys(found).length - (missing.length - unresolved.length)} 件`);
}

// --- 4: かなだけの駅名 ---
const still2 = [];
for (const st of unresolved) {
  const k = kanaOnly(st);
  if (k) found[st] = k; else still2.push(st);
}

console.log(`判明 ${Object.keys(found).length} 件 / 未解決 ${still2.length} 件`);
if (still2.length) console.log('未解決:', still2.slice(0, 40).join(',') + (still2.length > 40 ? ' …' : ''));

if (DRY) { console.log('--dry のため書き出しません'); process.exit(0); }

// --- 書き出し（既存を保持してマージ） ---
const merged = { ...existing, ...found };
const lines = [
  '/**',
  ' * 駅名の読み（ひらがな・カタカナ）— かな入力の解決に使う権威読み。',
  ' *',
  ' * 出典: Wikipedia 日本語版の各駅記事の冒頭（「◯◯駅（読みえき）」）。',
  ' * scripts/build-station-readings.mjs / scripts/fill-station-readings.mjs で生成する（手で編集しないこと）。',
  ' * 「〜えき」は除いた読みを値に持つ。',
  ' */',
  'export const STATION_READINGS = {',
];
for (const [k, v] of Object.entries(merged).sort((a, b) => a[0].localeCompare(b[0], 'ja'))) {
  lines.push(`  '${k.replace(/'/g, "\\'")}': '${v.replace(/'/g, "\\'")}',`);
}
lines.push('};', '');
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`write ${OUT}: ${Object.keys(merged).length} 件（+${Object.keys(found).length}）`);
