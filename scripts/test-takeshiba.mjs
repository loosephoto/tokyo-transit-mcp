// 竹芝駅周辺チェック（直接関数テスト）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ OK:', msg);
}

const { resolveStation, computeRoutes } = mod;

console.log('=== 1. 駅名解決 ===');
const takeshiba = resolveStation('竹芝');
console.log('竹芝:', JSON.stringify(takeshiba));
assert(takeshiba.station === '竹芝', '竹芝駅が解決できる');

const pier = resolveStation('竹芝桟橋');
console.log('竹芝桟橋:', JSON.stringify(pier));
assert(pier.station === '竹芝' && pier.landmark === '竹芝桟橋', '竹芝桟橋がランドマーク経由で竹芝駅に解決される');

const tokyoPier = resolveStation('東京・竹芝');
console.log('東京・竹芝:', JSON.stringify(tokyoPier));
assert(tokyoPier.station === '竹芝', '東京・竹芝が竹芝駅に解決される');

const pierEn = resolveStation('Takeshiba Pier');
console.log('Takeshiba Pier:', JSON.stringify(pierEn));
assert(pierEn.station === '竹芝', 'Takeshiba Pier（英字）が竹芝駅に解決される');

const pierZh = resolveStation('竹芝码头');
console.log('竹芝码头:', JSON.stringify(pierZh));
assert(pierZh.station === '竹芝', '竹芝码头（中国語）が竹芝駅に解決される');

console.log('\n=== 2. 経路計算 ===');
// 新橋 → 竹芝桟橋（ゆりかもめで竹芝駅まで）
const r1 = computeRoutes('新橋', '竹芝桟橋');
console.log('新橋→竹芝桟橋:', JSON.stringify(r1));
assert(!r1.error, '新橋→竹芝桟橋 の経路計算に失敗しない');
assert(r1.routes && r1.routes.length > 0, '新橋→竹芝桟橋 に経路がある');

// 竹芝 → 竹芝桟橋（同一駅・徒歩案内）
const r2 = computeRoutes('竹芝', '竹芝桟橋');
console.log('竹芝→竹芝桟橋:', JSON.stringify(r2));
assert(!r2.error, '竹芝→竹芝桟橋 の経路計算に失敗しない');
assert(r2.toLandmark === '竹芝桟橋', '竹芝→竹芝桟橋 にランドマーク情報が付く');

// 東京 → 東京・竹芝（都心からフェリーポートへ）
const r3 = computeRoutes('東京', '東京・竹芝');
console.log('東京→東京・竹芝:', JSON.stringify(r3));
assert(!r3.error, '東京→東京・竹芝 の経路計算に失敗しない');
assert(r3.routes && r3.routes.length > 0, '東京→東京・竹芝 に経路がある');

console.log('\n=== 3. フェリー検索（港名解決は従来どおり search_ferry で動作確認済み） ===');
// FERRY_PORT_MAP は未エクスポートのため直接参照しない。
// 港名解決（竹芝桟橋→東京・竹芝）は search_ferry 経由で動作確認済み（MCPツール検証時に SUCCESS 確認）。

console.log('\n🎉 竹芝周辺チェック完了');
