// v2.58.9 監査修正の回帰テスト
// 実行: node tests/v2589-regression.test.mjs
//
// 背景: 3層（共通ロジック・データ・ハンドラ）の実測監査で確認した不具合の回帰防止。
//   D-1 JR総武線各停が「千葉」で途切れ、東千葉・都賀・四街道・物井・佐倉がグラフに無い
//   D-2 同一駅「茅ケ崎」が表記ゆれで 茅ヶ崎／茅ケ崎 の2ノードに分裂
//   D-3 南阿佐ヶ谷に座標が無い（coords-extra が大文字「南阿佐ケ谷」）
//   D-4 英語名の誤字（仏子=Buko / 反町=Torimachi / 和田町=Wadacho 等）
//   H-1 かな（ひらがな・カタカナ）入力が一切解決できなかった
//   H-2 同一駅・同一港・空白入力なのに SUCCESS/全件リストを返す
//   H-3 running-status で operator キー（all/jreast）により英語応答になる
//   H-4 getJstDateStr(new Date(NaN)) が例外を投げる
//   H-5 getDisplayLineName('線') が都営新宿線に誤ヒット
//   H-6 getWeather('大阪') が東京(130000)の天気を返す
//   H-7 CircuitBreaker の HALF-OPEN が全並列を許可する
//   H-8 GTFS 生時刻（11:00:00 / 34:59:00）が正規化されない
import { resolveStation, computeRoutes, STATION_TO_LINES } from '../src/handlers/search-route.mjs';
import { getDisplayLineName, detectLanguage } from '../src/lib/lang.mjs';
import { getJstDateStr, normalizeOvernightTime, gtfsFetchDates } from '../src/lib/time.mjs';
import { CircuitBreaker } from '../src/config.mjs';
import { stationToJmaArea } from '../src/advice/weather.mjs';
import { RAILWAY_LINES } from '../src/data/railway-lines.mjs';
import { EXPECTED_RAILWAY_STATION_COUNTS } from '../src/data/expected-railway-counts.mjs';
import { STATION_COORDS_EXTRA } from '../src/data/station-coords-extra.mjs';
import { STATION_DISPLAY_NAMES } from '../src/data/station-names.mjs';
import { COMMUNITY_BUS_ROUTES, BUS_GTFS_SOURCES } from '../src/data/bus-routes.mjs';
import { STATION_READINGS } from '../src/data/station-readings.mjs';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('=== v2.58.9 監査修正 回帰テスト ===');

// ---- H-1: かな入力の解決 ----
console.log('-- H-1: かな入力 --');
for (const [kana, expected] of [
  ['うえの', '上野'], ['しぶや', '渋谷'], ['アサカ', '朝霞'], ['あきはばら', '秋葉原'],
  ['とうきょう', '東京'], ['おおつか', '大塚'], ['おおみや', '大宮'], ['いけぶくろ', '池袋'],
  ['おおてまち', '大手町'], ['しんおおつか', '新大塚'], ['にしにっぽり', '西日暮里'],
  ['こでんまちょう', '小伝馬町'], ['いたばし', '板橋'], ['おおじま', '大島'],
  ['なかおかちまち', '仲御徒町'], ['きんしちょう', '錦糸町'], ['かみいぐさ', '上井草'],
  ['うえのえき', '上野'],
]) {
  const r = resolveStation(kana);
  if (r.station === expected) ok(`resolveStation('${kana}') = ${expected}`);
  else fail(`resolveStation('${kana}') = ${r.station || '(null)'}, expected ${expected}`);
}
// 同音異字（ローマ字が同一表記）は権威読みで区別できる
for (const [kana, expected] of [['せんがわ', '仙川'], ['せんかわ', '千川']]) {
  const r = resolveStation(kana);
  if (r.station === expected && !r.ambiguous) ok(`resolveStation('${kana}') = ${expected}（一意）`);
  else fail(`resolveStation('${kana}') = ${r.station || '(null)'} amb=${r.ambiguous}, expected ${expected}`);
}
// 権威読みが索引されていること
if (Object.keys(STATION_READINGS).length > 1000) ok(`STATION_READINGS ${Object.keys(STATION_READINGS).length} 件`);
else fail(`STATION_READINGS が少ない: ${Object.keys(STATION_READINGS).length}`);

// ---- H-2: 同一駅・空白入力・同一港 ----
console.log('-- H-2: 入力ガード --');
const sameRoute = await import('../src/index.mjs');
for (const [label, res, wantType] of [
  ['searchRoute(東京→東京)', (await sameRoute.searchRoute({ from: '東京', to: '東京' })).structuredContent, 'INVALID_INPUT'],
  ['searchRoute(空白)', (await sameRoute.searchRoute({ from: '   ', to: '\t' })).structuredContent, 'INVALID_INPUT'],
  ['searchFare(東京→東京)', (await sameRoute.searchFare({ from: '東京', to: '東京' })).structuredContent, 'INVALID_INPUT'],
  ['searchFerry(竹芝→竹芝)', (await sameRoute.searchFerry({ from_port: '竹芝', to_port: '竹芝' })).structuredContent, 'INVALID_INPUT'],
  ['getTimetable(空白)', (await sameRoute.getTimetable({ station_name: ' ' })).structuredContent, 'INVALID_INPUT'],
  ['getStationInfo(空白)', (await sameRoute.getStationInfo({ station_name: '  ' })).structuredContent, 'INVALID_INPUT'],
]) {
  if (res?.error_type === wantType) ok(`${label} → ${wantType}`);
  else fail(`${label} → ${res?.error_type || res?.status}, expected ${wantType}`);
}

// ---- H-3: running-status の言語判定 ----
console.log('-- H-3: operator キーでの言語判定 --');
for (const [input, expected] of [['ｼﾌﾞﾔ', 'ja'], ['、', 'ja'], ['「', 'ja'], ['hello', 'en'], ['深圳', 'zh']]) {
  const got = detectLanguage(input);
  if (got === expected) ok(`detectLanguage(${JSON.stringify(input)}) = ${got}`);
  else fail(`detectLanguage(${JSON.stringify(input)}) = ${got}, expected ${expected}`);
}
const rs = (await sameRoute.getRunningStatus({})).structuredContent;
if (rs?.detected_language === 'ja') ok('getRunningStatus({}) → ja');
else fail(`getRunningStatus({}) → ${rs?.detected_language}, expected ja`);

// ---- H-4/H-8: 時刻・日付ユーティリティ ----
console.log('-- H-4/H-8: 時刻・日付 --');
for (const [input, expected] of [['34:59:00', '10:59'], ['11:00:00', '11:00'], ['25:30', '01:30'], ['24:00', '00:00'], ['03:05', '03:05']]) {
  const got = normalizeOvernightTime(input);
  if (got === expected) ok(`normalizeOvernightTime('${input}') = ${got}`);
  else fail(`normalizeOvernightTime('${input}') = ${got}, expected ${expected}`);
}
if (getJstDateStr(new Date(NaN)) === null) ok('getJstDateStr(new Date(NaN)) = null');
else fail('getJstDateStr(new Date(NaN)) が null 以外を返した');
const dates = JSON.stringify(gtfsFetchDates({}));
if (dates.includes('current')) ok(`gtfsFetchDates({}) = ${dates}`);
else fail(`gtfsFetchDates({}) = ${dates}`);

// ---- H-5: getDisplayLineName の部分一致 ----
console.log('-- H-5: getDisplayLineName --');
for (const [input, lang, expected] of [['線', 'en', '線'], ['JR', 'en', 'JR'], ['東京', 'en', '東京']]) {
  const got = getDisplayLineName(input, lang);
  if (got === expected) ok(`getDisplayLineName('${input}','${lang}') = ${got}`);
  else fail(`getDisplayLineName('${input}','${lang}') = ${got}, expected ${expected}`);
}

// ---- H-6: 気象庁エリアの縮退 ----
console.log('-- H-6: 気象庁エリア --');
for (const [place, expected] of [['大阪', '270000'], ['大阪駅', '270000'], ['京都', '260000'], ['名古屋', '230000'], ['札幌', '010000'], ['福岡', '400000'], ['那覇', '470000']]) {
  const got = stationToJmaArea(place);
  if (got === expected) ok(`stationToJmaArea('${place}') = ${got}`);
  else fail(`stationToJmaArea('${place}') = ${got}, expected ${expected}`);
}

// ---- H-7: CircuitBreaker HALF-OPEN ----
console.log('-- H-7: CircuitBreaker --');
{
  const cb = new CircuitBreaker('T', 1, 180000);
  cb.onFailure({ response: { status: 500 } });
  cb.cooldownPeriod = 50;
  cb.lastStateChanged = Date.now();
  await new Promise((r) => setTimeout(r, 70));
  cb.canExecute();
  let allow = 0;
  for (let i = 0; i < 100; i++) if (cb.canExecute()) allow++;
  if (allow === 1) ok('HALF-OPEN は探査1件のみ許可');
  else fail(`HALF-OPEN の許可件数 = ${allow}, expected 1`);
}

// ---- D-1: JR総武線各停の駅列 ----
console.log('-- D-1: JR総武線各停 --');
{
  const line = RAILWAY_LINES['JR総武線各停'] || [];
  const tail = ['東千葉', '都賀', '四街道', '物井', '佐倉'];
  const missing = tail.filter((s) => !line.includes(s));
  if (missing.length === 0) ok('JR総武線各停に 東千葉・都賀・四街道・物井・佐倉 を含む');
  else fail(`JR総武線各停に欠落: ${missing.join(', ')}`);
  if (line.length === EXPECTED_RAILWAY_STATION_COUNTS['JR総武線各停']) ok(`駅数 ${line.length} = 期待値`);
  else fail(`駅数 ${line.length} ≠ 期待値 ${EXPECTED_RAILWAY_STATION_COUNTS['JR総武線各停']}`);
  const r = computeRoutes('千葉', '佐倉', {});
  if (r.routes?.length && r.routes[0].summary?.transfers === 0) ok('千葉→佐倉 が直通で解決');
  else fail(`千葉→佐倉 が解決できない: ${JSON.stringify(r.routes?.[0]?.summary)}`);
}

// ---- D-2: 茅ケ崎の表記統一 ----
console.log('-- D-2: 茅ケ崎 --');
{
  const lines = STATION_TO_LINES['茅ケ崎'] || [];
  if (lines.length === 5) ok(`茅ケ崎 が ${lines.length} 路線の単一ノード`);
  else fail(`茅ケ崎 の路線数 = ${lines.length}, expected 5 (${JSON.stringify(lines.map((l) => l.line))})`);
  if (!STATION_TO_LINES['茅ヶ崎']) ok('茅ヶ崎（小ヶ）ノードは存在しない');
  else fail('茅ヶ崎（小ヶ）ノードが残存している');
}

// ---- D-3: 南阿佐ヶ谷の座標 ----
console.log('-- D-3: 南阿佐ヶ谷 --');
if (Array.isArray(STATION_COORDS_EXTRA['南阿佐ヶ谷'])) ok('南阿佐ヶ谷 の座標あり');
else fail('南阿佐ヶ谷 の座標が無い');

// ---- D-4: 英語名の誤字 ----
console.log('-- D-4: 英語名 --');
for (const [ja, expected] of [
  ['仏子', 'Bushi'], ['反町', 'Tammachi'], ['和田町', 'Wadamachi'], ['国府台', 'Kounodai'],
  ['多摩境', 'Tamasakai'], ['大口', 'Oguchi'], ['大宝', 'Daiho'], ['武里', 'Takesato'],
  ['白久', 'Shiroku'], ['谷保', 'Yaho'], ['豊田', 'Toyoda'], ['青物横丁', 'Aomono-yokocho'],
  ['安針塚', 'Anjinzuka'], ['宗道', 'Sodo'], ['家中', 'Ienaka'], ['稲戸井', 'Inatoi'],
  ['稲田堤', 'Inadazutumi'], ['立場', 'Tateba'], ['茅ケ崎', 'Chigasaki'], ['潮見', 'Shiomi'],
  ['新検見川', 'Shin-Kemigawa'], ['中村橋', 'Nakamura-bashi'], ['韮川', 'Niragawa'],
  ['踊場', 'Odoriba'], ['松飛台', 'Matsuhidai'], ['小絹', 'Kokinu'], ['柳生', 'Yagyu'],
  ['八柱', 'Yabashira'], ['新江古田', 'Shin-Egota'], ['六会日大前', 'Mutsuai-Nichidai-mae'],
  ['入地', 'Ireji'], ['下小代', 'Shimogoshiro'], ['向原', 'Mukaihara'], ['和戸', 'Wado'],
  ['片倉町', 'Katakura-cho'], ['塔ノ沢', 'Tonosawa'], ['ユーカリが丘', 'Yukarigaoka'],
]) {
  const got = STATION_DISPLAY_NAMES[ja]?.en;
  if (got === expected) ok(`${ja} = ${expected}`);
  else fail(`${ja} = ${got}, expected ${expected}`);
}

// ---- 実在しない駅の辞書残存 ----
console.log('-- 実在しない駅の除去 --');
for (const ghost of ['川和中央', '東新田']) {
  if (!STATION_DISPLAY_NAMES[ghost]) ok(`${ghost} は辞書に存在しない`);
  else fail(`${ghost} が辞書に残存している`);
}

// ---- コミュニティバスの駅⇔停留所整合 ----
console.log('-- コミュニティバス --');
for (const cb of COMMUNITY_BUS_ROUTES) {
  const stops = new Set();
  for (const r of cb.routes) for (const s of r.stops) stops.add(s);
  for (const [station, stop] of Object.entries(cb.stations || {})) {
    if (!stops.has(stop)) fail(`${cb.bus}: '${station}' → '${stop}' は実ルートに無い`);
  }
}
ok('コミュニティバスの駅エントリはすべて実ルートに存在');

// ---- 小田急バスの停 list 整合 ----
console.log('-- 小田急バス --');
{
  const odakyu = BUS_GTFS_SOURCES.find((s) => s.name === '小田急バス');
  const stops = new Set(odakyu?.stops || []);
  const bad = new Set();
  for (const r of odakyu?.routes || []) for (const x of r) if (!stops.has(x)) bad.add(x);
  if (bad.size === 0) ok('小田急バスの系統の起終点はすべて stops に存在する');
  else fail(`小田急バスの stops に無い系統端点: ${[...bad].join(', ')}`);
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
