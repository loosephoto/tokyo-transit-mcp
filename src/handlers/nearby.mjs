/**
 * 最寄り駅・バス停検索ハンドラ（#121）— 位置情報（緯度経度）から距離順リストを返す。
 *
 * 携帯電話のGPSなど「座標は分かるが名称は分からない」状況向けの入口。
 * 名称検索（search_bus / search_route）と入出力の性質が異なるため独立ツールとする。
 *
 * 依存方向: handlers/nearby → handlers/bus + handlers/search-route + handlers/ferry + data / lib（一方通行）
 *
 * データソース:
 *   駅:     odpt:Station（fetchStationGeo・既存キャッシュ）＋内蔵座標辞書
 *           （STATION_COORDS 本辞書優先 / STATION_COORDS_EXTRA は欠落のみ補完）。
 *           ODPT 障害時は内蔵辞書だけで縮退運転し、その旨を明示する（#115 の教訓: 無音にしない）。
 *   バス停: odpt:BusstopPole（fetchBusStopGeo・既存キャッシュ。都営・西武・横浜市営の3事業者）。
 *           取得不能時は「現在取得できません」を明示し、空結果と区別する。
 *   シェアサイクル（v2.58.31）: GBFS（docomo-cycle-tokyo + HELLOCYCLING・CC BY 4.0）。
 *           貸出可能（is_renting かつ num_bikes_available > 0）なポートのみ表示する。
 *   水上バス・フェリー港（v2.58.31）: フェリーGTFS の stop 座標（fetchFerryData・既存キャッシュ）。
 *           ハードコード代替港は座標を持たないため対象外（東京クルーズGTFS 取得時は全港に座標がある）。
 *
 * プライバシー（#121）: 入力された緯度経度はこのリクエストの処理にしか使わない。
 *   キャッシュへの書き込み・ログ出力・ファイル保存を行わない
 *   （geo キャッシュは座標マップそのものであり、ユーザー位置とは無関係）。
 */
import { BUS_OPERATORS } from '../data/bus-routes.mjs';
import { STATION_COORDS } from '../data/railway-lines.mjs';
import { STATION_COORDS_EXTRA } from '../data/station-coords-extra.mjs';
import { FERRY_PORT_NAMES } from '../data/ferry-ports.mjs';
import { jsonResponse, buildErrorResponse, handleApiError, isInternalError } from '../lib/common.mjs';
import { resolveLang, getDisplayStationName, getLineDisplayName } from '../lib/lang.mjs';
import { kanaToRomaji, simplify, titleCase } from '../lib/kana-romaji.mjs';
import { haversineM } from '../lib/geo.mjs';
import { odptBreaker } from '../config.mjs';
import { fetchBusStopGeo, fetchStationGeo } from './bus.mjs';
import { STATION_TO_LINES, fetchBikeShareData } from './search-route.mjs';
import { fetchFerryData } from './ferry.mjs';

// 徒歩換算: 1分 ≈ 80m（#121 の表示仕様）
const WALK_M_PER_MIN = 80;
const DEFAULT_RADIUS_M = 1000;
const DEFAULT_LIMIT = 5;
// 半径拡大のラダー（#121: 0件のとき無言で空を返さず 1km→2km→5km）
const RADIUS_LADDER_STEPS_M = [2000, 5000];
// ODPT の長音記号（Ō など）は NFD 分解して結合文字を落とし ASCII へ戻す（§5 の既知手順）
const asciiFold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// データソースの表示（payload.data_source。GBFS の HELLOCYCLING は CC BY 4.0）
const NEARBY_DATA_SOURCE = 'odpt:BusstopPole（都営・西武・横浜市営バス）+ odpt:Station + 内蔵駅座標辞書'
  + ' + GBFS（docomo-cycle-tokyo / HELLOCYCLING, CC BY 4.0）+ フェリーGTFS（東海汽船・東京クルーズ）stop座標';

const clampInt = (v, dflt, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

// 半径ラダー: [基準半径, 2000, 5000]（基準半径を超える段のみ。基準が 5km 超なら拡大しない）
function radiusLadder(baseM) {
  const steps = [baseM];
  for (const r of RADIUS_LADDER_STEPS_M) {
    if (r > baseM) steps.push(r);
  }
  return steps;
}

// 内蔵駅座標マップ（本辞書優先・EXTRA は欠落のみ）。ODPT の生値があれば上書き・補完する。
function buildStationGeoMap(odptGeo) {
  const map = {};
  for (const [k, c] of Object.entries(STATION_COORDS)) {
    if (c && typeof c.lat === 'number' && typeof c.lon === 'number') map[k] = { lat: c.lat, lon: c.lon };
  }
  for (const [k, c] of Object.entries(STATION_COORDS_EXTRA)) {
    if (!map[k] && Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
      map[k] = { lat: c[0], lon: c[1] };
    }
  }
  for (const [k, c] of Object.entries(odptGeo || {})) {
    if (c && typeof c.lat === 'number' && typeof c.lon === 'number') map[k] = { lat: c.lat, lon: c.lon };
  }
  return map;
}

// 駅名 → 乗り入れ路線名（ja）。識別子付きキー（赤坂（富士急行線）など）は
// 括弧内の路線名をそのまま使う（STATION_TO_LINES は基本名キーのため衝突しない）。
function linesForStation(name) {
  const exact = STATION_TO_LINES[name];
  if (exact && exact.length) return exact.map((e) => e.line);
  const m = String(name).match(/[（(]([^）)]+)[）)]$/);
  if (m) return [m[1]];
  return [];
}

// 半径内を距離昇順で最大 limit 件（geo エントリの付加フィールドもそのまま持たせる）
function rankNearby(lat, lon, geoMap, radiusM, limit) {
  const out = [];
  for (const [name, c] of Object.entries(geoMap)) {
    const d = haversineM(lat, lon, c.lat, c.lon);
    if (d <= radiusM) out.push({ name, ...c, distance_m: Math.round(d) });
  }
  out.sort((a, b) => a.distance_m - b.distance_m);
  return out.slice(0, limit);
}

const walkMinutes = (distanceM) => Math.max(1, Math.round(distanceM / WALK_M_PER_MIN));

// 距離のローカライズ表記（1km 以上は km 併記）
function fmtDistance(m, lang) {
  if (m >= 1000) {
    const km = m / 1000;
    const s = km >= 10 ? km.toFixed(0) : (Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1));
    return lang === 'en' ? `approx. ${s} km` : lang === 'zh' ? `约${s}公里` : `約${s}km`;
  }
  return lang === 'en' ? `approx. ${m} m` : lang === 'zh' ? `约${m}米` : `約${m}m`;
}

function fmtWalk(m, lang) {
  const min = walkMinutes(m);
  return lang === 'en' ? `about ${min} min walk` : lang === 'zh' ? `步行约${min}分钟` : `徒歩約${min}分`;
}

// 半径の表記用（要約行・拡大注記）
function fmtRadius(m, lang) {
  if (m >= 1000) {
    const km = Number.isInteger(m / 1000) ? `${m / 1000}` : `${(m / 1000).toFixed(1)}`;
    return lang === 'en' ? `${km} km` : lang === 'zh' ? `${km}公里` : `${km}km`;
  }
  return lang === 'en' ? `${m} m` : lang === 'zh' ? `${m}米` : `${m}m`;
}

// Google Maps リンク（既存ツールと同じ api=1 search 形式。名称＋実座標で確実にピン留め）
function mapsUrl(jaName, kind, lat, lon) {
  let label;
  if (kind === 'station') {
    label = /[（(]/.test(jaName) || jaName.endsWith('駅') ? jaName : `${jaName}駅`;
  } else if (kind === 'busstop') {
    label = `${jaName} バス停`;
  } else if (kind === 'bike') {
    label = `${jaName} シェアサイクル`;
  } else if (kind === 'water_bus') {
    label = `${jaName} 水上バス乗り場`;
  } else {
    label = `${jaName} フェリー乗り場`;
  }
  const query = `${label} @${lat},${lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// 東京クルーズ（水上バス）の乗り場名。ferry.mjs の wbPorts（6港）と同一セット。
// GTFS の stop には事業者ラベルが無いため、港名で水上バス/フェリーを分類する。
const WATER_BUS_PORT_NAMES = new Set(['浅草', '浜離宮', '日の出桟橋', 'お台場海浜公園', '豊洲', '竹芝']);

// シェアサイクル事業者の表示ラベル（GBFS network ID → 3言語）
const BIKE_NETWORK_LABELS = {
  'docomo-cycle-tokyo': { ja: 'docomoバイクシェア', en: 'docomo bike share', zh: 'docomo共享单车' },
  'hellocycling': { ja: 'HELLO CYCLING', en: 'HELLO CYCLING', zh: 'HELLO CYCLING' }
};

// 貸出可能なシェアサイクルポートを半径内で距離昇順に（findNearestBikeStations と同じ判定:
// is_renting かつ num_bikes_available > 0 のポートだけを表示する）
function rankBikePorts(lat, lon, bikeData, radiusM, limit) {
  const out = [];
  const statuses = (bikeData && bikeData.statuses) || {};
  for (const s of (bikeData && bikeData.stations) || []) {
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
    const st = statuses[s.station_id];
    if (!st || !st.is_renting || !(st.num_bikes_available > 0)) continue;
    const d = haversineM(lat, lon, s.lat, s.lon);
    if (d <= radiusM) {
      const name = typeof s.name === 'string' ? s.name : (s.name?.ja || s.name?.[0]?.text || '?');
      out.push({
        name, network: s.network, lat: s.lat, lon: s.lon, distance_m: Math.round(d),
        bikes_available: st.num_bikes_available, docks_available: st.num_docks_available
      });
    }
  }
  out.sort((a, b) => a.distance_m - b.distance_m);
  return out.slice(0, limit);
}

// 座標を持つ港を水上バス（東京クルーズ）とフェリー（東海汽船ほか）に分けて半径内で距離昇順に。
// ハードコード代替港（stop_lat/lon = '0'）は座標が無いため除外する。
function rankFerryPorts(lat, lon, stops, radiusM, limit) {
  const out = [];
  for (const s of stops || []) {
    const plat = parseFloat(s.stop_lat), plon = parseFloat(s.stop_lon);
    if (!Number.isFinite(plat) || !Number.isFinite(plon) || (plat === 0 && plon === 0)) continue;
    const d = haversineM(lat, lon, plat, plon);
    if (d <= radiusM) {
      out.push({
        name: s.stop_name,
        kind: WATER_BUS_PORT_NAMES.has(s.stop_name) ? 'water_bus' : 'ferry',
        lat: plat, lon: plon, distance_m: Math.round(d)
      });
    }
  }
  out.sort((a, b) => a.distance_m - b.distance_m);
  return out.slice(0, limit);
}

// 港の座標を持つか（rankFerryPorts と同一の判定）
function portHasCoords(s) {
  const plat = parseFloat(s.stop_lat), plon = parseFloat(s.stop_lon);
  return Number.isFinite(plat) && Number.isFinite(plon) && !(plat === 0 && plon === 0);
}

// バス停の表示名（en は ODPT 公式英語名 → 読みの自前ローマ字化 → 日本語のまま、の順）
function busStopDisplayName(entry, lang) {
  if (lang === 'en') {
    if (entry.titleEn) return asciiFold(entry.titleEn);
    if (entry.kana) {
      const romaji = titleCase(simplify(kanaToRomaji(entry.kana), { ouAtEndOnly: true }));
      if (romaji && /^[A-Za-z]/.test(romaji)) return romaji;
    }
  }
  return entry.name;
}

// 事業者ラベル（BUS_OPERATORS の3言語ラベル）
function operatorLabel(opId, lang) {
  const o = BUS_OPERATORS.find((x) => x.id === opId);
  if (!o) return opId || '';
  return lang === 'en' ? o.labelEn : lang === 'zh' ? o.labelZh : o.label;
}

/**
 * 最寄り駅・バス停検索（#121）。
 * 入力: lat / lon（必須）・type（station|busstop|bike|ferry|all・既定 all）・radius_m（既定 1000）
 *       limit（種別ごとの最大件数・既定 5）・language（ja/en/zh・既定は自動＝座標のみなら ja）。
 * 出力: 構造化 JSON（status SUCCESS / NO_DATA / ERROR）＋携帯向け整形テキスト（displayText）。
 * ctx._busStopGeo / ctx._stationGeo / ctx._bikeShareData / ctx._ferryStops は
 * テスト用のデータ注入フック（本番は各ハンドラのキャッシュ付き fetcher を使う）。
 */
export async function findNearbyStops(args, ctx = {}) {
  const signal = ctx?.signal || null;
  const userLang = resolveLang(args) || 'ja';
  const lat = Number(args?.lat);
  const lon = Number(args?.lon);
  // 座標バリデーション（#121 のシーケンス: 範囲チェック）
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    const msg = userLang === 'en'
      ? 'Please provide numeric latitude/longitude. Example: {"lat": 35.731, "lon": 139.8148}'
      : userLang === 'zh'
        ? '请提供数值型的纬度/经度。例如：{"lat": 35.731, "lon": 139.8148}'
        : '緯度経度（lat / lon）を数値で指定してください。例: {"lat": 35.731, "lon": 139.8148}';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', msg, {
      userLang,
      msgLocale: {
        ja: '緯度経度（lat / lon）を数値で指定してください。例: {"lat": 35.731, "lon": 139.8148}',
        en: 'Please provide numeric latitude/longitude. Example: {"lat": 35.731, "lon": 139.8148}',
        zh: '请提供数值型的纬度/经度。例如：{"lat": 35.731, "lon": 139.8148}'
      }
    }));
  }
  const type = (['station', 'busstop', 'bike', 'ferry'].includes(args?.type)) ? args.type : 'all';
  const wantStation = type === 'all' || type === 'station';
  const wantBus = type === 'all' || type === 'busstop';
  const wantBike = type === 'all' || type === 'bike';
  const wantFerry = type === 'all' || type === 'ferry';
  const baseRadiusM = clampInt(args?.radius_m, DEFAULT_RADIUS_M, 50, 50000);
  const limit = clampInt(args?.limit, DEFAULT_LIMIT, 1, 20);
  const lang = userLang;

  try {
    // geo 取得（テスト注入フック → 既定は各ハンドラのキャッシュ付き fetcher）
    const busGeoFn = ctx?._busStopGeo || fetchBusStopGeo;
    const stGeoFn = ctx?._stationGeo || fetchStationGeo;
    const bikeFn = ctx?._bikeShareData || fetchBikeShareData;
    const ferryFn = ctx?._ferryStops || (async (sig) => (await fetchFerryData(sig)).stops);
    // 補助データソース（シェアサイクル・港）は副次的: 個別の通信失敗で全体を失敗させず
    // 「現在取得できません」に縮退する。キャンセルだけは外側の CANCELLED へ投げ直す。
    const safeFetch = async (fn) => {
      try { return await fn(signal); } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError' || e?.name === 'CanceledError') throw e;
        return null;
      }
    };
    const [busGeo, odptStationGeo, bikeData, ferryStops] = await Promise.all([
      wantBus ? busGeoFn(signal) : Promise.resolve(null),
      wantStation ? stGeoFn(signal) : Promise.resolve(null),
      wantBike ? safeFetch(bikeFn) : Promise.resolve(null),
      wantFerry ? safeFetch(ferryFn) : Promise.resolve(null)
    ]);
    // バス停: 空 map は「取得不能」とみなす（fetchBusStopGeo は全滅時のみ空を返す設計）
    const busAvailable = !!(busGeo && Object.keys(busGeo).length > 0);
    // シェアサイクル: GBFS の取得に一つも成功していない（または通信失敗）なら取得不能
    const bikeAvailable = !!(bikeData && Array.isArray(bikeData.stations)
      && Array.isArray(bikeData.sources) && bikeData.sources.length > 0);
    // 水上バス・フェリー: GTFS が取れずハードコード代替のみ（全港が座標なし）なら取得不能
    const ferryAvailable = !!(ferryStops && Array.isArray(ferryStops) && ferryStops.some(portHasCoords));
    // 単一 type 指定でそのデータだけが取得不能のときは、空結果（NO_DATA）ではなく
    // 「提供不能（ERROR）」を返す（#121: 無音で欠落させない）
    if (wantBus && !busAvailable && !wantStation && !wantBike && !wantFerry) {
      return jsonResponse(dataSourceUnavailableError('busstop', lang));
    }
    if (wantBike && !bikeAvailable && !wantStation && !wantBus && !wantFerry) {
      return jsonResponse(dataSourceUnavailableError('bike', lang));
    }
    if (wantFerry && !ferryAvailable && !wantStation && !wantBus && !wantBike) {
      return jsonResponse(dataSourceUnavailableError('ferry', lang));
    }
    // 駅: 内蔵辞書が常に基盤にあるため、ODPT 断でも縮退運転できる
    const stationGeo = wantStation ? buildStationGeoMap(odptStationGeo) : null;
    const stationSource = !wantStation ? null
      : (odptStationGeo && Object.keys(odptStationGeo).length > 0 ? 'odpt+internal' : 'internal');

    // 種別ごとに半径ラダーを進める（見つかった段の半径をその種別の実効半径とする）
    let stations = [];
    let stationRadiusM = null;
    if (wantStation && stationGeo) {
      for (const r of radiusLadder(baseRadiusM)) {
        stations = rankNearby(lat, lon, stationGeo, r, limit);
        if (stations.length) { stationRadiusM = r; break; }
      }
    }
    let busStops = [];
    let busRadiusM = null;
    if (wantBus && busAvailable) {
      for (const r of radiusLadder(baseRadiusM)) {
        busStops = rankNearby(lat, lon, busGeo, r, limit);
        if (busStops.length) { busRadiusM = r; break; }
      }
    }
    // シェアサイクル・港: ラダー最大半径で一括取得し、最寄りの距離から「見つかった段の半径」を導く
    // （データは一度のフェッチで揃うため、ラダーを段ごとに再フェッチする必要がない）
    let bikePorts = [];
    let bikeRadiusM = null;
    if (wantBike && bikeAvailable) {
      const ladder = radiusLadder(baseRadiusM);
      const hits = rankBikePorts(lat, lon, bikeData, ladder.at(-1), limit);
      if (hits.length) {
        bikePorts = hits;
        bikeRadiusM = ladder.find((r) => r >= hits[0].distance_m) ?? ladder.at(-1);
      }
    }
    let ferryPorts = [];
    let ferryRadiusM = null;
    if (wantFerry && ferryAvailable) {
      const ladder = radiusLadder(baseRadiusM);
      const hits = rankFerryPorts(lat, lon, ferryStops, ladder.at(-1), limit);
      if (hits.length) {
        ferryPorts = hits;
        ferryRadiusM = ladder.find((r) => r >= hits[0].distance_m) ?? ladder.at(-1);
      }
    }

    const anyFound = (wantStation && stations.length > 0) || (wantBus && busStops.length > 0)
      || (wantBike && bikePorts.length > 0) || (wantFerry && ferryPorts.length > 0);

    // ---------- 0件（全滅）: 拡大済みである旨と対応エリア外の可能性を明示して NO_DATA ----------
    if (!anyFound) {
      const lastTriedM = radiusLadder(baseRadiusM).at(-1);
      // 検索対象の語彙（type に応じて）
      const kindsJa = [];
      const kindsEn = [];
      const kindsZh = [];
      if (wantStation) { kindsJa.push('駅'); kindsEn.push('stations'); kindsZh.push('车站'); }
      if (wantBus) { kindsJa.push('バス停'); kindsEn.push('bus stops'); kindsZh.push('公交站'); }
      if (wantBike) { kindsJa.push('シェアサイクルポート'); kindsEn.push('bike share ports'); kindsZh.push('共享单车停靠点'); }
      if (wantFerry) { kindsJa.push('水上バス・フェリー港'); kindsEn.push('water bus / ferry ports'); kindsZh.push('水上巴士/轮渡港口'); }
      const kindJoinJa = kindsJa.join('・'), kindJoinEn = kindsEn.join(' or '), kindJoinZh = kindsZh.join('、');
      const noDataMsg = {
        ja: `半径${fmtRadius(lastTriedM, 'ja')}以内に${kindJoinJa}が見つかりませんでした。海上または対応エリア（東京圏）外の可能性があります。入力した座標が正しいかご確認ください。`,
        en: `No ${kindJoinEn} found within ${fmtRadius(lastTriedM, 'en')}. You may be at sea or outside the covered area (Tokyo region). Please double-check the coordinates.`,
        zh: `半径${fmtRadius(lastTriedM, 'zh')}内未找到${kindJoinZh}。您可能位于海上或服务区域（东京圈）之外。请确认输入的坐标是否正确。`
      };
      const noteTrail = lastTriedM !== baseRadiusM
        ? (lang === 'en' ? `The search radius was expanded automatically: ${fmtRadius(baseRadiusM, 'en')} → ${fmtRadius(lastTriedM, 'en')}.`
          : lang === 'zh' ? `已自动扩大搜索半径：${fmtRadius(baseRadiusM, 'zh')} → ${fmtRadius(lastTriedM, 'zh')}。`
            : `半径を ${fmtRadius(baseRadiusM, 'ja')} → ${fmtRadius(lastTriedM, 'ja')} に拡大して再検索しました。`)
        : '';
      const unavailableNotes = [];
      if (wantBus && !busAvailable) {
        unavailableNotes.push(lang === 'en' ? 'Bus stop data is currently unavailable (upstream outage).'
          : lang === 'zh' ? '公交站数据当前无法获取（上游故障）。'
            : 'バス停情報は現在取得できません（データ提供元の通信障害）。');
      }
      if (wantBike && !bikeAvailable) {
        unavailableNotes.push(lang === 'en' ? 'Bike share data is currently unavailable (GBFS outage).'
          : lang === 'zh' ? '共享单车数据当前无法获取（GBFS 故障）。'
            : 'シェアサイクル情報は現在取得できません（GBFS通信障害）。');
      }
      if (wantFerry && !ferryAvailable) {
        unavailableNotes.push(lang === 'en' ? 'Water bus / ferry port coordinates are currently unavailable (GTFS outage).'
          : lang === 'zh' ? '水上巴士/轮渡港口坐标当前无法获取（GTFS 故障）。'
            : '水上バス・フェリー港の座標は現在取得できません（GTFS取得不可）。');
      }
      const lines = [
        lang === 'en' ? '📍 Nothing found near your location'
          : lang === 'zh' ? '📍 您的位置附近未找到结果'
            : '📍 現在地周辺に見つかりませんでした',
        '',
        noDataMsg[lang],
        noteTrail,
        ...unavailableNotes,
        wantStation && stationSource === 'internal'
          ? (lang === 'en' ? 'Station coordinates were answered from the built-in dictionary (ODPT station data unavailable).'
            : lang === 'zh' ? '车站坐标来自内建数据（无法获取 ODPT 车站数据）。'
              : '駅座標は内蔵データで応答しています（ODPT駅座標を取得できませんでした）。')
          : ''
      ].filter(Boolean);
      const payload = {
        status: 'NO_DATA',
        detected_language: lang,
        query: { lat, lon, type, radius_m: baseRadiusM, limit },
        search_radius_m: lastTriedM,
        radius_expanded: lastTriedM !== baseRadiusM,
        radius_expanded_from_m: lastTriedM !== baseRadiusM ? baseRadiusM : undefined,
        stations: [],
        bus_stops: [],
        bike_ports: [],
        water_bus_piers: [],
        ferry_terminals: [],
        bus_stops_available: wantBus ? busAvailable : undefined,
        bike_share_available: wantBike ? bikeAvailable : undefined,
        ferry_coords_available: wantFerry ? ferryAvailable : undefined,
        station_source: stationSource || undefined,
        message: noDataMsg[lang],
        data_source: NEARBY_DATA_SOURCE,
        privacy_note: lang === 'en' ? 'Your coordinates are used only to process this request; they are not stored or logged.'
          : lang === 'zh' ? '您提供的坐标仅用于本次检索的处理，不会被保存或记录。'
            : '入力された緯度経度はこの検索の処理以外に保存・記録されません。'
      };
      return jsonResponse(payload, { displayText: lines.join('\n') + '\n' });
    }

    // ---------- 項目の組み立て ----------
    const stationItems = stations.map((st) => {
      const linesJa = linesForStation(st.name);
      const item = {
        name: getDisplayStationName(st.name, lang),
        distance_m: st.distance_m,
        distance_text: fmtDistance(st.distance_m, lang),
        walk_min: walkMinutes(st.distance_m),
        walk_text: fmtWalk(st.distance_m, lang),
        lines: linesJa.map((l) => getLineDisplayName(l, lang)),
        maps_url: mapsUrl(st.name, 'station', st.lat, st.lon)
      };
      return item;
    });
    const busItems = busStops.map((bs) => {
      const item = {
        name: busStopDisplayName(bs, lang),
        operator: operatorLabel(bs.operator, lang),
        distance_m: bs.distance_m,
        distance_text: fmtDistance(bs.distance_m, lang),
        walk_min: walkMinutes(bs.distance_m),
        walk_text: fmtWalk(bs.distance_m, lang),
        maps_url: mapsUrl(bs.name, 'busstop', bs.lat, bs.lon)
      };
      if (bs.patterns !== undefined) item.route_patterns = bs.patterns;
      if (bs.poles !== undefined) item.poles = bs.poles;
      return item;
    });
    const bikeItems = bikePorts.map((bp) => {
      const net = BIKE_NETWORK_LABELS[bp.network] || { ja: bp.network || '', en: bp.network || '', zh: bp.network || '' };
      return {
        name: bp.name,
        operator: net[lang] || bp.network || '',
        bikes_available: bp.bikes_available,
        docks_available: bp.docks_available,
        distance_m: bp.distance_m,
        distance_text: fmtDistance(bp.distance_m, lang),
        walk_min: walkMinutes(bp.distance_m),
        walk_text: fmtWalk(bp.distance_m, lang),
        maps_url: mapsUrl(bp.name, 'bike', bp.lat, bp.lon)
      };
    });
    // 港: 水上バス（東京クルーズ）とフェリー（東海汽船ほか）に分けて組み立てる
    const ferryPortDisplayName = (name) => {
      const trans = FERRY_PORT_NAMES[name];
      if (trans && lang !== 'ja' && trans[lang]) return trans[lang];
      return name;
    };
    const portItem = (fp) => ({
      name: ferryPortDisplayName(fp.name),
      kind: fp.kind,
      kind_label: fp.kind === 'water_bus'
        ? (lang === 'en' ? 'Water bus' : lang === 'zh' ? '水上巴士' : '水上バス')
        : (lang === 'en' ? 'Ferry' : lang === 'zh' ? '轮渡' : 'フェリー'),
      distance_m: fp.distance_m,
      distance_text: fmtDistance(fp.distance_m, lang),
      walk_min: walkMinutes(fp.distance_m),
      walk_text: fmtWalk(fp.distance_m, lang),
      maps_url: mapsUrl(fp.name, fp.kind, fp.lat, fp.lon)
    });
    const waterBusItems = ferryPorts.filter((fp) => fp.kind === 'water_bus').map(portItem);
    const ferryItems = ferryPorts.filter((fp) => fp.kind === 'ferry').map(portItem);

    // ---------- 要約行（#121: 一番近いものが一目で分かる） ----------
    // 種別ごと「件数＋見つかった半径」のパーツ列を作り、全種別が同半径なら一行形式、
    // そうでなければ種別ごとに半径を併記する。
    const summaryParts = [];
    if (wantStation) {
      summaryParts.push({
        count: stationItems.length, radiusM: stationRadiusM,
        ja: `駅${stationItems.length}件`,
        en: `${stationItems.length} station${stationItems.length === 1 ? '' : 's'}`,
        zh: `${stationItems.length}个车站`
      });
    }
    if (wantBus && busAvailable) {
      summaryParts.push({
        count: busItems.length, radiusM: busRadiusM,
        ja: `バス停${busItems.length}件`,
        en: `${busItems.length} bus stop${busItems.length === 1 ? '' : 's'}`,
        zh: `${busItems.length}个公交站`
      });
    }
    if (wantBike && bikeAvailable) {
      summaryParts.push({
        count: bikeItems.length, radiusM: bikeRadiusM,
        ja: `シェアサイクル${bikeItems.length}件`,
        en: `${bikeItems.length} bike share port${bikeItems.length === 1 ? '' : 's'}`,
        zh: `${bikeItems.length}个共享单车点`
      });
    }
    if (wantFerry && ferryAvailable) {
      if (waterBusItems.length) {
        summaryParts.push({
          count: waterBusItems.length, radiusM: ferryRadiusM,
          ja: `水上バス${waterBusItems.length}件`,
          en: `${waterBusItems.length} water bus pier${waterBusItems.length === 1 ? '' : 's'}`,
          zh: `${waterBusItems.length}个水上巴士乘船处`
        });
      }
      if (ferryItems.length) {
        summaryParts.push({
          count: ferryItems.length, radiusM: ferryRadiusM,
          ja: `フェリー港${ferryItems.length}件`,
          en: `${ferryItems.length} ferry terminal${ferryItems.length === 1 ? '' : 's'}`,
          zh: `${ferryItems.length}个轮渡港口`
        });
      }
    }
    const lastLadderM = radiusLadder(baseRadiusM).at(-1);
    const partRadius = (p) => (p.radiusM != null ? p.radiusM : lastLadderM);
    const radii = summaryParts.map(partRadius);
    const allSameRadius = summaryParts.length > 0 && radii.every((r) => r === radii[0]);
    let summaryLine;
    if (allSameRadius) {
      const joined = summaryParts.map((p) => p[lang]).join(lang === 'ja' || lang === 'zh' ? '・' : ' · ');
      summaryLine = lang === 'en'
        ? `📍 Within ${fmtRadius(radii[0], 'en')} of your location: ${joined}`
        : lang === 'zh'
          ? `📍 您所在位置半径${fmtRadius(radii[0], 'zh')}内：${joined}`
          : `📍 現在地から半径${fmtRadius(radii[0], 'ja')}以内: ${joined}`;
    } else {
      const pieces = summaryParts.map((p) => {
        const label = p[lang];
        if (lang === 'en') return `${label} within ${fmtRadius(partRadius(p), 'en')}`;
        if (lang === 'zh') return `${label}（半径${fmtRadius(partRadius(p), 'zh')}内）`;
        return `${label}（半径${fmtRadius(partRadius(p), 'ja')}内）`;
      });
      const joined = pieces.join(lang === 'ja' || lang === 'zh' ? '・' : ', ');
      summaryLine = lang === 'en'
        ? `📍 Around your location — ${joined}`
        : lang === 'zh'
          ? `📍 您所在位置附近——${joined}`
          : `📍 現在地周辺: ${joined}`;
    }

    // ---------- 整形テキスト（#121 の出力仕様に沿う） ----------
    const textLines = [summaryLine, ''];
    if (wantStation && stationItems.length) {
      textLines.push(lang === 'en' ? '🚉 Nearest stations' : lang === 'zh' ? '🚉 最近的车站' : '🚉 最寄り駅');
      stationItems.forEach((it, i) => {
        const paren = it.lines.length ? `（${it.lines.join('・')}）` : '';
        textLines.push(`${i + 1}. [${it.name}](${it.maps_url})${paren}${it.distance_text}・${it.walk_text}`);
      });
      textLines.push('');
    }
    if (wantBus && busAvailable && busItems.length) {
      const coverage = lang === 'en' ? 'Toei / Seibu / Yokohama City Bus'
        : lang === 'zh' ? '都营・西武・横滨市营公交' : '都営・西武・横浜市営バス';
      textLines.push(lang === 'en' ? `🚌 Nearest bus stops (${coverage})`
        : lang === 'zh' ? `🚌 最近的公交站（${coverage}）` : `🚌 最寄りバス停（${coverage}）`);
      busItems.forEach((it, i) => {
        const routesPart = it.route_patterns !== undefined && it.route_patterns > 0
          ? (lang === 'en' ? ` · ${it.route_patterns} route${it.route_patterns === 1 ? '' : 's'}`
            : lang === 'zh' ? `・${it.route_patterns}条线路` : `・${it.route_patterns}系統`)
          : '';
        textLines.push(`${i + 1}. [${it.name}](${it.maps_url})（${it.operator}${routesPart}）${it.distance_text}・${it.walk_text}`);
      });
      textLines.push('');
    }
    if (wantBike && bikeAvailable && bikeItems.length) {
      textLines.push(lang === 'en' ? '🚲 Nearest bike share ports (rentable now)'
        : lang === 'zh' ? '🚲 最近的共享单车停靠点（仅显示可租借）'
          : '🚲 最寄りのシェアサイクルポート（貸出可能なポートのみ）');
      bikeItems.forEach((it, i) => {
        const bikesPart = lang === 'en' ? `${it.bikes_available} bike${it.bikes_available === 1 ? '' : 's'} available`
          : lang === 'zh' ? `可借${it.bikes_available}辆`
            : `貸出${it.bikes_available}台`;
        const sep = lang === 'en' ? ' · ' : '・';
        textLines.push(`${i + 1}. [${it.name}](${it.maps_url})（${it.operator}${sep}${bikesPart}）${it.distance_text}・${it.walk_text}`);
      });
      textLines.push('');
    }
    if (wantFerry && ferryAvailable && waterBusItems.length) {
      textLines.push(lang === 'en' ? '🚤 Nearest water bus piers'
        : lang === 'zh' ? '🚤 最近的水上巴士乘船处' : '🚤 最寄りの水上バス乗り場');
      waterBusItems.forEach((it, i) => {
        textLines.push(`${i + 1}. [${it.name}](${it.maps_url}) ${it.distance_text}・${it.walk_text}`);
      });
      textLines.push('');
    }
    if (wantFerry && ferryAvailable && ferryItems.length) {
      textLines.push(lang === 'en' ? '⛴️ Nearest ferry terminals'
        : lang === 'zh' ? '⛴️ 最近的轮渡港口' : '⛴️ 最寄りのフェリー港');
      ferryItems.forEach((it, i) => {
        textLines.push(`${i + 1}. [${it.name}](${it.maps_url}) ${it.distance_text}・${it.walk_text}`);
      });
      textLines.push('');
    }

    // ---------- 注記（無音にしない: 拡大・乗り場・縮退を明示） ----------
    const notes = [];
    if (wantStation && stationItems.length === 0) {
      const maxM = radiusLadder(baseRadiusM).at(-1);
      notes.push(lang === 'en'
        ? `※ No railway stations within ${fmtRadius(maxM, 'en')}.`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(maxM, 'zh')}内没有铁路车站。`
          : `※ 半径${fmtRadius(maxM, 'ja')}以内に鉄道駅が見つかりませんでした。`);
    }
    if (wantStation && stationRadiusM && stationRadiusM > baseRadiusM) {
      notes.push(lang === 'en'
        ? `※ No stations within ${fmtRadius(baseRadiusM, 'en')} — the search was expanded to ${fmtRadius(stationRadiusM, 'en')}.`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(baseRadiusM, 'zh')}内没有车站，已将搜索范围扩大至${fmtRadius(stationRadiusM, 'zh')}。`
          : `※ 駅は半径${fmtRadius(baseRadiusM, 'ja')}内に見つからず、${fmtRadius(stationRadiusM, 'ja')}に拡大して検索しました。`);
    }
    if (wantBus && busAvailable && busRadiusM && busRadiusM > baseRadiusM) {
      notes.push(lang === 'en'
        ? `※ No bus stops within ${fmtRadius(baseRadiusM, 'en')} — the search was expanded to ${fmtRadius(busRadiusM, 'en')}.`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(baseRadiusM, 'zh')}内没有公交站，已将搜索范围扩大至${fmtRadius(busRadiusM, 'zh')}。`
          : `※ バス停は半径${fmtRadius(baseRadiusM, 'ja')}内に見つからず、${fmtRadius(busRadiusM, 'ja')}に拡大して検索しました。`);
    }
    if (wantBus && busAvailable && busItems.length === 0) {
      const cov = lang === 'en' ? 'Toei / Seibu / Yokohama City Bus'
        : lang === 'zh' ? '都营・西武・横滨市营公交' : '都営・西武・横浜市営バス';
      const maxM = radiusLadder(baseRadiusM).at(-1);
      notes.push(lang === 'en'
        ? `※ No covered-operator (${cov}) bus stops within ${fmtRadius(maxM, 'en')}. Other bus operators may serve this area.`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(maxM, 'zh')}内没有覆盖运营商（${cov}）的公交站。该区域可能有其他公交公司运营。`
          : `※ 半径${fmtRadius(maxM, 'ja')}内に対応事業者（${cov}）のバス停が見つかりませんでした。この地域は他社バスの運行エリアの可能性があります。`);
    }
    if (wantBike && bikeAvailable && bikeRadiusM && bikeRadiusM > baseRadiusM) {
      notes.push(lang === 'en'
        ? `※ No rentable bike share ports within ${fmtRadius(baseRadiusM, 'en')} — the search was expanded to ${fmtRadius(bikeRadiusM, 'en')}.`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(baseRadiusM, 'zh')}内没有可租借的共享单车停靠点，已将搜索范围扩大至${fmtRadius(bikeRadiusM, 'zh')}。`
          : `※ シェアサイクルは半径${fmtRadius(baseRadiusM, 'ja')}内に貸出可能ポートが無く、${fmtRadius(bikeRadiusM, 'ja')}に拡大して検索しました。`);
    }
    if (wantBike && bikeAvailable && bikeItems.length === 0) {
      const maxM = radiusLadder(baseRadiusM).at(-1);
      notes.push(lang === 'en'
        ? `※ No rentable bike share ports within ${fmtRadius(maxM, 'en')} (ports exist but no bikes available, or outside the service area).`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(maxM, 'zh')}内没有可租借的共享单车停靠点（可能全部无车可借，或位于服务区外）。`
          : `※ 半径${fmtRadius(maxM, 'ja')}内に貸出可能なシェアサイクルポートが見つかりませんでした（ポートがあっても貸出可能な自転車が無い場合、または対応エリア外です）。`);
    }
    if (wantBike && bikeAvailable && bikeItems.length > 0) {
      notes.push(lang === 'en'
        ? '※ Bike availability changes by the minute; check the official app before renting. Helmets are legally required in Japan.'
        : lang === 'zh'
          ? '※ 可借车辆随时变化，租借前请通过官方应用确认。日本法律要求骑行时佩戴头盔。'
          : '※ 貸出可否・台数は刻々と変わります。利用前に公式アプリでご確認ください（日本ではヘルメット着用が義務です）。');
    }
    if (wantFerry && ferryAvailable && ferryRadiusM && ferryRadiusM > baseRadiusM) {
      notes.push(lang === 'en'
        ? `※ No water bus / ferry ports within ${fmtRadius(baseRadiusM, 'en')} — the search was expanded to ${fmtRadius(ferryRadiusM, 'en')}.`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(baseRadiusM, 'zh')}内没有水上巴士/轮渡港口，已将搜索范围扩大至${fmtRadius(ferryRadiusM, 'zh')}。`
          : `※ 水上バス・フェリーの乗り場は半径${fmtRadius(baseRadiusM, 'ja')}内に無く、${fmtRadius(ferryRadiusM, 'ja')}に拡大して検索しました。`);
    }
    if (wantFerry && ferryAvailable && waterBusItems.length === 0 && ferryItems.length === 0) {
      const maxM = radiusLadder(baseRadiusM).at(-1);
      notes.push(lang === 'en'
        ? `※ No water bus / ferry ports within ${fmtRadius(maxM, 'en')} — you are likely away from Tokyo's waterways.`
        : lang === 'zh'
          ? `※ 半径${fmtRadius(maxM, 'zh')}内没有水上巴士/轮渡港口——您可能远离东京的水路。`
          : `※ 半径${fmtRadius(maxM, 'ja')}以内に水上バス・フェリーの乗り場が見つかりませんでした。水路から離れた場所にいる可能性があります。`);
    }
    if (wantBike && !bikeAvailable) {
      notes.push(lang === 'en'
        ? '⚠️ Bike share data is currently unavailable (GBFS outage). Please retry later; other results above are unaffected.'
        : lang === 'zh'
          ? '⚠️ 共享单车数据当前无法获取（GBFS 故障）。请稍后重试；上方的其他结果不受影响。'
          : '⚠️ シェアサイクル情報は現在取得できません（GBFS通信障害）。しばらく待ってから再試行してください。上記の他の結果には影響しません。');
    }
    if (wantFerry && !ferryAvailable) {
      notes.push(lang === 'en'
        ? '⚠️ Water bus / ferry port coordinates are currently unavailable (GTFS outage). Please retry later; other results above are unaffected.'
        : lang === 'zh'
          ? '⚠️ 水上巴士/轮渡港口坐标当前无法获取（GTFS 故障）。请稍后重试；上方的其他结果不受影响。'
          : '⚠️ 水上バス・フェリー港の座標は現在取得できません（GTFS取得不可）。しばらく待ってから再試行してください。上記の他の結果には影響しません。');
    }
    if (wantBus && busAvailable && busItems.some((it) => (it.poles || 0) > 1)) {
      notes.push(lang === 'en'
        ? '※ A bus stop of the same name can have poles on both sides of the street; the boarding point differs by destination/route.'
        : lang === 'zh'
          ? '※ 同名公交站可能在道路两侧各设乘车站牌，乘车位置因方向/线路而异。'
          : '※ 同名のバス停は道路を挟んで複数の乗り場がある場合があります（方面・系統ごとに乗り場が異なります）。');
    }
    if (wantBus && !busAvailable) {
      notes.push(lang === 'en'
        ? '⚠️ Bus stop data is currently unavailable (upstream outage). Please retry later; station results above are unaffected.'
        : lang === 'zh'
          ? '⚠️ 公交站数据当前无法获取（上游故障）。请稍后重试；上方的车站结果不受影响。'
          : '⚠️ バス停情報は現在取得できません（データ提供元の通信障害）。しばらく待ってから再試行してください。上記の駅結果には影響しません。');
    }
    if (wantStation && stationSource === 'internal') {
      notes.push(lang === 'en'
        ? '※ Station coordinates were answered from the built-in dictionary (ODPT station data unavailable).'
        : lang === 'zh'
          ? '※ 车站坐标来自内建数据（无法获取 ODPT 车站数据）。'
          : '※ 駅座標は内蔵データで応答しています（ODPT駅座標を取得できませんでした）。');
    }
    if (notes.length) {
      textLines.push(...notes, '');
    }

    // ---------- 構造化ペイロード ----------
    const payload = {
      status: 'SUCCESS',
      detected_language: lang,
      query: { lat, lon, type, radius_m: baseRadiusM, limit },
      summary: summaryLine,
      stations: stationItems,
      bus_stops: busItems,
      bike_ports: bikeItems,
      water_bus_piers: waterBusItems,
      ferry_terminals: ferryItems,
      bus_stops_available: wantBus ? busAvailable : undefined,
      bus_operators_covered: wantBus ? BUS_OPERATORS.map((o) => o.id) : undefined,
      bike_share_available: wantBike ? bikeAvailable : undefined,
      ferry_coords_available: wantFerry ? ferryAvailable : undefined,
      station_source: stationSource || undefined
    };
    // 各種別の実効半径（見つかった段の半径）と拡大フラグ
    if (wantStation && stationRadiusM) payload.station_radius_m = stationRadiusM;
    if (wantBus && busAvailable && busRadiusM) payload.bus_stop_radius_m = busRadiusM;
    if (wantBike && bikeAvailable && bikeRadiusM) payload.bike_radius_m = bikeRadiusM;
    if (wantFerry && ferryAvailable && ferryRadiusM) payload.ferry_radius_m = ferryRadiusM;
    const expandedRadii = [
      wantStation && stationRadiusM, wantBus && busAvailable && busRadiusM,
      wantBike && bikeAvailable && bikeRadiusM, wantFerry && ferryAvailable && ferryRadiusM
    ].filter((r) => r && r > baseRadiusM);
    payload.radius_expanded = expandedRadii.length > 0;
    if (expandedRadii.length > 0) payload.radius_expanded_from_m = baseRadiusM;
    // 要約行の実効半径（種別ごとに見つかった半径の最大値）
    payload.search_radius_m = (wantStation && stationRadiusM)
      || (wantBus && busAvailable && busRadiusM)
      || (wantBike && bikeAvailable && bikeRadiusM)
      || (wantFerry && ferryAvailable && ferryRadiusM)
      || baseRadiusM;
    if (wantBus && !busAvailable) {
      payload.bus_stop_note = lang === 'en'
        ? 'Bus stop data is currently unavailable (upstream outage).'
        : lang === 'zh' ? '公交站数据当前无法获取（上游故障）。'
          : 'バス停情報は現在取得できません（データ提供元の通信障害）。';
    }
    if (wantBike && !bikeAvailable) {
      payload.bike_share_note = lang === 'en'
        ? 'Bike share data is currently unavailable (GBFS outage).'
        : lang === 'zh' ? '共享单车数据当前无法获取（GBFS 故障）。'
          : 'シェアサイクル情報は現在取得できません（GBFS通信障害）。';
    }
    if (wantFerry && !ferryAvailable) {
      payload.ferry_note = lang === 'en'
        ? 'Water bus / ferry port coordinates are currently unavailable (GTFS outage).'
        : lang === 'zh' ? '水上巴士/轮渡港口坐标当前无法获取（GTFS 故障）。'
          : '水上バス・フェリー港の座標は現在取得できません（GTFS取得不可）。';
    }
    payload.data_source = NEARBY_DATA_SOURCE;
    payload.privacy_note = lang === 'en'
      ? 'Your coordinates are used only to process this request; they are not stored or logged.'
      : lang === 'zh' ? '您提供的坐标仅用于本次检索的处理，不会被保存或记录。'
        : '入力された緯度経度はこの検索の処理以外に保存・記録されません。';

    return jsonResponse(payload, { displayText: textLines.join('\n').trimEnd() + '\n' });
  } catch (error) {
    // キャンセルは API エラーにしない（v2.58.16 の CANCELLED 統一方針）
    if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'CanceledError') {
      return jsonResponse({ status: 'CANCELLED', cancelled: true, message: 'Request cancelled.' }, { isError: true });
    }
    // 内部エラー（実装バグ）はブレーカー失敗として数えない（#91 方針）
    if (!isInternalError(error)) odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}

// 単一 type 指定でそのデータだけが取得不能のときのエラー語彙。
// 「データ無し（NO_DATA）」ではなく「提供不能」であることが利用者に伝わるよう独立型とする。
const DATA_UNAVAILABLE_KINDS = {
  busstop: {
    ja: 'バス停情報は現在取得できません（データ提供元の通信障害）。しばらく待ってから再試行してください。',
    en: 'Bus stop data is currently unavailable (upstream outage). Please retry later.',
    zh: '公交站数据当前无法获取（上游故障）。请稍后重试。'
  },
  bike: {
    ja: 'シェアサイクル情報は現在取得できません（GBFS通信障害）。しばらく待ってから再試行してください。',
    en: 'Bike share data is currently unavailable (GBFS outage). Please retry later.',
    zh: '共享单车数据当前无法获取（GBFS 故障）。请稍后重试。'
  },
  ferry: {
    ja: '水上バス・フェリー港の座標は現在取得できません（GTFS取得不可）。しばらく待ってから再試行してください。',
    en: 'Water bus / ferry port coordinates are currently unavailable (GTFS outage). Please retry later.',
    zh: '水上巴士/轮渡港口坐标当前无法获取（GTFS 故障）。请稍后重试。'
  }
};
export function dataSourceUnavailableError(kind, lang) {
  const k = DATA_UNAVAILABLE_KINDS[kind] || DATA_UNAVAILABLE_KINDS.busstop;
  return buildErrorResponse('DATA_UNAVAILABLE', k[lang] || k.ja, {
    userLang: lang,
    msgLocale: { ja: k.ja, en: k.en, zh: k.zh }
  });
}
