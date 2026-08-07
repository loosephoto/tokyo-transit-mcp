// 近接異名駅・同名別駅 改善の統合検証スクリプト
// 1) データ整合性（路線リストの重複駅・WALK_TRANSFERSの駅存在・AMBIGUOUS候補の存在）
// 2) ルート回帰（近接異名駅の徒歩連絡・同名別駅の曖昧化・データ修正の確認）
import * as mod from '../src/index.mjs';
import fs from 'node:fs';

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

// 2-2b. 徒歩連絡が同一路線の乗車エッジを上書きしないこと（バグ回帰: v2.22.1）
const shiodome = computeRoutes('新橋', '汐留');
assert(shiodome.routes && shiodome.routes[0].summary.transfers === 0
  && shiodome.routes[0].segments.some(s => s.line === 'ゆりかもめ' && s.stops === 1),
  `新橋→汐留: ゆりかもめ1駅 0乗換（徒歩連絡が乗車エッジを上書きしない）→ ${JSON.stringify(shiodome.routes && shiodome.routes[0].summary)}`);
const otemachi = computeRoutes('東京', '大手町');
assert(otemachi.routes && otemachi.routes[0].summary.transfers === 0
  && otemachi.routes[0].segments.some(s => s.line === '東京メトロ丸ノ内線' && s.stops === 1),
  `東京→大手町: 丸ノ内線1駅 0乗換（徒歩連絡が乗車エッジを上書きしない）→ ${JSON.stringify(otemachi.routes && otemachi.routes[0].summary)}`);
// 跨路線ペアの徒歩エッジは残る（新橋@山手線→汐留@大江戸線）
const shiodomeWalk = computeRoutes('浜松町', '汐留');
assert(shiodomeWalk.routes && shiodomeWalk.routes[0].segments.some(s => s.walk),
  `浜松町→汐留: 跨路線の徒歩連絡は維持される → ${JSON.stringify(shiodomeWalk.routes && shiodomeWalk.routes[0].segments)}`);

// 2-2c. v2.24 追加の近接異名駅（公式連絡駅）
for (const [f, t, expectMin] of [
  ['御徒町', '仲御徒町', 5], ['上野', '上野御徒町', 6], ['有楽町', '日比谷', 5],
  ['津田沼', '京成津田沼', 6], ['川崎', '京急川崎', 5], ['溝の口', '武蔵溝ノ口', 5],
  ['曳舟', '京成曳舟', 5], ['人形町', '水天宮前', 5],
  ['小田急多摩センター', '京王多摩センター', 4], ['小田急多摩センター', '多摩センター', 4],
]) {
  const r = route(f, t);
  const walkOk = r.error === undefined && r.transfers <= 1 && r.estimated_minutes <= expectMin;
  assert(walkOk, `${f}⇔${t}: ${r.error || (r.transfers + '乗換 ' + r.estimated_minutes + '分')}`);
}

// 2-2d. v2.24 駅データ是正（幻駅削除・駅欠落追加・駅名修正）
const nagatachoLines = STATION_TO_LINES['永田町'].map(e => e.line);
assert(!nagatachoLines.includes('東京メトロ丸ノ内線'), '永田町は丸ノ内線に存在しない（幻駅削除: 公式は赤坂見附→四ツ谷）');
const chikatetsuNarimasu = STATION_TO_LINES['地下鉄成増'].map(e => e.line);
assert(chikatetsuNarimasu.includes('東京メトロ有楽町線'), '有楽町線に地下鉄成増を追加（公式24駅）');
const heiwadaiLines = STATION_TO_LINES['平和台'].map(e => e.line);
assert(heiwadaiLines.includes('東京メトロ副都心線'), '副都心線に平和台を追加（公式16駅）');
const mitsukyo = STATION_TO_LINES['三ツ境'].map(e => e.line);
assert(mitsukyo.includes('相鉄本線'), '相鉄本線に三ツ境を追加（公式18駅）');
const odakyuTama = STATION_TO_LINES['小田急多摩センター'].map(e => e.line);
assert(odakyuTama.includes('小田急多摩線'), '小田急多摩線の駅名を小田急多摩センターに是正');
const yokohamaLine = STATION_TO_LINES['八王子'].map(e => e.line);
assert(yokohamaLine.includes('JR横浜線'), '横浜線を八王子まで延長（公式20駅）');
const keiyoLine = STATION_TO_LINES['蘇我'].map(e => e.line);
assert(keiyoLine.includes('JR京葉線'), '京葉線を蘇我まで延長（公式19駅）');
const kurihama = STATION_TO_LINES['久里浜'].map(e => e.line);
assert(kurihama.includes('JR横須賀線'), '横須賀線を久里浜まで延長');
const nambuBranch = STATION_TO_LINES['八丁畷'].map(e => e.line);
assert(nambuBranch.includes('JR南武支線'), '南武支線（尻手〜浜川崎）を追加');
const keihinTsurumi = STATION_TO_LINES['鶴見'].map(e => e.line);
assert(keihinTsurumi.includes('京浜東北線'), '京浜東北線に鶴見を追加（公式41駅・川崎→横浜が1駅扱いだったバグ是正）');

// 2-2e. v2.25 未収録路線の追加（#20）と連絡駅（#20 徒歩連絡）
for (const [f, t, line] of [
  ['五反田', '蒲田', '東急池上線'], ['多摩川', '蒲田', '東急多摩川線'],
  ['三軒茶屋', '下高井戸', '東急世田谷線'], ['京成高砂', '京成金町', '京成金町線'],
  ['曳舟', '亀戸', '東武亀戸線'], ['京急川崎', '小島新田', '京急大師線'],
  ['武蔵境', '是政', '西武多摩川線'], ['国分寺', '東村山', '西武国分寺線'],
  ['相模大野', '片瀬江ノ島', '小田急江ノ島線'], ['金沢八景', '逗子・葉山', '京急逗子線'],
  ['堀ノ内', '三崎口', '京急久里浜線'], ['二俣川', '湘南台', '相鉄いずみ野線'],
  ['大船', '湘南江の島', '湘南モノレール'], ['立川', '奥多摩', 'JR青梅線'],
  ['拝島', '武蔵五日市', 'JR五日市線'], ['鶴見', '扇町', 'JR鶴見線'],
  ['茅ケ崎', '橋本', 'JR相模線'], ['八王子', '高麗川', 'JR八高線'],
  ['大宮', '高麗川', 'JR川越線'], ['大宮', '高崎', 'JR高崎線'],
  ['大宮', '宇都宮', 'JR宇都宮線'], ['大宮', '船橋', '東武野田線'],
  ['京成津田沼', '千葉中央', '京成千葉線'], ['千葉中央', 'ちはら台', '京成千原線'],
]) {
  const r = route(f, t);
  assert(r.error === undefined && r.transfers === 0 && r.main_line === line,
    `${f}→${t}: ${line}直通 (${r.error || r.main_line})`);
}
// v2.25 連絡駅の徒歩連絡
for (const [f, t, expectMin] of [
  ['柴又', '金町', 5], ['京成金町', '金町', 5], ['川越', '本川越', 6],
]) {
  const r = route(f, t);
  const walkOk = r.error === undefined && r.transfers <= 1 && r.estimated_minutes <= expectMin;
  assert(walkOk, `${f}⇔${t}: ${r.error || (r.transfers + '乗換 ' + r.estimated_minutes + '分')}`);
}
// v2.25 同名別駅の曖昧化（入谷: 日比谷線 vs 相模線）
const iriya = resolveStation('入谷');
assert(iriya.candidates && iriya.candidates.length === 2, `入谷: 曖昧化（候補${iriya.candidates?.length}件）→ ${iriya.candidates?.join('/')}`);
const iriyaSagami = STATION_TO_LINES['入谷（相模線）'].map(e => e.line);
assert(iriyaSagami.includes('JR相模線'), '入谷（相模線）: JR相模線に分離');

// 2-2f. 天気表示の多言語化（v2.25 障害修正: 「まで」「雷を伴う」等の辞書漏れ）
const weatherJa = '晴れ　時々　くもり　所により　夜のはじめ頃　まで　雨　で　雷を伴う';
const weatherEn = mod.translateWeather(weatherJa, 'en');
const weatherZh = mod.translateWeather(weatherJa, 'zh');
assert(!/[\u3040-\u30ff\u4e00-\u9fff]/.test(weatherEn), `天気en翻訳に日本語残存: ${weatherEn}`);
assert(!/[\u3040-\u30ff]/.test(weatherZh), `天気zh翻訳にかな残存: ${weatherZh}`);
assert(weatherEn.includes('until') && weatherEn.includes('with thunder'), `天気en: まで/雷を伴う 未翻訳 (${weatherEn})`);
assert(weatherZh.includes('为止') && weatherZh.includes('伴有雷电'), `天気zh: まで/雷を伴う 未翻訳 (${weatherZh})`);
// 辞書漏れ時のフォールバック（日本語が残る未知語 → en は断片除去/汎用メッセージ）
const weatherUnknown = mod.translateWeather('晴れ のち へんてこ天気', 'en');
assert(!/[\u3040-\u30ff\u4e00-\u9fff]/.test(weatherUnknown), `天気enフォールバックに日本語残存: ${weatherUnknown}`);

// 2-2g. v2.25.3 横浜・千葉近郊ランドマーク（テーマパーク・遊園地）の解決
for (const [lm, expectStn] of [
  ['よこはまコスモワールド', 'みなとみらい'], ['横浜ランドマークタワー', 'みなとみらい'],
  ['カップヌードルミュージアム', 'みなとみらい'], ['横浜赤レンガ倉庫', '馬車道'],
  ['インスタントラーメン発明記念館', 'みなとみらい'], // #27: カップヌードルミュージアム旧名（2006年開館時）
  ['カップヌードルミュージアムパーク', 'みなとみらい'], ['新港パーク', 'みなとみらい'], ['カップヌードルパーク', 'みなとみらい'], // #27: 新規ランドマーク（旧・新港パーク）
  ['CupNoodles Museum Park', 'みなとみらい'], ['Shinko Park', 'みなとみらい'],
  ['横浜中華街', '元町・中華街'], ['八景島シーパラダイス', '金沢八景'],
  ['ズーラシア', '鶴ヶ峰'], ['三溪園', '根岸'], ['山下公園', '元町・中華街'],
  ['横浜ベイクォーター', '新高島'], ['成田ゆめ牧場', '京成成田'],
  ['千葉市動物公園', '千葉'], ['千葉ポートタワー', '千葉みなと'],
  ['ZOZOマリンスタジアム', '海浜幕張'], ['浦安市総合公園', '新浦安'],
  ['Yokohama Cosmo World', 'みなとみらい'], ['Hakkeijima Sea Paradise', '金沢八景'],
]) {
  const res = resolveStation(lm);
  assert(res.landmark && res.station === expectStn, `${lm}: ${expectStn}へ解決 (${res.landmark ? res.station : '未解決'})`);
}
// グラフ未収録路線の最寄り駅ランドマークは保留（推測しない）
const motherFarm = resolveStation('マザー牧場');
assert(!motherFarm.landmark, 'マザー牧場: 内房線未収録のため保留（推測しない）');

// 2-2h. v2.25.3 駅名の略称/表記揺れエイリアス（resolveStation 経由）
for (const [alias, expectStn] of [
  ['Shin-Yokohama', '新横浜'], ['Nishi-Funabashi', '西船橋'], ['Matsudo', '松戸'],
  ['Kashiwa', '柏'], ['Chiba', '千葉'], ['Maihama', '舞浜'], ['Kaihin-Makuhari', '海浜幕張'],
  ['Minatomirai', 'みなとみらい'], ['Sakuragicho', '桜木町'], ['Kannai', '関内'],
  ['Tsudanuma', '津田沼'], ['Keisei-Tsudanuma', '京成津田沼'], ['Funabashi', '船橋'],
  ['Kamagaya', '鎌ヶ谷'], ['Shin-Kamagaya', '新鎌ヶ谷'], ['Nodashi', '野田市'],
  ['Kasukabe', '春日部'], ['Omiya', '大宮'], ['Iwatsuki', '岩槻'],
  ['Kurihama', '久里浜'], ['Yokohama', '横浜'],
  ['Kawasaki', '川崎'], ['Keikyu-Kawasaki', '京急川崎'], ['Musashi-Kosugi', '武蔵小杉'],
  ['Mizonokuchi', '溝の口'], ['Musashi-Mizonokuchi', '武蔵溝ノ口'],
  ['Shibamata', '柴又'], ['Keisei-Kanamachi', '京成金町'], ['Kanamachi', '金町'],
  ['Katase-Enoshima', '片瀬江ノ島'], ['Fujisawa', '藤沢'], ['Chuo-Rinkan', '中央林間'],
  ['Sagamiono', '相模大野'], ['Machida', '町田'], ['Hon-Atsugi', '本厚木'],
  ['Kichijoji', '吉祥寺'], ['Mitaka', '三鷹'], ['Tachikawa', '立川'], ['Hachioji', '八王子'],
  ['Hino', '日野'], ['Chofu', '調布'], ['Fuchu', '府中'], ['Kokubunji', '国分寺'],
  ['Zushi-Hayama', '逗子・葉山'], ['Keikyu-Kurihama', '京急久里浜'], ['Misakiguchi', '三崎口'],
  ['Shonan-Enoshima', '湘南江の島'], ['Kamakura', '鎌倉'], ['Ofuna', '大船'], ['Totsuka', '戸塚'],
  // ===== 2-2h2. #26 旧駅名エイリアス35件（STATION_NAME_MAP 経由で現駅名へ解決） =====
  ['千葉港', '千葉みなと'], ['営団赤塚', '地下鉄赤塚'], ['営団成増', '地下鉄成増'],
  ['江戸橋', '日本橋'], ['玉ノ井', '東向島'], ['業平橋', 'とうきょうスカイツリー'],
  ['松原団地', '獨協大学前'], ['京浜蒲田', '京急蒲田'], ['京浜川崎', '京急川崎'],
  ['京浜鶴見', '京急鶴見'], ['京浜久里浜', '京急久里浜'], ['京浜長沢', '京急長沢'],
  ['羽田空港国際線ターミナル', '羽田空港第3ターミナル'], ['花月園前', '花月総持寺'],
  ['仲木戸', '京急東神奈川'], ['産業道路', '大師橋'], ['新逗子', '逗子・葉山'],
  ['葛飾', '京成西船'], ['センター競馬場前', '船橋競馬場'], ['国鉄千葉駅前', '千葉中央'],
  ['京成千葉', '千葉中央'], ['荒川', '八広'], ['成田空港(旧)', '東成田'],
  ['多摩川園', '多摩川'], ['二子玉川園', '二子玉川'], ['南町田', '南町田グランベリーパーク'],
  ['多磨墓地前', '多磨'], ['北多磨', '白糸台'], ['西武遊園地', '多摩湖'],
  ['遊園地西', '西武園ゆうえんち'], ['六会', '六会日大前'], ['新横浜北', '北新横浜'],
  ['船の科学館', '東京国際クルーズターミナル'], ['国際展示場正門', '東京ビッグサイト'],
  ['富士吉田', '富士山'],
]) {
  const res = resolveStation(alias);
  assert(res.station === expectStn, `${alias}: ${expectStn}へ解決 (${res.station || '未解決'})`);
}
// 路線名の略称/表記揺れエイリアス（RAILWAY_NAME_MAP を直接検証。駅名解決とは別経路）
{
  const src = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('const RAILWAY_NAME_MAP = {');
  const end = src.indexOf('\n};', start);
  const body = src.slice(start, end);
  const rMap = {};
  for (const m of body.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) rMap[m[1]] = m[2];
  for (const [alias, expectLine] of [
    ['MM線', 'みなとみらい線'], ['ブルーライン', '横浜市営地下鉄ブルーライン'],
    ['グリーンライン', '横浜市営地下鉄グリーンライン'], ['TX', 'tsukuba'],
    ['都営', '都営大江戸線'], ['メトロ', '東京メトロ丸ノ内線'],
    ['東上', '東武東上線'], ['野田線', '東武野田線'], ['アーバンパークライン', '東武野田線'],
    ['江ノ島線', '小田急江ノ島線'], ['いずみ野線', '相鉄いずみ野線'], ['新横浜線', '相鉄新横浜線'],
    ['湘南モノレール', '湘南モノレール'], ['都電', '都電荒川線'], ['舎人ライナー', '日暮里舎人ライナー'],
    ['北総', '北総鉄道'], ['東葉', '東葉高速鉄道'], ['埼玉高速', '埼玉高速鉄道'],
    ['箱根登山', '箱根登山線'], ['富士急', '富士急行線'], ['青梅', 'JR青梅線'],
    ['五日市', 'JR五日市線'], ['鶴見', 'JR鶴見線'], ['相模', 'JR相模線'],
    ['八高', 'JR八高線'], ['川越', 'JR川越線'], ['高崎', 'JR高崎線'], ['宇都宮', 'JR宇都宮線'],
    ['京葉', 'JR京葉線'], ['武蔵野', 'JR武蔵野線'], ['常磐', 'JR常磐線快速'],
  ]) {
    assert(rMap[alias] === expectLine, `路線エイリアス ${alias}: ${expectLine}へ解決 (${rMap[alias] || '未解決'})`);
  }
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
assert(kitaRoute.routes && kitaRoute.routes[0].segments.some(s => s.line === '東京メトロ千代田線' || s.line === 'JR常磐線快速'), '北千住→綾瀬: 千代田線または常磐線で直通（#14で常磐線各停・快速に綾瀬追加）');
const shinbashiRoute = computeRoutes('有楽町', '品川');
assert(shinbashiRoute.routes && shinbashiRoute.routes[0].segments.some(s => (s.line === '京浜東北線' || s.line === 'JR山手線') && s.stops === 5), '有楽町→品川: 京浜東北線または山手線で新橋・浜松町・田町・高輪ゲートウェイ経由（5駅・公式駅順）');
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
