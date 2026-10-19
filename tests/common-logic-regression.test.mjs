// 共通ロジック層 高severity修正の回帰テスト — v2.58.3
// 実行: node tests/common-logic-regression.test.mjs
//
// 背景: 共通ロジック層のコード監査で実測確認した不具合の回帰防止。
//   H-3 getDisplayLineName の部分一致による無関係な路線への誤答
//   H-4 台風予報なのに「晴れ」アドバイスが返る
//   H-5 英語・中国語駅名が全て東京都へフォールバックする
//   H-6 4xx が「ネットワーク障害(502)」に誤分類される
//   M-7 気象庁 API 障害時に「晴れ」を返す
import { getDisplayLineName, toJapaneseStationName } from '../src/lib/lang.mjs';
import { parseSevereWeather, stationToJmaArea } from '../src/advice/weather.mjs';
import { handleApiError } from '../src/lib/common.mjs';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('=== 共通ロジック層 回帰テスト (v2.58.3) ===');

// ---- H-3: getDisplayLineName の部分一致誤答 ----
console.log('-- H-3: getDisplayLineName の誤答防止 --');
for (const [input, lang, expected] of [
  ['東京', 'en', '東京'],
  ['JR', 'en', 'JR'],
  ['池袋', 'en', '池袋'],
  ['上野', 'en', '上野'],
  ['丸ノ内線', 'en', 'Tokyo Metro Marunouchi Line'],
  ['銀座線', 'en', 'Tokyo Metro Ginza Line'],
  ['都営新宿線', 'en', 'Toei Shinjuku Line'],
  ['JR山手線', 'en', 'JR Yamanote Line'],
  ['東京メトロ丸ノ内線', 'en', 'Tokyo Metro Marunouchi Line'],
  ['西武池袋線', 'en', 'Seibu Ikebukuro Line'],
  ['京王線', 'en', 'Keio Line'],
  ['都営大江戸線', 'en', 'Toei Oedo Line'],
  ['丸ノ内線', 'zh', '东京地铁丸之内线'],
  ['都営新宿線', 'zh', '都营新宿线'],
]) {
  const got = getDisplayLineName(input, lang);
  if (got === expected) ok(`getDisplayLineName('${input}','${lang}') = ${got}`);
  else fail(`getDisplayLineName('${input}','${lang}') = ${got}, expected ${expected}`);
}

// ---- H-4: 荒天判定 ----
console.log('-- H-4: 荒天（台風・雷）の判定 --');
for (const [weather, shouldBeSevere] of [
  ['台風', true], ['雨　で　雷を伴い　激しく　降る', true], ['雷', true],
  ['強風', true], ['大雨', true], ['霧', true],
  ['晴れ', false], ['曇り', false], ['雪', false], ['くもり', false],
]) {
  const r = parseSevereWeather(weather, '', '', '');
  if (r.isSevere === shouldBeSevere) ok(`parseSevereWeather('${weather}').isSevere = ${r.isSevere}`);
  else fail(`parseSevereWeather('${weather}').isSevere = ${r.isSevere}, expected ${shouldBeSevere}`);
}

// ---- H-5: 英語・中国語駅名の府県解決 ----
console.log('-- H-5: 英語・中国語駅名の府県解決 --');
for (const [input, expected] of [
  ['Shibuya', '130000'], ['Yokohama', '140000'], ['Shinjuku', '130000'],
  ['Ueno', '130000'], ['Chiba', '120000'], ['Odawara', '140000'],
  ['横浜', '140000'], ['千葉', '120000'], ['小田原', '140000'], ['静岡', '220000'],
]) {
  const got = stationToJmaArea(input);
  if (got === expected) ok(`stationToJmaArea('${input}') = ${got}`);
  else fail(`stationToJmaArea('${input}') = ${got}, expected ${expected}`);
}

// toJapaneseStationName の逆引き
for (const [input, expected] of [['Yokohama', '横浜'], ['Shinjuku', '新宿'], ['Chiba', '千葉']]) {
  const got = toJapaneseStationName(input);
  if (got === expected) ok(`toJapaneseStationName('${input}') = ${got}`);
  else fail(`toJapaneseStationName('${input}') = ${got}, expected ${expected}`);
}

// ---- H-6: 4xx の誤分類防止 ----
console.log('-- H-6: 4xx のエラrtype分類 --');
const mkErr = (status) => { const e = new Error(`HTTP ${status}`); e.response = { status }; return e; };
for (const [status, expectedType] of [
  [400, 'INVALID_INPUT'], [404, 'NO_ROUTE'], [422, 'PARSE_ERROR'],
  [401, 'API_AUTH_ERROR'], [403, 'API_AUTH_ERROR'], [500, 'API_SERVER_ERROR'],
  [503, 'API_SERVER_ERROR'],
]) {
  const res = handleApiError(mkErr(status), {});
  const d = res.structuredContent;
  if (d?.error_type === expectedType) ok(`${status} → ${d.error_type} (http ${d.error_code})`);
  else fail(`${status} → ${d?.error_type}, expected ${expectedType}`);
}

// ネットワークエラー（status なし）は従来どおり NETWORK_ERROR
{
  const res = handleApiError(new Error('socket hang up'), {});
  const d = res.structuredContent;
  if (d?.error_type === 'NETWORK_ERROR') ok(`statusなし → ${d.error_type}`);
  else fail(`statusなし → ${d?.error_type}, expected NETWORK_ERROR`);
}

console.log('');
if (failures === 0) {
  console.log('✅ 共通ロジック層回帰テスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ 共通ロジック層回帰テスト: ${failures} 件の失敗`);
  process.exit(1);
}
