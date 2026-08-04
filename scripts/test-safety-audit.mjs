// 指定避難場所・高温・降雪の安全監査回帰テスト
import * as mod from '../src/index.mjs';

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    process.exitCode = 1;
  } else console.log('✅', message);
}

function payload(response) {
  const texts = (response?.content || []).map(x => x.text || '');
  const json = texts.find(t => t.trim().startsWith('{')) || '{}';
  return { data: JSON.parse(json), advice: texts.find(t => t.includes('AI')) || '' };
}

// 降雪では避難所リンクや自転車代替を出さず、降雪専用の安全助言を返す。
for (const [language, snowToken, heatToken, snowMarker, heatMarker] of [
  ['ja', '降雪', '猛暑', '降雪注意', '熱中症警戒'],
  ['en', 'snow', 'extreme_heat', 'Snow Advisory', 'Heat Alert'],
  ['zh', '降雪', '酷暑', '降雪', '高温预警']
]) {
  const snow = payload(await mod.searchRoute({ from: '東京', to: '新宿', '-test': snowToken, language }));
  assert(snow.data.status === 'EMERGENCY_MODE_ACTIVE', `${language}: 降雪の運行影響ステータスを返す`);
  assert(snow.advice.includes(snowMarker), `${language}: 降雪専用アドバイスを返す`);
  assert(!snow.data.cycling_alternative, `${language}: 降雪時はシェアサイクル代替を表示しない`);
  assert(!snow.data.emergency_alert?.evacuation_search, `${language}: 降雪時は避難場所検索を表示しない`);

  const heat = payload(await mod.searchRoute({ from: '東京', to: '新宿', '-test': heatToken, language }));
  assert(heat.data.status === 'TEST_MODE', `${language}: 高温のテストモードを返す`);
  assert(heat.advice.includes(heatMarker), `${language}: 熱中症専用アドバイスを返す`);
  assert(!heat.data.emergency_alert, `${language}: 高温時は避難所アラートを表示しない`);
}

// 地震では地上交通を抑止し、避難場所は「検索」リンクとしてのみ案内する。
const quake = payload(await mod.searchRoute({ from: '東京', to: '新宿', '-test': '地震', language: 'ja' }));
assert(quake.data.route_guidance_suspended === true, '地震: 通常経路を停止する');
assert(quake.data.emergency_evacuation_search?.link, '地震: 避難場所の外部検索リンクを返す');
assert(quake.data.emergency_evacuation_search?.label.includes('検索'), '地震: 避難場所を確定せず検索案内と明示する');

console.log('done');
