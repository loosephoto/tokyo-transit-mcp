// イシュー#10〜#19（RAILWAY_LINES 収録漏れ・駅混入）の統合回帰テスト
// 実データ（computeRoutes / resolveStation）で検証。API不要。
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { computeRoutes } = mod;
const route = (f, t) => {
  const r = computeRoutes(f, t);
  if (r.error) return { error: r.error };
  return r.routes[0].summary;
};

// ===== 既存路線の駅収録漏れ是正 =====
// #13 国立: JR中央線快速に追加（国立競技場への誤解決解消）
let s = route('国立', '立川');
assert(s.error === undefined && s.transfers === 0 && s.main_line === 'JR中央線快速', `#13 国立→立川: 中央線快速直通 (${s.error || s.transfers + '乗換'})`);

// #16 永田町: 丸ノ内線に追加（徒歩連絡の迂回解消）
s = route('永田町', '国会議事堂前');
assert(s.error === undefined && s.transfers === 0 && s.main_line === '東京メトロ丸ノ内線', `#16 永田町→国会議事堂前: 丸ノ内線直通 (${s.error || s.transfers + '乗換'})`);

// #17 6駅収録漏れ
s = route('代々木公園', '渋谷');
assert(s.error === undefined, `#17 代々木公園→渋谷: 検索可能 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);
s = route('虎ノ門ヒルズ', '霞ケ関');
assert(s.error === undefined && s.transfers === 0, `#17 虎ノ門ヒルズ→霞ケ関: 日比谷線直通 (${s.error || s.transfers + '乗換'})`);
s = route('地下鉄成増', '池袋');
assert(s.error === undefined && s.main_line === '東京メトロ副都心線', `#17 地下鉄成増→池袋: 副都心線 (${s.error || s.main_line})`);
s = route('中野新橋', '方南町');
assert(s.error === undefined && s.main_line === '丸ノ内線支線', `#17 中野新橋→方南町: 丸ノ内線支線 (${s.error || s.main_line})`);

// #18 路線跨ぎの駅混入是正
s = route('落合', '飯田橋');
assert(s.error === undefined && s.main_line === '東京メトロ東西線', `#18 落合→飯田橋: 東西線直通（落合南長崎への誤解決なし）(${s.error || s.main_line})`);
// 京橋は銀座線のみ（丸ノ内線から除去）
const { STATION_TO_LINES } = mod;
const kyobashi = STATION_TO_LINES['京橋'].map(e => e.line);
assert(kyobashi.length === 1 && kyobashi[0] === '東京メトロ銀座線', `#18 京橋: 銀座線のみ（丸ノ内線から除去）`);
const heiwadai = STATION_TO_LINES['平和台'].map(e => e.line);
assert(heiwadai.length === 1 && heiwadai[0] === '東京メトロ有楽町線', `#18 平和台: 有楽町線のみ（副都心線から除去）`);
const awajicho = STATION_TO_LINES['淡路町'].map(e => e.line);
assert(awajicho.length === 1 && awajicho[0] === '東京メトロ丸ノ内線', `#18 淡路町: 丸ノ内線のみ（都営新宿線から除去）`);

// ===== 路線追加 =====
// #12 武蔵野線の駅混入是正: 松戸・北小金・馬橋・本八幡は武蔵野線に存在しない
const musashino = STATION_TO_LINES['新松戸'].map(e => e.line);
assert(musashino.includes('JR武蔵野線') && musashino.includes('JR常磐線各停'), `#12 新松戸: 武蔵野線＋常磐線各停`);
s = route('松戸', '南流山');
assert(s.error === undefined && s.transfers === 1, `#12 松戸→南流山: 常磐線各停→武蔵野線 1乗換 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);

// #14 常磐線各停の駅追加
s = route('金町', '北千住');
assert(s.error === undefined && s.transfers === 0, `#14 金町→北千住: 常磐線直通 (${s.error || s.transfers + '乗換'})`);
s = route('金町', '京成高砂');
assert(s.error === undefined, `#14 金町→京成高砂: 検索可能 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);

// #15 東武大師線・南越谷
s = route('南越谷', '大師前');
assert(s.error === undefined, `#15 南越谷→大師前: 検索可能 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);
s = route('新越谷', '南越谷');
assert(s.error === undefined && s.transfers === 0, `#15 新越谷⇔南越谷: 徒歩連絡 (${s.error || s.transfers + '乗換'})`);

// #11 新京成線
s = route('北千住', '松戸新田');
assert(s.error === undefined, `#11 北千住→松戸新田: 検索可能 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);
s = route('八柱', '新八柱');
assert(s.error === undefined && s.transfers === 0, `#11 八柱⇔新八柱: 徒歩連絡 (${s.error || s.transfers + '乗換'})`);

// #19 JR南武線
s = route('武蔵新城', '谷津');
assert(s.error === undefined, `#19 武蔵新城→谷津: 検索可能 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);
s = route('武蔵新城', '立川');
assert(s.error === undefined && s.transfers === 0, `#19 武蔵新城→立川: 南武線直通 (${s.error || s.transfers + '乗換'})`);

// #10 西武3路線
s = route('西武園ゆうえんち', '新宿');
assert(s.error === undefined, `#10 西武園ゆうえんち→新宿: 検索可能 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);
s = route('多摩湖', '西武園');
assert(s.error === undefined, `#10 多摩湖→西武園: 検索可能 (${s.error || s.transfers + '乗換 ' + s.estimated_minutes + '分'})`);
s = route('西武園', '東村山');
assert(s.error === undefined && s.transfers === 0, `#10 西武園→東村山: 西武園線直通 (${s.error || s.transfers + '乗換'})`);

console.log('\ndone');
