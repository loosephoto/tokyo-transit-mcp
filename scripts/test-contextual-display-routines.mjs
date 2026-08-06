// search_route の補助表示が、地点・安全性・用途に応じて適切に出し分けられることを検証する回帰テスト。
import * as mod from '../src/index.mjs';

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✅', message);
  }
}

function payload(response) {
  const texts = (response?.content || []).map(item => item.text || '');
  const jsonText = texts.find(text => text.trim().startsWith('{')) || '{}';
  return { data: JSON.parse(jsonText), texts };
}

const normal = payload(await mod.searchRoute({ from: '押上', to: '上野', '-test': '猛暑', language: 'ja' }));
assert(normal.texts[0]?.includes('AIからのインテリジェントアドバイス'), '通常検索: AIアドバイスを先頭の独立テキストで返す');
assert(!Object.hasOwn(normal.data, 'ai_transit_advice'), '通常検索: JSON本体からAIアドバイスを分離する');
assert(!normal.data.gov_facility_search_support, '通常検索: 現在地未指定では地点不明な公的機関検索を表示しない');
assert(!normal.data.station_bus_stops || normal.data.station_bus_stops.basis === 'community_bus_access' || normal.data.station_bus_stops.basis === 'substitute_transport', '通常検索: バス停案内は関連情報としてのみ表示する');
assert(!normal.data.destination_cultural_facilities, '通常検索: 登録のない到着駅では文化施設を表示しない');
assert(!normal.data.cycling_alternative, '通常検索: 運転見合わせがなければシェアサイクル代替を表示しない');
assert(normal.data.destination_bike_share?.based_on === 'destination', '通常検索: 荒天以外では到着地周辺の自転車案内を表示する');
assert(normal.data.destination_bike_share?.stations?.every(item => Number.isFinite(item.distance)), '通常検索: 到着地の自転車候補に距離情報を含める');

const localGov = payload(await mod.searchRoute({
  from: '押上', to: '西国分寺', '-test': '猛暑', language: 'ja',
  user_location: { lat: 35.7101, lon: 139.8107 }
}));
assert(localGov.data.gov_facility_search_support?.based_on === 'user_location', '現在地指定: 公的機関検索の基準を現在地として明示する');
assert(/35\.7101/.test(localGov.data.gov_facility_search_support?.link || ''), '現在地指定: 公的機関検索リンクに現在地座標を含める');

const cultural = payload(await mod.searchRoute({ from: '浅草', to: '上野', language: 'ja' }));
const culturalFacilities = cultural.data.destination_cultural_facilities || [];
assert(culturalFacilities.length > 0, '文化施設: 登録済み到着駅でのみ表示する');
assert(culturalFacilities.every(item => Number.isFinite(item.walk_min) && item.walk_min > 0), '文化施設: 徒歩目安を伴う候補だけを表示する');

for (const [language, token] of [['ja', '降雪'], ['en', 'snow'], ['zh', '降雪']]) {
  const snow = payload(await mod.searchRoute({ from: '東京', to: '新宿', '-test': token, language }));
  assert(!snow.data.cycling_alternative, `${language}: 降雪・凍結リスクではシェアサイクルを表示しない`);
}

console.log('done');
process.exit(process.exitCode || 0);
