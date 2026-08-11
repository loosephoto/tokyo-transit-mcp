// イシュー#88/#89/#90 回帰テスト（weather 地域解決・風波・全角波高）
// node scripts/test-issue-88-89-90.mjs（API不要・決定的）
import { stationToJmaArea, parseSevereWeather } from '../src/advice/weather.mjs';
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
assert(stationToJmaArea('渋谷') === '131020', '#88 渋谷→131020');
assert(stationToJmaArea('埼玉') === '110000', '#88 埼玉→110000');
assert(stationToJmaArea('神奈川') === '140000', '#88 神奈川→140000');
assert(stationToJmaArea('横浜') === '140010', '#88 横浜→140010');
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

console.log(`\n結果: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
