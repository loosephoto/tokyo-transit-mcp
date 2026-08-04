// 国土地理院の指定緊急避難場所を陸路災害時に表示する回帰テスト
import * as mod from '../src/index.mjs';

function assert(condition, message) {
  if (!condition) { console.error('❌ FAIL:', message); process.exitCode = 1; }
  else console.log('✅', message);
}
function payload(response) {
  const texts = (response?.content || []).map(x => x.text || '');
  return JSON.parse(texts.find(t => t.trim().startsWith('{')) || '{}');
}

const quake = payload(await mod.searchRoute({ from: '東京', to: '新宿', '-test': '地震', language: 'ja' }));
assert(quake.status === 'EMERGENCY_MODE_ACTIVE', '地震時に緊急モードを返す');
assert(quake.ground_emergency_shelters?.source === '国土地理院', '国土地理院をデータソースとして返す');
assert(quake.ground_emergency_shelters?.hazard_type === '地震', '地震対応の避難場所として絞り込む');
assert(Array.isArray(quake.ground_emergency_shelters?.candidates), '避難場所候補配列を返す');
assert(quake.ground_emergency_shelters?.candidates?.length > 0, '東京駅周辺の地震対応候補を返す');
assert(quake.ground_emergency_shelters?.candidates?.every(x => x.hazard_compatible === true), '返却候補は災害種別に適合する');
assert(quake.ground_emergency_shelters?.candidates?.every(x => Number.isFinite(x.distance_m)), '候補に港・駅からの直線距離を付ける');
assert(quake.ground_emergency_shelters?.disclaimer?.includes('自治体'), '自治体の公式情報を優先する注意書きを返す');

console.log('done');
