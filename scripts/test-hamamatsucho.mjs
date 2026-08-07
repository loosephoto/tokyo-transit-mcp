// 浜松町駅周辺チェック（バス・徒歩案内・ランドマーク）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ OK:', msg);
}

const { resolveStation, computeRoutes, searchBus, searchRoute } = mod;

console.log('=== 1. 浜松町駅の解決 ===');
const hamamatsucho = resolveStation('浜松町');
console.log('浜松町:', JSON.stringify(hamamatsucho));
assert(hamamatsucho.station === '浜松町', '浜松町駅が解決できる');

console.log('\n=== 2. 浜松町→フェリーポートの徒歩案内 ===');
// 浜松町→竹芝桟橋（東海汽船ターミナル）
const r1 = computeRoutes('浜松町', '竹芝桟橋');
console.log('浜松町→竹芝桟橋:', JSON.stringify(r1));
assert(!r1.error, '浜松町→竹芝桟橋 の経路計算に失敗しない');
assert(r1.routes && r1.routes.length > 0, '浜松町→竹芝桟橋 に経路がある');
assert(r1.toLandmark === '竹芝桟橋', '浜松町→竹芝桟橋 にランドマーク情報が付く');

// 浜松町→日の出桟橋（水上バス）
const r2 = computeRoutes('浜松町', '日の出桟橋');
console.log('浜松町→日の出桟橋:', JSON.stringify(r2));
assert(!r2.error, '浜松町→日の出桟橋 の経路計算に失敗しない');
assert(r2.routes && r2.routes.length > 0, '浜松町→日の出桟橋 に経路がある');
assert(r2.toLandmark === '日の出桟橋', '浜松町→日の出桟橋 にランドマーク情報が付く');

// 浜松町→浜離宮
const r3 = computeRoutes('浜松町', '浜離宮');
console.log('浜松町→浜離宮:', JSON.stringify(r3));
assert(!r3.error, '浜松町→浜離宮 の経路計算に失敗しない');
assert(r3.toLandmark === '浜離宮', '浜松町→浜離宮 にランドマーク情報が付く');

console.log('\n=== 3. 浜松町駅周辺のバス停検索 ===');
const stops = ['浜松町', '浜松町駅前', '竹芝', '竹芝桟橋', '日の出桟橋', '大門', '海岸一丁目'];
for (const s of stops) {
  const res = await searchBus({ busstop_name: s, language: 'ja' });
  const texts = (res?.content || []).filter(c => c.type === 'text').map(c => c.text);
  const jsonText = texts.find(t => t.trim().startsWith('{')) || texts[0] || '{}';
  let data = {};
  try { data = JSON.parse(jsonText); } catch (_) {}
  const routes = data?.bus_routes || [];
  const notes = routes.map(r => r.note).filter(Boolean);
  console.log(`${s}: total=${data?.total ?? '?'} ${notes.length ? '→ ' + notes.join(', ') : ''}`);
  assert(data?.status === 'SUCCESS', `${s} のバス停検索が成功する`);
}

console.log('\n🎉 浜松町駅周辺チェック完了');
