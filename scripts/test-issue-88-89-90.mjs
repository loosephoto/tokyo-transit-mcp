// イシュー#88/#89/#90 回帰テスト（weather 地域解決・風波・全角波高）
// node scripts/test-issue-88-89-90.mjs（API不要・決定的）
import { stationToJmaArea, parseSevereWeather, placeToMunicipality, placeToSubarea } from '../src/advice/weather.mjs';
import { detectFailureType } from '../src/advice/transit-advice.mjs';

let pass = 0, fail = 0;
const assert = (cond, name) => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}`); }
};

// #88: 駅名・地域名 → JMA 地域コード（get_weather / search_route の地域解決）
assert(stationToJmaArea('千葉') === '120000', '#88 千葉→120000');
assert(stationToJmaArea('千葉県') === '120000', '#88 千葉県→120000');
assert(stationToJmaArea('東京') === '130000', '#88 東京→130000');
assert(stationToJmaArea('東京都') === '130000', '#88 東京都→130000');
assert(stationToJmaArea('渋谷') === '130000', '#93 渋谷→130000（区コード無効→府県正規化）');
assert(stationToJmaArea('埼玉') === '110000', '#88 埼玉→110000');
assert(stationToJmaArea('神奈川') === '140000', '#88 神奈川→140000');
assert(stationToJmaArea('横浜') === '140000', '#93 横浜→140000（市コード無効→府県正規化）');
assert(stationToJmaArea('大宮') === '110000', '#88 大宮→110000');
assert(stationToJmaArea('川崎') === '140000', '#88 川崎→140000');
// フェリー港名→県コード（#90）
assert(stationToJmaArea('東京・竹芝') === '130000', '#88 港 東京・竹芝→130000');
assert(stationToJmaArea('大島') === '130000', '#88 港 大島→130000');
assert(stationToJmaArea('館山') === '120000', '#88 港 館山→120000');
assert(stationToJmaArea('熱海') === '220000', '#88 港 熱海→220000');
// 未知・未登録は東京フォールバック
assert(stationToJmaArea('未知駅') === '130000', '#88 未知→東京フォールバック');
assert(stationToJmaArea('') === '130000', '#88 空文字→東京フォールバック');

// #89: 風・波・特別警報の検出（JMA は全角数字の波高）
const s1 = parseSevereWeather('雨', '北西の風 非常に強く', '２メートル 後 ２．５メートル');
assert(s1.isSevereWind === true, '#89 強風(非常に強く)検出');
assert(s1.isHighWave === true, '#89 高波(2.5m)検出');
assert(s1.maxWave === 2.5, '#89 全角波高パース maxWave=2.5');
assert(s1.isSevere === true, '#89 荒天(isSevere)成立');
const s2 = parseSevereWeather('くもり', '北の風', '０．５メートル');
assert(s2.isSevereWind === false && s2.isHighWave === false && s2.isSevere === false, '#89 平穏時は非荒天');
const s3 = parseSevereWeather('大雨特別警報', '北の風', '２メートル');
assert(s3.isSpecial === true && s3.isSevere === true, '#89 特別警報検出(isSpecial)');
const s4 = parseSevereWeather('雨', '南の風 やや強く', '２メートル');
assert(s4.isSevereWind === false && s4.isHighWave === false, '#89 やや強く・2mは非荒天');

// 始発前の運転見合わせ対応（倒木・運転見合わせの障害種別検出）
assert(detectFailureType('倒木', 'ja').adviceKey === 'fallen_tree', '倒木→fallen_tree');
assert(detectFailureType('倒木除去作業のため運転見合わせ', 'ja').isTrainSuspended === true, '倒木除去作業→見合わせ検出');
assert(detectFailureType('運転見合わせ', 'ja').adviceKey === 'service_suspension', '運転見合わせ→service_suspension');
assert(detectFailureType('運休', 'ja').adviceKey === 'service_suspension', '運休→service_suspension');
assert(detectFailureType('浸水', 'ja').adviceKey === 'flood', '浸水→flood（回帰）');
assert(detectFailureType('高波', 'ja').adviceKey === 'ferry_rough_seas', '高波→ferry_rough_seas（回帰）');

// 復旧・遅延（運転見合わせからの復旧）
assert(detectFailureType('再開', 'ja').adviceKey === 'service_resumed', '再開→service_resumed');
assert(detectFailureType('復旧', 'ja').adviceKey === 'service_resumed', '復旧→service_resumed');
assert(detectFailureType('運転再開', 'ja').adviceKey === 'service_resumed', '運転再開→service_resumed');
assert(detectFailureType('再開', 'ja').isTrainSuspended === false, '再開は復旧（見合わせではない）');
assert(detectFailureType('復旧しました', 'ja').isTrainSuspended === false, '復旧しました→見合わせではない');
assert(detectFailureType('遅延', 'ja').adviceKey === 'vehicle_delay', '遅延→vehicle_delay（運転継続）');
assert(detectFailureType('遅延', 'ja').isTrainSuspended === false, '遅延は運転継続（見合わせではない）');

// #93: 駅名→自治体表示・一次細分区域（JMA forecast は区市町村コードが無効→府県正規化＋自治体名表示）
assert(stationToJmaArea('上野') === '130000', '#93 上野→130000');
assert(stationToJmaArea('上野駅') === '130000', '#93 上野駅→130000');
assert(stationToJmaArea('新宿駅') === '130000', '#93 新宿駅→130000');
assert(stationToJmaArea('池袋') === '130000', '#93 池袋→130000');
assert(stationToJmaArea('品川駅') === '130000', '#93 品川駅→130000');
assert(placeToMunicipality('上野').ja === '台東区', '#93 上野→自治体 台東区');
assert(placeToMunicipality('渋谷駅').ja === '渋谷区', '#93 渋谷駅→自治体 渋谷区');
assert(placeToMunicipality('池袋').zh === '丰岛区', '#93 池袋→自治体 zh 丰岛区');
assert(placeToMunicipality('御茶ノ水').ja === '文京区', '#93 御茶ノ水→自治体 文京区');
assert(placeToMunicipality('横浜') === null, '#93 横浜→自治体なし（県表示）');
assert(placeToSubarea('大島') === '130020', '#93 大島→伊豆諸島北部(130020)');
assert(placeToSubarea('伊豆大島') === '130020', '#93 伊豆大島→伊豆諸島北部(130020)');
assert(placeToSubarea('三宅島') === '130030', '#93 三宅島→伊豆諸島南部(130030)');
assert(placeToSubarea('父島') === '130040', '#93 父島→小笠原諸島(130040)');
assert(placeToSubarea('上野') === null, '#93 上野→区域なし');

console.log(`\n結果: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
