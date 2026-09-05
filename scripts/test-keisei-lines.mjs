// 京成グループの路線データ回帰テスト
// 2026-09 公式（京成電鉄駅番号・Wikipedia・北総鉄道公式）との突合で修正:
// 1. 京成立石を本線から押上線へ移動（本線42駅・押上線6駅）
// 2. 北総線の駅順修正（秋山→東松戸→松飛台）
// 3. 京成本線支線→東成田線に改名
// 4. 乗換駅の徒歩連絡追加（京成八幡⇔本八幡 ほか4組）
import * as mod from '../src/index.mjs';

const { computeRoutes, STATION_TO_LINES, resolveStation, AMBIGUOUS_STATION_NAMES } = mod;

let failCount = 0;
function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); failCount++; }
  else console.log('✅ OK:', msg);
}

function lineStations(line) {
  return Object.keys(STATION_TO_LINES)
    .filter(s => STATION_TO_LINES[s].some(e => e.line === line))
    .sort((a, b) => STATION_TO_LINES[a].find(e => e.line === line).index
      - STATION_TO_LINES[b].find(e => e.line === line).index);
}

// 1. 京成本線が公式42駅（立石なし・高砂⇔小岩が隣接）
const main = lineStations('京成本線');
assert(main.length === 42, `京成本線は42駅（現在 ${main.length}駅）`);
assert(main[9] === '京成高砂' && main[10] === '京成小岩', `高砂の次は小岩（現在: ${main[9]}→${main[10]}）`);
assert(!main.includes('京成立石'), '京成立石は本線に含まれない');

// 2. 押上線が公式6駅（立石は四ツ木と青砥の間）
const oshiage = lineStations('京成押上線');
const expectOshiage = ['押上','京成曳舟','八広','四ツ木','京成立石','青砥'];
assert(oshiage.length === 6, `押上線は6駅（現在 ${oshiage.length}駅）`);
for (const [i, st] of expectOshiage.entries()) {
  assert(oshiage[i] === st, `押上線 ${i+1}駅目は「${st}」（現在「${oshiage[i]}」）`);
}
assert(STATION_TO_LINES['京成立石'].every(e => e.line === '京成押上線'), '京成立石は押上線のみに所属');

// 3. 北総線の駅順（公式HS01〜14・京成高砂〜印旛日本医大）
const hokuso = lineStations('北総鉄道');
const expectHokuso = ['京成高砂','新柴又','矢切','北国分','秋山','東松戸','松飛台','大町','新鎌ヶ谷','西白井','白井','小室','千葉ニュータウン中央','印西牧の原','印旛日本医大'];
assert(hokuso.length === 15, `北総鉄道は15駅（現在 ${hokuso.length}駅）`);
for (const [i, st] of expectHokuso.entries()) {
  assert(hokuso[i] === st, `北総線 ${i+1}駅目は「${st}」（現在「${hokuso[i]}」）`);
}

// 4. 東成田線（正式名）
assert(!!lineStations('東成田線').length, '東成田線が存在');
assert(lineStations('東成田線').join('→') === '京成成田→東成田', '東成田線は 京成成田→東成田');

// 5. 乗換駅の徒歩連絡が効く
for (const [a, b, maxMin] of [
  ['京成八幡','本八幡', 10], ['京成成田','成田', 8], ['京成西船','西船橋', 12], ['京成幕張本郷','幕張本郷', 6],
]) {
  const r = computeRoutes(a, b);
  assert(!r.error && r.routes[0].summary.transfers === 0 && r.routes[0].summary.estimated_minutes <= maxMin,
    `${a}→${b}: 0乗換・徒歩連絡で直結（${r.error ? r.error : r.routes[0].summary.estimated_minutes + '分'}）`);
}

// 6. 主要経路の回帰
for (const [a, b] of [['京成上野','成田空港'],['押上','成田空港'],['日暮里','京成成田'],['松戸','成田空港'],['西船橋','京成船橋']]) {
  const r = computeRoutes(a, b);
  assert(!r.error, `${a}→${b} が検索可能（${r.error || ''}）`);
}

// 7. 全駅接続性スイープ（孤立駅なし）
const isolates = Object.keys(STATION_TO_LINES).filter(st =>
  st !== '東京' && computeRoutes(st, '東京').error === 'NO_ROUTE');
assert(isolates.length === 0, `孤立駅なし（${isolates.length}駅）`);

console.log(failCount === 0 ? '\n🎉 全テスト PASS' : `\n❌ ${failCount} 件 FAIL`);
process.exit(failCount === 0 ? 0 : 1);
