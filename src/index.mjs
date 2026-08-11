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
import { getParams, buildErrorResponse, jsonResponse, isRateLimitError, handleApiError, buildGovFacilitySearchSupport } from './lib/common.mjs';
import { searchRoute, resolveStation, computeRoutes, findShortestPath, STATION_TO_LINES, getStationRomanToJa, normalizeStationName, resolveSuspendedLineNames, normalizeLineHint, buildRouteSegments, commonLines, findNearestBikeStations, fetchBikeShareData, getDestinationCulturalFacilities, resolveLandmark, detectPrivateExpressOperator, detectLimitedExpressRequest, findLimitedExpressStation, buildLimitedExpressGuidance, findCommunityBusAccess, buildCommunityBusAccessBlock } from './handlers/search-route.mjs';
import { searchFerry, listFerryPorts } from './handlers/ferry.mjs';
import { searchFare } from './handlers/fare.mjs';
import { getTimetable } from './handlers/timetable.mjs';
import { parseTestMode, extractStationsFromNaturalLanguage, detectFailureType, buildTestAdvice, getTransitAdvice } from './advice/transit-advice.mjs';
import { buildEarthquakeTransportSafety, isEarthquakeSimulation, getGsiMunicipalityCode, fetchGsiEmergencyShelters, getGroundEmergencyShelters, buildEarthquakeSafetyResponse } from './advice/earthquake.mjs';
import { getWeatherAdvice, getWeather } from './advice/weather.mjs';
import { getDisplayStationName, getLineDisplayName, getCommunityBusDisplayName, getCommunityBusStopDisplayName, getDisplayLineName, translateWeather, translateTrainInfoDetail, detectLanguage, resolveLang } from './lib/lang.mjs';
import { validateFlightDate, gtfsFetchDates, normalizeOvernightTime, timeToSortMinutes } from './lib/time.mjs';
import { haversineDistance, haversineM } from './lib/geo.mjs';
import { LANDMARK_DEFS, LANDMARK_LOOKUP, DESTINATION_CULTURAL_FACILITIES, CULTURAL_CATEGORY_NAMES, DERIVED_CULTURAL_FACILITIES } from './data/landmarks.mjs';

// ローマ字駅ID → 日本語駅名 の逆引きマップ（ODPT odpt:Station から動的構築）
// ODPT の odpt:fromStation は 'odpt.Station:TokyoMetro.Fukutoshin.Shibuya' の形式で、
// 末尾の <Station> がローマ字（Shibuya）のため、日本語入力（渋谷）との照合に使用する。

// ==========================================
// 📋 -testモード解析
// ==========================================

// 自然言語入力（「查询从浅草到涩谷的路线」「浅草から渋谷まで」等）から駅名を抽出

// ==========================================
// 🚨 障害種別マップ（多言語対応）
// ==========================================


// -test シミュレーション用: 障害テキストから AIアドバイス + メタデータを構築（全ツール共通）

// 通常検索でも全交通モードが一貫してAIアドバイスを返す。
// -test の障害アドバイスを優先し、通常時は気象庁の天候連動アドバイス、
// 気象庁APIが一時利用不可でも安全な既定（晴天時）アドバイスを返す。

// 地震時は通常の経路・航路を「利用可能な経路」として提示しない。
// ground: 鉄道/トラム/バス等、water: フェリー/水上バス。


// 国土地理院の自治体別「指定緊急避難場所」公開GeoJSON（_2）を利用する。
// 駅・港の自治体コードは、まず東京圏で利用頻度が高い地点を明示的に対応づける。

// 地震時に通常経路を提示せず、安全確保を最優先にする共通レスポンス。
// search_route / search_bus / search_ferry の各入口で利用する。

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

// 駅名変換辞書（ノーマライズ用）

// 路線名: 日本語 → ODPT ローマ字IDキー（odpt:railway の末尾セグメント）
// ODPT は 'odpt.Railway:JR-East.Yamanote' の形式で、末尾がローマ字ID（Yamanote）のため、
// 日本語入力（山手線）との照合に使用。部分一致でも検索できるよう複数形を用意。


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

// ==========================================
// 🌐 多言語判定
// ==========================================

// 明示的な言語指定（args.language / args.lang）を解決する。
// 有効値（ja/en/zh）ならそれを返し、未指定・不正値は null（自動判定へフォールバック）。


// ==========================================
// 🚲 シェアサイクル（GBFS API + 統一キャッシュ）
// ==========================================




// ==========================================
// 🗺️ 経路探索エンジン（ODPTキー不要・自己完結型）
// 鉄道路線の順序付き駅リストから無向グラフを構築し、ダイクストラで最短乗り継ぎルートを算出。
// 主要都内路線＋臨海部（ゆりかもめ）を網羅し、浅草↔お台場等の主要区間をカバー。
// ==========================================

// 駅→路線リスト の逆引きインデックス

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

// ダイクストラ法による最短経路探索（ハイパーノード版）
// 出発・到着は「駅名」で与えられ、内部ではその駅の全路線ノードを仮想起点/終点とする。
// 評価基準: 第1に乗換回数を最小化、第2に実距離（駅間重み）を最小化。

// 経路を路線セグメントに分割（乗り換え検出）
// findShortestPath が返す「駅名パス path」と「各区間の実通過路線 lines」をもとに、
// 連続する同路線区間を1セグメントにまとめる。これにより乗換回数が正確になる。

// 2駅間をつなぐ路線（両方に存在する路線）を返す

// ルート検索のメインエントリ（searchRouteから呼び出し）


// ==========================================
// 🚢 フェリー ＆ 水上バス（GTFS統合 + 統一キャッシュ）
// ==========================================



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


// ランドマーク名（別名・訳名・略称・多言語）で最寄り駅を解決。
// 1) 完全一致（全言語・小文字） 2) サフィックス除去 3) 部分一致（入力がいずれかの名称を含む、長い名称を優先）


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

// 特急・新幹線リクエストの検出: from/to に列車種別・列車名が含まれるか

// 該当駅の特定: キーワードを除去した残り（またはキーワードを含まない入力）を駅名として解決
// 新幹線駅（新大阪など）は経路グラフに存在しないため、窓口ガイドのキーとも直接照合する。

// 特急・新幹線リクエストに対する窓口案内レスポンス

// ==========================================
// 🚃 乗り換えルート検索（統合版）
// ==========================================

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

// ==========================================
// 🌊 フェリー向け海上・津波安全情報
// ==========================================

// 港ごとの津波予報区（JMAの予報区名との照合用）。
// 範囲外の港は安全側に倒し、全国有効警報がある場合は航路を抑止する。






// ==========================================
// 🚢 フェリー航路検索
// ==========================================

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

// ODPT に運賃データ（odpt:RailwayFare）を提供している事業者

// 出発駅IDごとに運賃を分割取得（ODPT の 1000 件上限による切り捨てを回避）。
// 東京メトロ・都営に加え MIR（つくばエクスプレス）・TWR（りんかい線）・Yurikamome・
// 横浜市営地下鉄（YokohamaMunicipal）・多摩モノレール（TamaMonorail）も自動対応。


// ==========================================
// 🕐 時刻表検索
// ==========================================
// TrainTimetable 発着時刻の深夜0時越え正規化（GTFS 24:xx / 25:xx → 翌日表記）

// 24時超表記（25:xx 等）を「翌日フラグ付きのソート用分」へ変換する。
// 例: "25:10" → { minutes: 1510, nextDay: true } / "23:40" → { minutes: 1420, nextDay: false }

// #82: 検索日（YYYY-MM-DD）または calendar 引数から対象カレンダーを判定する。
// calendar 引数が指定されれば最優先。省略時は曜日で自動判定（土日=SaturdayHoliday）。

// 駅ID（odpt.Station:TokyoMetro.Namboku.Ichigaya）の末尾ローマ字を取り出す

// #22: TrainTimetable は路線単位で取得（無フィルタ/事業者単位だと ODPT の1000件上限で
// 一部路線が欠落し、駅フィルタが機能しなかった。例: TokyoMetro 事業者単位では銀座線が欠落）

// 対象事業者の路線ID一覧（odpt:Railway から取得・キャッシュ）


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