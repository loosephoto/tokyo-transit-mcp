// find_nearby_stops（#121 / v2.58.31 拡張）の回帰テスト — 注入 fixture で完全決定的・外部ネットワーク不要。
// 実行: node tests/nearby-stops.test.mjs
//
// ホス方針（skill §2「検証ゲート」）:
//   - 白鬚橋付近の固定座標で最寄りバス停が「水神前」になること（#121 の実証データと同じ順序）
//   - 半径内0件 → 1km→2km→5km の拡大と、拡大の明示
//   - type / limit / language の各絞り込み（v2.58.31: bike / ferry を含む5値）
//   - シェアサイクル: 貸出可能ポートだけが距離順で出ること（is_renting / 台数0 は除外）
//   - 水上バス・フェリー: kind 分離・座標なし港の除外・拡大
//   - ODPT/GBFS/GTFS 障害時: 駅は内蔵座標で縮退応答、他は「現在取得できません」を明示
//   - 入力座標がキャッシュ・ログに残らないこと（プライバシー）
//
// fixture の座標は 2026-11-19 に ODPT odpt:BusstopPole（都営）から実測したもの。
// バス停名ごとの距離（白鬚橋付近 35.731,139.8148 から）:
//   水神前 66m / 白鬚橋 246m / 墨田二丁目 414m / 白鬚橋東 441m
//   （#121 本文の実証テーブル: 87m / 277m / 459m / 450m と同じ順序）
import { findNearbyStops } from '../src/handlers/nearby.mjs';
import { haversineM } from '../src/lib/geo.mjs';
import { cache } from '../src/config.mjs';
import { STATION_DISPLAY_NAMES } from '../src/data/station-names.mjs';

const FIXTURE_BUS = {
  '水神前': { lat: 35.731586, lon: 139.814692, operator: 'Toei', poles: 2, patterns: 2, titleEn: 'Suijin-Mae', kana: 'すいじんまえ' },
  '白鬚橋': { lat: 35.728977, lon: 139.813706, operator: 'Toei', poles: 2, patterns: 2, titleEn: 'Sirahigebashi', kana: 'しらひげばし' },
  '墨田二丁目': { lat: 35.734241, lon: 139.817064, operator: 'Toei', poles: 2, patterns: 1, titleEn: 'Sumida-Nichōme (Sumida 2)', kana: 'すみだにちょうめ' },
  '白鬚橋東': { lat: 35.727097, lon: 139.813939, operator: 'Toei', poles: 2, patterns: 4, titleEn: 'Shirahigebashi-Higashi', kana: 'しらひげばしひがし' }
};
// シェアサイクル（GBFS と同じ形状）: 白鬚橋付近からの距離は
//   白鬚橋サイクルポート 約106m（貸出可5台）/ 貸出停止ポート 約58m（is_renting=false）/ ゼロ台ポート 約119m（台数0）
const FIXTURE_BIKE = {
  sources: ['docomo-cycle-tokyo'],
  stations: [
    { station_id: 'b1', name: '白鬚橋サイクルポート', lat: 35.7319, lon: 139.8152, network: 'docomo-cycle-tokyo' },
    { station_id: 'b2', name: '貸出停止ポート', lat: 35.7315, lon: 139.8150, network: 'docomo-cycle-tokyo' },
    { station_id: 'b3', name: 'ゼロ台ポート', lat: 35.7320, lon: 139.8140, network: 'docomo-cycle-tokyo' }
  ],
  statuses: {
    b1: { is_renting: true, num_bikes_available: 5, num_docks_available: 2 },
    b2: { is_renting: false, num_bikes_available: 3, num_docks_available: 0 },
    b3: { is_renting: true, num_bikes_available: 0, num_docks_available: 7 }
  }
};
// 水上バス・フェリー港（フェリーGTFS の stop と同じ形状）:
//   浅草（水上バス）実測座標・白鬚橋から約2.6km / 東京・竹芝（フェリー）約9.7km / 竹芝（別名・座標なし）
const FIXTURE_FERRY_STOPS = [
  { stop_id: 's1', stop_name: '浅草', stop_lat: '35.7102', stop_lon: '139.8012' },
  { stop_id: 's2', stop_name: '東京・竹芝', stop_lat: '35.6547', stop_lon: '139.7630' },
  { stop_id: 's3', stop_name: '竹芝', stop_lat: '0', stop_lon: '0' }
];
const WHITE = { lat: 35.731, lon: 139.8148 }; // 墨田区・白鬚橋付近（#121 の実証座標）
const noGeo = async () => ({});
const noBike = async () => ({ sources: [], stations: [], statuses: {} });
const noFerryCoords = async () => [{ stop_id: 'hc', stop_name: '竹芝', stop_lat: '0', stop_lon: '0' }];
const busFx = async () => FIXTURE_BUS;
const bikeFx = async () => FIXTURE_BIKE;
const ferryFx = async () => FIXTURE_FERRY_STOPS;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (cond, m, extra) => { if (cond) ok(m); else fail(extra ? `${m} — ${extra}` : m); };
const text = (r) => r.content[0].text;
const sc = (r) => r.structuredContent;
const call = (args, o = {}) => findNearbyStops(args, {
  _busStopGeo: o.bus === 'none' ? noGeo : (o.bus || busFx),
  _stationGeo: o.station === 'none' ? noGeo : (o.station || (async () => ({}))),
  _bikeShareData: o.bike === 'none' ? noBike : (o.bike || bikeFx),
  _ferryStops: o.ferry === 'none' ? noFerryCoords : (o.ferry || ferryFx)
});

console.log('=== find_nearby_stops 回帰テスト（#121） ===');

// --- 1. 白鬚橋付近: 最寄りバス停が水神前・距離順・徒歩換算 ---
{
  const r = await call({ ...WHITE, language: 'ja' });
  const p = sc(r);
  eq(p.status === 'SUCCESS', 'status SUCCESS', JSON.stringify(p.status));
  eq(p.stations.length > 0 && p.stations[0].name === '鐘ヶ淵', '最寄り駅は鐘ヶ淵（内蔵座標）', JSON.stringify(p.stations.map(s => s.name)));
  eq(p.stations[0].lines.includes('東武伊勢崎線'), '鐘ヶ淵の乗り入れ路線に東武伊勢崎線', JSON.stringify(p.stations[0].lines));
  const expect66 = Math.round(haversineM(WHITE.lat, WHITE.lon, FIXTURE_BUS['水神前'].lat, FIXTURE_BUS['水神前'].lon));
  eq(p.bus_stops[0].name === '水神前' && p.bus_stops[0].distance_m === expect66, '最寄りバス停は水神前（距離一致）',
    JSON.stringify({ got: p.bus_stops[0] }));
  eq(p.bus_stops.map(b => b.name).join('>') === '水神前>白鬚橋>墨田二丁目>白鬚橋東', 'バス停の距離昇順（#121 実証テーブルと同じ順序）',
    p.bus_stops.map(b => b.name).join('>'));
  eq(p.bus_stops.every((b, i, a) => i === 0 || a[i - 1].distance_m <= b.distance_m), 'distance_m が昇順');
  eq(p.bus_stops[0].operator === '都営バス' && p.bus_stops[0].route_patterns === 2, '事業者ラベル・系統数（都営バス・2系統）',
    JSON.stringify(p.bus_stops[0]));
  eq(p.bus_stops[0].walk_min === Math.max(1, Math.round(expect66 / 80)), '徒歩換算が 80m/分（水神前）');
  const kane = p.stations[0];
  eq(kane.walk_min === Math.max(1, Math.round(kane.distance_m / 80)), '徒歩換算が 80m/分（鐘ヶ淵 599m→7分）', `${kane.distance_m}m→${kane.walk_min}分`);
  const t = text(r);
  eq(t.includes('📍') && t.includes('駅1件') === false && t.includes('駅2件'), '要約行に件数（駅2件）');
  eq(t.includes('シェアサイクル1件（半径1km内）') && t.includes('水上バス1件（半径5km内）'), '要約行にシェアサイクル・水上バスの件数と実効半径');
  eq(t.includes('🚉 最寄り駅') && t.includes('🚌 最寄りバス停'), '種別ごとの節見出し');
  eq(t.includes('🚲 最寄りのシェアサイクルポート') && t.includes('🚤 最寄りの水上バス乗り場'), 'シェアサイクル・水上バスの節見出し');
  eq(t.includes('（都営バス・2系統）') && t.includes('徒歩約1分'), '表示項目に事業者・系統数・徒歩換算');
  eq(p.bike_ports[0] && p.bike_ports[0].name === '白鬚橋サイクルポート' && p.bike_ports[0].bikes_available === 5,
    'シェアサイクル: 最寄りは白鬚橋サイクルポート（貸出5台）', JSON.stringify(p.bike_ports[0]));
  eq(p.bike_ports.length === 1 && !p.bike_ports.some(b => b.name === '貸出停止ポート' || b.name === 'ゼロ台ポート'),
    'シェアサイクル: is_renting=false と台数0のポートは除外');
  eq(p.water_bus_piers.length === 1 && p.water_bus_piers[0].name === '浅草' && p.water_bus_piers[0].kind === 'water_bus',
    '水上バス: 浅草を water_bus kind で返す', JSON.stringify(p.water_bus_piers[0]));
  eq(p.ferry_terminals.length === 0, 'フェリー: 東京・竹芝（9.7km）は5km圏外で出ない');
  eq(p.ferry_radius_m === 5000 && p.radius_expanded === true, '水上バスは 2.6km → 5km 段で発見（拡大フラグ）');
  eq(p.bike_share_available === true && p.ferry_coords_available === true, 'bike/ferry の availability フラグ');
  eq(t.includes('https://www.google.com/maps/search/?api=1&query='), 'Google Maps リンク（既存形式 api=1&query=）');
  eq(t.includes('※ 同名のバス停は道路を挟んで複数の乗り場'), '複数乗り場の注記（poles>1）');
  eq(t.includes('※ 駅座標は内蔵データで応答しています'), '駅の内蔵縮退の明示（stationGeo={} 注入）');
  eq(p.station_source === 'internal', 'station_source=internal（ODPT 駅geo なし）');
  eq(p.station_radius_m === 1000 && p.bus_stop_radius_m === 1000 && p.bike_radius_m === 1000,
    '駅/バス停/シェアサイクルは基準半径 1000m 内で発見');
  eq(p.privacy_note.includes('保存・記録されません'), 'プライバシー注記');
}

// --- 2. 海上（半径内0件）: 1km→2km→5km 拡大の明示と NO_DATA ---
{
  const r = await call({ lat: 30.0, lon: 140.0, type: 'busstop', language: 'ja' });
  const p = sc(r);
  eq(p.status === 'NO_DATA', '海上座標は NO_DATA', JSON.stringify(p.status));
  eq(p.search_radius_m === 5000, '最終試行半径 5000m');
  eq(p.radius_expanded === true && p.radius_expanded_from_m === 1000, '拡大フラグと元半径の明示');
  eq(p.message.includes('海上または対応エリア（東京圏）外の可能性'), '対応エリア外の可能性を明示', p.message);
  const t = text(r);
  eq(t.includes('半径を 1km → 5km に拡大して再検索しました'), '拡大の過程を明示');
}

// --- 3. 拡大でヒット: 2km 段で見つかる ---
{
  const r = await call({ lat: WHITE.lat + 0.021, lon: WHITE.lon, type: 'busstop', language: 'ja' });
  const p = sc(r);
  eq(p.status === 'SUCCESS' && p.bus_stops.length === 1, '2km 段で1件ヒット', JSON.stringify(p.status));
  eq(p.bus_stop_radius_m === 2000 && p.radius_expanded === true, 'bus_stop_radius_m=2000・拡大フラグ');
  eq(p.search_radius_m === 2000, 'search_radius_m=2000');
  eq(text(r).includes('半径1km内に見つからず、2kmに拡大して検索しました'), '拡大ヒットの注記');
  eq(p.bus_stops[0].distance_text.includes('km'), '1km 以上は km 併記', p.bus_stops[0].distance_text);
}

// --- 4. type / limit の絞り込み ---
{
  const rSt = await call({ ...WHITE, type: 'station', language: 'ja' });
  const pSt = sc(rSt);
  eq(pSt.stations.length > 0 && pSt.bus_stops.length === 0, 'type=station で駅のみ');
  eq(!text(rSt).includes('🚌') && !text(rSt).includes('🚲') && !text(rSt).includes('🚤'),
    'type=station の表示にバス停/シェアサイクル/水上バス節が無い');
  const rBs = await call({ ...WHITE, type: 'busstop', language: 'ja' });
  const pBs = sc(rBs);
  eq(pBs.bus_stops.length > 0 && pBs.stations.length === 0, 'type=busstop でバス停のみ');
  eq(!text(rBs).includes('🚉') && !text(rBs).includes('🚲'), 'type=busstop の表示に駅/シェアサイクル節が無い');
  eq(pBs.station_source === undefined, 'type=busstop で station_source を出さない');
  const rBk = await call({ ...WHITE, type: 'bike', language: 'ja' });
  const pBk = sc(rBk);
  eq(pBk.status === 'SUCCESS' && pBk.bike_ports.length === 1 && pBk.stations.length === 0 && pBk.bus_stops.length === 0,
    'type=bike でシェアサイクルのみ');
  eq(text(rBk).includes('🚲') && !text(rBk).includes('🚉') && !text(rBk).includes('🚌'), 'type=bike の表示にシェアサイクル節だけ');
  eq(pBk.bike_share_available === true && pBk.bus_stops_available === undefined, 'type=bike で bike の availability のみ');
  const rFr = await call({ ...WHITE, type: 'ferry', language: 'ja' });
  const pFr = sc(rFr);
  eq(pFr.status === 'SUCCESS' && pFr.water_bus_piers.length === 1 && pFr.ferry_terminals.length === 0,
    'type=ferry で水上バスのみ（フェリーは5km圏外）');
  eq(text(rFr).includes('🚤') && !text(rFr).includes('🚉'), 'type=ferry の表示に水上バス節だけ');
  eq(pFr.ferry_coords_available === true, 'type=ferry の availability フラグ');
  const rLim = await call({ ...WHITE, limit: 2, language: 'ja' });
  const pLim = sc(rLim);
  eq(pLim.bus_stops.length === 2 && pLim.stations.length === 2, 'limit=2 が種別ごとに効く');
  const rRadius = await call({ ...WHITE, radius_m: 100, type: 'busstop', language: 'ja' });
  const pR = sc(rRadius);
  eq(pR.bus_stops.length === 1 && pR.bus_stops[0].name === '水神前', 'radius_m=100 で水神前のみ', JSON.stringify(pR.bus_stops));
}

// --- 5. 多言語（en / zh） ---
{
  const rEn = await call({ ...WHITE, language: 'en' });
  const pEn = sc(rEn);
  eq(pEn.bus_stops[0].name === 'Suijin-Mae', 'en: ODPT 公式英語名');
  const sumida = pEn.bus_stops.find(b => b.distance_m > 400 && b.distance_m < 420);
  eq(sumida && sumida.name === 'Sumida-Nichome (Sumida 2)', 'en: 長音記号 Ō を ASCII へ折りたたみ', JSON.stringify(sumida));
  eq(pEn.bus_stops[0].distance_text === 'approx. 66 m' && pEn.bus_stops[0].walk_text === 'about 1 min walk', 'en: 距離・徒歩の表記');
  eq(pEn.stations[0].name === (STATION_DISPLAY_NAMES['鐘ヶ淵'] || {}).en, 'en: 駅名が駅名辞書の英語表記', JSON.stringify(pEn.stations[0]));
  const tEn = text(rEn);
  eq(tEn.includes('🚉 Nearest stations') && tEn.includes('🚌 Nearest bus stops'), 'en: 節見出し');
  eq(tEn.includes('🚲 Nearest bike share ports') && tEn.includes('🚤 Nearest water bus piers'), 'en: bike/水上バスの節見出し');
  eq(pEn.summary.includes('1 bike share port within 1 km') && pEn.summary.includes('1 water bus pier within 5 km'),
    'en: 要約行（種別ごとの実効半径）', pEn.summary);
  eq(pEn.bike_ports[0].operator === 'docomo bike share' && tEn.includes('5 bikes available'), 'en: bike の事業者ラベル・台数表記');
  eq(pEn.water_bus_piers[0].name === 'Asakusa', 'en: 水上バス港名は辞書の英語表記', JSON.stringify(pEn.water_bus_piers[0]));
  const rZh = await call({ ...WHITE, language: 'zh' });
  const pZh = sc(rZh);
  eq(pZh.bus_stops[0].name === '水神前', 'zh: バス停名は日本語表記のまま（kanji 共有）');
  eq(pZh.bus_stops[0].distance_text === '约66米' && pZh.bus_stops[0].walk_text === '步行约1分钟', 'zh: 距離・徒歩の表記');
  eq(text(rZh).includes('🚉 最近的车站') && text(rZh).includes('🚌 最近的公交站'), 'zh: 節見出し');
  // titleEn が無い停留所は読み（odpt:kana）を自前ローマ字化する
  const NO_EN = { '橋場二丁目': { lat: 35.7391, lon: 139.8095, operator: 'Toei', poles: 1, patterns: 1, kana: 'はしばにちょうめ' } };
  const rKana = await findNearbyStops({ ...WHITE, type: 'busstop', language: 'en' }, { _busStopGeo: async () => NO_EN, _stationGeo: noGeo });
  const pKana = sc(rKana);
  eq(pKana.bus_stops[0].name === 'Hashibani Chome' || /^[A-Za-z]/.test(pKana.bus_stops[0].name), 'en: titleEn 無しは kana→ローマ字化', JSON.stringify(pKana.bus_stops[0]));
}

// --- 6. ODPT/GBFS/GTFS 障害時の縮退（#115: 無音で欠落させない） ---
{
  // 駅geo 取得不可 → 内蔵座標で縮退応答し明示
  const r1 = await call({ ...WHITE }, { station: 'none' });
  eq(sc(r1).status === 'SUCCESS' && sc(r1).stations.length > 0, '駅geo なしでも内蔵座標で駅を応答');
  eq(sc(r1).station_source === 'internal' && text(r1).includes('内蔵データ'), '内蔵縮退の明示');
  // バス停geo 取得不可 → 明示エラー（type=busstop）
  const r2 = await call({ ...WHITE, type: 'busstop', language: 'en' }, { bus: 'none' });
  eq(sc(r2).status === 'ERROR' && sc(r2).error_type === 'DATA_UNAVAILABLE', 'type=busstop でバス停不可は ERROR/DATA_UNAVAILABLE',
    JSON.stringify({ s: sc(r2).status, e: sc(r2).error_type }));
  eq(sc(r2).suggestion_key === 'DATA_UNAVAILABLE', 'DATA_UNAVAILABLE の提案キー');
  // type=all では駅を応答しつつバス停不可を注記
  const r3 = await call({ ...WHITE, language: 'ja' }, { bus: 'none', station: 'none' });
  const p3 = sc(r3);
  eq(p3.status === 'SUCCESS' && p3.bus_stops_available === false, 'type=all: 駅応答 + bus_stops_available=false');
  eq(!!p3.bus_stop_note && text(r3).includes('⚠️ バス停情報は現在取得できません'), 'バス停不可の注記（⚠️）');
  // シェアサイクル GBFS 取得不可（type=bike）→ ERROR、type=all → 注記
  const r4 = await call({ ...WHITE, type: 'bike', language: 'ja' }, { bike: 'none' });
  eq(sc(r4).status === 'ERROR' && sc(r4).error_type === 'DATA_UNAVAILABLE'
    && sc(r4).error_message.includes('シェアサイクル'), 'type=bike で GBFS 不可は ERROR（自転車文言）');
  const r5 = await call({ ...WHITE, language: 'ja' }, { bike: 'none' });
  eq(sc(r5).status === 'SUCCESS' && sc(r5).bike_share_available === false
    && text(r5).includes('⚠️ シェアサイクル情報は現在取得できません'), 'type=all: bike 不可は駅/バス停/港を返しつつ注記');
  // 水上バス・フェリー GTFS 座標なし（type=ferry）→ ERROR、type=all → 注記
  const r6 = await call({ ...WHITE, type: 'ferry', language: 'ja' }, { ferry: 'none' });
  eq(sc(r6).status === 'ERROR' && sc(r6).error_type === 'DATA_UNAVAILABLE'
    && sc(r6).error_message.includes('水上バス・フェリー港'), 'type=ferry で座標なしは ERROR（港文言）');
  const r7 = await call({ ...WHITE, language: 'ja' }, { ferry: 'none' });
  eq(sc(r7).status === 'SUCCESS' && sc(r7).ferry_coords_available === false
    && text(r7).includes('水上バス・フェリー港の座標は現在取得できません'), 'type=all: ferry 不可は他種別を返しつつ注記');
}

// --- 6b. シェアサイクル・港の拡大と kind 分離（v2.58.31） ---
{
  // シェアサイクル: 1.9km 先のポートだけ → 2km 段で発見
  const FAR_BIKE = {
    sources: ['hellocycling'],
    stations: [
      { station_id: 'f1', name: '遠いポート', lat: WHITE.lat + 0.017, lon: WHITE.lon, network: 'hellocycling' }
    ],
    statuses: { f1: { is_renting: true, num_bikes_available: 2, num_docks_available: 4 } }
  };
  const r1 = await call({ ...WHITE, type: 'bike', language: 'ja' }, { bike: (async () => FAR_BIKE) });
  const p1 = sc(r1);
  eq(p1.status === 'SUCCESS' && p1.bike_ports.length === 1, 'bike: 1.9km 先のポートを1件');
  eq(p1.bike_radius_m === 2000 && p1.radius_expanded === true && p1.radius_expanded_from_m === 1000,
    'bike: 1km→2km 拡大で発見（bike_radius_m=2000）', JSON.stringify({ r: p1.bike_radius_m, e: p1.radius_expanded }));
  eq(text(r1).includes('シェアサイクルは半径1km内に貸出可能ポートが無く、2kmに拡大して検索しました'), 'bike: 拡大の注記');
  eq(p1.bike_ports[0].operator === 'HELLO CYCLING', 'bike: hellocycling のラベル');

  // 港: 浅草隣接座標で水上バス（浅草）とフェリー（東京・竹芝）の両 kind を同時返す
  const BOTH_FERRY = [
    { stop_id: 's1', stop_name: '浅草', stop_lat: '35.7102', stop_lon: '139.8012' },
    { stop_id: 's2', stop_name: '東京・竹芝', stop_lat: '35.7120', stop_lon: '139.8050' }
  ];
  const r2 = await call({ lat: 35.711, lon: 139.80, type: 'ferry', language: 'ja' }, { ferry: (async () => BOTH_FERRY) });
  const p2 = sc(r2);
  eq(p2.water_bus_piers.length === 1 && p2.ferry_terminals.length === 1, 'ferry: 水上バスとフェリーを同時返す');
  eq(p2.water_bus_piers[0].kind === 'water_bus' && p2.ferry_terminals[0].kind === 'ferry'
    && p2.ferry_terminals[0].kind_label === 'フェリー', 'ferry: kind と kind_label の分離');
  const t2 = text(r2);
  eq(t2.includes('🚤 最寄りの水上バス乗り場') && t2.includes('⛴️ 最寄りのフェリー港'), 'ferry: 種別ごとの節見出し');
  eq(t2.includes('浅草 約140m') || /浅草.*約1[34]\dm/.test(t2), 'ferry: 浅草の距離表記（約140m）', t2.split('\n')[2]);
  // zh でも両 kind の節が出る
  const r3 = await call({ lat: 35.711, lon: 139.80, type: 'ferry', language: 'zh' }, { ferry: (async () => BOTH_FERRY) });
  eq(text(r3).includes('最近的水上巴士乘船处') && text(r3).includes('最近的轮渡港口'), 'zh: 水上バス・フェリーの節見出し');
  eq(sc(r3).water_bus_piers[0].name === '浅草', 'zh: 港名の日本語表記（kanji 共有）');
}

// --- 7. 入力バリデーション ---
{
  const rMissing = await call({ lon: 139.8148, language: 'ja' });
  eq(sc(rMissing).status === 'ERROR' && sc(rMissing).error_type === 'INVALID_INPUT', 'lat 欠落は INVALID_INPUT');
  const rRange = await call({ lat: 200, lon: 139.8148, language: 'ja' });
  eq(sc(rRange).status === 'ERROR' && sc(rRange).error_type === 'INVALID_INPUT', 'lat 範囲外は INVALID_INPUT');
  const rEn = await call({ lon: 139.8148, language: 'en' });
  eq(sc(rEn).error_message.includes('latitude/longitude'), 'INVALID_INPUT の英語文言');
}

// --- 8. プライバシー: 座標がキャッシュへ書き込まれない ---
{
  const before = new Set(cache._store.keys());
  await call({ ...WHITE, radius_m: 777, limit: 3, language: 'ja' });
  const after = new Set(cache._store.keys());
  const added = [...after].filter(k => !before.has(k));
  eq(added.length === 0, '呼び出しでキャッシュキーが増えない（座標を保存しない）', JSON.stringify(added));
  const leaked = [...cache._store.entries()].some(([, v]) => JSON.stringify(v).includes('35.731'));
  eq(!leaked, 'キャッシュ値に入力座標が含まれない');
}

console.log('');
if (failures === 0) {
  console.log('✅ find_nearby_stops 回帰テスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ find_nearby_stops 回帰テスト: ${failures} 件の失敗`);
  process.exit(1);
}
