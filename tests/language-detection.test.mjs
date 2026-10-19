// 多言語判定（detectLanguage）の回帰テスト — v2.58.3
// 実行: node tests/language-detection.test.mjs
//
// 背景: v2.58.3 の監査で以下を実測確認した。
//   - 日本語のランドマーク名（浅草寺・雷門・晴空塔）が中国語語彙リストに
//     登録されており、漢字のみ（かななし）の日本語入力が zh と判定されていた。
//   - 繁体字の中国語入力（深圳・車站・問題など）がすべて ja にフォールバックしていた。
//   - 繁体字のシグナルに「場・機・机」を含めたため「十日市場」「小机」が
//     日本語の駅名なのに zh と判定される二次的な誤判定が発生していた。
import { detectLanguage } from '../src/lib/lang.mjs';
import { RAILWAY_LINES } from '../src/data/railway-lines.mjs';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('=== 多言語判定（detectLanguage）回帰テスト ===');

// ---- 1. 日本語の入力が ja になること ----
console.log('-- 日本語入力（かななし・漢字のみ）--');
for (const input of [
  '浅草寺', '雷門', '晴空塔', '東京', '新宿', '浅草', '渋谷', '横浜', '大阪', '京都',
  '北海道', '富士山', '川崎', '大島', '栄町', '赤坂', '十日市場', '小机', '千城台北',
  '半蔵門', '御茶ノ水', '豊洲', '西大島', '光大島', '和田町', '日暮里',
]) {
  const got = detectLanguage(input);
  if (got === 'ja') ok(`detectLanguage('${input}') = ja`);
  else fail(`detectLanguage('${input}') = ${got}, expected ja`);
}

// ---- 2. 中国語（簡体字・繁体字）の入力が zh になること ----
console.log('-- 中国語入力（簡体字・繁体字）--');
for (const input of [
  '涩谷', '台场', '机场', '火车站', '地铁', '公交', '从浅草出发', '品川到新宿',
  '上海', '北京', '深圳', '廣州', '廣州', '車站', '問題', '時間', '銀行', '機場',
  '發現', '選擇', '種類', '電視', '檢查', '計劃', '營業', '經濟', '鐵路', '幾點',
  '请帮我查一下', '多少钱', '怎么去', '台风', '暴雨',
]) {
  const got = detectLanguage(input);
  if (got === 'zh') ok(`detectLanguage('${input}') = zh`);
  else fail(`detectLanguage('${input}') = ${got}, expected zh`);
}

// ---- 3. 英語入力が en になること ----
console.log('-- 英語入力 --');
for (const input of ['Shinjuku', 'Tokyo', 'Yokohama', 'Odaiba', 'Ikebukuro', 'Narita']) {
  const got = detectLanguage(input);
  if (got === 'en') ok(`detectLanguage('${input}') = en`);
  else fail(`detectLanguage('${input}') = ${got}, expected en`);
}

// ---- 4. 全駅名が ja になること（1,400駅超のスweep）----
console.log('-- 全駅名の sweep（zh/en への誤判定が 0 件であること）--');
const stationNames = new Set();
for (const stations of Object.values(RAILWAY_LINES)) {
  for (const s of stations) stationNames.add(s.replace(/（.*?）/g, ''));
}
const names = [...stationNames].filter(Boolean);
const misDetected = names.filter(n => detectLanguage(n) !== 'ja');
if (misDetected.length === 0) {
  ok(`全 ${names.length} 駅が ja と判定（誤判定 0 件）`);
} else {
  fail(`${misDetected.length}/${names.length} 駅が誤判定: ${misDetected.slice(0, 20).join(', ')}`);
}

console.log('');
if (failures === 0) {
  console.log('✅ 多言語判定回帰テスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ 多言語判定回帰テスト: ${failures} 件の失敗`);
  process.exit(1);
}
