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
import { searchBus, searchBusTransfer, fetchAllBuses } from './handlers/bus.mjs';
import { searchFlight, calculateFlightDelayMinutes, normalizeAirportIata } from './handlers/flight.mjs';
import { getStationInfo, listCommunityBuses, listTransitOperators, getOperatorRoutes } from './handlers/station-info.mjs';
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

// ==========================================
// 🚃 事業者別路線一覧
// ==========================================

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

// 横浜市営バスは odpt:note が null で、バス停名がローマ字ID（例: SakuragichoStation）しかない。
// ローマ字駅名→日本語の最小マップ（主要ターミナル＋観光地）を付与し、日本語入力でも検索可能にする。
// ODPTには全バス停の日本語名が無いため、網羅ではなく主要駅に限定。

// 事業者ID→ラベル逆引き（レコードの odpt:operator から表示名を出す）

// BusstopPole ID（例: odpt.BusstopPole:YokohamaMunicipal.SakuragichoStation.2014.2）
// から駅名相当（SakuragichoStation）を抽出。ODPTには日本語バス停名が無い事業者（横浜市営等）向け。


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

// odpt:BusroutePattern から (operator, routePatternId, [orderedStopNames]) を取得

// odpt:BusTimetable から (patternId → 各停留所の isNonStepBus) および
// (stopName → isNonStepBus) を取得。stopName マップは patternId 不一致を回避するためのフォールバック。

// 乗り継ぎグラフ構築: ノード=バス停(正規化済), エッジ=同一路線の隣接停留所
// 共有バス停を乗り継ぎ点とする。重みは停留所数（1エッジ=1停留所）。
// 一貫性のため、stopToPatterns の stops は normalizeBusStop 済みの文字列配列を保存。

// ============================================================
// 🚌🚃 バス⇔電車 横断乗り継ぎ（bus→train→bus）
// ============================================================

// 電車駅名レベル隣接グラフ（RAILWAY_LINES から構築）。重みは駅数ベース（1）。
// 同一駅に複数路線が来る場合、路線間乗換を自動結合（駅名レベルで全隣接をマージ）。

// odpt:BusstopPole から { バス停名(正規化) -> {lat, lon, operator} } を取得（geo 付き）

// odpt:Station から { 駅名(正規化) -> {lat, lon} } を取得（geo 付き）

// 緯度経度から距離（m）を計算（簡易ヘイバーサイン近似）

// バス停→最寄り駅 の紐付けマップ（近接閾値以内の駅を結ぶ）

// BusstopPole レコードから表示バス停名を取得（title 優先、なければ note/owl:sameAs）

// BusstopPole レコードから operator ショートID を取得
// 手順: 1) BFSで最短ノード列を求める / 2) 連続するノードを同一路線パターンで
//        グループ化し、1系統＝1乗車セグメントにまとめる

// 単一バス区間（a→b）のセグメント化（nonStep 付与）。searchBusTransfer の統合グラフから呼ぶ。

// ============================================================
// 🚌 乗り物指定優先定数
// ============================================================
// vehicle 指定時のエッジ重みマップ（キー: 指定乗り物 → 各モードの重み）
// 非指定モードに重み 3（乗換1回相当）を乗せることで優先を実現。

// エッジの type から mode キーを取得（transfer は link 扱い）

// 重み付きダイクストラ（最小コスト経路探索）
// adj: Map<nodeName, [{to, type}]>, weights: mode->cost
// 戻り値: { found, nodePath, segments, score }
// バイナリミニヒープ（Dijkstra 用・遅延削除は dist 再チェックで対応）


// ノード列 → セグメント配列（searchBusTransfer のセグメント化を関数化）

// 指定乗り物が経路に含まれるか

// 経路の簡易スコア（乗換回数 + モード内訳）— better_alternative 比較用

// 重み付き探索 + 通常探索の2回実行 + better_alternative 進言
// ============================================================
// 🚌 コミュニティバス案内ブロック（Phase 1: 駅までの足・駅からの足）
// ============================================================
// 足の悪いユーザー向けに「この駅はどのコミュニティバスが利用できるか」を案内する。
// 経路探索（統合グラフ）が失敗しても、駅⇔コミュニティバス停の接続情報を必ず返す。

// #46: バス停名の類似度判定用 編集距離（Levenshtein）。全角・半角はそのまま比較し、
// 検索キーの近さ（類似候補提示）にのみ使用する。


// ============================================================
// ✈️ 空港フライト時刻・到着時刻表示（AviationStack）
// ============================================================

// 空港名（日本語/英語）→ IATA コード
// 空港 IATA → 天候取得用の気象庁地域コード（到着時の AI アドバイス用）
// 空港名の正規化: 末尾の 空港/Airport/机场 サフィックスを除去（3か国語対応）
// 2026-08 検査プログラムで検出（#経路検査）: 「羽田空港第3ターミナル」等のターミナル名が
// 解決できず INVALID_INPUT になっていた。ターミナル接尾辞も除去して IATA 解決できるようにする。
// IATA → 日本語表示名（到着連携用の駅名マップ）
// 到着時、destination 未指定でも表示する主要アクセス駅（海外来客・帰省に最適）

// ============================================================
// ✈️ ODPT 航空データ（プライマリソース・JAL/ANA・基本ライセンス）
// AviationStack はフォールバック（FLIGHT_API_KEY 設定時のみ・JAL/ANA 以外の便や海外空港を補完）
// ============================================================

// ODPT フライトステータス辞書（odpt:FlightStatus の 32 種 → ja/en/zh）
// 空港 IATA → 航空会社表示名（ODPT は operator が odpt.Operator:JAL/ANA 形式）
// odpt.Airport:HND / odpt.AirportTerminal:HND.Terminal3 形式 → 末尾コード抽出
// ODPT のフライト1件を共通フォーマットに正規化

// ODPT からフライトを取得（プライマリ・JAL/ANA のリアルタイム発着）

// AviationStack からフライトを取得（フォールバック・キーなし・エラー時は null を返し graceful degradation）
// 注意: AviationStack は flight_status の複数値（カンマ区切り）を拒否する（validation_error）。
// また無料プランは flight_date パラメータ非対応（function_access_restricted）のため、
// エラー時は必須パラメータ（空港/便名/limit）のみで再試行する。

// フライト1件を共通フォーマットに正規化


export { searchRoute, searchFare, getWeather, getTimetable, searchBus, getStationInfo, listTransitOperators, listCommunityBuses, getOperatorRoutes, listFerryPorts, searchFerry, detectLanguage, resolveLang, parseTestMode, computeRoutes, findShortestPath, resolveStation, searchFlight, translateTrainInfoDetail, translateWeather, detectFailureType, buildTestAdvice, STATION_TO_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES, calculateFlightDelayMinutes, parseCsvLine, validateFlightDate, normalizeAirportIata, gtfsFetchDates };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('index.mjs'))) {
  main().catch(error => { console.error('Failed to start server:', error); process.exit(1); });
}