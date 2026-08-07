// 山手線周囲の主要乗換駅 正常動作チェック
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ OK:', msg);
}

const { computeRoutes, STATION_TO_LINES } = mod;

console.log('=== 1. 主要駅の路線構成チェック ===');
// [駅名, 必須路線]
const mustHave = [
  ['東京', ['JR山手線', '東京メトロ丸ノ内線', 'JR東海道線', 'JR横須賀線', 'JR京葉線']],
  ['上野', ['JR山手線', '東京メトロ銀座線', '東京メトロ日比谷線', 'JR常磐線快速']],
  ['秋葉原', ['JR山手線', '東京メトロ日比谷線', 'つくばエクスプレス']],
  ['日暮里', ['JR山手線', '京成本線', '日暮里舎人ライナー']],
  ['池袋', ['JR山手線', '東京メトロ丸ノ内線', '西武池袋線', '東武東上線', '東京メトロ副都心線']],
  ['新宿', ['JR山手線', '都営大江戸線', '小田急小田原線', '京王線', '都営新宿線']],
  ['渋谷', ['JR山手線', '東京メトロ銀座線', '東京メトロ半蔵門線', '東京メトロ副都心線', '東急東横線', '京王井の頭線']],
  ['品川', ['JR山手線', '京浜東北線', 'JR東海道線', '京急本線', 'JR横須賀線']],
  ['新橋', ['JR山手線', '東京メトロ銀座線', '都営浅草線', 'ゆりかもめ']],
  ['浜松町', ['JR山手線', '京浜東北線']],
  ['大崎', ['JR山手線', 'JR埼京線', 'りんかい線']],
  ['目黒', ['JR山手線', '都営三田線', '東京メトロ南北線', '東急目黒線']],
  ['恵比寿', ['JR山手線', '東京メトロ日比谷線']],
  ['五反田', ['JR山手線', '都営浅草線', '東急池上線']],
  ['神田', ['JR山手線', '東京メトロ銀座線']],
  ['代々木', ['JR山手線', '都営大江戸線']],
  ['巣鴨', ['JR山手線', '都営三田線']],
  ['高田馬場', ['JR山手線', '西武新宿線', '東京メトロ東西線']],
];
let failCount = 0;
for (const [station, required] of mustHave) {
  const lines = (STATION_TO_LINES[station] || []).map(e => e.line);
  const missing = required.filter(l => !lines.includes(l));
  if (missing.length) {
    console.log(`❌ ${station}: 欠落 ${missing.join(', ')} (現: ${lines.join(', ')})`);
    failCount++;
  } else {
    console.log(`✅ ${station}: ${lines.length}路線 OK`);
  }
}

// 有楽町の山手線欠落（実在駅なのに山手線リストに無い）
const yurac = (STATION_TO_LINES['有楽町'] || []).map(e => e.line);
if (yurac.includes('JR山手線')) console.log('✅ 有楽町: 山手線 OK');
else { console.log('❌ 有楽町: 山手線 欠落（バグ）'); failCount++; }

console.log('\n=== 2. 主要ターミナル間の経路チェック ===');
const routes = [
  ['東京', '新宿'],        // 中央線快速
  ['池袋', '渋谷'],        // 山手線 or 副都心線
  ['上野', '品川'],        // 山手線 or 京浜東北線
  ['新宿', '横浜'],        // 湘南新宿ライン or 東急
  ['秋葉原', '新橋'],      // 山手線
  ['渋谷', '横浜'],        // 東横線
  ['池袋', '横浜'],        // 副都心線→東横線直通
  ['東京', '大宮'],        // 京浜東北線
  ['品川', '成田空港'],    // 京急→京成?
  ['新宿', '大崎'],        // 埼京線
  ['池袋', '新宿'],        // 山手線
  ['渋谷', '恵比寿'],      // 山手線1駅
  ['目黒', '横浜'],        // 東急目黒線→東横線
  ['上野', '成田空港'],    // 京成
];
for (const [f, t] of routes) {
  const r = computeRoutes(f, t);
  if (r.error) {
    console.log(`❌ ${f} → ${t}: ERROR ${r.error}`);
    failCount++;
  } else {
    const s = r.routes[0].summary;
    const segs = r.routes[0].segments.map(seg => `${seg.line}(${seg.from}→${seg.to})`).join(' + ');
    console.log(`✅ ${f} → ${t}: ${s.transfers}乗換 ${s.estimated_minutes}分 | ${segs}`);
  }
}

console.log(failCount === 0 ? '\n🎉 全チェック正常' : `\n❌ ${failCount}件 FAIL`);
if (failCount > 0) process.exitCode = 1;
