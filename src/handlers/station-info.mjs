/**
 * 駅情報・事業者一覧ハンドラ（モノリス分割 Phase 4b-5）
 * 依存: config / data / lib / advice / handlers/search-route（駅名解決）
 */
import { cache, odptBreaker, API_BASE_URL, API_KEY } from '../config.mjs';
import { OPERATOR_MAP, NON_RAIL_OPERATORS } from '../data/misc.mjs';
import { RAILWAY_NAME_MAP, ODPT_RAILWAY_NAME_MAP } from '../data/station-names.mjs';
import { RAILWAY_LINES } from '../data/railway-lines.mjs';
import { TOKYO_COMMUNITY_BUSES } from '../data/bus-routes.mjs';
import { getParams, jsonResponse, buildErrorResponse, handleApiError, buildGovFacilitySearchSupport, isInternalError } from '../lib/common.mjs';
import { resolveLang, detectLanguage, getDisplayStationName, getLineDisplayName, getDisplayLineName } from '../lib/lang.mjs';
import { normalizeStationName, resolveStation, getStationRomanToJa, getDestinationCulturalFacilities, STATION_TO_LINES } from './search-route.mjs';
import { parseTestMode, buildTestAdvice, getTransitAdvice, detectFailureType } from '../advice/transit-advice.mjs';
import { isEarthquakeSimulation, buildEarthquakeSafetyResponse } from '../advice/earthquake.mjs';
import axios from 'axios';

// 事業者ID→路線名プレフィックス（getOperatorRoutes の路線名→事業者逆引き・内蔵グラフ補完に使用）
const LOCAL_LINE_PREFIX = {
  'JR-East': 'JR', 'TokyoMetro': '東京メトロ', 'Toei': '都営',
  'Odakyu': '小田急', 'Keio': '京王', 'Seibu': '西武', 'Tobu': '東武',
  'Keikyu': '京急', 'Keisei': '京成', 'Sotetsu': '相鉄', 'Tokyu': '東急',
  'YokohamaMunicipal': '横浜市営地下鉄', 'MIR': 'つくばエクスプレス', 'TWR': 'りんかい線',
  'Yurikamome': 'ゆりかもめ', 'Minatomirai': 'みなとみらい線', 'TsukubaExpress': 'つくばエクスプレス',
  'KantoRailway': '関東鉄道', 'SaitamaRailway': '埼玉高速鉄道', 'ToyoRapid': '東葉高速鉄道'
};

function buildInternalStationFallback(stationName, userLang) {
  const localLines = STATION_TO_LINES[stationName] || [];
  if (localLines.length === 0) return null;
  const displayStation = getDisplayStationName(stationName, userLang);
  const fallbackResults = localLines.map(entry => ({
    id: `local:${entry.line}:${stationName}`,
    name: displayStation,
    code: `${entry.index + 1}`,
    line: getLineDisplayName(entry.line, userLang),
    source: 'internal_graph'
  }));
  return jsonResponse({
    status: "SUCCESS", detected_language: userLang, station: displayStation,
    source: "internal_graph_fallback", results: fallbackResults,
    note: userLang === 'en'
      ? "This station is not in the ODPT dataset or ODPT is unavailable; shown from the built-in route graph."
      : userLang === 'zh'
        ? "该车站不在ODPT数据集中或ODPT暂时不可用，已从内置路线图显示。"
        : "この駅はODPTデータにないかODPTが利用できないため、内蔵路線グラフから表示しています。",
    cultural_facilities: getDestinationCulturalFacilities(stationName, userLang).length
      ? getDestinationCulturalFacilities(stationName, userLang) : undefined,
    gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, displayStation)
  });
}

export async function getStationInfo(args) {
  const rawStation = args.station_name || '';
  const stationName = normalizeStationName(rawStation);
  const operator = args.operator ? OPERATOR_MAP[args.operator] : null;
  const userLang = resolveLang(args) || detectLanguage(rawStation) || 'ja';
  if (!rawStation) {
    const msg = userLang === 'en' ? 'Please specify a station name.' : userLang === 'zh' ? '请指定车站名称。' : '駅名を指定してください。';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', msg, { userLang }));
  }
  if (!odptBreaker.canExecute()) return buildInternalStationFallback(stationName, userLang) || jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT APIが利用できません。', { userLang, station: stationName, breakerName: odptBreaker.name, breakerState: odptBreaker.state }));
  try {
    const response = await axios.get(`${API_BASE_URL}/odpt:Station`, { params: getParams(operator, { 'dc:title': stationName }), timeout: 15000 });
    const stations = response.data;
    odptBreaker.onSuccess();
    const displayStation = getDisplayStationName(stationName, userLang);
    if (!stations || stations.length === 0) {
      // #53: ODPTに無い駅（JR・私鉄の多く）は内蔵グラフからフォールバックする。
      // ODPTは東京メトロ・都営・横浜市営・TX等の公式データのみで、JR東日本・京急・京王等は
      // 駅データが存在しない（odpt:Station で取得できない）。内蔵 RAILWAY_LINES から
      // 所属路線と駅コード（路線内インデックス）を補完して返す。
      const localLines = STATION_TO_LINES[stationName] || [];
      if (localLines.length > 0) {
        const fallbackResults = localLines.map(entry => {
          const lineName = entry.line;
          // 路線内の駅コード（例: JI 01 形式にはしない。インデックスは0始まりのため1始まりで表示）
          const code = `${entry.index + 1}`;
          return {
            id: `local:${lineName}:${stationName}`,
            name: getDisplayStationName(stationName, userLang),
            code,
            line: getLineDisplayName(lineName, userLang),
            source: 'internal_graph'
          };
        });
        return jsonResponse({
          status: "SUCCESS",
          detected_language: userLang,
          station: displayStation,
          source: "internal_graph_fallback",
          results: fallbackResults,
          note: userLang === 'en' ? "This station is not in the ODPT dataset; shown from the built-in route graph." :
                userLang === 'zh' ? "该车站不在ODPT数据集中，已从内置路线图显示。" :
                "この駅はODPTデータに無いため、内蔵路線グラフから表示しています。",
          // 駅周辺の文化施設（search_route と同じ自動選出ルーチン）
          cultural_facilities: getDestinationCulturalFacilities(stationName, userLang).length
            ? getDestinationCulturalFacilities(stationName, userLang)
            : undefined,
          // 公的機関の検索案内（駅名基準・v2.36.3 と同設計。駅検索でも表示する）
          gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, displayStation)
        });
      }
      const msg = userLang === 'en' ? `No station info found for ${displayStation}.` : userLang === 'zh' ? `未找到 ${displayStation} 的车站信息。` : '駅情報が見つかりませんでした。';
      return jsonResponse(buildErrorResponse('STATION_NOT_FOUND', msg, { userLang, station: displayStation }));
    }
    return jsonResponse({
      status: "SUCCESS",
      detected_language: userLang,
      station: displayStation,
      results: stations.map(s => ({ id: s['@id'].replace('odpt:Station:', ''), name: s['dc:title'], code: s['odpt:stationCode'] })),
      // 駅周辺の文化施設（search_route と同じ自動選出ルーチン: LANDMARK_DEFS + 明示定義）
      cultural_facilities: getDestinationCulturalFacilities(stationName, userLang).length
        ? getDestinationCulturalFacilities(stationName, userLang)
        : undefined,
      // 公的機関の検索案内（駅名基準・v2.36.3 と同設計。駅検索でも表示する）
      gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, displayStation)
    });
  } catch (error) {
    // ODPTが認証/API障害中でも、内蔵グラフにある駅は案内を継続する。
    const localFallback = buildInternalStationFallback(stationName, userLang);
    if (localFallback) {
      if (!isInternalError(error)) odptBreaker.onFailure(error);
      return localFallback;
    }
    if (!isInternalError(error)) odptBreaker.onFailure(error);
    return handleApiError(error, { userLang, station: stationName, api: 'ODPT' });
  }
}

export async function listCommunityBuses(args) {
  const userLang = resolveLang(args) || 'ja';
  const sorted = [...TOKYO_COMMUNITY_BUSES].sort((a, b) => a.municipality.localeCompare(b.municipality, 'ja'));
  return jsonResponse({
    status: "SUCCESS",
    detected_language: userLang,
    title: userLang === 'en' ? "🚌 Tokyo Community Buses" : userLang === 'zh' ? "🚌 东京都社区公交一览" : "🚌 東京都コミュニティバス一覧",
    note: userLang === 'en' ? "41 community buses across Tokyo wards/cities (source: Tokyo Bus Association tokyobus.or.jp). Timetables & routes are available on each municipality's official site." :
          userLang === 'zh' ? "东京都23区及多摩地区的41条社区公交（来源：东京巴士协会 tokyobus.or.jp）。时刻表与路线请参见各自治体官网。" :
          "東京都23区・多摩地域の41コミュニティバス（出典: 東京バス協会 tokyobus.or.jp）。時刻表・路線は各自治体公式サイトでご確認ください。",
    total: sorted.length,
    community_buses: sorted.map(b => ({ municipality: b.municipality, name: b.name, url: b.url })),
    source: "https://www.tokyobus.or.jp/sp/"
  });
}

export async function listTransitOperators(args) {
  const userLang = resolveLang(args) || 'ja';
  const typeFilter = args?.type_filter || 'all';
  const tl = { ja: { rail: '鉄道', agt: 'AGT', monorail: 'モノレール', tram: '路面電車', bus: '路線バス', ferry: '水上バス・フェリー' }, en: { rail: 'Railway', agt: 'AGT', monorail: 'Monorail', tram: 'Tram', bus: 'Bus', ferry: 'Water bus / Ferry' }, zh: { rail: '铁路', agt: 'AGT', monorail: '单轨电车', tram: '路面电车', bus: '路线巴士', ferry: '水上巴士、渡轮' } }[userLang] || {};
  const seenIds = new Set();
  const railOps = Object.entries(OPERATOR_MAP).map(([k, id]) => ({ key: k, id, type: 'rail', typeLabel: tl.rail, label: id })).filter(o => !seenIds.has(o.id) && seenIds.add(o.id));
  const nonRail = Object.entries(NON_RAIL_OPERATORS).map(([k, op]) => ({ key: k, id: op.id, type: op.type, typeLabel: tl[op.type] || op.type, label: userLang === 'en' ? op.labelEn : userLang === 'zh' ? op.labelZh : op.label, description: userLang === 'en' ? (op.descEn || op.description) : userLang === 'zh' ? (op.descZh || op.description) : op.description, website: op.website }));
  let all = [...railOps, ...nonRail];
  if (typeFilter !== 'all') all = all.filter(op => op.type === typeFilter);
  return jsonResponse({ status: "SUCCESS", detected_language: userLang, type_filter: typeFilter, total_operators: all.length, operators: all });
}

export async function getOperatorRoutes(args) {
  const userLang = resolveLang(args) || 'ja'; const opKey = args.operator_name;
  if (!opKey) return jsonResponse(buildErrorResponse('INVALID_INPUT', 'operator_name を指定。', { userLang }));
  let opId, opMeta;
  const normKey = RAILWAY_NAME_MAP[opKey] || opKey;
  if (NON_RAIL_OPERATORS[opKey]) { opMeta = NON_RAIL_OPERATORS[opKey]; opId = opMeta.id; }
  else if (OPERATOR_MAP[opKey]) { opId = OPERATOR_MAP[opKey]; opMeta = { type: 'rail' }; }
  else if (OPERATOR_MAP[normKey]) { opId = OPERATOR_MAP[normKey]; opMeta = { type: 'rail' }; }
  else if (RAILWAY_NAME_MAP[opKey]) {
    const nk = RAILWAY_NAME_MAP[opKey];
    if (OPERATOR_MAP[nk]) { opId = OPERATOR_MAP[nk]; opMeta = { type: 'rail' }; }
    // 路線名（例: 東武伊勢崎線・東武野田線）から事業者を逆引き。
    // アーバンパークライン→東武野田線 のように RAILWAY_NAME_MAP の値が路線名の場合、
    // OPERATOR_MAP には事業者キーしか無いため、LOCAL_LINE_PREFIX（事業者ID→日本語プレフィックス）で
    // 前方一致する事業者を特定する（東武野田線 → 東武 → Tobu）。
    else {
      const matched = Object.entries(LOCAL_LINE_PREFIX).find(([opIdCand, prefix]) => nk.startsWith(prefix) && Object.values(OPERATOR_MAP).includes(opIdCand));
      if (matched) { opId = matched[0]; opMeta = { type: 'rail' }; }
      else return jsonResponse(buildErrorResponse('INVALID_INPUT', `不明: ${opKey}。list_transit_operators で確認。`, { userLang }));
    }
  }
  // list_transit_operators が表示する id（例: MIR, TWR, TokyoMonorail, TsukubaExpress）でも解決可能に
  else if (Object.values(NON_RAIL_OPERATORS).some(op => (op.id || '').toLowerCase() === opKey.toLowerCase())) {
    opMeta = Object.values(NON_RAIL_OPERATORS).find(op => (op.id || '').toLowerCase() === opKey.toLowerCase());
    opId = opMeta.id;
  }
  else if (Object.values(OPERATOR_MAP).some(id => (id || '').toLowerCase() === opKey.toLowerCase())) {
    opId = Object.values(OPERATOR_MAP).find(id => (id || '').toLowerCase() === opKey.toLowerCase());
    opMeta = { type: 'rail' };
  }
  else return jsonResponse(buildErrorResponse('INVALID_INPUT', `不明: ${opKey}。list_transit_operators で確認。`, { userLang }));
  if (!odptBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT API利用不可。', { userLang }));
  try {
    let railways = (await axios.get(`${API_BASE_URL}/odpt:Railway`, { params: { 'acl:consumerKey': API_KEY, 'odpt:operator': `odpt.Operator:${opId}` }, timeout: 15000 })).data;
    if (opMeta.railwayId) { const tid = `odpt.Railway:${opMeta.railwayId}`; railways = railways.filter(r => r['owl:sameAs'] === tid); }
    odptBreaker.onSuccess();
    const routes = railways.map(r => ({
      railway: getDisplayLineName(r['dc:title'], userLang), id: r['owl:sameAs'],
      stations: (r['odpt:stationOrder'] || []).map((so, idx) => {
        const title = so['odpt:stationTitle'] || {};
        return { index: idx, name: title[userLang === 'zh' ? 'zh-Hans' : userLang] || title.ja || title.en || Object.values(title)[0] || `駅${idx}` };
      }),
      station_count: r['odpt:stationOrder']?.length || 0,
      _rawTitle: r['dc:title']
    }));
    // #53: ODPTに駅データが無い事業者（JR東日本等）は、内蔵 RAILWAY_LINES から補完する。
    // ODPT の odpt:Railway は路線定義を返すが、odpt:stationOrder が空（0駅）の路線が多い。
    // 内蔵グラフに同名路線（表記ゆれ吸収）があれば駅一覧を埋め、ODPT に無い路線
    // （例: 鶴見線）は事業者プレフィックスで追加する。
    const prefix = LOCAL_LINE_PREFIX[opId];
    const odptLineNorm = (name) => (name || '').replace(/[・\s]/g, '');
    // #fix: ODPT が stationOrder を返さない愛称路線（東武スカイツリーライン・東武アーバンパークライン等）は、
    // 路線ID（例: odpt.Railway:Tobu.TobuSkytree）を ODPT_RAILWAY_NAME_MAP で内部グラフ路線名に解決し、
    // 内蔵 RAILWAY_LINES の駅で補完する。タイトル文字列比較だと愛称と正式名が不一致で 0 駅のままになるため。
    for (const rt of routes) {
      if (rt.station_count > 0) continue;
      const shortId = String(rt.id || '').replace('odpt.Railway:', '');
      const internalName = ODPT_RAILWAY_NAME_MAP[shortId];
      if (!internalName || !RAILWAY_LINES[internalName]) continue;
      let fillStations = RAILWAY_LINES[internalName];
      // スカイツリーラインは伊勢崎線の浅草〜東武動物公園区間（久喜〜伊勢崎は含まない）
      if (shortId === 'Tobu.TobuSkytree') {
        const idx = fillStations.indexOf('東武動物公園');
        if (idx >= 0) fillStations = fillStations.slice(0, idx + 1);
      }
      // 押上-曳舟ブランチは2駅のみ
      if (shortId === 'Tobu.TobuSkytreeBranch') {
        fillStations = ['押上', '曳舟'];
      }
      rt.stations = fillStations.map((st, idx) => ({ index: idx, name: getDisplayStationName(st, userLang) }));
      rt.station_count = fillStations.length;
      rt._internalName = internalName;
      rt.source = 'internal_graph';
    }
    const routesWithFallback = [...routes];
    if (prefix) {
      for (const [lineName, stationsArr] of Object.entries(RAILWAY_LINES)) {
        // 内蔵路線がこの事業者に属するか（単一路線事業者は完全一致も許可）
        const belongsToOperator = lineName === prefix || lineName.startsWith(prefix);
        if (!belongsToOperator) continue;
        const normLocal = odptLineNorm(lineName === prefix ? lineName : lineName.replace(prefix, ''));
        // ODPT に既に同名路線（日本語生タイトルまたは路線名との比較）がある場合は、駅が空なら埋める
        const existing = routesWithFallback.find(rt => {
          // IDベースで補完済みの愛称路線（_internalName）はタイトル比較不要で直接マッチ
          if (rt._internalName === lineName) return true;
          const raw = rt._rawTitle || rt.railway;
          const normRt = odptLineNorm(raw);
          return normRt === normLocal || normRt.includes(normLocal) || normLocal.includes(normRt);
        });
        if (existing) {
          if (!existing.station_count) {
            existing.stations = stationsArr.map((st, idx) => ({ index: idx, name: getDisplayStationName(st, userLang) }));
            existing.station_count = stationsArr.length;
          }
          continue;
        }
        // ODPT に無い内蔵路線（例: 鶴見線）を追加
        routesWithFallback.push({
          railway: getLineDisplayName(lineName, userLang),
          id: `local:${lineName}`,
          stations: stationsArr.map((st, idx) => ({ index: idx, name: getDisplayStationName(st, userLang) })),
          station_count: stationsArr.length,
          source: 'internal_graph'
        });
      }
    }
    // 内部照合用 _rawTitle を削除して返却
    const cleanRoutes = routesWithFallback.map(rt => {
      const { _rawTitle, _internalName, ...rest } = rt;
      return rest;
    });
    return jsonResponse({ status: "SUCCESS", detected_language: userLang, operator_name: opKey, type: opMeta.type, routes: cleanRoutes, total_routes: cleanRoutes.length, website: opMeta.website || null });
  } catch (error) {
    // 🔴 #95: 内部エラー（実装バグ）はブレーカー失敗として数えない（#91 方針との整合）。
    if (!isInternalError(error)) odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}
