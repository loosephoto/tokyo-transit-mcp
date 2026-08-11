/**
 * Tokyo Transit MCP Server v2.39.6 (Production Ready)
 * 公共交通オープンデータセンター（ODPT） API および 気象庁 JMA API を利用した東京乗り換えMCP
 *
 * モジュール構成（v2.39.0 モノリス分割・依存方向: handlers → advice/data/lib → config）:
 *   index.mjs           サーバー起動・ツール登録・エクスポート再公開（本ファイル）
 *   config.mjs          共有状態（envConfig / cache / CircuitBreaker / API定数）
 *   data/               路線・駅・バス・フェリー・ランドマーク・多言語辞書データ
 *   lib/                純関数ユーティリティ（lang / csv / geo / time / common）
 *   advice/             AIアドバイス・天気・地震安全・GSI避難場所
 *   handlers/           各ツール実装（search-route / bus / ferry / fare / timetable / flight / station-info）
 */


// config.mjs は副作用（console.log の MCP stdio 保護）を持つため最初に import する
import './config.mjs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { OPERATOR_MAP } from './data/misc.mjs';
import { WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES } from './data/railway-lines.mjs';
import { jsonResponse, buildErrorResponse } from './lib/common.mjs';
import { detectLanguage, resolveLang, translateTrainInfoDetail, translateWeather } from './lib/lang.mjs';
import { parseCsvLine } from './lib/csv.mjs';
import { validateFlightDate, gtfsFetchDates } from './lib/time.mjs';
import { parseTestMode, detectFailureType, buildTestAdvice } from './advice/transit-advice.mjs';
import { getWeather } from './advice/weather.mjs';
import { searchRoute, computeRoutes, findShortestPath, resolveStation, STATION_TO_LINES } from './handlers/search-route.mjs';
import { searchFerry, listFerryPorts } from './handlers/ferry.mjs';
import { searchBus } from './handlers/bus.mjs';
import { searchFlight, calculateFlightDelayMinutes, normalizeAirportIata } from './handlers/flight.mjs';
import { getStationInfo, listCommunityBuses, listTransitOperators, getOperatorRoutes } from './handlers/station-info.mjs';
import { searchFare } from './handlers/fare.mjs';
import { getTimetable } from './handlers/timetable.mjs';

const server = new Server(
  { name: 'tokyo-transit-mcp', version: '2.39.6' },
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

export { searchRoute, searchFare, getWeather, getTimetable, searchBus, getStationInfo, listTransitOperators, listCommunityBuses, getOperatorRoutes, listFerryPorts, searchFerry, detectLanguage, resolveLang, parseTestMode, computeRoutes, findShortestPath, resolveStation, searchFlight, translateTrainInfoDetail, translateWeather, detectFailureType, buildTestAdvice, STATION_TO_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES, calculateFlightDelayMinutes, parseCsvLine, validateFlightDate, normalizeAirportIata, gtfsFetchDates };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('index.mjs'))) {
  main().catch(error => { console.error('Failed to start server:', error); process.exit(1); });
}