// ディズニーリゾートライン（舞浜リゾートライン）の経路検索テスト（実関数呼び出し）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) {
    console.error('❌ FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('✅ OK:', msg);
  }
}

const { resolveStation, computeRoutes, searchRoute } = mod;

// 1. 駅名解決（全4駅）
const stations = [
  'リゾートゲートウェイ・ステーション',
  '東京ディズニーランド・ステーション',
  'ベイサイド・ステーション',
  '東京ディズニーシー・ステーション'
];

console.log('=== 駅名解決 ===');
for (const s of stations) {
  const resolved = resolveStation(s);
  console.log(`${s}: ${JSON.stringify(resolved)}`);
  assert(resolved !== null && resolved.station === s, `${s} が正常に解決できる`);
}

// 2. 経路計算（内部エンジン）
console.log('\n=== 経路計算（内部エンジン） ===');
for (let i = 0; i < stations.length; i++) {
  for (let j = 0; j < stations.length; j++) {
    if (i === j) continue;
    const from = stations[i];
    const to = stations[j];
    const route = computeRoutes(from, to);
    console.log(`${from} → ${to}: error=${route.error || 'none'}, routes count=${route.routes ? route.routes.length : 0}`);
    assert(!route.error, `${from} → ${to} の経路計算に失敗: ${route.error}`);
    assert(route.routes && route.routes.length > 0, `${from} → ${to} に経路が見つからない`);
  }
}

// 3. 全体 searchRoute（AIアドバイス等を含むフル応答）
console.log('\n=== フル応答（searchRoute） ===');
const testPairs = [
  ['リゾートゲートウェイ・ステーション', '東京ディズニーランド・ステーション'],
  ['東京ディズニーランド・ステーション', 'ベイサイド・ステーション'],
  ['ベイサイド・ステーション', '東京ディズニーシー・ステーション'],
  ['東京ディズニーシー・ステーション', 'リゾートゲートウェイ・ステーション'] // ループ終端（周回）
];

for (const [from, to] of testPairs) {
  console.log(`\n--- ${from} → ${to} ---`);
  const fullJa = await searchRoute({ from, to, language: 'ja' });
  const jaTexts = (fullJa?.content || []).filter(c => c.type === 'text').map(c => c.text);
  const jaJson = jaTexts.find(t => t.trim().startsWith('{')) || jaTexts[0] || '{}';
  let jaData = {};
  try { jaData = JSON.parse(jaJson); } catch (_) {}
  console.log('JA status:', jaData?.status || jaData?.error || '?');
  console.log('JA has routes:', !!(jaData?.routes && jaData.routes.length));
  console.log('JA ai_advice present:', !!(fullJa?.content?.[0]?.text?.includes('AIからのインテリジェントアドバイス')));
  assert(jaData?.status !== 'error', `JA searchRoute がエラー: ${jaData?.error}`);
  assert(jaData?.routes && jaData.routes.length > 0, `JA に経路が見つからない: ${from} → ${to}`);
}

// 4. 舞浜駅との連絡確認（WALK_TRANSFERS）
console.log('\n=== 舞浜駅との連絡確認 ===');
const maihama = resolveStation('舞浜');
const gateway = resolveStation('リゾートゲートウェイ・ステーション');
assert(maihama !== null && maihama?.station !== null, '舞浜駅が解決できる');
assert(gateway !== null && gateway?.station !== null, 'リゾートゲートウェイ・ステーションが解決できる');

const walkRoute = computeRoutes('舞浜', 'リゾートゲートウェイ・ステーション');
console.log('舞浜 → リゾートゲートウェイ・ステーション: error=', walkRoute.error || 'none', ', routes count=', walkRoute.routes ? walkRoute.routes.length : 0);
assert(!walkRoute.error, `舞浜 → リゾートゲートウェイ・ステーション の経路計算に失敗: ${walkRoute.error}`);
assert(walkRoute.routes && walkRoute.routes.length > 0, '舞浜 → リゾートゲートウェイ・ステーション に経路が見つからない');

console.log('\n🎉 すべてのテストがパスしました！');
