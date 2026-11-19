// v2.58.32 回帰テスト — 曖昧駅の候補表示ラベル「駅名（路線名）」がそのまま再入力可能であること。
// 実行: node tests/v25832-regression.test.mjs
//
// 背景（路線健全性チェック 2026-11-19 で発見）:
//   search_route は同名別駅（両国・小川町・霞ヶ関ほか7駅）で候補を
//   「両国（JR総武線） / 両国（大江戸線）」のように表示するが、基本名側のラベルは
//   グラフの実キーでないため再入力すると STATION_NOT_FOUND になり、
//   基本名だけ再入力すると再び候補提示に戻る袋小路になっていた（15ラベル中7ラベル）。
//   v2.58.32 は括弧内を路線ヒントとして解決し、表示ラベルをそのまま再入力可能にする。
import { resolveStation, searchRoute } from '../src/index.mjs';
import { AMBIGUOUS_STATION_NAMES, AMBIGUOUS_STATION_LINES } from '../src/data/railway-lines.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (cond, m, extra) => { if (cond) ok(m); else fail(extra ? `${m} — ${extra}` : m); };

console.log('=== v2.58.32: 曖昧駅ラベル再入力（回帰） ===');

// --- 1. 括弧形式の解決 ---
{
  const cases = [
    ['両国（JR総武線）', '両国'],
    ['両国(JR総武線)', '両国'],
    ['両国 JR総武線', '両国'],
    ['両国（大江戸線）', '両国（大江戸線）'],
    ['小川町（都営新宿線）', '小川町'],
    ['霞ケ関（東京メトロ）', '霞ケ関'],
    ['入谷（東京メトロ日比谷線）', '入谷'],
    ['赤坂（東京メトロ千代田線）', '赤坂'],
    ['十日市場（JR横浜線）', '十日市場'],
    ['栄町（都電荒川線）', '栄町']
  ];
  for (const [input, want] of cases) {
    const r = resolveStation(input);
    eq(r.station === want && r.ambiguous === false,
      `resolveStation(${JSON.stringify(input)}) → ${want}`,
      JSON.stringify({ station: r.station, ambiguous: r.ambiguous, candidates: r.candidates }));
  }
}

// --- 2. 従来挙動の不変性 ---
{
  const amb = resolveStation('両国');
  eq(amb.station === null && amb.ambiguous === true && amb.candidates.length === 2,
    '基本名のみの入力は引き続き候補提示（サイレント推測しない）',
    JSON.stringify({ station: amb.station, ambiguous: amb.ambiguous }));
  const plain = resolveStation('渋谷');
  eq(plain.station === '渋谷' && plain.exact === true, '非曖昧駅の直接解決は不変');
  const suffixed = resolveStation('小川町（JR八高線）');
  eq(suffixed.station === '小川町（JR八高線）', '括弧付き実キーは直接解決（路線ヒント経由に変わらない）',
    JSON.stringify(suffixed.station));
}

// --- 3. 全曖昧駅の全候補ラベルが再入力可能（監査で 7/15 が不能だった项の完全解消） ---
{
  let total = 0, enterable = 0;
  const dead = [];
  for (const [name, cands] of Object.entries(AMBIGUOUS_STATION_NAMES)) {
    const lineRefs = AMBIGUOUS_STATION_LINES[name] || [];
    cands.forEach((c, i) => {
      // search-route の candidatesDisp（ja）と同じ規則でラベルを組み立てる
      const label = c.includes('（') ? c : (lineRefs[i] ? `${c}（${lineRefs[i]}）` : c);
      total++;
      const r = resolveStation(label);
      if (r.station) enterable++;
      else dead.push(label);
    });
  }
  eq(total === 15 && enterable === total,
    `全候補ラベル（${total}件）が再入力可能`, `不能: ${dead.join(' / ')}`);
}

// --- 4. search_route のエンドツーエンド: 案内された表記のまま再入力して解決する ---
{
  // 4a. 基本名 → 候補提示（従来どおり ERROR + disambiguation）
  const r1 = await searchRoute({ from: '浅草橋', to: '両国', language: 'ja' });
  const p1 = r1.structuredContent;
  eq(p1.status === 'ERROR' && p1.error_type === 'AMBIGUOUS_STATION', '基本名は候補提示（AMBIGUOUS_STATION）',
    JSON.stringify(p1.error_type));
  eq(Array.isArray(p1.disambiguation && p1.disambiguation.candidates) && p1.disambiguation.candidates.length === 2,
    '候補表示ラベルを2件返す', JSON.stringify(p1.disambiguation && p1.disambiguation.candidates));
  // 4b. 案内された1件目のラベルをそのまま再入力 → 経路が見つかる（袋小路の解消）
  const label = p1.disambiguation.candidates[0];
  const r2 = await searchRoute({ from: '浅草橋', to: label, language: 'ja' });
  const p2 = r2.structuredContent;
  const rt = p2.routes && p2.routes[0];
  eq(p2.status === 'SUCCESS' && rt && rt.summary.transfers === 0 && rt.summary.total_stops === 1,
    `案内ラベル ${JSON.stringify(label)} をそのまま再入力 → 1区間の経路が見つかる`,
    JSON.stringify({ status: p2.status, error_type: p2.error_type }));
  eq(rt && rt.summary.main_line === 'JR総武線各停', '解決先は JR総武線各停の両国',
    JSON.stringify(rt && rt.summary.main_line));
  // 4c. 2件目（大江戸線側）もそのまま再入力可能
  const label2 = p1.disambiguation.candidates[1];
  const r3 = await searchRoute({ from: '浅草橋', to: label2, language: 'ja' });
  eq(r3.structuredContent.status === 'SUCCESS',
    `案内ラベル ${JSON.stringify(label2)} もそのまま再入力可能`,
    JSON.stringify(r3.structuredContent.status));
}

console.log('');
if (failures === 0) {
  console.log('✅ v2.58.32 回帰テスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ v2.58.32 回帰テスト: ${failures} 件の失敗`);
  process.exit(1);
}
