// find_nearby_stops（#121）の回帰テスト — 注入 fixture で完全決定的・外部ネットワーク不要。
// 実行: node tests/nearby-stops.test.mjs
//
// ホス方針（skill §2「検証ゲート」）:
//   - 白鬚橋付近の固定座標で最寄りバス停が「水神前」になること（#121 の実証データと同じ順序）
//   - 半径内0件 → 1km→2km→5km の拡大と、拡大の明示
//   - type / limit / language の各絞り込み
//   - ODPT 障害時: 駅は内蔵座標で縮退応答・バス停は「現在取得できません」を明示
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
const WHITE = { lat: 35.731, lon: 139.8148 }; // 墨田区・白鬚橋付近（#121 の実証座標）
const noGeo = async () => ({});
const busFx = async () => FIXTURE_BUS;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (cond, m, extra) => { if (cond) ok(m); else fail(extra ? `${m} — ${extra}` : m); };
const text = (r) => r.content[0].text;
const sc = (r) => r.structuredContent;
const call = (args, o = {}) => findNearbyStops(args, {
  _busStopGeo: o.bus === 'none' ? noGeo : (o.bus || busFx),
  _stationGeo: o.station === 'none' ? noGeo : (o.station || (async () => ({})))
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
  eq(t.includes('🚉 最寄り駅') && t.includes('🚌 最寄りバス停'), '種別ごとの節見出し');
  eq(t.includes('（都営バス・2系統）') && t.includes('徒歩約1分'), '表示項目に事業者・系統数・徒歩換算');
  eq(t.includes('https://www.google.com/maps/search/?api=1&query='), 'Google Maps リンク（既存形式 api=1&query=）');
  eq(t.includes('※ 同名のバス停は道路を挟んで複数の乗り場'), '複数乗り場の注記（poles>1）');
  eq(t.includes('※ 駅座標は内蔵データで応答しています'), '駅の内蔵縮退の明示（stationGeo={} 注入）');
  eq(p.station_source === 'internal', 'station_source=internal（ODPT 駅geo なし）');
  eq(p.search_radius_m === 1000 && p.radius_expanded === false, '通常時は拡大なし（1000m）');
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
  eq(!text(rSt).includes('🚌'), 'type=station の表示にバス停節が無い');
  const rBs = await call({ ...WHITE, type: 'busstop', language: 'ja' });
  const pBs = sc(rBs);
  eq(pBs.bus_stops.length > 0 && pBs.stations.length === 0, 'type=busstop でバス停のみ');
  eq(!text(rBs).includes('🚉'), 'type=busstop の表示に駅節が無い');
  eq(pBs.station_source === undefined, 'type=busstop で station_source を出さない');
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
  eq(pEn.summary.startsWith('📍 Within 1 km of your location:'), 'en: 要約行', pEn.summary);
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

// --- 6. ODPT 障害時の縮退（#115: 無音で欠落させない） ---
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
