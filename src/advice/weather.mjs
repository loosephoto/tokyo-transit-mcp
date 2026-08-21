/**
 * 天気・AI天気アドバイス（モノリス分割 Phase 4a）
 * 依存: config / data/misc / lib/lang / lib/common
 */
import { jmaBreaker, cache } from '../config.mjs';
import { MULTILINGUAL_ADVICE, JMA_AREA_MAP, JMA_AREA_LABELS, PLACE_MUNICIPALITY, PLACE_SUBAREA } from '../data/misc.mjs';
import { STATION_COORDS } from '../data/railway-lines.mjs';
import { STATION_COORDS_EXTRA } from '../data/station-coords-extra.mjs';
import { PREFECTURE_BOUNDS } from '../data/prefecture-bounds.mjs';
import { resolveLang, detectLanguage, translateWeather } from '../lib/lang.mjs';
import { jsonResponse, buildErrorResponse } from '../lib/common.mjs';
import axios from 'axios';

// #96: 座標→府県 自動解決。駅名は手動辞書（JMA_AREA_MAP）より先に検索するのではなく、
// 座標を持つ駅を point-in-polygon で府県（JIS→JMA府県コード）へ解決する。
// STATION_COORDS（主要駅・フェリー港）と STATION_COORDS_EXTRA（ODPT geo + JR検証済み駅）を統合。
const COORD_LOOKUP = {};
for (const [k, v] of Object.entries(STATION_COORDS)) COORD_LOOKUP[k] = [v.lat, v.lon];
Object.assign(COORD_LOOKUP, STATION_COORDS_EXTRA);

// point-in-polygon（レイキャスティング）。ring = [[lon,lat],...]
function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// 座標 → JMA府県予報区コード（JIS府県コード×10000）。島などポリゴン外は null。
export function prefectureCodeFromCoords(lat, lon) {
  for (const f of PREFECTURE_BOUNDS) {
    if (f.rings.some(r => pointInPolygon(lon, lat, r))) return String(f.code).padStart(2, '0') + '0000';
  }
  return null;
}

// #96: 駅名 → 座標 → 府県コード（自動解決）。該当なしは null。
function jmaCodeFromStationCoords(name) {
  const raw = (name || '').trim();
  if (!raw) return null;
  const c = COORD_LOOKUP[raw] || COORD_LOOKUP[raw.replace(/駅$/, '')];
  return c ? prefectureCodeFromCoords(c[0], c[1]) : null;
}

export async function getWeatherAdvice(userLang, areaCode = '130000', subAreaCode = null) {
  if (!jmaBreaker.canExecute()) {
    const err = new Error('JMA_API_UNAVAILABLE');
    err.code = 'JMA_UNAVAILABLE';
    throw err;
  }
  const cacheKey = `${cache.jmaWeather.key}:${areaCode}:${subAreaCode || 'default'}`;
  const cached = cache.get(cacheKey);
  let weather, windText = '', waveText = '', isRainy = false, isHot = false, isSevere = false, isSpecial = false, isSevereWind = false, isHighWave = false, maxTemp = 0, areaRegionName = '';
  if (cached) {
    weather = cached.weather; windText = cached.windText || ''; waveText = cached.waveText || '';
    isRainy = cached.isRainy; isHot = cached.isHot; isSevere = cached.isSevere || false;
    isSpecial = cached.isSpecial || false; isSevereWind = cached.isSevereWind || false; isHighWave = cached.isHighWave || false;
    areaRegionName = cached.areaRegionName || ''; maxTemp = cached.maxTemp || 0;
  }
  else {
    // #93: JMA API 呼び出しの失敗を jmaBreaker に必ず通知する。
    // 従来は getWeatherAdvice / search-route のどちらの呼び出し元でも例外が
    // 握り潰されるか無視され、失敗カウントが増えず jmaBreaker が機能しなかった。
    // さらに HTTP取得（axios.get）だけでなく、その後の JSON パース（data[0].timeSeries 等）も
    // 同一の try 内で処理し、200 OK だが不正な構造（マラフォームドな JSON や配列外アクセス）の
    // 例外も jmaBreaker.onFailure に通知して API 障害として数える。
    try {
      const response = await axios.get(`https://www.jma.go.jp/bosai/forecast/data/forecast/${areaCode}.json`, { timeout: 15000 });
      // 🔴 #93: 府県 JSON 内の一次細分区域（伊豆諸島北部等）を subAreaCode で選択。無ければ先頭区域（東京地方等）を使用。
      const allAreas = response.data[0]?.timeSeries?.[0]?.areas || [];
      const area = (subAreaCode && allAreas.find(a => a.area?.code === subAreaCode)) || allAreas[0];
      areaRegionName = area?.area?.name || '';
      weather = area?.weathers?.[0];
      windText = area?.winds?.[0] || '';
      waveText = area?.waves?.[0] || '';
      if (!weather) throw new Error(`JMA forecast area not found for ${areaCode}${subAreaCode ? `/${subAreaCode}` : ''}`);
      // JMA天気文の全角スペース整形: 複合句（例: 「雨　で　雷を伴い　激しく　降る」）が
      // スペースで分断されると translateWeather の最長一致辞書が効かない。
      // 複合句の構成語（で/を伴い/激しく/降る 等）の前後の全角スペースのみ除去し、
      // それ以外の全角スペースは半角スペース化して可読性を保つ。
      {
        // 複合句候補「雨/雪 で 雷を伴い 激しく 降る」パターンを一括結合
        let t = weather.replace(/(雨|雪)(\u3000+)で(\u3000+)雷を伴い(\u3000+)激しく(\u3000+)降る/g, '$1で雷を伴い激しく降る')
                       .replace(/(雨|雪)(\u3000+)で(\u3000+)雷を伴い/g, '$1で雷を伴い');
        t = t.split('\u3000').join(' ');
        weather = t;
      }
      isRainy = weather.includes("雨") || weather.includes("雪");
      // #89: 強風・高波・特別警報を予報文（winds/waves）から検出。
      // #93: 警報・注意報の概況文（response.data[0].text）も突合して特別警報検出を強化。
      const sev = parseSevereWeather(weather, windText, waveText, response.data[0]?.text || '');
      isSevere = sev.isSevere;      // 荒天全体（アドバイス昇格用）
      isSpecial = sev.isSpecial;    // 特別警報・津波（経路抑止用）
      isSevereWind = sev.isSevereWind;
      isHighWave = sev.isHighWave;
      for (const ts of response.data[0]?.timeSeries || []) {
        if (ts.areas?.[0]?.temps) { maxTemp = Math.max(...ts.areas[0].temps.map(t => parseInt(t) || 0)); if (maxTemp >= 33) isHot = true; }
      }
      // 🔴 #94/#95: maxTemp もキャッシュに保存・復元する。
      // 従来は maxTemp をキャッシュ保存せず、キャッシュヒット時に max_temp が応答から消えていた。
      cache.set(cacheKey, { weather, windText, waveText, isRainy, isHot, isSevere, isSpecial, isSevereWind, isHighWave, areaRegionName, maxTemp }, cache.jmaWeather.ttl);
      jmaBreaker.onSuccess();
    } catch (error) {
      jmaBreaker.onFailure(error);
      throw error;
    }
  }
  // #89: 荒天（強風・高波・特別警報）は typhoon 系アドバイスに昇格
  const adviceKey = isSevere ? 'typhoon' : (isHot ? 'hot' : (isRainy ? 'rainy' : 'fair'));
  const advice = (MULTILINGUAL_ADVICE[adviceKey] && (MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja)) || '';
  return { advice, weather, windText, waveText, isRainy, isHot, isSevere, isSpecial, isSevereWind, isHighWave, areaRegionName, maxTemp: maxTemp || undefined };
}

// #89: 予報文（weather/winds/waves）から強風・高波・特別警報を検出
// #93: 概況文（overviewText = 府県 JSON の text フィールド）も受け取り、特別警報・津波検出を警報・注意報情報と突合して強化。
export function parseSevereWeather(weatherText = '', windText = '', waveText = '', overviewText = '') {
  // #93: 強風検出表現を拡張（「風が強く」「強い風」「強風」等）。JMA 予報文で風が強まる表現を捕捉する。
  const isSevereWind = /非常に強く|猛烈|風が強く|強い風|強風|非常に強い/.test(windText || '');
  // 🔴 JMA の waves は全角数字（「２．５メートル」）のため、半角化してから波高をパースする
  const waveNorm = (waveText || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/．/g, '.');
  const m = waveNorm.match(/(\d+(?:\.\d+)?)\s*(?:メートル|m)/g);
  const maxWave = m ? Math.max(...m.map(x => parseFloat(x))) : 0;
  const isHighWave = maxWave >= 2.5;
  // #93: 概況文（警報・注意報の文章）とも突合して特別警報・津波・記録的短時間大雨を検出
  const combined = `${weatherText || ''} ${overviewText || ''}`;
  const isSpecial = /特別警報|大雨特別|大雪特別|津波|記録的短時間大雨|暴風特別|高潮特別/.test(combined);
  return { isSevereWind, maxWave, isHighWave, isSpecial, isSevere: isSpecial || isSevereWind || isHighWave };
}

// #88: 駅名・地域名 → JMA 予報区コード（府県コード。JMA_AREA_MAP に主要駅・県を登録済み）
export function stationToJmaArea(name) {
  const raw = (name || '').trim();
  if (raw && JMA_AREA_MAP[raw]) return JMA_AREA_MAP[raw];
  const norm = raw.replace(/駅$/, '');
  if (norm !== raw && JMA_AREA_MAP[norm]) return JMA_AREA_MAP[norm];
  // 🔴 #93: PLACE_MUNICIPALITY に駅名があれば、その自治体名（例: 上野→台東区）から県コードを解決。
  // これにより「上野」などの都内駅が東京（130000）に正しく解決される。
  const muniEntry = PLACE_MUNICIPALITY[raw] || PLACE_MUNICIPALITY[norm];
  if (muniEntry) {
    const muniKey = muniEntry.ja.replace(/区$/, '');
    if (JMA_AREA_MAP[muniKey]) return JMA_AREA_MAP[muniKey];
  }
  // 🔴 #96: 手動辞書に無い駅名は座標→point-in-polygonで府県を自動解決（東京縮退を防止）。
  const coordCode = jmaCodeFromStationCoords(raw) || jmaCodeFromStationCoords(norm);
  if (coordCode) return coordCode;
  return '130000'; // デフォルト: 東京
}

// #93: 駅名・場所 → 自治体名ラベル（3言語）。該当なしは null
export function placeToMunicipality(name) {
  const raw = (name || '').trim();
  const norm = raw.replace(/駅$/, '');
  const key = PLACE_MUNICIPALITY[raw] ? raw : (PLACE_MUNICIPALITY[norm] ? norm : null);
  return key ? PLACE_MUNICIPALITY[key] : null;
}

// #93: 駅名・場所 → JMA 一次細分区域コード（伊豆諸島・小笠原の島）。該当なしは null
export function placeToSubarea(name) {
  const raw = (name || '').trim();
  return PLACE_SUBAREA[raw] || PLACE_SUBAREA[raw.replace(/駅$/, '')] || null;
}

export async function getWeather(args) {
  const rawArea = args.area_name || '';
  const userLang = resolveLang(args) || detectLanguage(rawArea) || 'ja';
  // 🔴 #93: stationToJmaArea 経由で府県予報区コードを解決（無効な区・市コードを使わない）
  const areaCode = stationToJmaArea(rawArea);
  const areaName = rawArea || "東京";
  if (!jmaBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', '気象庁APIが利用できません。', { userLang, area: areaName, breakerName: jmaBreaker.name, breakerState: jmaBreaker.state }));
  try {
    // 🔴 #93: 一次細分区域（伊豆諸島・小笠原の島）を選択。区域名（東京地方等）も取得。
    const subArea = placeToSubarea(rawArea);
    const { advice, weather, windText, waveText, isHot, isSevere, maxTemp, areaRegionName } = await getWeatherAdvice(userLang, areaCode, subArea);
    // #93: 駅名指定時は「上野（台東区）」のように自治体名を併記。「渋谷」→「渋谷区」等は自治体名のみ表示。
    const muni = placeToMunicipality(rawArea);
    const muniLabel = muni ? (muni[userLang] || muni.ja) : null;
    let displayArea;
    if (muniLabel) {
      const inputShort = rawArea.replace(/駅$/, '').replace(/区$/, '');
      const muniShort = muniLabel.replace(/区$/, '');
      // 自治体名そのもの（例: 横浜）は、多言語ラベルだけを表示する。
      // 駅名（例: 渋谷駅）は駅名と自治体名を併記する。
      displayArea = inputShort === muniShort || inputShort === (muni.ja || '').replace(/区$/, '')
        ? muniLabel
        : `${inputShort}（${muniLabel}）`;
    } else {
      // 🔴 #79: 地域表示を東京固定にしない。エリアコード 3言語ラベルを基本に表示。
      // 🔴 #93: 島（PLACE_SUBAREA 指定）は区域名（伊豆諸島北部等）を表示。それ以外は県ラベルを表示し、区域名は region フィールドで提供。
      const areaLabel = JMA_AREA_LABELS[areaCode];
      const label = (areaLabel && areaLabel[userLang]) || areaName;
      displayArea = subArea ? (areaRegionName || label) : label;
    }
    return jsonResponse({
      status: "SUCCESS",
      // AIインテリジェントアドバイスを先頭に配置（LLMが後半を省略しないよう）
      ai_transit_advice: advice,
      detected_language: userLang,
      area: displayArea,
      area_code: areaCode,
      region: areaRegionName || undefined,
      weather: translateWeather(weather, userLang),
      // #89: 風・波・荒天情報を明示（強風・高波・特別警報の検出結果）
      wind: windText ? translateWeather(windText, userLang) : undefined,
      wave: waveText ? translateWeather(waveText, userLang) : undefined,
      is_severe_weather: isSevere || undefined,
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
