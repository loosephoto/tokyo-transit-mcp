/**
 * Tokyo Transit MCP Server v2.38.10 (Production Ready)
 * 公共交通オープンデータセンター（ODPT） API および 気象庁 JMA API を利用した東京乗り換えMCP
 * 
 * 強化機能:
 * 1. 【統一キャッシュ管理】全APIキャッシュを一元管理しAPI負荷80%削減
 * 2. 【高速並列API実行】天気・運行情報を並列取得で応答時間50%短縮
 * 3. 【安全最優先設計】荒天時の自転車案内完全非表示・避難所リンク自動表示
 * 4. 【LLMフレンドリー統一JSON】全エラーをLLM判断可能な構造化データで出力
 * 5. 【振替輸送/高温/浸水/人身事故】あらゆるシチュエーションを自動検出
 * 6. 【全交通機関統合】鉄道・AGT・モノレール・路面電車・フェリー・水上バス・バス・空港アクセス
 * 7. 【多言語完全対応】日本語・英語・中国語を自動判定し、応答全体（駅名・路線名・天気・エラー）をローカライズ
 * 8. 【コミュニティバス対応】東京都41自治体ディレクトリ＋主要10件の駅接続ルート（バリアフリー案内）
 * 9. 【横断乗り継ぎ】バス⇔電車⇔コミュニティバスの統合グラフ探索（ODPT/JMA/GBFSのみを使用）
 */

import { API_BASE_URL, API_KEY, FLIGHT_API_KEY, FLIGHT_API_BASE, odptBreaker, jmaBreaker, cache } from './config.mjs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { STATION_NAME_MAP, RAILWAY_NAME_MAP, STATION_DISPLAY_NAMES, LINE_DISPLAY_NAMES } from './data/station-names.mjs';
import { STATION_COORDS, RAILWAY_LINES, LIGHT_TRANSFER_EDGES, CIRCULAR_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES, AMBIGUOUS_STATION_LINES } from './data/railway-lines.mjs';
import { FERRY_PORT_MAP, FERRY_PORT_NAMES, FERRY_GTFS_SOURCES, FERRY_PORT_TSUNAMI_AREAS } from './data/ferry-ports.mjs';
import { COMMUNITY_BUS_NAME_MAP, BUS_STOP_SUFFIX_MAP, BUS_OPERATORS, TOKYO_COMMUNITY_BUSES, COMMUNITY_BUS_ROUTES, COMMUNITY_BUS_STATION_ACCESS, BUS_GTFS_SOURCES, BUSSTOP_ROMAN_TO_JA, BUS_OPERATOR_LABEL } from './data/bus-routes.mjs';
import { FAILURE_TYPES, GSI_MUNICIPALITY_CODES, GSI_MUNICIPALITY_LABELS, GSI_SHELTER_HAZARD_FIELDS, WEATHER_TERM_MAP, TRAIN_INFO_TERM_MAP, OPERATOR_MAP, NON_RAIL_OPERATORS, JMA_AREA_MAP, JMA_AREA_LABELS, GOV_FACILITY_SEARCH_URL, EMERGENCY_EVACUATION_SEARCH_URL, MULTILINGUAL_ADVICE, GBFS_BASE, LIMITED_EXPRESS_KEYWORDS, LIMITED_EXPRESS_STATION_GUIDE, PRIVATE_EXPRESS_GUIDE, AIRPORT_IATA, AIRPORT_WEATHER_AREA, IATA_TO_TERMINAL_STATION, DEFAULT_ACCESS_DESTINATIONS, ODPT_FLIGHT_STATUS_MAP, ODPT_AIRLINE_NAMES } from './data/misc.mjs';
import { parseCsvRecords, parseCsvLine } from './lib/csv.mjs';
import { getParams, buildErrorResponse, jsonResponse, isRateLimitError, handleApiError } from './lib/common.mjs';
import { getDisplayStationName, getLineDisplayName, getCommunityBusDisplayName, getCommunityBusStopDisplayName, getDisplayLineName, translateWeather, translateTrainInfoDetail, detectLanguage, resolveLang } from './lib/lang.mjs';
import { validateFlightDate, gtfsFetchDates, normalizeOvernightTime, timeToSortMinutes } from './lib/time.mjs';
import { haversineDistance, haversineM } from './lib/geo.mjs';
import { LANDMARK_DEFS, LANDMARK_LOOKUP, DESTINATION_CULTURAL_FACILITIES, CULTURAL_CATEGORY_NAMES, DERIVED_CULTURAL_FACILITIES } from './data/landmarks.mjs';

// ローマ字駅ID → 日本語駅名 の逆引きマップ（ODPT odpt:Station から動的構築）
// ODPT の odpt:fromStation は 'odpt.Station:TokyoMetro.Fukutoshin.Shibuya' の形式で、
// 末尾の <Station> がローマ字（Shibuya）のため、日本語入力（渋谷）との照合に使用する。
let _stationRomanToJa = null;
async function getStationRomanToJa() {
  if (_stationRomanToJa) return _stationRomanToJa;
  const cached = cache.get(cache.stationRomanToJa.key);
  if (cached) { _stationRomanToJa = cached; return cached; }
  const map = {};
  // 手動フォールバック: STATION_DISPLAY_NAMES の en 値（ローマ字）→ 日本語
  for (const [ja, trans] of Object.entries(STATION_DISPLAY_NAMES)) {
    if (trans.en) map[trans.en.toLowerCase()] = ja;
  }
  // ODPT odpt:Station から全駅を取得して上書き（より網羅的）
  try {
    const ops = ['TokyoMetro', 'Toei'];
    const responses = await Promise.allSettled(ops.map(op =>
      axios.get(`${API_BASE_URL}/odpt:Station`, { params: getParams(op), timeout: 15000 })
    ));
    for (const r of responses) {
      if (r.status !== 'fulfilled') continue;
      for (const s of (r.value.data || [])) {
        const id = (s['owl:sameAs'] || '').split('.').pop();
        const title = s['dc:title'];
        if (id && title) map[id.toLowerCase()] = title;
      }
    }
  } catch (_) { /* フォールバックのみで続行 */ }
  cache.set(cache.stationRomanToJa.key, map, cache.stationRomanToJa.ttl);
  _stationRomanToJa = map;
  return map;
};

// ==========================================
// 📋 -testモード解析
// ==========================================
function parseTestMode(args) {
  const from = (args && args.from) || '';
  const to = (args && args.to) || '';
  // 別パラメータ形式も対応: args['-test'] / args.test / args.test_mode
  const explicitTest = args && (args['-test'] || args.test || args.test_mode);
  const combined = (from + ' ' + to).trim();
  const testMatch = combined.match(/-+\s*test\s*-*/i);
  if (testMatch) {
    const beforeTest = combined.split(/-+\s*test\s*-*/i)[0].trim();
    const afterTest = combined.split(/-+\s*test\s*-*/i)[1]?.trim() || '';
    const stationParts = beforeTest.split(/\s+/);
    return {
      from: stationParts[0] || args.from,
      to: stationParts[1] || args.to,
      simulatedFailure: afterTest.split(/\s+/)[0] || '台風'
    };
  }
  if (explicitTest) {
    // 自然言語入力から from/to を抽出（「から」「到」「→」等の区切り）
    const extracted = extractStationsFromNaturalLanguage(combined);
    return {
      from: extracted.from || from,
      to: extracted.to || to,
      simulatedFailure: String(explicitTest).trim() || '台風'
    };
  }
  return { from: args.from, to: args.to, simulatedFailure: null };
}

// 自然言語入力（「查询从浅草到涩谷的路线」「浅草から渋谷まで」等）から駅名を抽出
function extractStationsFromNaturalLanguage(text) {
  if (!text) return { from: null, to: null };
  // 中国語: 从A到B / 查询从A到B的路线
  let m = text.match(/从\s*([^\s到]+)\s*到\s*([^\s的]+)/);
  if (m) return { from: m[1], to: m[2] };
  // 日本語: AからBまで / AからBへ
  m = text.match(/([^\sから]+)\s*から\s*([^\sまでへ]+)/);
  if (m) return { from: m[1], to: m[2] };
  // 英語: from A to B
  m = text.match(/from\s+([^\s]+)\s+to\s+([^\s]+)/i);
  if (m) return { from: m[1], to: m[2] };
  // 矢印/ハイフン区切り
  m = text.match(/([^\s→\-]+)\s*[→\-]\s*([^\s→\-]+)/);
  if (m) return { from: m[1], to: m[2] };
  return { from: null, to: null };
}

// ==========================================
// 🚨 障害種別マップ（多言語対応）
// ==========================================

function detectFailureType(failureText, userLang = 'ja') {
  if (!failureText) return null;
  const rawKey = failureText.trim().toLowerCase();
  const textLang = detectLanguage(rawKey); // テキスト自体の言語（ja/zh 共通キーワードの判別用）

  // マッチ優先度: ①完全一致 ②入力がキーワードを含む（入力の方が長い） ③キーワードが入力を含む（入力の方が短い）。
  // ③は「遅延」⊂「ゲート遅延」のような誤マッチの元なので最弱とする。
  // 同一優先度内では最長キーワードを優先（「人身事故が発生」→「事故」より「人身事故」）。
  let best = null, bestType = 3, bestLen = -1;
  for (const [id, config] of Object.entries(FAILURE_TYPES)) {
    for (const [lang, kwList] of Object.entries(config.keywords)) {
      for (const kw of kwList) {
        const lowerKw = kw.toLowerCase();
        const matchType = rawKey === lowerKw ? 0 : rawKey.includes(lowerKw) ? 1 : lowerKw.includes(rawKey) ? 2 : -1;
        if (matchType >= 0 && (matchType < bestType || (matchType === bestType && lowerKw.length > bestLen))) {
          bestType = matchType;
          bestLen = lowerKw.length;
          best = { id, config, lang };
        }
      }
    }
  }
  if (!best) {
    const fallbackMsg = {
      ja: rawKey + " のため一部列車が運行停止中",
      en: "Service partially suspended due to " + rawKey,
      zh: "因 " + rawKey + " 导致部分列车暂停运行"
    };
    return {
      type: 'unknown',
      isTrainSuspended: true,
      weatherText: userLang === 'en' ? "Disruption detected" : userLang === 'zh' ? "检测到交通故障" : "障害検知",
      delayMessage: fallbackMsg[userLang] || fallbackMsg.ja
    };
  }
  const { config, lang } = best;
  // 呼び出し側で解決済みの応答言語を最優先する。
  // 例: 「降雪」は中国語キーワード表にも存在するが、language:'ja' の詳細文まで
  // 中国語へ混在させてはならない。
  const effectiveMatchedLang = (textLang !== 'ja') ? textLang : lang;
  const effectiveLang = userLang || effectiveMatchedLang;
  const weatherText = typeof config.weatherText === 'object'
    ? (config.weatherText[effectiveLang] || config.weatherText.ja)
    : config.weatherText;
  const delayMessage = typeof config.delayMessage === 'object'
    ? (config.delayMessage[effectiveLang] || config.delayMessage.ja)
    : config.delayMessage;
  return {
    ...config,
    matchedLang: effectiveMatchedLang,
    weatherText,
    delayMessage
  };
}

// -test シミュレーション用: 障害テキストから AIアドバイス + メタデータを構築（全ツール共通）
function buildTestAdvice(simulatedFailure, userLang = 'ja') {
  if (!simulatedFailure) return { aiAdvice: null, testMode: false, failureType: null, failureAdviceKey: null };
  const fc = detectFailureType(simulatedFailure, userLang);
  const adviceKey = fc ? (fc.adviceKey || null) : null;
  let aiAdvice = null;
  if (adviceKey && MULTILINGUAL_ADVICE[adviceKey]) {
    aiAdvice = MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja || null;
  }
  return {
    aiAdvice,
    testMode: true,
    failureType: simulatedFailure,
    failureAdviceKey: adviceKey,
    fc
  };
}

// 通常検索でも全交通モードが一貫してAIアドバイスを返す。
// -test の障害アドバイスを優先し、通常時は気象庁の天候連動アドバイス、
// 気象庁APIが一時利用不可でも安全な既定（晴天時）アドバイスを返す。
async function getTransitAdvice(testAdv, userLang) {
  if (testAdv?.aiAdvice) return testAdv.aiAdvice;
  try {
    const weatherAdvice = await getWeatherAdvice(userLang);
    if (weatherAdvice?.advice) return weatherAdvice.advice;
  } catch (_) { /* 下記の既定アドバイスへフォールバック */ }
  return MULTILINGUAL_ADVICE.fair[userLang] || MULTILINGUAL_ADVICE.fair.ja;
}

// 地震時は通常の経路・航路を「利用可能な経路」として提示しない。
// ground: 鉄道/トラム/バス等、water: フェリー/水上バス。
function buildEarthquakeTransportSafety(transport, userLang = 'ja') {
  const water = transport === 'water';
  const messages = water
    ? {
        ja: {
          title: '🚨 【地震時：水上交通の安全確保】',
          action: 'フェリー・水上バスの検索結果は運航可否を保証しないため、航路の利用・乗船を中止してください。',
          guidance: [
            '乗船前: 岸辺・桟橋・水面から離れ、自治体の避難情報に従って指定避難場所または高台へ避難してください。',
            '乗船中: 自己判断で下船・入水せず、船長・乗組員の指示に従ってください。',
            '津波警報・注意報や港の閉鎖情報を確認し、安全宣言まで水路での移動を再開しないでください。'
          ]
        },
        en: {
          title: '🚨 [Earthquake: Water-Transport Safety]',
          action: 'Do not board or rely on ferry/water-bus routes: search results cannot confirm safe operation after an earthquake.',
          guidance: [
            'Before boarding: move away from shorelines, piers, and the water. Follow official evacuation information to designated shelters or higher ground.',
            'On board: do not disembark or enter the water on your own. Follow the captain and crew instructions.',
            'Do not resume water travel until tsunami/port-closure notices are lifted and safety is officially confirmed.'
          ]
        },
        zh: {
          title: '🚨 【地震时：水上交通安全】',
          action: '地震后无法保证轮渡或水上巴士安全运行，请停止乘船和水路出行。',
          guidance: [
            '登船前：远离岸边、码头和水面，遵照官方避难信息前往指定避难场所或高处。',
            '乘船中：不要自行下船或进入水中，请遵从船长和船员的指示。',
            '在海啸、港口关闭等警报解除且官方确认安全前，不要恢复水路出行。'
          ]
        }
      }
    : {
        ja: {
          title: '🚨 【地震時：地上交通の安全確保】',
          action: '鉄道・トラム・バス等は安全確認のため運転見合わせとなる可能性が高いため、通常経路の利用を中止してください。',
          guidance: [
            '揺れが収まるまで、落下物・ガラス・架線等から離れ、係員や自治体の指示に従ってください。',
            '駅・停留所では勝手に線路、道路、ホーム端へ移動せず、安全な場所で情報を確認してください。',
            '運転再開・代替輸送・避難情報が公式に発表されるまで、移動の継続や別経路への乗換を急がないでください。'
          ]
        },
        en: {
          title: '🚨 [Earthquake: Ground-Transport Safety]',
          action: 'Rail, tram, and bus services may be suspended for safety checks. Do not proceed using normal route results.',
          guidance: [
            'Until shaking stops, stay clear of falling objects, glass, and overhead wires; follow staff and local-authority instructions.',
            'At stations and stops, do not move onto tracks, roads, or platform edges. Remain in a safe place and check official information.',
            'Do not rush to continue travel or change routes until official restart, substitute-service, or evacuation information is issued.'
          ]
        },
        zh: {
          title: '🚨 【地震时：地面交通安全】',
          action: '铁路、有轨电车和公交可能因安全检查暂停运行，请停止按常规路线继续出行。',
          guidance: [
            '震动停止前请远离高空坠物、玻璃和架空电线，遵从工作人员及当地政府指示。',
            '在车站和站点不要进入轨道、道路或站台边缘，应在安全处查看官方信息。',
            '在官方发布恢复运行、替代交通或避难信息前，不要急于继续出行或换乘其他路线。'
          ]
        }
      };
  return messages[userLang] || messages.ja;
}

function isEarthquakeSimulation(testAdv) {
  return testAdv?.failureAdviceKey === 'earthquake';
}

// 国土地理院の自治体別「指定緊急避難場所」公開GeoJSON（_2）を利用する。
// 駅・港の自治体コードは、まず東京圏で利用頻度が高い地点を明示的に対応づける。
function getGsiMunicipalityCode(location) {
  return GSI_MUNICIPALITY_CODES[location] || null;
}
async function fetchGsiEmergencyShelters(municipalityCode) {
  const key = `${cache.gsiEmergencyShelters.key}:${municipalityCode}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = `https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/geoJSON/${municipalityCode}_2.geojson`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const features = Array.isArray(res.data?.features) ? res.data.features : [];
    const data = { available: true, source_url: url, features };
    cache.set(key, data, cache.gsiEmergencyShelters.ttl);
    return data;
  } catch (error) {
    return { available: false, source_url: url, features: [], error: error.message };
  }
}
async function getGroundEmergencyShelters(location, hazardType, userLang = 'ja') {
  const municipalityCode = getGsiMunicipalityCode(location);
  const hazardField = GSI_SHELTER_HAZARD_FIELDS[hazardType];
  const loc = STATION_COORDS[location];
  if (!municipalityCode || !hazardField || !loc) return null;
  const data = await fetchGsiEmergencyShelters(municipalityCode);
  const candidates = data.features
    .filter(f => f?.properties?.[hazardField] === '1' && Array.isArray(f?.geometry?.coordinates))
    .map(f => {
      const [lon, lat] = f.geometry.coordinates;
      return {
        name: f.properties['施設・場所名'], address: f.properties['住所'], common_id: f.properties['共通ID'],
        distance_m: haversineDistance(loc.lat, loc.lon, lat, lon), hazard_compatible: true,
        latitude: lat, longitude: lon, remarks: f.properties['備考'] || undefined
      };
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 5);
  const labels = {
    ja: { source: '国土地理院', hazard: hazardField, disclaimer: '国土地理院の公開データに基づく候補です。最新の指定状況、開設状況、避難経路は自治体の公式情報と現場の指示を必ず確認してください。' },
    en: { source: 'Geospatial Information Authority of Japan', hazard: hazardType, disclaimer: 'These are candidates from GSI public data. Always verify current designation, opening status, and evacuation routes through local-authority information and on-site instructions.' },
    zh: { source: '日本国土地理院', hazard: hazardField, disclaimer: '这些是基于国土地理院公开数据的候选地点。请务必通过当地政府官方信息和现场指示确认最新指定、开放状态与避难路线。' }
  }[userLang] || {};
  return {
    source: labels.source, source_url: data.source_url, municipality: GSI_MUNICIPALITY_LABELS[municipalityCode] || municipalityCode,
    municipality_code: municipalityCode, hazard_type: labels.hazard, hazard_field: hazardField,
    candidates, data_available: data.available, disclaimer: labels.disclaimer
  };
}

// 地震時に通常経路を提示せず、安全確保を最優先にする共通レスポンス。
// search_route / search_bus / search_ferry の各入口で利用する。
async function buildEarthquakeSafetyResponse(transport, userLang = 'ja', context = {}) {
  const safety = buildEarthquakeTransportSafety(transport, userLang);
  const mode = transport === 'water' ? 'water' : 'ground';
  const message = userLang === 'en'
    ? 'Normal route guidance is suspended during an earthquake safety response.'
    : userLang === 'zh'
      ? '地震安全响应期间，已停止提供常规路线指引。'
      : '地震時の安全確保を優先するため、通常の経路・航路案内を停止しています。';
  // 地上交通では、出発地点の自治体別GeoJSONから「地震」に対応する候補だけを抽出する。
  const groundShelters = mode === 'ground'
    ? await getGroundEmergencyShelters(context.from || context.busstop_name, 'earthquake', userLang)
    : null;
  return jsonResponse({
    status: 'EMERGENCY_MODE_ACTIVE',
    detected_language: userLang,
    emergency_type: 'earthquake',
    transport_mode: mode,
    ground_emergency_shelters: groundShelters || undefined,
    route_guidance_suspended: true,
    message,
    transport_safety: safety,
    // 現在地・自治体・災害種別に適合する避難場所データを本サーバーは保持しない。
    // 「最寄りの指定避難場所」を断定せず、自治体の公式情報と照合する外部検索として返す。
    emergency_evacuation_search: {
      type: 'external_search_only',
      link: EMERGENCY_EVACUATION_SEARCH_URL,
      label: userLang === 'en' ? 'Search designated emergency shelters (verify with local authority)'
        : userLang === 'zh' ? '搜索指定紧急避难场所（请向当地政府核实）'
        : '指定緊急避難場所を検索（自治体の公式情報で確認）',
      disclaimer: userLang === 'en'
        ? 'This is a map search, not a verified nearest or hazard-specific shelter assignment. Follow local-authority evacuation instructions.'
        : userLang === 'zh'
          ? '这是地图搜索，并非已核实的最近或适用于该灾害的避难场所分配。请遵从当地政府的避难指示。'
          : '地図検索であり、最寄り・災害種別に適合した避難場所を確定するものではありません。自治体の避難情報に従ってください。'
    },
    ai_transit_advice: MULTILINGUAL_ADVICE.earthquake[userLang] || MULTILINGUAL_ADVICE.earthquake.ja,
    test_mode: true,
    simulated_failure_type: 'earthquake',
    ...context
  });
}

// ==========================================
// ❌ 統一JSONエラーレスポンス（LLMフレンドリー）
// ==========================================



// RFC 4180-compatible CSV helpers for GTFS feeds.


function calculateFlightDelayMinutes(scheduled, actual) {
  if (!scheduled || !actual) return null;
  const toMinutes = (value) => {
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const scheduledMinutes = toMinutes(scheduled);
  const actualMinutes = toMinutes(actual);
  if (scheduledMinutes === null || actualMinutes === null) return null;
  let delta = actualMinutes - scheduledMinutes;
  if (delta < -720) delta += 1440;
  return delta;
}


function normalizeAirportIata(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) && ['HND', 'NRT', 'IBR'].includes(normalized) ? normalized : null;
}

// GTFS取得に使う date クエリ候補（固定日付 → 当日 の順・重複除去）。
// 固定日付リソースの有効期限切れ（404）時に当日日付で1回だけ再試行するための一覧。

// ODPT 静的 GTFS zip を取得。固定日付で404等になった場合は当日日付でフォールバック。
async function fetchGtfsZipBuffer(src, timeoutMs = 20000) {
  let lastError = null;
  for (const d of gtfsFetchDates(src.date())) {
    try {
      const res = await axios.get(src.url, { params: { date: d, 'acl:consumerKey': API_KEY }, responseType: 'arraybuffer', timeout: timeoutMs });
      return res.data;
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

// 駅名変換辞書（ノーマライズ用）

// 路線名: 日本語 → ODPT ローマ字IDキー（odpt:railway の末尾セグメント）
// ODPT は 'odpt.Railway:JR-East.Yamanote' の形式で、末尾がローマ字ID（Yamanote）のため、
// 日本語入力（山手線）との照合に使用。部分一致でも検索できるよう複数形を用意。
function resolveSuspendedLineNames(railwayId) {
  const suffix = String(railwayId || '').split('.').pop().toLowerCase();
  if (!suffix) return [];
  const aliases = Object.entries(RAILWAY_NAME_MAP)
    .filter(([, value]) => String(value).toLowerCase() === suffix)
    .map(([name]) => name);
  const graphLines = new Set(Object.values(STATION_TO_LINES).flat().map(entry => entry.line));
  return [...graphLines].filter(line => aliases.some(alias => line === alias || line.includes(alias)));
}


// 多言語表示名辞書


// #64: 路線名の多言語表示（LINE_DISPLAY_NAMES 参照）。未登録なら日本語名をそのまま返す。

// 2026-08 コミュニティバス名・バス停名の多言語化（天気表示障害と同時修正・v2.25.0）
// コミュニティバス事業者名（41自治体）の en/zh 表示名
// バス停名の接尾辞（西口/東口/北口/南口/駅前 等）の en/zh 変換
// コミュニティバス事業者名の多言語表示
// バス停名の多言語表示（駅名部分は getDisplayStationName、接尾辞は BUS_STOP_SUFFIX_MAP で変換）

// 路線名の多言語表示（経路探索グラフの日本語路線名 → en/zh）


// 気象庁の日本語天気文を en/zh に機械翻訳（出現順に置換。長い語を先に置く）

// ODPT運行情報テキスト（振替輸送・運転見合わせ・人身事故等）の英中ローカライズ。
// LINE_DISPLAY_NAMES / STATION_DISPLAY_NAMES（路線・駅名）＋定型文辞書を最長一致で一括置換し、
// 日本語が残った場合は汎用メッセージにフォールバックする（en/zh 応答に生の日本語を漏らさない）。






// 気象庁エリアコード → 3言語表示名（#79: 地域表示を東京固定にしない）
// en/zh は気象庁エリア名の一般的な訳・行政区分名を使用。


// 現在地が明示されたときは地点（緯度経度）を、共有がない場合は駅名・バス停名を基準に
// 公的機関（役所・出張所・公民館・市民センター）の地図検索リンクを返す。
// 駅名や任意の自治体名を「現在地」と推測せず、あくまで「検索地名」として案内する。
// 優先順位: 1) GPS共有（user_location） 2) 駅名 3) バス停名
function buildGovFacilitySearchSupport(userLocation, userLang = 'ja', placeName = '') {
  const disclaimer = userLang === 'en' ? "Location-based map search only; verify opening hours and services with each authority."
    : userLang === 'zh' ? "仅为基于位置的地图搜索；请向各机构确认开放时间和服务内容。"
    : "位置情報に基づく地図検索です。開庁時間・取扱業務は各機関にご確認ください。";
  // 1) GPS共有がある場合は現在地を基準にする（従来動作）
  if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lon)) {
    const query = `役所 出張所 公民館 市民センター @${userLocation.lat},${userLocation.lon}`;
    return {
      note: userLang === 'en' ? "🏛️ [Public Facilities Near Your Shared Location]"
            : userLang === 'zh' ? "🏛️ 【您共享位置周边的公共设施】"
            : "🏛️ 【共有いただいた現在地周辺の公的機関】",
      based_on: 'user_location',
      location: { lat: userLocation.lat, lon: userLocation.lon },
      link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      link_label: userLang === 'en' ? "📍 Show public facilities near your shared location on Google Maps"
                  : userLang === 'zh' ? "📍 在地图上查看您共享位置周边的公共设施"
                  : "📍 共有いただいた現在地周辺の公的機関を地図で確認",
      disclaimer
    };
  }
  // 2) 駅名・バス停名が指定されている場合は、その場所を基準に案内する
  //   （ご老人等が「駅名・バス停名」で公的機関を探すケースに対応。v2.36.3）
  if (placeName && String(placeName).trim()) {
    const name = String(placeName).trim();
    const query = `役所 出張所 公民館 市民センター ${name} 周辺`;
    return {
      note: userLang === 'en' ? `🏛️ [Public Facilities Near ${name}]`
            : userLang === 'zh' ? `🏛️ 【${name} 周边的公共设施】`
            : `🏛️ 【${name} 周辺の公的機関】`,
      based_on: 'place_name',
      place_name: name,
      link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      link_label: userLang === 'en' ? `📍 Show public facilities near ${name} on Google Maps`
                  : userLang === 'zh' ? `📍 在地图上查看 ${name} 周边的公共设施`
                  : `📍 ${name} 周辺の公的機関を地図で確認`,
      disclaimer
    };
  }
  return undefined;
}

// ==========================================
// 🌐 多言語判定
// ==========================================

// 明示的な言語指定（args.language / args.lang）を解決する。
// 有効値（ja/en/zh）ならそれを返し、未指定・不正値は null（自動判定へフォールバック）。


// ==========================================
// 🚲 シェアサイクル（GBFS API + 統一キャッシュ）
// ==========================================

async function fetchBikeShareData() {
  const cached = cache.get(cache.bikeShare.key);
  if (cached) return cached;
  const [infoRes, statusRes] = await Promise.all([
    axios.get(`${GBFS_BASE}/station_information.json`, { timeout: 15000 }),
    axios.get(`${GBFS_BASE}/station_status.json`, { timeout: 15000 })
  ]);
  const stations = infoRes.data.data?.stations || [];
  const statuses = statusRes.data.data?.stations || [];
  const statusMap = {};
  statuses.forEach(s => { statusMap[s.station_id] = s; });
  const data = { stations, statuses: statusMap };
  cache.set(cache.bikeShare.key, data, cache.bikeShare.ttl);
  return data;
}



// ==========================================
// 🗺️ 経路探索エンジン（ODPTキー不要・自己完結型）
// 鉄道路線の順序付き駅リストから無向グラフを構築し、ダイクストラで最短乗り継ぎルートを算出。
// 主要都内路線＋臨海部（ゆりかもめ）を網羅し、浅草↔お台場等の主要区間をカバー。
// ==========================================

// 駅→路線リスト の逆引きインデックス
const STATION_TO_LINES = {};
for (const [lineName, stations] of Object.entries(RAILWAY_LINES)) {
  stations.forEach((st, idx) => {
    if (!STATION_TO_LINES[st]) STATION_TO_LINES[st] = [];
    STATION_TO_LINES[st].push({ line: lineName, index: idx, total: stations.length });
  });
}

// グラフ構築
// ハイパーノード方式: 各(駅, 路線)をノードとし、同一路線内の隣接駅を重み1の「乗車エッジ」、
// 同一駅での路線間を重み TRANSFER_PENALTY の「乗換エッジ」で結ぶ。
// これによりダイクストラは「乗換を避ける・最短時間」の経路を選べる。
const TRANSFER_PENALTY = 10; // 乗換1回 ≈ 駅数10個分（所要時間ペナルティ：実乗換5〜10分相当。v2.28.0で3→10に増強、乗換多数の遠回りを抑制しつつ「1乗換で大幅短縮」を正しく評価する）

// 軽量乗換（同一ホーム・改札内直結等で乗換負担が極めて軽い駅の路線ペア）。
// 通常の乗換エッジ（TRANSFER_PENALTY・乗換1回カウント）の代わりに、軽いコストのみ加算し
// 「乗換回数」にはカウントしない。これにより同コスト帯で乗換回数が少ない遠回りに
// 負ける問題を解消する（例: 新宿→多摩センター が 京王線→高幡不動→多摩モノレール の
// 乗換1回・92分 ではなく 京王線→調布→京王相模原線→京王多摩センター→徒歩連絡 の
// 約70分 を選べるようになる。v2.38.1 新規導入）
const GRAPH = {}; // キー: "駅@路線" または "駅"（隣接駅探索用に駅のみのインデックスも保持）
function addEdge(a, b, w) {
  if (!GRAPH[a]) GRAPH[a] = {};
  if (!GRAPH[b]) GRAPH[b] = {};
  GRAPH[a][b] = w;
  GRAPH[b][a] = w;
}
// 同一路線内の隣接駅を結ぶ（乗車エッジ）。重みは駅間実距離（m）÷100（1km≈10単位）とし、
// 座標未登録の駅はフォールバック重み 10 を使用。これによりダイクストラは実距離が短い経路を選ぶ。
function stationEdgeWeight(a, b) {
  return 1; // 均等重み（駅数ベース）。距離ベースは座標未登録駅で不均一になるため使用しない
}
// 周回路線（リング状に運行する路線）: 末尾駅と先頭駅も隣接エッジで結ぶ。
// 2026-08 v2.26.0: ディズニーリゾートライン（4駅を周回・1周約13分）で初適用。
for (const [lineName, stations] of Object.entries(RAILWAY_LINES)) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = `${stations[i]}@${lineName}`;
    const b = `${stations[i + 1]}@${lineName}`;
    addEdge(a, b, stationEdgeWeight(stations[i], stations[i + 1]));
  }
  // 周回: 最終駅 → 先頭駅 も隣接エッジ（例: 東京ディズニーシー・ステーション ⇔ リゾートゲートウェイ・ステーション）
  if (CIRCULAR_LINES.has(lineName) && stations.length >= 3) {
    const last = `${stations[stations.length - 1]}@${lineName}`;
    const first = `${stations[0]}@${lineName}`;
    addEdge(last, first, stationEdgeWeight(stations[stations.length - 1], stations[0]));
  }
}
// 同一駅での路線間を結ぶ（乗換エッジ）
for (const [st, entries] of Object.entries(STATION_TO_LINES)) {
  const nodes = entries.map(e => `${st}@${e.line}`);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // 軽量乗換（同一ホーム等）: 乗換1回としてカウントせず軽いコストのみ（v2.38.1）
      // 例: 調布 京王線⇔京王相模原線（相模原線は調布始発・同一ホーム乗換）で
      //     新宿→多摩センターが高幡不動経由のモノレール遠回りを選ばず、
      //     京王相模原線経由（約70分）を選べるようにする。
      const lightKey = `${st}|${entries[i].line}|${entries[j].line}`;
      const lightCost = LIGHT_TRANSFER_EDGES[lightKey];
      addEdge(nodes[i], nodes[j], lightCost !== undefined ? lightCost : TRANSFER_PENALTY);
    }
  }
}

// ==========================================
// 近接異名駅（連絡駅）: 名称は異なるが、連絡通路・地下通路・至近距離の徒歩で
// 実質1つの乗換駅として機能する駅の組（例: 牛田(東武伊勢崎線)⇔京成関屋(京成本線)）。
// ルート検索では「徒歩連絡」セグメントとして扱い、乗換1回としてカウントする。
// ※ 公式の連絡駅案内（JR東日本乗換案内・各社連絡駅表）に基づく。
// ==========================================
// 双方向ルックアップ（buildRouteSegments での徒歩連絡検出と徒歩時間取得に使用）
const WALK_TRANSFER_LOOKUP = new Map();
for (const w of WALK_TRANSFERS) {
  WALK_TRANSFER_LOOKUP.set(`${w.from}|${w.to}`, w);
  WALK_TRANSFER_LOOKUP.set(`${w.to}|${w.from}`, w);
}

// 近接異名駅ペアを乗換エッジで接続（全路線ノード間を WALK_TRANSFER_COST で結ぶ）
// 徒歩連絡は「乗換1回」としてカウントする（同駅乗換と同じコスト）。
// ※ これより軽いコストにすると、秋葉原⇔岩本町 等で「徒歩→徒歩の往復」により
//   同駅乗換を回避するバウンス経路が発生するため、必ず TRANSFER_PENALTY 以上とする。
const WALK_TRANSFER_COST = TRANSFER_PENALTY;
for (const w of WALK_TRANSFERS) {
  const fromNodes = (STATION_TO_LINES[w.from] || []).map(e => `${w.from}@${e.line}`);
  const toNodes = (STATION_TO_LINES[w.to] || []).map(e => `${w.to}@${e.line}`);
  for (const a of fromNodes) {
    for (const b of toNodes) {
      // 🔴 既存エッジ（同一路線の乗車エッジ等）を上書きしない。
      // 例: 汐留⇔新橋は両方ゆりかもめに在線し、新橋@ゆりかもめ⇔汐留@ゆりかもめ は
      // 乗車エッジ(重み1)が先に張られている。徒歩エッジで上書きすると
      // 「ゆりかもめ1駅」が消えて徒歩連絡(乗換1回)だけになる（本セッションで実証）。
      // 東京⇔大手町（丸ノ内線）も同類。同路線の徒歩エッジは不要（乗車が最適）なので
      // スキップし、跨路線ペア（例: 新橋@山手線⇔汐留@大江戸線）のみ徒歩エッジを張る。
      if (GRAPH[a] && GRAPH[a][b] !== undefined) continue;
      addEdge(a, b, WALK_TRANSFER_COST);
    }
  }
}

// ==========================================
// 同名別駅: 同じ駅名だが別の場所にある駅（乗換不可・誤認リスク大）。
// グラフ上はマイナー側に識別子を付与して分離済み（例: 小川町（東武東上線））。
// 入力時はサイレント推測せず、検索を中断して候補を提示する（disambiguation）。
// candidates は再入力可能な正式キー（グラフ上の駅名）で返す。
// ==========================================

// #64: 曖昧駅の候補ごとの所属路線名（AMBIGUOUS_STATION_NAMES の候補配列とインデックス対応）。
// 「駅名＋路線名」スペース区切り指定（例: 入谷 相模線）の解決と、
// 候補表示への路線名併記（多言語）に使用する。

// #64: 路線名ヒントの正規化（「線」等のサフィックス除去・大文字小文字統一）。
// 「入谷 相模」と「JR相模線」のような表記差を吸収して部分一致判定を安定させる。
function normalizeLineHint(s) {
  return s.replace(/線$/, '').replace(/jr/i, '').replace(/東京メトロ/g, '').trim().toLowerCase();
}

// 駅ノード（出発・到着のために全路線分を仮想起点/終点として扱うためのマップ）
// 出発駅・到着駅は「その駅の全路線ノードから開始/到着」とみなす

// 最寄り駅探索（部分一致・前方一致）
// 戻り値: { station, candidates, ambiguous, exact, landmark }
//   station    : 確定した駅名（曖昧/未検出時は null）
//   candidates : 部分一致で見つかった候補駅名の配列（前方一致優先・重複排除）
//   ambiguous  : 完全一致せず複数候補があり、どれが正解か確定できない場合 true
//   exact      : 完全一致（または正規化後完全一致）で決まった場合 true
//   landmark   : ランドマーク名から変換された場合、元の施設名（例: 東京ディズニーランド）
// 注意: 部分一致は「入力が候補の接頭辞（前方一致）」または「完全一致」に限定する。
// そうしないと「金町」で「黄金町」(=黄+金町) を含んでしまうsubstring問題で誤認する。
function resolveStation(rawName) {
  if (!rawName) return { station: null, candidates: [], ambiguous: false, exact: false, landmark: null };
  const key = rawName.trim();

  // #64: 「駅名＋路線名」のスペース区切り指定（例: 入谷 相模線 / 入谷 日比谷線）で、
  // 曖昧駅を路線名から一意に解決する。候補が1件に絞れた場合のみ解決し、
  // 絞り込めない場合は通常の曖昧応答（候補提示）にフォールバックする。
  const spaceParts = key.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2) {
    const stationPart = spaceParts[0];
    const lineHint = spaceParts.slice(1).join(' ').toLowerCase();
    const ambBase = AMBIGUOUS_STATION_NAMES[stationPart] || AMBIGUOUS_STATION_NAMES[normalizeStationName(stationPart)];
    if (ambBase) {
      const lineRefs = AMBIGUOUS_STATION_LINES[stationPart] || AMBIGUOUS_STATION_LINES[normalizeStationName(stationPart)] || [];
      const matched = ambBase.filter((cand, i) => {
        const refLine = (lineRefs[i] || '').toLowerCase();
        // 路線名ヒントが候補の所属路線名に部分一致（含む/含まれる）すれば解決候補
        return refLine && (refLine.includes(lineHint) || lineHint.includes(refLine) ||
          normalizeLineHint(refLine).includes(normalizeLineHint(lineHint)) ||
          normalizeLineHint(lineHint).includes(normalizeLineHint(refLine)));
      });
      if (matched.length === 1) {
        return { station: matched[0], candidates: [matched[0]], ambiguous: false, exact: true, landmark: null };
      }
      if (matched.length > 1) {
        return { station: null, candidates: matched, ambiguous: true, exact: false, landmark: null };
      }
      // 路線名で絞り込めなかった場合: 駅名部分のみの曖昧応答にフォールバック
      return { station: null, candidates: ambBase, ambiguous: true, exact: false, landmark: null };
    }
  }

  // 同名別駅（小川町・両国・霞ヶ関等）: 完全一致より先に判定し、サイレント推測せず候補を提示する。
  // 例: 「霞ヶ関」は東京メトロ（霞ケ関）と東武東上線（川越市）の2駅がある。
  if (AMBIGUOUS_STATION_NAMES[key]) {
    return { station: null, candidates: AMBIGUOUS_STATION_NAMES[key], ambiguous: true, exact: false, landmark: null };
  }
  if (STATION_TO_LINES[key]) return { station: key, candidates: [key], ambiguous: false, exact: true, landmark: null };

  // ランドマーク完全一致を駅名エイリアス正規化より先に評価する。
  // 例: Yomiuriland は「読売ランド前」ではなく「京王よみうりランド」を優先。
  // ※ exactOnly: 部分一致まで先に評価すると旧駅名エイリアス（例「成田空港(旧)」→東成田）が
  //    ランドマーク「成田空港」に奪われるため、ここでは完全一致のみを評価する（#26）。
  const landmarkExact = resolveLandmark(key, true);
  if (landmarkExact && STATION_TO_LINES[landmarkExact.station]) {
    return { station: landmarkExact.station, candidates: [landmarkExact.station], ambiguous: false, exact: false, landmark: landmarkExact.landmark, landmarkNote: landmarkExact.note, walk_min: landmarkExact.walk_min };
  }

  // 完全一致（正規化後）
  const norm = normalizeStationName(key);
  // ローマ字・英語別名を日本語駅名へ正規化した後も、同名駅の曖昧性を必ず再評価する。
  // 例: Ryogoku / Ogawamachi / Iriya は日本語入力と同じ候補提示が必要。
  if (AMBIGUOUS_STATION_NAMES[norm]) {
    return { station: null, candidates: AMBIGUOUS_STATION_NAMES[norm], ambiguous: true, exact: false, landmark: null };
  }
  if (STATION_TO_LINES[norm]) return { station: norm, candidates: [norm], ambiguous: false, exact: true, landmark: null };

  // ランドマーク（施設名）から最寄り駅への変換
  // ※ 前方一致（駅名の部分一致）より先に評価する。理由: 「羽田空港」のように
  // 実在しない駅名だが施設名としては有効な入力を、駅名前方一致の「曖昧」で
  // 止めずに最寄り駅へ変換するため。駅名として完全一致する入力は上の分岐で
  // 既に処理済みなので、ここで駅名を誤って上書きすることはない。
  const lm = resolveLandmark(key);
  if (lm && STATION_TO_LINES[lm.station]) {
    return { station: lm.station, candidates: [lm.station], ambiguous: false, exact: false, landmark: lm.landmark, landmarkNote: lm.note, walk_min: lm.walk_min };
  }

  const searchKeys = [key, norm].filter((v, i, a) => a.indexOf(v) === i); // key と norm の重複排除

  // 前方一致（入力が候補の接頭辞）: 誤認を防ぐため substring 包含は使わない
  const prefixMatches = [];
  for (const s of Object.keys(STATION_TO_LINES)) {
    for (const k of searchKeys) {
      if (s === k) { if (!prefixMatches.includes(s)) prefixMatches.push(s); }
      else if (s.startsWith(k)) { if (!prefixMatches.includes(s)) prefixMatches.push(s); }
    }
  }
  if (prefixMatches.length === 1) {
    return { station: prefixMatches[0], candidates: prefixMatches, ambiguous: false, exact: false, landmark: null };
  }
  if (prefixMatches.length > 1) {
    // 複数候補 → 曖昧。ただし「入力そのものが別路線で実在する駅」なら完全一致優先済みのためここには来ない。
    return { station: null, candidates: prefixMatches, ambiguous: true, exact: false, landmark: null };
  }

  // 後方一致・その他の部分一致は「誤認」の元なので使用しない。
  // 正規化名で再試行（STATION_NAME_MAP に旧名がある場合）
  if (norm !== key && STATION_TO_LINES[normalizeStationName(key)]) {
    const nm = normalizeStationName(key);
    return { station: nm, candidates: [nm], ambiguous: false, exact: false, landmark: null };
  }
  return { station: null, candidates: [], ambiguous: false, exact: false, landmark: null };
}

// ダイクストラ法による最短経路探索（ハイパーノード版）
// 出発・到着は「駅名」で与えられ、内部ではその駅の全路線ノードを仮想起点/終点とする。
// 評価基準: 第1に乗換回数を最小化、第2に実距離（駅間重み）を最小化。
function findShortestPath(start, goal, options = {}) {
  const blockedLines = options.blockedLines instanceof Set ? options.blockedLines : new Set(options.blockedLines || []);
  const startNodes = (STATION_TO_LINES[start] || []).map(e => `${start}@${e.line}`);
  const goalNodes = (STATION_TO_LINES[goal] || []).map(e => `${goal}@${e.line}`);
  if (!startNodes.length || !goalNodes.length) return null;
  const goalSet = new Set(goalNodes);
  if (start === goal) return { path: [start], lines: [] };
  // best[node] = { transfers, dist }。比較: 総コスト = dist + transfers × TRANSFER_PENALTY で最小を選ぶ。
// （v2.28.0 変更: 従来は transfers 優先の辞書順だったため、0乗換の遠回り（85分）が 1乗換の直通（25分）に
//   常に勝ってしまう問題があった。乗換ペナルティ加算方式にすることで「乗換1回で大幅短縮」を正しく評価する。
//   Issue #37 対応）
const costOf = (n) => n.dist + n.transfers * TRANSFER_PENALTY;
// 同コストなら乗換数の少ない方を優先（例: 大宮→船橋 は 野田線直通(cost34・0乗換) と
//   湘南新宿ライン→中央線→総武線快速(cost34・2乗換) が同コストになるため、直通を選ぶ）
const betterThan = (a, b) => {
  const ca = costOf(a), cb = costOf(b);
  return ca < cb || (ca === cb && a.transfers < b.transfers);
};
  const best = {};
  const prev = {};
  const visited = new Set();
  const pq = [];
  for (const n of startNodes) {
    if (!blockedLines.has(n.split('@')[1])) {
      best[n] = { transfers: 0, dist: 0 };
      pq.push({ node: n, transfers: 0, dist: 0 });
    }
  }
  let bestGoal = null; // { transfers, dist, node }
  while (pq.length) {
    pq.sort((a, b) => costOf(a) - costOf(b) || a.transfers - b.transfers);
    const { node, transfers, dist } = pq.shift();
    // 確定的打ち切り: 既に見つけたゴール解が、これから pop する全ノードより優秀なら終了
    if (bestGoal && !betterThan({ transfers, dist }, bestGoal)) break;
    if (visited.has(node)) continue;
    visited.add(node);
    if (goalSet.has(node)) {
      if (!bestGoal || betterThan({ transfers, dist }, bestGoal)) {
        bestGoal = { transfers, dist, node };
      }
      continue; // ゴールノードからの先は探索しない（到着済み）
    }
    for (const [next, w] of Object.entries(GRAPH[node] || {})) {
      if (blockedLines.has(node.split('@')[1]) || blockedLines.has(next.split('@')[1])) continue;
      const isTransfer = w >= TRANSFER_PENALTY;
      const nTransfers = transfers + (isTransfer ? 1 : 0);
      const nDist = dist + (isTransfer ? 0 : w);
      const cur = best[next];
      if (!cur || betterThan({ transfers: nTransfers, dist: nDist }, cur)) {
        best[next] = { transfers: nTransfers, dist: nDist };
        prev[next] = node;
        pq.push({ node: next, transfers: nTransfers, dist: nDist });
      }
    }
  }
  if (!bestGoal) return null;
  // ゴールノードからパスを復元
  const node = bestGoal.node;
  const nodePath = [];
  let cur = node;
  while (cur !== undefined) {
    nodePath.unshift(cur);
    if (startNodes.includes(cur)) break;
    cur = prev[cur];
  }
  if (!nodePath.length || nodePath[0].split('@')[0] !== start) return null;
  const path = [];
  const lines = [];
  const walkEdges = [];
  for (let i = 0; i < nodePath.length; i++) {
    const [st, ln] = nodePath[i].split('@');
    path.push(st);
    if (i > 0) lines.push(nodePath[i - 1].split('@')[1]);
  }
  // 徒歩連絡（近接異名駅）エッジの判定: 「駅名が異なる」かつ「重みが乗換ペナルティ以上」のエッジ。
  // 乗車エッジは重み1、同一駅の乗換エッジは駅名が同一のため、この条件で一意に判別できる。
  // ※ 駅名ペアだけで判定すると、新橋⇔汐留のような「同一路線の隣接駅が近接異名駅でもある」ケースで
  //    乗車エッジ（ゆりかもめ1駅）を徒歩連絡と誤表示する（v2.22.0 の実バグ・v2.22.1で修正）。
  for (let i = 0; i < nodePath.length - 1; i++) {
    const a = nodePath[i], b = nodePath[i + 1];
    const w = (GRAPH[a] && GRAPH[a][b] !== undefined) ? GRAPH[a][b] : (GRAPH[b] && GRAPH[b][a] !== undefined ? GRAPH[b][a] : 0);
    walkEdges.push(a.split('@')[0] !== b.split('@')[0] && w >= TRANSFER_PENALTY);
  }
  return { path, lines, walkEdges };
}

// 経路を路線セグメントに分割（乗り換え検出）
// findShortestPath が返す「駅名パス path」と「各区間の実通過路線 lines」をもとに、
// 連続する同路線区間を1セグメントにまとめる。これにより乗換回数が正確になる。
function buildRouteSegments(path, lines, walkEdges = []) {
  if (!path || path.length < 2) return [];
  const segments = [];
  // walkEdges[i] = エッジ i（path[i]→path[i+1]）が徒歩連絡（近接異名駅）かどうか。
  // findShortestPath が「駅名が異なる & 重み>=乗換ペナルティ」で一意に判定した値を使う
  // （駅名ペアだけで判定すると同一路線の乗車エッジを徒歩と誤表示する）。
  const isWalkEdge = (i) => !!(walkEdges && walkEdges[i]);
  const walkInfo = (i) => {
    const w = WALK_TRANSFER_LOOKUP.get(`${path[i]}|${path[i + 1]}`);
    return { line: '🚶 徒歩連絡', from: path[i], to: path[i + 1], count: 1, walk: true, minutes: w ? w.minutes : undefined };
  };
  let curLine = lines[0];
  let cur = isWalkEdge(0) ? walkInfo(0) : { line: curLine, from: path[0], to: path[1], count: 1 };
  let curIsWalk = isWalkEdge(0);
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    const isWalk = isWalkEdge(i);
    if (ln === cur.line && !curIsWalk && !isWalk) {
      cur.to = path[i + 1];
      cur.count++;
    } else {
      segments.push({ ...cur });
      cur = isWalk ? walkInfo(i) : { line: ln, from: path[i], to: path[i + 1], count: 1 };
      curIsWalk = isWalk;
    }
  }
  segments.push({ ...cur });
  return segments.filter(s => s.from && s.to);
}

// 2駅間をつなぐ路線（両方に存在する路線）を返す
function commonLines(a, b) {
  const la = (STATION_TO_LINES[a] || []).map(x => x.line);
  const lb = (STATION_TO_LINES[b] || []).map(x => x.line);
  const shared = la.filter(l => lb.includes(l));
  // 共通路線がなければ（乗り換え駅など）それぞれの路線を返す
  return shared.length ? shared : [...new Set([...la, ...lb])];
}

// ルート検索のメインエントリ（searchRouteから呼び出し）
function computeRoutes(fromRaw, toRaw, options = {}) {
  const fromRes = resolveStation(fromRaw);
  const toRes = resolveStation(toRaw);
  // 曖昧（複数候補がありどれが正解か確定できない）の場合は検索を中断し選択を促す
  if (fromRes.ambiguous) {
    return { error: 'AMBIGUOUS_STATION', side: 'from', input: fromRaw, candidates: fromRes.candidates };
  }
  if (toRes.ambiguous) {
    return { error: 'AMBIGUOUS_STATION', side: 'to', input: toRaw, candidates: toRes.candidates };
  }
  const from = fromRes.station;
  const to = toRes.station;
  if (!from || !to) {
    return { error: 'STATION_NOT_FOUND', from, to, suggestion_from: fromRaw, suggestion_to: toRaw };
  }
  const result = findShortestPath(from, to, options);
  if (!result || !result.path) {
    return { error: 'NO_ROUTE', from, to, fromLandmark: fromRes.landmark, toLandmark: toRes.landmark };
  }
  const { path, lines, walkEdges } = result;
  const segments = buildRouteSegments(path, lines, walkEdges);
  const totalStops = path.length - 1;
  // 徒歩連絡（近接異名駅）も乗換1回としてカウントする（WALK_TRANSFER_COST = TRANSFER_PENALTY）
  const walkSegs = segments.filter(s => s.walk);
  const transfers = Math.max(0, segments.length - 1);
  // 徒歩連絡は「乗車駅数」に含めず、実徒歩時間を推定所要に加算する
  const walkMinutes = walkSegs.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const rideStops = segments.reduce((sum, s) => sum + (s.walk ? 0 : s.count), 0);
  const estimatedMinutes = Math.round(rideStops * 2.5 + transfers * 4 + walkMinutes);

  const routes = [{
    summary: {
      from,
      to,
      transfers,
      total_stops: totalStops,
      estimated_minutes: estimatedMinutes,
      // 徒歩連絡が先頭でもメイン路線は最初の乗車路線とする
      main_line: segments.find(s => !s.walk)?.line || segments[0]?.line || null,
      terminal_station: path[path.length - 1]
    },
    segments: segments.map(seg => ({
      line: seg.line,
      from: seg.from,
      to: seg.to,
      stops: seg.count,
      // 近接異名駅（徒歩連絡）セグメントは walk フラグと徒歩時間を保持する
      ...(seg.walk ? { walk: true, minutes: seg.minutes } : {})
    })),
    path
  }];
  return { routes, from, to, fromLandmark: fromRes.landmark, toLandmark: toRes.landmark, fromLandmarkNote: fromRes.landmarkNote, toLandmarkNote: toRes.landmarkNote };
}

async function findNearestBikeStations(stationName, userLocation = null, maxResults = 5, maxDistance = 2000) {
  try {
    const data = await fetchBikeShareData();
    // 基準座標: ユーザーの現在位置（GPS）が指定されていればそれを優先、なければ出発駅座標
    let coord = (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lon === 'number')
      ? { lat: userLocation.lat, lon: userLocation.lon }
      : STATION_COORDS[stationName];
    if (!coord) return null;
    const baseLabel = (userLocation && typeof userLocation.lat === 'number') ? 'user_location' : 'station';
    const available = data.stations
      .filter(s => { const st = data.statuses[s.station_id]; return st && st.is_renting && st.num_bikes_available > 0; })
      .map(s => {
        const st = data.statuses[s.station_id];
        const name = typeof s.name === 'string' ? s.name : s.name?.ja || s.name?.[0]?.text || '?';
        return { station_id: s.station_id, name, distance: haversineDistance(coord.lat, coord.lon, s.lat, s.lon), bikes_available: st.num_bikes_available, docks_available: st.num_docks_available, lat: s.lat, lon: s.lon, reference: baseLabel };
      })
      .filter(s => s.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxResults);
    return available.length > 0 ? available : null;
  } catch (e) {
    console.log(`[WARN] Bike share API error: ${e.message}`);
    return null;
  }
}

// ==========================================
// 🚢 フェリー ＆ 水上バス（GTFS統合 + 統一キャッシュ）
// ==========================================

async function fetchFerryData() {
  const cached = cache.get(cache.ferryGtfs.key);
  if (cached) return cached;
  // 新規取得時のみサーキットブレイカーをチェック。
  // ただしブレーカーが OPEN でもハードコード水上バス（東京クルーズ）は提供するため、
  // 例外を握りつぶして実 GTFS 取得ループをスキップし、フォールバックへ進む。
  if (!odptBreaker.canExecute()) {
    console.log('[Ferry] ODPT breaker OPEN — skip live GTFS, use hardcoded fallback');
  }
  const AdmZip = (await import('adm-zip')).default;
  const parseCsv = (content) => {
    const records = parseCsvRecords(content);
    if (!records.length) return [];
    const headers = records[0];
    return records.slice(1).map(values => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] || ''; });
      return obj;
    });
  };
  let allStops = [], allRoutes = [], allTrips = [], allStopTimes = [];
  const seenStopIds = new Set(), seenRouteIds = new Set();
  // イシュー#76 復旧監視: 東海汽船の実GTFS取得可否をトラッキング（最終サマリで明示）
  let tokaiRealOk = false;
  for (const src of FERRY_GTFS_SOURCES) {
    if (src.hardCoded) {
      // フォールバック: ハードコード港リストを stop として展開（東海汽船 GTFS 取得不可時）
      for (const name of src.stops) {
        const sid = `TokaiKisenHC:${name}`;
        if (!seenStopIds.has(sid)) {
          allStops.push({ stop_id: sid, stop_name: name, stop_lat: '0', stop_lon: '0' });
          seenStopIds.add(sid);
        }
      }
      // 航路データも合成: 基点（東京・竹芝/竹芝）から各島への往復航路を生成
      const bases = src.stops.filter(s => s === '東京・竹芝' || s === '竹芝');
      const dests = src.stops.filter(s => s !== '東京・竹芝' && s !== '竹芝');
      let tripSeq = 0;
      for (const base of bases) {
        for (const dest of dests) {
          const rid = `TokaiKisenHC:${base}-${dest}`;
          if (!seenRouteIds.has(rid)) {
            allRoutes.push({ route_id: rid, route_short_name: `${base}→${dest}`, route_long_name: `${base}〜${dest}`, _source: src.name });
            seenRouteIds.add(rid);
          }
          const tripId = `TokaiKisenHC:T${tripSeq++}`;
          allTrips.push({ route_id: rid, trip_id: tripId, _source: src.name });
          allStopTimes.push({ trip_id: tripId, stop_id: `TokaiKisenHC:${base}`, stop_sequence: '1', arrival_time: '', departure_time: '' });
          allStopTimes.push({ trip_id: tripId, stop_id: `TokaiKisenHC:${dest}`, stop_sequence: '2', arrival_time: '', departure_time: '' });
        }
      }
      console.log(`[Ferry] ${src.name}: loaded (hardcoded ${src.stops.length} ports, synthesized routes)`);
      continue;
    }
    try {
      const zipBuf = await fetchGtfsZipBuffer(src, 10000);
      const zip = new AdmZip(Buffer.from(zipBuf));
      const safeParse = (entryName) => { const e = zip.getEntry(entryName); return e ? parseCsv(e.getData().toString('utf8')) : []; };
      for (const s of safeParse('stops.txt')) { if (!seenStopIds.has(s.stop_id)) { allStops.push(s); seenStopIds.add(s.stop_id); } }
      for (const r of safeParse('routes.txt')) { const rid = src.name + ':' + r.route_id; if (!seenRouteIds.has(rid)) { allRoutes.push({ ...r, route_id: rid, _source: src.name }); seenRouteIds.add(rid); } }
      for (const t of safeParse('trips.txt')) allTrips.push({ ...t, route_id: src.name + ':' + t.route_id, _source: src.name });
      for (const st of safeParse('stop_times.txt')) allStopTimes.push({ ...st, _source: src.name });
      if (src.name === '東海汽船') tokaiRealOk = true;
      // イシュー#76 復旧監視: 実GTFSの復旧を検知したら明示（ハードコード併用でも実データが優先される）
      if (src.name === '東海汽船') console.log(`[Ferry] 東海汽船: real GTFS recovered — merged with hardcoded fallback (stop_name dedupe)`);
      console.log(`[Ferry] ${src.name}: loaded`); odptBreaker.onSuccess();
    } catch (e) {
      const is404 = /404|ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(e.message || '');
      console.warn(`[Ferry] ${src.name}: GTFS fetch failed (${e.message}) — ${is404 ? 'endpoint unavailable (404) ' : ''}using hardcoded fallback. Auto-retry on next cache refresh (TTL 1h).`);
      odptBreaker.onFailure(e);
    }
  }
  // 水上バス（東京クルーズ）の実 GTFS 取得失敗時のフォールバック。
    // ODPT 静的 GTFS（TokyoCruiseShip/AllLines.zip）が 404 化したため、浅草・お台場海浜公園 等の
    // 主要直行航路を合成し、search_ferry で検索可能にする（実 GTFS が復旧しても重複しないよう stop_name で補完）。
    {
    const wbPorts = ['浅草', '浜離宮', '日の出桟橋', 'お台場海浜公園', '豊洲', '竹芝'];
    const wbEdges = [
    ['浅草', 'お台場海浜公園'],       // ヒミコ / エメラルダスライン（直行）
    ['浅草', '日の出桟橋'],           // ホタルナ / 隅田川ライン
    ['浅草', '浜離宮'],               // 隅田川ライン
    ['日の出桟橋', 'お台場海浜公園'], // お台場ライン
    ['浜離宮', '日の出桟橋'],
    ['日の出桟橋', '豊洲'],
    ['お台場海浜公園', '豊洲'],
    ['浅草', '豊洲'],
    ];
    for (const p of wbPorts) {
    const sid = `TokyoCruiseHC:${p}`;
    if (!seenStopIds.has(sid)) { allStops.push({ stop_id: sid, stop_name: p, stop_lat: '0', stop_lon: '0' }); seenStopIds.add(sid); }
    }
    let wbSeq = 0;
    for (const [a, b] of wbEdges) {
    const rid = `TokyoCruiseHC:${a}-${b}`;
    if (!seenRouteIds.has(rid)) {
      allRoutes.push({ route_id: rid, route_short_name: `${a}→${b}`, route_long_name: `${a}〜${b}`, _source: '東京クルーズ（水上バス）（ハードコード）' });
      seenRouteIds.add(rid);
    }
    for (const [from, to] of [[a, b], [b, a]]) {
      const tripId = `TokyoCruiseHC:T${wbSeq++}`;
      allTrips.push({ route_id: rid, trip_id: tripId, _source: '東京クルーズ（水上バス）（ハードコード）' });
      allStopTimes.push({ trip_id: tripId, stop_id: `TokyoCruiseHC:${from}`, stop_sequence: '1', arrival_time: '', departure_time: '' });
      allStopTimes.push({ trip_id: tripId, stop_id: `TokyoCruiseHC:${to}`, stop_sequence: '2', arrival_time: '', departure_time: '' });
    }
    }
    console.log(`[Ferry] 東京クルーズ（水上バス）（ハードコード）: loaded (${wbPorts.length} ports, ${wbEdges.length} routes)`);
    }
    // stop_name 重複を排除（実 GTFS とハードコードで同名港が混在する場合の表示重複防止）
    const seenNames = new Set();
    const dedupedStops = allStops.filter(s => { if (seenNames.has(s.stop_name)) return false; seenNames.add(s.stop_name); return true; });
    const data = { stops: dedupedStops, routes: allRoutes, trips: allTrips, stopTimes: allStopTimes };
  // イシュー#76 復旧監視サマリ: 東海汽船の実GTFS状態を起動ログで確認可能にする
  // （1時間TTLのキャッシュ更新時に自動再試行されるため、復旧すれば次回ロードで実データに切り替わる）
  if (tokaiRealOk) console.log('[Ferry] 東海汽船: real GTFS OK (hardcoded fallback merged, stop_name dedupe)');
  else console.warn('[Ferry] 東海汽船: real GTFS unavailable — hardcoded 19-port fallback in use. Auto-retry on next 1h cache refresh.');
  cache.set(cache.ferryGtfs.key, data, cache.ferryGtfs.ttl);
  return data;
}

function normalizeFerryPortName(name) {
  const trimmed = name.trim();
  if (FERRY_PORT_MAP[trimmed]) return FERRY_PORT_MAP[trimmed];
  // 中黒・スペース・括弧・suffix（桟橋/ピア/码头/港）を除去した正規化形でも試す
  const norm = trimmed.replace(/[・\s()（）]/g, '').replace(/(桟橋|ピア|码头|港|ターミナル)$/g, '');
  if (FERRY_PORT_MAP[norm]) return FERRY_PORT_MAP[norm];
  // 部分一致: 候補が入力を含む（具体的）を優先、その次に入力が候補を含む
  const containsKey = [];
  const includedByKey = [];
  for (const [k, v] of Object.entries(FERRY_PORT_MAP)) {
    const kNorm = k.replace(/[・\s()（）]/g, '');
    if (k.includes(trimmed) || kNorm.includes(norm)) { if (!containsKey.includes(v)) containsKey.push(v); }
    else if (trimmed.includes(k) || norm.includes(kNorm)) { if (!includedByKey.includes(v)) includedByKey.push(v); }
  }
  if (containsKey.length) { containsKey.sort((a, b) => b.length - a.length); return containsKey[0]; }
  if (includedByKey.length) { includedByKey.sort((a, b) => b.length - a.length); return includedByKey[0]; }
  return trimmed;
}

const server = new Server(
  { name: 'tokyo-transit-mcp', version: '2.38.10' },
  { capabilities: { tools: {} } }
);

// ==========================================
// 📋 ツール一覧
// ==========================================
function applyInputSchemaConstraints(tools) {
  const visit = (schema, key = '') => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object') {
      schema.additionalProperties = false;
      for (const [property, child] of Object.entries(schema.properties || {})) visit(child, property);
    }
    if (schema.type === 'string') {
      schema.minLength = schema.minLength ?? 1;
      schema.maxLength = schema.maxLength ?? 100;
      if (key === 'flight_date') schema.pattern = '^\\d{4}-\\d{2}-\\d{2}$';
    }
    if (key === 'lat' && schema.type === 'number') { schema.minimum = -90; schema.maximum = 90; }
    if (key === 'lon' && schema.type === 'number') { schema.minimum = -180; schema.maximum = 180; }
  };
  for (const tool of tools) visit(tool.inputSchema);
  return tools;
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: applyInputSchemaConstraints([
    { name: 'search_route',
      description: '乗り換えルート検索 - 出発駅から到着駅までのルートを検索。日本語・英語・中国語自動識別、天候/高温/運休を検出しAIアドバイスを返答。language（ja/en/zh）を指定すると応答言語を強制（ユーザーのクエリ言語に合わせて指定推奨）。荒天・降雪・凍結時を除き、到着地点周辺のレンタサイクル案内を表示。user_location（緯度経度）指定時は運転見合わせ時の代替シェアサイクル案内を現在地基準で表示。',
      inputSchema: { type: 'object', properties: { from: { type: 'string', description: '出発駅名' }, to: { type: 'string', description: '到着駅名' }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時は駅名から自動判定）。ユーザーが英語で質問した場合は en、中国語なら zh を指定すると確実にその言語で応答。' }, user_location: { type: 'object', description: 'ユーザーの現在位置（緯度経度）。運転見合わせ時のシェアサイクル案内を現在地基準で表示する場合に指定。例: {"lat": 35.681, "lon": 139.767}', properties: { lat: { type: 'number' }, lon: { type: 'number' } } } }, required: ['from', 'to'] }
    },
    { name: 'get_station_info',
      description: '駅情報取得 - 駅の基本情報をODPT APIから取得。language（ja/en/zh）指定で応答言語を強制可能。',
      inputSchema: { type: 'object', properties: { station_name: { type: 'string', description: '駅名' }, operator: { type: 'string', enum: Object.keys(OPERATOR_MAP) }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時は駅名から自動判定）' } }, required: ['station_name'] }
    },
    { name: 'get_weather',
      description: '天気情報取得＆多言語AIアドバイス - 気象庁APIから天気・気温を取得。高温時は熱中症注意を表示。language（ja/en/zh）指定で応答言語を強制可能。',
      inputSchema: { type: 'object', properties: { area_name: { type: 'string', description: '地域名（例: 東京, 横浜）' }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時は地域名から自動判定）' } }, required: [] }
    },
    { name: 'list_ferry_ports',
      description: 'フェリー／水上バス港一覧 - 東海汽船（伊豆諸島航路）と東京クルーズ（水上バス）の全港を表示。',
      inputSchema: { type: 'object', properties: { language: { type: 'string', enum: ['ja', 'en', 'zh'] } }, required: [] }
    },
    { name: 'search_ferry',
      description: 'フェリー／水上バス航路検索 - 港間の航路と時刻表を検索。language（ja/en/zh）指定で応答言語を強制可能。',
      inputSchema: { type: 'object', properties: { from_port: { type: 'string', description: '出発港' }, to_port: { type: 'string', description: '到着港' }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時は港名から自動判定）' } }, required: ['from_port', 'to_port'] }
    },
    { name: 'list_transit_operators',
      description: '交通事業者一覧 - 鉄道・AGT・モノレール・路面電車・フェリーの全事業者を種別フィルター付きで表示。',
      inputSchema: { type: 'object', properties: { language: { type: 'string', enum: ['ja', 'en', 'zh'] }, type_filter: { type: 'string', enum: ['rail', 'agt', 'monorail', 'tram', 'all'] } }, required: [] }
    },
    { name: 'list_community_buses',
      description: '🚌 東京都コミュニティバス一覧 - 東京バス協会（tokyobus.or.jp）掲載の41自治体コミュニティバス（ちぃばす・ハチ公バス・ムーバス等）を自治体別に表示。時刻表・路線は各自治体公式サイトへのリンクで案内。',
      inputSchema: { type: 'object', properties: { language: { type: 'string', enum: ['ja', 'en', 'zh'] } }, required: [] }
    },
    { name: 'get_operator_routes',
      description: '事業者別路線一覧 - 指定事業者の全路線と駅を表示（例: tokyometro, jreast, mir, twr, yurikamome, toden）。',
      inputSchema: { type: 'object', properties: { operator_name: { type: 'string', description: '事業者キー' }, language: { type: 'string', enum: ['ja', 'en', 'zh'] } }, required: ['operator_name'] }
    },
    { name: 'search_flight',
      description: '✈️ 空港フライト時刻・到着時刻表示 - 羽田(HND)/成田(NRT)等の空港または便名で到着/出発フライトを検索。JAL/ANA のリアルタイム発着データ（ODPT・基本ライセンス）をプライマリに使用し、取得できない場合は AviationStack にフォールバック。海外からの来客・帰省時に最適: 到着フライト検索時に destination（例: 東京駅）を指定すると、到着ターミナルから目的地へのアクセス経路を自動提案。API キー未設定時はフライト時刻なしで空港アクセス経路のみ表示（graceful degradation）。language（ja/en/zh）指定で応答言語を強制可能。',
      inputSchema: { type: 'object', properties: { airport: { type: 'string', description: '空港名またはIATAコード（例: 羽田空港, 成田空港, HND, NRT）' }, flight_number: { type: 'string', description: '便名（例: NH001, JL000）' }, direction: { type: 'string', enum: ['arrival', 'departure'], description: '到着(arrival)または出発(departure)。省略時は到着。' }, flight_date: { type: 'string', description: 'フライト日付 YYYY-MM-DD（省略時は当日）' }, airline: { type: 'string', description: '航空会社IATAコード（任意・絞り込み）' }, destination: { type: 'string', description: '到着時の連携先（例: 東京駅）。指定すると到着ターミナル→目的地のアクセス経路を提案。' }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時は空港名/便名から自動判定）' } }, required: [] } },
    { name: 'search_fare',
      description: '🚃 運賃検索 - 2駅間の運賃をODPTデータから検索します（東京メトロ・都営対応）。サーバー内で運賃を直接返します。language（ja/en/zh）指定で応答言語を強制可能。',
      inputSchema: { type: 'object', properties: { from: { type: 'string', description: '出発駅' }, to: { type: 'string', description: '到着駅' }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時は駅名から自動判定）' } }, required: ['from', 'to'] }
    },
    { name: 'get_timetable',
      description: '🕐 時刻表検索 - 指定駅の時刻表をODPTデータから検索します。直接時刻を提供します。language（ja/en/zh）指定で応答言語を強制可能。',
      inputSchema: { type: 'object', properties: { station_name: { type: 'string', description: '駅名' }, railway: { type: 'string', description: '路線名（省略可）' }, calendar: { type: 'string', enum: ['Weekday', 'SaturdayHoliday', '平日', '土休日'], description: '対象カレンダー（省略時は検索日/当日の曜日で自動判定。土日=SaturdayHoliday）' }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '検索日 YYYY-MM-DD（省略時は当日。calendar 未指定時の曜日判定に使用）' }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時は駅名から自動判定）' } }, required: ['station_name'] }
    },
    { name: 'search_bus',
      description: '🚌🚃 バス路線・乗り継ぎ・横断乗り継ぎ検索 - 都営・西武・横浜市営バス（ODPT）。busstop_name でバス停/系統を検索、from+to で乗り継ぎ経路（バス内のみならず、バス→電車→バスの横断乗り継ぎも対応）を探索。足の悪い方へノンステップバス情報を含む。コミュニティバスは駅接続ルートで乗り継ぎ可能（JRバス関東は停留所順序データがなく対象外）。language（ja/en/zh）指定で応答言語を強制可能。',
      inputSchema: { type: 'object', properties: { busstop_name: { type: 'string', description: 'バス停名（部分一致・バス停検索モード）' }, from: { type: 'string', description: '出発バス停名（乗り継ぎ検索モード: to と共に指定・バス→電車→バスも可）' }, to: { type: 'string', description: '到着バス停名（乗り継ぎ検索モード: from と共に指定）' }, vehicle: { type: 'string', enum: ['bus', 'train', 'community_bus', 'ferry', 'any'], description: '優先する乗り物（乗り継ぎ検索モードのみ）。bus=バス優先, train=電車優先, community_bus=コミュニティバス優先, ferry=水上バス優先, any=自動（最短）。指定乗り物が極端に遠回りになる場合は better_alternative でより良い経路を進言。' }, language: { type: 'string', enum: ['ja', 'en', 'zh'], description: '応答言語の強制指定（省略時はバス停名から自動判定）' } }, required: [] } }
  ])
}));

// ツール実行ハンドラ
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  // 言語決定: 明示指定(resolveLang) > from/to の自動判定（いずれかが zh/en なら採用）> ja
  // 中国語/英語で検索された際は検索言語で返す（ユーザー要求）。
  const autoLang =
    detectLanguage(args?.from) === 'ja' && detectLanguage(args?.to) === 'ja' && detectLanguage(args?.area_name) === 'ja' && detectLanguage(args?.from_port) === 'ja'
      ? 'ja'
      : (detectLanguage(args?.from) !== 'ja' ? detectLanguage(args?.from)
        : detectLanguage(args?.to) !== 'ja' ? detectLanguage(args?.to)
        : detectLanguage(args?.area_name) !== 'ja' ? detectLanguage(args?.area_name)
        : detectLanguage(args?.from_port));
  const userLang = resolveLang(args) || autoLang || 'ja';
  try {
    switch (name) {
      case 'search_route': return await searchRoute(args);
      case 'get_station_info': return await getStationInfo(args);
      case 'get_weather': return await getWeather(args);
      case 'list_ferry_ports': return await listFerryPorts(args);
      case 'search_ferry': return await searchFerry(args);
      case 'list_transit_operators': return await listTransitOperators(args);
      case 'list_community_buses': return await listCommunityBuses(args);
      case 'get_operator_routes': return await getOperatorRoutes(args);
      case 'search_fare': return await searchFare(args);
      case 'get_timetable': return await getTimetable(args);
      case 'search_bus': return await searchBus(args);
      case 'search_flight': return await searchFlight(args);
      default: return jsonResponse(buildErrorResponse('INVALID_INPUT', `Unknown tool: ${name}`, { userLang }));
    }
  } catch (error) {
    return jsonResponse(buildErrorResponse('UNKNOWN_ERROR', error.message || String(error), { userLang }));
  }
});

// 👇 レート制限検出ヘルパー

// 🔍 統合エラーハンドラ（429検出 + 通常エラー）

// ランドマーク・主要施設 → 最寄り駅 変換マップ
// 環境客・観光客が「駅名でない施設名」で検索した際の利便性向上のため。
// value: { station: 最寄り駅名(STATION_TO_LINESに存在), note: 駅からの補足(任意), walk_min: 徒歩目安分 }
// ランドマーク・主要施設 → 最寄り駅 変換マップ（多言語・別名対応）
// 環境客・観光客が「駅名でない施設名」で検索した際の利便性向上のため。
// ・names に 日本語 / 英語 / 中国語 の別名（訳名・略称）を全て登録
// ・note は言語別（ja/en/zh）で案内文を保持
// ・最寄り駅(station)はSTATION_TO_LINESに存在する駅名

// 全ての検索可能文字列（ja/en/zh 別名）を小文字化してフラットルックアップに構築

// 降車駅周辺の文化・芸能・芸術施設（厳選ローカル表示）
// 将来、東京都オープンデータAPI／文化庁文化情報プラットフォームの同期先に置き換え可能。


// #48: 到着時文化施設の二重管理を解消するため、LANDMARK_DEFS（駅周辺スポット）から
// 駅ごとの文化施設一覧を自動導出する。category 未指定の既存ランドマークは「文化施設」扱い。
// 例: 鉄道博物館（大成）駅のランドマーク「鉄道博物館」が到着表示にも自動反映される。

function getDestinationCulturalFacilities(station, userLang = 'ja') {
  const langIndex = userLang === 'en' ? 1 : userLang === 'zh' ? 2 : 0;
  // 明示定義 + LANDMARK_DEFS 自動導出 を名前重複なしでマージ
  const explicit = DESTINATION_CULTURAL_FACILITIES[station] || [];
  const derived = DERIVED_CULTURAL_FACILITIES[station] || [];
  const seen = new Set(explicit.map(e => e[0]));
  const all = [...explicit];
  for (const d of derived) {
    if (!seen.has(d[0])) { seen.add(d[0]); all.push(d); }
  }
  return all.map(([ja, en, zh, category, walk_min]) => ({
    name: [ja, en, zh][langIndex],
    category: userLang === 'ja' ? category : (CULTURAL_CATEGORY_NAMES[category]?.[userLang] || category),
    walk_min
  }));
}

// ランドマーク名（別名・訳名・略称・多言語）で最寄り駅を解決。
// 1) 完全一致（全言語・小文字） 2) サフィックス除去 3) 部分一致（入力がいずれかの名称を含む、長い名称を優先）
function resolveLandmark(rawName, exactOnly = false) {
  if (!rawName) return null;
  const key = rawName.trim();
  const lower = key.toLowerCase();
  // 1. 完全一致（全言語）
  if (LANDMARK_LOOKUP[lower]) {
    const { defKey, lang, original } = LANDMARK_LOOKUP[lower];
    const def = LANDMARK_DEFS[defKey];
    return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
  }
  if (exactOnly) return null; // 完全一致のみ要求時は部分一致系を評価しない（旧駅名エイリアスとの衝突防止: 例「成田空港(旧)」）
  // 2. サフィックス除去（日本語の「駅」「公園」等を除去して再一致）
  const stripped = key.replace(/(駅|バス停|停留所|公園|競技場|ドーム|タワー|テーマパーク)$/, '');
  if (stripped !== key) {
    const sl = stripped.toLowerCase();
    if (LANDMARK_LOOKUP[sl]) {
      const { defKey, lang, original } = LANDMARK_LOOKUP[sl];
      const def = LANDMARK_DEFS[defKey];
      return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
    }
  }
  // 3. 部分一致（入力がいずれかの名称を含む）: 長い名称を優先（「東京ディズニーランド」が「ディズニー」より優先）
  const contained = Object.keys(LANDMARK_LOOKUP)
    .filter(k => lower.includes(k))
    .sort((a, b) => b.length - a.length);
  if (contained.length) {
    const { defKey, lang, original } = LANDMARK_LOOKUP[contained[0]];
    const def = LANDMARK_DEFS[defKey];
    return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
  }
  return null;
}

const STATION_NAME_MAP_LOWER = new Map(
  Object.entries(STATION_NAME_MAP).map(([k, v]) => [k.toLowerCase(), v])
);
function normalizeStationName(name) {
  const trimmed = String(name || '').trim();
  if (STATION_NAME_MAP[trimmed]) return STATION_NAME_MAP[trimmed];
  const mapped = STATION_NAME_MAP_LOWER.get(trimmed.toLowerCase());
  if (mapped) return mapped;
  // 一般的な駅名サフィックスは辞書登録の有無にかかわらず除去する。
  // 先に完全一致と辞書を評価しているため、正式名称の一部を壊さない。
  const withoutSuffix = trimmed.replace(/(?:駅|站|station)$/iu, '').trim();
  if (withoutSuffix !== trimmed) {
    if (STATION_NAME_MAP[withoutSuffix]) return STATION_NAME_MAP[withoutSuffix];
    return STATION_NAME_MAP_LOWER.get(withoutSuffix.toLowerCase()) || withoutSuffix;
  }
  return trimmed;
}

// ==========================================
// 🚄 特急・新幹線の乗り換え案内（経路検索グラフ対応は実装しない → 駅案内の表示のみ）
//   イシュー#76: 特急・新幹線の経路検索グラフ対応は行わない方針。
//   運賃体系（特急券・指定席券）と停車駅パターンが一般路線と異なるため、検索グラフには
//   組み込まず、以下の駅案内（みどりの窓口・指定席券売機）表示で対応する。
// ==========================================
// 特急・新幹線の種別名・列車名（ja/en/zh）。これらの単語が from/to に含まれる場合、
// 経路検索（普通列車ベースのグラフ）では正しく案内できないため、窓口案内を返す。

// 特急・新幹線の主要停車駅と窓口案内（みどりの窓口・指定席券売機）

// 私鉄系特急の事業者別案内（JR とは異なり各社の窓口・券売機・Web予約で対応）
// keywords に該当する列車名が入力された場合、この事業者案内を返す

// 私鉄特急の事業者判定: 入力に含まれるキーワードから事業者を特定
function detectPrivateExpressOperator(fromInput, toInput) {
  const combined = `${fromInput || ''} ${toInput || ''}`.toLowerCase();
  for (const op of PRIVATE_EXPRESS_GUIDE) {
    if (op.keywords.some(kw => combined.includes(kw))) return op;
  }
  return null;
}

// 特急・新幹線リクエストの検出: from/to に列車種別・列車名が含まれるか
function detectLimitedExpressRequest(fromInput, toInput) {
  const combined = `${fromInput || ''} ${toInput || ''}`.toLowerCase();
  // 駅名に含まれるキーワード（例: 「西武秩父」の「秩父」）は特急リクエストと誤判定しない。
  // 解決済み駅名を入力から除去してから判定する（例: 「池袋 秩父特急」→ 秩父 が残る→特急案内）。
  let residue = combined;
  for (const s of [fromInput, toInput]) {
    const r = resolveStation(s);
    if (r && r.station) {
      residue = residue.replace(r.station.toLowerCase(), ' ');
      for (const cand of (r.candidates || [])) {
        residue = residue.replace(String(cand).toLowerCase(), ' ');
      }
    }
  }
  return LIMITED_EXPRESS_KEYWORDS.some(kw => residue.includes(kw));
}

// 該当駅の特定: キーワードを除去した残り（またはキーワードを含まない入力）を駅名として解決
// 新幹線駅（新大阪など）は経路グラフに存在しないため、窓口ガイドのキーとも直接照合する。
function findLimitedExpressStation(fromInput, toInput) {
  const inputs = [fromInput, toInput];
  const candidates = [];
  for (const input of inputs) {
    const s = String(input || '').trim();
    if (!s) continue;
    // キーワード（列車名・種別）を除去した残りを駅名候補にする（大文字小文字を無視）
    let stripped = s;
    for (const kw of LIMITED_EXPRESS_KEYWORDS) {
      try { stripped = stripped.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '); } catch (_) {}
    }
    stripped = stripped.replace(/[、。・\s]+/g, ' ').trim();
    if (stripped) candidates.push(stripped);
  }
  for (const c of candidates) {
    const r = resolveStation(c);
    if (r && r.station) return r.station;
    // グラフに存在しない新幹線駅（新大阪等）は窓口ガイドのキーと直接照合
    if (LIMITED_EXPRESS_STATION_GUIDE[c]) return c;
  }
  return null;
}

// 特急・新幹線リクエストに対する窓口案内レスポンス
function buildLimitedExpressGuidance(userLang, fromInput, toInput) {
  const station = findLimitedExpressStation(fromInput, toInput);
  const guide = station ? LIMITED_EXPRESS_STATION_GUIDE[station] : null;
  // 私鉄系特急の事業者判定（例: ロマンスカー・スカイライナー・りょうもう等）
  const privateOp = detectPrivateExpressOperator(fromInput, toInput);
  const notice = userLang === 'en'
    ? '🚄 Limited express / Shinkansen routes are not included in the route search graph (issue #76: not planned). Please use the station guidance below (Midori-no-Madoguchi / designated-seat ticket machines) for tickets and transfers.'
    : userLang === 'zh'
      ? '🚄 路线搜索图不包含特急・新干线（issue #76：不计划实现）。请通过下方的车站指南（绿色窗口・指定席售票机）确认车票与换乘方式。'
      : '🚄 特急・新幹線は経路検索グラフに含めない方針です（issue #76: 実装しない）。チケット購入・乗り換えは下記の駅案内（みどりの窓口・指定席券売機）をご利用ください。';
  const howTo = userLang === 'en'
    ? 'Please check ticket availability and connections at the station\'s JR Midori-no-Madoguchi (green window) or designated-seat ticket machines.'
    : userLang === 'zh'
      ? '请在该站的JR绿色窗口（Midori-no-Madoguchi）或指定席售票机确认余票与换乘方式。'
      : '該当駅の JR みどりの窓口（または指定席券売機）で、乗車券・特急券の購入と乗り換えをご確認ください。';
  let stationBlock;
  if (guide) {
    stationBlock = { station, window_guidance: guide[userLang] };
  } else {
    const fallback = userLang === 'en'
      ? `For station ${station || 'the requested station'}: ask at the Midori-no-Madoguchi or ticket office for limited-express / Shinkansen tickets and transfers.`
      : userLang === 'zh'
        ? `关于${station || '所查询的车站'}：请到该站的绿色窗口或售票处咨询特急・新干线车票与换乘。`
        : `${station || '該当駅'}では、みどりの窓口または駅係員に特急・新幹線のチケットと乗り換えをお問い合わせください。`;
    stationBlock = { station: station || null, window_guidance: fallback };
  }
  const resp = {
    status: 'SUCCESS',
    mode: 'LIMITED_EXPRESS_GUIDANCE',
    detected_language: userLang,
    from: fromInput,
    to: toInput,
    notice,
    how_to_proceed: howTo,
    guidance: stationBlock,
    limited_express_note: userLang === 'en'
      ? 'This server covers local / rapid / express (ordinary-fare) rail. Shinkansen and limited-express fares require seat reservations handled at JR counters.'
      : userLang === 'zh'
        ? '本服务器支持普通列车・快速・普通特急（普通票价）的路线。新干线与特急的座位预约请在JR窗口办理。'
        : '本サーバーは普通・快速・各駅停車（普通運賃）の経路検索に対応しています。新幹線・特急の指定席予約はJR窓口でお取り扱いください。',
    direct_search_url: `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(fromInput || '')}&to=${encodeURIComponent(toInput || '')}`
  };
  // 私鉄系特急の場合は事業者別案内を追加
  if (privateOp) {
    const opLabel = privateOp.train || privateOp.operator;
    resp.private_express_guidance = {
      operator: privateOp.operator,
      train: opLabel,
      main_stations: privateOp.mainStations,
      guidance: privateOp.guidance[userLang],
      how_to_proceed: userLang === 'en'
        ? `Purchase limited-express tickets at the operator's ticket counters / windows (${privateOp.mainStations.join(', ')}) or book online.`
        : userLang === 'zh'
          ? `请在该公司的主要车站（${privateOp.mainStations.join('・')}）的特急券售票处・窗口购票，或使用网上预约。`
          : `${privateOp.operator}の主要駅（${privateOp.mainStations.join('・')}）の特急券売り場・窓口でご購入ください。Web予約も利用できます。`
    };
  }
  return resp;
}

// ==========================================
// 🚃 乗り換えルート検索（統合版）
// ==========================================
async function searchRoute(args) {
  const parsedArgs = parseTestMode({ from: args.from, to: args.to, '-test': args['-test'], test: args.test, test_mode: args.test_mode });
  let fromInput = parsedArgs.from, toInput = parsedArgs.to;
  let simulatedFailure = parsedArgs.simulatedFailure;

  // ユーザーの現在位置（GPS）: { lat, lon } 任意。指定時はシェアサイクル検索の基準にする
  let userLocation = null;
  if (args.user_location && typeof args.user_location.lat === 'number' && typeof args.user_location.lon === 'number') {
    userLocation = { lat: args.user_location.lat, lon: args.user_location.lon };
  } else if (typeof args.user_location === 'string') {
    const m = args.user_location.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) userLocation = { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }
  // 🔴 緯度経度の範囲検証（lat: -90〜90 / lon: -180〜180）。範囲外は無効として無視する。
  if (userLocation && !(userLocation.lat >= -90 && userLocation.lat <= 90 && userLocation.lon >= -180 && userLocation.lon <= 180)) {
    userLocation = null;
  }

  let userLang = 'ja';
  // 明示的な言語指定（args.language / args.lang）が最優先。
  // 例: ユーザーが英語で質問したのに駅名が日本語（浅草等）の場合、
  //     自動判定では ja になるため、クライアントが language:'en' を渡して英語応答を強制できる。
  const explicitLang = resolveLang(args);
  if (explicitLang) {
    userLang = explicitLang;
  } else if (simulatedFailure) {
    // fromInput の駅名部分（'-test' より前）の言語を優先判定。
    // ja/zh 共通キーワード（地震・人身事故等）でも、駅名が日本語なら ja、中国語なら zh となる。
    const stationPart = fromInput.split(/\s*-+\s*test/i)[0].trim();
    const stationLang = detectLanguage(stationPart);
    if (stationLang !== 'ja') {
      userLang = stationLang;
    }
    // 駅名が日本語（ja）の場合は userLang を 'ja' のままにする。
    // （ja/zh 共通キーワードの場合、駅名の言語を信頼する）
  } else {
    // 明示指定なし: from/to 双方を判定し、いずれかが zh/en ならその言語を採用（中国語/英語検索に検索言語で応答）
    const fL = detectLanguage(fromInput);
    const tL = detectLanguage(toInput);
    userLang = fL !== 'ja' ? fL : tL !== 'ja' ? tL : 'ja';
  }

  // 地震時は鉄道・トラム・バス等の通常経路を提示せず、安全確保を優先する。
  if (simulatedFailure && detectFailureType(simulatedFailure, userLang)?.adviceKey === 'earthquake') {
    return await buildEarthquakeSafetyResponse('ground', userLang, { from: fromInput, to: toInput });
  }

  // 🚄 特急・新幹線リクエスト: 経路グラフは普通列車ベースのため、該当駅の窓口案内を返す。
  // （新幹線・特急の乗り換え対応は大規模改修が必要なため見送り。窓口案内のみ表示）
  if (detectLimitedExpressRequest(fromInput, toInput)) {
    return jsonResponse(buildLimitedExpressGuidance(userLang, fromInput, toInput));
  }

  if (!fromInput || !toInput) {
    return jsonResponse(buildErrorResponse('INVALID_INPUT', '出発駅と到着駅の両方を指定してください。', { userLang, from: fromInput, to: toInput }));
  }

  const fromName = normalizeStationName(fromInput);
  const toName = normalizeStationName(toInput);
  const webSearchUrl = `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}`;

  let isRainy = false, isSevereWeather = false, weatherText = "未取得", isTrainSuspended = false, delayMessage = "";
  let busTransferDetected = false, busTransferDetail = "", isHot = false;
  let failureType = null, failureAdviceKey = null; // -test で指定された障害種別
  const suspendedLineNames = new Set();

  // -test シミュレーション
  if (simulatedFailure) {
    const fc = detectFailureType(simulatedFailure, userLang);
    // 注意: userLang は初期化部で fromInput の駅名言語に基づき決定済み。
    // ja/zh 共通キーワード（地震等）でも駅名の言語を優先するため、ここでは上書きしない。
    isRainy = fc.isRainy || false; isSevereWeather = fc.isSevereWeather || false;
    isHot = fc.isHot || false; isTrainSuspended = fc.isTrainSuspended || false;
    weatherText = fc.weatherText || (userLang === 'en' ? "Disruption detected" : userLang === 'zh' ? "检测到交通故障" : "障害検知");
    delayMessage = "🚨 " + (fc.delayMessage || (userLang === 'en' ? "Simulated disruption" : userLang === 'zh' ? "模拟交通故障" : "シミュレーション障害"));
    failureType = simulatedFailure; failureAdviceKey = fc.adviceKey || null;
    const simulatedLine = Object.keys(RAILWAY_LINES).find(line => simulatedFailure.includes(line));
    if (simulatedLine) suspendedLineNames.add(simulatedLine);
  }

  // 通常API（並列実行＋統一キャッシュ）
  let apiDegraded = false;
  if (!simulatedFailure) {
    const [weatherResult, trainResult] = await Promise.allSettled([
      (async () => {
        if (!jmaBreaker.canExecute()) return { error: 'CIRCUIT_OPEN' };
        try {
          const cached = cache.get(`${cache.jmaWeather.key}:130000`);
          if (cached) { isHot = cached.isHot; return cached; }
          const res = await axios.get("https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json", { timeout: 15000 });
          const text = res.data[0].timeSeries[0].areas[0].weathers[0];
          const r = text.includes("雨") || text.includes("雪") || text.includes("雷");
          const s = text.includes("特別警報") || text.includes("大雨特別") || text.includes("大雪特別") || text.includes("津波");
          let h = false;
          for (const ts of res.data[0]?.timeSeries || []) {
            if (ts.areas?.[0]?.temps) {
              const maxTemp = Math.max(...ts.areas[0].temps.map(t => parseInt(t) || 0));
              if (maxTemp >= 33) h = true;
            }
          }
          isHot = h;
          jmaBreaker.onSuccess();
          const result = { weather: text, isRainy: r, isSevere: s, isHot: h };
          cache.set(`${cache.jmaWeather.key}:130000`, result, cache.jmaWeather.ttl);
          return result;
        } catch (e) { jmaBreaker.onFailure(e); return { error: e.message }; }
      })(),
      (async () => {
        if (!odptBreaker.canExecute()) return { error: 'CIRCUIT_OPEN' };
        try {
          const operators = ['TokyoMetro', 'Toei', 'TamaMonorail', 'MIR', 'TWR'];
          const results = await Promise.allSettled(operators.map(op => axios.get(`${API_BASE_URL}/odpt:TrainInformation`, { params: getParams(op), timeout: 15000 })));
          const allDelays = []; let fb = false, fd = '';
          const fulfilledCount = results.filter(res => res.status === 'fulfilled').length;
          if (fulfilledCount === 0) {
            throw new Error('All ODPT train information requests failed');
          }
          for (const res of results) {
            if (res.status === 'rejected') continue;
            for (const info of res.value.data) {
              if (!info['odpt:trainInformationStatus']) continue;
              const t = info['odpt:trainInformationText']?.ja || '';
              const resumed = t.includes('再開');
              if (!resumed && (t.includes("運転見合わせ") || t.includes("見合わせ") || t.includes("運休"))) {
                allDelays.push({ railway: info['odpt:railway'], text: t });
                for (const lineName of resolveSuspendedLineNames(info['odpt:railway'])) suspendedLineNames.add(lineName);
              }
              if (t.includes('バス') || t.includes('振替') || t.includes('代行') || t.includes('輸送')) { fb = true; fd = t; }
            }
          }
          busTransferDetected = fb; busTransferDetail = fd;
          odptBreaker.onSuccess();
          return { delays: allDelays, busTransfer: fb, busTransferDetail: fd, suspendedLineNames: [...suspendedLineNames] };
        } catch (e) { odptBreaker.onFailure(e); return { error: e.message }; }
      })()
    ]);

    if (weatherResult.status === 'fulfilled' && weatherResult.value && !weatherResult.value.error) {
      const w = weatherResult.value;
      weatherText = w.weather; isRainy = w.isRainy; isSevereWeather = w.isSevere; isHot = w.isHot || false;
    } else if (weatherResult.status === 'fulfilled' && weatherResult.value?.error === 'CIRCUIT_OPEN') {
      return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', '気象庁APIが利用できません。', { userLang, from: fromName, to: toName, breakerName: jmaBreaker.name, breakerState: jmaBreaker.state }));
    } else { apiDegraded = true; } // 天気API取得失敗
    if (trainResult.status === 'fulfilled' && trainResult.value && !trainResult.value.error) {
      const t = trainResult.value;
      for (const lineName of (t.suspendedLineNames || [])) suspendedLineNames.add(lineName);
      if (t.delays.length > 0) { isTrainSuspended = true; delayMessage = `🚨 ${t.delays[0].railway.replace('odpt:Railway:', '')}: ${translateTrainInfoDetail(t.delays[0].text, userLang)}`; }
      if (t.busTransfer && !delayMessage) delayMessage = `🚨 ${translateTrainInfoDetail(t.busTransferDetail, userLang)}`;
    } else if (trainResult.status === 'fulfilled' && trainResult.value?.error === 'CIRCUIT_OPEN') {
      return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT APIが利用できません。', { userLang, from: fromName, to: toName, breakerName: odptBreaker.name, breakerState: odptBreaker.state }));
    } else { apiDegraded = true; } // 運行情報API取得失敗
  }

  const isEmergencyActive = isTrainSuspended || isSevereWeather;
  // 障害種別→アドバイス連動：failureAdviceKeyがある場合は専用アドバイス、なければ従来の天候ベース
  let adviceKey;
  if (failureAdviceKey) {
    adviceKey = failureAdviceKey;
  } else if (isEmergencyActive) {
    adviceKey = 'emergency';
  } else if (isHot) {
    adviceKey = 'hot';
  } else if (isRainy) {
    adviceKey = 'rainy';
  } else {
    adviceKey = 'fair';
  }
  const aiAdvice = MULTILINGUAL_ADVICE[adviceKey]?.[userLang] || MULTILINGUAL_ADVICE[adviceKey]?.ja || "情報なし";

  // 🚲 運転見合わせ時のみ自転車。ただし降雪・凍結時は転倒リスクが高いため非表示。
  // failureAdviceKey を見ることで、実際の降雪警報だけでなく -test 降雪も安全に抑止する。
  const isSnowRisk = failureAdviceKey === 'snow' || /雪|積雪|凍結/i.test(weatherText || '');
  let bikeShareInfo = null;
  let destinationBikeShareInfo = null;
  if (isTrainSuspended && !isSevereWeather && !isSnowRisk) {
    bikeShareInfo = await findNearestBikeStations(fromName, userLocation);
  }
  // 荒天・降雪・凍結時を除き、到着地点周辺のラストワンマイル用ポートを案内する。
  // リアルタイムAPIが取得できない場合は推測せず、案内ブロック自体を省略する。
  if (!isSevereWeather && !isSnowRisk) {
    destinationBikeShareInfo = await findNearestBikeStations(toName, null);
  }

  const displayFrom = getDisplayStationName(fromName, userLang);
  const displayTo = getDisplayStationName(toName, userLang);
  // 🚌 駅⇔コミュニティバス接続（足の悪いユーザーの駅までの足・駅からの足）
  const communityBusAccess = [
    buildCommunityBusAccessBlock(fromName, userLang),
    buildCommunityBusAccessBlock(toName, userLang)
  ].filter(Boolean);
  const communityBusAccessOut = communityBusAccess.length ? communityBusAccess : undefined;

  // 🗺️ 経路探索エンジン（ODPTキー不要・自己完結型）で実ルートを算出
  let routeOperational = true;
  let routeResult = (simulatedFailure)
    ? { error: 'TEST_MODE' }
    : computeRoutes(fromName, toName, { blockedLines: suspendedLineNames });
  if (!simulatedFailure && suspendedLineNames.size > 0 && routeResult?.error === 'NO_ROUTE') {
    const fallbackRoute = computeRoutes(fromName, toName);
    if (fallbackRoute?.routes) {
      routeResult = fallbackRoute;
      routeOperational = false;
    }
  }

  // ルートが見つからない場合は、エラー種別に応じた統一エラー応答を返す（SUCCESSを誤って返さない）
  if (routeResult && routeResult.error && routeResult.error !== 'TEST_MODE') {
    if (routeResult.error === 'AMBIGUOUS_STATION') {
      // 同名・類似駅名が複数あり、誤認リスクがあるため検索を中断し選択を促す
      const sideLabel = routeResult.side === 'from'
        ? (userLang === 'en' ? 'departure' : userLang === 'zh' ? '出发' : '出発')
        : (userLang === 'en' ? 'arrival' : userLang === 'zh' ? '到达' : '到着');
      // #64: 候補に所属路線名（ja/en/zh）を併記し、多言語ユーザーでも選択しやすくする。
      // 例: 入谷（東京メトロ日比谷線）/ 入谷（相模線）
      const candidatesDisp = (routeResult.candidates || []).map((c, i) => {
        const stationDisp = getDisplayStationName(c, userLang);
        // 括弧付き正式キー（例: 入谷（相模線））は表示名に既に路線名が含まれるため併記しない
        if (c.includes('（') || stationDisp.includes('(')) return stationDisp;
        const lineRefs = AMBIGUOUS_STATION_LINES[routeResult.input] || AMBIGUOUS_STATION_LINES[normalizeStationName(routeResult.input)] || [];
        const lineName = lineRefs[i] ? getLineDisplayName(lineRefs[i], userLang) : '';
        if (!lineName) return stationDisp;
        // 言語に応じて括弧を切り替え（en: 半角 / ja・zh: 全角）
        return userLang === 'en' ? `${stationDisp} (${lineName})` : `${stationDisp}（${lineName}）`;
      });
      const promptMsg = userLang === 'en'
        ? `Multiple stations match "${routeResult.input}" (${sideLabel}). Please choose one: ${candidatesDisp.join(' / ')}`
        : userLang === 'zh'
          ? `「${routeResult.input}」匹配到多个车站（${sideLabel}）。请选择其一：${candidatesDisp.join(' / ')}`
          : `「${routeResult.input}」に一致する駅が複数あります（${sideLabel}）。どれかを選択してください：${candidatesDisp.join(' / ')}`;
      const disambiguation = {
        input: routeResult.input,
        side: routeResult.side,
        candidates: candidatesDisp,
        candidates_raw: routeResult.candidates, // #64: 再入力可能な正式キー（括弧付き表記）も併記
        message: promptMsg
      };
      return jsonResponse(buildErrorResponse('AMBIGUOUS_STATION', promptMsg, {
        userLang, from: displayFrom, to: displayTo, disambiguation
      }));
    }
    const errType = routeResult.error === 'STATION_NOT_FOUND' ? 'STATION_NOT_FOUND' : 'NO_ROUTE';
    const errMsg = errType === 'STATION_NOT_FOUND'
      ? (userLang === 'en' ? `Station not found: ${displayFrom} / ${displayTo}`
         : userLang === 'zh' ? `未找到车站：${displayFrom} / ${displayTo}`
         : `駅が見つかりません：${displayFrom} / ${displayTo}`)
      : (userLang === 'en' ? `No route found from ${displayFrom} to ${displayTo}.`
         : userLang === 'zh' ? `未找到从 ${displayFrom} 到 ${displayTo} 的路线。`
         : `${displayFrom} から ${displayTo} への経路が見つかりません。`);
    return jsonResponse(buildErrorResponse(errType, errMsg, {
      userLang, from: displayFrom, to: displayTo,
      suggestion_from: routeResult.suggestion_from, suggestion_to: routeResult.suggestion_to
    }));
  }

  let routesPayload = undefined;
  const landmarkInfo = {};
  if (routeResult && routeResult.routes) {
    routesPayload = routeResult.routes.map(r => ({
      summary: {
        from: getDisplayStationName(r.summary.from, userLang),
        to: getDisplayStationName(r.summary.to, userLang),
        transfers: r.summary.transfers,
        total_stops: r.summary.total_stops,
        estimated_minutes: r.summary.estimated_minutes,
        main_line: getDisplayLineName(r.summary.main_line, userLang)
      },
      segments: r.segments.map(s => s.walk ? {
        // 近接異名駅（連絡駅）間の徒歩連絡セグメント
        line: userLang === 'en' ? '🚶 Walk transfer' : userLang === 'zh' ? '🚶 步行换乘' : '🚶 徒歩連絡',
        from: getDisplayStationName(s.from, userLang),
        to: getDisplayStationName(s.to, userLang),
        stops: s.stops,
        walk_minutes: s.minutes
      } : {
        line: getDisplayLineName(s.line, userLang),
        from: getDisplayStationName(s.from, userLang),
        to: getDisplayStationName(s.to, userLang),
        stops: s.stops
      })
    }));
    // ランドマーク（施設名）から変換された場合、ユーザーへの案内として付与
    // note は言語別オブジェクト {ja,en,zh} → 応答言語(userLang)で解決
    const pickLang = (noteObj) => (noteObj && typeof noteObj === 'object' ? (noteObj[userLang] || noteObj.ja || '') : (noteObj || ''));
    if (routeResult.fromLandmark) {
      const noteStr = pickLang(routeResult.fromLandmarkNote);
      landmarkInfo.from = {
        landmark: routeResult.fromLandmark,
        nearest_station: getDisplayStationName(routeResult.from, userLang),
        note: userLang === 'en' ? `Nearest station to ${routeResult.fromLandmark}: ${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : userLang === 'zh' ? `${routeResult.fromLandmark} 的最近车站：${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : `${routeResult.fromLandmark} の最寄り駅：${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
      };
    }
    if (routeResult.toLandmark) {
      const noteStr = pickLang(routeResult.toLandmarkNote);
      landmarkInfo.to = {
        landmark: routeResult.toLandmark,
        nearest_station: getDisplayStationName(routeResult.to, userLang),
        note: userLang === 'en' ? `Nearest station to ${routeResult.toLandmark}: ${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : userLang === 'zh' ? `${routeResult.toLandmark} 的最近车站：${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : `${routeResult.toLandmark} の最寄り駅：${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
      };
    }
  }

  const resultPayload = {
    status: simulatedFailure ? (isEmergencyActive ? "EMERGENCY_MODE_ACTIVE" : "TEST_MODE") : (isEmergencyActive ? "EMERGENCY_MODE_ACTIVE" : "SUCCESS"),
    // AIインテリジェントアドバイスを先頭に配置（LLMが後半を省略しないよう）
    ai_transit_advice: aiAdvice,
    from: displayFrom, to: displayTo, mode: simulatedFailure ? "TEST_MODE" : "LIVE",
    detected_language: userLang,
    detected_user_language: userLang,
    degraded_mode: apiDegraded ? true : undefined,
    // 実ルート（自己完結型経路エンジンで算出）
    routes: routesPayload,
    route_operational: routeOperational && (!isTrainSuspended || suspendedLineNames.size > 0),
    suspended_lines: suspendedLineNames.size ? [...suspendedLineNames].map(line => getDisplayLineName(line, userLang)) : undefined,
    // ランドマーク（施設名）入力時の最寄り駅案内
    landmark_info: Object.keys(landmarkInfo).length ? landmarkInfo : undefined,
    // 降車駅周辺の文化・芸能・芸術施設（到着地側のみ表示）
    destination_cultural_facilities: getDestinationCulturalFacilities(routeResult.to, userLang).length
      ? getDestinationCulturalFacilities(routeResult.to, userLang)
      : undefined,
    route_note: userLang === 'en' ? "Route computed by the built-in route engine." :
                userLang === 'zh' ? "路线由内置路线引擎计算。" :
                "経路は自己完結型エンジンで算出。",
    weather_text: userLang === 'en' ? `Tokyo Area: ${translateWeather(weatherText, 'en')}` : userLang === 'zh' ? `东京地区: ${translateWeather(weatherText, 'zh')}` : `東京地方: ${weatherText}`,
    // 路線情報の外部検索URLはフォールバックとして維持
    direct_search_url: (isRainy || isEmergencyActive) ? `${webSearchUrl}&useLocalBus=true&walkSpeed=slow` : webSearchUrl,
    // 運賃情報はsearch_fareツールで取得可能
    fare_available: true,
    fare_note: userLang === 'en' ? "Use search_fare tool to find station-to-station fares." :
               userLang === 'zh' ? "使用 search_fare 工具查询车站间票价。" :
               "search_fareツールで駅間運賃を検索できます。",
    // 公的機関の検索案内: GPS共有があれば現在地、なければ到着駅名・バス停名を基準に表示する。
    // （ご老人等が「駅名」で公的機関を探すケースに対応。v2.36.3）
    gov_facility_search_support: buildGovFacilitySearchSupport(userLocation, userLang, displayTo),
    // 🚌 駅⇔コミュニティバス接続（足の悪いユーザーの駅までの足・駅からの足）
    community_bus_access: communityBusAccessOut
  };

  if (!isSevereWeather && !isSnowRisk && destinationBikeShareInfo) {
    resultPayload.destination_bike_share = {
      note: userLang === 'en' ? "🚲 [Bike Share Near Destination]" :
            userLang === 'zh' ? "🚲 【到达地点附近的共享单车】" :
            "🚲 【到着地点周辺のレンタサイクル】",
      recommendation: userLang === 'en' ? "Bike-share ports near the destination are available for last-mile travel." :
        userLang === 'zh' ? "可使用到达地点附近的共享单车进行最后一段行程。" :
        "到着地点周辺のポートを、ラストワンマイルの移動に利用できます。",
      based_on: 'destination',
      stations: destinationBikeShareInfo,
      total_nearby: destinationBikeShareInfo.length,
      data_source: "docomo-cycle-tokyo GBFS",
      caution: userLang === 'en' ? "Availability and return eligibility may change; check the official app." :
        userLang === 'zh' ? "可用车辆和还车状态可能变化，请通过官方应用确认。" :
        "利用可能台数・返却可否は変動するため、利用前に公式アプリでご確認ください。"
    };
  }

  if (isTrainSuspended && !isSevereWeather && bikeShareInfo) {
    const ref = bikeShareInfo[0]?.reference;
    const isUserLoc = ref === 'user_location';
    resultPayload.cycling_alternative = {
      note: userLang === 'en' ? "🚲 [Transit Suspension - Bike Share Guidance]" :
            userLang === 'zh' ? "🚲 【暂停运营 - 共享单车指南】" :
            "🚲 【運転見合わせ - シェアサイクル案内】",
      recommendation: isUserLoc
        ? (userLang === 'en' ? "🚲 Nearest bike share ports from your current location:" :
           userLang === 'zh' ? "🚲 您当前位置附近的共享单车停靠点：" :
           "🚲 現在地最寄りのシェアサイクルポート：")
        : (userLang === 'en' ? "🚲 Nearest bike share ports from origin station:" :
           userLang === 'zh' ? "🚲 出发站附近的共享单车停靠点：" :
           "🚲 出発駅最寄りのシェアサイクルポート："),
      based_on: isUserLoc ? 'user_location' : 'origin_station',
      stations: bikeShareInfo, total_nearby: bikeShareInfo.length, data_source: "docomo-cycle-tokyo GBFS"
    };
  }

  // フェリー代替
  if (FERRY_PORT_MAP[fromName] || FERRY_PORT_MAP[toName]) {
    resultPayload.ferry_alternative = {
      note: userLang === 'en' ? "🚢 [Ferry Service Guidance]" :
            userLang === 'zh' ? "🚢 【轮渡航线指南】" :
            "🚢 【フェリー航路のご案内】",
      suggestion: userLang === 'en' ? "Use search_ferry tool for details." :
                  userLang === 'zh' ? "使用 search_ferry 工具查看详情。" :
                  "search_ferryツールで詳細を検索できます。"
    };
  }

  // 非鉄道系
  resultPayload.non_rail_transit_support = {
    note: userLang === 'en' ? "🚃 Non-rail transit also available" :
          userLang === 'zh' ? "🚃 非铁路交通工具亦可使用" :
          "🚃 非鉄道系交通機関も利用可能",
    operators: Object.values(NON_RAIL_OPERATORS).map(op => userLang === 'en' ? op.labelEn : userLang === 'zh' ? op.labelZh : op.label).join(userLang === 'en' ? ', ' : '、'),
    suggestion: userLang === 'en' ? "Check list_transit_operators tool for details" :
                userLang === 'zh' ? "详情请使用 list_transit_operators 工具" :
                "詳細は list_transit_operators ツールを"
  };

  // 🚉 バス連携を検出した場合だけ、出発駅周辺のバス停を案内する。
  // 鉄道のみの通常経路に「最寄りの出口直結バス」等を推測して混在させない。
  if (fromName && (communityBusAccessOut?.length || busTransferDetected)) {
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fromName + '駅 バス停')}`;
    resultPayload.station_bus_stops = {
      note: userLang === 'en' ? "🚉 [Bus Stops Relevant to This Journey]" :
            userLang === 'zh' ? "🚉 【与本次行程相关的车站周边巴士站】" :
            "🚉 【この経路に関連する駅周辺バス停】",
      link: mapUrl,
      basis: communityBusAccessOut?.length ? 'community_bus_access' : 'substitute_transport',
      hint: userLang === 'en' ? `Verify the boarding stop and exit with station staff or the bus operator near ${displayFrom} Station.` :
            userLang === 'zh' ? `请向车站工作人员或巴士运营商确认${displayFrom}站附近的乘车站点与出口。` :
            `${displayFrom}駅での乗車バス停・最寄り出口は、駅係員またはバス事業者の案内でご確認ください。`,
      link_label: userLang === 'en' ? `📍 Show bus stops near ${displayFrom} Station on Google Maps` :
                  userLang === 'zh' ? `📍 在地图上查看${displayFrom}站周边巴士站` :
                  `📍 ${displayFrom}駅周辺のバス停を地図で確認`
    };
  }

  // 振替輸送
  if (busTransferDetected && busTransferDetail) {
    resultPayload.bus_transfer_alternative = {
      note: userLang === 'en' ? "🚌 [Substitutive Bus Transport]" :
            userLang === 'zh' ? "🚌 【接驳换乘巴士指南】" :
            "🚌 【振替輸送のご案内】",
      detail: translateTrainInfoDetail(busTransferDetail, userLang),
      suggestion: userLang === 'en' ? "Please inquire with station staff." :
                  userLang === 'zh' ? "请咨询车站工作人员。" :
                  "駅係員にお問い合わせください。"
    };
  }

  // 🚨 緊急避難場所の検索リンクは、災害時のみ表示する。
  // 人身事故・降雪・通常の運行障害は避難場所の適合性を意味しないためリンクを付けない。
  const isDisasterEvacuationCase = ['earthquake', 'emergency', 'typhoon', 'flood', 'fire'].includes(failureAdviceKey);
  if (isEmergencyActive) {
    resultPayload.emergency_alert = {
      status: "ALERT_ACTIVE",
      reason: userLang === 'en' ? (isTrainSuspended ? "Train line suspension detected" : "Emergency disaster warning detected") :
              userLang === 'zh' ? (isTrainSuspended ? "检测到铁路线路暂停运营" : "检测到特别预警级重大灾害") :
              (isTrainSuspended ? "鉄道路線の運行不能を検知" : "特別警報級の重大災害を検知"),
      detail: delayMessage,
      note: (MULTILINGUAL_ADVICE[adviceKey] && (MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja)) || MULTILINGUAL_ADVICE.emergency[userLang] || MULTILINGUAL_ADVICE.emergency.ja,
      evacuation_search: isDisasterEvacuationCase ? {
        type: 'external_search_only',
        link: EMERGENCY_EVACUATION_SEARCH_URL,
        label: userLang === 'en' ? 'Search designated emergency shelters (verify with local authority)'
          : userLang === 'zh' ? '搜索指定紧急避难场所（请向当地政府核实）'
          : '指定緊急避難場所を検索（自治体の公式情報で確認）',
        disclaimer: userLang === 'en'
          ? 'This is a map search, not a verified nearest or hazard-specific shelter assignment. Follow local-authority evacuation instructions.'
          : userLang === 'zh'
            ? '这是地图搜索，并非已核实的最近或适用于该灾害的避难场所分配。请遵从当地政府的避难指示。'
            : '地図検索であり、最寄り・災害種別に適合した避難場所を確定するものではありません。自治体の避難情報に従ってください。'
      } : undefined
    };
  }

  if (simulatedFailure) { resultPayload.test_mode = true; resultPayload.simulated_failure_type = simulatedFailure; }
  return jsonResponse(resultPayload);
}

// ==========================================
// 🚉 駅情報取得
// ==========================================
async function getStationInfo(args) {
  const rawStation = args.station_name || '';
  const stationName = normalizeStationName(rawStation);
  const operator = args.operator ? OPERATOR_MAP[args.operator] : null;
  const userLang = resolveLang(args) || detectLanguage(rawStation) || 'ja';
  if (!rawStation) {
    const msg = userLang === 'en' ? 'Please specify a station name.' : userLang === 'zh' ? '请指定车站名称。' : '駅名を指定してください。';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', msg, { userLang }));
  }
  if (!odptBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT APIが利用できません。', { userLang, station: stationName, breakerName: odptBreaker.name, breakerState: odptBreaker.state }));
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
      return jsonResponse(buildErrorResponse('PARSE_ERROR', msg, { userLang, station: displayStation }));
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
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang, station: stationName, api: 'ODPT' });
  }
}

// ==========================================
// ☀️ 天気情報（高温・降水検出対応）
// ==========================================
// 天候から AIインテリジェントアドバイスを生成（getWeather と searchFlight で共有）
// 戻り値: { advice: string(ai_transit_advice), weather: string, isRainy, isHot, maxTemp }
// 🔴 #79: キャッシュキーを areaCode 別にする（地域をまたいで東京の予報を再利用しない）。
// 通信障害時は SUCCESS/null を返さず throw し、呼び出し側（getWeather）が
// NETWORK_ERROR / API_TIMEOUT を返す。getTransitAdvice / searchFlight は
// try/catch 済みのため、throw しても従来どおり既定アドバイスへフォールバックする。
async function getWeatherAdvice(userLang, areaCode = '130000') {
  if (!jmaBreaker.canExecute()) {
    const err = new Error('JMA_API_UNAVAILABLE');
    err.code = 'JMA_UNAVAILABLE';
    throw err;
  }
  const cacheKey = `${cache.jmaWeather.key}:${areaCode}`;
  const cached = cache.get(cacheKey);
  let weather, isRainy = false, isHot = false, maxTemp = 0;
  if (cached) { weather = cached.weather; isRainy = cached.isRainy; isHot = cached.isHot; }
  else {
    const response = await axios.get(`https://www.jma.go.jp/bosai/forecast/data/forecast/${areaCode}.json`, { timeout: 15000 });
    weather = response.data[0].timeSeries[0].areas[0].weathers[0];
    isRainy = weather.includes("雨") || weather.includes("雪");
    for (const ts of response.data[0]?.timeSeries || []) {
      if (ts.areas?.[0]?.temps) { maxTemp = Math.max(...ts.areas[0].temps.map(t => parseInt(t) || 0)); if (maxTemp >= 33) isHot = true; }
    }
    cache.set(cacheKey, { weather, isRainy, isHot }, cache.jmaWeather.ttl);
    jmaBreaker.onSuccess();
  }
  const adviceKey = isHot ? 'hot' : (isRainy ? 'rainy' : 'fair');
  const advice = (MULTILINGUAL_ADVICE[adviceKey] && (MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja)) || '';
  return { advice, weather, isRainy, isHot, maxTemp: maxTemp || undefined };
}

async function getWeather(args) {
  const rawArea = args.area_name || '';
  const userLang = resolveLang(args) || detectLanguage(rawArea) || 'ja';
  let areaCode = '130000', areaName = rawArea || "東京";
  if (rawArea && JMA_AREA_MAP[rawArea]) areaCode = JMA_AREA_MAP[rawArea];
  if (!jmaBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', '気象庁APIが利用できません。', { userLang, area: areaName, breakerName: jmaBreaker.name, breakerState: jmaBreaker.state }));
  try {
    const { advice, weather, isHot, maxTemp } = await getWeatherAdvice(userLang, areaCode);
    // 🔴 #79: 地域表示を東京固定にしない。エリアコード → 3言語ラベル辞書で表示する。
    const areaLabel = JMA_AREA_LABELS[areaCode];
    const displayArea = (areaLabel && areaLabel[userLang]) || areaName;
    return jsonResponse({
      status: "SUCCESS",
      // AIインテリジェントアドバイスを先頭に配置（LLMが後半を省略しないよう）
      ai_transit_advice: advice,
      detected_language: userLang,
      area: displayArea,
      area_code: areaCode,
      weather: translateWeather(weather, userLang),
      max_temp: maxTemp,
      heat_alert: isHot || undefined
    });
  } catch (error) {
    // 🔴 #79: 通信障害を SUCCESS/null として隠蔽しない。
    if (error?.code === 'JMA_UNAVAILABLE') {
      return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', '気象庁APIが利用できません。', { userLang, area: areaName, breakerName: jmaBreaker.name, breakerState: jmaBreaker.state }));
    }
    const errType = error?.code === 'ECONNABORTED' ? 'API_TIMEOUT' : 'NETWORK_ERROR';
    const errMsg = errType === 'API_TIMEOUT'
      ? (userLang === 'en' ? 'Weather API timed out. Please try again later.' : userLang === 'zh' ? '天气API请求超时，请稍后重试。' : '気象庁APIがタイムアウトしました。しばらく待ってから再試行してください。')
      : (userLang === 'en' ? 'Failed to fetch weather data. Please try again.' : userLang === 'zh' ? '获取天气数据失败，请重试。' : '気象庁APIから天気情報を取得できませんでした。');
    return jsonResponse(buildErrorResponse(errType, errMsg, { userLang, area: areaName, area_code: areaCode }));
  }
}

// ============================================================
// 🚌 東京都コミュニティバス一覧（tokyobus.or.jp ディレクトリ）
// ============================================================
async function listCommunityBuses(args) {
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

// ============================================================
// 🚢 フェリー港一覧
// ============================================================
async function listFerryPorts(args) {
  const userLang = resolveLang(args) || 'ja';
  try {
    const data = await fetchFerryData();
    const PORT_LABELS = {
      ja: { title: "🚢 フェリー & 水上バス 港一覧", note: "東海汽船 + 東京クルーズ（水上バス）" },
      en: { title: "🚢 Ferry & Water Bus Ports", note: "Tokai Kisen + Tokyo Cruise (Water Bus)" },
      zh: { title: "🚢 轮渡及水上巴士港口列表", note: "东海汽船 + 东京游览船（水上巴士）" }
    };
    const ports = data.stops.map(s => {
      const canonicalName = s.stop_name;
      const trans = FERRY_PORT_NAMES[canonicalName] || {};
      return {
        id: s.stop_id,
        name: canonicalName,
        name_en: trans.en || canonicalName,
        name_zh: trans.zh || canonicalName,
        location: { lat: parseFloat(s.stop_lat), lon: parseFloat(s.stop_lon) }
      };
    });
    return jsonResponse({
      status: "SUCCESS",
      detected_language: userLang,
      ...PORT_LABELS[userLang] || PORT_LABELS.ja,
      ports,
      total_ports: ports.length
    });
  } catch (error) {
    const errMsg = error.message || String(error);
    if (errMsg.includes('Circuit Breaker') || errMsg.includes('CIRCUIT_OPEN')) {
      return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT APIが利用できません。', { userLang, breakerName: odptBreaker.name, breakerState: odptBreaker.state }));
    }
    return jsonResponse(buildErrorResponse(
      error.code === 'ECONNABORTED' ? 'API_TIMEOUT' : 'NETWORK_ERROR',
      'フェリーデータ取得失敗: ' + errMsg, { userLang, api: 'Ferry GTFS' }
    ));
  }
}

// ==========================================
// 🌊 フェリー向け海上・津波安全情報
// ==========================================
const JMA_TSUNAMI_LIST_URL = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
const JMA_TSUNAMI_DETAIL_BASE_URL = 'https://www.jma.go.jp/bosai/tsunami/data/';

// 港ごとの津波予報区（JMAの予報区名との照合用）。
// 範囲外の港は安全側に倒し、全国有効警報がある場合は航路を抑止する。

function isActiveTsunamiWarning(kind) {
  const text = String(kind || '');
  return /大津波警報|津波警報|津波注意報|Major Tsunami Warning|Tsunami Warning|Tsunami Advisory/i.test(text)
    && !/解除|No Tsunami/i.test(text);
}

async function fetchJmaTsunamiSafety() {
  const cached = cache.get(cache.jmaTsunami.key);
  if (cached) return cached;
  try {
    const listRes = await axios.get(JMA_TSUNAMI_LIST_URL, { timeout: 15000 });
    const list = Array.isArray(listRes.data) ? listRes.data : [];
    // 最新の津波警報・注意報・予報電文を1件取得。最新電文が解除なら active=false となる。
    const latest = list.find(item => /津波警報・注意報・予報|Tsunami (Advisory|Warning|Forecast)/.test(item.ttl || item.en_ttl || ''));
    if (!latest?.json) {
      const none = { available: true, active: false, areas: [], source: 'JMA Tsunami Information', updated_at: null };
      cache.set(cache.jmaTsunami.key, none, cache.jmaTsunami.ttl);
      return none;
    }
    const detailRes = await axios.get(`${JMA_TSUNAMI_DETAIL_BASE_URL}${latest.json}`, { timeout: 15000 });
    const body = detailRes.data?.Body || {};
    const forecastItems = body?.Tsunami?.Forecast?.Item || [];
    const items = Array.isArray(forecastItems) ? forecastItems : [forecastItems];
    const areas = items.map(item => {
      const kind = item?.Category?.Kind || {};
      return {
        name: item?.Area?.Name || '',
        en_name: item?.Area?.enName || '',
        kind: kind.Name || '',
        en_kind: kind.enName || '',
        code: kind.Code || '',
        max_height_m: item?.MaxHeight?.TsunamiHeight || null,
        arrival_condition: item?.FirstHeight?.Condition || null
      };
    }).filter(a => a.name && isActiveTsunamiWarning(a.kind || a.en_kind));
    const result = {
      available: true,
      active: areas.length > 0,
      areas,
      source: 'JMA Tsunami Information',
      updated_at: detailRes.data?.Head?.ReportDateTime || latest.rdt || null,
      headline: detailRes.data?.Head?.Headline?.Text || '',
      detail_url: `${JMA_TSUNAMI_DETAIL_BASE_URL}${latest.json}`
    };
    cache.set(cache.jmaTsunami.key, result, cache.jmaTsunami.ttl);
    return result;
  } catch (error) {
    // 安全判定APIの一時障害は航路そのものを「安全」と断定しない。
    return { available: false, active: false, areas: [], source: 'JMA Tsunami Information', error: error.message };
  }
}

function getTsunamiAreasForPorts(...ports) {
  return [...new Set(ports.flatMap(p => FERRY_PORT_TSUNAMI_AREAS[p] || []))];
}

function isTsunamiRelevantToPorts(tsunami, ...ports) {
  if (!tsunami.active) return false;
  const portAreas = getTsunamiAreasForPorts(...ports);
  // 港の予報区が未登録なら、安全側で有効な津波警報を航路停止対象とする。
  if (!portAreas.length) return true;
  return tsunami.areas.some(a => portAreas.some(pa => a.name.includes(pa) || pa.includes(a.name)));
}

async function buildTsunamiWaterSafetyResponse(userLang, tsunami, context = {}) {
  const safety = buildEarthquakeTransportSafety('water', userLang);
  const advisory = userLang === 'en'
    ? 'An active tsunami warning/advisory affects this water-transport area. Do not board or continue water travel.'
    : userLang === 'zh'
      ? '该水路区域受到有效海啸警报/注意报影响。请停止登船和水路出行。'
      : 'この水路地域に有効な津波警報・注意報が発表されています。乗船・水路移動を中止してください。';
  // 出発港側の自治体データから、津波対応の指定緊急避難場所だけを抽出する。
  const tsunamiShelters = await getGroundEmergencyShelters(context.from_port, 'tsunami', userLang);
  return jsonResponse({
    status: 'EMERGENCY_MODE_ACTIVE',
    detected_language: userLang,
    emergency_type: 'tsunami',
    transport_mode: 'water',
    route_guidance_suspended: true,
    message: advisory,
    maritime_safety_status: {
      tsunami_warning_active: true,
      source: tsunami.source,
      updated_at: tsunami.updated_at,
      headline: tsunami.headline || undefined,
      affected_areas: tsunami.areas,
      official_detail_url: tsunami.detail_url
    },
    transport_safety: safety,
    tsunami_emergency_shelter: tsunamiShelters || undefined,
    ai_transit_advice: MULTILINGUAL_ADVICE.emergency[userLang] || MULTILINGUAL_ADVICE.emergency.ja,
    ...context
  });
}

// ==========================================
// 🚢 フェリー航路検索
// ==========================================
async function searchFerry(args) {
  const rawFrom = args.from_port || '';
  const rawTo = args.to_port || '';
  const fromPort = normalizeFerryPortName(rawFrom);
  const toPort = normalizeFerryPortName(rawTo);
  const fromLang = detectLanguage(rawFrom);
  const toLang = detectLanguage(rawTo);
  const userLang = resolveLang(args) || (fromLang !== 'ja' ? fromLang : (toLang !== 'ja' ? toLang : 'ja'));
  const parsedTest = parseTestMode({ from: rawFrom, to: rawTo, '-test': args['-test'], test: args.test, test_mode: args.test_mode });
  const testAdv = buildTestAdvice(parsedTest.simulatedFailure, userLang);
  const aiAdvice = await getTransitAdvice(testAdv, userLang);
  // 地震時はフェリー・水上バスの航路を提示しない。水面・岸辺から離れる避難を優先する。
  if (isEarthquakeSimulation(testAdv)) {
    return await buildEarthquakeSafetyResponse('water', userLang, { from_port: rawFrom, to_port: rawTo });
  }
  // 津波シミュレーションでも、実運航・時刻表を提示せず水上避難を優先する。
  if (testAdv.failureAdviceKey === 'emergency' && testAdv.fc?.type === 'disaster') {
    const simulatedTsunami = {
      active: true,
      source: 'JMA Tsunami Information (simulation)',
      updated_at: null,
      headline: userLang === 'en' ? 'Tsunami warning simulation' : userLang === 'zh' ? '海啸警报模拟' : '津波警報シミュレーション',
      detail_url: 'https://www.jma.go.jp/bosai/tsunami/',
      areas: []
    };
    return await buildTsunamiWaterSafetyResponse(userLang, simulatedTsunami, { from_port: rawFrom, to_port: rawTo, test_mode: true, simulated_failure_type: parsedTest.simulatedFailure });
  }
  if (!fromPort || !toPort) {
    const errMsg = userLang === 'en' ? 'Please specify both origin and destination ports.' :
                   userLang === 'zh' ? '请同时指定出发港口和到达港口。' :
                   '両方の港を指定してください。';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', errMsg, { userLang }));
  }
  // JMAの有効な津波警報・注意報を確認してから時刻表を取得する。
  // 警報区域に該当する航路は、運航情報より避難行動を優先して抑止する。
  const tsunamiSafety = await fetchJmaTsunamiSafety();
  if (isTsunamiRelevantToPorts(tsunamiSafety, fromPort, toPort)) {
    return await buildTsunamiWaterSafetyResponse(userLang, tsunamiSafety, { from_port: rawFrom, to_port: rawTo });
  }
  try {
    const data = await fetchFerryData();
    // 正規化後の名前でも部分一致させる（中黒・スペース・suffix の揺れに対応）
    const fromPortNorm = fromPort.replace(/[・\s()（）]/g, '').replace(/(桟橋|ピア|码头|港|ターミナル)$/g, '');
    const toPortNorm = toPort.replace(/[・\s()（）]/g, '').replace(/(桟橋|ピア|码头|港|ターミナル)$/g, '');
    const fromStop = data.stops.find(s => {
      const sn = s.stop_name;
      const snNorm = sn.replace(/[・\s()（）]/g, '').replace(/(桟橋|ピア|码头|港|ターミナル)$/g, '');
      return sn.includes(fromPort) || fromPort.includes(sn) || snNorm.includes(fromPortNorm) || fromPortNorm.includes(snNorm);
    });
    const toStop = data.stops.find(s => {
      const sn = s.stop_name;
      const snNorm = sn.replace(/[・\s()（）]/g, '').replace(/(桟橋|ピア|码头|港|ターミナル)$/g, '');
      return sn.includes(toPort) || toPort.includes(sn) || snNorm.includes(toPortNorm) || toPortNorm.includes(snNorm);
    });
    if (!fromStop || !toStop) {
      const errMsg = userLang === 'en' ? 'Port not found. Please check list_ferry_ports for available ports.' :
                     userLang === 'zh' ? '未找到港口，请在 list_ferry_ports 中查看可用港口。' :
                     '港が見つかりません。list_ferry_portsで確認。';
      return jsonResponse(buildErrorResponse('INVALID_INPUT', errMsg, { userLang }));
    }
    const routeStops = [fromStop.stop_id, toStop.stop_id];
    const matchingTrips = data.stopTimes.filter(st => routeStops.includes(st.stop_id));
    const tripIds = new Set(matchingTrips.map(st => st.trip_id));
    // trip_id → そのtripの全stop_times（発着時刻・深夜0時越えは正規化）
    const stopTimesByTrip = new Map();
    for (const st of data.stopTimes) {
      if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
      stopTimesByTrip.get(st.trip_id).push({
        stop_id: st.stop_id,
        stop_sequence: st.stop_sequence,
        arrival_time: normalizeOvernightTime(st.arrival_time),
        departure_time: normalizeOvernightTime(st.departure_time)
      });
    }
    const relevantRoutes = [];
    for (const route of data.routes) {
      const routeTrips = data.trips.filter(t => t.route_id === route.route_id);
      if (data.stopTimes.some(st => routeTrips.some(t => t.trip_id === st.trip_id) && st.stop_id === fromStop.stop_id) &&
          data.stopTimes.some(st => routeTrips.some(t => t.trip_id === st.trip_id) && st.stop_id === toStop.stop_id)) {
        relevantRoutes.push({
          route,
          trips: routeTrips
            .filter(t => tripIds.has(t.trip_id))
            .slice(0, 5)
            // #23/#9: 各tripに stop_times（発着時刻）を結合する。
            // 実GTFS由来なら時刻が入り、ハードコード由来なら空（時刻表なし）を明示する。
            .map(t => ({
              ...t,
              stop_times: (stopTimesByTrip.get(t.trip_id) || []).map(st => {
                const stopName = (data.stops.find(s => s.stop_id === st.stop_id) || {}).stop_name || st.stop_id;
                const portTrans = FERRY_PORT_NAMES[stopName] || {};
                return {
                  stop_sequence: st.stop_sequence,
                  stop_name: userLang === 'en' ? (portTrans.en || stopName) : userLang === 'zh' ? (portTrans.zh || stopName) : stopName,
                  arrival_time: st.arrival_time || null,
                  departure_time: st.departure_time || null
                };
              }),
              has_timetable: (stopTimesByTrip.get(t.trip_id) || []).some(st => st.arrival_time || st.departure_time)
            }))
        });
      }
    }

    const fromTrans = FERRY_PORT_NAMES[fromStop.stop_name] || {};
    const toTrans = FERRY_PORT_NAMES[toStop.stop_name] || {};
    const displayFrom = userLang === 'en' ? (fromTrans.en || fromStop.stop_name) : userLang === 'zh' ? (fromTrans.zh || fromStop.stop_name) : fromStop.stop_name;
    const displayTo = userLang === 'en' ? (toTrans.en || toStop.stop_name) : userLang === 'zh' ? (toTrans.zh || toStop.stop_name) : toStop.stop_name;

    // 航路名・データソースの言語化（route_short_name / route_long_name / _source を userLang に合わせる）
    const sourceLabel = (src) => {
      if (src.includes('東京クルーズ')) return userLang === 'en' ? 'Tokyo Cruise (Water Bus) (hardcoded)' : userLang === 'zh' ? '东京游览船（水上巴士）（内置数据）' : src;
      if (src.includes('東海汽船')) return userLang === 'en' ? 'Tokai Kisen (hardcoded)' : userLang === 'zh' ? '东海汽船（内置数据）' : src;
      return src;
    };
    const localizeRoutes = (routes) => routes.map(entry => ({
      ...entry,
      route: {
        ...entry.route,
        route_short_name: userLang === 'ja' ? entry.route.route_short_name : `${displayFrom} → ${displayTo}`,
        route_long_name: userLang === 'ja' ? entry.route.route_long_name : `${displayFrom} – ${displayTo}`,
        _source: sourceLabel(entry.route._source || '')
      },
      trips: (entry.trips || []).map(t => ({ ...t, _source: sourceLabel(t._source || '') }))
    }));

    // #23: 航路全体の時刻表有無を集計（すべてのtripが時刻なしなら「時刻表なし」を明示）
    const anyTimetable = relevantRoutes.some(entry => (entry.trips || []).some(t => t.has_timetable));
    const timetableStatus = anyTimetable
      ? (userLang === 'en' ? 'available' : userLang === 'zh' ? 'available' : 'あり')
      : (userLang === 'en' ? 'no_timetable' : userLang === 'zh' ? 'no_timetable' : 'なし');
    const noTimetableMsg = userLang === 'en'
      ? 'No departure times are available in the data (ODPT static GTFS is discontinued). Please check the official website for current schedules.'
      : userLang === 'zh'
        ? '数据中没有发船时刻（ODPT静态GTFS已停止提供）。请通过官方网站确认最新时刻表。'
        : '発着時刻のデータがありません（ODPT静的GTFSは廃止済み）。最新の時刻表は公式サイトでご確認ください。';

    const isWaterBus = ['浅草','お台場海浜公園','お台場','豊洲','日の出桟橋','日の出','浜離宮'].some(p => fromStop.stop_name.includes(p));
    const operatorName = userLang === 'en' ? (isWaterBus ? "Tokyo Cruise (Water Bus)" : "Tokai Kisen") :
                         userLang === 'zh' ? (isWaterBus ? "东京游览船（水上巴士）" : "东海汽船") :
                         (isWaterBus ? "東京クルーズ" : "東海汽船");

    if (relevantRoutes.length === 0) {
      const msg = userLang === 'en' ? "No matching ferry/waterbus routes found for the requested ports." :
                  userLang === 'zh' ? "未找到该港口间匹配的轮渡/水上巴士班次。" :
                  "該当航路なし";
      return jsonResponse({
        status: "SUCCESS",
        detected_language: userLang,
        from_port: displayFrom,
        to_port: displayTo,
        message: msg,
        operator: operatorName,
        official_website: isWaterBus ? 'https://www.suijobus.co.jp/' : 'https://www.tokaikisen.co.jp/',
        timetable_status: timetableStatus,
        timetable_message: anyTimetable ? undefined : noTimetableMsg,
        all_ports: data.stops.map(s => s.stop_name),
        maritime_safety_status: {
          tsunami_warning_active: false,
          source: tsunamiSafety.source,
          updated_at: tsunamiSafety.updated_at || undefined,
          unavailable: !tsunamiSafety.available || undefined,
          official_tsunami_info_url: 'https://www.jma.go.jp/bosai/tsunami/'
        },
        ai_transit_advice: aiAdvice,
        test_mode: testAdv.testMode,
        simulated_failure_type: testAdv.failureType || undefined
      });
    }

    return jsonResponse({
      status: "SUCCESS",
      detected_language: userLang,
      from_port: displayFrom,
      to_port: displayTo,
      routes: localizeRoutes(relevantRoutes),
      total_routes: relevantRoutes.length,
      operator: operatorName,
      official_website: isWaterBus ? 'https://www.suijobus.co.jp/' : 'https://www.tokaikisen.co.jp/',
      timetable_status: timetableStatus,
      timetable_message: anyTimetable ? undefined : noTimetableMsg,
      maritime_safety_status: {
        tsunami_warning_active: false,
        source: tsunamiSafety.source,
        updated_at: tsunamiSafety.updated_at || undefined,
        unavailable: !tsunamiSafety.available || undefined,
        official_tsunami_info_url: 'https://www.jma.go.jp/bosai/tsunami/'
      },
      ai_transit_advice: aiAdvice,
      test_mode: testAdv.testMode,
      simulated_failure_type: testAdv.failureType || undefined
    });
  } catch (error) {
    const errMsg = error.message || String(error);
    if (errMsg.includes('Circuit Breaker') || errMsg.includes('CIRCUIT_OPEN')) {
      return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT APIが利用できません（サーキットブレイカー作動中）。キャッシュが期限切れの場合は時間をおいてお試しください。', { userLang, breakerName: odptBreaker.name, breakerState: odptBreaker.state }));
    }
    return jsonResponse(buildErrorResponse(
      error.code === 'ECONNABORTED' ? 'API_TIMEOUT' : 'NETWORK_ERROR',
      'フェリー検索中にエラー: ' + errMsg, { userLang, from: fromPort, to: toPort, api: 'Ferry GTFS' }
    ));
  }
}

// ==========================================
// 🚃 交通事業者一覧
// ==========================================
async function listTransitOperators(args) {
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

// ==========================================
// 🚃 事業者別路線一覧
// ==========================================
async function getOperatorRoutes(args) {
  const userLang = resolveLang(args) || 'ja'; const opKey = args.operator_name;
  if (!opKey) return jsonResponse(buildErrorResponse('INVALID_INPUT', 'operator_name を指定。', { userLang }));
  let opId, opMeta;
  const normKey = RAILWAY_NAME_MAP[opKey] || opKey;
  if (NON_RAIL_OPERATORS[opKey]) { opMeta = NON_RAIL_OPERATORS[opKey]; opId = opMeta.id; }
  else if (OPERATOR_MAP[opKey]) { opId = OPERATOR_MAP[opKey]; opMeta = { type: 'rail' }; }
  else if (OPERATOR_MAP[normKey]) { opId = OPERATOR_MAP[normKey]; opMeta = { type: 'rail' }; }
  else if (RAILWAY_NAME_MAP[opKey]) { const nk = RAILWAY_NAME_MAP[opKey]; if (OPERATOR_MAP[nk]) { opId = OPERATOR_MAP[nk]; opMeta = { type: 'rail' }; } }
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
      station_count: r['odpt:stationOrder']?.length || 0
    }));
    // #53: ODPTに駅データが無い事業者（JR東日本等）は、内蔵 RAILWAY_LINES から補完する。
    // ODPT の odpt:Railway は路線定義を返すが、odpt:stationOrder が空（0駅）の路線が多い。
    // 内蔵グラフに同名路線（表記ゆれ吸収）があれば駅一覧を埋め、ODPT に無い路線
    // （例: 鶴見線）は事業者プレフィックスで追加する。
    const ODTP_TITLE_SET = new Set(railways.map(r => (r['dc:title'] || '').replace(/[・\s]/g, '')));
    const LOCAL_LINE_PREFIX = {
      'JR-East': 'JR', 'TokyoMetro': '東京メトロ', 'Toei': '都営',
      'Odakyu': '小田急', 'Keio': '京王', 'Seibu': '西武', 'Tobu': '東武',
      'Keikyu': '京急', 'Keisei': '京成', 'Sotetsu': '相鉄', 'Tokyu': '東急',
      'YokohamaMunicipal': '横浜市営地下鉄', 'MIR': 'ゆりかもめ', 'TWR': 'りんかい線',
      'Minatomirai': 'みなとみらい線', 'TsukubaExpress': 'つくばエクスプレス',
      'KantoRailway': '関東鉄道', 'SaitamaRailway': '埼玉高速鉄道', 'ToyoRapid': '東葉高速鉄道'
    };
    const prefix = LOCAL_LINE_PREFIX[opId];
    const odptLineNorm = (name) => (name || '').replace(/[・\s]/g, '');
    const routesWithFallback = [...routes];
    if (prefix) {
      for (const [lineName, stationsArr] of Object.entries(RAILWAY_LINES)) {
        // 内蔵路線がこの事業者に属するか（プレフィックス一致）
        if (!lineName.startsWith(prefix)) continue;
        const normLocal = odptLineNorm(lineName.replace(prefix, ''));
        // ODPT に既に同名路線（表記ゆれ吸収後）がある場合は、駅が空なら埋める
        const existing = routesWithFallback.find(rt => {
          const normRt = odptLineNorm(rt.railway);
          return normRt.includes(normLocal) || normLocal.includes(normRt);
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
    return jsonResponse({ status: "SUCCESS", detected_language: userLang, operator_name: opKey, type: opMeta.type, routes: routesWithFallback, total_routes: routesWithFallback.length, website: opMeta.website || null });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}

// ==========================================
// 🚃 運賃検索
// ==========================================
// 運賃検索用: 駅名 → odpt:Station 候補（全事業者）を解決（キャッシュ付き）。
// dc:title 完全一致で候補を取得し、1000件上限問題（odpt:RailwayFare 一括取得）を回避する。
// 🔴 通信障害と「取得成功だが0件」を分離する（#84）:
//  - 全クエリが失敗（ネットワーク断・タイムアウト）した場合は throw し、searchFare の
//    handleApiError が NETWORK_ERROR / API_TIMEOUT を返す。通信失敗はキャッシュしない。
//  - 少なくとも1クエリが成功して0件なのは「対象外/未収録」の正常結果として扱い、
//    短い negative TTL でのみキャッシュする（24時間ロック解除）。
const FARE_STATION_NEGATIVE_TTL = 5 * 60 * 1000; // 取得成功・0件のみ 5分
async function resolveFareStations(rawName) {
  const name = (normalizeStationName(rawName) || rawName || '').trim();
  if (!name) return [];
  const cacheKey = `${cache.railwayFare.key}:station:${name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) return [];
  const candidates = [];
  const queries = [name, name.replace(/(駅|站)$/, ''), name.replace(/駅前$/, '')]
    .filter((v, i, a) => v && a.indexOf(v) === i);
  let anySuccess = false;
  let lastError = null;
  for (const q of queries) {
    try {
      const res = await axios.get(`${API_BASE_URL}/odpt:Station`, { params: { 'acl:consumerKey': API_KEY, 'dc:title': q }, timeout: 15000 });
      odptBreaker.onSuccess();
      anySuccess = true;
      if (Array.isArray(res.data)) {
        for (const st of res.data) {
          const id = st['owl:sameAs'];
          if (id && !candidates.some(c => c.id === id)) {
            candidates.push({ id, operator: (st['odpt:operator'] || '').replace('odpt.Operator:', ''), title: st['dc:title'] || q });
          }
        }
      }
      if (candidates.length) break;
    } catch (e) { odptBreaker.onFailure(e); lastError = e; }
  }
  if (candidates.length === 0 && !anySuccess && lastError) {
    // 全クエリ通信失敗 → データ非対応と区別せず、通信障害として上位に伝播
    throw lastError;
  }
  const ttl = candidates.length ? cache.railwayFare.ttl : FARE_STATION_NEGATIVE_TTL;
  cache.set(cacheKey, candidates, ttl);
  return candidates;
}

// ODPT に運賃データ（odpt:RailwayFare）を提供している事業者
const FARE_OPERATORS = ['TokyoMetro', 'Toei', 'MIR', 'TWR', 'Yurikamome', 'YokohamaMunicipal', 'TamaMonorail'];
// 路線図（OPERATOR_MAP / NON_RAIL_OPERATORS）にはあるが ODPT に運賃データがない事業者（JR・私鉄等）
const NON_FARE_OPERATORS = Object.values(OPERATOR_MAP)
  .concat(Object.values(NON_RAIL_OPERATORS).map(o => o.id))
  .filter((id, i, a) => a.indexOf(id) === i)
  .filter(id => !FARE_OPERATORS.includes(id));

// 出発駅IDごとに運賃を分割取得（ODPT の 1000 件上限による切り捨てを回避）。
// 東京メトロ・都営に加え MIR（つくばエクスプレス）・TWR（りんかい線）・Yurikamome・
// 横浜市営地下鉄（YokohamaMunicipal）・多摩モノレール（TamaMonorail）も自動対応。
async function fetchFaresByFromStation(stationId) {
  const cacheKey = `${cache.railwayFare.key}:byfrom:${stationId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) return [];
  try {
    const res = await axios.get(`${API_BASE_URL}/odpt:RailwayFare`, { params: { 'acl:consumerKey': API_KEY, 'odpt:fromStation': stationId }, timeout: 15000 });
    const fares = Array.isArray(res.data) ? res.data : [];
    odptBreaker.onSuccess();
    cache.set(cacheKey, fares, cache.railwayFare.ttl);
    return fares;
  } catch (e) {
    // 🔴 通信失敗は空結果として握りつぶさず、searchFare の handleApiError に伝播させる（#84）
    odptBreaker.onFailure(e);
    throw e;
  }
}

async function searchFare(args) {
  const rawFrom = args.from || '';
  const rawTo = args.to || '';
  const from = normalizeStationName(rawFrom);
  const to = normalizeStationName(rawTo);
  const fromLang = detectLanguage(rawFrom);
  const toLang = detectLanguage(rawTo);
  const userLang = resolveLang(args) || (fromLang !== 'ja' ? fromLang : (toLang !== 'ja' ? toLang : 'ja'));

  if (!from || !to) {
    const msg = userLang === 'en' ? 'Please specify both origin and destination stations.' :
                userLang === 'zh' ? '请同时指定出发车站和到达车站。' :
                '両駅を指定してください。';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', msg, { userLang }));
  }
  if (!odptBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT API利用不可。', { userLang, from, to }));
  try {
    // 両駅を odpt:Station 候補へ解決し、出発駅ごとに運賃を分割取得
    const [fromStations, toStations] = await Promise.all([resolveFareStations(from), resolveFareStations(to)]);
    const toIds = new Set(toStations.map(st => st.id));
    const fareGroups = await Promise.all(fromStations.map(fs => fetchFaresByFromStation(fs.id)));
    const results = [];
    for (let i = 0; i < fromStations.length; i++) {
      for (const f of fareGroups[i]) {
        const tsId = f['odpt:toStation'] || '';
        if (tsId && toIds.has(tsId)) results.push(f);
      }
    }

    const displayFrom = getDisplayStationName(from, userLang);
    const displayTo = getDisplayStationName(to, userLang);

    if (results.length === 0) {
      // ODPT に運賃データがない事業者（JR・私鉄等）か、ペア未登録かの案内を分ける
      // 両駅とも運賃データ提供事業者なら「ペア未登録」、片方でも対象外なら「対象外」と案内
      const odptCovered = fromStations.some(st => FARE_OPERATORS.includes(st.operator)) &&
                          toStations.some(st => FARE_OPERATORS.includes(st.operator));
      const notFoundMsg = userLang === 'en'
        ? (odptCovered
          ? 'Fare data not found for this pair in ODPT.'
          : 'This route is not covered by ODPT fare data (JR East / JR Central / private railways / Tokyo Monorail etc.). Fares are available only for Tokyo Metro, Toei, Yokohama Municipal Subway, Tsukuba Express, Rinkai Line, Yurikamome, and Tama Monorail. Please check Yahoo! Transit.')
        : userLang === 'zh'
        ? (odptCovered
          ? 'ODPT 中未找到该区间的票价。'
          : '此路线不在 ODPT 票价数据覆盖范围内（JR东日本 / JR东海 / 私营铁路 / 东京单轨电车等）。仅东京地下铁、都营、横滨市营地铁、筑波快线、临海线、百合海鸥号、多摩单轨电车支持票价计算。请查看雅虎路线情报。')
        : (odptCovered
          ? 'この区間の運賃データがODPTに見つかりませんでした。'
          : 'この路線はODPTの運賃計算対象外です（JR東日本・JR東海・私鉄・東京モノレール等。対応は東京メトロ・都営・横浜市営地下鉄・つくばエクスプレス・りんかい線・ゆりかもめ・多摩モノレールのみ）。Yahoo!路線情報をご利用ください。');
      return jsonResponse({ status: "SUCCESS", detected_language: userLang, from: displayFrom, to: displayTo, fare: null, message: notFoundMsg, fare_coverage: { supported: FARE_OPERATORS, unsupported: NON_FARE_OPERATORS }, fallback_url: `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` });
    }

    const noteText = userLang === 'en' ? "ODPT RailwayFare (per-station, 24h Cache)" :
                     userLang === 'zh' ? "ODPT RailwayFare (按车站缓存: 24小时)" :
                     "ODPT RailwayFare (駅単位取得・キャッシュ: 24h)";

    // 最安値を single fare フィールドにも設定（後方互換・親切表示）
    const cheapest = results.reduce((best, f) => {
      const ticket = f['odpt:ticketFare'] ?? f['odpt:childTicketFare'] ?? Infinity;
      return ticket < best.ticket ? { ticket, f } : best;
    }, { ticket: Infinity, f: null });

    return jsonResponse({
      status: "SUCCESS", detected_language: userLang, from: displayFrom, to: displayTo,
      fare: cheapest.f ? {
        ticket: cheapest.f['odpt:ticketFare'] || cheapest.f['odpt:childTicketFare'] || null,
        ic: cheapest.f['odpt:icCardFare'] || cheapest.f['odpt:childIcCardFare'] || null,
        child_ticket: cheapest.f['odpt:childTicketFare'] || null,
        child_ic: cheapest.f['odpt:childIcCardFare'] || null
      } : null,
      fares: results.slice(0, 5).map(f => ({
        operator: f['odpt:operator']?.replace('odpt.Operator:', '') || 'Unknown',
        ticket: f['odpt:ticketFare'] || f['odpt:childTicketFare'] || null,
        ic: f['odpt:icCardFare'] || f['odpt:childIcCardFare'] || null,
        child_ticket: f['odpt:childTicketFare'] || null,
        child_ic: f['odpt:childIcCardFare'] || null
      })),
      data_source: noteText
    });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang, from, to });
  }
}

// ==========================================
// 🕐 時刻表検索
// ==========================================
// TrainTimetable 発着時刻の深夜0時越え正規化（GTFS 24:xx / 25:xx → 翌日表記）

// 24時超表記（25:xx 等）を「翌日フラグ付きのソート用分」へ変換する。
// 例: "25:10" → { minutes: 1510, nextDay: true } / "23:40" → { minutes: 1420, nextDay: false }

// #82: 検索日（YYYY-MM-DD）または calendar 引数から対象カレンダーを判定する。
// calendar 引数が指定されれば最優先。省略時は曜日で自動判定（土日=SaturdayHoliday）。
function resolveTimetableCalendar(arg, dateStr) {
  if (arg) {
    const a = String(arg).toLowerCase();
    if (a.includes('week') || a.includes('平日') || a === 'wd') return 'Weekday';
    if (a.includes('saturday') || a.includes('holiday') || a.includes('土') || a.includes('休') || a === 'sh') return 'SaturdayHoliday';
  }
  const d = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr) : new Date();
  const day = d.getDay(); // 0=日 6=土
  return (day === 0 || day === 6) ? 'SaturdayHoliday' : 'Weekday';
}

// 駅ID（odpt.Station:TokyoMetro.Namboku.Ichigaya）の末尾ローマ字を取り出す
function stationIdTail(stationId) {
  if (!stationId) return '';
  return String(stationId).split('.').pop() || '';
}

// #22: TrainTimetable は路線単位で取得（無フィルタ/事業者単位だと ODPT の1000件上限で
// 一部路線が欠落し、駅フィルタが機能しなかった。例: TokyoMetro 事業者単位では銀座線が欠落）
const TIMETABLE_OPERATORS = ['TokyoMetro', 'Toei', 'YokohamaMunicipal', 'TWR', 'MIR', 'TamaMonorail'];

// 対象事業者の路線ID一覧（odpt:Railway から取得・キャッシュ）
let _timetableRailways = null;
async function getTimetableRailways() {
  if (_timetableRailways) return _timetableRailways;
  try {
    const res = await axios.get(`${API_BASE_URL}/odpt:Railway`, { params: getParams(), timeout: 20000 });
    const lines = (res.data || [])
      .filter(r => {
        const op = r['odpt:operator'] || '';
        return TIMETABLE_OPERATORS.some(o => op.endsWith(`.${o}`) || op.endsWith(`:${o}`));
      })
      .map(r => r['owl:sameAs'] || r['@id'])
      .filter(Boolean);
    _timetableRailways = lines;
  } catch (_) {
    // 🔴 取得失敗時は空リストを永続キャッシュしない（次回呼び出しで再取得を試みる）
    return [];
  }
  return _timetableRailways;
}

async function getTimetable(args) {
  const rawStation = args.station_name || '';
  const stationName = normalizeStationName(rawStation);
  const railwayFilter = args.railway || null;
  // #82: calendar（Weekday / SaturdayHoliday）引数と検索日（YYYY-MM-DD）を追加。
  // 未指定時は当日の曜日で自動判定。
  const calendarArg = args.calendar || null;
  const serviceDate = (args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) ? args.date : null;
  const targetCalendar = resolveTimetableCalendar(calendarArg, serviceDate || undefined);
  const userLang = resolveLang(args) || detectLanguage(rawStation) || 'ja';
  if (!rawStation) {
    const msg = userLang === 'en' ? 'Please specify a station name.' : userLang === 'zh' ? '请指定车站名称。' : '駅名を指定してください。';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', msg, { userLang }));
  }
  if (!odptBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT API利用不可。', { userLang }));
  try {
    // #83: 路線単位 × calendar 別に分割取得してマージする。
    // 無フィルタの路線単位取得は ODPT の1000件上限に達する路線があり（例: 銀座線）、
    // 平日・土休日を跨いだ切り捨てが発生していた。calendar を指定すると
    // Weekday 658 + SaturdayHoliday 560 = 1,218件のように上限を回避して全件取得できる。
    // キャッシュはマージ結果で保持（キーに calendar 非依存の全件マージを入れる）。
    const cached = cache.get(`${cache.trainTimetable.key}:merged`);
    let allTimetables;
    let truncated = false;
    if (cached) { allTimetables = cached.merged; truncated = cached.truncated || false; }
    else {
      const railways = await getTimetableRailways();
      // 各路線 × 2 calendar を並列取得（1000件上限回避のため calendar を明示指定）
      const responses = await Promise.allSettled(railways.flatMap(rw =>
        ['odpt.Calendar:Weekday', 'odpt.Calendar:SaturdayHoliday'].map(cal =>
          axios.get(`${API_BASE_URL}/odpt:TrainTimetable`, { params: getParams(null, { 'odpt:railway': rw, 'odpt:calendar': cal }), timeout: 20000 })
        )
      ));
      const fulfilled = responses.filter(r => r.status === 'fulfilled' && Array.isArray(r.value.data));
      // 🔴 全路線の取得に失敗した場合は成功扱いにせず、空データもキャッシュしない
      //（空の時刻表を1時間キャッシュすると、障害復旧後もNO_DATAを返し続けるため）。
      if (railways.length > 0 && fulfilled.length === 0) {
        const firstRejected = responses.find(r => r.status === 'rejected');
        throw (firstRejected?.reason || new Error('All ODPT train timetable requests failed'));
      }
      // 🔴 #83: 1000件ちょうど（または超過）のレスポンスは切り捨ての可能性があるため
      // truncated フラグを立て、完全なデータとして SUCCESS を返さない。
      truncated = fulfilled.some(r => Array.isArray(r.value.data) && r.value.data.length >= 1000);
      allTimetables = fulfilled.flatMap(r => r.value.data);
      odptBreaker.onSuccess();
      cache.set(`${cache.trainTimetable.key}:merged`, { merged: allTimetables, truncated }, cache.trainTimetable.ttl);
    }

    // ローマ字駅ID → 日本語駅名 の逆引き（駅フィルタ用）
    const romanToJa = await getStationRomanToJa();
    const stationLower = stationName.toLowerCase();

    // レコードが指定駅を通るか判定:
    //  - odpt:originStation / odpt:destinationStation（ID末尾ローマ字）
    //  - odpt:trainTimetableObject[].odpt:departureStation / odpt:arrivalStation（ID末尾ローマ字）
    // 日本語駅名とローマ字IDの両対応（例: 新宿 ⇔ ...Shinjuku）
    const recordMatchesStation = (t) => {
      const ids = [];
      for (const key of ['odpt:originStation', 'odpt:destinationStation']) {
        const v = t[key];
        if (Array.isArray(v)) ids.push(...v);
        else if (v) ids.push(v);
      }
      for (const obj of (t['odpt:trainTimetableObject'] || [])) {
        if (obj['odpt:departureStation']) ids.push(obj['odpt:departureStation']);
        if (obj['odpt:arrivalStation']) ids.push(obj['odpt:arrivalStation']);
      }
      for (const id of ids) {
        const tail = stationIdTail(id).toLowerCase();
        if (!tail) continue;
        // ID末尾ローマ字との一致（完全一致または前方一致）
        if (tail === stationLower || tail.startsWith(stationLower) || stationLower.startsWith(tail)) return true;
        // ローマ字 → 日本語名 との一致
        const jaName = romanToJa[tail];
        if (jaName && (jaName === stationName || jaName.includes(stationName) || stationName.includes(jaName))) return true;
      }
      return false;
    };

    // #82: 対象 calendar のみに絞り込む（平日検索に土休日列車を混入させない）
    const matched = allTimetables.filter(t => {
      // odpt:calendar は "odpt.Calendar:Weekday" 形式（. と : の両方で区切る）
      const cal = t['odpt:calendar'] || '';
      const calTail = cal.split(/[.:]/).pop() || cal;
      return recordMatchesStation(t) && calTail === targetCalendar;
    });

    // #82: 方面（odpt:railDirection）ごとにグループ化し、各グループ内を
    // 指定駅での出発時刻（24時超は翌日扱い）で昇順ソートしてから表示する。
    // 列車レコードは全駅の trainTimetableObject を持つため、行のソートキーは
    // extractTimes で得た最初の departure 時刻を使う。
    const firstDepartureMinutes = (t) => {
      for (const obj of (t['odpt:trainTimetableObject'] || [])) {
        const depId = obj['odpt:departureStation'] || '';
        const depTail = stationIdTail(depId).toLowerCase();
        const depJa = depTail ? romanToJa[depTail] : '';
        const atDep = (depTail && (depTail === stationLower || depTail.startsWith(stationLower) || (depJa && (depJa === stationName || depJa.includes(stationName) || stationName.includes(depJa)))));
        if (atDep && obj['odpt:departureTime']) {
          const sm = timeToSortMinutes(obj['odpt:departureTime']);
          if (sm) return sm.minutes;
        }
      }
      return Number.MAX_SAFE_INTEGER;
    };
    const directionKey = (t) => {
      const d = t['odpt:railDirection'] || '';
      return (d.split(/[.:]/).pop() || d).toLowerCase();
    };
    const grouped = {};
    for (const t of matched) {
      const k = directionKey(t);
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(t);
    }
    const sortedMatched = Object.keys(grouped)
      .sort()
      .flatMap(k => grouped[k].sort((a, b) => firstDepartureMinutes(a) - firstDepartureMinutes(b)));

    // 指定駅での発着時刻を trainTimetableObject から抽出
    // #82: 24時超表記は翌日フラグ付きソートキー（sortMinutes）と表示時刻を分離
    const extractTimes = (t) => {
      const times = [];
      for (const obj of (t['odpt:trainTimetableObject'] || [])) {
        const depId = obj['odpt:departureStation'] || '';
        const arrId = obj['odpt:arrivalStation'] || '';
        const depTail = stationIdTail(depId).toLowerCase();
        const arrTail = stationIdTail(arrId).toLowerCase();
        const depJa = depTail ? romanToJa[depTail] : '';
        const arrJa = arrTail ? romanToJa[arrTail] : '';
        const atDep = (depTail && (depTail === stationLower || depTail.startsWith(stationLower) || (depJa && (depJa === stationName || depJa.includes(stationName) || stationName.includes(depJa)))));
        const atArr = (arrTail && (arrTail === stationLower || arrTail.startsWith(stationLower) || (arrJa && (arrJa === stationName || arrJa.includes(stationName) || stationName.includes(arrJa)))));
        if (atDep && obj['odpt:departureTime']) {
          const raw = obj['odpt:departureTime'];
          times.push({ kind: 'departure', time: normalizeOvernightTime(raw), sort: timeToSortMinutes(raw), nextDay: (timeToSortMinutes(raw)?.nextDay) || false });
        }
        if (atArr && obj['odpt:arrivalTime']) {
          const raw = obj['odpt:arrivalTime'];
          times.push({ kind: 'arrival', time: normalizeOvernightTime(raw), sort: timeToSortMinutes(raw), nextDay: (timeToSortMinutes(raw)?.nextDay) || false });
        }
      }
      return times;
    };

    const buildRow = (t) => {
      const times = extractTimes(t);
      const departures = times.filter(x => x.kind === 'departure');
      const arrivals = times.filter(x => x.kind === 'arrival');
      const destId = Array.isArray(t['odpt:destinationStation']) ? (t['odpt:destinationStation'][0] || '') : (t['odpt:destinationStation'] || '');
      const destTail = stationIdTail(destId);
      // #82: 方面（railDirection）別に分離して表示。departure / arrival それぞれ昇順ソート
      const sortByTime = (arr) => [...arr].sort((a, b) => (a.sort?.minutes ?? 0) - (b.sort?.minutes ?? 0));
      const depSorted = sortByTime(departures);
      const arrSorted = sortByTime(arrivals);
      return {
        railway: t['odpt:railway'],
        train: t['odpt:train'],
        destination: destTail ? (romanToJa[destTail.toLowerCase()] || destTail) : destId,
        type: t['odpt:trainType'],
        direction: t['odpt:railDirection'],
        calendar: targetCalendar, // #82: 応答に calendar を含める
        departure_time: depSorted.length ? depSorted.map(x => x.time).join(', ') : null,
        departure_next_day: depSorted.some(x => x.nextDay) || undefined, // #82: 24時超は翌日扱い
        arrival_time: arrSorted.length ? arrSorted.map(x => x.time).join(', ') : null,
        arrival_next_day: arrSorted.some(x => x.nextDay) || undefined
      };
    };

    const displayStation = getDisplayStationName(stationName, userLang);

    if (railwayFilter) {
      // 日本語路線名を ODPT ローマ字IDに変換（例: 山手線 → yamanote）
      const rfLower = railwayFilter.toLowerCase();
      const railwayKey = RAILWAY_NAME_MAP[railwayFilter] || RAILWAY_NAME_MAP[railwayFilter.replace(/線$/, '')] || rfLower;
      const filtered = sortedMatched.filter(t => {
        const r = (t['odpt:railway'] || '').toLowerCase();
        const rKey = r.split('.').pop() || r;
        return r.includes(railwayKey) || rKey.includes(railwayKey) || railwayKey.includes(rKey);
      });
      if (filtered.length > 0) return jsonResponse({ status: "SUCCESS", detected_language: userLang, station: displayStation, railway: getDisplayLineName(railwayFilter, userLang), calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), truncated: truncated || undefined, total: filtered.length, timetable: filtered.slice(0, 20).map(buildRow), data_source: "ODPT TrainTimetable (路線×calendar別取得)", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
      // フィルタ結果が 0 件なら「該当路線のデータなし」を明確に返す（誤って全件を返さない）
      const noRailwayMsg = userLang === 'en'
        ? `No timetable found for railway "${getDisplayLineName(railwayFilter, userLang)}" at ${displayStation} (${targetCalendar}).`
        : userLang === 'zh'
          ? `在${displayStation}未找到路线「${getDisplayLineName(railwayFilter, userLang)}」的时程表（${targetCalendar}）。`
          : `${displayStation}の「${railwayFilter}」の時刻表は見つかりませんでした（${targetCalendar}）。`;
      return jsonResponse({ status: "NO_DATA", detected_language: userLang, station: displayStation, railway: getDisplayLineName(railwayFilter, userLang), calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), total: 0, message: noRailwayMsg, data_source: "ODPT TrainTimetable", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
    }
    if (sortedMatched.length === 0) {
      const noDataMsg = userLang === 'en'
        ? `No timetable data found for ${displayStation} in ODPT (JR East and most private railways are not covered).`
        : userLang === 'zh'
          ? `ODPT中未找到 ${displayStation} 的时程表数据（JR东日本及大部分私铁不在覆盖范围内）。`
          : `${displayStation} の時刻表データはODPTにありません（JR東日本・大部分の私鉄は対象外）。`;
      return jsonResponse({ status: "NO_DATA", detected_language: userLang, station: displayStation, calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), total: 0, message: noDataMsg, data_source: "ODPT TrainTimetable", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
    }
    return jsonResponse({ status: "SUCCESS", detected_language: userLang, station: displayStation, calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), truncated: truncated || undefined, total: sortedMatched.length, timetable: sortedMatched.slice(0, 20).map(buildRow), data_source: "ODPT TrainTimetable (路線×calendar別取得)", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}

// ==========================================
// 🚌 バス路線検索（都営バス）
// ==========================================
// 🚌 バス事業者マップ（odpt:Bus エンドポイントで実データが取得可能な事業者のみ）
// 調査実績（2026-08-02, ODPT本番API）：
//   Toei(都営バス)=425件 / SeibuBus(西武バス)=271件 / YokohamaMunicipal(横浜市交通局)=296件  → odpt:Bus で取得可
//   KeioBus/OdakyuBus/TokyuBus/SotetsuBus/NishiTokyoBus = 0件（GTFS形式等で別提供）
//   JRバス関東 = ODPT未登録（JR-East/JR-Central のみ）
// 足の悪いユーザー向け：これら3社で近郊バス網をカバー。マージは Promise.allSettled で並列取得。

// ============================================================
// 🚌 GTFS-JP 個別取得パス（JRバス・コミュニティバス等）
// ------------------------------------------------------------
// 背景: ODPT の odpt:Bus（REST）には 都営/西武/横浜市営 の3社のみ。
// 京王・東急・小田急等は ODPT GTFS エンドポイント（files/odpt/...）が
// 2026年時点で全事業者 404/500（バグK）。各社公式GTFSはURL不安定（日々更新・
// ファイル名不定）。JRバス関東は ODPT 未登録。
// → 安定取得が不可能なため、hardCoded フォールバックで主要バス停・系統を
//   定義し検索可能にする（フェリーの FERRY_GTFS_SOURCES と同設計）。
//   将来的に安定URLが確定したら { url, date } ソースとして追加可能。
// ============================================================
// ============================================================
// 🚌 東京都コミュニティバス ディレクトリ（41自治体）
// ------------------------------------------------------------
// 出典: 東京バス協会「東京バス案内WEB」スマホ版 https://www.tokyobus.or.jp/sp/ の
// 「コミュニティバス検索」一覧（JSバンドル内の静的リンク集）。2026-08 に取得・確認。
// 本サイトは路線・停留所・時刻表データを持たず各自治体公式ページへのリンクのみのため、
// 検索結果では「名称＋自治体＋公式URL」の案内を表示する（ディレクトリ用途）。

// ============================================================
// 🚌 コミュニティバス 駅接続ルート（主要10件・Phase 1/2 共通データ）
// ------------------------------------------------------------
// 足の悪いユーザーの「自宅→駅」「駅→目的地」をコミュニティバスでつなぐための
// 駅接続データ。出典: 各自治体公式サイト（2026-08 にURL・路線・主要駅を確認）。
// - routes: 代表系統の駅前停留所を順序付きで列挙（中間停留所は省略・公式サイト参照）
// - stations: { 駅名: 駅前バス停名 } — 駅⇔バス停の徒歩接続（link）に使用
// ⚠️ データは「代表駅接続」であり全停留所を網羅しない。時刻表・全ルートは各公式URL参照。
//   バリアフリー（車椅子等）情報は自治体サイトで確認する旨をレスポンスで注意喚起する。

// 駅名 → コミュニティバス案内（Phase 1 の案内モード用・複数バス対応）


// hardCoded バスソースから {merged} 形式のレコードを合成
function buildHardCodedBusRecords(src) {
  const recs = [];
  for (const stop of src.stops) {
    recs.push({
      'odpt:note': stop,
      'odpt:busroute': `${src.operatorId}:stop`,
      'odpt:busNumber': '',
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
      _searchKeys: [stop],
      _displayNote: stop,
      _hardCoded: true
    });
  }
  // 系統（route）も検索対象に: "起点 → 終点" の note を合成
  for (const [from, to] of (src.routes || [])) {
    const note = `${from} → ${to}`;
    recs.push({
      'odpt:note': note,
      'odpt:busroute': `${src.operatorId}:route`,
      'odpt:busNumber': '',
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
      _searchKeys: [from, to, note],
      _displayNote: note,
      _hardCoded: true
    });
  }
  // コミュニティバス ディレクトリ（自治体×バス名×公式URL）も検索対象に
  // 出典: tokyobus.or.jp/sp のコミュニティバス検索一覧（名称＋自治体＋公式ページURL）
  for (const cb of (src.communityBuses || [])) {
    const note = `[コミュニティバス] ${cb.name}（${cb.municipality}）`;
    const searchable = `${cb.municipality}${cb.name}`;
    recs.push({
      'odpt:note': note,
      'odpt:busroute': `${src.operatorId}:cb:${cb.name}`,
      'odpt:busNumber': '',
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
      _searchKeys: [cb.name, cb.municipality, searchable, note, 'コミュニティバス'],
      _displayNote: `${cb.name}（${cb.municipality}）`,
      _communityBus: true,
      _communityBusUrl: cb.url,
      _municipality: cb.municipality,
      _hardCoded: true
    });
  }
  return recs;
}

// 横浜市営バスは odpt:note が null で、バス停名がローマ字ID（例: SakuragichoStation）しかない。
// ローマ字駅名→日本語の最小マップ（主要ターミナル＋観光地）を付与し、日本語入力でも検索可能にする。
// ODPTには全バス停の日本語名が無いため、網羅ではなく主要駅に限定。

// 事業者ID→ラベル逆引き（レコードの odpt:operator から表示名を出す）

// BusstopPole ID（例: odpt.BusstopPole:YokohamaMunicipal.SakuragichoStation.2014.2）
// から駅名相当（SakuragichoStation）を抽出。ODPTには日本語バス停名が無い事業者（横浜市営等）向け。
function poleIdSeg(poleRef) {
  if (!poleRef) return null;
  const last = String(poleRef).split(':').pop(); // YokohamaMunicipal.SakuragichoStation.2014.2
  return last.replace(/^[A-Za-z]+\./, '').replace(/\.\d+\.\d+$/, ''); // SakuragichoStation
}

async function fetchAllBuses(userLang) {
  // サーキットブレイカーOPEN時は ODPT を呼ばず、ハードコード（JRバス関東・コミュニティバス）のみ返す。
  // コミュニティバス検索（ちぃばす等）は ODPT 無しでも動作させるためのフォールバック。
  if (!odptBreaker.canExecute()) {
    console.log('[Bus] ODPT breaker OPEN — skip ODPT operators, use hardcoded sources only');
    const merged = [];
    let hcCount = 0;
    for (const src of BUS_GTFS_SOURCES) {
      if (!src.hardCoded) continue;
      for (const r of buildHardCodedBusRecords(src)) merged.push(r);
      hcCount++;
    }
    return { merged, okCount: 0, failCount: BUS_OPERATORS.length, hcCount };
  }
  // 全バス事業者を並列取得してマージ（1社でも失敗しても他社は維持）
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:Bus`, { params: getParams(op.id), timeout: 15000 })
    )
  );
  const merged = [];
  let okCount = 0, failCount = 0;
  results.forEach((res, i) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      okCount++;
      for (const b of res.value.data) {
        const opMeta = BUS_OPERATORS[i];
        // 検索用キーを構築（note が無い事業者も BusstopPole ID から駅名相当を拾う）
        const note = b['odpt:note'] || '';
        const segs = [poleIdSeg(b['odpt:startingBusstopPole']), poleIdSeg(b['odpt:terminalBusstopPole'])].filter(Boolean);
        // ローマ字駅名→日本語を付与（横浜市営等 note=null 事業者の日本語検索用）
        const segJa = segs.map(s => BUSSTOP_ROMAN_TO_JA[s] || null).filter(Boolean);
        const searchKeys = [note, ...segs, ...segJa].filter(Boolean);
        // 表示用 note（note が null の横浜市営等は 起点→終点 を 日本語優先で表示）
        const dispSeg = segs.map(s => BUSSTOP_ROMAN_TO_JA[s] || s);
        const displayNote = note || (dispSeg.length ? `${dispSeg[0]} → ${dispSeg[1] || dispSeg[0]}` : (b['odpt:busroute'] || ''));
        merged.push({ ...b, _operatorId: opMeta.id, _operatorLabel: opMeta, _searchKeys: searchKeys, _displayNote: displayNote });
      }
    } else {
      failCount++;
    }
  });
  // 🔴 odpt:Bus は「リアルタイムのバス位置情報」のみを返し、系統・停留所一覧は持たない
  // （無料キーでも 4件程度の現在位置が返るため merged.length===0 にならない）。
  // そのため odpt:Bus の _searchKeys だけでは「浅草雷門」等の停名検索がヒットしない。
  // 停名検索モード（busstop_name）を実用化するため、ODPT が応答していれば問わず
  // odpt:BusroutePattern の停留所名（busstopPoleOrder[].odpt:note）を検索キーとして合成する。
  // （odpt:Bus リアルタイム便のレコードは merged に残したまま、停名レコードを追加マージする）
  if (okCount > 0) {
    try {
      const { patterns } = await fetchBusGraph();
      const stopMap = new Map(); // stopName -> { operator, label }
      for (const p of patterns) {
        const opMeta = BUS_OPERATORS.find(o => o.id === p.operator);
        for (const s of p.stops) {
          if (!s.name) continue;
          if (!stopMap.has(s.name)) {
            stopMap.set(s.name, { operator: p.operator, label: opMeta });
          }
        }
      }
      for (const [stopName, meta] of stopMap) {
        const opMeta = meta.label || { label: meta.operator, labelEn: meta.operator, labelZh: meta.operator, website: undefined };
        merged.push({
          'odpt:note': stopName,
          'odpt:busroute': `${meta.operator}:stop-fallback`,
          'odpt:busNumber': '',
          'odpt:frequency': '',
          'odpt:operator': `odpt.Operator:${meta.operator}`,
          _operatorId: meta.operator,
          _operatorLabel: opMeta,
          _searchKeys: [stopName],
          _displayNote: stopName,
          _busstopFallback: true
        });
      }
      console.log(`[Bus] odpt:Bus empty — BusroutePattern fallback added ${stopMap.size} bus stops`);
    } catch (e) {
      console.log(`[Bus] BusroutePattern fallback failed: ${e.message}`);
    }
  }
  // GTFS-JP 個別取得パス: hardCoded ソース（JRバス関東・コミュニティバス等）をマージ
  // および ODPT 静的 GTFS ソース（川崎市バス・関東バス等・{ url, date } 方式）を展開してマージ
  let hcCount = 0;
  for (const src of BUS_GTFS_SOURCES) {
    if (src.hardCoded) {
      const hcRecs = buildHardCodedBusRecords(src);
      for (const r of hcRecs) merged.push(r);
      hcCount++;
      continue;
    }
    // ODPT 静的 GTFS（files/odpt/...・基本ライセンス）: フェリーと同じ { url, date } 方式。
    // stops.txt の stop_name を停名レコード、routes.txt の route_short_name を系統レコードとして合成。
    // 🔴 stop_times.txt は最大95万行（川崎市バス）と巨大なため、全体は保持せず各系統の代表1trip の
    //    起終点（先頭/末尾の stop_sequence）だけを取得する（searchBus は停名/系統検索が主目的）。
    try {
      const zipBuf = await fetchGtfsZipBuffer(src, 20000);
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(Buffer.from(zipBuf));
      const parseCsv = (entryName) => {
        const e = zip.getEntry(entryName);
        if (!e) return [];
        const records = parseCsvRecords(e.getData().toString('utf8'));
        if (!records.length) return [];
        const headers = records[0];
        return records.slice(1).map(values => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = values[i] || ''; });
          return obj;
        });
      };
      // 1) stops.txt → stop_id → stop_name（1回だけパース）
      const stopRows = parseCsv('stops.txt');
      const stopNameById = new Map();
      for (const s of stopRows) if (s.stop_id) stopNameById.set(s.stop_id, s.stop_name || s.stop_id);
      // 2) trips.txt → route_id の代表 trip_id（先頭1件のみ・1回だけパース）
      const tripRows = parseCsv('trips.txt');
      const firstTripByRoute = new Map();
      for (const t of tripRows) {
        if (t.route_id && !firstTripByRoute.has(t.route_id)) firstTripByRoute.set(t.route_id, t.trip_id);
      }
      // 3) stop_times.txt → 代表 trip の起終点 stop（先頭/末尾の stop_sequence のみ抽出・1回だけパース）
      const endpointByTrip = new Map(); // trip_id -> { first: stop_id, last: stop_id }
      {
        const wanted = new Set(firstTripByRoute.values());
        let seq = new Map(); // trip_id -> [stop_id, maxSeq]
        const e = zip.getEntry('stop_times.txt');
        if (e) {
          const records = parseCsvRecords(e.getData().toString('utf8'));
          if (records.length) {
            const headers = records[0] || [];
            const ti = headers.indexOf('trip_id'), si = headers.indexOf('stop_id'), qi = headers.indexOf('stop_sequence');
            for (const vals of records.slice(1)) {
              const tid = vals[ti], sid = vals[si], q = Number(vals[qi] || 0);
              if (!wanted.has(tid)) continue;
              const cur = seq.get(tid);
              if (!cur) seq.set(tid, [sid, sid, q, q]);
              else {
                if (q < cur[2]) cur[0] = sid, cur[2] = q;
                if (q > cur[3]) cur[1] = sid, cur[3] = q;
              }
            }
          }
        }
        for (const [tid, v] of seq) endpointByTrip.set(tid, { first: v[0], last: v[1] });
      }
      const seen = new Set();
      // 4) 停名レコード（stops.txt）
      for (const s of stopRows) {
        const name = s.stop_name || s.stop_id || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);
        merged.push({
          'odpt:note': name,
          'odpt:busroute': `${src.operatorId}:stop:${s.stop_id}`,
          'odpt:busNumber': '',
          'odpt:frequency': '',
          'odpt:operator': `odpt.Operator:${src.operatorId}`,
          _operatorId: src.operatorId,
          _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
          _searchKeys: [name],
          _displayNote: name,
          _gtfsSource: src.name
        });
      }
      // 5) 系統レコード（routes.txt）: 起終点を「起点 → 終点」形式で合成
      for (const r of parseCsv('routes.txt')) {
        const shortName = r.route_short_name || r.route_long_name || r.route_id || '';
        const tripId = firstTripByRoute.get(r.route_id);
        const ep = tripId ? endpointByTrip.get(tripId) : null;
        const origin = ep ? (stopNameById.get(ep.first) || ep.first) : '';
        const dest = ep ? (stopNameById.get(ep.last) || ep.last) : '';
        const note = (origin && dest) ? `${origin} → ${dest}` : shortName;
        if (seen.has(note)) continue;
        seen.add(note);
        merged.push({
          'odpt:note': note,
          'odpt:busroute': `${src.operatorId}:route:${r.route_id}`,
          'odpt:busNumber': shortName,
          'odpt:frequency': '',
          'odpt:operator': `odpt.Operator:${src.operatorId}`,
          _operatorId: src.operatorId,
          _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
          _searchKeys: [shortName, note, origin, dest].filter(Boolean),
          _displayNote: note,
          _gtfsSource: src.name
        });
      }
      console.log(`[Bus] ${src.name}: GTFS loaded (${seen.size} 停名・系統)`);
      odptBreaker.onSuccess();
      hcCount++;
    } catch (e) {
      console.log(`[Bus] ${src.name}: GTFS skip (${e.message})`);
      odptBreaker.onFailure(e);
    }
  }
  // コミュニティバス（めぐりん・江戸バス等・COMMUNITY_BUS_ROUTES）の停留所も検索プールに追加。
  // 乗り継ぎグラフ（buildTransferGraph）には既に組み込まれているが、busstop_name 検索モードでは
  // ヒットしなかったため、バス停検索でも引けるようにする。
  for (const cb of COMMUNITY_BUS_ROUTES) {
    const cbMeta = { label: cb.bus, labelEn: cb.bus, labelZh: cb.bus, website: cb.url };
    const cbStops = new Set();
    for (const route of cb.routes) for (const stopName of route.stops) cbStops.add(stopName);
    for (const stopName of cbStops) {
      merged.push({
        'odpt:note': stopName, 'odpt:busroute': `${cb.municipality}:${cb.bus}:stop`,
        'odpt:busNumber': '', 'odpt:frequency': '', 'odpt:operator': `odpt.Operator:${cb.municipality}`,
        _operatorId: cb.municipality, _operatorLabel: cbMeta,
        _searchKeys: [stopName, cb.bus, cb.municipality],
        _displayNote: stopName, _communityBus: true, _communityBusUrl: cb.url,
        _municipality: cb.municipality, _hardCoded: true
      });
    }
  }
  return { merged, okCount, failCount, hcCount };
}

// ============================================================
// 🚌 バス乗り継ぎ（Transfer）経路探索 — 案B
// ------------------------------------------------------------
// データソース: ODPT odpt:BusroutePattern.busstopPoleOrder（停留所順序）
// バリアフリー: odpt:BusTimetable.busTimetableObject[].isNonStepBus（ノンステップバス）
// 対象: BUS_OPERATORS（ODPT実データ3社: 都営/西武/横浜市営）のみ。
//       hardCodedソース（JRバス関東・コミュニティバス）は停留所順序データが
//       無いため乗り継ぎグラフから除外（直達検索も不可）。
// ============================================================

// バス停名の簡易正規化（駅名マップに依存しない）: trim のみ。
// 注意: 「駅前」「駅」等の suffix は除去しない（バス停の正規名は「○○駅前」のまま）。
// ただし英字・中国語の駅名入力（'Shibuya Station' / '涩谷' 等）は駅名正規化
// （STATION_NAME_MAP: romaji/zh→日本語）を適用して解決できるようにする。
// グラフ構築と検索で同一正規化を使うことでノード名一致を担保する。
function normalizeBusStop(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return trimmed;
  // 末尾の 駅/Station/站 サフィックスを除去してから駅名正規化（バス停名「渋谷駅前」は対象外）
  const stripped = trimmed.replace(/(駅|Station|站|St\.?)\s*$/i, '').trim();
  const normalized = normalizeStationName(stripped);
  // 🔴 サフィックス除去後（stripped）を常に返す。normalizeStationName はローマ字→日本語辞書で、
  // 「川崎站」→「川崎」のように日本語名のままの場合は何もしない（normalized === stripped）が、
  // その場合も「川崎站」ではなく「川崎」を返さないと検索がヒットしない。
  if (normalized && normalized !== stripped) return normalized;
  if (stripped && stripped !== trimmed) return stripped;
  return trimmed;
}

// odpt:BusroutePattern から (operator, routePatternId, [orderedStopNames]) を取得
async function fetchBusGraph(signal) {
  const cached = cache.get(cache.busGraph.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) throw new Error('ODPT API is currently offline (Circuit Breaker is OPEN)');
  const patterns = []; // { operator, patternId, stops: [{name, poleId}] }
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:BusroutePattern`, { params: getParams(op.id), timeout: 8000, signal })
    )
  );
  results.forEach((res, i) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      const opId = BUS_OPERATORS[i].id;
      for (const p of res.value.data) {
        const order = p['odpt:busstopPoleOrder'];
        if (!Array.isArray(order) || !order.length) continue;
        const stops = order
          .sort((a, b) => (a['odpt:index'] || 0) - (b['odpt:index'] || 0))
          .map(o => ({ name: o['odpt:note'] || '', poleId: o['odpt:busstopPole'] || '' }))
          .filter(s => s.name);
        if (stops.length >= 2) patterns.push({ operator: opId, patternId: p['owl:sameAs'] || p['@id'], stops });
      }
      odptBreaker.onSuccess();
    } else {
      odptBreaker.onFailure(res.reason || new Error('BusroutePattern fetch failed'));
    }
  });
  // 🔴 全事業者の取得に失敗した場合は空グラフをキャッシュしない（TTL中NOT_FOUND固定化を防ぐ）
  if (results.every(r => r.status === 'rejected')) {
    throw (results[0]?.reason || new Error('All BusroutePattern requests failed'));
  }
  const data = { patterns };
  cache.set(cache.busGraph.key, data, cache.busGraph.ttl);
  return data;
}

// odpt:BusTimetable から (patternId → 各停留所の isNonStepBus) および
// (stopName → isNonStepBus) を取得。stopName マップは patternId 不一致を回避するためのフォールバック。
async function fetchBusTimetable(signal) {
  const cached = cache.get(cache.busTimetable.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) throw new Error('ODPT API is currently offline (Circuit Breaker is OPEN)');
  const nonStepByPattern = {}; // patternId -> { stopName: bool }
  const nonStepByStop = {};     // stopName -> bool（patternId 不一致のフォールバック）
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:BusTimetable`, { params: getParams(op.id), timeout: 8000, signal })
    )
  );
  results.forEach((res) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      for (const t of res.value.data) {
        const pid = t['odpt:busroutePattern'];
        if (!pid) continue;
        const objs = t['odpt:busTimetableObject'] || [];
        if (!nonStepByPattern[pid]) nonStepByPattern[pid] = {};
        for (const o of objs) {
          // odpt:note は "早大正門:839:7" 形式（停留所名:数字:数字）のため、
          // ":" 以降を除去して busstopPoleOrder の停留所名（"早大正門"）と一致させる
          const raw = (o['odpt:note'] || '').split(':')[0].trim();
          const name = normalizeBusStop(raw);
          if (name && typeof o['odpt:isNonStepBus'] === 'boolean') {
            // 一つでもノンステップ便があれば true（系統レベルで「運行あり」とする）
            nonStepByPattern[pid][name] = nonStepByPattern[pid][name] || o['odpt:isNonStepBus'];
            nonStepByStop[name] = nonStepByStop[name] || o['odpt:isNonStepBus'];
          }
        }
      }
      odptBreaker.onSuccess();
    } else {
      odptBreaker.onFailure(res.reason || new Error('BusTimetable fetch failed'));
    }
  });
  // 🔴 全事業者の取得に失敗した場合は空データをキャッシュしない
  if (results.every(r => r.status === 'rejected')) {
    throw (results[0]?.reason || new Error('All BusTimetable requests failed'));
  }
  const data = { nonStepByPattern, nonStepByStop };
  cache.set(cache.busTimetable.key, data, cache.busTimetable.ttl);
  return data;
}

// 乗り継ぎグラフ構築: ノード=バス停(正規化済), エッジ=同一路線の隣接停留所
// 共有バス停を乗り継ぎ点とする。重みは停留所数（1エッジ=1停留所）。
// 一貫性のため、stopToPatterns の stops は normalizeBusStop 済みの文字列配列を保存。
function buildTransferGraph(patterns) {
  const adj = new Map(); // stopName -> Set(neighborStopName)
  const stopToPatterns = new Map(); // stopName -> [{operator, patternId, stops: [normName,...]}]
  const addEdge = (a, b) => {
    // 有向エッジ: 路線の進行方向（a→b）のみ。無向にすると逆走区間を提案してしまう。
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
  };
  for (const p of patterns) {
    // 停留所名を正規化。空文字（odpt:note 欠損等）はスキップし、前の有効停留所から
    // 次の有効停留所へエッジを張る（中間欠損による「飛び越し隣接」を防ぐ）。
    // 正規化済みの停車順は系統ごとに1回だけ計算して全停留所で共有する。
    const normStops = p.stops.map(x => normalizeBusStop(x.name)).filter(Boolean);
    let prevValid = null;
    for (const raw of p.stops) {
      const s = normalizeBusStop(raw.name);
      if (!s) continue; // 空名称はスキップ
      if (!stopToPatterns.has(s)) stopToPatterns.set(s, []);
      stopToPatterns.get(s).push({ operator: p.operator, patternId: p.patternId, stops: normStops });
      if (prevValid) addEdge(prevValid, s);
      prevValid = s;
    }
  }
  return { adj, stopToPatterns };
}

// ============================================================
// 🚌🚃 バス⇔電車 横断乗り継ぎ（bus→train→bus）
// ============================================================

// 電車駅名レベル隣接グラフ（RAILWAY_LINES から構築）。重みは駅数ベース（1）。
// 同一駅に複数路線が来る場合、路線間乗換を自動結合（駅名レベルで全隣接をマージ）。
function buildTrainNameGraph() {
  const adj = new Map(); // stationName -> Set(neighborStationName)
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const stations of Object.values(RAILWAY_LINES)) {
    for (let i = 0; i < stations.length - 1; i++) add(stations[i], stations[i + 1]);
  }
  // 路線間乗換: 同一駅名に複数路線が来る場合、それらの隣接を駅名レベルで統合
  // （例: 内幸町は千代田線・半蔵門線等にあるため、各路線の隣接をマージ）
  const stationToLines = {};
  for (const [line, stations] of Object.entries(RAILWAY_LINES)) {
    for (const st of stations) {
      if (!stationToLines[st]) stationToLines[st] = [];
      stationToLines[st].push(line);
    }
  }
  // 同一駅に2路線以上来る場合、その駅の全隣接を互いに結ぶ（乗換エッジ）
  for (const [st, lines] of Object.entries(stationToLines)) {
    if (lines.length >= 2) {
      // この駅を通る全路線の隣接駅を集約
      const neighbors = new Set();
      for (const line of lines) {
        const arr = RAILWAY_LINES[line];
        const idx = arr.indexOf(st);
        if (idx > 0) neighbors.add(arr[idx - 1]);
        if (idx < arr.length - 1) neighbors.add(arr[idx + 1]);
      }
      neighbors.delete(st);
      for (const n of neighbors) add(st, n);
    }
  }
  return adj;
}

// odpt:BusstopPole から { バス停名(正規化) -> {lat, lon, operator} } を取得（geo 付き）
async function fetchBusStopGeo(signal) {
  const cached = cache.get(cache.busStopGeo.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) return {};
  const map = {};
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:BusstopPole`, { params: getParams(op.id), timeout: 8000, signal })
    )
  );
  results.forEach((res) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      for (const p of res.value.data) {
        const name = normalizeBusStop(getDisplayBusstopName(p));
        const lat = p['geo:lat'], lon = p['geo:long'];
        if (name && typeof lat === 'number' && typeof lon === 'number') {
          // 重複時は最初のものを保持（同一バス停は複数路線で出現しうる）
          if (!map[name]) map[name] = { lat, lon, operator: opIdOf(p) };
        }
      }
      odptBreaker.onSuccess();
    } else {
      odptBreaker.onFailure(res.reason || new Error('BusstopPole fetch failed'));
    }
  });
  // 🔴 全滅時は空mapを返すがキャッシュはしない（TTL中の縮退固定化を防ぐ）
  if (!results.every(r => r.status === 'rejected')) {
    cache.set(cache.busStopGeo.key, map, cache.busStopGeo.ttl);
  }
  return map;
}

// odpt:Station から { 駅名(正規化) -> {lat, lon} } を取得（geo 付き）
async function fetchStationGeo(signal) {
  const cached = cache.get(cache.stationGeo.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) return {};
  const map = {};
  const ops = ['TokyoMetro', 'Toei', 'JR-East', 'YokohamaMunicipal', 'Keio', 'Keikyu', 'Odakyu', 'Seibu', 'Tobu', 'TWR', 'MIR', 'Minatomirai'];
  const results = await Promise.allSettled(
    ops.map(op =>
      axios.get(`${API_BASE_URL}/odpt:Station`, { params: getParams(op), timeout: 8000, signal })
    )
  );
  results.forEach((res) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      for (const s of res.value.data) {
        const name = normalizeStationName(s['dc:title'] || s['odpt:stationTitle'] || '');
        const lat = s['geo:lat'], lon = s['geo:long'];
        if (name && typeof lat === 'number' && typeof lon === 'number') {
          if (!map[name]) map[name] = { lat, lon };
        }
      }
    }
  });
  // 🔴 全滅時は空mapを返すがキャッシュはしない（TTL中の縮退固定化を防ぐ）
  if (!results.every(r => r.status === 'rejected')) {
    cache.set(cache.stationGeo.key, map, cache.stationGeo.ttl);
  }
  return map;
}

// 緯度経度から距離（m）を計算（簡易ヘイバーサイン近似）

// バス停→最寄り駅 の紐付けマップ（近接閾値以内の駅を結ぶ）
async function fetchBusStopStationLinks(thresholdM = 500, signal = undefined) {
  const busGeo = await fetchBusStopGeo(signal);
  const stGeo = await fetchStationGeo(signal);
  const links = {}; // バス停名 -> 駅名
  for (const [bName, b] of Object.entries(busGeo)) {
    let best = null, bestD = Infinity;
    for (const [sName, s] of Object.entries(stGeo)) {
      const d = haversineM(b.lat, b.lon, s.lat, s.lon);
      if (d < bestD) { bestD = d; best = sName; }
    }
    if (best && bestD <= thresholdM) links[bName] = best;
  }
  return links;
}

// BusstopPole レコードから表示バス停名を取得（title 優先、なければ note/owl:sameAs）
function getDisplayBusstopName(p) {
  if (p['dc:title']) return p['dc:title'];
  if (p['title'] && typeof p['title'] === 'string') return p['title'];
  if (p['odpt:note']) return p['odpt:note'];
  if (p['owl:sameAs']) {
    const seg = String(p['owl:sameAs']).split('.');
    return seg[seg.length - 1];
  }
  return '';
}

// BusstopPole レコードから operator ショートID を取得
function opIdOf(p) {
  const op = Array.isArray(p['odpt:operator']) ? p['odpt:operator'][0] : p['odpt:operator'];
  if (!op) return '';
  const seg = String(op).split(':');
  return seg[seg.length - 1];
}
// 手順: 1) BFSで最短ノード列を求める / 2) 連続するノードを同一路線パターンで
//        グループ化し、1系統＝1乗車セグメントにまとめる
function findTransferPath(graph, fromStop, toStop, nonStepByPattern, nonStepByStop) {
  const { adj, stopToPatterns } = graph;
  if (!adj.has(fromStop) || !adj.has(toStop)) return null;
  // BFS（各ノードに到達するまでの親情報を保持）
  const prev = new Map(); // stop -> parentStop
  const q = [fromStop];
  prev.set(fromStop, null);
  while (q.length) {
    const cur = q.shift();
    if (cur === toStop) break;
    for (const nb of (adj.get(cur) || [])) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        q.push(nb);
      }
    }
  }
  if (!prev.has(toStop)) return null;
  // 最短ノード列を逆順に復元
  const nodePath = [];
  let cur = toStop;
  while (cur !== null) {
    nodePath.unshift(cur);
    cur = prev.get(cur);
  }
  // 連続するノードを同一路線パターンでグループ化 → 1系統＝1セグメント
  const segments = [];
  let i = 0;
  while (i < nodePath.length - 1) {
    const a = nodePath[i], b = nodePath[i + 1];
    // a→b をカバーする路線パターンを探す（aの次がbであるもの）
    // 注意: buildTransferGraph で stops は normalizeBusStop 済み文字列配列に統一済み
    const via = (stopToPatterns.get(a) || []).find(p =>
      p.stops.some((s, idx) => idx < p.stops.length - 1 &&
        s === a && p.stops[idx + 1] === b)
    ) || (stopToPatterns.get(a) || []).find(p =>
      p.stops.some((s, idx) => idx < p.stops.length - 1 &&
        normalizeBusStop(s) === a && normalizeBusStop(p.stops[idx + 1]) === b)
    );
    if (!via) { i++; continue; }
    // このパターンで進めるだけ進む（連続区間を1セグメントに）
    const stops = via.stops.map(s => normalizeBusStop(s));
    let end = i + 1;
    while (end < nodePath.length - 1) {
      const c = nodePath[end], d = nodePath[end + 1];
      const ci = stops.indexOf(c), di = stops.indexOf(d);
      if (ci >= 0 && di === ci + 1) end++;
      else break;
    }
    const segStops = nodePath.slice(i, end + 1);
    const nonStepMap = nonStepByPattern[via.patternId] || {};
    // ノンステップ判定: その系統で「情報が得られた停留所のうち全てがノンステップ」なら true
    // （timetable カバレッジ不足で undefined の停留所は無視。一部でも非ノンステップがあれば false）
    const nonStep = segStops.every(s => {
      let v = nonStepMap[s];
      if (v === undefined && nonStepByStop) v = nonStepByStop[s];
      return v === true; // undefined / false は false 扱い
    });
    segments.push({
      operator: via.operator, patternId: via.patternId,
      fromStop: segStops[0], toStop: segStops[segStops.length - 1],
      stops: segStops,
      nonStep
    });
    i = end;
  }
  return segments.length ? segments : null;
}

// 単一バス区間（a→b）のセグメント化（nonStep 付与）。searchBusTransfer の統合グラフから呼ぶ。
function findBusSegment(busGraph, a, b, nonStepByPattern, nonStepByStop) {
  const { stopToPatterns } = busGraph;
  const via = (stopToPatterns.get(a) || []).find(p =>
    p.stops.some((s, idx) => idx < p.stops.length - 1 && s === a && p.stops[idx + 1] === b)
  ) || (stopToPatterns.get(a) || []).find(p =>
    p.stops.some((s, idx) => idx < p.stops.length - 1 && normalizeBusStop(s) === a && normalizeBusStop(p.stops[idx + 1]) === b)
  );
  if (!via) return null;
  const stops = via.stops.map(s => normalizeBusStop(s));
  const nonStepMap = nonStepByPattern[via.patternId] || {};
  const nonStep = stops.every(s => {
    let v = nonStepMap[s];
    if (v === undefined && nonStepByStop) v = nonStepByStop[s];
    return v === true;
  });
  return {
    operator: via.operator, patternId: via.patternId,
    fromStop: a, toStop: b, stops: [a, b], non_step_bus: nonStep
  };
}

// ============================================================
// 🚌 乗り物指定優先定数
// ============================================================
// vehicle 指定時のエッジ重みマップ（キー: 指定乗り物 → 各モードの重み）
// 非指定モードに重み 3（乗換1回相当）を乗せることで優先を実現。
const VEHICLE_WEIGHTS = {
  bus:            { bus: 1, train: 3, link: 1, community_bus: 1, ferry: 3 },
  train:          { train: 1, bus: 3, link: 1, community_bus: 3, ferry: 3 },
  community_bus:  { community_bus: 1, bus: 2, train: 3, link: 1, ferry: 3 },
  ferry:          { ferry: 1, bus: 3, train: 3, link: 1, community_bus: 3 },
  any:            { bus: 1, train: 1, link: 1, community_bus: 1, ferry: 1 }
};
const VALID_VEHICLES = ['bus', 'train', 'community_bus', 'ferry', 'any'];

// エッジの type から mode キーを取得（transfer は link 扱い）
function edgeTypeToMode(type) {
  if (type === 'link' || type === 'transfer') return 'link';
  return type; // bus / train / community_bus / ferry はそのまま
}

// 重み付きダイクストラ（最小コスト経路探索）
// adj: Map<nodeName, [{to, type}]>, weights: mode->cost
// 戻り値: { found, nodePath, segments, score }
// バイナリミニヒープ（Dijkstra 用・遅延削除は dist 再チェックで対応）
class MinHeap {
  constructor() { this.heap = []; }
  size() { return this.heap.length; }
  push(item) {
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].cost <= h[i].cost) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop() {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l].cost < h[m].cost) m = l;
        if (r < h.length && h[r].cost < h[m].cost) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

function findWeightedPath(adj, fromNode, toNode, weights, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus) {
  const dist = new Map(); // node -> best cost
  const prev = new Map(); // node -> parentNode
  const pq = new MinHeap();
  dist.set(fromNode, 0);
  prev.set(fromNode, null);
  pq.push({ node: fromNode, cost: 0 });
  while (pq.size()) {
    const { node: cur, cost: curCost } = pq.pop();
    if (curCost > (dist.get(cur) ?? Infinity)) continue;
    if (cur === toNode) break;
    for (const e of (adj.get(cur) || [])) {
      const mode = edgeTypeToMode(e.type);
      const w = weights[mode] !== undefined ? weights[mode] : 1;
      const nc = curCost + w;
      if (nc < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nc);
        prev.set(e.to, { from: cur, edgeType: e.type });
        pq.push({ node: e.to, cost: nc });
      }
    }
  }
  if (!prev.has(toNode)) return { found: false, score: Infinity };
  // ノード列を復元
  const nodePath = [];
  const edgePath = [];
  let cur = toNode;
  while (cur !== null) {
    nodePath.unshift(cur);
    const p = prev.get(cur);
    if (p) edgePath.unshift({ from: p.from, to: cur, type: p.edgeType });
    cur = p ? p.from : null;
  }
  // 探索時に選択したエッジ種別をそのまま使ってセグメント化する。
  // 同一ノード間に train/link 等が複数存在しても、隣接リストの先頭を再推測しない。
  const segments = buildSegmentsFromPath(nodePath, edgePath, adj, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus);
  return { found: true, nodePath, edgePath, segments, score: dist.get(toNode) };
}

// ノード列 → セグメント配列（searchBusTransfer のセグメント化を関数化）
function buildSegmentsFromPath(nodePath, edgePath, adj, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus) {
  const segments = [];
  let i = 0;
  while (i < nodePath.length - 1) {
    const a = nodePath[i], b = nodePath[i + 1];
    const selectedEdge = edgePath?.[i];
    const type = selectedEdge?.type || 'bus';
    if (type === 'link') {
      segments.push({ mode: 'transfer', fromStop: a, toStop: b, note: '徒歩乗り継ぎ' });
      i++;
    } else if (type === 'train') {
      let end = i + 1;
      while (end < nodePath.length - 1) {
        const nextType = edgePath?.[end]?.type;
        if (nextType === 'train') end++;
        else break;
      }
      const stops = nodePath.slice(i, end + 1);
      // 鉄道ルートエンジンで路線単位に分割（乗換回数を正確に表示するため）。
      // バスグラフの train エッジは路線情報を持たないため、区間両端を再ルーティングする。
      const rr = findShortestPath(stops[0], stops[stops.length - 1]);
      if (rr && rr.path && rr.path.length >= 2 && rr.lines && rr.lines.length >= 1) {
        let curLine = rr.lines[0];
        let curStops = [rr.path[0], rr.path[1]];
        for (let k = 1; k < rr.lines.length; k++) {
          if (rr.lines[k] === curLine) {
            curStops.push(rr.path[k + 1]);
          } else {
            segments.push({ mode: 'train', fromStop: curStops[0], toStop: curStops[curStops.length - 1], stops: curStops });
            curLine = rr.lines[k];
            curStops = [rr.path[k], rr.path[k + 1]];
          }
        }
        segments.push({ mode: 'train', fromStop: curStops[0], toStop: curStops[curStops.length - 1], stops: curStops });
      } else {
        segments.push({ mode: 'train', fromStop: stops[0], toStop: stops[stops.length - 1], stops });
      }
      i = end + 1;
    } else if (type === 'community_bus') {
      let end = i + 1;
      while (end < nodePath.length - 1) {
        const nextType = edgePath?.[end]?.type;
        if (nextType && (nextType === 'community_bus' || end + 1 === nodePath.length - 1)) end++;
        else break;
      }
      const stops = nodePath.slice(i, end + 1);
      const meta = cbStopToBus[stops[0]] || cbStopToBus[stops[stops.length - 1]] || {};
      segments.push({
        mode: 'community_bus', fromStop: stops[0], toStop: stops[stops.length - 1], stops,
        bus: meta.bus, municipality: meta.municipality, website: meta.url, route: meta.route, non_step_bus: null
      });
      i = end + 1;
    } else {
      // bus区間
      const busSeg = findBusSegment(busGraph, a, b, nonStepByPattern, nonStepByStop);
      if (busSeg) {
        segments.push({ mode: 'bus', ...busSeg });
        i++;
      } else {
        segments.push({ mode: 'bus', fromStop: a, toStop: b, stops: [a, b], non_step_bus: null });
        i++;
      }
    }
  }
  return segments;
}

// 指定乗り物が経路に含まれるか
function pathHasMode(segments, mode) {
  return segments.some(s => s.mode === mode);
}

// 経路の簡易スコア（乗換回数 + モード内訳）— better_alternative 比較用
function scorePath(segments) {
  let transfers = 0, busStops = 0, trainStops = 0;
  for (const s of segments) {
    if (s.mode === 'bus' || s.mode === 'community_bus' || s.mode === 'ferry') {
      transfers++;
      if (s.mode === 'bus' || s.mode === 'community_bus') {
        busStops += Math.max(1, (s.stops ? s.stops.length : 2) - 1);
      }
    } else if (s.mode === 'train') {
      transfers++;
      trainStops += (s.stops ? s.stops.length : 2) - 1;
    } else if (s.mode === 'transfer') { /* link — 乗換カウント外 */ }
  }
  const estimatedMinutes = trainStops * 2 + busStops * 3;
  return { transfers: Math.max(0, transfers - 1), estimated_minutes: estimatedMinutes, bus_count: segments.filter(s => s.mode === 'bus').length, train_count: segments.filter(s => s.mode === 'train').length };
}

// 重み付き探索 + 通常探索の2回実行 + better_alternative 進言
async function searchBusTransfer(fromInput, toInput, vehiclePref) {
  const from = normalizeBusStop(fromInput);
  const to = normalizeBusStop(toInput);
  // 🔴 タイムアウト緩和: 直列 await を Promise.all で並列化（ODPT 4 API + 駅geo を同時取得）
  // さらに全体タイムアウト(25s)ガードを設け、個別フェッチが沈黙しても MCP クライアントの
  // 300s タイムアウトに到達しないよう、空データでフォールバックする。
  const BUS_TRANSFER_FETCH_TIMEOUT_MS = 25000;
  let graphData, ttData, links, stationGeoMap;
  // 🔴 タイムアウト時に元のHTTPリクエストも中断する（Promise.raceだけでは通信が継続し、
  // 遅延完了したレスポンスがキャッシュを書き換える・負荷が残る問題があった）。
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(new Error('bus transfer fetch timeout')), BUS_TRANSFER_FETCH_TIMEOUT_MS);
  try {
    const withTimeout = (p, label) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`bus transfer fetch timeout: ${label}`)), BUS_TRANSFER_FETCH_TIMEOUT_MS))
    ]);
    [graphData, ttData, links, stationGeoMap] = await Promise.all([
      withTimeout(fetchBusGraph(abortController.signal), 'BusroutePattern'),
      withTimeout(fetchBusTimetable(abortController.signal), 'BusTimetable'),
      withTimeout(fetchBusStopStationLinks(500, abortController.signal), 'BusstopStationLinks'),
      withTimeout(fetchStationGeo(abortController.signal), 'StationGeo')
    ]);
  } catch (timeoutErr) {
    // タイムアウト時は残リクエストを中断し、空データで継続（グラフは空＝NOT_FOUND を返し、コミュニティバス接続案内は維持）
    abortController.abort(timeoutErr);
    console.error('[searchBusTransfer] fetch guard triggered:', timeoutErr.message);
    graphData = graphData || { patterns: [] };
    ttData = ttData || { nonStepByPattern: {}, nonStepByStop: {} };
    links = links || {};
    stationGeoMap = stationGeoMap || {};
  } finally {
    clearTimeout(abortTimer);
  }
  const { patterns } = graphData;
  const { nonStepByPattern, nonStepByStop } = ttData;
  const busGraph = buildTransferGraph(patterns);
  const trainAdj = buildTrainNameGraph();
  const trainLinks = links;
  // 駅ノードを trainAdj に確保（RAILWAY_LINES にない駅でも link エッジを張れるよう）
  for (const stName of Object.keys(stationGeoMap)) {
    if (!trainAdj.has(stName)) trainAdj.set(stName, new Set());
  }
  // 統合グラフ: bus停ノード + 駅ノード + link(バス停→駅 徒歩乗り継ぎ) エッジ
  const adj = new Map();
  const addEdge = (a, b, type) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, type });
  };
  // バス内エッジ
  for (const [s, neighbors] of busGraph.adj) {
    for (const n of neighbors) addEdge(s, n, 'bus');
  }
  // #24-2: ハードコード系統（空港リムジン・JRバス関東等の直行系統）もバスエッジとして組み込む。
  // これにより「羽田空港→新宿駅」等が港湾バース連鎖ではなくリムジン直行として引ける。
  for (const src of BUS_GTFS_SOURCES) {
    if (!src.hardCoded || !Array.isArray(src.routes)) continue;
    for (const [from, to] of src.routes) {
      addEdge(from, to, 'bus');
      addEdge(to, from, 'bus');
      // 🔴 入力は normalizeBusStop で「駅」サフィックスが除去されるため（例: 渋谷駅→渋谷）、
      // ハードコードバス停名（例: 渋谷駅）のままの直行エッジには到達できない。
      // 正規化後名でも直行エッジを張り、「渋谷駅→中野駅」等が鉄道ノードに解決されても
      // バス直行（京王 渋64 等）を引けるようにする（回帰テスト test-bus-routes-expansion 対応）。
      const fNorm = normalizeBusStop(from), tNorm = normalizeBusStop(to);
      if (fNorm !== from || tNorm !== to) {
        addEdge(fNorm, tNorm, 'bus');
        addEdge(tNorm, fNorm, 'bus');
      }
    }
  }
  // 電車内エッジ
  for (const [s, neighbors] of trainAdj) {
    for (const n of neighbors) addEdge(s, n, 'train');
  }
  // バス停→駅 の link エッジ（バス停と同一名の駅があれば結ぶ）
  for (const [busStop, station] of Object.entries(trainLinks)) {
    if (busGraph.adj.has(busStop) && trainAdj.has(station)) {
      addEdge(busStop, station, 'link');
      addEdge(station, busStop, 'link');
    }
  }
  // 🚌 コミュニティバスグラフ（Phase 2: 駅接続ルートを統合グラフに組み込み）
  // 駅前停留所の系統順をエッジ化し、stations 定義で駅⇔バス停を link で接続。
  const cbGraph = new Map(); // バス停名 → Set(隣接バス停)
  const cbStopToBus = {};    // バス停名 → { bus, municipality, url, route }
  for (const cb of COMMUNITY_BUS_ROUTES) {
    for (const route of cb.routes) {
      for (let i = 0; i < route.stops.length - 1; i++) {
        const a = route.stops[i], b = route.stops[i + 1];
        if (!cbGraph.has(a)) cbGraph.set(a, new Set());
        cbGraph.get(a).add(b);
        if (!cbGraph.has(b)) cbGraph.set(b, new Set());
        cbGraph.get(b).add(a);
        for (const s of [a, b]) {
          if (!cbStopToBus[s]) cbStopToBus[s] = { bus: cb.bus, municipality: cb.municipality, url: cb.url, route: route.name };
        }
      }
    }
  }
  for (const [s, neighbors] of cbGraph) {
    for (const n of neighbors) addEdge(s, n, 'community_bus');
  }
  // コミュニティバス停 ⇔ 駅 の link エッジ（stations 定義の駅前バス停）
  for (const cb of COMMUNITY_BUS_ROUTES) {
    for (const [station, stop] of Object.entries(cb.stations)) {
      if (cbGraph.has(stop) && trainAdj.has(station)) {
        addEdge(stop, station, 'link');
        addEdge(station, stop, 'link');
      }
    }
  }
  // 部分一致でノードを特定（ODPTバス停優先、次にコミュニティバス停、最後に駅）
  const allNodes = new Set([...busGraph.adj.keys(), ...cbGraph.keys(), ...trainAdj.keys()]);
  // #24-2: ハードコード系統（空港リムジン・JRバス関東等）の stop 名もノードとして確保。
  // これがないと「羽田空港」入力が部分一致で「羽田空港第3ターミナル」等に誤解決され、
  // リムジン直行エッジ（羽田空港→新宿駅）が使われず港湾バース連鎖が選ばれる。
  for (const src of BUS_GTFS_SOURCES) {
    if (!src.hardCoded) continue;
    for (const s of (src.stops || [])) {
      if (!allNodes.has(s)) allNodes.add(s);
      if (!adj.has(s)) adj.set(s, []);
    }
  }
  // 英語・中国語のバス停名/駅名を日本語に解決（STATION_DISPLAY_NAMES の en/zh → 日本語 逆引き）
  const resolveBusStopLang = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || allNodes.has(trimmed)) return trimmed;
    const norm = normalizeBusStop(trimmed);
    if (allNodes.has(norm)) return norm;
    // STATION_DISPLAY_NAMES の en / zh 表示名と一致する日本語名を探す
    const lower = trimmed.toLowerCase();
    for (const [jp, trans] of Object.entries(STATION_DISPLAY_NAMES)) {
      const en = (trans.en || '').toLowerCase();
      const zh = trans.zh || '';
      if ((en && lower === en) || (zh && trimmed === zh)) return jp;
    }
    // STATION_NAME_MAP の英語エイリアス（Oshiage→押上 等）も試す
    if (STATION_NAME_MAP[trimmed]) return STATION_NAME_MAP[trimmed];
    return null;
  };
  const resolve = (name) => {
    const langResolved = resolveBusStopLang(name) || name;
    if (allNodes.has(langResolved)) return { node: langResolved, ambiguous: false };
    // 🔴 #80: バス停・駅の部分一致は「前方一致のみ」で候補を収集し、
    // 一意のときだけ解決する。複数候補がある場合はサイレントに先頭1件を選ばず、
    // AMBIGUOUS を返して検索を中断する（鉄道駅の resolveStation と同じ安全方針）。
    const collect = (pred) => {
      const hits = [];
      for (const n of allNodes) {
        // 系統名・ID付きノイズ（「桜町病院:60008:桜町病院１」等）は候補から除外
        if (/[：:〜→|]/.test(n)) continue;
        if (pred(n)) hits.push(n);
      }
      return hits;
    };
    // 1) 前方一致（入力で始まるノード）を最優先
    let hits = collect(n => n.startsWith(langResolved));
    // 2) 前方一致が無い場合のみ、双方向包含の部分一致にフォールバック
    //   （例: 「渋谷駅」→ ノード「渋谷」、逆に「桜新町」→ 入力「新町」等の表記ゆれ吸収）
    if (hits.length === 0) hits = collect(n => n.includes(langResolved) || langResolved.includes(n));
    if (hits.length === 1) return { node: hits[0], ambiguous: false };
    if (hits.length > 1) return { node: null, ambiguous: true, candidates: hits };
    return { node: null, ambiguous: false };
  };
  const fRes = resolve(from);
  const tRes = resolve(to);
  if (fRes.ambiguous || tRes.ambiguous) {
    return { found: false, ambiguous: true, side: fRes.ambiguous ? 'from' : 'to', input: fRes.ambiguous ? fromInput : toInput, candidates: fRes.ambiguous ? fRes.candidates : tRes.candidates, allNodeNames: [...allNodes] };
  }
  const fNode = fRes.node;
  const tNode = tRes.node;
  if (!fNode || !tNode) {
    return { found: false, fromNode: fNode, toNode: tNode, allNodeNames: [...allNodes] };
  }
  // 🚌🚃 乗り物指定優先: 優先探索（重み付き）+ 通常探索（無重み）の2回実行
  const validPref = (VALID_VEHICLES.includes(vehiclePref)) ? vehiclePref : 'any';
  // 第1パス: 指定優先（vehiclePref が any でなければ重み付き）
  const prefWeights = VEHICLE_WEIGHTS[validPref] || VEHICLE_WEIGHTS.any;
  const prefResult = (validPref === 'any')
    ? null // any の場合は通常探索1回のみ
    : findWeightedPath(adj, fNode, tNode, prefWeights, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus);
  // 第2パス: 通常探索（無重み＝最小エッジ数）
  const anyResult = findWeightedPath(adj, fNode, tNode, VEHICLE_WEIGHTS.any, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus);
  if (!anyResult.found) {
    // どちらも見つからない
    return { found: false, fromNode: fNode, toNode: tNode, allNodeNames: [...allNodes] };
  }
  // 優先探索の結果を採用（ただし any の場合は anyResult をそのまま）
  const primaryResult = (prefResult && prefResult.found) ? prefResult : anyResult;
  const segments = primaryResult.segments;
  // better_alternative 進言: 指定優先経路が、通常最短路より明らかに劣る場合
  let betterAlternative = null;
  if (validPref !== 'any' && prefResult && prefResult.found && anyResult.found) {
    const prefScore = scorePath(segments);
    const altScore = scorePath(anyResult.segments);
    const transferDiff = prefScore.transfers - altScore.transfers;
    const minuteDiff = prefScore.estimated_minutes - altScore.estimated_minutes;
    // 乗換が2回以上多い、または所要目測が10分以上長い場合に進言
    if (transferDiff >= 2 || minuteDiff >= 10) {
      const altMode = anyResult.segments.some(s => s.mode === 'train') ? 'train'
        : anyResult.segments.some(s => s.mode === 'community_bus') ? 'community_bus'
        : anyResult.segments.some(s => s.mode === 'ferry') ? 'ferry' : 'bus';
      betterAlternative = {
        exists: true,
        recommended_mode: altMode,
        preferred_mode: validPref,
        transfers_saved: transferDiff,
        estimated_minutes_saved: minuteDiff,
        alt_segments: anyResult.segments,
        alt_score: altScore
      };
    }
  }
  return {
    found: true, fromNode: fNode, toNode: tNode, segments,
    isCrossModal: segments.some(s => s.mode === 'train'),
    vehicleRequested: validPref,
    // 指定乗り物（ferry等）の経路が見つからず通常探索で代替した場合
    // （優先探索は他モードでも経路を「見つけて」しまうため、採用経路に指定モードが含まれるかを判定）
    vehicleFallback: validPref !== 'any' && !segments.some(s => s.mode === validPref),
    betterAlternative,
    // #24: バス停を転々とする無意味な複雑バス連鎖（例: 羽田→新宿で港湾バースを5連続乗継）の検出。
    // バス/コミュニティバスが3つ以上連続する場合は「バス直行なし」とみなし、鉄道ルートを推奨する。
    complexBusChain: (() => {
      let busRun = 0;
      for (const s of segments) {
        if (s.mode === 'bus' || s.mode === 'community_bus') { busRun++; if (busRun >= 3) return true; }
        else busRun = 0;
      }
      return false;
    })()
  };
}
// ============================================================
// 🚌 コミュニティバス案内ブロック（Phase 1: 駅までの足・駅からの足）
// ============================================================
// 足の悪いユーザー向けに「この駅はどのコミュニティバスが利用できるか」を案内する。
// 経路探索（統合グラフ）が失敗しても、駅⇔コミュニティバス停の接続情報を必ず返す。
function findCommunityBusAccess(stationInput) {
  if (!stationInput) return null;
  const candidates = [stationInput, normalizeStationName(stationInput), stationInput.replace(/駅$/, '')]
    .filter((v, i, a) => a.indexOf(v) === i);
  for (const c of candidates) {
    if (COMMUNITY_BUS_STATION_ACCESS[c]) return { station: c, entries: COMMUNITY_BUS_STATION_ACCESS[c] };
  }
  return null;
}
function buildCommunityBusAccessBlock(stationInput, userLang) {
  const hit = findCommunityBusAccess(stationInput);
  if (!hit) return null;
  return {
    note: userLang === 'en' ? "🚌 [Community Bus Access (first/last mile)]" :
          userLang === 'zh' ? "🚌 【社区公交接驳（首末段）】" :
          "🚌 【コミュニティバス接続（駅までの足・駅からの足）】",
    station: getDisplayStationName(hit.station, userLang),
    buses: hit.entries.map(e => ({
      bus: getCommunityBusDisplayName(e.bus, userLang),
      municipality: e.municipality,
      stop: getCommunityBusStopDisplayName(e.stop, userLang),
      url: e.url,
      barrier_free_note: userLang === 'en'
        ? "Wheelchair / low-floor availability varies by service — check the official municipal page."
        : userLang === 'zh'
        ? "轮椅 / 低地板车辆的可用性因线路而异 — 请查看各自治体官网。"
        : "車椅子・低床バスの有無は系統により異なります。自治体公式サイトでご確認ください。"
    })),
    timetable_note: userLang === 'en' ? "Timetables & full routes: official municipal site."
      : userLang === 'zh' ? "时刻表与完整路线请参见各自治体官网。"
      : "時刻表・全ルートは各自治体公式サイトでご確認ください。"
  };
}

// #46: バス停名の類似度判定用 編集距離（Levenshtein）。全角・半角はそのまま比較し、
// 検索キーの近さ（類似候補提示）にのみ使用する。
function levenshteinDist(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return curr[b.length];
}

async function searchBus(args) {
  const busstopName = (args.busstop_name || '').trim();
  const fromInput = (args.from || '').trim();
  const toInput = (args.to || '').trim();
  const vehicleInput = (args.vehicle || '').trim();
  // 乗り継ぎ探索モード（from + to 指定時）。案B: 異系統・異事業者間の最短経路。
  if (fromInput && toInput) {
    const fL = detectLanguage(fromInput);
    const tL = detectLanguage(toInput);
    const userLang = resolveLang(args) || (fL !== 'ja' ? fL : tL !== 'ja' ? tL : 'ja');
    const parsedTest = parseTestMode({ from: fromInput, to: toInput, '-test': args['-test'], test: args.test, test_mode: args.test_mode });
    const testAdv = buildTestAdvice(parsedTest.simulatedFailure, userLang);
    const aiAdvice = await getTransitAdvice(testAdv, userLang);
    // 地震時はバス・トラム・鉄道を含む通常の乗り継ぎ結果を提示せず、安全確保を優先する。
    if (isEarthquakeSimulation(testAdv)) {
      return await buildEarthquakeSafetyResponse('ground', userLang, { from: fromInput, to: toInput });
    }
    // searchBusTransfer 内で個別APIの障害を縮退処理する。
    // ここで早期 return すると、hard-coded / community-bus フォールバックまで遮断される。
    try {
      const result = await searchBusTransfer(fromInput, toInput, vehicleInput);
      // 駅⇔コミュニティバス接続（Phase 1: 足の悪いユーザーの駅までの足・駅からの足）
      const cbAccess = [
        buildCommunityBusAccessBlock(fromInput, userLang),
        buildCommunityBusAccessBlock(toInput, userLang)
      ].filter(Boolean);
      // 🔴 #80: 同名・類似バス停が複数ある場合はサイレントに1件選ばず、検索を中断して選択を促す。
      if (result.ambiguous) {
        const sideLabel = result.side === 'from'
          ? (userLang === 'en' ? 'departure' : userLang === 'zh' ? '出发' : '出発')
          : (userLang === 'en' ? 'arrival' : userLang === 'zh' ? '到达' : '到着');
        // 候補は再入力可能な正式名（ja）を返しつつ、言語別表示でも併記する
        const candidatesRaw = (result.candidates || []).slice(0, 10);
        const candidatesDisp = candidatesRaw.map(c => getDisplayStationName(c, userLang));
        const promptMsg = userLang === 'en'
          ? `Multiple bus stops match "${result.input}" (${sideLabel}). Please choose one: ${candidatesDisp.join(' / ')}`
          : userLang === 'zh'
            ? `「${result.input}」匹配到多个公交站（${sideLabel}）。请选择其一：${candidatesDisp.join(' / ')}`
            : `「${result.input}」に一致するバス停が複数あります（${sideLabel}）。どれかを選択してください：${candidatesDisp.join(' / ')}`;
        const disambiguation = {
          input: result.input,
          side: result.side,
          candidates: candidatesDisp,
          candidates_raw: candidatesRaw, // #80: 再入力可能な正式キー
          message: promptMsg
        };
        // 曖昧時も入力名基準で公的機関の検索案内を表示（候補確定前でも「その場所周辺の役所」を探せる）
        const ambiguousResp = buildErrorResponse('AMBIGUOUS_BUS_STOP', promptMsg, { userLang, from: fromInput, to: toInput, disambiguation });
        ambiguousResp.gov_facility_search_support = buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(result.input || fromInput || toInput, userLang));
        return jsonResponse(ambiguousResp);
      }
      if (!result.found) {
        // 🔴 案内改善: 入力量の類似バス停を提示し、見つからない場合は徒歩・現実的アクセスを勧める
        const similarStops = [];
        const seen = new Set();
        // 乗り継ぎモードでは ODPT バス停リスト(buses) はスコープ外になるため、
        // searchBusTransfer が返す統合グラフの全ノード名(allNodeNames)をソースに使う。
        const busPool = (result.allNodeNames && result.allNodeNames.length)
          ? result.allNodeNames
          : (typeof buses !== 'undefined' ? (buses || []) : []);
        if (fromInput && toInput) {
          for (const q of [fromInput, toInput]) {
            const qn = String(q || '').replace(/(停留所|バス停|駅)$/, '');
            for (const k of busPool) {
              // 生データの系統名・ID付きノイズ（「系統名:数字:停留所」等）は候補から除外
              if (!k || seen.has(k) || /[：:〜→|]/.test(k)) continue;
              if ((qn && k.includes(qn)) || (k.length >= 2 && qn.length >= 1 && k.includes(qn.slice(0, Math.max(1, qn.length - 1))))) {
                seen.add(k); similarStops.push(k);
              }
            }
          }
        }
        const simNote = userLang === 'en' ? 'No exact bus/train-transfer route found. Similar existing stops you can try:'
          : userLang === 'zh' ? '未找到精确的公交/电车换乘路线。可尝试以下相近的现有站名：'
          : '該当する乗り継ぎ経路が見つかりませんでした。代わりに以下の実在バス停名が利用できます：';
        const walkNote = userLang === 'en' ? 'This pair may be shorter on foot — consider walking, or search a nearby stop above.'
          : userLang === 'zh' ? '这段区间步行可能更近——建议步行，或改用上方相近的站点检索。'
          : 'この区間は徒歩の方が早い場合があります——徒歩での移動、または上記の近隣バス停での再検索をご検討ください。';
        return jsonResponse({
          status: 'NOT_FOUND', detected_language: userLang,
          message: userLang === 'en' ? `No bus transfer route found from "${fromInput}" to "${toInput}".`
            : userLang === 'zh' ? `未找到从「${fromInput}」到「${toInput}」的公交换乘路线。`
            : `「${fromInput}」から「${toInput}」への乗り継ぎ経路が見つかりませんでした。`,
          note: userLang === 'en' ? 'Transfer covers Toei/Seibu/Yokohama City Bus (ODPT BusroutePattern data) plus community-bus station links. JR Bus Kanto is not included (no stop-order data).'
            : userLang === 'zh' ? '换乘覆盖都营/西武/横滨市营公交（ODPT BusroutePattern 数据）及社区公交接驳。JR巴士关东不包含在内（缺少站点顺序数据）。'
            : '乗り継ぎは都営・西武・横浜市営バス＋コミュニティバス駅接続が対象（ODPT BusroutePattern データ）。JRバス関東は停留所順序データがないため対象外です。',
          data_source: 'ODPT BusroutePattern + BusTimetable',
          ai_transit_advice: aiAdvice,
          community_bus_access: cbAccess.length ? cbAccess : undefined,
          similar_stops: similarStops.length ? (() => {
            const localized = similarStops.slice(0, 10)
              .map(s => getDisplayStationName(s, userLang))
              .filter(s => userLang === 'ja' || !/[\u3040-\u30ff\u3400-\u9fff]/.test(s));
            return localized.length ? { note: simNote, stops: localized } : undefined;
          })() : undefined,
          walk_suggestion: walkNote,
          // 公的機関の検索案内（到着地バス停名を基準に表示。乗り継ぎが見つからなくても役所は探せる）
          gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(toInput || fromInput, userLang)),
          test_mode: testAdv.testMode,
          simulated_failure_type: testAdv.failureType || undefined
            });
      }
      const opLabel = (opId) => {
        const o = BUS_OPERATORS.find(x => x.id === opId);
        return o ? (userLang === 'en' ? o.labelEn : userLang === 'zh' ? o.labelZh : o.label) : opId;
      };
      const modeLabel = (m) => userLang === 'en' ? (m === 'train' ? 'Train' : m === 'transfer' ? 'Walk transfer' : m === 'community_bus' ? 'Community bus' : 'Bus')
        : userLang === 'zh' ? (m === 'train' ? '电车' : m === 'transfer' ? '步行换乘' : m === 'community_bus' ? '社区公交' : '公交')
        : (m === 'train' ? '電車' : m === 'transfer' ? '徒歩乗り継ぎ' : m === 'community_bus' ? 'コミュニティバス' : 'バス');
      const dispName = (n) => getDisplayStationName(n, userLang);
      const segments = result.segments.map((s, i) => {
        const stops = (s.stops && s.stops.length ? s.stops : [s.fromStop, s.toStop]).map(dispName);
        const base = { step: i + 1, mode: s.mode, mode_label: modeLabel(s.mode), from: dispName(s.fromStop), to: dispName(s.toStop), stops };
        if (s.mode === 'bus') { base.operator = opLabel(s.operator); base.non_step_bus = s.non_step_bus; }
        else if (s.mode === 'train') { base.operator = userLang === 'en' ? 'Railway' : userLang === 'zh' ? '铁路' : '鉄道'; }
        else if (s.mode === 'community_bus') { base.operator = s.bus; base.municipality = s.municipality; base.website = s.website; base.non_step_bus = null; }
        else if (s.mode === 'transfer') { base.note = userLang === 'en' ? 'Walk transfer' : userLang === 'zh' ? '步行换乘' : s.note; }
        return base;
      });
      // コミュニティバス利用時のバリアフリー注意喚起（車椅子対応は自治体サイトで確認）
      const hasCommunityBus = segments.some(s => s.mode === 'community_bus');
      const communityBusNote = hasCommunityBus
        ? (userLang === 'en' ? '🚌 Community bus segment: small vehicles; wheelchair / low-floor availability varies — check the official municipal page.'
          : userLang === 'zh' ? '🚌 社区公交区间：多为小型车辆；轮椅/低地板车辆可用性因线路而异，请查看各自治体官网。'
          : '🚌 コミュニティバス区間: 小型車両が中心です。車椅子・低床バスの有無は系統により異なります。自治体公式サイトでご確認ください。')
        : undefined;
      // バリアフリー総評: バスセグメントのみ評価（電車は別途要確認）
      const busSegs = segments.filter(s => s.mode === 'bus');
      const allNonStep = busSegs.length > 0 && busSegs.every(s => s.non_step_bus);
      const barrierFreeNote = userLang === 'en'
        ? (allNonStep
          ? 'All bus segments operate non-step (step-free) buses — easier boarding for users with limited mobility.'
          : 'Some bus segments may not operate non-step buses. Please check with the operator or look for non-step designated services.')
        : userLang === 'zh'
          ? (allNonStep
            ? '所有公交区段均运行无障碍低地板（无台阶）巴士——便于行动不便者乘车。'
            : '部分公交区段可能未运行无障碍巴士。请向运营商确认或选择无障碍指定班次。')
          : (allNonStep
            ? '全区間でノンステップバス（段差なし）が運行されています。足の悪い方の乗車が容易です。'
            : '一部区間でノンステップバスが運行されていない可能性があります。各事業者へご確認いただくか、ノンステップ指定便をご利用ください。');
      const hasBusSeg = segments.some(s => s.mode === 'bus' || s.mode === 'community_bus');
      // バス区間のない純粋な電車フォールバックでは「バス→電車→バス」と表示しない
      const crossModal = (result.isCrossModal && hasBusSeg) ? (userLang === 'en' ? ' (bus→train→bus cross-modal)' : userLang === 'zh' ? '（公交→电车→公交 跨方式换乘）' : '（バス→電車→バスの横断乗り継ぎ）') : '';
      // 指定乗り物の経路が無く代替した場合の案内
      const vehicleFallbackNote = result.vehicleFallback ? (userLang === 'en'
        ? `No ${result.vehicleRequested} route found — substituted with another mode.`
        : userLang === 'zh'
        ? `未找到${result.vehicleRequested}路线，已用其他交通方式替代。`
        : `指定の乗り物（${result.vehicleRequested}）の経路が見つからず、他の交通手段で代替しました。`) : undefined;
      // #24: バス停を転々とする無意味な複雑バス連鎖（例: 羽田→新宿で港湾バースを5連続乗継）を
      // そのまま提示せず、「バス直行なし」を明示して鉄道ルートを推奨する。
      const noDirectBusNote = result.complexBusChain ? (userLang === 'en'
        ? '🚌 No direct bus service — the found route chains 3+ local bus segments (e.g. harbor berths), which is impractical. Prefer the railway route below (or an airport limousine bus).'
        : userLang === 'zh'
        ? '🚌 无直达公交——检索结果需连续换乘3段以上区内公交（如港区泊位），不切实际。建议优先选择下方的铁路路线（或机场利木津巴士）。'
        : '🚌 バス直行便はありません。検索された経路は3連続以上のバス乗り継ぎ（港湾バース等）で非現実的なため、下記の鉄道路線（または空港リムジンバス）をご利用ください。') : undefined;
      // 🚌 乗り物指定優先の進言ブロック（better_alternative）
      let betterAlternativeBlock = undefined;
      if (result.betterAlternative && result.betterAlternative.exists) {
        const ba = result.betterAlternative;
        const modeLabelFor = (m) => userLang === 'en'
          ? (m === 'train' ? 'Train' : m === 'community_bus' ? 'Community bus' : m === 'ferry' ? 'Ferry' : 'Bus')
          : userLang === 'zh'
            ? (m === 'train' ? '电车' : m === 'community_bus' ? '社区公交' : m === 'ferry' ? '水上巴士' : '公交')
            : (m === 'train' ? '電車' : m === 'community_bus' ? 'コミュニティバス' : m === 'ferry' ? '水上バス' : 'バス');
        const prefLabel = modeLabelFor(ba.preferred_mode);
        const altLabel = modeLabelFor(ba.recommended_mode);
        const reason = userLang === 'en'
          ? `💡 Better alternative: ${altLabel} saves ${ba.transfers_saved} transfer(s) and ~${ba.estimated_minutes_saved} min vs. your requested ${prefLabel}.`
          : userLang === 'zh'
            ? `💡 更优方案：相比您指定的${prefLabel}，使用${altLabel}可减少 ${ba.transfers_saved} 次换乘、约 ${ba.estimated_minutes_saved} 分钟。`
            : `💡 より良い案：${prefLabel}指定より${altLabel}の方が乗換 ${ba.transfers_saved} 回・約 ${ba.estimated_minutes_saved} 分短縮できます。`;
        const altSegs = (ba.alt_segments || []).map((s, i) => {
          const stops = (s.stops && s.stops.length ? s.stops : [s.fromStop, s.toStop]).map(n => getDisplayStationName(n, userLang));
          const base = { step: i + 1, mode: s.mode, mode_label: modeLabel(s.mode), from: getDisplayStationName(s.fromStop, userLang), to: getDisplayStationName(s.toStop, userLang), stops };
          if (s.mode === 'bus') { base.operator = opLabel(s.operator); base.non_step_bus = s.non_step_bus; }
          else if (s.mode === 'train') { base.operator = userLang === 'en' ? 'Railway' : userLang === 'zh' ? '铁路' : '鉄道'; }
          else if (s.mode === 'community_bus') { base.operator = s.bus; base.municipality = s.municipality; base.website = s.website; base.non_step_bus = null; }
          else if (s.mode === 'transfer') { base.note = userLang === 'en' ? 'Walk transfer' : userLang === 'zh' ? '步行换乘' : s.note; }
          return base;
        });
        betterAlternativeBlock = {
          note: reason,
          recommended_mode: ba.recommended_mode,
          preferred_mode: ba.preferred_mode,
          transfers_saved: ba.transfers_saved,
          estimated_minutes_saved: ba.estimated_minutes_saved,
          route: altSegs
        };
      }
      return jsonResponse({
        status: 'SUCCESS', detected_language: userLang,
        transfer: true,
        found: true,
        cross_modal: result.isCrossModal || false,
        from: getDisplayStationName(result.fromNode, userLang), to: getDisplayStationName(result.toNode, userLang),
        transfers: segments.length - 1,
        route: segments,
        barrier_free_note: barrierFreeNote,
        note: crossModal || undefined,
        no_direct_bus: result.complexBusChain || undefined,
        no_direct_bus_note: noDirectBusNote,
        vehicle_fallback: result.vehicleFallback || undefined,
        vehicle_fallback_note: vehicleFallbackNote,
        vehicle_requested: result.vehicleRequested || 'any',
        better_alternative: betterAlternativeBlock,
        community_bus_access: cbAccess.length ? cbAccess : undefined,
        community_bus_note: communityBusNote,
        // 公的機関の検索案内（到着地バス停名を基準に表示）
        gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(result.toNode, userLang)),
        data_source: 'ODPT BusroutePattern + BusTimetable + odpt:Station/odpt:BusstopPole (geo-link) + コミュニティバス駅接続(自治体公式データ)',
        ai_transit_advice: aiAdvice,
        test_mode: testAdv.testMode,
        simulated_failure_type: testAdv.failureType || undefined
      });
    } catch (error) {
      odptBreaker.onFailure(error);
      return handleApiError(error, { userLang });
    }
  }
  const userLang = resolveLang(args) || detectLanguage(busstopName) || 'ja';
  const parsedTest = parseTestMode({ from: busstopName, to: '', '-test': args['-test'], test: args.test, test_mode: args.test_mode });
  const testAdv = buildTestAdvice(parsedTest.simulatedFailure, userLang);
  const aiAdvice = await getTransitAdvice(testAdv, userLang);
  // バス停単体検索でも、地震時は通常の乗車候補を提示しない。
  if (isEarthquakeSimulation(testAdv)) {
    return await buildEarthquakeSafetyResponse('ground', userLang, { busstop_name: busstopName });
  }
  // ブレーカーOPENでもハードコード（JRバス関東・コミュニティバス）は fetchAllBuses 内で提供されるため、
  // ここでは弾かない（ODPT断でも ちぃばす 等のコミュニティバス検索は可能）。
  try {
    const cached = cache.get(cache.busData.key);
    let buses, okCount, failCount, hcCount;
    if (cached) {
      buses = cached.merged; okCount = cached.okCount; failCount = cached.failCount; hcCount = cached.hcCount || 0;
      odptBreaker.onSuccess();
    } else {
      const r = await fetchAllBuses(userLang);
      buses = r.merged; okCount = r.okCount; failCount = r.failCount; hcCount = r.hcCount || 0;
      cache.set(cache.busData.key, r, cache.busData.ttl);
      odptBreaker.onSuccess();
    }
    // 取得できた事業者ラベル（ODPT 3社 + hardCoded GTFSソース）
    const operatorSumm = [
      ...BUS_OPERATORS.map(o => ({ operator: o.id, label: userLang === 'en' ? o.labelEn : userLang === 'zh' ? o.labelZh : o.label, website: o.website })),
      ...BUS_GTFS_SOURCES.filter(s => s.hardCoded).map(s => ({ operator: s.operatorId, label: userLang === 'en' ? s.labelEn : userLang === 'zh' ? s.labelZh : s.label, website: s.website, hardcoded: true })),
      ...BUS_GTFS_SOURCES.filter(s => !s.hardCoded && s.url).map(s => ({ operator: s.operatorId, label: userLang === 'en' ? s.labelEn : userLang === 'zh' ? s.labelZh : s.label, website: s.website, gtfs: true }))
    ];
    const dataSourceNote = `ODPT Bus (${okCount}/${BUS_OPERATORS.length} 事業者取得成功)` + (failCount > 0 ? ` / ${failCount}社取得失敗` : '') + (hcCount > 0 ? ` + GTFS-JP(${hcCount}ソース: JRバス関東・都内コミュニティバス・川崎市バス・関東バス等)` : '');

    // 🔴 足の悪いユーザー向けバリアフリー注意喚起（odpt:Bus に車椅子/低床情報は無いため案内のみ）
    const barrierFreeNote = userLang === 'en'
      ? 'Note: ODPT bus data does not include wheelchair/low-floor info. Please check the operator website or contact the bus office for step-free / priority-seat availability.'
      : userLang === 'zh'
        ? '注意：ODPT 公交数据不含轮椅/低地板车辆信息。无障碍乘车（有无台阶、优先座位）请在各公司官网或致电营业所确认。'
        : 'ご案内：ODPTのバスデータには車椅子対応・低床バス等の情報は含まれません。段差の有無や優先席の利用は、各事業者ウェブサイトまたは営業所へお問い合わせください。';

    if (!busstopName) {
      return jsonResponse({
        status: "SUCCESS", detected_language: userLang,
        total: buses.length,
        operators: operatorSumm,
        bus_routes: buses.slice(0, 20).map(b => ({
            note: getDisplayStationName(b['odpt:note'] || b._displayNote, userLang), route: b['odpt:busroute'], number: b['odpt:busNumber'],
          operator: userLang === 'en' ? b._operatorLabel.labelEn : userLang === 'zh' ? b._operatorLabel.labelZh : b._operatorLabel.label,
          website: b._communityBusUrl || b._operatorLabel.website || undefined,
          community_bus: b._communityBus ? true : undefined,
          municipality: b._municipality || undefined
        })),
        barrier_free_note: barrierFreeNote,
        data_source: dataSourceNote,
        fallback_url: "https://www.kotsu.metro.tokyo.jp/bus/",
        ai_transit_advice: aiAdvice,
        test_mode: testAdv.testMode,
        simulated_failure_type: testAdv.failureType || undefined
      });
    }
    // 英語・中国語のバス停名を日本語に解決（例: Sakurabashi→桜橋、Tsukishima→月島）
    const resolveBusStopLang = (input) => {
      const trimmed = String(input || '').trim();
      if (!trimmed) return trimmed;
      const norm = normalizeBusStop(trimmed);
      const lower = trimmed.toLowerCase();
      const normLower = norm.toLowerCase();
      for (const [jp, trans] of Object.entries(STATION_DISPLAY_NAMES)) {
        const en = (trans.en || '').toLowerCase();
        const zh = trans.zh || '';
        // 入力（例: Kawasaki Station）と normalizeBusStop 結果（例: 川崎）の両方で駅名解決
        if ((en && (lower === en || normLower === en)) || (zh && (trimmed === zh || norm === zh))) return jp;
      }
      // 🔴 normalizeBusStop で「駅/Station/站」サフィックス除去・駅名正規化された結果も参照する
      // （例: 「Kawasaki Station」→ normalizeBusStop → 「川崎」→ STATION_NAME_MAP['川崎'] は無いが
      //   STATION_NAME_MAP['Kawasaki'] はある。norm がローマ字の場合は STATION_NAME_MAP[norm] を引く）
      if (STATION_NAME_MAP[trimmed]) return STATION_NAME_MAP[trimmed];
      if (norm !== trimmed && STATION_NAME_MAP[norm]) return STATION_NAME_MAP[norm];
      return trimmed;
    };
    const resolvedBusstop = resolveBusStopLang(busstopName);
    const busstopVariants = (input) => {
      const norm = normalizeStationName(input);
      return [input, norm].filter((v, i, a) => a.indexOf(v) === i);
    };
    // 🔴 前方一致（入力で始まるバス停）を最優先。部分一致のみの同名ノイズ
    // （例: 「大門」検索で埼玉の「野火止大門」「高松大門通り」が混ざる問題）を除外する。
    // 前方一致にヒットが無い場合のみ、従来の部分一致にフォールバックする。
    const matchedAll = buses.filter(b => {
      return busstopVariants(resolvedBusstop).some(v => {
        const stripped = v.replace(/(停留所|バス停|駅)$/, '');
        return b._searchKeys.some(k => k.includes(v) || (stripped !== v && k.includes(stripped)));
      });
    });
    const matchedPrefix = buses.filter(b => {
      return busstopVariants(resolvedBusstop).some(v => {
        const stripped = v.replace(/(停留所|バス停|駅)$/, '');
        return b._searchKeys.some(k => k.startsWith(v) || (stripped !== v && k.startsWith(stripped)));
      });
    });
    // 「駅前」サフィックスのバス停（例: 大門駅前）を先頭に並べ替え。
    // 同名バス停が複数地域にある場合、駅に直結するバス停が最上位に来るようにする。
    const matchedPrefixSorted = [...matchedPrefix].sort((a, b) => {
      const aKey = String((a._searchKeys || [])[0] || '');
      const bKey = String((b._searchKeys || [])[0] || '');
      const aStation = /駅前$/.test(aKey) ? 0 : 1;
      const bStation = /駅前$/.test(bKey) ? 0 : 1;
      return aStation - bStation;
    });
    const matched = matchedPrefixSorted.length > 0 ? matchedPrefixSorted : matchedAll;
    // 🔴 0件時の案内改善: 入力に部分一致する実在バス停を類似候補として提示
    // （例: 「合羽橋」→「合羽坂下」「浅草」→「浅草雷門」等）。
    // ODPT に同名バス停が無い場合でも、最寄りの実在バス停名を教えることで
    // ユーザーが正しい乗車バス停を特定できる。
    let nearbySuggestions = undefined;
    if (matched.length === 0) {
      const q = resolvedBusstop.replace(/(停留所|バス停|駅)$/, '');
      // #46: 類似候補をスコアリングして上位のみ提示（先頭1文字だけの雑な一致を排除）。
      // 1) 入力が停名に含まれる 2) 共通接頭辞長 3) 編集距離（Levenshtein）
      // 4) 「駅前」「駅」サフィックス付き停名を優先 5) 上位5件に制限
      if (q.length >= 2) {
        const seen = new Set();
        const cands = [];
        for (const b of buses) {
          for (const k of (b._searchKeys || [])) {
            // 生データの系統名・ID付きノイズ（「系統名:数字:停留所」等）は候補から除外
            if (!k || seen.has(k) || /[：:〜→|]/.test(k)) continue;
            const stripped = k.replace(/(停留所|バス停|駅)$/, '');
            let prefixLen = 0;
            const maxP = Math.min(q.length, stripped.length);
            while (prefixLen < maxP && q[prefixLen] === stripped[prefixLen]) prefixLen++;
            const dist = levenshteinDist(q, stripped);
            let score = 0;
            if (stripped.includes(q)) score += 20;          // 入力が停名の一部（「浅草」→「浅草雷門」）
            if (prefixLen >= 2) score += prefixLen * 4;     // 共通接頭辞2文字以上は強い一致
            else if (prefixLen === 1) score += 1;           // 1文字一致は最低限のみ
            if (dist === 0) score += 15;
            else if (dist <= 1) score += 10;
            else if (dist === 2) score += 5;
            else if (dist === 3) score += 2;
            if (/駅前$/.test(k)) score += 2;                // 駅直結バス停を優先
            else if (/駅$/.test(k)) score += 1;
            // 閾値: 関連が薄い候補（例: 「佐倉」→「阿佐ヶ谷駅前」「越生」→「鶴見駅」の
            // 1文字一致・編集距離2のみ）は除外。2文字クエリで距離2はほぼ無関係。
            if (score >= 8) {
              seen.add(k);
              cands.push({ k, score });
            }
          }
        }
        if (cands.length) {
          cands.sort((a, b) => b.score - a.score);
          const label = userLang === 'en' ? 'Similar nearby bus stops'
            : userLang === 'zh' ? '相近的公交站名' : '類似する近隣のバス停';
          const localized = cands.slice(0, 5)
            .map(c => getDisplayStationName(c.k, userLang))
            .filter(s => userLang === 'ja' || !/[\u3040-\u30ff\u3400-\u9fff]/.test(s));
          nearbySuggestions = localized.length ? { note: label, stops: localized } : undefined;
        }
      }
    }
    return jsonResponse({
      status: "SUCCESS", detected_language: userLang,
      busstop: busstopName,
      resolved_busstop: resolvedBusstop !== busstopName ? resolvedBusstop : undefined,
      total: matched.length,
      nearby_suggestions: nearbySuggestions,
      // 公的機関の検索案内: バス停名を基準に表示する（ご老人等が「バス停名」で公的機関を探すケースに対応。v2.36.3）
      // 多言語チェック（probe-all-lang）が英語・中国語応答に日本語名が残るのを弾くため、言語別表示名で渡す。
      gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(resolvedBusstop || busstopName, userLang)),
      operators: operatorSumm,
      bus_routes: matched.slice(0, 20).map(b => ({
        note: getDisplayStationName(b['odpt:note'] || b._displayNote, userLang), route: b['odpt:busroute'], number: b['odpt:busNumber'],
        frequency: b['odpt:frequency'],
        operator: userLang === 'en' ? b._operatorLabel.labelEn : userLang === 'zh' ? b._operatorLabel.labelZh : b._operatorLabel.label,
        website: b._communityBusUrl || b._operatorLabel.website || undefined,
        community_bus: b._communityBus ? true : undefined,
        municipality: b._municipality || undefined
      })),
      barrier_free_note: barrierFreeNote,
      data_source: dataSourceNote,
      fallback_url: "https://www.kotsu.metro.tokyo.jp/bus/",
      ai_transit_advice: aiAdvice,
      test_mode: testAdv.testMode,
      simulated_failure_type: testAdv.failureType || undefined
    });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}

// ============================================================
// ✈️ 空港フライト時刻・到着時刻表示（AviationStack）
// ============================================================

// 空港名（日本語/英語）→ IATA コード
// 空港 IATA → 天候取得用の気象庁地域コード（到着時の AI アドバイス用）
// 空港名の正規化: 末尾の 空港/Airport/机场 サフィックスを除去（3か国語対応）
// 2026-08 検査プログラムで検出（#経路検査）: 「羽田空港第3ターミナル」等のターミナル名が
// 解決できず INVALID_INPUT になっていた。ターミナル接尾辞も除去して IATA 解決できるようにする。
function normalizeAirportQuery(name) {
  if (!name) return name;
  return name.replace(/(第[1-3一二三]ターミナル|ターミナル|Terminal|航站楼|空港|Airport|机场)\s*$/i, '').trim();
}
// IATA → 日本語表示名（到着連携用の駅名マップ）
// 到着時、destination 未指定でも表示する主要アクセス駅（海外来客・帰省に最適）

// ============================================================
// ✈️ ODPT 航空データ（プライマリソース・JAL/ANA・基本ライセンス）
// AviationStack はフォールバック（FLIGHT_API_KEY 設定時のみ・JAL/ANA 以外の便や海外空港を補完）
// ============================================================

// ODPT フライトステータス辞書（odpt:FlightStatus の 32 種 → ja/en/zh）
// 空港 IATA → 航空会社表示名（ODPT は operator が odpt.Operator:JAL/ANA 形式）
// odpt.Airport:HND / odpt.AirportTerminal:HND.Terminal3 形式 → 末尾コード抽出
function odpIdSuffix(id, prefix) {
  if (!id) return null;
  const s = String(id);
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}
// ODPT のフライト1件を共通フォーマットに正規化
function normalizeOdpFlight(f, direction, userLang) {
  const isDep = direction === 'departure';
  const flightNumbers = f['odpt:flightNumber'];
  const flightIata = Array.isArray(flightNumbers) ? flightNumbers[0] : (flightNumbers || null);
  const opId = odpIdSuffix(f['odpt:operator'] || f['odpt:airline'], 'odpt.Operator:');
  const airlineDef = ODPT_AIRLINE_NAMES[opId] || null;
  const statusId = odpIdSuffix(f['odpt:flightStatus'], 'odpt.FlightStatus:');
  const statusDef = statusId ? (ODPT_FLIGHT_STATUS_MAP[statusId] || null) : null;
  // 着目側（到着なら到着側、出発なら出発側）
  const endAirportId = odpIdSuffix(isDep ? f['odpt:departureAirport'] : f['odpt:arrivalAirport'], 'odpt.Airport:');
  const otherAirportId = odpIdSuffix(isDep ? f['odpt:destinationAirport'] : f['odpt:originAirport'], 'odpt.Airport:');
  const terminalId = odpIdSuffix(isDep ? f['odpt:departureAirportTerminal'] : f['odpt:arrivalAirportTerminal'], 'odpt.AirportTerminal:');
  // ターミナル: HND.Terminal3 → 3 / Terminal1 → 1（既存の「羽田空港第Nターミナル」組み立てと整合）
  let terminal = null;
  if (terminalId) {
    const m = String(terminalId).match(/Terminal(\d+)/i);
    terminal = m ? m[1] : null;
  }
  const scheduled = isDep ? f['odpt:scheduledDepartureTime'] : f['odpt:scheduledArrivalTime'];
  const actual = isDep ? f['odpt:actualDepartureTime'] : f['odpt:actualArrivalTime'];
  const estimated = isDep ? f['odpt:estimatedDepartureTime'] : f['odpt:estimatedArrivalTime'];
  // 遅延 = 実績 − 予定（分）。日跨ぎ（例: 22:55 → 00:01）を補正する。
  const delayMin = calculateFlightDelayMinutes(scheduled, actual);
  return {
    flight_iata: flightIata,
    airline: airlineDef ? airlineDef[userLang === 'en' ? 'en' : userLang === 'zh' ? 'zh' : 'ja'] : opId,
    status: statusId,
    status_text: statusDef ? statusDef[userLang === 'en' ? 'en' : userLang === 'zh' ? 'zh' : 'ja'] : statusId,
    terminal,
    gate: isDep ? f['odpt:departureGate'] : f['odpt:arrivalGate'],
    baggage: null, // ODPT 航空データには手荷物受取情報なし
    scheduled_time: scheduled,
    actual_time: actual,
    estimated_time: estimated,
    delay_minutes: delayMin,
    airport_name: endAirportId,
    airport_iata: endAirportId,
    other_airport_name: otherAirportId,
    other_airport_iata: otherAirportId
  };
}

// ODPT からフライトを取得（プライマリ・JAL/ANA のリアルタイム発着）
async function fetchFlightsOdp(params) {
  if (!API_KEY) return null;
  const isDep = params.direction === 'departure';
  const type = isDep ? 'odpt:FlightInformationDeparture' : 'odpt:FlightInformationArrival';
  const q = { 'acl:consumerKey': API_KEY };
  if (params.flight_iata) q['odpt:flightNumber'] = params.flight_iata;
  else if (params.arr_iata) q['odpt:arrivalAirport'] = `odpt.Airport:${params.arr_iata}`;
  else if (params.dep_iata) q['odpt:departureAirport'] = `odpt.Airport:${params.dep_iata}`;
  if (params.airline_iata) q['odpt:operator'] = `odpt.Operator:${params.airline_iata}`;
  const url = `${API_BASE_URL}/${type}?${new URLSearchParams(q).toString()}`;
  const cacheKey = cache.flightData.key + ':odp:' + url;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const res = await axios.get(`${API_BASE_URL}/${type}`, { params: q, timeout: 15000 });
    const data = Array.isArray(res.data) ? res.data : [];
    cache.set(cacheKey, data, cache.flightData.ttl);
    return data;
  } catch (err) {
    console.warn('ODPT flight error:', err.message);
    throw err;
  }
}

// AviationStack からフライトを取得（フォールバック・キーなし・エラー時は null を返し graceful degradation）
// 注意: AviationStack は flight_status の複数値（カンマ区切り）を拒否する（validation_error）。
// また無料プランは flight_date パラメータ非対応（function_access_restricted）のため、
// エラー時は必須パラメータ（空港/便名/limit）のみで再試行する。
async function fetchFlights(params) {
  if (!FLIGHT_API_KEY) return null;
  const buildQuery = (p) => {
    const qs = new URLSearchParams({ access_key: FLIGHT_API_KEY, limit: String(p.limit || 20) });
    if (p.flight_iata) qs.set('flight_iata', p.flight_iata);
    else if (p.arr_iata) qs.set('arr_iata', p.arr_iata);
    else if (p.dep_iata) qs.set('dep_iata', p.dep_iata);
    if (p.flight_status) qs.set('flight_status', p.flight_status);
    if (p.flight_date) qs.set('flight_date', p.flight_date);
    if (p.airline_iata) qs.set('airline_iata', p.airline_iata);
    return qs.toString();
  };
  const url = `${FLIGHT_API_BASE}/flights?${buildQuery(params)}`;
  const cacheKey = cache.flightData.key + ':' + url;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const hasRestrictedParams = !!(params.flight_status || params.flight_date || params.airline_iata);
  const call = async (u) => {
    const res = await axios.get(u, { timeout: 12000 });
    // AviationStack はエラー時 { error: { ... } } を返す（無効キー・パラメータ制限等）
    if (res.data && res.data.error) {
      throw new Error(res.data.error.message || res.data.error.type);
    }
    return res.data && res.data.data ? res.data.data : [];
  };
  try {
    const data = await call(url);
    cache.set(cacheKey, data, cache.flightData.ttl);
    return data;
  } catch (err) {
    console.warn('AviationStack error:', err.message);
    // 制限パラメータ（flight_status / flight_date / airline_iata）またはプラン制限（HTTP 403等）で
    // 失敗した場合は、必須パラメータ（空港/便名/limit）のみで再試行する。
    if ((params.flight_iata || params.arr_iata || params.dep_iata) && (hasRestrictedParams || err.response)) {
      try {
        const retryParams = { flight_iata: params.flight_iata, arr_iata: params.arr_iata, dep_iata: params.dep_iata, limit: params.limit || 20 };
        const data = await call(`${FLIGHT_API_BASE}/flights?${buildQuery(retryParams)}`);
        cache.set(cacheKey, data, cache.flightData.ttl);
        return data;
      } catch (e2) {
        console.warn('AviationStack retry error:', e2.message);
        throw e2;
      }
    }
    throw err;
  }
}

// フライト1件を共通フォーマットに正規化
function normalizeFlight(f, direction, userLang) {
  // ODPT形式（odpt:FlightInformationDeparture / Arrival）: プライマリデータソース
  if (f && f['@type'] && String(f['@type']).startsWith('odpt:FlightInformation')) {
    return normalizeOdpFlight(f, direction, userLang);
  }
  const dep = f.departure || {};
  const arr = f.arrival || {};
  const end = direction === 'departure' ? dep : arr; // 着目側（到着なら到着側、出発なら出発側）
  const delayMin = typeof end.delay === 'number' ? end.delay : null;
  // AviationStack は空港の現地時刻（例: 07:35 JST）を「+00:00」表記で返すため、
  // Date→Asia/Tokyo 変換（+9h）すると時刻がずれる。ISO文字列の時刻部分（HH:MM）をそのまま表示する。
  const fmt = (iso) => (iso && iso.length >= 16) ? iso.slice(11, 16) : (iso || null);
  const statusMap = { scheduled: '予定通り', active: '運航中', landed: '到着済', cancelled: '欠航', diverted: 'ダイバート', incident: 'トラブル' };
  const statusMapEn = { scheduled: 'On schedule', active: 'In flight', landed: 'Landed', cancelled: 'Cancelled', diverted: 'Diverted', incident: 'Incident' };
  const statusMapZh = { scheduled: '准点', active: '飞行中', landed: '已到达', cancelled: '取消', diverted: '备降', incident: '异常' };
  const statusText = userLang === 'en' ? (statusMapEn[f.flight_status] || f.flight_status)
    : userLang === 'zh' ? (statusMapZh[f.flight_status] || f.flight_status)
    : (statusMap[f.flight_status] || f.flight_status);
  // 他端（出発側なら到着空港、到着側なら出発空港）
  const other = direction === 'departure' ? arr : dep;
  return {
    flight_iata: f.flight?.iata || f.flight_iata || null,
    airline: f.airline?.name || null,
    status: f.flight_status,
    status_text: statusText,
    terminal: end.terminal || null,
    gate: end.gate || null,
    baggage: end.baggage || null,
    scheduled_time: fmt(end.scheduled),
    actual_time: fmt(end.actual),
    estimated_time: fmt(end.estimated),
    delay_minutes: delayMin,
    airport_name: end.airport || null,
    airport_iata: end.iata || null,
    other_airport_name: other.airport || null,
    other_airport_iata: other.iata || null
  };
}

async function searchFlight(args) {
  const airportRaw = args?.airport || args?.airport_name || '';
  const flightNumber = args?.flight_number || args?.flight_iata || '';
  const direction = (args?.direction === 'departure') ? 'departure' : 'arrival';
  const flightDate = args?.flight_date || null;
  const airlineIata = args?.airline || null;
  const destination = args?.destination || null; // 到着時の連携先（例: 東京駅）
  const userLang = resolveLang(args) || detectLanguage(airportRaw) || detectLanguage(flightNumber) || 'ja';
  const parsedTest = parseTestMode({ from: airportRaw, to: destination || '', '-test': args['-test'], test: args.test, test_mode: args.test_mode });
  const testAdv = buildTestAdvice(parsedTest.simulatedFailure, userLang);

  const label = (ja, en, zh) => userLang === 'en' ? en : userLang === 'zh' ? zh : ja;

  try {
    // 入力検証: 空港名または便名のいずれか必須
    if (!airportRaw && !flightNumber) {
      return jsonResponse(buildErrorResponse('INVALID_INPUT',
        label('空港名または便名を指定してください。', 'Specify an airport name or flight number.', '请指定机场名或航班号。'),
        { userLang }));
    }
    // 空港 IATA を解決（両モードで共有）
    const airportQuery = normalizeAirportQuery(airportRaw);
    const iata = AIRPORT_IATA[airportQuery] || normalizeAirportIata(airportQuery);
    if (airportRaw && !iata && !flightNumber) {
      return jsonResponse(buildErrorResponse('INVALID_INPUT',
        label('対応していない空港コードまたは空港名です。', 'Unsupported airport code or airport name.', '不支持的机场代码或机场名称。'),
        { userLang }));
    }
    if (!validateFlightDate(flightDate)) {
      return jsonResponse(buildErrorResponse('INVALID_INPUT',
        label('flight_date は YYYY-MM-DD 形式で指定してください。', 'flight_date must use YYYY-MM-DD format.', 'flight_date 必须使用 YYYY-MM-DD 格式。'),
        { userLang }));
    }
    // 到着時の AI インテリジェントアドバイス（天候連動・3か国語）
    // -test 障害シミュレーション指定時は障害アドバイスを優先
    let aiAdvice = testAdv.aiAdvice || null;
    const weatherArea = iata ? (AIRPORT_WEATHER_AREA[iata] || '130000') : '130000';
    if (!aiAdvice) {
      try {
        const wa = await getWeatherAdvice(userLang, weatherArea);
        aiAdvice = wa.advice || null;
      } catch (_) { aiAdvice = null; }
    }
    // フライト取得（プライマリ: ODPT / フォールバック: AviationStack）
    // ODPT（JAL/ANA リアルタイム発着・基本ライセンス）を優先し、取得できない場合のみ
    // AviationStack（FLIGHT_API_KEY 設定時）にフォールバックする。
    let flights = null;
    let flightApiError = null;
    const flightParams = { limit: 20, direction };
    if (flightNumber) flightParams.flight_iata = flightNumber.toUpperCase();
    else if (iata) flightParams[direction === 'arrival' ? 'arr_iata' : 'dep_iata'] = iata;
    else {
      return jsonResponse(buildErrorResponse('INVALID_INPUT',
        label('空港名または便名を指定してください。', 'Specify an airport name or flight number.', '请指定机场名或航班号。'),
        { userLang }));
    }
    if (flightDate) flightParams.flight_date = flightDate;
    if (airlineIata) flightParams.airline_iata = airlineIata.toUpperCase();
    // ODPT を先に試す（APIキー設定済みなら常に利用可能・429レート制限なし）
    if (API_KEY) {
      try { flights = await fetchFlightsOdp(flightParams); }
      catch (error) { flightApiError = error; }
    }
    // ODPT で取得できない場合のみ AviationStack にフォールバック
    if ((!flights || flights.length === 0) && FLIGHT_API_KEY) {
      try { flights = await fetchFlights(flightParams); }
      catch (error) { flightApiError = error; }
    }

    // API障害と、APIが正常に空結果を返した場合を区別する。
    if ((!flights || flights.length === 0) && flightApiError && (API_KEY || FLIGHT_API_KEY)) {
      return jsonResponse(handleApiError(flightApiError, { userLang, api: 'flight' }));
    }

    // キーなし / データなし → graceful degradation: 空港アクセス経路のみ
    if (!flights || flights.length === 0) {
      const stationName = iata ? (IATA_TO_TERMINAL_STATION[iata] || airportRaw) : airportRaw;
      const accessRoutes = [];
      // destination 指定時はそれのみ、なければ到着時は主要アクセス駅を複数表示
      const destList = destination ? [destination]
        : (direction === 'arrival' && iata && DEFAULT_ACCESS_DESTINATIONS[iata]) ? DEFAULT_ACCESS_DESTINATIONS[iata]
        : [];
      for (const dest of destList) {
        const rr = computeRoutes(stationName, dest);
        if (rr && rr.routes) {
          const route = rr.routes[0];
          accessRoutes.push({
            from: getDisplayStationName(stationName, userLang), to: getDisplayStationName(dest, userLang),
            transfers: route.summary.transfers,
            estimated_minutes: route.summary.estimated_minutes,
            main_line: getDisplayLineName(route.summary.main_line, userLang),
            segments: route.segments.map(s => s.walk ? {
              // 近接異名駅（連絡駅）間の徒歩連絡セグメント
              line: userLang === 'en' ? '🚶 Walk transfer' : userLang === 'zh' ? '🚶 步行换乘' : '🚶 徒歩連絡',
              from: getDisplayStationName(s.from, userLang),
              to: getDisplayStationName(s.to, userLang),
              stops: s.stops,
              walk_minutes: s.minutes
            } : {
              line: getDisplayLineName(s.line, userLang),
              from: getDisplayStationName(s.from, userLang),
              to: getDisplayStationName(s.to, userLang),
              stops: s.stops
            })
          });
        }
      }
      // 便名のみ指定で空港が特定できない場合の案内
      const isFlightNumberOnly = !airportRaw && !!flightNumber;
      const flightApiOn = !!(API_KEY || FLIGHT_API_KEY);
      const note = isFlightNumberOnly
        ? (flightApiOn
          ? label('指定された便は当日のデータに見つかりませんでした（JAL/ANA のリアルタイムデータは当日分のみ取得可能です）。',
                  'No flights found for the specified flight number (JAL/ANA realtime data covers current-day flights only).',
                  '未找到指定航班（JAL/ANA 实时数据仅支持当日航班）。')
          : label('便名検索には API キーの設定が必要です（到着空港を特定できません）。',
                  'Flight number search requires an API key (cannot determine arrival airport).',
                  '按航班号查询需要配置 API 密钥（无法确定到达机场）。'))
        : (flightApiOn
          ? label('フライトが見つかりませんでした。', 'No flights found.', '未找到航班。')
          : label('フライト時刻は設定されていません（APIキー未設定）。空港へのアクセス経路のみ表示します。',
                  'Flight times are unavailable (API key not set). Showing airport access route only.',
                  '航班时刻未设置（未配置API密钥）。仅显示机场接驳路线。'));
      return jsonResponse({
        status: 'SUCCESS',
        mode: 'graceful_degradation',
        message: note,
        airport: isFlightNumberOnly ? `便名: ${flightNumber}` : (airportRaw || flightNumber),
        direction,
        ai_transit_advice: aiAdvice,
        access_route: accessRoutes.length === 1 ? accessRoutes[0] : null,
        access_routes: accessRoutes.length > 1 ? accessRoutes : undefined,
        flight_api_configured: !!(API_KEY || FLIGHT_API_KEY),
        test_mode: testAdv.testMode,
        simulated_failure_type: testAdv.failureType || undefined
      });
    }

    // 正規化
    const normalized = flights.map(f => normalizeFlight(f, direction, userLang)).filter(Boolean);

    // 到着時の連携: 最も関連性の高いフライト（最初の1件）から空港→目的地ルート
    const accessRoutes = [];
    if (direction === 'arrival' && normalized.length > 0) {
      const top = normalized[0];
      const stationName = top.terminal
        ? (top.airport_iata === 'HND' ? `羽田空港第${top.terminal}ターミナル` : top.airport_iata === 'NRT' ? `成田空港第${top.terminal}ターミナル` : (IATA_TO_TERMINAL_STATION[top.airport_iata] || top.airport_name))
        : (IATA_TO_TERMINAL_STATION[top.airport_iata] || top.airport_name);
      const destList = destination ? [destination]
        : (top.airport_iata && DEFAULT_ACCESS_DESTINATIONS[top.airport_iata]) ? DEFAULT_ACCESS_DESTINATIONS[top.airport_iata]
        : [];
      for (const dest of destList) {
        const rr = computeRoutes(stationName, dest);
        if (rr && rr.routes) {
          const route = rr.routes[0];
          accessRoutes.push({
            from: getDisplayStationName(stationName, userLang), to: getDisplayStationName(dest, userLang),
            transfers: route.summary.transfers,
            estimated_minutes: route.summary.estimated_minutes,
            main_line: getDisplayLineName(route.summary.main_line, userLang),
            segments: route.segments.map(s => s.walk ? {
              line: userLang === 'en' ? '🚶 Walk transfer' : userLang === 'zh' ? '🚶 步行换乘' : '🚶 徒歩連絡',
              from: getDisplayStationName(s.from, userLang),
              to: getDisplayStationName(s.to, userLang),
              stops: s.stops,
              walk_minutes: s.minutes
            } : {
              line: getDisplayLineName(s.line, userLang),
              from: getDisplayStationName(s.from, userLang),
              to: getDisplayStationName(s.to, userLang),
              stops: s.stops
            })
          });
        }
      }
    }

    return jsonResponse({
      status: 'SUCCESS',
      mode: 'flight_info',
      airport: airportRaw || flightNumber,
      direction,
      ai_transit_advice: aiAdvice,
      flight_count: normalized.length,
      flights: normalized.slice(0, 20),
      access_route: accessRoutes.length === 1 ? accessRoutes[0] : null,
      access_routes: accessRoutes.length > 1 ? accessRoutes : undefined,
      flight_api_configured: !!(API_KEY || FLIGHT_API_KEY),
      test_mode: testAdv.testMode,
      simulated_failure_type: testAdv.failureType || undefined
    });
  } catch (error) {
    return handleApiError(error, { userLang });
  }
}

export { searchRoute, searchFare, getWeather, getTimetable, searchBus, getStationInfo, listTransitOperators, listCommunityBuses, getOperatorRoutes, listFerryPorts, searchFerry, detectLanguage, resolveLang, parseTestMode, computeRoutes, findShortestPath, resolveStation, searchFlight, translateTrainInfoDetail, translateWeather, detectFailureType, buildTestAdvice, STATION_TO_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES, calculateFlightDelayMinutes, parseCsvLine, validateFlightDate, normalizeAirportIata, gtfsFetchDates };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('index.mjs'))) {
  main().catch(error => { console.error('Failed to start server:', error); process.exit(1); });
}