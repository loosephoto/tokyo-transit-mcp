/**
 * 運賃検索ハンドラ（モノリス分割 Phase 4b-3）
 * 依存: config / data/misc / lib / advice / handlers/search-route（getStationRomanToJa）
 */
import { cache, odptBreaker, API_BASE_URL, API_KEY } from '../config.mjs';
import { OPERATOR_MAP, NON_RAIL_OPERATORS } from '../data/misc.mjs';
import { getParams, jsonResponse, buildErrorResponse } from '../lib/common.mjs';
import { resolveLang, detectLanguage, getDisplayStationName } from '../lib/lang.mjs';
import { getStationRomanToJa, normalizeStationName } from './search-route.mjs';
import { parseTestMode, buildTestAdvice, getTransitAdvice, detectFailureType } from '../advice/transit-advice.mjs';
import { isEarthquakeSimulation, buildEarthquakeSafetyResponse } from '../advice/earthquake.mjs';
import axios from 'axios';

export const FARE_STATION_NEGATIVE_TTL = 5 * 60 * 1000; // 取得成功・0件のみ 5分

export async function resolveFareStations(rawName) {
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

export const FARE_OPERATORS = ['TokyoMetro', 'Toei', 'MIR', 'TWR', 'Yurikamome', 'YokohamaMunicipal', 'TamaMonorail'];
// 路線図（OPERATOR_MAP / NON_RAIL_OPERATORS）にはあるが ODPT に運賃データがない事業者（JR・私鉄等）
const NON_FARE_OPERATORS = Object.values(OPERATOR_MAP)
  .concat(Object.values(NON_RAIL_OPERATORS).map(o => o.id))
  .filter((id, i, a) => a.indexOf(id) === i)
  .filter(id => !FARE_OPERATORS.includes(id));

export async function fetchFaresByFromStation(stationId) {
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

export async function searchFare(args) {
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

    // 同一事業者・同一運賃の重複を排除
    const seenFares = new Set();
    const uniqueFares = [];
    for (const f of results) {
      const op = f['odpt:operator']?.replace('odpt.Operator:', '') || 'Unknown';
      const ticket = f['odpt:ticketFare'] || f['odpt:childTicketFare'] || null;
      const ic = f['odpt:icCardFare'] || f['odpt:childIcCardFare'] || null;
      const key = `${op}:${ticket}:${ic}`;
      if (!seenFares.has(key)) {
        seenFares.add(key);
        uniqueFares.push({
          operator: op,
          ticket,
          ic,
          child_ticket: f['odpt:childTicketFare'] || null,
          child_ic: f['odpt:childIcCardFare'] || null
        });
      }
    }

    return jsonResponse({
      status: "SUCCESS", detected_language: userLang, from: displayFrom, to: displayTo,
      fare: cheapest.f ? {
        ticket: cheapest.f['odpt:ticketFare'] || cheapest.f['odpt:childTicketFare'] || null,
        ic: cheapest.f['odpt:icCardFare'] || cheapest.f['odpt:childIcCardFare'] || null,
        child_ticket: cheapest.f['odpt:childTicketFare'] || null,
        child_ic: cheapest.f['odpt:childIcCardFare'] || null
      } : null,
      fares: uniqueFares.slice(0, 5),
      data_source: noteText
    });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang, from, to });
  }
}
