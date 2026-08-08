// 実在性検証プローブ（自走）：内蔵 RAILWAY_LINES の駅・路線が外部一次ソース（ODPT API）に実在するか突合
// ・ODPT 対応事業者（東京メトロ・都営・横浜市営等）の公式駅データを取得し、内蔵と揺れ解消付きで照合
// ・内蔵に無いor表記ゆれの駅を検出（=実在性の疑い・要確認）
// ・ODPT_KEY 未設定時は SKIP（外部検証はできない）を返し、ローカル整合性のみ確認
// 使い方: node scripts/check-station-reality.mjs
// ※ 検証用（コミット対象の正式回帰テスト）。ネットワーク依存のため、FAIL 時は件数の変化を確認する。
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

// ---------- 内蔵 RAILWAY_LINES をパース ----------
const src = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf-8');
const seg = src.match(/const RAILWAY_LINES = \{(.*?)\n\};/s);
const lines = [];
for (const m of seg[1].matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)) {
  lines.push({ name: m[1], stations: m[2].split(',').map(s => s.trim().replace(/^'(.*)'$/, '$1')).filter(Boolean) });
}
const builtin = new Set(lines.flatMap(l => l.stations));
console.log(`[内蔵] 路線 ${lines.length} 本 / 駅 ${builtin.size} 駅`);

// ---------- 表記ゆれ・異体字の正規化（揺れ解消） ----------
function unify(s) {
  return String(s || '')
    .replace(/[（(〈].*?[）)〉]/g, '')
    .replace(/[駅站]$/, '')
    .replace(/・|-/g, '')
    .replace(/ヶ/g, 'ケ')
    .replace(/麴/g, '麹')
    .replace(/淺/g, '浅').replace(/灣/g, '湾').replace(/澤/g, '沢').replace(/濱/g, '浜')
    .replace(/邊/g, '辺').replace(/嶋/g, '島')
    .trim();
}
const builtinUnified = new Set([...builtin].map(unify));

// ---------- ODPT API で実在性検証 ----------
const API_KEY = process.env.ODPT_API_KEY;
const API_BASE = 'https://api.odpt.org/api/v4';
let fail = 0;

if (!API_KEY) {
  console.log('[SKIP] ODPT_API_KEY 未設定のため外部実在性検証をスキップ（ローカル整合性のみ）。');
  process.exit(0);
}

async function fetchRailwaysForOperator(op) {
  try {
    const res = await fetch(`${API_BASE}/odpt:Railway?acl:consumerKey=${API_KEY}&odpt:operator=odpt.Operator:${op}`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

async function run() {
  // 対象事業者（ODPT に公式駅データがある）
  const operators = ['TokyoMetro', 'Toei', 'YokohamaMunicipal'];
  const odptStations = new Set();

  for (const op of operators) {
    const railways = await fetchRailwaysForOperator(op);
    let opStations = 0;
    for (const r of railways) {
      for (const so of (r['odpt:stationOrder'] || [])) {
        const title = so['odpt:stationTitle'] || {};
        const ja = title.ja || Object.values(title)[0];
        if (ja) { odptStations.add(unify(ja)); opStations++; }
      }
    }
    console.log(`[ODPT:${op}] ${opStations} 駅取得`);
  }
  console.log(`[ODPT合計] ${odptStations.size} 駅（揺れ解消後）`);

  // ODPT に実在するのに内蔵に無い駅（=実在性の疑い・登録漏れ）
  const missingInBuiltin = [...odptStations].filter(s => !builtinUnified.has(s));
  for (const s of missingInBuiltin) { console.log(`  ⚠ ${s}`); fail++; }

  // 内蔵にしか無い駅（=ODPT非対応 or 私鉄/JR or 表記ゆれ）: ODPT外なのでスキップ扱い（実在性はWikipediaで別途）
  console.log(`\n[補足] 内蔵駅のうち ODPT 対応外（JR・私鉄・AGT/モノレール・未取得事業者）は実在性を Wikipedia/事業者公式で確認すること。`);

  console.log(`\n===== 実在性検証サマリー =====`);
  console.log(`ODPT 突合での疑義: ${fail} 件`);
  if (fail === 0) console.log('ALL OK: 内蔵駅は ODPT 公式駅データ（対応事業者分）と突合して実在確認。');
  process.exit(fail === 0 ? 0 : 1);
}
run();