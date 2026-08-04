// 東京駅 → 東京ディズニーランド の経路検索テスト（実関数呼び出し）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes, searchRoute } = mod;

// 1. 駅名解決
const from = resolveStation('東京');
const to = resolveStation('東京ディズニーランド');
console.log('from:', JSON.stringify(from));
console.log('to  :', JSON.stringify(to));

// 2. 経路計算（内部エンジン）
const route = computeRoutes('東京', '東京ディズニーランド');
console.log('route error:', route.error || 'none');
console.log('routes count:', route.routes ? route.routes.length : 0);
if (route.routes) {
  const r = route.routes[0];
  console.log('summary:', JSON.stringify(r.summary));
  console.log('segments:', JSON.stringify(r.segments));
}

// 3. 全体 searchRoute（AIアドバイス等を含むフル応答）
const full = await searchRoute({ from: '東京', to: '東京ディズニーランド', language: 'ja' });
console.log('full status:', full?.status || full?.error || '?');
console.log('has routes:', !!(full?.routes && full.routes.length));
console.log('ai_advice present:', !!(full?.ai_transit_advice));
console.log('disambiguation:', JSON.stringify(full?.disambiguation) || 'none');

assert(true, '実行完了');
