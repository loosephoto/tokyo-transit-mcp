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
  let weather, isRainy = false, isHot = false, maxTemp = 0;
  if (cached) { weather = cached.weather; isRainy = cached.isRainy; isHot = cached.isHot; }
  else {
    const response = await axios.get(`https://www.jma.go.jp/bosai/forecast/data/forecast/${areaCode}.json`, { timeout: 15000 });
    weather = response.data[0].timeSeries[0].areas[0].weathers[0];
    isRainy = weather.includes("雨") || weather.includes("雪");
    for (const ts of response.data[0]?.timeSeries || []) {
      if (ts.areas?.[0]?.temps) { maxTemp = Math.max(...ts.areas[0].temps.map(t => parseInt(t) || 0)); if (maxTemp >= 33) isHot = true; }
    }
    cache.set(cacheKey, { weather, isRainy, isHot }, cache.jmaWeather.ttl);
    jmaBreaker.onSuccess();
  }
  const adviceKey = isHot ? 'hot' : (isRainy ? 'rainy' : 'fair');
  const advice = (MULTILINGUAL_ADVICE[adviceKey] && (MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja)) || '';
  return { advice, weather, isRainy, isHot, maxTemp: maxTemp || undefined };
}

export async function getWeather(args) {
  const rawArea = args.area_name || '';
  const userLang = resolveLang(args) || detectLanguage(rawArea) || 'ja';
  let areaCode = '130000', areaName = rawArea || "東京";
  if (rawArea && JMA_AREA_MAP[rawArea]) areaCode = JMA_AREA_MAP[rawArea];
  if (!jmaBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', '気象庁APIが利用できません。', { userLang, area: areaName, breakerName: jmaBreaker.name, breakerState: jmaBreaker.state }));
  try {
    const { advice, weather, isHot, maxTemp } = await getWeatherAdvice(userLang, areaCode);
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
