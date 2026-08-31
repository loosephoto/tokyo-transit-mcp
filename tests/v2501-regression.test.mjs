/**
 * v2.50.1 回帰テスト（2026-08-31）
 * Bug1: 時刻表駅マッチングの過剰一致（上野クエリに上野広小路・上野御徒町が混入）
 * Bug2: 天気最高気温が常に東京の値（父島・八丈島等で誤データ）
 * Bug3: UTC日付依存（JST 0:00〜9:00 にGTFS日付・曜日判定が1日ずれる）
 * 改良4: 小笠原の PLACE_SUBAREA 未登録（東京地方へのサイレントフォールバック）
 */
import assert from 'node:assert/strict';
import { stationIdMatchesStation, stationRecordMatches, resolveTimetableCalendar } from '../src/handlers/timetable.mjs';
import { pickMaxTemp } from '../src/advice/weather.mjs';
import { getJstDateStr, getJstDay, getJstDateCompact, gtfsFetchDates, validateFlightDate } from '../src/lib/time.mjs';
import { PLACE_SUBAREA, TEMP_AREA_BY_SUBAREA } from '../src/data/misc.mjs';

// ==========================================
// Bug1: 駅マッチングは完全一致のみ（接頭辞・部分一致を排除）
// ==========================================
const romanToJa = {
  'ueno': '上野', 'uenohirokoji': '上野広小路', 'uenookachimachi': '上野御徒町',
  'asakusa': '浅草', 'asakusabashi': '浅草橋', 'uenoge': '上野毛',
  'ginza': '銀座', 'ginzaicchome': '銀座一丁目', 'tokyo': '東京'
};
// 完全一致はマッチ
assert.equal(stationIdMatchesStation('ueno', '上野', romanToJa), true);
assert.equal(stationIdMatchesStation('asakusa', '浅草', romanToJa), true);
assert.equal(stationIdMatchesStation('ueno', 'ueno', romanToJa), true); // ローマ字入力とIDの完全一致
// 接頭辞・部分一致は排除（従来バグ）
assert.equal(stationIdMatchesStation('uenohirokoji', '上野', romanToJa), false, '上野広小路が上野に混入してはならない');
assert.equal(stationIdMatchesStation('uenookachimachi', '上野', romanToJa), false, '上野御徒町が上野に混入してはならない');
assert.equal(stationIdMatchesStation('asakusabashi', '浅草', romanToJa), false, '浅草橋が浅草に混入してはならない');
assert.equal(stationIdMatchesStation('ginzaicchome', '銀座', romanToJa), false, '銀座一丁目が銀座に混入してはならない');
assert.equal(stationIdMatchesStation('uenoge', '上野', romanToJa), false);
assert.equal(stationIdMatchesStation('uenohara', '上野', romanToJa), false);
// 境界値
assert.equal(stationIdMatchesStation('', '上野', romanToJa), false);
assert.equal(stationIdMatchesStation('ueno', '', romanToJa), false);
assert.equal(stationIdMatchesStation(null, '上野', romanToJa), false);

// stationRecordMatches: レコード経由判定
const recUeno = {
  'odpt:originStation': ['odpt.Station:TokyoMetro.Ueno'],
  'odpt:destinationStation': ['odpt.Station:TokyoMetro.Asakusa'],
  'odpt:trainTimetableObject': []
};
const recUenohirokoji = {
  'odpt:originStation': ['odpt.Station:TokyoMetro.Uenohirokoji'],
  'odpt:destinationStation': ['odpt.Station:TokyoMetro.Shimbashi'],
  'odpt:trainTimetableObject': [{ 'odpt:departureStation': 'odpt.Station:TokyoMetro.Uenookachimachi' }]
};
assert.equal(stationRecordMatches(recUeno, '上野', romanToJa), true);
assert.equal(stationRecordMatches(recUenohirokoji, '上野', romanToJa), false, '上野広小路発の列車が上野クエリにマッチしてはならない');
assert.equal(stationRecordMatches(recUenohirokoji, '上野御徒町', romanToJa), true, '途中駅マッチは維持');
assert.equal(stationRecordMatches({}, '上野', romanToJa), false);
assert.equal(stationRecordMatches(null, '上野', romanToJa), false);

// ==========================================
// Bug2: pickMaxTemp は subAreaCode で正しい観測地点を選ぶ
// ==========================================
// 実 JMA 130000 構造を模したモック（timeSeries[0]=天気, [2]=気温・観測地点名エリア）
const mockTimeSeries = [
  { areas: [{ area: { code: '130010', name: '東京地方' }, weathers: ['晴れ'] }] },
  { areas: [] },
  { areas: [
    { area: { code: '44132', name: '東京' }, temps: ['27', '27', '23', '30'] },
    { area: { code: '44172', name: '大島' }, temps: ['29', '29', '24', '30'] },
    { area: { code: '44263', name: '八丈島' }, temps: ['32', '32', '25', '31'] },
    { area: { code: '44301', name: '父島' }, temps: ['32', '32', '27', '32'] }
  ] }
];
// 従来バグ: どの地域を指定しても areas[0]=東京(30℃) を返していた
assert.equal(pickMaxTemp(mockTimeSeries), 30, '未指定時は先頭地点（東京）');
// 修正後: subAreaCode で正しい観測地点の気温を返す
assert.equal(pickMaxTemp(mockTimeSeries, '130010'), 30, '東京地方→東京');
assert.equal(pickMaxTemp(mockTimeSeries, '130020'), 30, '伊豆諸島北部→大島');
assert.equal(pickMaxTemp(mockTimeSeries, '130030'), 32, '伊豆諸島南部→八丈島（東京値30ではない）');
assert.equal(pickMaxTemp(mockTimeSeries, '130040'), 32, '小笠原諸島→父島（東京値30ではない）');
// 未知の subAreaCode は先頭地点にフォールバック（クラッシュしない）
assert.equal(pickMaxTemp(mockTimeSeries, '999999'), 30);
assert.equal(pickMaxTemp([]), 0);
assert.equal(pickMaxTemp(null), 0);

// TEMP_AREA_BY_SUBAREA 対応表の実測値整合（2026-08-31 JMA 確認分）
assert.equal(TEMP_AREA_BY_SUBAREA['130040'], '父島');
assert.equal(TEMP_AREA_BY_SUBAREA['110010'], 'さいたま');
assert.equal(TEMP_AREA_BY_SUBAREA['140010'], '横浜');

// ==========================================
// Bug3: JST 日付ヘルパー（0:00〜9:00 JST の境界で1日ずれない）
// ==========================================
// JST 2026-09-01 03:00 = UTC 2026-08-31 18:00（従来UTC方式だと 2026-08-31 になる窓）
const jstEarlyMorning = new Date('2026-08-31T18:00:00Z');
assert.equal(getJstDateStr(jstEarlyMorning), '2026-09-01', 'JST 03:00 では JST 日付を返す');
assert.equal(getJstDateCompact(jstEarlyMorning), '20260901');
assert.equal(getJstDay(jstEarlyMorning), 2, '2026-09-01 は火曜日（getDay ローカル依存排除）');
// JST 2026-08-31 23:30 = UTC 2026-08-31 14:30（ずれのない通常時間帯も確認）
const jstNight = new Date('2026-08-31T14:30:00Z');
assert.equal(getJstDateStr(jstNight), '2026-08-31');
assert.equal(getJstDay(jstNight), 1, '2026-08-31 は月曜日');
// gtfsFetchDates: 固定日付指定は必ず含まれる
assert.ok(gtfsFetchDates('20260101').includes('20260101'));
// validateFlightDate は引き続き厳格
assert.equal(validateFlightDate('2026-02-30'), false);
assert.equal(validateFlightDate('2026-09-01'), true);

// ==========================================
// calendar 判定: 明示日付は曜日通り、境界なし
// ==========================================
assert.equal(resolveTimetableCalendar(null, '2026-08-30'), 'SaturdayHoliday', '日曜');
assert.equal(resolveTimetableCalendar(null, '2026-08-31'), 'Weekday', '月曜');
assert.equal(resolveTimetableCalendar(null, '2026-09-05'), 'SaturdayHoliday', '土曜');
assert.equal(resolveTimetableCalendar('平日', '2026-08-30'), 'Weekday', '明示指定優先');
assert.equal(resolveTimetableCalendar('Weekday', null), 'Weekday');
assert.equal(resolveTimetableCalendar('土休日', null), 'SaturdayHoliday');

// ==========================================
// 改良4: 小笠原が PLACE_SUBAREA に登録済み（東京へのサイレントフォールバック解消）
// ==========================================
assert.equal(PLACE_SUBAREA['小笠原'], '130040');
assert.equal(PLACE_SUBAREA['小笠原諸島'], '130040');
assert.equal(PLACE_SUBAREA['父島'], '130040');
assert.equal(PLACE_SUBAREA['母島'], '130040');

console.log('✅ v2.50.1 回帰テスト（時刻表厳格化・天気subArea・JST日付・小笠原）: すべて成功');
