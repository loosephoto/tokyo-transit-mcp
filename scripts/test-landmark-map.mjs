// ランドマーク変換マップの決定的テスト（API不要）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes, searchRoute } = mod;

// 1. ランドマーク変換（resolveStation 経由で検証）
const tdlR = resolveStation('東京ディズニーランド');
assert(tdlR.station === '舞浜' && tdlR.landmark === '東京ディズニーランド', '東京ディズニーランド → 舞浜(landmark)');
const tdsR = resolveStation('東京ディズニーシー');
assert(tdsR.station === '舞浜', '東京ディズニーシー → 舞浜');
const skyR = resolveStation('スカイツリー');
assert(skyR.station === 'とうきょうスカイツリー', 'スカイツリー → とうきょうスカイツリー');
const towerR = resolveStation('東京タワー');
assert(towerR.station === '御成門', '東京タワー → 御成門');

// 2. resolveStation でランドマークが駅に解決
const fromR = resolveStation('東京');
const toR = resolveStation('東京ディズニーランド');
assert(fromR.station === '東京' && fromR.exact, '東京 は完全一致');
assert(toR.station === '舞浜' && toR.landmark === '東京ディズニーランド', '東京ディズニーランド は 舞浜(landmark付) に解決');

// 3. computeRoutes がランドマーク情報を伝播
const route = computeRoutes('東京', '東京ディズニーランド');
assert(!route.error, 'route error なし');
assert(route.toLandmark === '東京ディズニーランド' && route.toLandmarkNote, 'toLandmark 伝播');

// 4. searchRoute フル応答に landmark_info が含まれる
const full = await searchRoute({ from: '東京', to: '東京ディズニーランド', language: 'ja' });
// jsonResponse は { content: [アドバイステキスト, JSONテキスト] } を返す
const textBlocks = full?.content || [];
const jsonText = textBlocks.map(b => b.text).find(t => t && t.trim().startsWith('{')) || '{}';
const data = JSON.parse(jsonText);
const li = data?.landmark_info;
console.log('landmark_info:', JSON.stringify(li));
assert(li && li.to && li.to.landmark === '東京ディズニーランド', 'full 応答に landmark_info.to が含まれる');
assert(data?.routes && data.routes.length > 0, 'routes あり');

// 5. 金町→黄金町 の誤認は依然として防がれている
const kn = computeRoutes('金町', '新宿');
assert(kn.error === 'STATION_NOT_FOUND', '金町 は誤認せず STATION_NOT_FOUND');
const og = resolveStation('黄金町');
assert(og.station === '黄金町' && og.landmark === null, '黄金町 は通常駅として解決（landmarkではない）');

console.log('done');
