// 千葉エリアの路線データ回帰テスト
// 2026-09 公式（千葉都市モノレール・京成電鉄・Wikipedia）との突合で修正:
// 1. 千葉都市モノレール: 1号線（千葉みなと⇔県庁前・6駅）と2号線（千葉⇔千城台・13駅）に分離
// 2. 新京成線 → 京成松戸線（2025-04-01 京成電鉄へ吸収合併・改称）。終点駅を「津田沼」誤りから「京成津田沼」に修正
// 3. JR津田沼⇔新津田沼の徒歩連絡を追加
import * as mod from '../src/index.mjs';

const { computeRoutes, STATION_TO_LINES, resolveStation } = mod;

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

// 1. 千葉都市モノレール1号線が公式6駅（千葉みなと⇔県庁前）
const line1 = lineStations('千葉都市モノレール1号線');
const expect1 = ['千葉みなと','市役所前','千葉','栄町','葭川公園','県庁前'];
assert(line1.length === 6, `モノレール1号線は6駅（現在 ${line1.length}駅）`);
for (const [i, st] of expect1.entries()) {
  assert(line1[i] === st, `1号線 ${i+1}駅目は「${st}」（現在「${line1[i]}」）`);
}

// 2. 千葉都市モノレール2号線が公式13駅（千葉⇔千城台）
const line2 = lineStations('千葉都市モノレール2号線');
const expect2 = ['千葉','千葉公園','作草部','天台','穴川','スポーツセンター','動物公園','みつわ台','都賀','桜木','小倉台','千城台北','千城台'];
assert(line2.length === 13, `モノレール2号線は13駅（現在 ${line2.length}駅）`);
for (const [i, st] of expect2.entries()) {
  assert(line2[i] === st, `2号線 ${i+1}駅目は「${st}」（現在「${line2[i]}」）`);
}

// 3. 千葉駅は両路線に所属（乗換駅）
const chibaLines = STATION_TO_LINES['千葉'].map(e => e.line);
assert(chibaLines.includes('千葉都市モノレール1号線') && chibaLines.includes('千葉都市モノレール2号線'),
  '千葉駅はモノレール1号線・2号線の両方に所属');

// 4. 県庁前は1号線のみ・千城台は2号線のみ
assert(STATION_TO_LINES['県庁前'].every(e => e.line === '千葉都市モノレール1号線'), '県庁前は1号線のみ');
assert(STATION_TO_LINES['千城台'].every(e => e.line === '千葉都市モノレール2号線'), '千城台は2号線のみ');

// 5. 京成松戸線が公式24駅（京成津田沼起点・松戸終点）
const matsudo = lineStations('京成松戸線');
assert(matsudo.length === 24, `京成松戸線は24駅（現在 ${matsudo.length}駅）`);
assert(matsudo[0] === '京成津田沼' && matsudo[23] === '松戸', `京成松戸線は京成津田沼起点・松戸終点（現在: ${matsudo[0]}〜${matsudo[23]}）`);
assert(!matsudo.includes('津田沼'), '京成松戸線にJR津田沼は含まれない（終点は京成津田沼）');

// 6. 京成津田沼は3路線接続
const tsudanumaLines = STATION_TO_LINES['京成津田沼'].map(e => e.line);
assert(tsudanumaLines.includes('京成本線') && tsudanumaLines.includes('京成松戸線') && tsudanumaLines.includes('京成千葉線'),
  '京成津田沼は本線・松戸線・千葉線の3路線接続');

// 7. 主要経路
const pairs = [
  ['千葉', '県庁前', 0],   // 1号線
  ['千葉', '千城台', 0],   // 2号線
  ['千葉みなと', '千城台', 1], // 千葉で乗換
  ['松戸', '京成津田沼', 0], // 京成松戸線全区間
  ['京成津田沼', '松戸', 0], // 逆方向
  ['津田沼', '新津田沼', 0], // 徒歩連絡
];
for (const [a, b, maxX] of pairs) {
  const r = computeRoutes(a, b);
  if (r.error) {
    assert(false, `${a} → ${b} が検索可能（${r.error}）`);
  } else {
    const s = r.routes[0].summary;
    assert(s.transfers <= maxX, `${a} → ${b}: ${s.transfers}乗換（最大${maxX}乗換）`);
    console.log(`   ${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分 | ${r.routes[0].path.join('→')}`);
  }
}

// 8. 京葉線（蘇我まで）と主要接続駅
const keiyo = lineStations('JR京葉線');
assert(keiyo.length === 19, `JR京葉線は19駅（現在 ${keiyo.length}駅）`);
assert(keiyo[0] === '東京' && keiyo[18] === '蘇我', '京葉線は東京〜蘇我');
assert(keiyo.includes('幕張豊砂'), '京葉線に幕張豊砂（2023年開業）を含む');

// 9. 全駅接続性スイープ
const isolates = Object.keys(STATION_TO_LINES).filter(st =>
  st !== '東京' && computeRoutes(st, '東京').error === 'NO_ROUTE');
assert(isolates.length === 0, `孤立駅なし（${isolates.length}駅）`);

console.log(failCount === 0 ? '\n🎉 全テスト PASS' : `\n❌ ${failCount} 件 FAIL`);
process.exit(failCount === 0 ? 0 : 1);
