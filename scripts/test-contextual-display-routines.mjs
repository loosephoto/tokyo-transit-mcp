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
assert(normal.data.gov_facility_search_support?.based_on === 'place_name', '通常検索: 現在地未指定では到着駅名ベースで公的機関検索を表示する（v2.36.3）');
assert(normal.data.gov_facility_search_support?.place_name === '上野', '通常検索: 公的機関検索は到着駅を基準にする');
assert(!normal.data.station_bus_stops || ['community_bus_access', 'substitute_transport', 'destination'].includes(normal.data.station_bus_stops.basis), '通常検索: バス停案内は関連情報としてのみ表示する');
assert(!normal.data.destination_cultural_facilities, '通常検索: 登録のない到着駅では文化施設を表示しない');
assert(!normal.data.cycling_alternative, '通常検索: 運転見合わせがなければシェアサイクル代替を表示しない');
// 🔴 GBFS（docomo-cycle-tokyo）はライブ外部APIのため、縮退応答時（stations 数件のみ）は
//    ポートが算出できず destination_bike_share 自体が省略される。この場合は検証をスキップし、
//    データ取得時のみ出し分けロジックを検証する（外部API依存をテストが握りつぶさない）。
if (normal.data.destination_bike_share) {
  assert(normal.data.destination_bike_share?.based_on === 'destination', '通常検索: 荒天以外では到着地周辺の自転車案内を表示する');
  assert(normal.data.destination_bike_share?.stations?.every(item => Number.isFinite(item.distance)), '通常検索: 到着地の自転車候補に距離情報を含める');
} else {
  console.log('⚠ GBFSデータ不足のため自転車案内の検証をスキップ（外部API依存・縮退応答）');
}

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

// 🚌 コミュニティバスは降車後の足（ラストマイル）として、目的地＝降車駅のみを案内する。
//   出発駅側の足（駅までの足）は表示しない。
const communityBuses = cultural.data.community_bus_access || [];
assert(communityBuses.length > 0, 'コミュニティバス: 到着駅にデータがあれば表示する');
assert(communityBuses.every(b => b.station === '上野'), 'コミュニティバス: 目的地（降車駅）のみを表示し、出発駅を含めない');
assert(cultural.data.station_bus_stops?.hint?.includes('降車後'), 'コミュニティバス: バス停案内は目的地基準で降車後の出口を案内する');

for (const [language, token] of [['ja', '降雪'], ['en', 'snow'], ['zh', '降雪']]) {
  const snow = payload(await mod.searchRoute({ from: '東京', to: '新宿', '-test': token, language }));
  assert(!snow.data.cycling_alternative, `${language}: 降雪・凍結リスクではシェアサイクルを表示しない`);
}

// 🚉 目的地にコミュニティバス登録がなく、振替輸送もない駅でも、降車後の足として
//   バス停案内（地図で確認）を常に表示する（basis='destination'）。
const noBusDest = payload(await mod.searchRoute({ from: '上野', to: '宇都宮', '-test': '猛暑', language: 'ja' }));
assert(noBusDest.data.station_bus_stops?.basis === 'destination', 'バス無し駅: 目的地ではコミュニティバス・振替輸送に関わらずバス停案内を表示する');
assert(noBusDest.data.station_bus_stops?.hint?.includes('降車後'), 'バス無し駅: バス停案内は目的地（降車後）基準である');
assert(!noBusDest.data.community_bus_access, 'バス無し駅: コミュニティバスデータがなければ表示しない');

console.log('done');
process.exit(process.exitCode || 0);
