/**
 * 天気・AI天気アドバイス（モノリス分割 Phase 4a）
 * 依存: config / data/misc / lib/lang / lib/common
 */
import { jmaBreaker, cache } from '../config.mjs';
import { MULTILINGUAL_ADVICE, JMA_AREA_MAP, JMA_AREA_LABELS } from '../data/misc.mjs';
import { resolveLang, detectLanguage, translateWeather } from '../lib/lang.mjs';
import { jsonResponse, buildErrorResponse } from '../lib/common.mjs';
import axios from 'axios';

export async function getWeatherAdvice(userLang, areaCode = '130000') {
  if (!jmaBreaker.canExecute()) {
    const err = new Error('JMA_API_UNAVAILABLE');
    err.code = 'JMA_UNAVAILABLE';
    throw err;
  }
  const cacheKey = `${cache.jmaWeather.key}:${areaCode}`;
  const cached = cache.get(cacheKey);
  let weather, windText = '', waveText = '', isRainy = false, isHot = false, isSevere = false, isSpecial = false, isSevereWind = false, isHighWave = false, maxTemp = 0;
  if (cached) { weather = cached.weather; windText = cached.windText || ''; waveText = cached.waveText || ''; isRainy = cached.isRainy; isHot = cached.isHot; isSevere = cached.isSevere || false; isSpecial = cached.isSpecial || false; isSevereWind = cached.isSevereWind || false; isHighWave = cached.isHighWave || false; }
  else {
    const response = await axios.get(`https://www.jma.go.jp/bosai/forecast/data/forecast/${areaCode}.json`, { timeout: 15000 });
    const area = response.data[0].timeSeries[0].areas[0];
    weather = area.weathers[0];
    windText = area.winds?.[0] || '';
    waveText = area.waves?.[0] || '';
    isRainy = weather.includes("雨") || weather.includes("雪");
    // #89: 強風・高波・特別警報を予報文（winds/waves）から検出
    const sev = parseSevereWeather(weather, windText, waveText);
    isSevere = sev.isSevere;      // 荒天全体（アドバイス昇格用）
    isSpecial = sev.isSpecial;    // 特別警報・津波（経路抑止用）
    isSevereWind = sev.isSevereWind;
    isHighWave = sev.isHighWave;
    for (const ts of response.data[0]?.timeSeries || []) {
      if (ts.areas?.[0]?.temps) { maxTemp = Math.max(...ts.areas[0].temps.map(t => parseInt(t) || 0)); if (maxTemp >= 33) isHot = true; }
    }
    cache.set(cacheKey, { weather, windText, waveText, isRainy, isHot, isSevere, isSpecial, isSevereWind, isHighWave }, cache.jmaWeather.ttl);
    jmaBreaker.onSuccess();
  }
  // #89: 荒天（強風・高波・特別警報）は typhoon 系アドバイスに昇格
  const adviceKey = isSevere ? 'typhoon' : (isHot ? 'hot' : (isRainy ? 'rainy' : 'fair'));
  const advice = (MULTILINGUAL_ADVICE[adviceKey] && (MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja)) || '';
  return { advice, weather, windText, waveText, isRainy, isHot, isSevere, isSpecial, isSevereWind, isHighWave, maxTemp: maxTemp || undefined };
}

// #89: 予報文（weather/winds/waves）から強風・高波・特別警報を検出
export function parseSevereWeather(weatherText = '', windText = '', waveText = '') {
  const isSevereWind = /非常に強く|猛烈/.test(windText || '');
  // 🔴 JMA の waves は全角数字（「２．５メートル」）のため、半角化してから波高をパースする
  const waveNorm = (waveText || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/．/g, '.');
  const m = waveNorm.match(/(\d+(?:\.\d+)?)\s*(?:メートル|m)/g);
  const maxWave = m ? Math.max(...m.map(x => parseFloat(x))) : 0;
  const isHighWave = maxWave >= 2.5;
  const isSpecial = /特別警報|大雨特別|大雪特別|津波/.test(weatherText || '');
  return { isSevereWind, maxWave, isHighWave, isSpecial, isSevere: isSpecial || isSevereWind || isHighWave };
}

// #88: 駅名・地域名 → JMA 地域コード（JMA_AREA_MAP に主要駅・県を登録済み）
export function stationToJmaArea(name) {
  const raw = (name || '').trim();
  if (raw && JMA_AREA_MAP[raw]) return JMA_AREA_MAP[raw];
  const norm = raw.replace(/駅$/, '');
  if (norm !== raw && JMA_AREA_MAP[norm]) return JMA_AREA_MAP[norm];
  return '130000'; // デフォルト: 東京
}

export async function getWeather(args) {
  const rawArea = args.area_name || '';
  const userLang = resolveLang(args) || detectLanguage(rawArea) || 'ja';
  let areaCode = '130000', areaName = rawArea || "東京";
  if (rawArea && JMA_AREA_MAP[rawArea]) areaCode = JMA_AREA_MAP[rawArea];
  if (!jmaBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', '気象庁APIが利用できません。', { userLang, area: areaName, breakerName: jmaBreaker.name, breakerState: jmaBreaker.state }));
  try {
    const { advice, weather, windText, waveText, isHot, isSevere, maxTemp } = await getWeatherAdvice(userLang, areaCode);
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
