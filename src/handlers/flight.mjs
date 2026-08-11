/**
 * フライト検索ハンドラ（モノリス分割 Phase 4b-6）
 * 依存: config / data/misc（AIRPORT_*）/ lib / advice
 */
import { cache, odptBreaker, API_KEY, FLIGHT_API_KEY, FLIGHT_API_BASE } from '../config.mjs';
import { AIRPORT_IATA, AIRPORT_WEATHER_AREA, IATA_TO_TERMINAL_STATION, DEFAULT_ACCESS_DESTINATIONS,
         ODPT_FLIGHT_STATUS_MAP, ODPT_AIRLINE_NAMES, MULTILINGUAL_ADVICE } from '../data/misc.mjs';
import { getParams, jsonResponse, buildErrorResponse, handleApiError } from '../lib/common.mjs';
import { validateFlightDate } from '../lib/time.mjs';
import { resolveLang, detectLanguage, getDisplayStationName, getLineDisplayName, getDisplayLineName, translateWeather } from '../lib/lang.mjs';
import { parseTestMode, buildTestAdvice, getTransitAdvice, detectFailureType } from '../advice/transit-advice.mjs';
import { isEarthquakeSimulation } from '../advice/earthquake.mjs';
import { getWeatherAdvice } from '../advice/weather.mjs';
import { computeRoutes } from './search-route.mjs';
import axios from 'axios';

export function calculateFlightDelayMinutes(scheduled, actual) {
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

export function normalizeAirportIata(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) && ['HND', 'NRT', 'IBR'].includes(normalized) ? normalized : null;
}

export function normalizeAirportQuery(name) {
  if (!name) return name;
  return name.replace(/(第[1-3一二三]ターミナル|ターミナル|Terminal|航站楼|空港|Airport|机场)\s*$/i, '').trim();
}

export function odpIdSuffix(id, prefix) {
  if (!id) return null;
  const s = String(id);
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

export function normalizeOdpFlight(f, direction, userLang) {
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

export async function fetchFlightsOdp(params) {
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

export async function fetchFlights(params) {
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

export function normalizeFlight(f, direction, userLang) {
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

export async function searchFlight(args) {
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
