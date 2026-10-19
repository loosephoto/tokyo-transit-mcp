// 同名別駅の分離（幽霊乗換の解消）回帰テスト — v2.58.0
// 実行: node tests/samename-transfer.test.mjs
//
// 背景: 同一駅名の駅が複数路線で使われると、グラフ上で1ノードに統合され、
// 「赤坂でメトロの赤坂へ乗り換える」等の実在しない乗換（幽霊乗換）が生成される。
// 地理的に離れた同名別駅は識別子付き駅名に分離し、AMBIGUOUS_STATION_NAMES で
// 候補提示（disambiguation）する方針を取る。
import { computeRoutes, resolveStation, STATION_TO_LINES } from '../src/handlers/search-route.mjs';
import { RAILWAY_LINES, AMBIGUOUS_STATION_NAMES } from '../src/data/railway-lines.mjs';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('=== 同名別駅（幽霊乗換）回帰テスト ===');

// 1. 分離対象が同一ノードに統合されていないこと
console.log('-- 1. 同一ノード統合の解消 --');
const SEPARATED = [
  { name: '赤坂', id: '赤坂（富士急行線）' },
  { name: '十日市場', id: '十日市場（富士急行線）' },
  { name: '栄町', id: '栄町（千葉モノレール）' },
];
for (const { name, id } of SEPARATED) {
  const lines = (STATION_TO_LINES[name] || []).map(e => e.line);
  const idLines = (STATION_TO_LINES[id] || []).map(e => e.line);
  if (idLines.length === 0) {
    fail(`${id}: グラフに存在しない（路線データが未修正）`);
  } else if (lines.length === 0) {
    fail(`${name}: グラフから消えている`);
  } else {
    ok(`${name} と ${id} は別ノード（${name}: ${lines.join('/')} / ${id}: ${idLines.join('/')}）`);
  }
}

// 2. 同一駅名の入力は候補提示になること（サイレント推測しない）
console.log('-- 2. 同名駅は候補提示（disambiguation）--');
for (const { name, id } of SEPARATED) {
  const res = resolveStation(name);
  if (res.ambiguous && Array.isArray(res.candidates) && res.candidates.includes(id)) {
    ok(`${name}: 候補提示（${res.candidates.join(' / ')}）`);
  } else {
    fail(`${name}: 候補提示にならない (${JSON.stringify(res)})`);
  }
  // AMBIGUOUS_STATION_NAMES にも登録されていること
  if (Array.isArray(AMBIGUOUS_STATION_NAMES[name]) && AMBIGUOUS_STATION_NAMES[name].includes(id)) {
    ok(`${name}: AMBIGUOUS_STATION_NAMES に登録済み`);
  } else {
    fail(`${name}: AMBIGUOUS_STATION_NAMES に未登録`);
  }
}

// 3. 路線名ヒントで一意に解決できること
console.log('-- 3. 路線名ヒントで一意解決 --');
for (const [input, expected] of [
  ['赤坂 富士急行線', '赤坂（富士急行線）'],
  ['赤坂 千代田線', '赤坂'],
  ['十日市場 富士急行線', '十日市場（富士急行線）'],
  ['十日市場 横浜線', '十日市場'],
  ['栄町 モノレール', '栄町（千葉モノレール）'],
  ['栄町 荒川線', '栄町'],
]) {
  const res = resolveStation(input);
  if (res.station === expected && !res.ambiguous) {
    ok(`resolveStation('${input}') = '${expected}'`);
  } else {
    fail(`resolveStation('${input}') = ${JSON.stringify(res)}, expected '${expected}'`);
  }
}

// 4. 幽霊乗換が生成されないこと（同名別駅の候補集合内で同一駅名が連続するパスを作ってはいけない）
console.log('-- 4. 幽霊乗換ルートが生成されない --');
const GHOST_CASES = [
  { from: '富士山', to: '代々木上原', note: '富士急行線赤坂⇔メトロ赤坂' },
  { from: '富士山', to: '横浜', note: '富士急行線十日市場⇔JR横浜線十日市場' },
  { from: '県庁前', to: '荒川区役所前', note: 'モノレール栄町⇔都電栄町' },
];
// 幽霊乗換の危険域は「同名別駅として分離した駅名」。ここでの連続は異常。
// ※「千葉 → 千葉」のような同一駅での正当な路線乗換は対象外（別ノード化されていないため）。
const AMBIGUOUS_KEYS = new Set(Object.keys(AMBIGUOUS_STATION_NAMES));
for (const c of GHOST_CASES) {
  const r = computeRoutes(c.from, c.to);
  if (r.error) {
    // NO_ROUTE / AMBIGUOUS_STATION は「実在しないルートを出さない」正しい挙動
    ok(`${c.from}→${c.to}: ${r.error}（実在しない乗換を含まない）`);
    continue;
  }
  const path = r.routes[0].path;
  const ghost = path.some((p, i) => i > 0 && p === path[i - 1] && AMBIGUOUS_KEYS.has(p));
  if (ghost) {
    fail(`${c.from}→${c.to}: 幽霊乗換（同名別駅の連続）を含む: ${path.join(' → ')}`);
  } else {
    ok(`${c.from}→${c.to}: 幽霊乗換なし（${c.note}）`);
  }
}

// 5. 通常の主要経路が壊れていないこと（回帰）
console.log('-- 5. 主要経路の回帰 --');
for (const [from, to, maxTransfers] of [
  ['新宿', '横浜', 1],
  ['東京', '池袋', 0],
  ['品川', '羽田空港', 2],
  ['池袋', '横浜', 1],
]) {
  const r = computeRoutes(from, to);
  if (r.error) {
    fail(`${from}→${to}: ${r.error}`);
  } else if (r.routes[0].summary.transfers > maxTransfers) {
    fail(`${from}→${to}: 乗換${r.routes[0].summary.transfers}回（期待 ${maxTransfers}回以下）`);
  } else {
    ok(`${from}→${to}: 乗換${r.routes[0].summary.transfers}回 / ${r.routes[0].summary.estimated_minutes}分`);
  }
}

console.log('');
if (failures === 0) {
  console.log('✅ 同名別駅回帰テスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ 同名別駅回帰テスト: ${failures} 件の失敗`);
  process.exit(1);
}
