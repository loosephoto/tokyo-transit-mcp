// 主要乗換駅ペアの接続スモークテスト
// 別名駅ペアが正しく徒歩連絡され、大回り経路にならないことを確認する
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ OK:', msg);
}

const { computeRoutes } = mod;

// [from, to, 期待される最大乗換回数, 期待される最大時間(分)]
const pairs = [
  ['浜松町', 'モノレール浜松町', 1, 10],       // JR⇔モノレール（同一駅舎）
  ['東京', 'モノレール浜松町', 1, 20],          // 都心→モノレール
  ['錦糸町', '両国（大江戸線）', 1, 25],          // JR総武線→両国経由→都営大江戸線（「両国」は同名別駅でAMBIGUOUSのため経由地として検証）
  ['浅草', '浅草（つくばエクスプレス）', 1, 15],  // 東武・銀座線⇔TX
  ['田町', '三田', 1, 15],                       // JR⇔都営
  ['浜松町', '大門', 1, 15],                     // JR⇔都営
  ['大門', '浜松町', 1, 15],                     // 都営⇔JR（双方向）
  ['大門', 'モノレール浜松町', 1, 20],           // 都営→徒歩→モノレール（連鎖乗換）
  ['上野', '京成上野', 1, 15],                   // JR⇔京成
  ['蒲田', '京急蒲田', 1, 15],                   // JR⇔京急
  ['川崎', '京急川崎', 1, 15],                   // JR⇔京急
  ['津田沼', '京成津田沼', 1, 15],               // JR⇔京成
  ['船橋', '京成船橋', 1, 15],                   // JR⇔京成
  ['溝の口', '武蔵溝ノ口', 1, 15],               // 東急⇔JR
  ['曳舟', '京成曳舟', 1, 15],                   // 東武⇔京成
  ['新越谷', '南越谷', 1, 15],                   // 東武⇔JR武蔵野線
  ['八柱', '新八柱', 1, 15],                     // 新京成⇔JR武蔵野線
  ['北朝霞', '朝霞台', 1, 15],                   // JR武蔵野線⇔東武東上線
  ['柴又', '金町', 1, 15],                       // 京成金町線⇔JR常磐線
  ['川越', '本川越', 1, 15],                     // JR⇔西武新宿線
  ['御徒町', '仲御徒町', 1, 15],                 // JR⇔都営大江戸線
  ['上野', '上野御徒町', 1, 15],                 // JR⇔都営大江戸線
  ['有楽町', '日比谷', 1, 15],                   // JR⇔日比谷線
  ['人形町', '水天宮前', 1, 15],                 // 日比谷線⇔半蔵門線
  ['小田急多摩センター', '多摩センター', 1, 10], // 小田急⇔多摩モノレール
  ['京王多摩センター', '多摩センター', 1, 10],   // 京王⇔多摩モノレール
  ['舞浜', 'リゾートゲートウェイ・ステーション', 1, 10], // JR⇔ディズニーリゾートライン
];

console.log('=== 別名乗換駅ペアのスモークテスト ===');
let failCount = 0;
for (const [from, to, maxTransfers, maxMinutes] of pairs) {
  const r = computeRoutes(from, to);
  if (r.error) {
    console.log(`❌ ${from} → ${to}: ERROR ${r.error}`);
    assert(false, `${from} → ${to} の経路計算に失敗しない`);
    failCount++;
    continue;
  }
  const s = r.routes[0].summary;
  const ok = s.transfers <= maxTransfers && s.estimated_minutes <= maxMinutes;
  if (!ok) {
    console.log(`❌ ${from} → ${to}: ${s.transfers}乗換 ${s.estimated_minutes}分 (期待: ≤${maxTransfers}乗換 ≤${maxMinutes}分) path=${r.routes[0].path.join('→')}`);
    failCount++;
  } else {
    console.log(`✅ ${from} → ${to}: ${s.transfers}乗換 ${s.estimated_minutes}分`);
  }
}

console.log('\n=== 羽田空港アクセス（モノレール経由の実用性） ===');
const hnd = [
  ['浜松町', '羽田空港第3ターミナル'],
  ['新橋', '羽田空港第3ターミナル'],
  ['品川', '羽田空港第3ターミナル'],
  ['東京', '羽田空港第1ターミナル'],
];
for (const [from, to] of hnd) {
  const r = computeRoutes(from, to);
  if (r.error) { console.log(`❌ ${from} → ${to}: ERROR ${r.error}`); failCount++; continue; }
  const s = r.routes[0].summary;
  console.log(`✅ ${from} → ${to}: ${s.main_line} ${s.transfers}乗換 ${s.estimated_minutes}分 | ${r.routes[0].path.join('→')}`);
}

console.log(failCount === 0 ? '\n🎉 全ペア正常' : `\n❌ ${failCount}件 FAIL`);
if (failCount > 0) process.exitCode = 1;
