/**
 * フェリー・水上バス・津波安全ハンドラ（モノリス分割 Phase 4b-2）
 * 依存: config / data/ferry-ports / data/misc / lib / advice（一方通行）
 */
import { cache, odptBreaker, jmaBreaker, API_BASE_URL, API_KEY } from '../config.mjs';
import { FERRY_PORT_MAP, FERRY_PORT_NAMES, FERRY_GTFS_SOURCES, FERRY_PORT_TSUNAMI_AREAS } from '../data/ferry-ports.mjs';
import { MULTILINGUAL_ADVICE } from '../data/misc.mjs';
import { getParams, jsonResponse, buildErrorResponse } from '../lib/common.mjs';
import { parseCsvRecords } from '../lib/csv.mjs';
import { gtfsFetchDates, normalizeOvernightTime } from '../lib/time.mjs';
import { fetchGtfsZipBuffer } from '../lib/gtfs.mjs';
import { resolveLang, detectLanguage, getDisplayStationName, translateWeather } from '../lib/lang.mjs';
import { parseTestMode, buildTestAdvice, getTransitAdvice, detectFailureType } from '../advice/transit-advice.mjs';
import { isEarthquakeSimulation, buildEarthquakeSafetyResponse, buildEarthquakeTransportSafety, getGroundEmergencyShelters } from '../advice/earthquake.mjs';
import { getWeatherAdvice, stationToJmaArea, placeToSubarea } from '../advice/weather.mjs';
import axios from 'axios';

export async function fetchFerryData() {
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

export function normalizeFerryPortName(name) {
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

export async function listFerryPorts(args) {
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

export const JMA_TSUNAMI_LIST_URL = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
const JMA_TSUNAMI_DETAIL_BASE_URL = 'https://www.jma.go.jp/bosai/tsunami/data/';

export function isActiveTsunamiWarning(kind) {
  const text = String(kind || '');
  return /大津波警報|津波警報|津波注意報|Major Tsunami Warning|Tsunami Warning|Tsunami Advisory/i.test(text)
    && !/解除|No Tsunami/i.test(text);
}

export async function fetchJmaTsunamiSafety() {
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

export function getTsunamiAreasForPorts(...ports) {
  return [...new Set(ports.flatMap(p => FERRY_PORT_TSUNAMI_AREAS[p] || []))];
}

export function isTsunamiRelevantToPorts(tsunami, ...ports) {
  // 安全情報を取得できない場合は「警報なし」とみなさず、安全側で航路を停止する。
  if (tsunami?.available === false) return true;
  if (!tsunami.active) return false;
  const portAreas = getTsunamiAreasForPorts(...ports);
  // 港の予報区が未登録なら、安全側で有効な津波警報を航路停止対象とする。
  if (!portAreas.length) return true;
  return tsunami.areas.some(a => portAreas.some(pa => a.name.includes(pa) || pa.includes(a.name)));
}

export async function buildTsunamiWaterSafetyResponse(userLang, tsunami, context = {}) {
  const safetyUnavailable = tsunami?.available === false;
  const safety = buildEarthquakeTransportSafety('water', userLang);
  const advisory = safetyUnavailable
    ? (userLang === 'en'
      ? 'Maritime safety information is unavailable. Water-route guidance is suspended. Check JMA, the port authority, and the operator, then retry later.'
      : userLang === 'zh'
        ? '无法获取水上安全信息，已暂停水路出行。请确认气象厅、港口管理者和运营公司官方信息，稍后重试。'
        : '安全判定に必要な情報を取得できないため、航路案内を停止しています。気象庁・港湾管理者・運航会社の公式情報を確認し、後ほど再試行してください。')
    : (userLang === 'en'
      ? 'An active tsunami warning/advisory affects this water-transport area. Do not board or continue water travel.'
      : userLang === 'zh'
        ? '该水路区域受到有效海啸警报/注意报影响。请停止登船和水路出行。'
        : 'この水路地域に有効な津波警報・注意報が発表されています。乗船・水路移動を中止してください。');
  // 出発港側の自治体データから、津波対応の指定緊急避難場所だけを抽出する。
  const tsunamiShelters = await getGroundEmergencyShelters(context.from_port, 'tsunami', userLang);
  return jsonResponse({
    status: safetyUnavailable ? 'MARITIME_SAFETY_UNKNOWN' : 'EMERGENCY_MODE_ACTIVE',
    detected_language: userLang,
    emergency_type: safetyUnavailable ? 'maritime_safety_unknown' : 'tsunami',
    transport_mode: 'water',
    route_guidance_suspended: true,
    message: advisory,
    maritime_safety_status: {
      tsunami_warning_active: safetyUnavailable ? null : true,
      safety_check_available: !safetyUnavailable,
      weather_check_available: !safetyUnavailable,
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

// #90: 港の予報（winds/waves）から強風・高波を検出。暴風・高波レベルなら航路を返さず運航見合わせの可能性を案内する
export async function checkSevereWaterWeather(fromPort, toPort, userLang) {
  // 🔴 #93: 島港（大島・八丈島・父島等）は PLACE_SUBAREA で一次細分区域を選択しないと、
  // 府県の先頭区域（東京地方）の天気を見てしまい島の強風・高波を検出できない（実測で波3mを検出漏れ）。
  const ports = [...new Set([fromPort, toPort])];
  const results = await Promise.all(ports.map(p =>
    getWeatherAdvice(userLang, stationToJmaArea(p), placeToSubarea(p)).catch(() => null)
  ));
  const ok = results.filter(r => r && r.weather);
  // 港の気象情報を全く取得できない場合は、警報なしではなく判定不能。
  if (ok.length === 0) return { available: false, isSevereWind: false, isHighWave: false, wind: '', wave: '' };
  let isSevereWind = false, isHighWave = false, wind = '', wave = '';
  for (const r of ok) {
    isSevereWind = isSevereWind || r.isSevereWind;
    isHighWave = isHighWave || r.isHighWave;
    if (r.isSevereWind && !wind) wind = r.windText || '';
    if (r.isHighWave && !wave) wave = r.waveText || '';
  }
  if (!isSevereWind && !isHighWave) return { available: true, isSevereWind, isHighWave, wind, wave };
  return { available: true, isSevereWind, isHighWave, wind, wave };
}

export async function buildSevereWeatherWaterSafetyResponse(userLang, wind, wave, context = {}) {
  const unavailable = context.weather_check_available === false;
  const advisory = unavailable
    ? (userLang === 'en'
      ? 'Port weather information is unavailable. Water-route guidance is suspended. Check JMA, the port authority, and the operator, then retry later.'
      : userLang === 'zh'
        ? '无法获取港口天气信息，已暂停水路出行。请确认气象厅、港口管理者和运营公司官方信息，稍后重试。'
        : '港の気象情報を取得できないため、航路案内を停止しています。気象庁・港湾管理者・運航会社の公式情報を確認し、後ほど再試行してください。')
    : (userLang === 'en'
      ? 'Strong winds or high waves may suspend ferry operations. Do not board until the operator confirms safety.'
      : userLang === 'zh'
        ? '强风或大浪可能导致停航。请停止乘船，待航运公司确认安全后再出行。'
        : '強風・高波により運航見合わせの可能性があります。乗船は安全確認が取れるまでお控えください。');
  return jsonResponse({
    status: unavailable ? 'MARITIME_SAFETY_UNKNOWN' : 'SEVERE_WEATHER_ADVISORY',
    detected_language: userLang,
    emergency_type: unavailable ? 'maritime_safety_unknown' : 'severe_weather',
    transport_mode: 'water',
    route_guidance_suspended: true,
    message: advisory,
    maritime_safety_status: {
      tsunami_warning_active: unavailable ? null : false,
      wind_wave_warning_active: unavailable ? null : true,
      weather_check_available: !unavailable,
      safety_check_available: !unavailable,
      wind: wind ? translateWeather(wind, userLang) : undefined,
      wave: wave ? translateWeather(wave, userLang) : undefined,
      official_info_url: 'https://www.jma.go.jp/bosai/'
    },
    ai_transit_advice: MULTILINGUAL_ADVICE.typhoon?.[userLang] || MULTILINGUAL_ADVICE.typhoon?.ja || '',
    ...context
  });
}

export async function searchFerry(args) {
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
  // #90: -test 台風・高波・荒天・強風（typhoon / ferry_rough_seas）は、実天気が平穏でも
  // 強風・高波ゲートをシミュレーションして運航見合わせを返す（実測で -test 台風が水上バスに SUCCESS を返す不都合を修正）
  const typhoonLike = ['typhoon', 'ferry_rough_seas'];
  if (testAdv.failureAdviceKey && typhoonLike.includes(testAdv.failureAdviceKey)) {
    const live = await checkSevereWaterWeather(fromPort, toPort, userLang);
    return await buildSevereWeatherWaterSafetyResponse(userLang, live?.wind, live?.wave, {
      from_port: rawFrom, to_port: rawTo, weather_check_available: live?.available !== false,
      test_mode: true, simulated_failure_type: parsedTest.simulatedFailure
    });
  }
  // #90: 強風・高波ゲート（津波がなくても、荒天・高波で運航見合わせの可能性がある場合は抑止）
  const severeWaterWeather = await checkSevereWaterWeather(fromPort, toPort, userLang);
  if (severeWaterWeather?.available === false || severeWaterWeather?.isSevereWind || severeWaterWeather?.isHighWave) {
    return await buildSevereWeatherWaterSafetyResponse(userLang, severeWaterWeather.wind, severeWaterWeather.wave, {
      from_port: rawFrom, to_port: rawTo, weather_check_available: severeWaterWeather.available !== false
    });
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

    const waterBusPortPatterns = ['浅草','お台場海浜公園','お台場','豊洲','日の出桟橋','日の出','浜離宮'];
    const isWaterBus = waterBusPortPatterns.some(p =>
      fromStop.stop_name.includes(p) || toStop.stop_name.includes(p));
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
