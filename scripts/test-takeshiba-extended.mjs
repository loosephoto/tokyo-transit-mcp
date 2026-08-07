// 竹芝駅周辺チェック拡張（日の出桟橋・文化施設・多言語）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ OK:', msg);
}

const { resolveStation, computeRoutes } = mod;

console.log('=== 1. 日の出桟橋の駅名解決（ja/en/zh） ===');
const hinode = resolveStation('日の出桟橋');
console.log('日の出桟橋:', JSON.stringify(hinode));
assert(hinode.station === '浜松町' && hinode.landmark === '日の出桟橋', '日の出桟橋がランドマーク経由で浜松町駅に解決される');
assert(hinode.walk_min === 5, '日の出桟橋の徒歩目安は5分');

const hinodeZh = resolveStation('日出码头');
console.log('日出码头:', JSON.stringify(hinodeZh));
assert(hinodeZh.station === '浜松町', '日出码头（中国語）が浜松町駅に解決される');

const hinodeEn = resolveStation('Hinode Pier');
console.log('Hinode Pier:', JSON.stringify(hinodeEn));
assert(hinodeEn.station === '浜松町', 'Hinode Pier（英語）が浜松町駅に解決される');

console.log('\n=== 2. 日の出桟橋への経路 ===');
// 東京 → 日の出桟橋（浜松町駅まで）
const r1 = computeRoutes('東京', '日の出桟橋');
console.log('東京→日の出桟橋:', JSON.stringify(r1));
assert(!r1.error, '東京→日の出桟橋 の経路計算に失敗しない');
assert(r1.routes && r1.routes.length > 0, '東京→日の出桟橋 に経路がある');
assert(r1.toLandmark === '日の出桟橋', '東京→日の出桟橋 にランドマーク情報が付く');

// 竹芝 → 日の出桟橋（浜松町駅経由 or 徒歩）
const r2 = computeRoutes('竹芝', '日の出桟橋');
console.log('竹芝→日の出桟橋:', JSON.stringify(r2));
assert(!r2.error, '竹芝→日の出桟橋 の経路計算に失敗しない');
assert(r2.routes && r2.routes.length > 0, '竹芝→日の出桟橋 に経路がある');

console.log('\n=== 3. 竹芝駅到着時の文化施設表示データ ===');
// DESTINATION_CULTURAL_FACILITIES は未エクスポートのため、searchRoute 経由で確認する代わりに
// computeRoutes の結果と併せて、竹芝駅到着セグメントが正しいことを確認済み。
// ここでは竹芝駅に文化施設データが存在することを searchRoute で確認（content 内の destination_cultural フィールド）。
const cultural = await mod.searchRoute({ from: '新橋', to: '竹芝', language: 'ja' });
const texts = (cultural?.content || []).filter(c => c.type === 'text').map(c => c.text);
const jsonText = texts.find(t => t.trim().startsWith('{')) || texts[0] || '{}';
let data = {};
try { data = JSON.parse(jsonText); } catch (_) {}
console.log('cultural_facilities:', JSON.stringify(data?.destination_cultural_facilities || data?.cultural_facilities || 'N/A'));
const hasTakeshibaCultural = JSON.stringify(data).includes('浜離宮恩賜庭園');
assert(hasTakeshibaCultural, '竹芝駅到着時に浜離宮恩賜庭園が文化施設として表示される');

console.log('\n=== 4. 既存機能の回帰確認 ===');
// 竹芝桟橋は引き続き解決される
const pier = resolveStation('竹芝桟橋');
assert(pier.station === '竹芝' && pier.landmark === '竹芝桟橋', '竹芝桟橋は引き続き竹芝駅に解決される');
// 浜離宮は引き続き解決される
const hamarikyu = resolveStation('浜離宮');
assert(hamarikyu.station === '竹芝', '浜離宮は引き続き竹芝駅に解決される');
// ゆりかもめ「日の出」駅は駅名として解決される（ランドマークに奪われない）
const hinodeStn = resolveStation('日の出');
console.log('日の出:', JSON.stringify(hinodeStn));
assert(hinodeStn.station === '日の出', '「日の出」はゆりかもめの駅として解決される（ランドマークに奪われない）');

console.log('\n🎉 竹芝駅周辺チェック（拡張）完了');
