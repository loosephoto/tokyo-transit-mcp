/**
 * API 共通ユーティリティ（モノリス分割 Phase 4 準備）
 * getParams / buildErrorResponse / jsonResponse / isRateLimitError / handleApiError。
 * 依存: config.mjs（API_KEY）のみ。
 */

import { API_KEY } from '../config.mjs';

export function buildErrorResponse(errorType, errorMessage, details = {}) {
  const timestamp = new Date().toISOString();
  const ERROR_META = {
    API_TIMEOUT: { httpCode: 408, retryable: true,
      suggestions: {
        ja: ["APIサーバーが混雑しています。数分後にもう一度お試しください。", "Yahoo!路線情報などの代替検索をご利用ください。"],
        en: ["The API server is busy. Please try again in a few minutes.", "Please use alternative services like Yahoo! Transit."],
        zh: ["API服务器繁忙，请几分钟后重试。", "请使用雅虎路线信息等替代搜索。"] },
      suggestionKey: "RETRY_LATER" },
    CIRCUIT_BREAKER_OPEN: { httpCode: 503, retryable: true,
      suggestions: {
        ja: ["現在ODPT APIが利用できません。サーキットブレイカーが作動中です。", "しばらく待ってから再度お試しください。"],
        en: ["ODPT API is currently unavailable. Circuit breaker is active.", "Please wait and try again later."],
        zh: ["ODPT API当前不可用。断路器已激活。", "请稍后再试。"] },
      suggestionKey: "CIRCUIT_OPEN" },
    NETWORK_ERROR: { httpCode: 502, retryable: false,
      suggestions: {
        ja: ["ネットワーク接続に問題が発生しました。", "Yahoo!路線情報の直接検索をご利用ください。"],
        en: ["A network connection error occurred.", "Please use Yahoo! Transit for direct search."],
        zh: ["发生网络连接错误。", "请使用雅虎路线信息直接搜索。"] },
      suggestionKey: "NETWORK_ISSUE" },
    PARSE_ERROR: { httpCode: 422, retryable: false,
      suggestions: {
        ja: ["APIからのデータ形式に問題があります。", "サーバー管理者に連絡してください。"],
        en: ["There is an issue with the API data format.", "Please contact the server administrator."],
        zh: ["API数据格式存在问题。", "请联系服务器管理员。"] },
      suggestionKey: "PARSE_ISSUE" },
    INVALID_INPUT: { httpCode: 400, retryable: false,
      suggestions: {
        ja: ["入力された駅名やクエリを確認してください。", "正しい駅名（例: 渋谷、新宿）を入力してください。"],
        en: ["Please check the station name or query entered.", "Enter a valid station name (e.g., Shibuya, Shinjuku)."],
        zh: ["请检查输入的站名或查询内容。", "请输入正确的站名（如：涩谷、新宿）。"] },
      suggestionKey: "CHECK_INPUT" },
    NO_ROUTE: { httpCode: 404, retryable: false,
      suggestions: {
        ja: ["指定された2駅間に接続ルートが見つかりませんでした。", "Yahoo!路線情報などの代替検索をご利用ください。"],
        en: ["No connecting route found between the specified stations.", "Please use alternative services like Yahoo! Transit."],
        zh: ["未找到指定两站之间的连接路线。", "请使用雅虎路线信息等替代搜索。"] },
      suggestionKey: "NO_ROUTE" },
    STATION_NOT_FOUND: { httpCode: 404, retryable: false,
      suggestions: {
        ja: ["指定された駅は経路検索データに含まれていません。", "別の駅名（例: 近隣の主要駅）をお試しください。"],
        en: ["The specified station is not in the routing data.", "Try another station name (e.g., a nearby major station)."],
        zh: ["指定车站不在路径搜索数据中。", "请尝试其他站名（如附近的主要车站）。"] },
      suggestionKey: "STATION_NOT_FOUND" },
    AMBIGUOUS_STATION: { httpCode: 300, retryable: false,
      suggestions: {
        ja: ["一致する駅が複数あるため、検索を中断しました。", "提示された候補から正しい駅を選択して再度お試しください。"],
        en: ["Multiple stations matched, so the search was paused.", "Please pick the correct station from the candidates and retry."],
        zh: ["匹配到多个车站，已暂停搜索。", "请从候补中选择正确的车站后重试。"] },
      suggestionKey: "AMBIGUOUS_STATION" },
    AMBIGUOUS_BUS_STOP: { httpCode: 300, retryable: false,
      suggestions: {
        ja: ["一致するバス停が複数あるため、検索を中断しました。", "提示された候補から正しいバス停を選択して再度お試しください。"],
        en: ["Multiple bus stops matched, so the search was paused.", "Please pick the correct bus stop from the candidates and retry."],
        zh: ["匹配到多个公交站，已暂停搜索。", "请从候补中选择正确的公交站后重试。"] },
      suggestionKey: "AMBIGUOUS_BUS_STOP" },
    API_AUTH_ERROR: { httpCode: 502, retryable: false,
      suggestions: {
        ja: ["交通APIの認証に失敗しました。APIキーを確認してください。"],
        en: ["Transit API authentication failed. Please check the API key."],
        zh: ["交通API认证失败，请检查API密钥。"] },
      suggestionKey: "API_AUTH" },
    API_SERVER_ERROR: { httpCode: 502, retryable: true,
      suggestions: {
        ja: ["交通APIサーバーで障害が発生しています。しばらくして再試行してください。"],
        en: ["The transit API server is unavailable. Please try again later."],
        zh: ["交通API服务器发生故障，请稍后重试。"] },
      suggestionKey: "API_SERVER" },
    UNKNOWN_ERROR: { httpCode: 500, retryable: false,
      suggestions: {
        ja: ["予期しないエラーが発生しました。", "もう一度お試しいただくか、管理者にお問い合わせください。"],
        en: ["An unexpected error occurred.", "Please try again or contact the administrator."],
        zh: ["发生意外错误。", "请重试或联系管理员。"] },
      suggestionKey: "UNKNOWN" }
  };
  const meta = ERROR_META[errorType] || ERROR_META.UNKNOWN_ERROR;
  const userLang = details.userLang || 'ja';
  const msg = details.msgLocale?.[userLang] || errorMessage;
  const suggestions = meta.suggestions[userLang] || meta.suggestions.ja;
  let fallbackUrl = null;
  if (details.from && details.to) {
    fallbackUrl = `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(details.from)}&to=${encodeURIComponent(details.to)}`;
  } else if (details.station) {
    fallbackUrl = `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(details.station)}`;
  } else if (details.area) {
    fallbackUrl = `https://www.jma.go.jp/bosai/forecast/`;
  }
  const response = { status: "ERROR", error_type: errorType, error_message: msg, error_code: meta.httpCode, timestamp, retryable: meta.retryable, suggestions, suggestion_key: meta.suggestionKey };
  if (fallbackUrl) response.fallback_url = fallbackUrl;
  if (details.from) response.from = details.from;
  if (details.to) response.to = details.to;
  if (details.station) response.station = details.station;
  if (details.api) response.api = details.api;
  if (details.area) response.area = details.area;
  if (details.breakerName) response.breaker_name = details.breakerName;
  if (details.breakerState) response.breaker_state = details.breakerState;
  if (details.http_status !== undefined) response.http_status = details.http_status;
  if (details.internal !== undefined) response.internal = details.internal;
  if (details.disambiguation) response.disambiguation = details.disambiguation;
  return response;
}

export function jsonResponse(data, options = {}) {
  // 🔴 #101: エラー応答には isError: true を付与する。
  // buildErrorResponse は status: 'ERROR' を返すため、それを検知して MCP クライアントに
  // ツール失敗を伝える。これを付けないと失敗が「成功」として扱われてしまう（致命的）。
  // options.isError で明示上書きも可能。成功応答（status が 'ERROR' 以外・無し）は isError を付けない。
  const isError = options.isError === undefined
    ? (data && typeof data === 'object' && data.status === 'ERROR')
    : options.isError;
  // ✅ #122: options.displayText 指定時、content は「表示済みマークダウンの単一テキスト」にする。
  // ホストLLMがJSONを再構成して要約・省略するのを防ぎ、運行障害時の安全情報
  // （運転見合わせ・緊急避難・振替輸送など）を原文のまま確実にユーザーへ届ける。
  // 機械向けJSONは structuredContent に維持する。
  if (options.displayText && typeof options.displayText === 'string' && options.displayText) {
    return {
      content: [{ type: 'text', text: options.displayText }],
      structuredContent: data,
      ...(isError ? { isError: true } : {})
    };
  }
  // ai_transit_advice が含まれる場合、それを独立したテキストブロックとして最初に配置。
  // LLM が長い JSON を要約する際に後半を省略してしまうのを防ぐため。
  if (data && typeof data === 'object' && typeof data.ai_transit_advice === 'string' && data.ai_transit_advice) {
    const { ai_transit_advice, ...rest } = data;
    return {
      content: [
        { type: 'text', text: ai_transit_advice },
        { type: 'text', text: JSON.stringify(rest, null, 2) }
      ],
      // 🔴 #94: structuredContent には ai_transit_advice も含めて公開する。
      // MCPクライアントが structuredContent のみを参照する実装でも
      // AIインテリジェントアドバイスが失われないようにする（従来は除外されていた）。
      structuredContent: data,
      ...(isError ? { isError: true } : {})
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {})
  };
}

export const getParams = (operator, additionalParams = {}) => {
  const params = { 'acl:consumerKey': API_KEY, ...additionalParams };
  if (operator) params['odpt:operator'] = `odpt.Operator:${operator}`;
  return params;
};

export function isRateLimitError(error) { return error?.response?.status === 429 || (error?.message || '').includes('429'); }

// プログラム内部エラー（実装バグ）とネットワーク/API起因の一時障害を区別する。
// 内部エラーは再試行しても治らないため、サーキットブレイカーの失敗カウントに加算すべきではない
// （API障害と誤診断して早く OPEN にすると #91 の再発）。handleApiError と各ハンドラの catch で共用する。
export function isInternalError(error) {
  return error instanceof ReferenceError || error instanceof TypeError
    || error instanceof RangeError || error instanceof SyntaxError
    || (error instanceof Error && /is not (defined|a function)|undefined is not an object/.test(error.message));
}

export function handleApiError(error, details = {}) {
  if (isRateLimitError(error)) {
    return jsonResponse(buildErrorResponse('API_TIMEOUT', 'APIレート制限に達しました。しばらく待ってから再試行してください。', { ...details, retryable: true }));
  }
  // プログラム内部エラー（ReferenceError/TypeError/RangeError/SyntaxError 等）は、ネットワーク起因の
  // 一時障害ではなく実装バグの可能性が高いため、NETWORK_ERROR に化けさせず UNKNOWN_ERROR
  // （retryable:false）として分類する。再試行を促す誤診断（#91）を防ぐ。
  const isInternal = isInternalError(error);
  const status = error?.response?.status;
  const errType = isInternal ? 'UNKNOWN_ERROR'
    : error.code === 'ECONNABORTED' ? 'API_TIMEOUT'
    : status === 401 || status === 403 ? 'API_AUTH_ERROR'
    : status >= 500 ? 'API_SERVER_ERROR'
    : 'NETWORK_ERROR';
  return jsonResponse(buildErrorResponse(errType, error.message || 'APIエラー', { ...details, internal: isInternal, http_status: status }));
}


export function buildGovFacilitySearchSupport(userLocation, userLang = 'ja', placeName = '') {
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
