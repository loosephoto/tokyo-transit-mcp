// Issue #50 回帰テスト: 西武拝島線の欠落駅補完と西武立川駅の検索不能解消
// 萩山・武蔵砂川・西武立川が欠落し、武蔵大和が誤登録されていた問題の回帰を防ぐ。
import * as mod from '../src/index.mjs';

const { computeRoutes, STATION_TO_LINES, resolveStation, AMBIGUOUS_STATION_NAMES } = mod;

let failCount = 0;
function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); failCount++; }
  else console.log('✅ OK:', msg);
}

// 1. 西武拝島線が公式8駅（index順）
const haijimaStations = Object.keys(STATION_TO_LINES)
  .filter(s => STATION_TO_LINES[s].some(e => e.line === '西武拝島線'))
  .sort((a, b) => STATION_TO_LINES[a].find(e => e.line === '西武拝島線').index
    - STATION_TO_LINES[b].find(e => e.line === '西武拝島線').index);
const expectHaijima = ['小平','萩山','小川','東大和市','玉川上水','武蔵砂川','西武立川','拝島'];
assert(haijimaStations.length === 8, `西武拝島線は8駅（現在 ${haijimaStations.length}駅）`);
for (const [i, st] of expectHaijima.entries()) {
  assert(haijimaStations[i] === st, `拝島線 ${i + 1}駅目は「${st}」（現在「${haijimaStations[i]}」）`);
}

// 2. 西武多摩湖線が公式7駅（八坂・武蔵大和を含む）
const tamakoStations = Object.keys(STATION_TO_LINES)
  .filter(s => STATION_TO_LINES[s].some(e => e.line === '西武多摩湖線'))
  .sort((a, b) => STATION_TO_LINES[a].find(e => e.line === '西武多摩湖線').index
    - STATION_TO_LINES[b].find(e => e.line === '西武多摩湖線').index);
assert(tamakoStations.length === 7, `西武多摩湖線は7駅（現在 ${tamakoStations.length}駅）`);
assert(tamakoStations.includes('八坂') && tamakoStations.includes('武蔵大和'), '多摩湖線に八坂・武蔵大和が含まれる');

// 3. 新駅が解決でき、曖昧ではない
for (const st of ['西武立川', '武蔵砂川', '八坂']) {
  assert(!!STATION_TO_LINES[st], `${st} が STATION_TO_LINES に登録されている`);
  assert(!AMBIGUOUS_STATION_NAMES[st], `${st} は曖昧駅ではない`);
  assert(resolveStation(st).exact, `${st} が exact 解決できる`);
}

// 4. 武蔵大和・萩山の所属路線（誤登録の解消）
assert(STATION_TO_LINES['武蔵大和'].every(e => e.line === '西武多摩湖線'), '武蔵大和は多摩湖線のみに所属（拝島線から削除済み）');
const hagiyamaLines = STATION_TO_LINES['萩山'].map(e => e.line);
assert(hagiyamaLines.includes('西武拝島線') && hagiyamaLines.includes('西武多摩湖線'), '萩山は拝島線・多摩湖線の両方に所属');

// 5. イシューで報告された経路が検索可能
const routePairs = [
  ['南船橋', '西武立川'],   // イシュー再現: 修正前 STATION_NOT_FOUND
  ['立川', '西武立川'],
  ['小平', '拝島'],         // 拝島線全区間
  ['国分寺', '多摩湖'],     // 多摩湖線全区間
  ['新宿', '西武立川'],
  ['西武立川', '南船橋'],   // 逆方向
];
for (const [a, b] of routePairs) {
  const r = computeRoutes(a, b);
  if (r.error) {
    assert(false, `${a} → ${b} が検索可能（${r.error}）`);
  } else {
    const s = r.routes[0].summary;
    assert(s.transfers <= 4 && s.estimated_minutes < 150, `${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分（常識的な範囲）`);
    console.log(`   ${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分 | ${r.routes[0].path.join('→')}`);
  }
}

// 6. 全駅接続性スイープ（孤立の再発防止）
const isolates = Object.keys(STATION_TO_LINES).filter(st => {
  if (st === '東京') return false;
  return computeRoutes(st, '東京').error === 'NO_ROUTE';
});
assert(isolates.length === 0, `全登録駅が東京駅へ到達可能（孤立駅: ${isolates.length ? isolates.join(', ') : 'なし'}）`);

console.log(failCount === 0 ? '\n🎉 全チェック正常' : `\n❌ ${failCount}件 FAIL`);
if (failCount > 0) process.exitCode = 1;
