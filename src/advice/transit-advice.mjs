/**
 * AIインテリジェントアドバイス（モノリス分割 Phase 4a）
 * -testモード解析・障害種別検知・AIアドバイス構築。
 * 依存: lib/lang / data/misc / advice/weather（getWeatherAdvice）
 */
import { detectLanguage } from '../lib/lang.mjs';
import { FAILURE_TYPES, MULTILINGUAL_ADVICE } from '../data/misc.mjs';
import { getWeatherAdvice } from './weather.mjs';

export function parseTestMode(args) {
  const from = (args && args.from) || '';
  const to = (args && args.to) || '';
  // 別パラメータ形式も対応: args['-test'] / args.test / args.test_mode
  const explicitTest = args && (args['-test'] || args.test || args.test_mode);
  const combined = (from + ' ' + to).trim();
  const testMatch = combined.match(/-+\s*test\s*-*/i);
  if (testMatch) {
    const beforeTest = combined.split(/-+\s*test\s*-*/i)[0].trim();
    const afterTest = combined.split(/-+\s*test\s*-*/i)[1]?.trim() || '';
    const stationParts = beforeTest.split(/\s+/);
    return {
      from: stationParts[0] || args.from,
      to: stationParts[1] || args.to,
      simulatedFailure: afterTest.split(/\s+/)[0] || '台風'
    };
  }
  if (explicitTest) {
    // 自然言語入力から from/to を抽出（「から」「到」「→」等の区切り）
    const extracted = extractStationsFromNaturalLanguage(combined);
    return {
      from: extracted.from || from,
      to: extracted.to || to,
      simulatedFailure: String(explicitTest).trim() || '台風'
    };
  }
  return { from: args.from, to: args.to, simulatedFailure: null };
}

export function extractStationsFromNaturalLanguage(text) {
  if (!text) return { from: null, to: null };
  // 中国語: 从A到B / 查询从A到B的路线
  let m = text.match(/从\s*([^\s到]+)\s*到\s*([^\s的]+)/);
  if (m) return { from: m[1], to: m[2] };
  // 日本語: AからBまで / AからBへ
  m = text.match(/([^\sから]+)\s*から\s*([^\sまでへ]+)/);
  if (m) return { from: m[1], to: m[2] };
  // 英語: from A to B
  m = text.match(/from\s+([^\s]+)\s+to\s+([^\s]+)/i);
  if (m) return { from: m[1], to: m[2] };
  // 矢印/ハイフン区切り
  m = text.match(/([^\s→\-]+)\s*[→\-]\s*([^\s→\-]+)/);
  if (m) return { from: m[1], to: m[2] };
  return { from: null, to: null };
}

export function detectFailureType(failureText, userLang = 'ja') {
  if (!failureText) return null;
  const rawKey = failureText.trim().toLowerCase();
  const textLang = detectLanguage(rawKey); // テキスト自体の言語（ja/zh 共通キーワードの判別用）

  // マッチ優先度: ①完全一致 ②入力がキーワードを含む（入力の方が長い） ③キーワードが入力を含む（入力の方が短い）。
  // ③は「遅延」⊂「ゲート遅延」のような誤マッチの元なので最弱とする。
  // 同一優先度内では最長キーワードを優先（「人身事故が発生」→「事故」より「人身事故」）。
  let best = null, bestType = 3, bestLen = -1;
  for (const [id, config] of Object.entries(FAILURE_TYPES)) {
    for (const [lang, kwList] of Object.entries(config.keywords)) {
      for (const kw of kwList) {
        const lowerKw = kw.toLowerCase();
        const matchType = rawKey === lowerKw ? 0 : rawKey.includes(lowerKw) ? 1 : lowerKw.includes(rawKey) ? 2 : -1;
        if (matchType >= 0 && (matchType < bestType || (matchType === bestType && lowerKw.length > bestLen))) {
          bestType = matchType;
          bestLen = lowerKw.length;
          best = { id, config, lang };
        }
      }
    }
  }
  if (!best) {
    const fallbackMsg = {
      ja: rawKey + " のため一部列車が運行停止中",
      en: "Service partially suspended due to " + rawKey,
      zh: "因 " + rawKey + " 导致部分列车暂停运行"
    };
    return {
      type: 'unknown',
      isTrainSuspended: true,
      weatherText: userLang === 'en' ? "Disruption detected" : userLang === 'zh' ? "检测到交通故障" : "障害検知",
      delayMessage: fallbackMsg[userLang] || fallbackMsg.ja
    };
  }
  const { config, lang } = best;
  // 呼び出し側で解決済みの応答言語を最優先する。
  // 例: 「降雪」は中国語キーワード表にも存在するが、language:'ja' の詳細文まで
  // 中国語へ混在させてはならない。
  const effectiveMatchedLang = (textLang !== 'ja') ? textLang : lang;
  const effectiveLang = userLang || effectiveMatchedLang;
  const weatherText = typeof config.weatherText === 'object'
    ? (config.weatherText[effectiveLang] || config.weatherText.ja)
    : config.weatherText;
  const delayMessage = typeof config.delayMessage === 'object'
    ? (config.delayMessage[effectiveLang] || config.delayMessage.ja)
    : config.delayMessage;
  return {
    ...config,
    matchedLang: effectiveMatchedLang,
    weatherText,
    delayMessage
  };
}

export function buildTestAdvice(simulatedFailure, userLang = 'ja') {
  if (!simulatedFailure) return { aiAdvice: null, testMode: false, failureType: null, failureAdviceKey: null };
  const fc = detectFailureType(simulatedFailure, userLang);
  const adviceKey = fc ? (fc.adviceKey || null) : null;
  let aiAdvice = null;
  if (adviceKey && MULTILINGUAL_ADVICE[adviceKey]) {
    aiAdvice = MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja || null;
  }
  return {
    aiAdvice,
    testMode: true,
    failureType: simulatedFailure,
    failureAdviceKey: adviceKey,
    fc
  };
}

export async function getTransitAdvice(testAdv, userLang) {
  if (testAdv?.aiAdvice) return testAdv.aiAdvice;
  try {
    const weatherAdvice = await getWeatherAdvice(userLang);
    if (weatherAdvice?.advice) return weatherAdvice.advice;
  } catch (_) { /* 下記の既定アドバイスへフォールバック */ }
  return MULTILINGUAL_ADVICE.fair[userLang] || MULTILINGUAL_ADVICE.fair.ja;
}
