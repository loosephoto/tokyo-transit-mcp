/**
 * Tokyo Transit MCP Server v2.49.0 (Production Ready)
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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
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
import { getRunningStatus } from './handlers/running-status.mjs';
import { searchFare } from './handlers/fare.mjs';
import { getTimetable } from './handlers/timetable.mjs';

// #102: 低レベル Server + 手動ハンドラ から McpServer + registerTool へ移行。
// 各ツールは registerTool で登録し、ListTools / CallTool の手動ハンドラと switch を廃止した。
// SDK が zod スキーマから tools/list の JSON Schema を自動生成する（additionalProperties:false 等も自動付与）。
const server = new McpServer(
  { name: 'tokyo-transit-mcp', version: '2.49.0' },
  { capabilities: { tools: {}, logging: {} } }
);

// ==========================================
// 📋 ツール一覧
// ==========================================
// 🔴 #103/#109: 全ツールに annotations を付与する。
// このサーバーの全ツールは検索・取得系（読み取り専用・副作用なし・外部データ参照）なので
// readOnlyHint/destructiveHint/idempotentHint/openWorldHint = true/false/true/true で統一する。
// ツール定義に annotations が明示されていればそれを尊重し、未設定のものだけデフォルトを注入する。
// #102/#106: DEFAULT_TOOL_ANNOTATIONS を全ツールに適用（readOnly 系・副作用なし・外部データ参照）。
const DEFAULT_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

// ツール呼び出しの開始・完了・失敗を logging 通知するヘルパー（#104）
const log = (level, message) => {
  server.sendLoggingMessage({ level, logger: 'tokyo-transit-mcp', data: message }).catch(() => {});
};

// 最上位エラー（未知ツール・未捕捉例外）の言語を解決する（#95）
function resolveErrLang(args) {
  return resolveLang(args)
    || (detectLanguage(args?.from) !== 'ja' ? detectLanguage(args?.from)
        : detectLanguage(args?.to) !== 'ja' ? detectLanguage(args?.to)
        : detectLanguage(args?.area_name) !== 'ja' ? detectLanguage(args?.area_name)
        : detectLanguage(args?.from_port) !== 'ja' ? detectLanguage(args?.from_port)
        : detectLanguage(args?.station_name) !== 'ja' ? detectLanguage(args?.station_name)
        : 'ja');
}

// 各ツールのハンドラを呼び、logging 通知と isError の付与を行う共通ラッパー（#101/#104）
async function runTool(name, args, handler) {
  log('debug', `tool called: ${name}`);
  try {
    const result = await handler(args);
    const isErr = !!(result && result.isError);
    log('info', `tool finished: ${name} ${isErr ? '(error)' : '(ok)'}`);
    return result;
  } catch (error) {
    log('error', `tool failed: ${name}: ${error.message || String(error)}`);
    return jsonResponse(buildErrorResponse('UNKNOWN_ERROR', error.message || String(error), { userLang: resolveErrLang(args) }));
  }
}

// ==========================================
// 📋 ツール登録（McpServer + registerTool）
// ==========================================

// search_route
server.registerTool('search_route', {
  title: 'Search Route',
  description: '乗り換えルート検索 - 出発駅から到着駅までのルートを検索。日本語・英語・中国語自動識別、天候/高温/運休を検出しAIアドバイスを返答。language（ja/en/zh）を指定すると応答言語を強制（ユーザーのクエリ言語に合わせて指定推奨）。荒天・降雪・凍結時を除き、到着地点周辺のレンタサイクル案内を表示。user_location（緯度経度）指定時は運転見合わせ時の代替シェアサイクル案内を現在地基準で表示。',
  inputSchema: {
    from: z.string().describe('出発駅名'),
    to: z.string().describe('到着駅名'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は駅名から自動判定）。ユーザーが英語で質問した場合は en、中国語なら zh を指定すると確実にその言語で応答。'),
    user_location: z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180)
    }).optional().describe('ユーザーの現在位置（緯度経度）。運転見合わせ時のシェアサイクル案内を現在地基準で表示する場合に指定。例: {"lat": 35.681, "lon": 139.767}')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('search_route', args, searchRoute));

// get_station_info
server.registerTool('get_station_info', {
  title: 'Get Station Info',
  description: '駅情報取得 - 駅の基本情報をODPT APIから取得。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    station_name: z.string().describe('駅名'),
    operator: z.enum(Object.keys(OPERATOR_MAP)).optional().describe('事業者キー'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は駅名から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('get_station_info', args, getStationInfo));

// get_weather
server.registerTool('get_weather', {
  title: 'Get Weather',
  description: '天気情報取得＆多言語AIアドバイス - 気象庁APIから天気・気温を取得。高温時は熱中症注意を表示。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    area_name: z.string().describe('地域名（例: 東京, 横浜）'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は地域名から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('get_weather', args, getWeather));

// list_ferry_ports
server.registerTool('list_ferry_ports', {
  title: 'List Ferry Ports',
  description: 'フェリー／水上バス港一覧 - 東海汽船（伊豆諸島航路）と東京クルーズ（水上バス）の全港を表示。',
  inputSchema: {
    language: z.enum(['ja', 'en', 'zh']).optional()
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('list_ferry_ports', args, listFerryPorts));

// search_ferry
server.registerTool('search_ferry', {
  title: 'Search Ferry',
  description: 'フェリー／水上バス航路検索 - 港間の航路と時刻表を検索。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    from_port: z.string().describe('出発港'),
    to_port: z.string().describe('到着港'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は港名から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('search_ferry', args, searchFerry));

// list_transit_operators
server.registerTool('list_transit_operators', {
  title: 'List Transit Operators',
  description: '交通事業者一覧 - 鉄道・AGT・モノレール・路面電車・フェリーの全事業者を種別フィルター付きで表示。',
  inputSchema: {
    language: z.enum(['ja', 'en', 'zh']).optional(),
    type_filter: z.enum(['rail', 'agt', 'monorail', 'tram', 'all']).optional()
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('list_transit_operators', args, listTransitOperators));

// list_community_buses
server.registerTool('list_community_buses', {
  title: 'List Community Buses',
  description: '🚌 東京都コミュニティバス一覧 - 東京バス協会（tokyobus.or.jp）掲載の41自治体コミュニティバス（ちぃばす・ハチ公バス・ムーバス等）を自治体別に表示。時刻表・路線は各自治体公式サイトへのリンクで案内。',
  inputSchema: {
    language: z.enum(['ja', 'en', 'zh']).optional()
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('list_community_buses', args, listCommunityBuses));

// get_operator_routes
server.registerTool('get_operator_routes', {
  title: 'Get Operator Routes',
  description: '事業者別路線一覧 - 指定事業者の全路線と駅を表示（例: tokyometro, jreast, mir, twr, yurikamome, toden）。',
  inputSchema: {
    operator_name: z.string().describe('事業者キー'),
    language: z.enum(['ja', 'en', 'zh']).optional()
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('get_operator_routes', args, getOperatorRoutes));

// search_flight
server.registerTool('search_flight', {
  title: 'Search Flight',
  description: '✈️ 空港フライト時刻・到着時刻表示 - 羽田/成田等の空港または便名で到着/出発フライトを検索。destination 指定で到着ターミナル→目的地のアクセス経路を自動提案。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    airport: z.string().optional().describe('空港名またはIATAコード（例: 羽田空港, 成田空港, HND, NRT）'),
    flight_number: z.string().optional().describe('便名（例: NH001, JL000）'),
    direction: z.enum(['arrival', 'departure']).optional().describe('到着(arrival)または出発(departure)。省略時は到着。'),
    flight_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('フライト日付 YYYY-MM-DD（省略時は当日）'),
    airline: z.string().optional().describe('航空会社IATAコード（任意・絞り込み）'),
    destination: z.string().optional().describe('到着時の連携先（例: 東京駅）。指定すると到着ターミナル→目的地のアクセス経路を提案。'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は空港名/便名から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('search_flight', args, searchFlight));

// search_fare
server.registerTool('search_fare', {
  title: 'Search Fare',
  description: '🚃 運賃検索 - 2駅間の運賃をODPTデータから検索します（東京メトロ・都営対応）。サーバー内で運賃を直接返します。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    from: z.string().describe('出発駅'),
    to: z.string().describe('到着駅'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は駅名から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('search_fare', args, searchFare));

// get_timetable
server.registerTool('get_timetable', {
  title: 'Get Timetable',
  description: '🕐 時刻表検索 - 指定駅の時刻表をODPTデータから検索します。直接時刻を提供します。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    station_name: z.string().describe('駅名'),
    railway: z.string().optional().describe('路線名（省略可）'),
    calendar: z.enum(['Weekday', 'SaturdayHoliday', '平日', '土休日']).optional().describe('対象カレンダー（省略時は検索日/当日の曜日で自動判定。土日=SaturdayHoliday）'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('検索日 YYYY-MM-DD（省略時は当日。calendar 未指定時の曜日判定に使用）'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は駅名から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('get_timetable', args, getTimetable));

// search_bus
server.registerTool('search_bus', {
  title: 'Search Bus',
  description: '🚌🚃 バス路線・乗り継ぎ・横断乗り継ぎ検索 - バス停/系統を検索、from+to でバス→電車→バスの乗り継ぎ経路を探索。ノンステップバス情報を含む。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    busstop_name: z.string().optional().describe('バス停名（部分一致・バス停検索モード）'),
    from: z.string().optional().describe('出発バス停名（乗り継ぎ検索モード: to と共に指定・バス→電車→バスも可）'),
    to: z.string().optional().describe('到着バス停名（乗り継ぎ検索モード: from と共に指定）'),
    vehicle: z.enum(['bus', 'train', 'community_bus', 'ferry', 'any']).optional().describe('優先する乗り物（乗り継ぎ検索モードのみ）。bus=バス優先, train=電車優先, community_bus=コミュニティバス優先, ferry=水上バス優先, any=自動（最短）。指定乗り物が極端に遠回りになる場合は better_alternative でより良い経路を進言。'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時はバス停名から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('search_bus', args, searchBus));

// get_running_status
server.registerTool('get_running_status', {
  title: 'Get Running Status',
  description: '🚦 リアルタイム運行状況検索 - 指定事業者（または全事業者）の列車運行状況を公式ページから取得し、路線別ステータス（平常運転/遅延/一部運休/運転見合わせ）で返す。operator 指定で絞り込み、省略/ all で全事業者。language（ja/en/zh）指定で応答言語を強制可能。',
  inputSchema: {
    operator: z.string().optional().describe('事業者キー（例: jreast, tokyometro, tobu。省略 or all で全事業者）'),
    language: z.enum(['ja', 'en', 'zh']).optional().describe('応答言語の強制指定（省略時は operator から自動判定）')
  },
  annotations: DEFAULT_TOOL_ANNOTATIONS
}, (args) => runTool('get_running_status', args, getRunningStatus));

export { server, searchRoute, searchFare, getWeather, getTimetable, searchBus, getStationInfo, listTransitOperators, listCommunityBuses, getOperatorRoutes, listFerryPorts, searchFerry, detectLanguage, resolveLang, parseTestMode, computeRoutes, findShortestPath, resolveStation, searchFlight, translateTrainInfoDetail, translateWeather, detectFailureType, buildTestAdvice, STATION_TO_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES, calculateFlightDelayMinutes, parseCsvLine, validateFlightDate, normalizeAirportIata, gtfsFetchDates, getRunningStatus };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('index.mjs'))) {
  main().catch(error => { console.error('Failed to start server:', error); process.exit(1); });
}