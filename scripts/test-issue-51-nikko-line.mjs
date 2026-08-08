// Issue #51 回帰テスト: 東武日光線追加と東武宇都宮線の孤立解消
// 日光線未定義のため宇都宮線11駅がグラフから孤立し NO_ROUTE だった問題の回帰を防ぐ。
import * as mod from '../src/index.mjs';

const { computeRoutes, STATION_TO_LINES, AMBIGUOUS_STATION_NAMES } = mod;

let failCount = 0;
function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); failCount++; }
  else console.log('✅ OK:', msg);
}

// 1. 東武日光線の定義（26駅・東武動物公園→東武日光の順）
// STATION_TO_LINES のキー順は登録順（他路線の定義順）なので、index で路線内順に並べる
const nikkoStations = Object.keys(STATION_TO_LINES)
  .filter(s => STATION_TO_LINES[s].some(e => e.line === '東武日光線'))
  .sort((a, b) => {
    const ia = STATION_TO_LINES[a].find(e => e.line === '東武日光線').index;
    const ib = STATION_TO_LINES[b].find(e => e.line === '東武日光線').index;
    return ia - ib;
  });
assert(nikkoStations.length === 26, `東武日光線は26駅（現在 ${nikkoStations.length}駅）`);
const expectOrder = ['東武動物公園','杉戸高野台','幸手','南栗橋','栗橋','新古河','柳生','板倉東洋大前','藤岡','静和','新大平下','栃木','新栃木','合戦場','家中','東武金崎','楡木','樅山','新鹿沼','北鹿沼','板荷','下小代','明神','下今市','上今市','東武日光'];
for (const [i, st] of expectOrder.entries()) {
  assert(nikkoStations[i] === st, `日光線 ${i + 1}駅目は「${st}」（現在「${nikkoStations[i]}」）`);
}

// 2. 栃木駅が登録され解決できる（曖昧でも未登録でもない）
assert(!!STATION_TO_LINES['栃木'], '栃木駅が STATION_TO_LINES に登録されている');
assert(!AMBIGUOUS_STATION_NAMES['栃木'], '栃木は曖昧駅ではない');
assert(computeRoutes('栃木', '栃木').routes, '栃木→栃木 が解決できる');

// 3. 東武宇都宮線に栃木が含まれ、12駅になっている
const utsunomiyaStations = Object.keys(STATION_TO_LINES).filter(s =>
  STATION_TO_LINES[s].some(e => e.line === '東武宇都宮線'));
assert(utsunomiyaStations.length === 12, `東武宇都宮線は12駅（栃木追加後・現在 ${utsunomiyaStations.length}駅）`);
assert(utsunomiyaStations.includes('栃木'), '東武宇都宮線に栃木が含まれる');

// 4. 経路が正常に引ける（孤立解消の確認）
const routePairs = [
  ['新栃木', '浅草'],          // 宇都宮線→日光線→伊勢崎線
  ['新栃木', '東武宇都宮'],    // 同線内
  ['東武日光', '東京'],
  ['東武日光', '浅草'],
  ['栃木', '北千住'],
  ['東武動物公園', '東武日光'], // 日光線全区間
  ['東武宇都宮', '船橋'],
];
for (const [a, b] of routePairs) {
  const r = computeRoutes(a, b);
  if (r.error) {
    assert(false, `${a} → ${b} が NO_ROUTE ではない（${r.error}）`);
  } else {
    const s = r.routes[0].summary;
    assert(s.transfers <= 4 && s.estimated_minutes < 200, `${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分（常識的な範囲）`);
    console.log(`   ${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分 | ${r.routes[0].path.join('→')}`);
  }
}

// 5. 全駅接続性スイープ: 東京駅に到達できない登録駅が無いこと（孤立の再発防止）
const isolates = Object.keys(STATION_TO_LINES).filter(st => {
  if (st === '東京') return false;
  return computeRoutes(st, '東京').error === 'NO_ROUTE';
});
assert(isolates.length === 0, `全登録駅が東京駅へ到達可能（孤立駅: ${isolates.length ? isolates.join(', ') : 'なし'}）`);

console.log(failCount === 0 ? '\n🎉 全チェック正常' : `\n❌ ${failCount}件 FAIL`);
if (failCount > 0) process.exitCode = 1;
