/**
 * v2.51.0 回帰テスト: resolveSuspendedLineNames の旧路線名フォールバック修正
 * 旧実装は ODPT 鉄道ID末尾ローマ字と RAILWAY_NAME_MAP の値（日本語・ローマ字混在）を
 * 直接比較して常に [] を返すバグ。ODPT_RAILWAY_NAME_MAP による明示解決に修正。
 */
import assert from 'node:assert/strict';
import { resolveSuspendedLineNames } from '../src/handlers/search-route.mjs';

// 東武（本件の主対象）: スカイツリーラインは実質伊勢崎線として解決
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Tobu.TobuSkytree'), ['東武伊勢崎線'], 'スカイツリーライン→伊勢崎線');
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Tobu.Isesaki'), ['東武伊勢崎線'], '伊勢崎線');
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Tobu.TobuUrbanPark'), ['東武野田線'], 'アーバンパーク→野田線');
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Tobu.Nikko'), ['東武日光線'], '日光線');
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Tobu.Tojo'), ['東武東上線'], '東上線');

// その他 ODPT 事業者
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:TokyoMetro.Ginza'), ['東京メトロ銀座線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Toei.Oedo'), ['都営大江戸線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Toei.NipporiToneri'), ['日暮里舎人ライナー']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:JR-East.Saikyo'), ['JR埼京線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:TWR.Rinkai'), ['りんかい線']);

// その他 ODPT 実ID（v2.51.0 拡充分）
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Keikyu.Main'), ['京急本線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Odakyu.Odawara'), ['小田急小田原線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Odakyu.Enoshima'), ['小田急江ノ島線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Keio.Keio'), ['京王線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Seibu.Ikebukuro'), ['西武池袋線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Tokyu.Toyoko'), ['東急東横線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Tokyu.DenEnToshi'), ['東急田園都市線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Sotetsu.Main'), ['相鉄本線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Keisei.Main'), ['京成本線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:JR-East.Takasaki'), ['JR高崎線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:JR-East.Ome'), ['JR青梅線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:JR-East.SaikyoKawagoe'), ['JR埼京線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:KantoRailway.Joso'), ['関東鉄道常総線']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Hokuso.Hokuso'), ['北総鉄道']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:SaitamaRailway.SaitamaRailway'), ['埼玉高速鉄道']);
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:TokyoMonorail.HanedaAirport'), ['東京モノレール']);
// グラフ非対応（新幹線・競馬場線）は []（正しい）
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:JR-East.TohokuShinkansen'), [], '新幹線はグラフ非対応');
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Keio.Keibajo'), [], '競馬場線はグラフ非対応');

// 未知ID・空は [] を返す（サイレント）
assert.deepEqual(resolveSuspendedLineNames('odpt.Railway:Unknown.X'), []);
assert.deepEqual(resolveSuspendedLineNames(''), []);

console.log('✅ resolveSuspendedLineNames 旧路線名フォールバック修正: すべて成功');
