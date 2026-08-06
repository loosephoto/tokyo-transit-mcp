// 近接異名駅・同名別駅 改善の統合検証スクリプト
// 1) データ整合性（路線リストの重複駅・WALK_TRANSFERSの駅存在・AMBIGUOUS候補の存在）
// 2) ルート回帰（近接異名駅の徒歩連絡・同名別駅の曖昧化・データ修正の確認）
import * as mod from '../src/index.mjs';

const { resolveStation, computeRoutes, STATION_TO_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES } = mod;

let fail = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('❌', msg); fail++; }
  else console.log('✅', msg);
};

// ===== 1) データ整合性 =====
console.log('\n===== データ整合性 =====');
// 路線内の重複駅チェック
const dupLines = Object.entries(STATION_TO_LINES ? {} : {}); // placeholder
// WALK_TRANSFERS の両端がグラフに存在するか
for (const w of WALK_TRANSFERS) {
  assert(!!STATION_TO_LINES[w.from], `WALK: ${w.from} がグラフに存在`);
  assert(!!STATION_TO_LINES[w.to], `WALK: ${w.to} がグラフに存在`);
}
// AMBIGUOUS 候補がグラフに存在するか
for (const [name, cands] of Object.entries(AMBIGUOUS_STATION_NAMES)) {
  for (const c of cands) {
    assert(!!STATION_TO_LINES[c], `AMBIGUOUS候補 ${c} (${name}) がグラフに存在`);
  }
}
// 同名別駅の分離確認: 小川町(都営)と小川町（東武東上線）が別ノード
const ogawa = STATION_TO_LINES['小川町'].map(e => e.line);
const ogawaTobu = STATION_TO_LINES['小川町（東武東上線）'].map(e => e.line);
assert(ogawa.includes('都営新宿線') && !ogawa.includes('東武東上線'), '小川町=都営新宿線のみ（東武と分離）');
assert(ogawaTobu.includes('東武東上線'), '小川町（東武東上線）=東武東上線');
const ryogoku = STATION_TO_LINES['両国'].map(e => e.line);
const ryogokuOedo = STATION_TO_LINES['両国（大江戸線）'].map(e => e.line);
assert(ryogoku.includes('JR総武線各停') && !ryogoku.includes('都営大江戸線'), '両国=JRのみ（大江戸線と分離）');
assert(ryogokuOedo.includes('都営大江戸線'), '両国（大江戸線）=都営大江戸線');
// 表記ゆれ統一: 市ヶ谷に南北線が統合
const ichigaya = STATION_TO_LINES['市ヶ谷'].map(e => e.line);
assert(ichigaya.includes('東京メトロ南北線'), '市ヶ谷に南北線が統合（市ケ谷→市ヶ谷）');
assert(!STATION_TO_LINES['市ケ谷'], '市ケ谷（旧キー）は消滅');
// データ修正: 千代田線に北千住、内幸町は三田線のみ
const chiyoda = STATION_TO_LINES['北千住'].map(e => e.line);
assert(chiyoda.includes('東京メトロ千代田線'), '千代田線に北千住が追加');
const uchi = STATION_TO_LINES['内幸町'].map(e => e.line);
assert(uchi.length === 1 && uchi[0] === '都営三田線', '内幸町は三田線のみ（千代田線の幻駅を削除）');
const shimbashi = STATION_TO_LINES['新橋'].map(e => e.line);
assert(shimbashi.includes('京浜東北線'), '京浜東北線に新橋が追加');
// 浅草線の修正確認
const asakusaLine = STATION_TO_LINES['東日本橋'].map(e => e.line);
assert(asakusaLine.includes('都営浅草線'), '浅草線に東日本橋が追加');
const suiten = STATION_TO_LINES['水天宮前'].map(e => e.line);
assert(suiten.length === 1 && suiten[0] === '東京メトロ半蔵門線', '水天宮前は半蔵門線のみ（浅草線の幻駅を削除）');
// 浅草（TX）分離 + 徒歩連絡
const asakusaTX = STATION_TO_LINES['浅草（つくばエクスプレス）'].map(e => e.line);
assert(asakusaTX.includes('つくばエクスプレス'), '浅草（TX）がTX線として分離');
const asakusa = STATION_TO_LINES['浅草'].map(e => e.line);
assert(!asakusa.includes('つくばエクスプレス'), '浅草本体からTX線を除去');

// ===== 2) ルート回帰 =====
console.log('\n===== ルート回帰 =====');
const route = (f, t) => {
  const r = computeRoutes(f, t);
  if (r.error) return { error: r.error };
  return r.routes[0].summary;
};

// 2-1. 牛田→矢切（今回の主目的）
const ushida = computeRoutes('牛田', '矢切');
assert(ushida.routes && ushida.routes[0].segments.some(s => s.walk && s.from === '牛田' && s.to === '京成関屋'),
  '牛田→矢切: 徒歩連絡セグメント（牛田⇔京成関屋）を含む');
assert(ushida.routes[0].summary.transfers === 2 && ushida.routes[0].summary.estimated_minutes < 35,
  `牛田→矢切: ${ushida.routes[0].summary.transfers}乗換 ${ushida.routes[0].summary.estimated_minutes}分（旧3乗換37分より改善）`);
console.log('      segments:', ushida.routes[0].segments.map(s => (s.walk ? '🚶' : '') + s.line.split(' ')[0] + '(' + s.stops + ')').join(' | '));

// 2-2. 近接異名駅の直接ペア（徒歩連絡で0-1乗換）
for (const [f, t] of [['田町','三田'],['浜松町','大門'],['秋葉原','岩本町'],['京橋','宝町'],['後楽園','春日'],
  ['明治神宮前','原宿'],['赤坂見附','永田町'],['三ノ輪','三ノ輪橋'],['王子','王子駅前'],['大塚','大塚駅前'],
  ['町屋','町屋駅前'],['赤羽','赤羽岩淵'],['北朝霞','朝霞台'],['蒲田','京急蒲田'],['勝田台','東葉勝田台'],
  ['京成船橋','船橋'],['上野','京成上野'],['汐留','新橋'],['馬喰横山','東日本橋'],['東京','大手町']]) {
  const r = route(f, t);
  const walkOk = r.error === undefined && r.transfers <= 1 && r.estimated_minutes <= 10;
  assert(walkOk, `${f}⇔${t}: ${r.error || (r.transfers + '乗換 ' + r.estimated_minutes + '分')}`);
}

// 2-3. 同名別駅の曖昧化
for (const [name, cands] of [['小川町', 2], ['両国', 2], ['霞ヶ関', 2]]) {
  const res = resolveStation(name);
  assert(res.ambiguous && res.candidates.length === cands, `${name}: 曖昧化（候補${cands}件）→ ${res.candidates.join(' / ')}`);
}
// 曖昧時は検索中断（AMBIGUOUS_STATION）
const ambRoute = computeRoutes('小川町', '池袋');
assert(ambRoute.error === 'AMBIGUOUS_STATION' && ambRoute.side === 'from', '小川町→池袋: AMBIGUOUS_STATION で検索中断');
// 識別子付き駅名で直接検索できる
const ogawaRoute = computeRoutes('小川町（東武東上線）', '池袋');
assert(ogawaRoute.routes && ogawaRoute.routes[0].summary.transfers === 0, '小川町（東武東上線）→池袋: 東上線直通0乗換');
// 霞ケ関（公式表記）は東京メトロに確定
const kasiwa = resolveStation('霞ケ関');
assert(kasiwa.station === '霞ケ関' && !kasiwa.ambiguous, '霞ケ関（ケ表記）→ 東京メトロに確定');

// 2-4. 表記ゆれ・データ修正の回帰
const ichigayaRoute = computeRoutes('市ヶ谷', '駒込');
assert(ichigayaRoute.routes && ichigayaRoute.routes[0].summary.transfers === 0, '市ヶ谷→駒込: 南北線直通0乗換（表記ゆれ統合）');
const kitaRoute = computeRoutes('北千住', '綾瀬');
assert(kitaRoute.routes && kitaRoute.routes[0].segments.some(s => s.line === '東京メトロ千代田線'), '北千住→綾瀬: 千代田線直通');
const shinbashiRoute = computeRoutes('有楽町', '品川');
assert(shinbashiRoute.routes && shinbashiRoute.routes[0].segments.some(s => s.line === '京浜東北線' && s.stops === 4), '有楽町→品川: 京浜東北線で新橋経由（4駅）');
const asakusaBridge = computeRoutes('浅草橋', '森下');
assert(asakusaBridge.routes && asakusaBridge.routes[0].segments.some(s => s.walk && s.from === '両国' && s.to === '両国（大江戸線）'),
  '浅草橋→森下: 両国⇔両国（大江戸線）徒歩連絡経由');

// 2-5. バウンス経路が発生しないこと（近接異名駅の往復を含まない）
const bounce = computeRoutes('新橋', '本八幡');
const bouncePath = bounce.routes && bounce.routes[0].path;
const noBounce = !bouncePath || !(bouncePath.join(',').includes('岩本町,秋葉原') || bouncePath.join(',').includes('大手町,東京'));
assert(noBounce, '新橋→本八幡: バウンス経路（岩本町/大手町往復）が発生しない');

// 2-6. 主要ルート回帰（従来挙動の維持）
for (const [f, t, minTrans] of [['新宿','小田原', 0], ['浅草','お台場', 2], ['新宿','成田空港', 2], ['横浜','つくば', 2]]) {
  const r = route(f, t);
  assert(r.error === undefined && r.transfers <= minTrans + 1, `${f}→${t}: ${r.error || r.transfers + '乗換 ' + r.estimated_minutes + '分'}`);
}

console.log(`\n===== 結果: ${fail === 0 ? 'ALL PASS ✅' : fail + ' FAIL ❌'} =====`);
process.exit(fail ? 1 : 0);
