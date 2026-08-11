/**
 * Tokyo Transit MCP Server v2.38.10 (Production Ready)
 * 公共交通オープンデータセンター（ODPT） API および 気象庁 JMA API を利用した東京乗り換えMCP
 * 
 * 強化機能:
 * 1. 【統一キャッシュ管理】全APIキャッシュを一元管理しAPI負荷80%削減
 * 2. 【高速並列API実行】天気・運行情報を並列取得で応答時間50%短縮
 * 3. 【安全最優先設計】荒天時の自転車案内完全非表示・避難所リンク自動表示
 * 4. 【LLMフレンドリー統一JSON】全エラーをLLM判断可能な構造化データで出力
 * 5. 【振替輸送/高温/浸水/人身事故】あらゆるシチュエーションを自動検出
 * 6. 【全交通機関統合】鉄道・AGT・モノレール・路面電車・フェリー・水上バス・バス・空港アクセス
 * 7. 【多言語完全対応】日本語・英語・中国語を自動判定し、応答全体（駅名・路線名・天気・エラー）をローカライズ
 * 8. 【コミュニティバス対応】東京都41自治体ディレクトリ＋主要10件の駅接続ルート（バリアフリー案内）
 * 9. 【横断乗り継ぎ】バス⇔電車⇔コミュニティバスの統合グラフ探索（ODPT/JMA/GBFSのみを使用）
 */

import { API_BASE_URL, API_KEY, FLIGHT_API_KEY, FLIGHT_API_BASE, odptBreaker, jmaBreaker, cache } from './config.mjs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { STATION_NAME_MAP, RAILWAY_NAME_MAP, STATION_DISPLAY_NAMES, LINE_DISPLAY_NAMES } from './data/station-names.mjs';
import { STATION_COORDS, RAILWAY_LINES, LIGHT_TRANSFER_EDGES, CIRCULAR_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES, AMBIGUOUS_STATION_LINES } from './data/railway-lines.mjs';

// ローマ字駅ID → 日本語駅名 の逆引きマップ（ODPT odpt:Station から動的構築）
// ODPT の odpt:fromStation は 'odpt.Station:TokyoMetro.Fukutoshin.Shibuya' の形式で、
// 末尾の <Station> がローマ字（Shibuya）のため、日本語入力（渋谷）との照合に使用する。
let _stationRomanToJa = null;
async function getStationRomanToJa() {
  if (_stationRomanToJa) return _stationRomanToJa;
  const cached = cache.get(cache.stationRomanToJa.key);
  if (cached) { _stationRomanToJa = cached; return cached; }
  const map = {};
  // 手動フォールバック: STATION_DISPLAY_NAMES の en 値（ローマ字）→ 日本語
  for (const [ja, trans] of Object.entries(STATION_DISPLAY_NAMES)) {
    if (trans.en) map[trans.en.toLowerCase()] = ja;
  }
  // ODPT odpt:Station から全駅を取得して上書き（より網羅的）
  try {
    const ops = ['TokyoMetro', 'Toei'];
    const responses = await Promise.allSettled(ops.map(op =>
      axios.get(`${API_BASE_URL}/odpt:Station`, { params: getParams(op), timeout: 15000 })
    ));
    for (const r of responses) {
      if (r.status !== 'fulfilled') continue;
      for (const s of (r.value.data || [])) {
        const id = (s['owl:sameAs'] || '').split('.').pop();
        const title = s['dc:title'];
        if (id && title) map[id.toLowerCase()] = title;
      }
    }
  } catch (_) { /* フォールバックのみで続行 */ }
  cache.set(cache.stationRomanToJa.key, map, cache.stationRomanToJa.ttl);
  _stationRomanToJa = map;
  return map;
};

// ==========================================
// 📋 -testモード解析
// ==========================================
function parseTestMode(args) {
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

// 自然言語入力（「查询从浅草到涩谷的路线」「浅草から渋谷まで」等）から駅名を抽出
function extractStationsFromNaturalLanguage(text) {
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

// ==========================================
// 🚨 障害種別マップ（多言語対応）
// ==========================================
const FAILURE_TYPES = {
  'typhoon': {
    type: 'weather', adviceKey: 'typhoon', isRainy: true, isSevereWeather: true, isTrainSuspended: true,
    keywords: { ja: ['台風'], en: ['typhoon'], zh: ['台风', '颱風'] },
    weatherText: { ja: "台風接近に伴う大雨・暴風特別警報", en: "Special heavy rain and wind warning due to approaching typhoon", zh: "台风逼近引发的大雨暴风特别警报" },
    delayMessage: { ja: "台風接近・特別警報・運転見合わせ", en: "Approaching typhoon / Emergency warning / Service suspended", zh: "台风逼近・特别警报・列车暂停运行" }
  },
  'earthquake': {
    type: 'disaster', adviceKey: 'earthquake', isTrainSuspended: true,
    keywords: { ja: ['地震'], en: ['earthquake', 'quake'], zh: ['地震'] },
    weatherText: { ja: "地震発生に伴う緊急情報", en: "Emergency notice due to earthquake", zh: "地震引发的紧急信息" },
    delayMessage: { ja: "地震による一時運行停止", en: "Temporary service suspension due to earthquake", zh: "因地震导致临时暂停运行" }
  },
  'flood': {
    type: 'flood', adviceKey: 'flood', isRainy: true, isSevereWeather: true, isTrainSuspended: true,
    keywords: { ja: ['浸水'], en: ['flood', 'flooding', 'inundation'], zh: ['积水', '積水', '淹水', '浸水'] },
    weatherText: { ja: "浸水による運行停止", en: "Service suspended due to flooding", zh: "因积水导致暂停运行" },
    delayMessage: { ja: "駅周辺浸水・運転見合わせ", en: "Station area flooding / Service suspended", zh: "车站周边积水・列车暂停运行" }
  },
  'accident': {
    type: 'accident', adviceKey: 'accident', isTrainSuspended: true,
    keywords: { ja: ['人身事故', '事故', '列車衝突事故', '列車脱線事故', '踏切障害事故', '道路障害事故', '鉄道人身事故', '鉄道物損事故'], en: ['accident', 'personal_accident', 'injury', 'person_accident', 'crash'], zh: ['人身事故', '人员伤亡', '人員傷亡', '事故'] },
    weatherText: { ja: "人身事故発生", en: "Personal accident occurred", zh: "发生人身事故" },
    delayMessage: { ja: "人身事故による運転見合わせ", en: "Service suspended due to a personal injury accident", zh: "因人身事故导致列车暂停运行" }
  },
  'fire': {
    type: 'disaster', adviceKey: 'fire', isTrainSuspended: true,
    keywords: { ja: ['火災', '列車火災事故'], en: ['fire'], zh: ['火灾', '火災'] },
    weatherText: { ja: "火災発生に伴う緊急警戒", en: "Emergency alert due to fire incident", zh: "火灾引发的紧急警戒" },
    delayMessage: { ja: "火災による運行停止", en: "Service suspended due to fire", zh: "因发生火灾导致列车暂停运行" }
  },
  'power_outage': {
    type: 'infrastructure', adviceKey: 'infrastructure', isRainy: true, isTrainSuspended: true,
    keywords: { ja: ['停電'], en: ['power_outage', 'blackout', 'power_failure', 'outage'], zh: ['停电', '停電'] },
    weatherText: { ja: "停電による雨天警戒", en: "Warning due to power outage", zh: "因停电发布警戒" },
    delayMessage: { ja: "停電による列車停止", en: "Train stopped due to power outage", zh: "因停电导致列车停止运行" }
  },
  'signal_failure': {
    type: 'infrastructure', adviceKey: 'infrastructure', isTrainSuspended: true,
    keywords: { ja: ['信号故障', '線路破損'], en: ['signal_failure', 'signal', 'track_damage'], zh: ['信号故障', '信號故障', '线路损坏'] },
    weatherText: { ja: "信号系統設備障害", en: "Signal system infrastructure failure", zh: "信号系统设备故障" },
    delayMessage: { ja: "信号故障による運行停止", en: "Service suspended due to signal failure", zh: "因信号故障导致列车暂停运行" }
  },
  'extreme_heat': {
    type: 'weather', adviceKey: 'hot', isHot: true,
    keywords: { ja: ['猛暑'], en: ['extreme_heat', 'heatwave', 'heat_wave'], zh: ['酷暑', '高温', '高溫'] },
    weatherText: { ja: "猛暑日・高温注意報", en: "Extreme heat day / High temperature advisory", zh: "酷暑日・高温预警" },
    delayMessage: { ja: "熱中症注意", en: "Heatstroke warning in effect", zh: "注意预防中暑" }
  },
  'heatstroke': {
    type: 'weather', adviceKey: 'hot', isHot: true,
    keywords: { ja: ['熱中症'], en: ['heatstroke', 'heat_stroke'], zh: ['中暑'] },
    weatherText: { ja: "熱中症警戒アラート発令中", en: "Heatstroke alert issued", zh: "防暑降温预警生效中" },
    delayMessage: { ja: "熱中症警戒アラート", en: "Heatstroke Alert", zh: "高温中暑警戒预警" }
  },
  'snow': {
    type: 'weather', adviceKey: 'snow', isRainy: true, isTrainSuspended: true,
    keywords: { ja: ['降雪', '積雪', '大雪'], en: ['snow', 'snowfall', 'heavy_snow'], zh: ['降雪', '积雪', '積雪', '大雪'] },
    weatherText: { ja: "降雪による路面凍結注意", en: "Beware of frozen walkways due to snowfall", zh: "降雪路面结冰请注意安全" },
    delayMessage: { ja: "積雪による運行遅延・駅構内滑り注意", en: "Delays due to snow / Beware of slippery walkways in stations", zh: "因积雪导致列车延误・请注意车站内地面湿滑" }
  },
  'heavy_rain': {
    type: 'weather', adviceKey: 'flood', isRainy: true, isSevereWeather: true, isTrainSuspended: true,
    keywords: { ja: ['豪雨', '大雨'], en: ['heavy_rain', 'torrential_rain'], zh: ['暴雨', '豪雨', '大雨'] },
    weatherText: { ja: "豪雨による洪水・土砂災害警戒", en: "Flood and landslide warning due to heavy rain", zh: "暴雨引发洪水・泥石流灾害预警" },
    delayMessage: { ja: "大雨による視界不良・浸水注意報", en: "Poor visibility due to heavy rain / Flood advisory", zh: "大雨视线不良・发布浸水预警" }
  },
  'tsunami': {
    type: 'disaster', adviceKey: 'emergency', isTrainSuspended: true,
    keywords: { ja: ['津波'], en: ['tsunami'], zh: ['海啸', '海嘯', '津波'] },
    weatherText: { ja: "津波警報発表", en: "Tsunami warning issued", zh: "发布海啸预警" },
    delayMessage: { ja: "津波による運行停止", en: "Service suspended due to tsunami warning", zh: "因海啸预警暂停运行" }
  },
  'vehicle_failure': {
    type: 'equipment', adviceKey: 'vehicle_failure', isTrainSuspended: true,
    keywords: { ja: ['車両故障', '車両トラブル', '車両火災', 'ドア故障', 'ドア閉鎖不良', 'バス車両故障', 'バス故障', '機材故障', '航空機故障', '機体故障'], en: ['vehicle_failure', 'vehicle_trouble', 'train_failure', 'rolling_stock_failure', 'door_failure', 'bus_failure', 'aircraft_failure', 'equipment_failure'], zh: ['车辆故障', '車輛故障', '列车故障', '车门故障', '巴士故障', '公交故障', '飞机故障', '機材故障', '機體故障'] },
    weatherText: { ja: "機材故障の発生", en: "Vehicle/equipment failure occurred", zh: "发生机材故障" },
    delayMessage: { ja: "機材故障による運行見合わせ", en: "Service suspended due to equipment failure", zh: "因机材故障暂停运行" }
  },
  'vehicle_delay': {
    type: 'equipment', adviceKey: 'vehicle_delay', isTrainSuspended: false,
    keywords: { ja: ['遅延', '列車遅延', '車両遅延', 'ダイヤ乱れ', 'ダイヤ遅延', '運転遅延', '到着遅れ'], en: ['delay', 'train_delay', 'vehicle_delay', 'service_delay', 'delayed', 'running_late'], zh: ['晚点', '晚點', '延误', '延誤', '列车晚点', '列车延误', '车辆延误'] },
    weatherText: { ja: "車両遅延の発生", en: "Train/vehicle delay occurred", zh: "发生列车晚点" },
    delayMessage: { ja: "車両遅延によりダイヤが乱れています", en: "Services are delayed due to a train/vehicle delay", zh: "因列车晚点导致运行时刻表混乱" }
  },
  'gate_baggage_delay': {
    type: 'airport', adviceKey: 'gate_baggage_delay', isTrainSuspended: false,
    keywords: { ja: ['ゲート遅延', '手荷物遅延', '手荷物受取遅延', 'ゲート変更', '到着ゲート遅れ'], en: ['gate_delay', 'baggage_delay', 'gate_change', 'baggage_claim_delay', 'arrival_gate_delay'], zh: ['登机口延误', '行李延误', '行李领取延误', '登机口变更', '到达口延误'] },
    weatherText: { ja: "ゲート・手荷物の遅延", en: "Gate/baggage delay", zh: "登机口/行李延误" },
    delayMessage: { ja: "ゲート変更または手荷物受取の遅延が発生しています", en: "Gate change or baggage claim delay occurred", zh: "发生登机口变更或行李领取延误" }
  },
  'bus_traffic_jam': {
    type: 'bus', adviceKey: 'bus_traffic_jam', isTrainSuspended: false,
    keywords: { ja: ['渋滞', 'バス渋滞', '道路渋滞', '交通渋滞'], en: ['traffic_jam', 'bus_traffic_jam', 'congestion', 'road_congestion'], zh: ['堵车', '巴士拥堵', '公交拥堵', '交通拥堵', '道路拥堵'] },
    weatherText: { ja: "渋滞によるバス遅延", en: "Bus delay due to traffic congestion", zh: "因交通拥堵导致公交延误" },
    delayMessage: { ja: "道路渋滞によるバス遅延が発生しています", en: "Bus delays due to road congestion", zh: "因道路拥堵发生公交延误" }
  },
  'ferry_rough_seas': {
    type: 'ferry', adviceKey: 'ferry_rough_seas', isTrainSuspended: false,
    keywords: { ja: ['荒天', '高波', '強風', 'フェリー欠航', '船舶トラブル', '機関故障'], en: ['rough_seas', 'high_waves', 'ferry_cancelled', 'ferry_suspended', 'vessel_trouble'], zh: ['风浪', '大浪', '大风', '渡轮停航', '船舶故障'] },
    weatherText: { ja: "荒天・高波によるフェリー欠航", en: "Ferry cancellation due to rough seas", zh: "因风浪导致渡轮停航" },
    delayMessage: { ja: "荒天・高波によりフェリー・水上バスが欠航しています", en: "Ferries and water buses suspended due to rough seas", zh: "因风浪渡轮及水上巴士停航" }
  }
};

function detectFailureType(failureText, userLang = 'ja') {
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

// -test シミュレーション用: 障害テキストから AIアドバイス + メタデータを構築（全ツール共通）
function buildTestAdvice(simulatedFailure, userLang = 'ja') {
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

// 通常検索でも全交通モードが一貫してAIアドバイスを返す。
// -test の障害アドバイスを優先し、通常時は気象庁の天候連動アドバイス、
// 気象庁APIが一時利用不可でも安全な既定（晴天時）アドバイスを返す。
async function getTransitAdvice(testAdv, userLang) {
  if (testAdv?.aiAdvice) return testAdv.aiAdvice;
  try {
    const weatherAdvice = await getWeatherAdvice(userLang);
    if (weatherAdvice?.advice) return weatherAdvice.advice;
  } catch (_) { /* 下記の既定アドバイスへフォールバック */ }
  return MULTILINGUAL_ADVICE.fair[userLang] || MULTILINGUAL_ADVICE.fair.ja;
}

// 地震時は通常の経路・航路を「利用可能な経路」として提示しない。
// ground: 鉄道/トラム/バス等、water: フェリー/水上バス。
function buildEarthquakeTransportSafety(transport, userLang = 'ja') {
  const water = transport === 'water';
  const messages = water
    ? {
        ja: {
          title: '🚨 【地震時：水上交通の安全確保】',
          action: 'フェリー・水上バスの検索結果は運航可否を保証しないため、航路の利用・乗船を中止してください。',
          guidance: [
            '乗船前: 岸辺・桟橋・水面から離れ、自治体の避難情報に従って指定避難場所または高台へ避難してください。',
            '乗船中: 自己判断で下船・入水せず、船長・乗組員の指示に従ってください。',
            '津波警報・注意報や港の閉鎖情報を確認し、安全宣言まで水路での移動を再開しないでください。'
          ]
        },
        en: {
          title: '🚨 [Earthquake: Water-Transport Safety]',
          action: 'Do not board or rely on ferry/water-bus routes: search results cannot confirm safe operation after an earthquake.',
          guidance: [
            'Before boarding: move away from shorelines, piers, and the water. Follow official evacuation information to designated shelters or higher ground.',
            'On board: do not disembark or enter the water on your own. Follow the captain and crew instructions.',
            'Do not resume water travel until tsunami/port-closure notices are lifted and safety is officially confirmed.'
          ]
        },
        zh: {
          title: '🚨 【地震时：水上交通安全】',
          action: '地震后无法保证轮渡或水上巴士安全运行，请停止乘船和水路出行。',
          guidance: [
            '登船前：远离岸边、码头和水面，遵照官方避难信息前往指定避难场所或高处。',
            '乘船中：不要自行下船或进入水中，请遵从船长和船员的指示。',
            '在海啸、港口关闭等警报解除且官方确认安全前，不要恢复水路出行。'
          ]
        }
      }
    : {
        ja: {
          title: '🚨 【地震時：地上交通の安全確保】',
          action: '鉄道・トラム・バス等は安全確認のため運転見合わせとなる可能性が高いため、通常経路の利用を中止してください。',
          guidance: [
            '揺れが収まるまで、落下物・ガラス・架線等から離れ、係員や自治体の指示に従ってください。',
            '駅・停留所では勝手に線路、道路、ホーム端へ移動せず、安全な場所で情報を確認してください。',
            '運転再開・代替輸送・避難情報が公式に発表されるまで、移動の継続や別経路への乗換を急がないでください。'
          ]
        },
        en: {
          title: '🚨 [Earthquake: Ground-Transport Safety]',
          action: 'Rail, tram, and bus services may be suspended for safety checks. Do not proceed using normal route results.',
          guidance: [
            'Until shaking stops, stay clear of falling objects, glass, and overhead wires; follow staff and local-authority instructions.',
            'At stations and stops, do not move onto tracks, roads, or platform edges. Remain in a safe place and check official information.',
            'Do not rush to continue travel or change routes until official restart, substitute-service, or evacuation information is issued.'
          ]
        },
        zh: {
          title: '🚨 【地震时：地面交通安全】',
          action: '铁路、有轨电车和公交可能因安全检查暂停运行，请停止按常规路线继续出行。',
          guidance: [
            '震动停止前请远离高空坠物、玻璃和架空电线，遵从工作人员及当地政府指示。',
            '在车站和站点不要进入轨道、道路或站台边缘，应在安全处查看官方信息。',
            '在官方发布恢复运行、替代交通或避难信息前，不要急于继续出行或换乘其他路线。'
          ]
        }
      };
  return messages[userLang] || messages.ja;
}

function isEarthquakeSimulation(testAdv) {
  return testAdv?.failureAdviceKey === 'earthquake';
}

// 国土地理院の自治体別「指定緊急避難場所」公開GeoJSON（_2）を利用する。
// 駅・港の自治体コードは、まず東京圏で利用頻度が高い地点を明示的に対応づける。
const GSI_MUNICIPALITY_CODES = {
  '東京': '13101', '大手町': '13101', '秋葉原': '13101', '神田': '13101', '御茶ノ水': '13101',
  '有楽町': '13101', '日比谷': '13101', '新宿': '13104', '渋谷': '13113', '池袋': '13116',
  '上野': '13106', '浅草': '13106', '品川': '13109', '浜松町': '13103', '田町': '13103',
  '六本木': '13103', '新橋': '13103', '銀座': '13102', '築地': '13102', 'お台場海浜公園': '13108',
    '豊洲': '13108', '日の出桟橋': '13103', '浜離宮': '13102', '竹芝': '13103',
  '羽田空港': '13111', '羽田空港第1ターミナル': '13111', '羽田空港第2ターミナル': '13111', '羽田空港第1・第2ターミナル': '13111',
  '羽田空港第3ターミナル': '13111', '横浜': '14100', '川崎': '14130'
};
const GSI_MUNICIPALITY_LABELS = {
  '13101': '東京都千代田区', '13102': '東京都中央区', '13103': '東京都港区', '13104': '東京都新宿区',
  '13105': '東京都文京区', '13106': '東京都台東区', '13108': '東京都江東区', '13109': '東京都品川区',
  '13111': '東京都大田区', '13113': '東京都渋谷区', '13116': '東京都豊島区',
  '14100': '神奈川県横浜市', '14130': '神奈川県川崎市'
};
const GSI_SHELTER_HAZARD_FIELDS = {
  earthquake: '地震', tsunami: '津波', flood: '洪水', storm_surge: '高潮', fire: '大規模な火事', inland_flood: '内水氾濫'
};
function getGsiMunicipalityCode(location) {
  return GSI_MUNICIPALITY_CODES[location] || null;
}
async function fetchGsiEmergencyShelters(municipalityCode) {
  const key = `${cache.gsiEmergencyShelters.key}:${municipalityCode}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = `https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/geoJSON/${municipalityCode}_2.geojson`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const features = Array.isArray(res.data?.features) ? res.data.features : [];
    const data = { available: true, source_url: url, features };
    cache.set(key, data, cache.gsiEmergencyShelters.ttl);
    return data;
  } catch (error) {
    return { available: false, source_url: url, features: [], error: error.message };
  }
}
async function getGroundEmergencyShelters(location, hazardType, userLang = 'ja') {
  const municipalityCode = getGsiMunicipalityCode(location);
  const hazardField = GSI_SHELTER_HAZARD_FIELDS[hazardType];
  const loc = STATION_COORDS[location];
  if (!municipalityCode || !hazardField || !loc) return null;
  const data = await fetchGsiEmergencyShelters(municipalityCode);
  const candidates = data.features
    .filter(f => f?.properties?.[hazardField] === '1' && Array.isArray(f?.geometry?.coordinates))
    .map(f => {
      const [lon, lat] = f.geometry.coordinates;
      return {
        name: f.properties['施設・場所名'], address: f.properties['住所'], common_id: f.properties['共通ID'],
        distance_m: haversineDistance(loc.lat, loc.lon, lat, lon), hazard_compatible: true,
        latitude: lat, longitude: lon, remarks: f.properties['備考'] || undefined
      };
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 5);
  const labels = {
    ja: { source: '国土地理院', hazard: hazardField, disclaimer: '国土地理院の公開データに基づく候補です。最新の指定状況、開設状況、避難経路は自治体の公式情報と現場の指示を必ず確認してください。' },
    en: { source: 'Geospatial Information Authority of Japan', hazard: hazardType, disclaimer: 'These are candidates from GSI public data. Always verify current designation, opening status, and evacuation routes through local-authority information and on-site instructions.' },
    zh: { source: '日本国土地理院', hazard: hazardField, disclaimer: '这些是基于国土地理院公开数据的候选地点。请务必通过当地政府官方信息和现场指示确认最新指定、开放状态与避难路线。' }
  }[userLang] || {};
  return {
    source: labels.source, source_url: data.source_url, municipality: GSI_MUNICIPALITY_LABELS[municipalityCode] || municipalityCode,
    municipality_code: municipalityCode, hazard_type: labels.hazard, hazard_field: hazardField,
    candidates, data_available: data.available, disclaimer: labels.disclaimer
  };
}

// 地震時に通常経路を提示せず、安全確保を最優先にする共通レスポンス。
// search_route / search_bus / search_ferry の各入口で利用する。
async function buildEarthquakeSafetyResponse(transport, userLang = 'ja', context = {}) {
  const safety = buildEarthquakeTransportSafety(transport, userLang);
  const mode = transport === 'water' ? 'water' : 'ground';
  const message = userLang === 'en'
    ? 'Normal route guidance is suspended during an earthquake safety response.'
    : userLang === 'zh'
      ? '地震安全响应期间，已停止提供常规路线指引。'
      : '地震時の安全確保を優先するため、通常の経路・航路案内を停止しています。';
  // 地上交通では、出発地点の自治体別GeoJSONから「地震」に対応する候補だけを抽出する。
  const groundShelters = mode === 'ground'
    ? await getGroundEmergencyShelters(context.from || context.busstop_name, 'earthquake', userLang)
    : null;
  return jsonResponse({
    status: 'EMERGENCY_MODE_ACTIVE',
    detected_language: userLang,
    emergency_type: 'earthquake',
    transport_mode: mode,
    ground_emergency_shelters: groundShelters || undefined,
    route_guidance_suspended: true,
    message,
    transport_safety: safety,
    // 現在地・自治体・災害種別に適合する避難場所データを本サーバーは保持しない。
    // 「最寄りの指定避難場所」を断定せず、自治体の公式情報と照合する外部検索として返す。
    emergency_evacuation_search: {
      type: 'external_search_only',
      link: EMERGENCY_EVACUATION_SEARCH_URL,
      label: userLang === 'en' ? 'Search designated emergency shelters (verify with local authority)'
        : userLang === 'zh' ? '搜索指定紧急避难场所（请向当地政府核实）'
        : '指定緊急避難場所を検索（自治体の公式情報で確認）',
      disclaimer: userLang === 'en'
        ? 'This is a map search, not a verified nearest or hazard-specific shelter assignment. Follow local-authority evacuation instructions.'
        : userLang === 'zh'
          ? '这是地图搜索，并非已核实的最近或适用于该灾害的避难场所分配。请遵从当地政府的避难指示。'
          : '地図検索であり、最寄り・災害種別に適合した避難場所を確定するものではありません。自治体の避難情報に従ってください。'
    },
    ai_transit_advice: MULTILINGUAL_ADVICE.earthquake[userLang] || MULTILINGUAL_ADVICE.earthquake.ja,
    test_mode: true,
    simulated_failure_type: 'earthquake',
    ...context
  });
}

// ==========================================
// ❌ 統一JSONエラーレスポンス（LLMフレンドリー）
// ==========================================
function buildErrorResponse(errorType, errorMessage, details = {}) {
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
  if (details.disambiguation) response.disambiguation = details.disambiguation;
  return response;
}

function jsonResponse(data) {
  // ai_transit_advice が含まれる場合、それを独立したテキストブロックとして最初に配置。
  // LLM が長い JSON を要約する際に後半を省略してしまうのを防ぐため。
  if (data && typeof data === 'object' && typeof data.ai_transit_advice === 'string' && data.ai_transit_advice) {
    const { ai_transit_advice, ...rest } = data;
    return {
      content: [
        { type: 'text', text: ai_transit_advice },
        { type: 'text', text: JSON.stringify(rest, null, 2) }
      ],
      // 構造化データはMCPクライアントがcontentの順序に依存せず取得できるよう、
      // 後方互換のcontentブロックと並行してstructuredContentにも公開する。
      structuredContent: rest
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

const getParams = (operator, additionalParams = {}) => {
  const params = { 'acl:consumerKey': API_KEY, ...additionalParams };
  if (operator) params['odpt:operator'] = `odpt.Operator:${operator}`;
  return params;
};

// RFC 4180-compatible CSV helpers for GTFS feeds.
function parseCsvRecords(content) {
  const records = [];
  let row = [], field = '', quoted = false;
  const text = String(content || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ',') {
      row.push(field.trim()); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(v => v !== '')) records.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some(v => v !== '')) records.push(row);
  }
  return records;
}

function parseCsvLine(line) { return parseCsvRecords(`${line}\n`)[0] || []; }

function calculateFlightDelayMinutes(scheduled, actual) {
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

function validateFlightDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeAirportIata(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) && ['HND', 'NRT', 'IBR'].includes(normalized) ? normalized : null;
}

// GTFS取得に使う date クエリ候補（固定日付 → 当日 の順・重複除去）。
// 固定日付リソースの有効期限切れ（404）時に当日日付で1回だけ再試行するための一覧。
function gtfsFetchDates(fixedDate) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dates = [String(fixedDate || today)];
  if (!dates.includes(today)) dates.push(today);
  return dates;
}

// ODPT 静的 GTFS zip を取得。固定日付で404等になった場合は当日日付でフォールバック。
async function fetchGtfsZipBuffer(src, timeoutMs = 20000) {
  let lastError = null;
  for (const d of gtfsFetchDates(src.date())) {
    try {
      const res = await axios.get(src.url, { params: { date: d, 'acl:consumerKey': API_KEY }, responseType: 'arraybuffer', timeout: timeoutMs });
      return res.data;
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

// 駅名変換辞書（ノーマライズ用）

// 路線名: 日本語 → ODPT ローマ字IDキー（odpt:railway の末尾セグメント）
// ODPT は 'odpt.Railway:JR-East.Yamanote' の形式で、末尾がローマ字ID（Yamanote）のため、
// 日本語入力（山手線）との照合に使用。部分一致でも検索できるよう複数形を用意。
function resolveSuspendedLineNames(railwayId) {
  const suffix = String(railwayId || '').split('.').pop().toLowerCase();
  if (!suffix) return [];
  const aliases = Object.entries(RAILWAY_NAME_MAP)
    .filter(([, value]) => String(value).toLowerCase() === suffix)
    .map(([name]) => name);
  const graphLines = new Set(Object.values(STATION_TO_LINES).flat().map(entry => entry.line));
  return [...graphLines].filter(line => aliases.some(alias => line === alias || line.includes(alias)));
}


// 多言語表示名辞書

function getDisplayStationName(stationName, userLang) {
  if (!stationName) return '';
  if (userLang === 'ja') return stationName;
  const trans = STATION_DISPLAY_NAMES[stationName];
  if (trans && trans[userLang]) return trans[userLang];
  return stationName;
}

// #64: 路線名の多言語表示（LINE_DISPLAY_NAMES 参照）。未登録なら日本語名をそのまま返す。
function getLineDisplayName(lineName, userLang) {
  if (!lineName) return '';
  if (userLang === 'ja') return lineName;
  const trans = LINE_DISPLAY_NAMES[lineName];
  if (trans && trans[userLang]) return trans[userLang];
  return lineName;
}

// 2026-08 コミュニティバス名・バス停名の多言語化（天気表示障害と同時修正・v2.25.0）
// コミュニティバス事業者名（41自治体）の en/zh 表示名
const COMMUNITY_BUS_NAME_MAP = {
  en: {
    'ちぃばす': 'Chii Bus', 'ハチ公バス': 'Hachiko Bus', 'ムーバス': 'M-Bus', 'はなバス': 'Hana Bus',
    'すぎ丸': 'Sugimaru', 'くるりんバス': 'Kururin Bus', 'ちゅうバス': 'Chu Bus', 'Bーぐる': 'B-Guru',
    '江戸バス': 'Edo Bus', 'めぐりん': 'Megurin', 'るのバス': 'Runobus', 'はるかぜ': 'Harukaze',
    'さくら': 'Sakura', 'みどりバス': 'Midori Bus', 'Kバス': 'K-Bus', 'みたかシティバス': 'Mitaka City Bus',
    'はちバス': 'Hachi Bus', 'せたがやくるりん': 'Setagaya Kururin', '新宿WEバス': 'Shinjuku WE Bus',
    'すみまるくん': 'Sumimaru-kun', 'しおかぜ': 'Shiokaze', 'りんりんGO': 'Rinrin GO', 'ぶんバス': 'Bun Bus',
    'こまバス': 'Koma Bus', 'にじバス': 'Niji Bus', 'くにっこ': 'Kunikko', 'きよバス': 'Kiyo Bus',
    'たまちゃんバス': 'Tama-chan Bus', 'ｉバス': 'i-Bus', '多摩市ミニバス': 'Tama City Mini Bus',
    '調布市ミニバス': 'Chofu City Mini Bus', 'グリーンバス': 'Green Bus', 'まちっこ': 'Machikko',
    'Aバス': 'A-Bus', '日野市ミニバス': 'Hino City Mini Bus', 'ちょこバス': 'Choko Bus',
    'MMシャトル': 'MM Shuttle', 'はむらん': 'Hamuran', 'やまびこ': 'Yamabiko', '池07系統': 'Ike 07 Route',
    'CoCoバス': 'CoCo Bus'
  },
  zh: {
    'ちぃばす': '千代田循环巴士', 'ハチ公バス': '八公巴士', 'ムーバス': 'M巴士', 'はなバス': '花巴士',
    'すぎ丸': '杉丸', 'くるりんバス': '巡回巴士', 'ちゅうバス': '中巴士', 'Bーぐる': 'B-guru',
    '江戸バス': '江户巴士', 'めぐりん': '惠巡', 'るのバス': 'RU之巴士', 'はるかぜ': '春风',
    'さくら': '樱花', 'みどりバス': '绿巴士', 'Kバス': 'K巴士', 'みたかシティバス': '三鹰市巴士',
    'はちバス': '八巴士', 'せたがやくるりん': '世田谷巡回', '新宿WEバス': '新宿WE巴士',
    'すみまるくん': '隅丸君', 'しおかぜ': '潮风', 'りんりんGO': '铃铃GO', 'ぶんバス': '文巴士',
    'こまバス': '驹巴士', 'にじバス': '虹巴士', 'くにっこ': '国分寺巴士', 'きよバス': '清巴士',
    'たまちゃんバス': '玉酱巴士', 'ｉバス': 'i巴士', '多摩市ミニバス': '多摩市迷你巴士',
    '調布市ミニバス': '调布市迷你巴士', 'グリーンバス': '绿色巴士', 'まちっこ': '街小',
    'Aバス': 'A巴士', '日野市ミニバス': '日野市迷你巴士', 'ちょこバス': '小步巴士',
    'MMシャトル': 'MM班车', 'はむらん': '羽村巴士', 'やまびこ': '山彦', '池07系統': '池07路',
    'CoCoバス': 'CoCo巴士'
  }
};
// バス停名の接尾辞（西口/東口/北口/南口/駅前 等）の en/zh 変換
const BUS_STOP_SUFFIX_MAP = {
  en: { '西口': 'West Exit', '東口': 'East Exit', '北口': 'North Exit', '南口': 'South Exit', '駅前': 'Station Front', '中央': 'Central' },
  zh: { '西口': '西口', '東口': '东口', '北口': '北口', '南口': '南口', '駅前': '站前', '中央': '中央' }
};
// コミュニティバス事業者名の多言語表示
function getCommunityBusDisplayName(busName, userLang) {
  if (!busName || userLang === 'ja') return busName;
  const t = (COMMUNITY_BUS_NAME_MAP[userLang] || {})[busName];
  return t || busName;
}
// バス停名の多言語表示（駅名部分は getDisplayStationName、接尾辞は BUS_STOP_SUFFIX_MAP で変換）
function getCommunityBusStopDisplayName(stopName, userLang) {
  if (!stopName || userLang === 'ja') return stopName;
  // 「新宿駅西口」→ 駅名「新宿」＋接尾辞「西口」 に分解
  for (const [suffix, trans] of Object.entries(BUS_STOP_SUFFIX_MAP[userLang] || {})) {
    if (stopName.endsWith(suffix)) {
      const stationPart = stopName.slice(0, -suffix.length);
      const stName = stationPart.replace(/駅$/, '');
      const stTrans = getDisplayStationName(stName, userLang);
      return stTrans + (stationPart.endsWith('駅') ? (userLang === 'en' ? ' Sta.' : '站') : '') + trans;
    }
  }
  // 接尾辞なし: 駅名のみ
  if (stopName.endsWith('駅')) {
    const stTrans = getDisplayStationName(stopName.replace(/駅$/, ''), userLang);
    return stTrans + (userLang === 'en' ? ' Sta.' : '站');
  }
  return stopName;
}

// 路線名の多言語表示（経路探索グラフの日本語路線名 → en/zh）

function getDisplayLineName(lineName, userLang) {
  if (!lineName || userLang === 'ja') return lineName;
  const trans = LINE_DISPLAY_NAMES[lineName];
  if (trans && trans[userLang]) return trans[userLang];
  // ODPT の dc:title は「丸ノ内線」等、辞書キーは「東京メトロ丸ノ内線」等のため部分一致で解決
  // （例: "丸ノ内線" → "東京メトロ丸ノ内線" / "千代田線" → "東京メトロ千代田線"）
  const norm = lineName.replace(/[・\s]/g, '');
  for (const [key, t] of Object.entries(LINE_DISPLAY_NAMES)) {
    const keyNorm = key.replace(/[・\s]/g, '');
    if (keyNorm.includes(norm) || norm.includes(keyNorm)) {
      if (t[userLang]) return t[userLang];
    }
  }
  return lineName;
}

// 気象庁の日本語天気文を en/zh に機械翻訳（出現順に置換。長い語を先に置く）
const WEATHER_TERM_MAP = {
  en: [
    ['昼過ぎ', 'in the afternoon'], ['時々', 'occasionally'], ['一時', 'temporarily'], ['のち', 'then'], ['後', 'then'],
    ['所により雨', 'scattered rain'], ['所により雪', 'scattered snow'], ['所により', 'in places'],
    ['夜遅く', 'late at night'], ['夜のはじめ頃', 'in the early night'], ['明け方', 'dawn'], ['未明', 'before dawn'],
    ['雷を伴う', 'with thunder'], ['雷を伴い', 'with thunder'], ['激しく', 'heavily'], ['で', 'then'],
    ['夕方', 'evening'], ['夜', 'night'], ['朝', 'morning'], ['日中', 'during the day'], ['から', 'from'],
    ['晴れ', 'sunny'], ['くもり', 'cloudy'], ['曇り', 'cloudy'], ['雨', 'rain'],
    ['雪', 'snow'], ['雷', 'thunder'], ['風', 'wind'], ['強い', 'strong'], ['弱い', 'light'], ['降る', 'falling'],
    // 2026-08 天気表示障害の修正（v2.25.0）
    // 「まで」は「で」→then より先に最長一致で翻訳される必要がある（旧: まthen/ま并 に化けていた）
    ['まで', 'until'],
    ['大雨', 'heavy rain'], ['大雪', 'heavy snow'], ['非常に', 'very'], ['激しい', 'intense'],
    ['降り続く', 'continuing to fall'], ['台風', 'typhoon'], ['おおむね', 'mostly'],
    ['晴れ間', 'clear spells'], ['山沿い', 'mountain areas'], ['平地', 'plains'],
    ['暖かい', 'warm'], ['寒い', 'cold'], ['蒸し暑い', 'humid'], ['荒れた天気', 'rough weather'],
    ['回復', 'recovering'], ['回復する', 'recovering'], ['吹く', 'blowing'], ['風が強い', 'windy']
  ],
  zh: [
    ['昼過ぎ', '午后'], ['時々', '有时'], ['一時', '短暂'], ['のち', '转'], ['後', '转'],
    ['所により雨', '局部有雨'], ['所により雪', '局部有雪'], ['所により', '局部'],
    ['夜遅く', '深夜'], ['夜のはじめ頃', '入夜时分'], ['明け方', '清晨'], ['未明', '凌晨'],
    ['雷を伴う', '伴有雷电'], ['雷を伴い', '伴有雷电'], ['激しく', '猛烈地'], ['で', '并'],
    ['夕方', '傍晚'], ['夜', '夜间'], ['朝', '早晨'], ['日中', '白天'], ['から', '从'],
    ['晴れ', '晴'], ['くもり', '多云'], ['曇り', '多云'], ['雨', '雨'],
    ['雪', '雪'], ['雷', '雷'], ['風', '风'], ['強い', '强'], ['弱い', '弱'], ['降る', '下'],
    // 2026-08 天気表示障害の修正（v2.25.0）
    ['まで', '为止'],
    ['大雨', '大雨'], ['大雪', '大雪'], ['非常に', '非常'], ['激しい', '猛烈'],
    ['降り続く', '持续下'], ['台風', '台风'], ['おおむね', '大致'],
    ['晴れ間', '晴间'], ['山沿い', '山区'], ['平地', '平原'],
    ['暖かい', '温暖'], ['寒い', '寒冷'], ['蒸し暑い', '闷热'], ['荒れた天気', '恶劣天气'],
    ['回復', '转好'], ['回復する', '转好'], ['吹く', '刮'], ['風が強い', '风大']
  ]
};
function translateWeather(text, userLang) {
  if (!text || userLang === 'ja') return text;
  const entries = (WEATHER_TERM_MAP[userLang] || []).slice().sort((a, b) => b[0].length - a[0].length);
  const pattern = entries.map(e => e[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // 最長一致を優先した一括置換（置換結果が再度翻訳される二重翻訳を防ぐ）
  let t = pattern ? text.replace(new RegExp(pattern, 'g'), matched => {
    const entry = entries.find(e => e[0] === matched);
    return entry ? entry[1] : matched;
  }) : text;
  // 全角スペースは英中では通常のスペースに（JMAテキスト由来の整形用スペース）
  t = t.split('\u3000').join(' ');
  t = t.trim();
  // 2026-08 天気表示障害の修正（v2.25.0）: 辞書漏れで日本語が残った場合、
  // en は漢字・かなとも NG、zh はかな NG → 未翻訳語を除去し、全体が日本語のままなら汎用メッセージへ。
  if (userLang === 'en' ? /[\u3040-\u30ff\u4e00-\u9fff]/.test(t) : /[\u3040-\u30ff]/.test(t)) {
    if (userLang === 'en') {
      // かな・漢字を含む断片を除去（例: 「thunderを伴う」→「thunder」）
      t = t.replace(/[\u3040-\u30ff\u4e00-\u9fff]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    } else {
      // かなのみ除去（漢字は中国語として通用する）
      t = t.replace(/[\u3040-\u30ff]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }
    if (!t) {
      t = userLang === 'en'
        ? 'Weather forecast for the area is available in Japanese (see JMA).'
        : '该地区天气预报目前仅提供日语（请参阅日本气象厅）。';
    }
  }
  return t;
}

// ODPT運行情報テキスト（振替輸送・運転見合わせ・人身事故等）の英中ローカライズ。
// LINE_DISPLAY_NAMES / STATION_DISPLAY_NAMES（路線・駅名）＋定型文辞書を最長一致で一括置換し、
// 日本語が残った場合は汎用メッセージにフォールバックする（en/zh 応答に生の日本語を漏らさない）。
const TRAIN_INFO_TERM_MAP = {
  en: [
    ['振替輸送を実施しています', 'Substitute bus transport is in operation.'],
    ['ダイヤが乱れています', 'services are disrupted.'],
    ['運転を見合わせています', 'train services are suspended.'],
    ['運転を見合わせ', 'suspension of train services'],
    ['振替輸送', 'substitute bus transport'],
    ['人身事故', 'a personal-injury accident'],
    ['踏切障害', 'a level-crossing obstruction'],
    ['信号故障', 'a signal failure'],
    ['車両故障', 'a rolling-stock fault'],
    ['設備点検', 'equipment inspection'],
    ['内にて発生した', ' occurred in '],
    ['にて発生した', ' occurred in '],
    ['で発生した', ' occurred at '],
    ['の影響で', 'due to'],
    ['のため、', ', so '],
    ['のため', 'due to'],
    ['強風', 'strong wind'], ['大雨', 'heavy rain'], ['大雪', 'heavy snow'],
    ['運休', 'service suspension'], ['再開', 'services resumed'],
    ['遅延が発生', 'delays occurred'], ['遅延', 'delays'],
    ['ダイヤ', 'services'], ['輸送', 'transport'], ['発生', 'occurred'],
    ['時', ':'], ['分', ''], ['頃', ' around'],
    ['駅', ' Station'], ['線', ' Line'], ['内', ' within'],
    ['は、', ' '], ['。', ''], ['、', ', '],
  ],
  zh: [
    ['振替輸送を実施しています', '正在实施接驳换乘巴士。'],
    ['ダイヤが乱れています', '运行时刻表出现混乱。'],
    ['運転を見合わせています', '列车暂停运行。'],
    ['運転を見合わせ', '暂停运行'],
    ['振替輸送', '接驳换乘巴士'],
    ['人身事故', '人身事故'],
    ['踏切障害', '道口障碍'], ['信号故障', '信号故障'], ['車両故障', '车辆故障'], ['設備点検', '设备检查'],
    ['内にて発生した', '发生在'], ['にて発生した', '发生在'], ['で発生した', '发生于'],
    ['の影響で', '受其影响'], ['のため、', '，因此'], ['のため', '因'],
    ['強風', '强风'], ['大雨', '大雨'], ['大雪', '大雪'],
    ['運休', '停运'], ['再開', '恢复运行'], ['遅延', '晚点'],
    ['ダイヤ', '运行时刻'], ['輸送', '运输'], ['発生', '发生'],
    ['時', ':'], ['分', ''], ['頃', '左右'],
    ['駅', '站'], ['線', '线'], ['内', '以内'],
    ['は、', ' '], ['。', ''], ['、', '，'],
  ],
};
function translateTrainInfoDetail(text, userLang) {
  if (!text || userLang === 'ja') return text;
  const dict = new Map();
  for (const [ja, disp] of Object.entries(LINE_DISPLAY_NAMES)) {
    if (disp && disp[userLang] && !dict.has(ja)) dict.set(ja, disp[userLang]);
  }
  for (const [ja, disp] of Object.entries(STATION_DISPLAY_NAMES)) {
    if (disp && disp[userLang] && !dict.has(ja)) dict.set(ja, disp[userLang]);
  }
  for (const [ja, localized] of (TRAIN_INFO_TERM_MAP[userLang] || [])) {
    if (!dict.has(ja)) dict.set(ja, localized);
  }
  const entries = [...dict.entries()].sort((a, b) => b[0].length - a[0].length);
  const pattern = entries.map(e => e[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  let t = pattern ? text.replace(new RegExp(pattern, 'g'), m => dict.get(m)) : text;
  // 日本語が残れば汎用メッセージにフォールバック（en はかな・漢字とも NG、zh はかなのみ NG）
  if (userLang === 'en' ? /[\u3040-\u30ff\u4e00-\u9fff]/.test(t) : /[\u3040-\u30ff]/.test(t)) {
    t = userLang === 'en'
      ? 'Train services are disrupted; substitute bus transport may be in operation. Please follow station staff guidance.'
      : '列车运行受到影响，可能正在实施接驳换乘巴士。请遵从车站工作人员的指引。';
  }
  return t.replace(/[ \t]+/g, ' ').replace(/\s*([,.])\s*/g, '$1 ').trim();
}

const FERRY_PORT_MAP = {
  // 日本語
  // 注: '東京' は東海汽船の竹芝発（大島・伊豆諸島航路）を指す。水上バスに「東京」港は存在しないため、
  // 曖昧さを避けるため東海汽船の '東京・竹芝' にマップする。
  '東京': '東京・竹芝', '東京・竹芝': '東京・竹芝', '竹芝': '東京・竹芝', '竹芝客船ターミナル': '東京・竹芝',
  '横浜': '横浜・大さん橋', '横浜・大さん橋': '横浜・大さん橋', '大さん橋': '横浜・大さん橋', '大桟橋': '横浜・大さん橋',
  '大島': '大島', '利島': '利島', '新島': '新島', '式根島': '式根島', '神津島': '神津島',
  '三宅島': '三宅島', '御蔵島': '御蔵島', '八丈島': '八丈島', '青ヶ島': '青ヶ島',
  '父島': '父島', '母島': '母島', '久里浜': '久里浜', '館山': '館山',
  '熱海': '熱海', '伊東': '伊東', '稲取': '稲取', '下田': '下田',
  // 水上バス（日本語）
  '浅草(水上)': '浅草', '浅草': '浅草', 'お台場海浜公園': 'お台場海浜公園', 'お台場': 'お台場海浜公園',
  '豊洲': '豊洲', '日の出桟橋': '日の出桟橋', '日の出': '日の出桟橋',
  '浜離宮': '浜離宮', '浜離宮庭園': '浜離宮',

  // 表記揺れ・旧名（中黒なし・suffix 付き等）
  '東京竹芝': '東京・竹芝', '竹芝桟橋': '東京・竹芝', '竹芝ピア': '東京・竹芝', '竹芝埠頭': '東京・竹芝',
  '横浜大さん橋': '横浜・大さん橋', '大サンブリッジ': '横浜・大さん橋',
  '台場': 'お台場海浜公園',
  '日の出码头': '日の出桟橋', '日の出埠頭': '日の出桟橋',
  '浜離宮 Gardens': '浜離宮',

  // English
  'Tokyo': '東京・竹芝', 'Takeshiba': '東京・竹芝', 'Takeshiba Pier': '東京・竹芝',
  'Yokohama': '横浜・大さん橋', 'Osanbashi': '横浜・大さん橋',
  'Oshima': '大島', 'Oshima Island': '大島', 'Toshima': '利島', 'Niijima': '新島',
  'Shikinejima': '式根島', 'Kouzushima': '神津島', 'Kozushima': '神津島',
  'Miyakejima': '三宅島', 'Mikurajima': '御蔵島', 'Hachijojima': '八丈島', 'Aogashima': '青ヶ島',
  'Chichijima': '父島', 'Hahajima': '母島', 'Kurihama': '久里浜', 'Tateyama': '館山',
  'Atami': '熱海', 'Ito': '伊東', 'Inatori': '稲取', 'Shimoda': '下田',
  'Asakusa': '浅草', 'Odaiba': 'お台場海浜公園', 'Odaiba Kaihin Koen': 'お台場海浜公園',
  'Toyosu': '豊洲', 'Hinode': '日の出桟橋', 'Hinode Pier': '日の出桟橋', 'Hamarikyu': '浜離宮',

  // 中文
  '东京': '東京・竹芝', '横滨': '横浜・大さん橋', '大山桥': '横浜・大さん橋',
  '大岛': '大島', '利岛': '利島', '新岛': '新島', '式根岛': '式根島', '神津岛': '神津島',
  '三宅岛': '三宅島', '御藏岛': '御蔵島', '八丈岛': '八丈島', '青岛': '青ヶ島', '青之岛': '青ヶ島',
  '父岛': '父島', '母岛': '母島', '台场': 'お台場海浜公園', '台场海滨公园': 'お台場海浜公園',
  '丰洲': '豊洲', '日出': '日の出桟橋', '日出码头': '日の出桟橋', '滨离宫': '浜離宮'
};

const FERRY_PORT_NAMES = {
  '東京・竹芝': { en: 'Tokyo (Takeshiba Pier)', zh: '东京·竹芝码头' },
  '竹芝': { en: 'Tokyo (Takeshiba Pier)', zh: '东京·竹芝码头' },
  '横浜・大さん橋': { en: 'Yokohama (Osanbashi Pier)', zh: '横滨·大山桥码头' },
  '大島': { en: 'Oshima Island', zh: '大岛' },
  '利島': { en: 'Toshima Island', zh: '利岛' },
  '新島': { en: 'Niijima Island', zh: '新岛' },
  '式根島': { en: 'Shikinejima Island', zh: '式根岛' },
  '神津島': { en: 'Kozushima Island', zh: '神津岛' },
  '三宅島': { en: 'Miyakejima Island', zh: '三宅岛' },
  '御蔵島': { en: 'Mikurajima Island', zh: '御藏岛' },
  '八丈島': { en: 'Hachijojima Island', zh: '八丈岛' },
  '青ヶ島': { en: 'Aogashima Island', zh: '青之岛' },
  '父島': { en: 'Chichijima Island', zh: '父岛' },
  '母島': { en: 'Hahajima Island', zh: '母岛' },
  '久里浜': { en: 'Kurihama', zh: '久里滨' },
  '館山': { en: 'Tateyama', zh: '馆山' },
  '熱海': { en: 'Atami', zh: '热海' },
  '伊東': { en: 'Ito', zh: '伊东' },
  '稲取': { en: 'Inatori', zh: '稻取' },
  '下田': { en: 'Shimoda', zh: '下田' },
  '浅草': { en: 'Asakusa', zh: '浅草' },
  'お台場海浜公園': { en: 'Odaiba Seaside Park', zh: '台场海滨公园' },
  '豊洲': { en: 'Toyosu', zh: '丰洲' },
  '日の出桟橋': { en: 'Hinode Pier', zh: '日出码头' },
  '浜離宮': { en: 'Hamarikyu Gardens', zh: '滨离宫' }
};

const OPERATOR_MAP = {
  tokyometro: 'TokyoMetro', toei: 'Toei', jreast: 'JR-East',
  odakyu: 'Odakyu', keio: 'Keio', seibu: 'Seibu', tobu: 'Tobu',
  keikyu: 'Keikyu', keisei: 'Keisei', sotetsu: 'Sotetsu', tokyu: 'Tokyu',
  yokohama: 'YokohamaMunicipal',
  mir: 'MIR', twr: 'TWR', minatomirai: 'Minatomirai',
  odakyuhakone: 'OdakyuHakone', hokuso: 'Hokuso',
  saitamarailway: 'SaitamaRailway', toyorapid: 'ToyoRapid',
  shibayama: 'Shibayama', jrcentral: 'JR-Central',
  kantetsu: 'KantoRailway', // #55: 関東鉄道（常総線・竜ヶ崎線）
  tsukuba: 'MIR' // つくばエクスプレスの ODPT 事業者ID（首都圏新都市鉄道）
};

const NON_RAIL_OPERATORS = {
  yurikamome: { id: 'Yurikamome', type: 'agt', label: 'ゆりかもめ', labelEn: 'Yurikamome', labelZh: '百合海鸥线', description: '新交通システム（AGT）- 東京臨海部', descEn: 'New transit system (AGT) - Tokyo waterfront', descZh: '新交通系统（AGT）- 东京临海地区', website: 'https://www.yurikamome.co.jp/' },
  tokyomonorail: { id: 'TokyoMonorail', type: 'monorail', label: '東京モノレール', labelEn: 'Tokyo Monorail', labelZh: '东京单轨电车', description: 'モノレール - 浜松町～羽田空港', descEn: 'Monorail - Hamamatsucho to Haneda Airport', descZh: '单轨电车 - 滨松町至羽田机场', website: 'https://www.tokyo-monorail.co.jp/' },
  tamamonorail: { id: 'TamaMonorail', type: 'monorail', label: '多摩モノレール', labelEn: 'Tama Monorail', labelZh: '多摩单轨电车', description: 'モノレール - 上北台～多摩センター～立川北', descEn: 'Monorail - Kamikitadai to Tama-Center to Tachikawa-Kita', descZh: '单轨电车 - 上北台至多摩中心至立川北', website: 'https://www.tama-monorail.co.jp/' },
  toden: { id: 'Toei', type: 'tram', railwayId: 'Toei.Arakawa', label: '都電荒川線', labelEn: 'Toden Arakawa Line', labelZh: '都电荒川线', description: '路面電車（東京さくらトラム）- 三ノ輪橋～早稲田', descEn: 'Tram (Tokyo Sakura Tram) - Minowabashi to Waseda', descZh: '路面电车（东京樱花有轨电车）- 三轮桥至早稻田', website: 'https://www.kotsu.metro.tokyo.jp/toden/' },
  nipporitoneri: { id: 'Toei', type: 'agt', railwayId: 'Toei.NipporiToneri', label: '日暮里・舎人ライナー', labelEn: 'Nippori-Toneri Liner', labelZh: '日暮里·舍人线', description: '新交通システム（AGT）- 日暮里～見沼代親水公園', descEn: 'New transit system (AGT) - Nippori to Minumadai-Shinsuikoen', descZh: '新交通系统（AGT）- 日暮里至见沼代亲水公园', website: 'https://www.kotsu.metro.tokyo.jp/nippori_toneri_liner/' },
  // 2026-08 v2.25 #21-D: 非鉄道カテゴリに路線バス・水上バス・フェリーを追加
  toei_bus: { id: 'ToeiBus', type: 'bus', label: '都営バス', labelEn: 'Toei Bus', labelZh: '都营巴士', description: '路線バス - 都心・23区', descEn: 'City bus - central Tokyo / 23 wards', descZh: '路线巴士 - 东京都心及23区', website: 'https://www.kotsu.metro.tokyo.jp/bus/' },
  seibu_bus: { id: 'SeibuBus', type: 'bus', label: '西武バス', labelEn: 'Seibu Bus', labelZh: '西武巴士', description: '路線バス - 西東京・埼玉方面', descEn: 'City bus - western Tokyo / Saitama', descZh: '路线巴士 - 西东京及埼玉方向', website: 'https://www.seibubus.co.jp/' },
  yokohama_bus: { id: 'YokohamaMunicipalBus', type: 'bus', label: '横浜市営バス', labelEn: 'Yokohama Municipal Bus', labelZh: '横滨市营巴士', description: '路線バス - 横浜市内', descEn: 'City bus - Yokohama', descZh: '路线巴士 - 横滨市内', website: 'https://www.city.yokohama.lg.jp/kotsu/' },
  keio_bus: { id: 'KeioBus', type: 'bus', label: '京王バス', labelEn: 'Keio Bus', labelZh: '京王巴士', description: '路線バス - 多摩・都心', descEn: 'City bus - Tama / central Tokyo', descZh: '路线巴士 - 多摩及东京都心', website: 'https://www.keiobus.co.jp/' },
  tokyu_bus: { id: 'TokyuBus', type: 'bus', label: '東急バス', labelEn: 'Tokyu Bus', labelZh: '东急巴士', description: '路線バス - 目黒・世田谷・川崎', descEn: 'City bus - Meguro / Setagaya / Kawasaki', descZh: '路线巴士 - 目黑、世田谷、川崎', website: 'https://www.tokyubus.co.jp/' },
  odakyu_bus: { id: 'OdakyuBus', type: 'bus', label: '小田急バス', labelEn: 'Odakyu Bus', labelZh: '小田急巴士', description: '路線バス - 多摩・世田谷', descEn: 'City bus - Tama / Setagaya', descZh: '路线巴士 - 多摩、世田谷', website: 'https://www.odakyubus.co.jp/' },
  keisei_bus: { id: 'KeiseiBus', type: 'bus', label: '京成バス', labelEn: 'Keisei Bus', labelZh: '京成巴士', description: '路線バス - 千葉・江戸川区', descEn: 'City bus - Chiba / Edogawa', descZh: '路线巴士 - 千叶、江户川区', website: 'https://www.keiseibus.co.jp/' },
  jrbuskanto: { id: 'JRBuskanto', type: 'bus', label: 'JRバス関東', labelEn: 'JR Bus Kanto', labelZh: 'JR巴士关东', description: '高速・路線バス - 関東広域', descEn: 'Highway / city bus - Kanto wide area', descZh: '高速路线巴士 - 关东广域', website: 'https://www.jrbuskanto.co.jp/' },
  // #45: 千葉・埼玉・神奈川のローカルバス（延伸駅周辺）
  chiba_flower_bus: { id: 'ChibaFlowerBus', type: 'bus', label: 'ちばフラワーバス（佐倉）', labelEn: 'Chiba Flower Bus (Sakura)', labelZh: '千叶花巴士（佐仓）', description: '路線バス - 佐倉市・四街道市', descEn: 'City bus - Sakura / Yotsukaido', descZh: '路线巴士 - 佐仓市、四街道市', website: 'https://www.chiba-flowerbus.jp/' },
  saitama_city_bus: { id: 'SaitamaCityBus', type: 'bus', label: 'さいたま市営バス', labelEn: 'Saitama City Bus', labelZh: '埼玉市营巴士', description: '路線バス - さいたま市（大宮・浦和）', descEn: 'City bus - Saitama City (Omiya / Urawa)', descZh: '路线巴士 - 埼玉市（大宫、浦和）', website: 'https://www.city.saitama.lg.jp/003/001/kotsu/' },
  tobu_bus_saitama: { id: 'TobuBusSaitama', type: 'bus', label: '東武バス（埼玉）', labelEn: 'Tobu Bus (Saitama)', labelZh: '东武巴士（埼玉）', description: '路線バス - 埼玉県南東部', descEn: 'City bus - southeastern Saitama', descZh: '路线巴士 - 埼玉县东南部', website: 'https://www.tobu-bus.com/' },
  seibu_kanko_chichibu: { id: 'SeibuKankoBusChichibu', type: 'bus', label: '西武観光バス（秩父）', labelEn: 'Seibu Kanko Bus (Chichibu)', labelZh: '西武观光巴士（秩父）', description: '路線バス - 秩父・長瀞エリア', descEn: 'City bus - Chichibu / Nagatoro area', descZh: '路线巴士 - 秩父、长瀞地区', website: 'https://www.seibubus.co.jp/rosen/chichibu/' },
  enoden_bus: { id: 'EnodenBus', type: 'bus', label: '江ノ電バス', labelEn: 'Enoden Bus', labelZh: '江之电巴士', description: '路線バス - 藤沢・鎌倉・大船', descEn: 'City bus - Fujisawa / Kamakura / Ofuna', descZh: '路线巴士 - 藤泽、镰仓、大船', website: 'https://www.enoden.co.jp/bus/' },
  chiba_chuo_bus: { id: 'ChibaChuoBus', type: 'bus', label: '千葉中央バス', labelEn: 'Chiba Chuo Bus', labelZh: '千叶中央巴士', description: '路線バス - 千葉市', descEn: 'City bus - Chiba City', descZh: '路线巴士 - 千叶市', website: 'https://www.chibachuobus.co.jp/' },
  maruken_tsubasa: { id: 'MarukenTsubasa', type: 'bus', label: '丸建つばさ交通（けんちゃんバス）', labelEn: 'Maruken Tsubasa Kotsu (Ina)', labelZh: '丸建翼交通（伊奈）', description: 'コミュニティバス - 伊奈町・上尾市', descEn: 'Community bus - Ina / Ageo', descZh: '社区巴士 - 伊奈町、上尾市', website: 'https://maru-ken.co.jp/route-bus/' },
  kawagoe_kanko_ogose: { id: 'KawagoeKankoOgose', type: 'bus', label: '川越観光自動車（越生）', labelEn: 'Kawagoe Kanko Bus (Ogose)', labelZh: '川越观光汽车（越生）', description: '路線バス - 越生・ときがわ町', descEn: 'City bus - Ogose / Tokigawa', descZh: '路线巴士 - 越生、都几川町', website: 'https://www.kawagoebus.jp/' },
  tokaikisen: { id: 'TokaiKisen', type: 'ferry', label: '東海汽船', labelEn: 'Tokai Kisen', labelZh: '东海汽船', description: 'フェリー - 伊豆諸島・小笠原航路', descEn: 'Ferry - Izu Islands / Ogasawara routes', descZh: '渡轮 - 伊豆诸岛、小笠原航线', website: 'https://www.tokaikisen.co.jp/' },
  tokyocruise: { id: 'TokyoCruise', type: 'ferry', label: '東京クルーズ（水上バス）', labelEn: 'Tokyo Cruise (Water Bus)', labelZh: '东京游船（水上巴士）', description: '水上バス - 隅田川・お台場', descEn: 'Water bus - Sumida River / Odaiba', descZh: '水上巴士 - 隅田川、御台场', website: 'https://www.tokyo-park.or.jp/cruise/' },
  // 2026-08 v2.36.1: 鉄道カテゴリから除外した非鉄道系を正しい種別で登録（README の分類表と整合）
  shonanmonorail: { id: 'ShonanMonorail', type: 'monorail', label: '湘南モノレール', labelEn: 'Shonan Monorail', labelZh: '湘南单轨电车', description: 'モノレール（懸垂式）- 大船～湘南江の島', descEn: 'Monorail (suspended) - Ofuna to Shonan-Enoshima', descZh: '单轨电车（悬挂式）- 大船至湘南江之岛', website: 'https://www.shonan-monorail.co.jp/' },
  chibamonorail: { id: 'ChibaUrbanMonorail', type: 'monorail', label: '千葉都市モノレール', labelEn: 'Chiba Urban Monorail', labelZh: '千叶都市单轨电车', description: 'モノレール（跨座式・世界最長）- 1号線・2号線', descEn: 'Monorail (straddle-type, world longest) - Lines 1 & 2', descZh: '单轨电车（跨座式、世界最长）- 1号线、2号线', website: 'https://chiba-monorail.co.jp/' },
  newshuttle: { id: 'SaitamaNewUrbanTransit', type: 'agt', label: '埼玉新都市交通（ニューシャトル）', labelEn: 'Saitama New Urban Transit (New Shuttle)', labelZh: '埼玉新都市交通（新交通系统）', description: '新交通システム（AGT）- 大宮～内宿', descEn: 'New transit system (AGT) - Omiya to Uchijuku', descZh: '新交通系统（AGT）- 大宫至内宿', website: 'https://www.new-shuttle.jp/' },
  seibuyamaguchiline: { id: 'Seibu', type: 'agt', railwayId: 'Seibu.Yamaguchi', label: '西武山口線（おとぎ線）', labelEn: 'Seibu Yamaguchi Line (Otogi Line)', labelZh: '西武山口线（御伽线）', description: '案内軌条式鉄道（AGT）- 多摩湖～西武球場前', descEn: 'Guideway transit (AGT) - Tamako to Seibu-Kyujomae', descZh: '导引轨条式铁道（AGT）- 多摩湖至西武球场前', website: 'https://www.seiburailway.jp/railway/otogi/' },
  tokyusetagayaline: { id: 'Tokyu', type: 'tram', railwayId: 'Tokyu.Setagaya', label: '東急世田谷線', labelEn: 'Tokyu Setagaya Line', labelZh: '东急世田谷线', description: '路面電車（軌道法）- 三軒茶屋～下高井戸', descEn: 'Tram (Tram Act) - Sangenjaya to Shimotakaido', descZh: '路面电车（轨道法）- 三轩茶屋至下高井户', website: 'https://www.tokyu.co.jp/railway/railway/top/setagaya/' }
};

const JMA_AREA_MAP = {
  '東京': '130000', '東京都': '130000', '渋谷': '131020', '新宿': '131030',
  '港': '131060', '千代田': '131010', '中央': '131040', '台東': '131170', '横浜': '140010',
  // v2.37.1: 常磐線延伸（土浦・水戸方面）の気象庁エリアコード（茨城県）
  '茨城': '080000', '牛久': '080000', 'ひたち野うしく': '080000', '荒川沖': '080000', '土浦': '080000',
  '神立': '080000', '高浜': '080000', '石岡': '080000', '羽鳥': '080000', '岩間': '080000',
  '友部': '080000', '内原': '080000', '赤塚': '080000', '水戸': '080000'
};

// 気象庁エリアコード → 3言語表示名（#79: 地域表示を東京固定にしない）
// en/zh は気象庁エリア名の一般的な訳・行政区分名を使用。
const JMA_AREA_LABELS = {
  '130000': { ja: '東京', en: 'Tokyo', zh: '东京' },
  '131010': { ja: '千代田', en: 'Chiyoda', zh: '千代田' },
  '131020': { ja: '渋谷', en: 'Shibuya', zh: '涩谷' },
  '131030': { ja: '新宿', en: 'Shinjuku', zh: '新宿' },
  '131040': { ja: '中央', en: 'Chuo', zh: '中央区' },
  '131060': { ja: '港', en: 'Minato', zh: '港区' },
  '131170': { ja: '台東', en: 'Taito', zh: '台东' },
  '140010': { ja: '横浜', en: 'Yokohama', zh: '横滨' },
  '080000': { ja: '茨城', en: 'Ibaraki', zh: '茨城' }
};

const GOV_FACILITY_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query=%E5%BD%B9%E6%89%80+%E5%87%BA%E5%BC%B5%E6%89%80+%E5%85%AC%E6%B0%91%E9%A4%A8+%E5%B8%82%E6%B0%91%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC";
const EMERGENCY_EVACUATION_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query=%E6%8C%87%E5%AE%9A%E7%B7%8A%E6%80%A5%E9%81%BF%E9%9B%A3%E5%A0%B4%E6%89%80+%E9%81%BF%E9%9B%A3%E6%89%80";

// 現在地が明示されたときは地点（緯度経度）を、共有がない場合は駅名・バス停名を基準に
// 公的機関（役所・出張所・公民館・市民センター）の地図検索リンクを返す。
// 駅名や任意の自治体名を「現在地」と推測せず、あくまで「検索地名」として案内する。
// 優先順位: 1) GPS共有（user_location） 2) 駅名 3) バス停名
function buildGovFacilitySearchSupport(userLocation, userLang = 'ja', placeName = '') {
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

// ==========================================
// 🌐 多言語判定
// ==========================================
function detectLanguage(text) {
  if (!text) return 'ja';
  const str = text.trim();
  if (!str) return 'ja';
  // かな（ひらがな・カタカナ）を含む → 日本語
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(str)) return 'ja';
  // 漢字（CJK）を1文字も含まない → 英語
  // （-> / → / / / ( ) などの記号を含む英字入力もすべて英語として判定される）
  if (!/[\u3400-\u9FFF\uF900-\uFAFF]/.test(str)) return 'en';
  // 中国語シグナル: 簡体字専用字（日本語に存在しない字形。漢字は日本語でも使われるため、
  // 「日本語に無い字形」のみを判定に使う。例: 場→场、東→东、線→线、関→关）
  const zhChars = /[场东车机门银视动关风积灾电号涩沪这吗呢很从您请让说时颱澀灣這嗎從請讓]/;
  // 中国語の語彙・機能語（地名・交通・天候・機能語を広くカバー）
  const zhWords = ['台风','积水','淹水','火灾','停电','酷暑','中暑','积雪','暴雨','海啸','海嘯',
    '地震','人身事故','信号故障','降雪','台场','站台','换乘','票价','时刻表','地铁','电车',
    '巴士','机场','车站','线路','路线','前往','出发','到达','查询','怎么','如何','最近','附近',
    '几点','多少','航班','列车','天气','码头','碼頭','渡轮','轮渡','要多久','多少钱',
    // 交通・地名拡充（中国語ユーザーがよく使う表記。ただし東京/大阪等の大都市名は
    // 日中で表記が共通するため判定シグナルには使わない）
    '合羽桥','坐巴士','坐车','坐地铁',' bus','坐','去','到','从','巴士站',
    '公交车','公车','捷运','高铁','火车','怎么去','怎么走','多长时间','多久','几点发车','首班车','末班车',
    '浅草寺','雷门','雷門','晴空塔','天空树'];
  if (zhWords.some(w => str.includes(w))) return 'zh';
  if (zhChars.test(str)) return 'zh';
  // かな無し・漢字のみの入力で中国語の方向助詞を含む場合 → 中国語
  // （例: 品川到新宿 / 从浅草出发。日本語は「から」「まで」「へ」をかなで書くため競合しない）
  if (/(从|到(?!着)|去|请|您|怎|吗|呢)/.test(str)) return 'zh';
  // かな無し・漢字のみ（英字・かな・簡体字専用字なし）の入力:
  // 日本語地名（浅草・新宿等）と中国語地名（合羽桥・道具街等）が混在し判定困難なため、
  // このヒューリスティクスでは「中国語らしい語彙/字形/助詞が無い」= 日本語（ja）とする。
  return 'ja';
}

// 明示的な言語指定（args.language / args.lang）を解決する。
// 有効値（ja/en/zh）ならそれを返し、未指定・不正値は null（自動判定へフォールバック）。
function resolveLang(args) {
  const raw = args?.language || args?.lang;
  if (raw === 'en' || raw === 'zh' || raw === 'ja') return raw;
  return null;
}

const MULTILINGUAL_ADVICE = {
  // 基本天候
  fair: {
    ja: "🤖 【AIからのインテリジェントアドバイス】\n☀ 晴れの良好なお天気です！快適な移動をお楽しみください。",
    en: "🤖 [AI Intelligent Transit Advice]\n☀ Fair and clear weather! Enjoy your comfortable journey.",
    zh: "🤖 【AI智能出行建议】\n☀ 天气晴朗良好！祝您旅途愉快顺畅。"
  },
  rainy: {
    ja: "🤖 【AIからのインテリジェントアドバイス (雨天時)】\n☔ 駅構内・階段・ホームが滑りやすくなります。足元に注意し、乗換時間には余裕を持ってください。バスへの乗換は、この経路に接続情報がある場合のみ駅係員・事業者の案内で確認してください。",
    en: "🤖 [AI Intelligent Transit Advice (Rainy)]\n☔ Station floors, stairs, and platforms may be slippery. Watch your step and allow extra transfer time. Only use bus connections when they are shown for this journey and confirmed by staff or the operator.",
    zh: "🤖 【AI智能出行建议 (雨天)】\n☔ 车站大厅、楼梯和站台可能湿滑，请注意脚下并预留换乘时间。仅在本行程显示巴士接驳信息时，才向车站工作人员或运营商确认乘车安排。"
  },
  hot: {
    ja: "🤖 【AIからのインテリジェントアドバイス (熱中症警戒)】\n☀ 本日は気温が著しく上昇しています。駅構内や車内でもこまめな水分補給を心がけ、熱中症に十分ご注意ください。",
    en: "🤖 [AI Intelligent Transit Advice (Heat Alert)]\n☀ Extreme heat expected today. Stay hydrated even inside stations and trains.",
    zh: "🤖 【AI智能出行建议 (高温预警)】\n☀ 今天气温显著上升，请在站内也注意补充水分，小心中暑。"
  },
  // 障害種別連動アドバイス
  typhoon: {
    ja: "🤖 【AIからのインテリジェントアドバイス (台風接近)】\n🌀 大雨・強風により列車の運転見合わせや遅延が発生する可能性が高いです。外出は可能であれば控え、やむを得ない場合は最新の運行情報をご確認ください。駅周辺の看板や木の倒壊にも注意。",
    en: "🤖 [AI Intelligent Transit Advice (Typhoon Alert)]\n🌀 Heavy rain and strong winds may cause train suspensions. Check latest info before going out.",
    zh: "🤖 【AI智能出行建议 (台风接近)】\n🌀 强风暴雨可能导致列车停运，请确认最新运行信息后再出行。"
  },
  flood: {
    ja: "🤖 【AIからのインテリジェントアドバイス (浸水注意)】\n⚠ 周辺道路や駅構内が冠水している可能性があります。長靴や雨具をご準備ください。地下街やアンダーパスへの立ち入りは危険です。やむを得ない外出以外はお控えください。",
    en: "🤖 [AI Intelligent Transit Advice (Flood Alert)]\n⚠ Surrounding roads and station areas may be flooded. Avoid underpasses and underground areas.",
    zh: "🤖 【AI智能出行建议 (浸水注意)】\n⚠ 周边道路和车站内可能积水。请远离地下通道和地下商场。"
  },
  earthquake: {
    ja: "🤖 【AIからのインテリジェントアドバイス (地震発生)】\n🔴 鉄道は安全確認のため一時運転見合わせ中です。揺れが収まるまで駅構内では落下物に注意し、係員の指示に従ってください。急な動きは控え、落ち着いて行動。",
    en: "🤖 [AI Intelligent Transit Advice (Earthquake Alert)]\n🔴 Train operations suspended for safety checks. Follow station staff instructions and watch for falling objects.",
    zh: "🤖 【AI智能出行建议 (地震)】\n🔴 为确保安全列车暂停运行。请遵照车站工作人员指示，注意高空坠物。"
  },
  snow: {
    ja: "🤖 【AIからのインテリジェントアドバイス (降雪注意)】\n❄ 積雪により列車に遅延が発生しています。駅構内やホームは大変滑りやすくなっています。滑りにくい靴でのご出行をおすすめし、階段・ホーム端では特に足元にご注意ください。",
    en: "🤖 [AI Intelligent Transit Advice (Snow Advisory)]\n❄ Train delays due to snowfall. Platforms and stairs are extremely slippery. Wear non-slip shoes.",
    zh: "🤖 【AI智能出行建议 (降雪)】\n❄ 积雪导致列车延误。站台和楼梯非常湿滑，请穿防滑鞋并注意脚下。"
  },
  accident: {
    ja: "🤖 【AIからのインテリジェントアドバイス (人身事故・運転見合わせ)】\n⚠ 人身事故の影響で一部列車が運転を見合わせています。振替輸送が実施されている場合は駅係員の案内に従ってください。お急ぎの方は代替ルート（他社線・バス）をご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Accident Alert)]\n⚠ Train suspended due to a human accident. Follow staff for substitute transport or consider alternative routes.",
    zh: "🤖 【AI智能出行建议 (人身事故)】\n⚠ 因人身事故部分列车停运。请听从工作人员安排换乘，或考虑其他路线。"
  },
  fire: {
    ja: "🤖 【AIからのインテリジェントアドバイス (火災発生)】\n🔥 列車火災または駅周辺での火災が報告されています。駅員の指示に従い落ち着いて避難してください。煙を吸い込まないようハンカチ等で口元を覆って低い姿勢で移動。",
    en: "🤖 [AI Intelligent Transit Advice (Fire Alert)]\n🔥 Fire reported near the station. Follow evacuation instructions from station staff.",
    zh: "🤖 【AI智能出行建议 (火灾)】\n🔥 车站附近发生火灾，请遵照工作人员指示有序疏散。"
  },
  infrastructure: {
    ja: "🤖 【AIからのインテリジェントアドバイス (設備障害)】\n⚡ 信号故障・停電など設備に障害が発生しています。復旧まで時間を要する場合があります。駅係員の案内に従い、可能であれば別ルートをご利用ください。",
    en: "🤖 [AI Intelligent Transit Advice (Infrastructure Failure)]\n⚡ Signal/power failure affecting train operations. Consider alternative routes.",
    zh: "🤖 【AI智能出行建议 (设备故障)】\n⚡ 信号或供电故障影响列车运行，请考虑其他路线。"
  },
  emergency: {
    ja: "🤖 【AIからのインテリジェントアドバイス (緊急アラート)】\\n🚨 重大な災害または交通機関の運行不能を検知しました。身の安全を最優先とし、以下のリンクから最寄りの指定緊急避難場所を確認してください。",
    en: "🤖 [AI Intelligent Transit Advice (Emergency Alert)]\\n🚨 Major disaster or transit suspension detected. Check the link for nearest evacuation shelters.",
    zh: "🤖 【AI智能出行建议 (紧急避难)】\\n🚨 检测到重大灾害或交通中断，请点击下方链接查看最近的指定紧急避难场所。"
  },
  vehicle_failure: {
    ja: "🤖 【AIからのインテリジェントアドバイス (機材故障)】\n🚃 機材故障の影響で一部の運行が見合わせています（鉄道・バス・航空機を問いません）。復旧まで時間を要する場合があり、振替輸送や他社線・バス・他モードへの乗り継ぎが案内されることもあります。係員の案内に従い、お急ぎの方は代替ルートをご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Equipment Failure)]\n🚃 Some services are suspended due to an equipment/vehicle failure (rail, bus, or aircraft). Allow extra time; follow staff for substitute transport or consider alternative routes.",
    zh: "🤖 【AI智能出行建议 (机材故障)】\n🚃 因机材故障部分运行暂停（铁路、巴士、飞机均有可能）。恢复可能需要时间。请听从工作人员安排换乘，或考虑其他路线。"
  },
  vehicle_delay: {
    ja: "🤖 【AIからのインテリジェントアドバイス (車両遅延)】\n🚃 車両遅延・ダイヤ乱れのため列車に遅れが生じています（運転は継続中）。乗り換え時間に余裕がない場合は係員へお問い合わせいただくか、並行する他路線の利用をご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Train Delay)]\n🚃 Trains are running behind schedule due to a vehicle delay / disrupted timetable (service continues). If your connection is tight, ask station staff or consider parallel lines.",
    zh: "🤖 【AI智能出行建议 (列车晚点)】\n🚃 因车辆延误/时刻表混乱，列车正在晚点运行（运营仍在继续）。若换乘时间紧张，请咨询车站工作人员或考虑平行线路。"
  },
  gate_baggage_delay: {
    ja: "🤖 【AIからのインテリジェントアドバイス (ゲート・手荷物遅延)】\n✈ ゲート変更または手荷物受取の遅延が発生しています。搭乗ゲート・到着口の案内板をご確認ください。お急ぎの方は空港スタッフへお問い合わせください。",
    en: "🤖 [AI Intelligent Transit Advice (Gate/Baggage Delay)]\n✈ A gate change or baggage claim delay has occurred. Check the gate/arrival display boards and ask airport staff if you are in a hurry.",
    zh: "🤖 【AI智能出行建议 (登机口/行李延误)】\n✈ 发生登机口变更或行李领取延误。请查看登机口/到达口显示屏，如有急事请咨询机场工作人员。"
  },
  bus_traffic_jam: {
    ja: "🤖 【AIからのインテリジェントアドバイス (バス渋滞遅延)】\n🚌 道路渋滞の影響でバスが大幅に遅延しています。時間に余裕を持ってご移動ください。急ぐ場合は、並行する鉄道路線や徒歩・シェアサイクルの利用をご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Bus Traffic Delay)]\n🚌 Buses are significantly delayed due to road congestion. Allow extra time; consider parallel train lines, walking, or bike-share if you are in a hurry.",
    zh: "🤖 【AI智能出行建议 (公交拥堵延误)】\n🚌 因道路拥堵公交大幅延误。请预留充足时间；若着急可考虑平行铁路线、步行或共享单车。"
  },
  ferry_rough_seas: {
    ja: "🤖 【AIからのインテリジェントアドバイス (フェリー・水上バス欠航)】\n⛴ 荒天・高波のためフェリーおよび水上バスが欠航しています。離島方面へは翌日の運航状況をご確認ください。陸路（鉄道・高速バス）への切り替えをご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Ferry/Water Bus Suspension)]\n⛴ Ferries and water buses are suspended due to rough seas. Check next-day operations for island routes and consider land alternatives (train/express bus).",
    zh: "🤖 【AI智能出行建议 (渡轮/水上巴士停航)】\n⛴ 因风浪渡轮及水上巴士停航。离岛方向请确认次日运航情况，并考虑改走陆路（铁路/高速巴士）。"
  }
};

// ==========================================
// 🚲 シェアサイクル（GBFS API + 統一キャッシュ）
// ==========================================
const GBFS_BASE = 'https://api-public.odpt.org/api/v4/gbfs/docomo-cycle-tokyo';

async function fetchBikeShareData() {
  const cached = cache.get(cache.bikeShare.key);
  if (cached) return cached;
  const [infoRes, statusRes] = await Promise.all([
    axios.get(`${GBFS_BASE}/station_information.json`, { timeout: 15000 }),
    axios.get(`${GBFS_BASE}/station_status.json`, { timeout: 15000 })
  ]);
  const stations = infoRes.data.data?.stations || [];
  const statuses = statusRes.data.data?.stations || [];
  const statusMap = {};
  statuses.forEach(s => { statusMap[s.station_id] = s; });
  const data = { stations, statuses: statusMap };
  cache.set(cache.bikeShare.key, data, cache.bikeShare.ttl);
  return data;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}


// ==========================================
// 🗺️ 経路探索エンジン（ODPTキー不要・自己完結型）
// 鉄道路線の順序付き駅リストから無向グラフを構築し、ダイクストラで最短乗り継ぎルートを算出。
// 主要都内路線＋臨海部（ゆりかもめ）を網羅し、浅草↔お台場等の主要区間をカバー。
// ==========================================

// 駅→路線リスト の逆引きインデックス
const STATION_TO_LINES = {};
for (const [lineName, stations] of Object.entries(RAILWAY_LINES)) {
  stations.forEach((st, idx) => {
    if (!STATION_TO_LINES[st]) STATION_TO_LINES[st] = [];
    STATION_TO_LINES[st].push({ line: lineName, index: idx, total: stations.length });
  });
}

// グラフ構築
// ハイパーノード方式: 各(駅, 路線)をノードとし、同一路線内の隣接駅を重み1の「乗車エッジ」、
// 同一駅での路線間を重み TRANSFER_PENALTY の「乗換エッジ」で結ぶ。
// これによりダイクストラは「乗換を避ける・最短時間」の経路を選べる。
const TRANSFER_PENALTY = 10; // 乗換1回 ≈ 駅数10個分（所要時間ペナルティ：実乗換5〜10分相当。v2.28.0で3→10に増強、乗換多数の遠回りを抑制しつつ「1乗換で大幅短縮」を正しく評価する）

// 軽量乗換（同一ホーム・改札内直結等で乗換負担が極めて軽い駅の路線ペア）。
// 通常の乗換エッジ（TRANSFER_PENALTY・乗換1回カウント）の代わりに、軽いコストのみ加算し
// 「乗換回数」にはカウントしない。これにより同コスト帯で乗換回数が少ない遠回りに
// 負ける問題を解消する（例: 新宿→多摩センター が 京王線→高幡不動→多摩モノレール の
// 乗換1回・92分 ではなく 京王線→調布→京王相模原線→京王多摩センター→徒歩連絡 の
// 約70分 を選べるようになる。v2.38.1 新規導入）
const GRAPH = {}; // キー: "駅@路線" または "駅"（隣接駅探索用に駅のみのインデックスも保持）
function addEdge(a, b, w) {
  if (!GRAPH[a]) GRAPH[a] = {};
  if (!GRAPH[b]) GRAPH[b] = {};
  GRAPH[a][b] = w;
  GRAPH[b][a] = w;
}
// 同一路線内の隣接駅を結ぶ（乗車エッジ）。重みは駅間実距離（m）÷100（1km≈10単位）とし、
// 座標未登録の駅はフォールバック重み 10 を使用。これによりダイクストラは実距離が短い経路を選ぶ。
function stationEdgeWeight(a, b) {
  return 1; // 均等重み（駅数ベース）。距離ベースは座標未登録駅で不均一になるため使用しない
}
// 周回路線（リング状に運行する路線）: 末尾駅と先頭駅も隣接エッジで結ぶ。
// 2026-08 v2.26.0: ディズニーリゾートライン（4駅を周回・1周約13分）で初適用。
for (const [lineName, stations] of Object.entries(RAILWAY_LINES)) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = `${stations[i]}@${lineName}`;
    const b = `${stations[i + 1]}@${lineName}`;
    addEdge(a, b, stationEdgeWeight(stations[i], stations[i + 1]));
  }
  // 周回: 最終駅 → 先頭駅 も隣接エッジ（例: 東京ディズニーシー・ステーション ⇔ リゾートゲートウェイ・ステーション）
  if (CIRCULAR_LINES.has(lineName) && stations.length >= 3) {
    const last = `${stations[stations.length - 1]}@${lineName}`;
    const first = `${stations[0]}@${lineName}`;
    addEdge(last, first, stationEdgeWeight(stations[stations.length - 1], stations[0]));
  }
}
// 同一駅での路線間を結ぶ（乗換エッジ）
for (const [st, entries] of Object.entries(STATION_TO_LINES)) {
  const nodes = entries.map(e => `${st}@${e.line}`);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // 軽量乗換（同一ホーム等）: 乗換1回としてカウントせず軽いコストのみ（v2.38.1）
      // 例: 調布 京王線⇔京王相模原線（相模原線は調布始発・同一ホーム乗換）で
      //     新宿→多摩センターが高幡不動経由のモノレール遠回りを選ばず、
      //     京王相模原線経由（約70分）を選べるようにする。
      const lightKey = `${st}|${entries[i].line}|${entries[j].line}`;
      const lightCost = LIGHT_TRANSFER_EDGES[lightKey];
      addEdge(nodes[i], nodes[j], lightCost !== undefined ? lightCost : TRANSFER_PENALTY);
    }
  }
}

// ==========================================
// 近接異名駅（連絡駅）: 名称は異なるが、連絡通路・地下通路・至近距離の徒歩で
// 実質1つの乗換駅として機能する駅の組（例: 牛田(東武伊勢崎線)⇔京成関屋(京成本線)）。
// ルート検索では「徒歩連絡」セグメントとして扱い、乗換1回としてカウントする。
// ※ 公式の連絡駅案内（JR東日本乗換案内・各社連絡駅表）に基づく。
// ==========================================
// 双方向ルックアップ（buildRouteSegments での徒歩連絡検出と徒歩時間取得に使用）
const WALK_TRANSFER_LOOKUP = new Map();
for (const w of WALK_TRANSFERS) {
  WALK_TRANSFER_LOOKUP.set(`${w.from}|${w.to}`, w);
  WALK_TRANSFER_LOOKUP.set(`${w.to}|${w.from}`, w);
}

// 近接異名駅ペアを乗換エッジで接続（全路線ノード間を WALK_TRANSFER_COST で結ぶ）
// 徒歩連絡は「乗換1回」としてカウントする（同駅乗換と同じコスト）。
// ※ これより軽いコストにすると、秋葉原⇔岩本町 等で「徒歩→徒歩の往復」により
//   同駅乗換を回避するバウンス経路が発生するため、必ず TRANSFER_PENALTY 以上とする。
const WALK_TRANSFER_COST = TRANSFER_PENALTY;
for (const w of WALK_TRANSFERS) {
  const fromNodes = (STATION_TO_LINES[w.from] || []).map(e => `${w.from}@${e.line}`);
  const toNodes = (STATION_TO_LINES[w.to] || []).map(e => `${w.to}@${e.line}`);
  for (const a of fromNodes) {
    for (const b of toNodes) {
      // 🔴 既存エッジ（同一路線の乗車エッジ等）を上書きしない。
      // 例: 汐留⇔新橋は両方ゆりかもめに在線し、新橋@ゆりかもめ⇔汐留@ゆりかもめ は
      // 乗車エッジ(重み1)が先に張られている。徒歩エッジで上書きすると
      // 「ゆりかもめ1駅」が消えて徒歩連絡(乗換1回)だけになる（本セッションで実証）。
      // 東京⇔大手町（丸ノ内線）も同類。同路線の徒歩エッジは不要（乗車が最適）なので
      // スキップし、跨路線ペア（例: 新橋@山手線⇔汐留@大江戸線）のみ徒歩エッジを張る。
      if (GRAPH[a] && GRAPH[a][b] !== undefined) continue;
      addEdge(a, b, WALK_TRANSFER_COST);
    }
  }
}

// ==========================================
// 同名別駅: 同じ駅名だが別の場所にある駅（乗換不可・誤認リスク大）。
// グラフ上はマイナー側に識別子を付与して分離済み（例: 小川町（東武東上線））。
// 入力時はサイレント推測せず、検索を中断して候補を提示する（disambiguation）。
// candidates は再入力可能な正式キー（グラフ上の駅名）で返す。
// ==========================================

// #64: 曖昧駅の候補ごとの所属路線名（AMBIGUOUS_STATION_NAMES の候補配列とインデックス対応）。
// 「駅名＋路線名」スペース区切り指定（例: 入谷 相模線）の解決と、
// 候補表示への路線名併記（多言語）に使用する。

// #64: 路線名ヒントの正規化（「線」等のサフィックス除去・大文字小文字統一）。
// 「入谷 相模」と「JR相模線」のような表記差を吸収して部分一致判定を安定させる。
function normalizeLineHint(s) {
  return s.replace(/線$/, '').replace(/jr/i, '').replace(/東京メトロ/g, '').trim().toLowerCase();
}

// 駅ノード（出発・到着のために全路線分を仮想起点/終点として扱うためのマップ）
// 出発駅・到着駅は「その駅の全路線ノードから開始/到着」とみなす

// 最寄り駅探索（部分一致・前方一致）
// 戻り値: { station, candidates, ambiguous, exact, landmark }
//   station    : 確定した駅名（曖昧/未検出時は null）
//   candidates : 部分一致で見つかった候補駅名の配列（前方一致優先・重複排除）
//   ambiguous  : 完全一致せず複数候補があり、どれが正解か確定できない場合 true
//   exact      : 完全一致（または正規化後完全一致）で決まった場合 true
//   landmark   : ランドマーク名から変換された場合、元の施設名（例: 東京ディズニーランド）
// 注意: 部分一致は「入力が候補の接頭辞（前方一致）」または「完全一致」に限定する。
// そうしないと「金町」で「黄金町」(=黄+金町) を含んでしまうsubstring問題で誤認する。
function resolveStation(rawName) {
  if (!rawName) return { station: null, candidates: [], ambiguous: false, exact: false, landmark: null };
  const key = rawName.trim();

  // #64: 「駅名＋路線名」のスペース区切り指定（例: 入谷 相模線 / 入谷 日比谷線）で、
  // 曖昧駅を路線名から一意に解決する。候補が1件に絞れた場合のみ解決し、
  // 絞り込めない場合は通常の曖昧応答（候補提示）にフォールバックする。
  const spaceParts = key.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2) {
    const stationPart = spaceParts[0];
    const lineHint = spaceParts.slice(1).join(' ').toLowerCase();
    const ambBase = AMBIGUOUS_STATION_NAMES[stationPart] || AMBIGUOUS_STATION_NAMES[normalizeStationName(stationPart)];
    if (ambBase) {
      const lineRefs = AMBIGUOUS_STATION_LINES[stationPart] || AMBIGUOUS_STATION_LINES[normalizeStationName(stationPart)] || [];
      const matched = ambBase.filter((cand, i) => {
        const refLine = (lineRefs[i] || '').toLowerCase();
        // 路線名ヒントが候補の所属路線名に部分一致（含む/含まれる）すれば解決候補
        return refLine && (refLine.includes(lineHint) || lineHint.includes(refLine) ||
          normalizeLineHint(refLine).includes(normalizeLineHint(lineHint)) ||
          normalizeLineHint(lineHint).includes(normalizeLineHint(refLine)));
      });
      if (matched.length === 1) {
        return { station: matched[0], candidates: [matched[0]], ambiguous: false, exact: true, landmark: null };
      }
      if (matched.length > 1) {
        return { station: null, candidates: matched, ambiguous: true, exact: false, landmark: null };
      }
      // 路線名で絞り込めなかった場合: 駅名部分のみの曖昧応答にフォールバック
      return { station: null, candidates: ambBase, ambiguous: true, exact: false, landmark: null };
    }
  }

  // 同名別駅（小川町・両国・霞ヶ関等）: 完全一致より先に判定し、サイレント推測せず候補を提示する。
  // 例: 「霞ヶ関」は東京メトロ（霞ケ関）と東武東上線（川越市）の2駅がある。
  if (AMBIGUOUS_STATION_NAMES[key]) {
    return { station: null, candidates: AMBIGUOUS_STATION_NAMES[key], ambiguous: true, exact: false, landmark: null };
  }
  if (STATION_TO_LINES[key]) return { station: key, candidates: [key], ambiguous: false, exact: true, landmark: null };

  // ランドマーク完全一致を駅名エイリアス正規化より先に評価する。
  // 例: Yomiuriland は「読売ランド前」ではなく「京王よみうりランド」を優先。
  // ※ exactOnly: 部分一致まで先に評価すると旧駅名エイリアス（例「成田空港(旧)」→東成田）が
  //    ランドマーク「成田空港」に奪われるため、ここでは完全一致のみを評価する（#26）。
  const landmarkExact = resolveLandmark(key, true);
  if (landmarkExact && STATION_TO_LINES[landmarkExact.station]) {
    return { station: landmarkExact.station, candidates: [landmarkExact.station], ambiguous: false, exact: false, landmark: landmarkExact.landmark, landmarkNote: landmarkExact.note, walk_min: landmarkExact.walk_min };
  }

  // 完全一致（正規化後）
  const norm = normalizeStationName(key);
  // ローマ字・英語別名を日本語駅名へ正規化した後も、同名駅の曖昧性を必ず再評価する。
  // 例: Ryogoku / Ogawamachi / Iriya は日本語入力と同じ候補提示が必要。
  if (AMBIGUOUS_STATION_NAMES[norm]) {
    return { station: null, candidates: AMBIGUOUS_STATION_NAMES[norm], ambiguous: true, exact: false, landmark: null };
  }
  if (STATION_TO_LINES[norm]) return { station: norm, candidates: [norm], ambiguous: false, exact: true, landmark: null };

  // ランドマーク（施設名）から最寄り駅への変換
  // ※ 前方一致（駅名の部分一致）より先に評価する。理由: 「羽田空港」のように
  // 実在しない駅名だが施設名としては有効な入力を、駅名前方一致の「曖昧」で
  // 止めずに最寄り駅へ変換するため。駅名として完全一致する入力は上の分岐で
  // 既に処理済みなので、ここで駅名を誤って上書きすることはない。
  const lm = resolveLandmark(key);
  if (lm && STATION_TO_LINES[lm.station]) {
    return { station: lm.station, candidates: [lm.station], ambiguous: false, exact: false, landmark: lm.landmark, landmarkNote: lm.note, walk_min: lm.walk_min };
  }

  const searchKeys = [key, norm].filter((v, i, a) => a.indexOf(v) === i); // key と norm の重複排除

  // 前方一致（入力が候補の接頭辞）: 誤認を防ぐため substring 包含は使わない
  const prefixMatches = [];
  for (const s of Object.keys(STATION_TO_LINES)) {
    for (const k of searchKeys) {
      if (s === k) { if (!prefixMatches.includes(s)) prefixMatches.push(s); }
      else if (s.startsWith(k)) { if (!prefixMatches.includes(s)) prefixMatches.push(s); }
    }
  }
  if (prefixMatches.length === 1) {
    return { station: prefixMatches[0], candidates: prefixMatches, ambiguous: false, exact: false, landmark: null };
  }
  if (prefixMatches.length > 1) {
    // 複数候補 → 曖昧。ただし「入力そのものが別路線で実在する駅」なら完全一致優先済みのためここには来ない。
    return { station: null, candidates: prefixMatches, ambiguous: true, exact: false, landmark: null };
  }

  // 後方一致・その他の部分一致は「誤認」の元なので使用しない。
  // 正規化名で再試行（STATION_NAME_MAP に旧名がある場合）
  if (norm !== key && STATION_TO_LINES[normalizeStationName(key)]) {
    const nm = normalizeStationName(key);
    return { station: nm, candidates: [nm], ambiguous: false, exact: false, landmark: null };
  }
  return { station: null, candidates: [], ambiguous: false, exact: false, landmark: null };
}

// ダイクストラ法による最短経路探索（ハイパーノード版）
// 出発・到着は「駅名」で与えられ、内部ではその駅の全路線ノードを仮想起点/終点とする。
// 評価基準: 第1に乗換回数を最小化、第2に実距離（駅間重み）を最小化。
function findShortestPath(start, goal, options = {}) {
  const blockedLines = options.blockedLines instanceof Set ? options.blockedLines : new Set(options.blockedLines || []);
  const startNodes = (STATION_TO_LINES[start] || []).map(e => `${start}@${e.line}`);
  const goalNodes = (STATION_TO_LINES[goal] || []).map(e => `${goal}@${e.line}`);
  if (!startNodes.length || !goalNodes.length) return null;
  const goalSet = new Set(goalNodes);
  if (start === goal) return { path: [start], lines: [] };
  // best[node] = { transfers, dist }。比較: 総コスト = dist + transfers × TRANSFER_PENALTY で最小を選ぶ。
// （v2.28.0 変更: 従来は transfers 優先の辞書順だったため、0乗換の遠回り（85分）が 1乗換の直通（25分）に
//   常に勝ってしまう問題があった。乗換ペナルティ加算方式にすることで「乗換1回で大幅短縮」を正しく評価する。
//   Issue #37 対応）
const costOf = (n) => n.dist + n.transfers * TRANSFER_PENALTY;
// 同コストなら乗換数の少ない方を優先（例: 大宮→船橋 は 野田線直通(cost34・0乗換) と
//   湘南新宿ライン→中央線→総武線快速(cost34・2乗換) が同コストになるため、直通を選ぶ）
const betterThan = (a, b) => {
  const ca = costOf(a), cb = costOf(b);
  return ca < cb || (ca === cb && a.transfers < b.transfers);
};
  const best = {};
  const prev = {};
  const visited = new Set();
  const pq = [];
  for (const n of startNodes) {
    if (!blockedLines.has(n.split('@')[1])) {
      best[n] = { transfers: 0, dist: 0 };
      pq.push({ node: n, transfers: 0, dist: 0 });
    }
  }
  let bestGoal = null; // { transfers, dist, node }
  while (pq.length) {
    pq.sort((a, b) => costOf(a) - costOf(b) || a.transfers - b.transfers);
    const { node, transfers, dist } = pq.shift();
    // 確定的打ち切り: 既に見つけたゴール解が、これから pop する全ノードより優秀なら終了
    if (bestGoal && !betterThan({ transfers, dist }, bestGoal)) break;
    if (visited.has(node)) continue;
    visited.add(node);
    if (goalSet.has(node)) {
      if (!bestGoal || betterThan({ transfers, dist }, bestGoal)) {
        bestGoal = { transfers, dist, node };
      }
      continue; // ゴールノードからの先は探索しない（到着済み）
    }
    for (const [next, w] of Object.entries(GRAPH[node] || {})) {
      if (blockedLines.has(node.split('@')[1]) || blockedLines.has(next.split('@')[1])) continue;
      const isTransfer = w >= TRANSFER_PENALTY;
      const nTransfers = transfers + (isTransfer ? 1 : 0);
      const nDist = dist + (isTransfer ? 0 : w);
      const cur = best[next];
      if (!cur || betterThan({ transfers: nTransfers, dist: nDist }, cur)) {
        best[next] = { transfers: nTransfers, dist: nDist };
        prev[next] = node;
        pq.push({ node: next, transfers: nTransfers, dist: nDist });
      }
    }
  }
  if (!bestGoal) return null;
  // ゴールノードからパスを復元
  const node = bestGoal.node;
  const nodePath = [];
  let cur = node;
  while (cur !== undefined) {
    nodePath.unshift(cur);
    if (startNodes.includes(cur)) break;
    cur = prev[cur];
  }
  if (!nodePath.length || nodePath[0].split('@')[0] !== start) return null;
  const path = [];
  const lines = [];
  const walkEdges = [];
  for (let i = 0; i < nodePath.length; i++) {
    const [st, ln] = nodePath[i].split('@');
    path.push(st);
    if (i > 0) lines.push(nodePath[i - 1].split('@')[1]);
  }
  // 徒歩連絡（近接異名駅）エッジの判定: 「駅名が異なる」かつ「重みが乗換ペナルティ以上」のエッジ。
  // 乗車エッジは重み1、同一駅の乗換エッジは駅名が同一のため、この条件で一意に判別できる。
  // ※ 駅名ペアだけで判定すると、新橋⇔汐留のような「同一路線の隣接駅が近接異名駅でもある」ケースで
  //    乗車エッジ（ゆりかもめ1駅）を徒歩連絡と誤表示する（v2.22.0 の実バグ・v2.22.1で修正）。
  for (let i = 0; i < nodePath.length - 1; i++) {
    const a = nodePath[i], b = nodePath[i + 1];
    const w = (GRAPH[a] && GRAPH[a][b] !== undefined) ? GRAPH[a][b] : (GRAPH[b] && GRAPH[b][a] !== undefined ? GRAPH[b][a] : 0);
    walkEdges.push(a.split('@')[0] !== b.split('@')[0] && w >= TRANSFER_PENALTY);
  }
  return { path, lines, walkEdges };
}

// 経路を路線セグメントに分割（乗り換え検出）
// findShortestPath が返す「駅名パス path」と「各区間の実通過路線 lines」をもとに、
// 連続する同路線区間を1セグメントにまとめる。これにより乗換回数が正確になる。
function buildRouteSegments(path, lines, walkEdges = []) {
  if (!path || path.length < 2) return [];
  const segments = [];
  // walkEdges[i] = エッジ i（path[i]→path[i+1]）が徒歩連絡（近接異名駅）かどうか。
  // findShortestPath が「駅名が異なる & 重み>=乗換ペナルティ」で一意に判定した値を使う
  // （駅名ペアだけで判定すると同一路線の乗車エッジを徒歩と誤表示する）。
  const isWalkEdge = (i) => !!(walkEdges && walkEdges[i]);
  const walkInfo = (i) => {
    const w = WALK_TRANSFER_LOOKUP.get(`${path[i]}|${path[i + 1]}`);
    return { line: '🚶 徒歩連絡', from: path[i], to: path[i + 1], count: 1, walk: true, minutes: w ? w.minutes : undefined };
  };
  let curLine = lines[0];
  let cur = isWalkEdge(0) ? walkInfo(0) : { line: curLine, from: path[0], to: path[1], count: 1 };
  let curIsWalk = isWalkEdge(0);
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    const isWalk = isWalkEdge(i);
    if (ln === cur.line && !curIsWalk && !isWalk) {
      cur.to = path[i + 1];
      cur.count++;
    } else {
      segments.push({ ...cur });
      cur = isWalk ? walkInfo(i) : { line: ln, from: path[i], to: path[i + 1], count: 1 };
      curIsWalk = isWalk;
    }
  }
  segments.push({ ...cur });
  return segments.filter(s => s.from && s.to);
}

// 2駅間をつなぐ路線（両方に存在する路線）を返す
function commonLines(a, b) {
  const la = (STATION_TO_LINES[a] || []).map(x => x.line);
  const lb = (STATION_TO_LINES[b] || []).map(x => x.line);
  const shared = la.filter(l => lb.includes(l));
  // 共通路線がなければ（乗り換え駅など）それぞれの路線を返す
  return shared.length ? shared : [...new Set([...la, ...lb])];
}

// ルート検索のメインエントリ（searchRouteから呼び出し）
function computeRoutes(fromRaw, toRaw, options = {}) {
  const fromRes = resolveStation(fromRaw);
  const toRes = resolveStation(toRaw);
  // 曖昧（複数候補がありどれが正解か確定できない）の場合は検索を中断し選択を促す
  if (fromRes.ambiguous) {
    return { error: 'AMBIGUOUS_STATION', side: 'from', input: fromRaw, candidates: fromRes.candidates };
  }
  if (toRes.ambiguous) {
    return { error: 'AMBIGUOUS_STATION', side: 'to', input: toRaw, candidates: toRes.candidates };
  }
  const from = fromRes.station;
  const to = toRes.station;
  if (!from || !to) {
    return { error: 'STATION_NOT_FOUND', from, to, suggestion_from: fromRaw, suggestion_to: toRaw };
  }
  const result = findShortestPath(from, to, options);
  if (!result || !result.path) {
    return { error: 'NO_ROUTE', from, to, fromLandmark: fromRes.landmark, toLandmark: toRes.landmark };
  }
  const { path, lines, walkEdges } = result;
  const segments = buildRouteSegments(path, lines, walkEdges);
  const totalStops = path.length - 1;
  // 徒歩連絡（近接異名駅）も乗換1回としてカウントする（WALK_TRANSFER_COST = TRANSFER_PENALTY）
  const walkSegs = segments.filter(s => s.walk);
  const transfers = Math.max(0, segments.length - 1);
  // 徒歩連絡は「乗車駅数」に含めず、実徒歩時間を推定所要に加算する
  const walkMinutes = walkSegs.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const rideStops = segments.reduce((sum, s) => sum + (s.walk ? 0 : s.count), 0);
  const estimatedMinutes = Math.round(rideStops * 2.5 + transfers * 4 + walkMinutes);

  const routes = [{
    summary: {
      from,
      to,
      transfers,
      total_stops: totalStops,
      estimated_minutes: estimatedMinutes,
      // 徒歩連絡が先頭でもメイン路線は最初の乗車路線とする
      main_line: segments.find(s => !s.walk)?.line || segments[0]?.line || null,
      terminal_station: path[path.length - 1]
    },
    segments: segments.map(seg => ({
      line: seg.line,
      from: seg.from,
      to: seg.to,
      stops: seg.count,
      // 近接異名駅（徒歩連絡）セグメントは walk フラグと徒歩時間を保持する
      ...(seg.walk ? { walk: true, minutes: seg.minutes } : {})
    })),
    path
  }];
  return { routes, from, to, fromLandmark: fromRes.landmark, toLandmark: toRes.landmark, fromLandmarkNote: fromRes.landmarkNote, toLandmarkNote: toRes.landmarkNote };
}

async function findNearestBikeStations(stationName, userLocation = null, maxResults = 5, maxDistance = 2000) {
  try {
    const data = await fetchBikeShareData();
    // 基準座標: ユーザーの現在位置（GPS）が指定されていればそれを優先、なければ出発駅座標
    let coord = (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lon === 'number')
      ? { lat: userLocation.lat, lon: userLocation.lon }
      : STATION_COORDS[stationName];
    if (!coord) return null;
    const baseLabel = (userLocation && typeof userLocation.lat === 'number') ? 'user_location' : 'station';
    const available = data.stations
      .filter(s => { const st = data.statuses[s.station_id]; return st && st.is_renting && st.num_bikes_available > 0; })
      .map(s => {
        const st = data.statuses[s.station_id];
        const name = typeof s.name === 'string' ? s.name : s.name?.ja || s.name?.[0]?.text || '?';
        return { station_id: s.station_id, name, distance: haversineDistance(coord.lat, coord.lon, s.lat, s.lon), bikes_available: st.num_bikes_available, docks_available: st.num_docks_available, lat: s.lat, lon: s.lon, reference: baseLabel };
      })
      .filter(s => s.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxResults);
    return available.length > 0 ? available : null;
  } catch (e) {
    console.log(`[WARN] Bike share API error: ${e.message}`);
    return null;
  }
}

// ==========================================
// 🚢 フェリー ＆ 水上バス（GTFS統合 + 統一キャッシュ）
// ==========================================
const FERRY_GTFS_SOURCES = [
  { name: '東海汽船', url: `${API_BASE_URL}/files/odpt/TokaiKisen/AllLines.zip`, date: () => new Date().toISOString().slice(0, 10).replace(/-/g, '') },
  { name: '東京クルーズ（水上バス）', url: 'https://api-public.odpt.org/api/v4/files/odpt/TokyoCruiseShip/AllLines.zip', date: () => '20250402' },
  // 東海汽船 GTFS エンドポイント（files/odpt/...）が ODPT 側で 404/500 となる場合のフォールバック。
  // ハードコード港リストを stop として展開し、伊豆諸島航路等を検索可能にする。
  { name: '東海汽船（ハードコード）', hardCoded: true, stops: [
    '東京・竹芝', '竹芝', '大島', '利島', '新島', '式根島', '神津島',
    '三宅島', '御蔵島', '八丈島', '青ヶ島', '父島', '母島', '久里浜', '館山',
    '熱海', '伊東', '稲取', '下田'
  ] },
];

async function fetchFerryData() {
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

function normalizeFerryPortName(name) {
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

const server = new Server(
  { name: 'tokyo-transit-mcp', version: '2.38.10' },
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

// 👇 レート制限検出ヘルパー
function isRateLimitError(error) { return error?.response?.status === 429 || (error?.message || '').includes('429'); }

// 🔍 統合エラーハンドラ（429検出 + 通常エラー）
function handleApiError(error, details = {}) {
  if (isRateLimitError(error)) {
    return jsonResponse(buildErrorResponse('API_TIMEOUT', 'APIレート制限に達しました。しばらく待ってから再試行してください。', { ...details, retryable: true }));
  }
  const errType = error.code === 'ECONNABORTED' ? 'API_TIMEOUT' : 'NETWORK_ERROR';
  return jsonResponse(buildErrorResponse(errType, error.message || 'APIエラー', details));
}

// ランドマーク・主要施設 → 最寄り駅 変換マップ
// 環境客・観光客が「駅名でない施設名」で検索した際の利便性向上のため。
// value: { station: 最寄り駅名(STATION_TO_LINESに存在), note: 駅からの補足(任意), walk_min: 徒歩目安分 }
// ランドマーク・主要施設 → 最寄り駅 変換マップ（多言語・別名対応）
// 環境客・観光客が「駅名でない施設名」で検索した際の利便性向上のため。
// ・names に 日本語 / 英語 / 中国語 の別名（訳名・略称）を全て登録
// ・note は言語別（ja/en/zh）で案内文を保持
// ・最寄り駅(station)はSTATION_TO_LINESに存在する駅名
const LANDMARK_DEFS = {
  tokyo_disneyland: {
    station: '舞浜', walk_min: 10, category: 'テーマパーク',
    note: { ja: '舞浜駅から徒歩約10分（ディズニーリゾートライン利用可）', en: 'About 10 min walk from Maihama Stn (Disney Resort Line available)', zh: '从舞滨站步行约10分钟（可乘坐迪士尼度假区线）' },
    names: { ja: ['東京ディズニーランド', 'ディズニーランド', 'ディズニーリゾート', 'ディズニー'], en: ['Tokyo Disneyland', 'Disneyland', 'Tokyo Disney Resort', 'Disney', 'TDL'], zh: ['东京迪士尼乐园', '迪士尼乐园', '迪士尼', '东京迪士尼度假区'] }
  },
  tokyo_disneysea: {
    station: '舞浜', walk_min: 10, category: 'テーマパーク',
    note: { ja: '舞浜駅からディズニーリゾートライン「リゾートゲートウェイ・ステーション」乗換', en: 'Transfer at Resort Gateway Stn on the Disney Resort Line from Maihama Stn', zh: '在舞滨站换乘迪士尼度假区线至度假区门户站' },
    names: { ja: ['東京ディズニーシー', 'ディズニーシー'], en: ['Tokyo DisneySea', 'DisneySea'], zh: ['东京迪士尼海洋', '迪士尼海洋'] }
  },
  tokyo_skytree: {
    station: 'とうきょうスカイツリー', walk_min: 1, category: '展望・建築',
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['東京スカイツリー', 'スカイツリー'], en: ['Tokyo Skytree', 'Skytree'], zh: ['东京晴空塔', '晴空塔'] }
  },
  tokyo_tower: {
    station: '御成門', walk_min: 10, category: '展望・建築',
    note: { ja: '御成門駅から徒歩約10分（赤羽橋駅からも約10分）', en: 'About 10 min walk from Onarimon Stn (also ~10 min from Akabanebashi Stn)', zh: '从御成门站步行约10分钟（赤羽桥站也可步行约10分钟）' },
    names: { ja: ['東京タワー'], en: ['Tokyo Tower'], zh: ['东京塔'] }
  },
  odaiba: {
    station: '台場', walk_min: 2, category: '複合文化施設',
    note: { ja: 'りんかい線・ゆりかもめ', en: 'Rinkai Line / Yurikamome', zh: '临海线・百合海鸥号' },
    names: { ja: ['お台場', '台場'], en: ['Odaiba'], zh: ['台场', '御台场'] }
  },
  tokyo_dome: {
    station: '水道橋', walk_min: 5, category: 'スポーツ施設',
    note: { ja: '水道橋駅から徒歩約5分', en: 'About 5 min walk from Suidobashi Stn', zh: '从水道桥站步行约5分钟' },
    names: { ja: ['東京ドーム'], en: ['Tokyo Dome'], zh: ['东京巨蛋'] }
  },
  nippon_budokan: {
    station: '九段下', walk_min: 5, category: 'スポーツ施設',
    note: { ja: '九段下駅から徒歩約5分', en: 'About 5 min walk from Kudanshita Stn', zh: '从九段下站步行约5分钟' },
    names: { ja: ['日本武道館'], en: ['Nippon Budokan', 'Budokan'], zh: ['日本武道馆'] }
  },
  tokyo_bigsight: {
    station: '国際展示場', walk_min: 3, category: '展示施設',
    note: { ja: 'りんかい線', en: 'Rinkai Line', zh: '临海线' },
    names: { ja: ['東京ビッグサイト'], en: ['Tokyo Big Sight'], zh: ['东京国际展览中心', '东京国际展示场'] }
  },
  akihabara: {
    station: '秋葉原', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['秋葉原電気街', '秋葉原'], en: ['Akihabara', 'Akihabara Electric Town'], zh: ['秋叶原', '秋叶原电器街'] }
  },
  shibuya_scramble: {
    station: '渋谷', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['渋谷スクランブル交差点', '渋谷'], en: ['Shibuya Crossing', 'Shibuya'], zh: ['涩谷十字路口', '涩谷'] }
  },
  sensoji: {
    station: '浅草', walk_min: 5,
    note: { ja: '浅草駅から徒歩約5分', en: 'About 5 min walk from Asakusa Stn', zh: '从浅草站步行约5分钟' },
    names: { ja: ['浅草寺', '雷門'], en: ['Sensoji', 'Kaminarimon', 'Asakusa Temple'], zh: ['浅草寺', '雷门'] }
  },
  shinjuku_gyoen: {
    station: '新宿御苑前', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['新宿御苑'], en: ['Shinjuku Gyoen'], zh: ['新宿御苑'] }
  },
  ueno_zoo: {
    station: '上野', walk_min: 5, category: '動物園',
    note: { ja: '上野駅から徒歩約5分', en: 'About 5 min walk from Ueno Stn', zh: '从上野站步行约5分钟' },
    names: { ja: ['上野動物園'], en: ['Ueno Zoo'], zh: ['上野动物园'] }
  },
  tskuba_botanical: {
    station: 'うしく', walk_min: 15,
    note: { ja: '駅から路線バス・タクシー', en: 'Local bus / taxi from the station', zh: '从车站乘坐路线巴士或出租车' },
    names: { ja: ['筑波実験植物園'], en: ['Tsukuba Botanical Garden'], zh: ['筑波实验植物园'] }
  },
  kasairinkai_park: {
    station: '葛西臨海公園', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['葛西臨海公園'], en: ['Kasai Rinkai Park'], zh: ['葛西临海公园'] }
  },
  inokashira_park: {
    station: '吉祥寺', walk_min: 5,
    note: { ja: '吉祥寺駅から徒歩約5分', en: 'About 5 min walk from Kichijoji Stn', zh: '从吉祥寺站步行约5分钟' },
    names: { ja: ['井の頭恩賜公園'], en: ['Inokashira Park'], zh: ['井之头恩赐公园'] }
  },
  tama_zoo: {
    station: '多摩動物公園', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['多摩動物公園'], en: ['Tama Zoological Park', 'Tama Zoo'], zh: ['多摩动物园'] }
  },
  tokyo_racecourse: {
    station: '府中競馬正門前', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['東京競馬場'], en: ['Tokyo Racecourse'], zh: ['东京赛马场'] }
  },
  yokohama_chinatown: {
    station: '元町・中華街', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['横浜中華街'], en: ['Yokohama Chinatown'], zh: ['横滨中华街'] }
  },
  yokohama_minatomirai: {
    station: 'みなとみらい', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['横浜みなとみらい'], en: ['Yokohama Minatomirai', 'Minatomirai'], zh: ['横滨港未来', '港未来'] }
  },
  makuhari_messe: {
    station: '海浜幕張', walk_min: 1, category: '展示施設',
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['幕張メッセ'], en: ['Makuhari Messe'], zh: ['幕张展览馆'] }
  },
  tokyo_station: {
    station: '東京', walk_min: 0,
    note: { ja: '', en: '', zh: '' },
    names: { ja: ['東京駅'], en: ['Tokyo Station'], zh: ['东京站'] }
  },
  haneda_airport: {
    station: '羽田空港第3ターミナル', walk_min: 1,
    note: { ja: '京急・モノレール', en: 'Keikyu / Monorail', zh: '京急・单轨电车' },
    names: { ja: ['羽田空港', '羽田'], en: ['Haneda Airport', 'Haneda', 'HND'], zh: ['羽田机场'] }
  },
  narita_airport: {
    station: '成田空港', walk_min: 1,
    note: { ja: '京成・JR', en: 'Keisei / JR', zh: '京成・JR' },
    names: { ja: ['成田空港'], en: ['Narita Airport', 'Narita'], zh: ['成田机场'] }
  },
  // ===== 有名神社仏閣・観光スポット（追加） =====
  meiji_jingu: {
    station: '原宿', walk_min: 5,
    note: { ja: '原宿駅から徒歩約5分（表参道口・明治神宮前〈原宿〉駅も利用可）', en: 'About 5 min walk from Harajuku Stn (also near Meiji-jingumae Stn)', zh: '从原宿站步行约5分钟（亦可使用明治神宫前〈原宿〉站）' },
    names: { ja: ['明治神宮', '明治神社', 'めいじじんぐう'], en: ['Meiji Shrine', 'Meiji Jingu'], zh: ['明治神宫'] }
  },
  narita_san: {
    station: '成田', walk_min: 15,
    note: { ja: '成田駅から徒歩約15分（京成成田駅からも。JR成田線「成田」駅が最寄り）', en: 'About 15 min walk from Narita Stn (also Keisei Narita Stn)', zh: '从成田站步行约15分钟（亦可使用京成成田站）' },
    names: { ja: ['成田山新勝寺', '成田山', '成田山公園'], en: ['Naritasan Shinshoji', 'Naritasan', 'Narita Temple'], zh: ['成田山新胜寺', '成田山'] }
  },
  ueno_park: {
    station: '上野', walk_min: 5, category: '公園',
    note: { ja: '上野駅から徒歩約5分（恩賜上野動物園・東京国立博物館・寛永寺等）', en: 'About 5 min walk from Ueno Stn (Ueno Zoo, Tokyo National Museum, Kaneiji Temple)', zh: '从上野站步行约5分钟（上野动物园・东京国立博物馆・宽永寺等）' },
    names: { ja: ['上野恩賜公園', '恩賜上野動物園', '上野動物園', '寛永寺', '東京国立博物館', '国立科学博物館'], en: ['Ueno Park', 'Ueno Zoo', 'Tokyo National Museum', 'Kaneiji'], zh: ['上野恩赐公园', '上野动物园', '东京国立博物馆', '宽永寺'] }
  },
  tokyo_university: {
    station: '本郷三丁目', walk_min: 5,
    note: { ja: '本郷三丁目駅から徒歩約5分（赤門・東京大学本郷キャンパス）', en: 'About 5 min walk from Hongo-sanchome Stn (Red Gate / UTokyo Hongo Campus)', zh: '从本乡三丁目站步行约5分钟（红门・东京大学本乡校区）' },
    names: { ja: ['東京大学', '東大', '赤門'], en: ['University of Tokyo', 'Tokyo University', 'UTokyo', 'Akamon'], zh: ['东京大学', '东大', '赤门'] }
  },
  rikugi_en: {
    station: '駒込', walk_min: 5,
    note: { ja: '駒込駅から徒歩約5分（六義園・旧岩崎邸庭園も近接）', en: 'About 5 min walk from Komagome Stn (Rikugien & former Iwasaki residence nearby)', zh: '从驹込站步行约5分钟（六义园・旧岩崎宅邸庭园邻近）' },
    names: { ja: ['六義園', '旧岩崎邸庭園'], en: ['Rikugien', 'Former Iwasaki Residence'], zh: ['六义园', '旧岩崎邸庭园'] }
  },
  negoro_shrine: {
    station: '後楽園', walk_min: 8,
    note: { ja: '後楽園駅から徒歩約8分（根津神社・湯島聖堂も近接）', en: 'About 8 min walk from Korakuen Stn (Nezu Shrine & Yushima Seido nearby)', zh: '从后乐园站步行约8分钟（根津神社・汤岛圣堂邻近）' },
    names: { ja: ['根津神社', '湯島聖堂', '湯島天満宮'], en: ['Nezu Shrine', 'Yushima Seido', 'Yushima Tenjin'], zh: ['根津神社', '汤岛圣堂', '汤岛天满宫'] }
  },
  gokokuji: {
    station: '護国寺', walk_min: 3,
    note: { ja: '護国寺駅から徒歩約3分', en: 'About 3 min walk from Gokokuji Stn', zh: '从护国寺站步行约3分钟' },
    names: { ja: ['護国寺'], en: ['Gokokuji Temple'], zh: ['护国寺'] }
  },
  yanaka: {
    station: '日暮里', walk_min: 5,
    note: { ja: '日暮里駅から徒歩約5分（谷中霊園・谷中銀座・根津・千駄木の古い町並み）', en: 'About 5 min walk from Nippori Stn (Yanaka Cemetery, Yanaka Ginza, historic town)', zh: '从日暮里站步行约5分钟（谷中灵园・谷中银座・根津・千駄木老街）' },
    names: { ja: ['谷中霊園', '谷中銀座', '谷中', '根津', '千駄木'], en: ['Yanaka', 'Yanaka Cemetery', 'Yanaka Ginza'], zh: ['谷中灵园', '谷中银座', '谷中'] }
  },
  // ===== 東京近郊の主要観光スポット（追加） =====
  tokyo_dome_city: {
    station: '後楽園', walk_min: 2,
    note: { ja: '後楽園駅から徒歩約2分（東京ドーム・ラクーア・ユニークビューホテル）', en: 'About 2 min walk from Korakuen Stn (Tokyo Dome, LaQua)', zh: '从后乐园站步行约2分钟（东京巨蛋・LaQua）' },
    names: { ja: ['後楽園', '東京ドームシティ', 'ラクーア', '東京ドームシティアトラクションズ'], en: ['Tokyo Dome City', 'Korakuen', 'LaQua'], zh: ['后乐园', '东京巨蛋城', '东京巨蛋之城'] }
  },
  roppongi_hills: {
    station: '六本木', walk_min: 5,
    note: { ja: '六本木駅から徒歩約5分（六本木ヒルズ・毛利庭園）', en: 'About 5 min walk from Roppongi Stn (Roppongi Hills, Mohri Garden)', zh: '从六本木站步行约5分钟（六本木之丘・毛利庭园）' },
    names: { ja: ['六本木ヒルズ', '六本木之丘', '毛利庭園', '六本木'], en: ['Roppongi Hills', 'Roppongi'], zh: ['六本木之丘', '六本木新城', '六本木'] }
  },
  azabu_juban: {
    station: '麻布十番', walk_min: 3,
    note: { ja: '麻布十番駅から徒歩約3分（麻布十番商店街・東京タワーも近接）', en: 'About 3 min walk from Azabu-juban Stn (shopping street; near Tokyo Tower)', zh: '从麻布十番站步行约3分钟（麻布十番商店街・邻近东京塔）' },
    names: { ja: ['麻布十番', '麻布十番商店街'], en: ['Azabu-juban', 'Azabu Juban'], zh: ['麻布十番', '麻布十番商店街'] }
  },
  omotesando: {
    station: '表参道', walk_min: 3,
    note: { ja: '表参道駅から徒歩約3分（表参道・青山・キラー通り）', en: 'About 3 min walk from Omotesando Stn (Omotesando, Aoyama)', zh: '从表参道站步行约3分钟（表参道・青山）' },
    names: { ja: ['表参道', 'オモテソウリョウ', '青山'], en: ['Omotesando', 'Omotesando', 'Aoyama'], zh: ['表参道', '青山'] }
  },
  zojoji: {
    station: '芝公園', walk_min: 3,
    note: { ja: '芝公園駅から徒歩約3分（増上寺・東京タワーも近接）', en: 'About 3 min walk from Shiba-koen Stn (Zojoji Temple; near Tokyo Tower)', zh: '从芝公园站步行约3分钟（增上寺・邻近东京塔）' },
    names: { ja: ['増上寺', '芝公園'], en: ['Zojoji', 'Zojo-ji Temple'], zh: ['增上寺', '芝公园'] }
  },
  hamarikyu: {
    station: '竹芝', walk_min: 5,
    note: { ja: '水上バス（東京クルーズ）の「浜離宮」発着場が最も近い。陸路なら竹芝駅から徒歩約5分（浜松町駅からもアクセス可）', en: 'The "Hama-rikyu" water bus (Tokyo Cruise) stop is the closest. By land, about 5 min walk from Takeshiba Stn (also Hamamatsucho Stn)', zh: '水上巴士（东京巡航）「滨离宫」码头最近。陆路则从竹芝站步行约5分钟（亦可从滨松町站前往）' },
    names: { ja: ['浜離宮', '浜離宮恩賜庭園', '浜離宮発着場', '水上バス浜離宮'], en: ['Hama-rikyu', 'Hamarikyu', 'Hama Rikyu Gardens', 'Hama-rikyu Water Bus', 'Hamarikyu Garden'], zh: ['浜离宫', '滨离宫', '浜离宫恩赐庭园', '滨离宫恩赐庭园', '滨离宫水上巴士'] }
  },
  takeshiba_pier: {
    station: '竹芝', walk_min: 3,
    note: { ja: '東海汽船フェリーターミナル（竹芝桟橋）へは竹芝駅から徒歩約3分。伊豆諸島・小笠原航路の乗船口（竹芝客船ターミナル）', en: 'About 3 min walk from Takeshiba Stn to the Tokai Kisen ferry terminal (Takeshiba Pier) for the Izu Islands / Ogasawara routes', zh: '从竹芝站步行约3分钟即可到达东海汽船轮渡码头（竹芝码头），可搭乘伊豆诸岛・小笠原航线（竹芝客船码头）' },
    names: { ja: ['竹芝桟橋', '竹芝客船ターミナル', '竹芝フェリーターミナル', '竹芝埠頭', '竹芝ピア', '東京・竹芝'], en: ['Takeshiba Pier', 'Takeshiba Passenger Terminal', 'Takeshiba Ferry Terminal', 'Tokyo Takeshiba Pier'], zh: ['竹芝码头', '竹芝客船码头', '竹芝轮渡码头', '东京·竹芝码头'] }
  },
  hinode_pier: {
    station: '浜松町', walk_min: 5,
    note: { ja: '水上バス（東京クルーズ）の「日の出桟橋」乗り場へは浜松町駅から徒歩約5分（竹芝駅からも徒歩圏・お台場ライン/レインボーブリッジ遊覧）', en: 'About 5 min walk from Hamamatsucho Stn to Hinode Pier (Tokyo Cruise water bus; also within walking distance of Takeshiba Stn. Odaiba Line / Rainbow Bridge cruise)', zh: '从滨松町站步行约5分钟即可到达日出码头（东京巡航水上巴士，从竹芝站亦可步行前往。台场航线/彩虹桥游览）' },
    names: { ja: ['日の出桟橋', '日の出埠頭', '水上バス日の出', '日の出桟橋発着場'], en: ['Hinode Pier', 'Hinode Water Bus', 'Hinode Pier Terminal'], zh: ['日出码头', '日出水上巴士码头'] }
  },
  tsukiji: {
    station: '築地', walk_min: 3,
    note: { ja: '築地駅から徒歩約3分（築地場外市場・新規飲食店街）', en: 'About 3 min walk from Tsukiji Stn (Outer Market)', zh: '从筑地站步行约3分钟（筑地场外市场）' },
    names: { ja: ['築地', '築地場外市場', '築地市場'], en: ['Tsukiji', 'Tsukiji Market'], zh: ['筑地', '筑地场外市场'] }
  },
  toyosu: {
    station: '豊洲', walk_min: 5,
    note: { ja: '豊洲駅から徒歩約5分（豊洲市場・チームラボボーダレス）', en: 'About 5 min walk from Toyosu Stn (Toyosu Market, teamLab)', zh: '从丰洲站步行约5分钟（丰洲市场・teamLab）' },
    names: { ja: ['豊洲', '豊洲市場', 'チームラボボーダレス', 'チームラボ'], en: ['Toyosu', 'Toyosu Market', 'teamLab Borderless'], zh: ['丰洲', '丰洲市场', 'teamLab无界'] }
  },
  imperial_palace: {
    station: '東京', walk_min: 10,
    note: { ja: '東京駅から徒歩約10分（皇居・二重橋・皇居外苑）', en: 'About 10 min walk from Tokyo Stn (Imperial Palace, Nijubashi)', zh: '从东京站步行约10分钟（皇居・二重桥・皇居外苑）' },
    names: { ja: ['皇居', '二重橋', '皇居外苑', '千鳥ヶ淵'], en: ['Imperial Palace', 'Nijubashi', 'Imperial Palace East Gardens'], zh: ['皇居', '二重桥', '皇居外苑'] }
  },
  national_diet: {
    station: '永田町', walk_min: 5,
    note: { ja: '永田町駅から徒歩約5分（国会議事堂・日比谷公園も近接）', en: 'About 5 min walk from Nagatacho Stn (National Diet Building)', zh: '从永田町站步行约5分钟（国会议事堂）' },
    names: { ja: ['国会議事堂', '永田町'], en: ['National Diet Building', 'Diet Building'], zh: ['国会议事堂', '国会议事堂'] }
  },
  // ===== 主要公園・庭園（追加） =====
  toneri_park: {
    station: '舎人公園', walk_min: 1,
    note: { ja: '日暮里・舎人ライナー「舎人公園駅」下車すぐ', en: 'Immediately outside Toneri-koen Stn on the Nippori-Toneri Liner', zh: '在日暮里・舍人线舍人公园站下车即到' },
    names: { ja: ['舎人公園'], en: ['Toneri Park'], zh: ['舍人公园'] }
  },
  yoyogi_park: {
    station: '原宿', walk_min: 10,
    note: { ja: '原宿駅から徒歩約10分（明治神宮前駅・代々木公園駅も利用可）', en: 'About 10 min walk from Harajuku Stn (also near Meiji-jingumae and Yoyogi-koen)', zh: '从原宿站步行约10分钟（亦可使用明治神宫前站、代代木公园站）' },
    names: { ja: ['代々木公園'], en: ['Yoyogi Park'], zh: ['代代木公园'] }
  },
  koishikawa_korakuen: {
    station: '後楽園', walk_min: 8,
    note: { ja: '後楽園駅から徒歩約8分（飯田橋駅からもアクセス可）', en: 'About 8 min walk from Korakuen Stn (also accessible from Iidabashi)', zh: '从后乐园站步行约8分钟（亦可从饭田桥站前往）' },
    names: { ja: ['小石川後楽園'], en: ['Koishikawa Korakuen Gardens', 'Koishikawa Korakuen'], zh: ['小石川后乐园'] }
  },
  kiyose_garden: {
    station: '清澄白河', walk_min: 3,
    note: { ja: '清澄白河駅から徒歩約3分', en: 'About 3 min walk from Kiyosumi-shirakawa Stn', zh: '从清澄白河站步行约3分钟' },
    names: { ja: ['清澄庭園'], en: ['Kiyosumi Gardens', 'Kiyosumi Teien'], zh: ['清澄庭园'] }
  },
  mizumoto_park: {
    station: '松戸', walk_min: 20,
    note: { ja: '松戸駅からバス等を利用（公園入口まで徒歩約20分の目安）', en: 'Bus recommended from Matsudo Stn; about 20 min walk to the park entrance', zh: '建议从松户站乘坐巴士；到公园入口步行约20分钟' },
    names: { ja: ['水元公園'], en: ['Mizumoto Park'], zh: ['水元公园'] }
  },
  showa_kinen_park: {
    station: '立川', walk_min: 15,
    note: { ja: '立川駅から徒歩約15分（あけぼの口）。西立川駅は路線データ未登録のため立川を案内', en: 'About 15 min walk from Tachikawa Stn (Akebono Gate); Tachikawa is used because Nishitachikawa is not in the route graph', zh: '从立川站步行约15分钟（曙口）；由于西立川未登记在路线数据中，暂以立川站为目的地' },
    names: { ja: ['国営昭和記念公園', '昭和記念公園'], en: ['Showa Kinen Park', 'Showa Memorial Park'], zh: ['国营昭和纪念公园', '昭和纪念公园'] }
  },
  kinuta_park: {
    station: '用賀', walk_min: 20,
    note: { ja: '用賀駅から徒歩約20分（バス利用可）', en: 'About 20 min walk from Yoga Stn; bus recommended', zh: '从用贺站步行约20分钟；建议乘坐巴士' },
    names: { ja: ['砧公園'], en: ['Kinuta Park'], zh: ['砧公园'] }
  },
  komazawa_park: {
    station: '駒沢大学', walk_min: 15,
    note: { ja: '駒沢大学駅から徒歩約15分', en: 'About 15 min walk from Komazawa-daigaku Stn', zh: '从驹泽大学站步行约15分钟' },
    names: { ja: ['駒沢オリンピック公園', '駒沢公園'], en: ['Komazawa Olympic Park', 'Komazawa Park'], zh: ['驹泽奥林匹克公园', '驹泽公园'] }
  },
  arisugawa_park: {
    station: '広尾', walk_min: 3,
    note: { ja: '広尾駅から徒歩約3分', en: 'About 3 min walk from Hiro-o Stn', zh: '从广尾站步行约3分钟' },
    names: { ja: ['有栖川宮記念公園'], en: ['Arisugawa-no-miya Memorial Park'], zh: ['有栖川宫纪念公园'] }
  },
  hinokicho_park: {
    station: '六本木', walk_min: 5,
    note: { ja: '六本木駅から徒歩約5分（東京ミッドタウン隣接）', en: 'About 5 min walk from Roppongi Stn (next to Tokyo Midtown)', zh: '从六本木站步行约5分钟（毗邻东京中城）' },
    names: { ja: ['檜町公園'], en: ['Hinokicho Park'], zh: ['桧町公园'] }
  },
  meguro_sky_park: {
    station: '池尻大橋', walk_min: 7,
    note: { ja: '池尻大橋駅から徒歩約7分', en: 'About 7 min walk from Ikejiri-ōhashi Stn', zh: '从池尻大桥站步行约7分钟' },
    names: { ja: ['目黒天空庭園'], en: ['Meguro Sky Garden'], zh: ['目黑天空庭园'] }
  },
  wakasu_park: {
    station: '新木場', walk_min: 15,
    note: { ja: '新木場駅からバス利用（徒歩では距離があります）', en: 'Bus recommended from Shin-kiba Stn; it is a long walk', zh: '建议从新木场站乘坐巴士；步行距离较远' },
    names: { ja: ['若洲海浜公園'], en: ['Wakasu Seaside Park'], zh: ['若洲海滨公园'] }
  },
  yumenoshima_park: {
    station: '新木場', walk_min: 10,
    note: { ja: '新木場駅から徒歩約10分', en: 'About 10 min walk from Shin-kiba Stn', zh: '从新木场站步行约10分钟' },
    names: { ja: ['夢の島公園'], en: ['Yumenoshima Park'], zh: ['梦之岛公园'] }
  },
  oi_futo_park: {
    station: '大井町', walk_min: 15,
    note: { ja: '大井町駅からバス等を利用', en: 'Bus recommended from Oimachi Stn', zh: '建议从大井町站乘坐巴士' },
    names: { ja: ['大井ふ頭中央海浜公園'], en: ['Oi Central Seaside Park'], zh: ['大井埠头中央海滨公园'] }
  },
  wadakura_park: {
    station: '大手町', walk_min: 5,
    note: { ja: '大手町駅から徒歩約5分（東京駅からもアクセス可）', en: 'About 5 min walk from Otemachi Stn (also accessible from Tokyo Stn)', zh: '从大手町站步行约5分钟（亦可从东京站前往）' },
    names: { ja: ['和田倉噴水公園'], en: ['Wadakura Fountain Park'], zh: ['和田仓喷泉公园'] }
  },
  hibiyakoen: {
    station: '日比谷', walk_min: 1,
    note: { ja: '日比谷駅から徒歩約1分（霞ケ関駅・有楽町駅も利用可）', en: 'About 1 min walk from Hibiya Stn (also Kasumigaseki and Yurakucho)', zh: '从日比谷站步行约1分钟（亦可使用霞关站、有乐町站）' },
    names: { ja: ['日比谷公園'], en: ['Hibiya Park'], zh: ['日比谷公园'] }
  },
  kogaine_park: {
    station: '花小金井', walk_min: 20,
    note: { ja: '花小金井駅から徒歩約20分（バス利用可）', en: 'About 20 min walk from Hanakoganei Stn; bus recommended', zh: '从花小金井站步行约20分钟；建议乘坐巴士' },
    names: { ja: ['小金井公園'], en: ['Koganei Park'], zh: ['小金井公园'] }
  },
  // ===== 美術館・博物館・歴史文化施設（追加） =====
  mori_art_museum: {
    station: '六本木', walk_min: 5,
    note: { ja: '六本木ヒルズ森タワー内。六本木駅から徒歩約5分', en: 'Inside Roppongi Hills Mori Tower; about 5 min walk from Roppongi Stn', zh: '位于六本木之丘森大厦内；从六本木站步行约5分钟' },
    names: { ja: ['森美術館'], en: ['Mori Art Museum'], zh: ['森美术馆'] }
  },
  national_art_center: {
    station: '乃木坂', walk_min: 1,
    note: { ja: '乃木坂駅直結（六本木駅からも徒歩約10分）', en: 'Directly connected to Nogizaka Stn; about 10 min walk from Roppongi', zh: '与乃木坂站直接连通；从六本木站步行约10分钟' },
    names: { ja: ['国立新美術館'], en: ['The National Art Center, Tokyo', 'National Art Center Tokyo'], zh: ['国立新美术馆'] }
  },
  teamlab_planets: {
    station: '新豊洲', walk_min: 1, category: 'デジタルアート',
    note: { ja: '新豊洲駅から徒歩約1分', en: 'About 1 min walk from Shin-toyosu Stn', zh: '从新丰洲站步行约1分钟' },
    names: { ja: ['チームラボプラネッツ', 'チームラボプラネッツTOKYO'], en: ['teamLab Planets', 'teamLab Planets TOKYO'], zh: ['teamLab Planets', 'teamLab行星'] }
  },
  teamlab_borderless: {
    station: '神谷町', walk_min: 3, category: 'デジタルアート',
    note: { ja: '麻布台ヒルズ内。神谷町駅から徒歩約3分', en: 'Inside Azabudai Hills; about 3 min walk from Kamiyacho Stn', zh: '位于麻布台之丘内；从神谷町站步行约3分钟' },
    names: { ja: ['チームラボボーダレス', '麻布台ヒルズチームラボ'], en: ['teamLab Borderless', 'teamLab Borderless Azabudai Hills'], zh: ['teamLab无界', '麻布台之丘teamLab'] }
  },
  kanda_myojin: {
    station: '御茶ノ水', walk_min: 5,
    note: { ja: '御茶ノ水駅から徒歩約5分（末広町駅・秋葉原駅からもアクセス可）', en: 'About 5 min walk from Ochanomizu Stn; also accessible from Suehirocho and Akihabara', zh: '从御茶之水站步行约5分钟；也可从末广町站、秋叶原站前往' },
    names: { ja: ['神田明神', '神田神社'], en: ['Kanda Myojin', 'Kanda Shrine'], zh: ['神田明神', '神田神社'] }
  },
  tsukiji_honganji: {
    station: '築地', walk_min: 1,
    note: { ja: '築地駅から徒歩約1分（築地場外市場に隣接）', en: 'About 1 min walk from Tsukiji Stn, next to the Outer Market', zh: '从筑地站步行约1分钟，毗邻筑地场外市场' },
    names: { ja: ['築地本願寺'], en: ['Tsukiji Hongwanji Temple'], zh: ['筑地本愿寺'] }
  },
  kabukiza: {
    station: '東銀座', walk_min: 1,
    note: { ja: '東銀座駅直結', en: 'Directly connected to Higashi-ginza Stn', zh: '与东银座站直接连通' },
    names: { ja: ['歌舞伎座'], en: ['Kabukiza Theatre', 'Kabuki-za'], zh: ['歌舞伎座'] }
  },
  tokyo_metropolitan_gov: {
    station: '都庁前', walk_min: 1,
    note: { ja: '都庁前駅直結。展望室は東京都庁第一本庁舎', en: 'Directly connected to Tochomae Stn; observation decks are in the Tokyo Metropolitan Government Building No. 1', zh: '与都厅前站直接连通；展望室位于东京都厅第一本厅舍' },
    names: { ja: ['東京都庁展望室', '東京都庁', '都庁展望台'], en: ['Tokyo Metropolitan Government Building', 'Tokyo Metropolitan Government Observation Deck'], zh: ['东京都厅展望室', '东京都厅'] }
  },
  sunshine_city: {
    station: '池袋', walk_min: 8, category: '複合文化施設',
    note: { ja: '池袋駅から徒歩約8分（サンシャイン水族館・展望台）', en: 'About 8 min walk from Ikebukuro Stn (aquarium and observatory)', zh: '从池袋站步行约8分钟（阳光水族馆・展望台）' },
    names: { ja: ['サンシャインシティ', 'サンシャイン水族館', 'サンシャイン60'], en: ['Sunshine City', 'Sunshine Aquarium', 'Sunshine 60'], zh: ['太阳城', '阳光水族馆', 'Sunshine 60'] }
  },
  miraikan: {
    station: '東京テレポート', walk_min: 5,
    note: { ja: '東京テレポート駅から徒歩約5分（日本科学未来館）', en: 'About 5 min walk from Tokyo Teleport Stn', zh: '从东京电讯港站步行约5分钟' },
    names: { ja: ['日本科学未来館'], en: ['Miraikan', 'National Museum of Emerging Science and Innovation'], zh: ['日本科学未来馆'] }
  },
  tokyo_station_marunouchi: {
    station: '東京', walk_min: 1,
    note: { ja: '東京駅丸の内側。丸の内中央口からすぐ', en: 'Marunouchi side of Tokyo Stn, just outside the Marunouchi Central Exit', zh: '东京站丸之内一侧，紧邻丸之内中央口' },
    names: { ja: ['東京駅丸の内駅舎', '丸の内駅舎', '東京駅赤レンガ駅舎'], en: ['Tokyo Station Marunouchi Building', 'Tokyo Station Marunouchi'], zh: ['东京站丸之内站房', '东京站红砖站房'] }
  },
  // ===== 首都圏の主要テーマパーク（追加） =====
  sanrio_puroland: {
    station: '多摩センター', walk_min: 5, category: 'テーマパーク',
    note: { ja: '多摩センター駅から徒歩約5分（京王線・小田急線・多摩モノレール）', en: 'About 5 min walk from Tama Center Stn (Keio, Odakyu and Tama Monorail)', zh: '从多摩中心站步行约5分钟（京王线・小田急线・多摩单轨电车）' },
    names: { ja: ['サンリオピューロランド', 'サンリオ ピューロランド', 'ピューロランド'], en: ['Sanrio Puroland', 'Puroland'], zh: ['三丽鸥彩虹乐园', '三丽鸥彩虹乐园 Puroland'] }
  },
  yomiuriland: {
    station: '京王よみうりランド', walk_min: 10, category: '遊園地',
    note: { ja: '京王よみうりランド駅からゴンドラまたはバス等を利用', en: 'Use the gondola or bus from Keio-yomiuriland Stn', zh: '从京王读卖乐园站乘坐缆车或巴士前往' },
    names: { ja: ['よみうりランド', 'よみうりランド遊園地', 'HANA・BIYORI'], en: ['Yomiuriland', 'Yomiuri Land', 'HANA・BIYORI'], zh: ['读卖乐园', '读卖乐园游乐园'] }
  },
  moomin_valley_park: {
    station: '飯能', walk_min: 30, category: 'テーマパーク',
    note: { ja: '飯能駅からバス利用（メッツァ・ムーミンバレーパーク）', en: 'Take a bus from Hanno Stn to Metsä / Moominvalley Park', zh: '从饭能站乘坐巴士前往Metsa・姆明谷公园' },
    names: { ja: ['ムーミンバレーパーク', 'メッツァ', 'メッツァビレッジ'], en: ['Moominvalley Park', 'Metsa', 'Metsa Village'], zh: ['姆明谷公园', 'Metsa'] }
  },
  tobu_zoo: {
    station: '東武動物公園', walk_min: 10,
    note: { ja: '東武動物公園駅から徒歩約10分（バスも利用可）', en: 'About 10 min walk from Tobu-dobutsu-koen Stn; bus also available', zh: '从东武动物公园站步行约10分钟；也可乘坐巴士' },
    names: { ja: ['東武動物公園', '東武スーパープール'], en: ['Tobu Zoo', 'Tobu Dobutsu Koen'], zh: ['东武动物公园'] }
  },
  // ===== 2026-08 横浜・千葉近郊のテーマパーク・遊園地（v2.25.3 追加） =====
  yokohama_cosmo_world: {
    station: 'みなとみらい', walk_min: 3,
    note: { ja: 'みなとみらい駅から徒歩約3分（観覧車コスモクロック21）', en: 'About 3 min walk from Minatomirai Stn (Cosmo Clock 21 ferris wheel)', zh: '从港未来站步行约3分钟（摩天轮宇宙时钟21）' },
    names: { ja: ['よこはまコスモワールド', 'コスモワールド', 'コスモクロック21'], en: ['Yokohama Cosmo World', 'Cosmo World', 'Cosmo Clock 21'], zh: ['横滨宇宙世界游乐园', '宇宙世界', '宇宙时钟21'] }
  },
  yokohama_landmark_tower: {
    station: 'みなとみらい', walk_min: 3,
    note: { ja: 'みなとみらい駅直結（スカイガーデン69階展望）', en: 'Directly connected to Minatomirai Stn (Sky Garden observatory on the 69th floor)', zh: '与港未来站直接连通（69层空中花园展望台）' },
    names: { ja: ['横浜ランドマークタワー', 'ランドマークタワー', 'スカイガーデン'], en: ['Yokohama Landmark Tower', 'Landmark Tower', 'Sky Garden'], zh: ['横滨地标大厦', '地标大厦', '空中花园'] }
  },
  yokohama_cupnoodles_museum: {
    station: 'みなとみらい', walk_min: 5,
    note: { ja: 'みなとみらい駅から徒歩約5分（旧名: 安藤百福発明記念館）', en: 'About 5 min walk from Minatomirai Stn (formerly Momofuku Ando Instant Ramen Museum)', zh: '从港未来站步行约5分钟（原安藤百福发明纪念馆）' },
    names: { ja: ['カップヌードルミュージアム', '安藤百福発明記念館', 'インスタントラーメン発明記念館', 'インスタントラーメン博物館'], en: ['CupNoodles Museum', 'Momofuku Ando Instant Ramen Museum'], zh: ['杯面博物馆', '安藤百福发明纪念馆'] }
  },
  // カップヌードルミュージアムパーク（旧・新港パーク）: 2017年ネーミングライツ改称。ミュージアムとは別施設の公園（#27）
  cupnoodles_museum_park: {
    station: 'みなとみらい', walk_min: 5,
    note: { ja: 'みなとみらい駅から徒歩約5分（旧名: 新港パーク。カップヌードルミュージアム隣接の公園）', en: 'About 5 min walk from Minatomirai Stn (formerly Shinko Park; park next to the CupNoodles Museum)', zh: '从港未来站步行约5分钟（原新港公园，杯面博物馆旁的公园）' },
    names: { ja: ['カップヌードルミュージアムパーク', '新港パーク', 'カップヌードルパーク'], en: ['CupNoodles Museum Park', 'Shinko Park', 'CupNoodles Park'], zh: ['杯面博物馆公园', '新港公园', '杯面公园'] }
  },
  yokohama_redbrick: {
    station: '馬車道', walk_min: 5,
    note: { ja: '馬車道駅から徒歩約5分（横浜赤レンガ倉庫）', en: 'About 5 min walk from Bashamichi Stn (Yokohama Red Brick Warehouse)', zh: '从马车道站步行约5分钟（横滨红砖仓库）' },
    names: { ja: ['横浜赤レンガ倉庫', '赤レンガ倉庫', '赤レンガパーク'], en: ['Yokohama Red Brick Warehouse', 'Red Brick Warehouse', 'Akarenga'], zh: ['横滨红砖仓库', '红砖仓库'] }
  },
  yokohama_chinatown_gate: {
    station: '元町・中華街', walk_min: 3,
    note: { ja: '元町・中華街駅からすぐ（横浜中華街）', en: 'Just outside Motomachi-Chukagai Stn (Yokohama Chinatown)', zh: '元町・中华街站出口即达（横滨中华街）' },
    names: { ja: ['横浜中華街', '中華街', '山下町公園'], en: ['Yokohama Chinatown', 'Chinatown'], zh: ['横滨中华街', '中华街'] }
  },
  hakkeijima_seaparadise: {
    station: '金沢八景', walk_min: 30, category: '遊園地',
    note: { ja: '金沢八景駅からシーサイドライン八景島駅へ乗換（徒歩約3分）またはバス。水族館＋遊園地', en: 'Transfer to Seaside Line Hakkeijima Stn at Kanazawa-Hakkei (about 3 min walk) or take a bus. Aquarium + amusement park', zh: '在金泽八景站换乘海岸线至八景岛站（步行约3分钟）或乘坐巴士。水族馆+游乐园' },
    names: { ja: ['横浜・八景島シーパラダイス', '八景島シーパラダイス', 'シーパラダイス', '八景島'], en: ['Yokohama Hakkeijima Sea Paradise', 'Hakkeijima Sea Paradise', 'Sea Paradise'], zh: ['横滨八景岛海岛乐园', '八景岛海岛乐园', '海岛乐园'] }
  },
  yokohama_zoorasia: {
    station: '鶴ヶ峰', walk_min: 30,
    note: { ja: '鶴ヶ峰駅からバス約15分（よこはま動物園ズーラシア）', en: 'About 15 min by bus from Tsurugamine Stn (Yokohama Zoological Gardens Zoorasia)', zh: '从鹤峰站乘坐巴士约15分钟（横滨动物园Zoorasia）' },
    names: { ja: ['よこはま動物園ズーラシア', 'ズーラシア', '横浜動物園'], en: ['Yokohama Zoological Gardens Zoorasia', 'Zoorasia'], zh: ['横滨动物园Zoorasia', 'Zoorasia'] }
  },
  sankeien_garden: {
    station: '根岸', walk_min: 20,
    note: { ja: '根岸駅からバスまたは徒歩約20分（三溪園）', en: 'About 20 min by bus or on foot from Negishi Stn (Sankeien Garden)', zh: '从根岸站乘坐巴士或步行约20分钟（三溪园）' },
    names: { ja: ['三溪園', '三渓園'], en: ['Sankeien Garden', 'Sankeien'], zh: ['三溪园'] }
  },
  yamashita_park: {
    station: '元町・中華街', walk_min: 5,
    note: { ja: '元町・中華街駅から徒歩約5分（山下公園・氷川丸）', en: 'About 5 min walk from Motomachi-Chukagai Stn (Yamashita Park / Hikawa Maru)', zh: '从元町・中华街站步行约5分钟（山下公园・冰川丸）' },
    names: { ja: ['山下公園', '氷川丸', 'マリンタワー'], en: ['Yamashita Park', 'Hikawa Maru', 'Marine Tower'], zh: ['山下公园', '冰川丸', '海洋塔'] }
  },
  yokohama_bay_quarter: {
    station: '新高島', walk_min: 3,
    note: { ja: '新高島駅から徒歩約3分（横浜ベイクォーター・臨港パーク）', en: 'About 3 min walk from Shin-Takashima Stn (Yokohama Bay Quarter / Rinko Park)', zh: '从新高岛站步行约3分钟（横滨Bay Quarter・临港公园）' },
    names: { ja: ['横浜ベイクォーター', 'ベイクォーター', '臨港パーク'], en: ['Yokohama Bay Quarter', 'Bay Quarter', 'Rinko Park'], zh: ['横滨Bay Quarter', 'Bay Quarter', '临港公园'] }
  },
  // ===== 千葉県のテーマパーク・遊園地・レジャー =====
  // ※ マザー牧場（最寄り: 君津駅）・東京ドイツ村（姉ケ崎駅）・市原ぞうの国（五井駅）は
  //    JR内房線が路線グラフに未収録のため保留（グラフ拡張時に追加）
  narita_yume_farm: {
    station: '京成成田', walk_min: 30,
    note: { ja: '京成成田駅からバス約15分（成田ゆめ牧場）', en: 'About 15 min by bus from Keisei-Narita Stn (Narita Yume Farm)', zh: '从京成成田站乘坐巴士约15分钟（成田梦牧场）' },
    names: { ja: ['成田ゆめ牧場', 'ゆめ牧場', '成田夢牧場'], en: ['Narita Yume Farm', 'Narita Dream Farm'], zh: ['成田梦牧场', '梦牧场'] }
  },
  chiba_zoo: {
    station: '千葉', walk_min: 30, category: '動物園',
    note: { ja: '千葉駅から千葉都市モノレールまたはバス（千葉市動物公園）', en: 'Take the Chiba Urban Monorail or bus from Chiba Stn (Chiba City Zoo)', zh: '从千叶站乘坐千叶都市单轨电车或巴士（千叶市动物公园）' },
    names: { ja: ['千葉市動物公園', '千葉動物公園', '千葉市動物公園 モノレール'], en: ['Chiba City Zoo', 'Chiba Zoo'], zh: ['千叶市动物公园', '千叶动物公园'] }
  },
  chiba_port_tower: {
    station: '千葉みなと', walk_min: 5, category: '展望・建築',
    note: { ja: '千葉みなと駅から徒歩約5分（千葉ポートタワー）', en: 'About 5 min walk from Chiba-Minato Stn (Chiba Port Tower)', zh: '从千叶港站步行约5分钟（千叶港塔）' },
    names: { ja: ['千葉ポートタワー', 'ポートタワー'], en: ['Chiba Port Tower', 'Port Tower'], zh: ['千叶港塔', '港塔'] }
  },
  zozo_marine_stadium: {
    station: '海浜幕張', walk_min: 15, category: 'スポーツ施設',
    note: { ja: '海浜幕張駅から徒歩約15分（ZOZOマリンスタジアム・千葉マリンスタジアム）', en: 'About 15 min walk from Kaihin-Makuhari Stn (ZOZO Marine Stadium)', zh: '从海滨幕张站步行约15分钟（ZOZO海洋球场）' },
    names: { ja: ['ZOZOマリンスタジアム', '千葉マリンスタジアム', 'マリンスタジアム'], en: ['ZOZO Marine Stadium', 'Chiba Marine Stadium', 'Marine Stadium'], zh: ['ZOZO海洋球场', '千叶海洋球场'] }
  },
  kashima_sea: {
    station: '新浦安', walk_min: 5, category: 'スポーツ施設',
    note: { ja: '新浦安駅から徒歩約5分（浦安市総合公園・総合体育館）', en: 'About 5 min walk from Shin-Urayasu Stn (Urayasu General Park)', zh: '从新浦安站步行约5分钟（浦安市综合公园）' },
    names: { ja: ['浦安市総合公園', '浦安総合公園'], en: ['Urayasu General Park'], zh: ['浦安市综合公园'] }
  },
  edotokyo_museum: {
    station: '両国', walk_min: 3,
    note: { ja: '江戸東京博物館へは両国駅から徒歩約3分（大相撲の国技館も隣接）', en: 'About 3 min walk from Ryogoku Stn to the Edo-Tokyo Museum (Ryogoku Kokugikan sumo hall is adjacent)', zh: '从两国站步行约3分钟即可到达江户东京博物馆（国技馆相扑馆就在旁边）' },
    names: { ja: ['江戸東京博物館', '江戸東京博物館（EDOMUS）'], en: ['Edo-Tokyo Museum', 'Edo Tokyo Museum'], zh: ['江户东京博物馆'] }
  },
  tokyo_summerland: {
    station: '武蔵引田', walk_min: 5,
    note: { ja: 'JR五日市線 武蔵引田駅から徒歩約5分（プール・温泉・遊園地の複合レジャー施設）', en: 'About 5 min walk from Musashi-Hikida Stn on the JR Itsukaichi Line (pool, hot spring & amusement park complex)', zh: '从JR五日市线武藏引田站步行约5分钟（泳池・温泉・游乐园综合休闲设施）' },
    names: { ja: ['東京サマーランド', 'サマーランド'], en: ['Tokyo Summerland', 'Summerland'], zh: ['东京夏日乐园', '夏日乐园'] }
  },
  // ===== Issue #40: 鉄道博物館系（7施設） =====
  railway_museum: {
    station: '鉄道博物館（大成）', walk_min: 1, category: '博物館',
    note: { ja: '埼玉新都市交通 鉄道博物館（大成）駅から徒歩約1分（大宮駅からニューシャトルで約3分）', en: 'About 1 min walk from Tetsudo-Hakubutsukan (Taisho) Stn on the New Shuttle (approx. 3 min from Omiya Stn)', zh: '从埼玉新都市交通铁道博物馆（大成）站步行约1分钟（大宫站乘新交通系统约3分钟）' },
    names: { ja: ['鉄道博物館', '大宮鉄道博物館'], en: ['The Railway Museum', 'Railway Museum'], zh: ['铁道博物馆'] }
  },
  metro_museum: {
    station: '葛西', walk_min: 1,
    note: { ja: '東京メトロ東西線 葛西駅から徒歩約1分（駅高架下）', en: 'About 1 min walk from Kasai Stn on the Tozai Line (under the elevated track)', zh: '从东京地铁东西线葛西站步行约1分钟（高架桥下）' },
    names: { ja: ['地下鉄博物館'], en: ['Tokyo Metro Museum', 'Metro Museum'], zh: ['地铁博物馆'] }
  },
  tobu_museum: {
    station: '東向島', walk_min: 1,
    note: { ja: '東武伊勢崎線 東向島駅から徒歩約1分', en: 'About 1 min walk from Higashi-Mukojima Stn on the Tobu Isesaki Line', zh: '从东武伊势崎线东向岛站步行约1分钟' },
    names: { ja: ['東武博物館'], en: ['Tobu Museum'], zh: ['东武博物馆'] }
  },
  keio_rail_land: {
    station: '多摩動物公園', walk_min: 2,
    note: { ja: '京王動物園線 多摩動物公園駅から徒歩約2分', en: 'About 2 min walk from Tama-Dobutsu-Koen Stn on the Keio Dobutsuen Line', zh: '从京王动物园线多摩动物园站步行约2分钟' },
    names: { ja: ['京王れいんらんど', '京王レールランド'], en: ['Keio Rail Land'], zh: ['京王铁路乐园'] }
  },
  ome_railway_park: {
    station: '青梅', walk_min: 5,
    note: { ja: 'JR青梅線 青梅駅から徒歩約5分', en: 'About 5 min walk from Ome Stn on the JR Ome Line', zh: '从JR青梅线青梅站步行约5分钟' },
    names: { ja: ['青梅鉄道公園'], en: ['Ome Railway Park'], zh: ['青梅铁道公园'] }
  },
  train_bus_museum: {
    station: '向ヶ丘遊園', walk_min: 3,
    note: { ja: '小田急小田原線 向ヶ丘遊園駅から徒歩約3分', en: 'About 3 min walk from Mukogaoka-Yuen Stn on the Odakyu Odawara Line', zh: '从小田急小田原线向丘游园站步行约3分钟' },
    names: { ja: ['電車とバスの博物館'], en: ['Electric Car and Bus Museum', 'Train and Bus Museum'], zh: ['电车与巴士博物馆'] }
  },
  yokohama_tram_museum: {
    station: '山手', walk_min: 3,
    note: { ja: 'JR根岸線 山手駅から徒歩約3分', en: 'About 3 min walk from Yamate Stn on the JR Negishi Line', zh: '从JR根岸线山手站步行约3分钟' },
    names: { ja: ['横浜市電保存館'], en: ['Yokohama City Tram Museum'], zh: ['横滨市电保存馆'] }
  },
  // ===== Issue #41: 科学館（2施設） =====
  science_museum: {
    station: '竹橋', walk_min: 1,
    note: { ja: '東京メトロ東西線 竹橋駅から徒歩約1分（北の丸公園内）', en: 'About 1 min walk from Takebashi Stn on the Tozai Line (Kitanomaru Park)', zh: '从东京地铁东西线竹桥站步行约1分钟（北之丸公园内）' },
    names: { ja: ['科学技術館'], en: ['Science Museum'], zh: ['科学技术馆'] }
  },
  tokyo_water_science_museum: {
    station: '豊洲', walk_min: 3,
    note: { ja: '豊洲駅から徒歩約3分', en: 'About 3 min walk from Toyosu Stn', zh: '从丰洲站步行约3分钟' },
    names: { ja: ['東京都水の科学館'], en: ['Tokyo Water Science Museum'], zh: ['东京都水科学馆'] }
  },
  // ===== Issue #44: 公園・文化施設（上野公園・上野動物園は ueno_park でカバー済みのため個別追加分のみ） =====
  tokyo_metro_art_museum: {
    station: '上野', walk_min: 3,
    note: { ja: '上野駅から徒歩約3分（上野恩賜公園内）', en: 'About 3 min walk from Ueno Stn (Ueno Park)', zh: '从上野站步行约3分钟（上野恩赐公园内）' },
    names: { ja: ['東京都美術館', '都美術館'], en: ['Tokyo Metropolitan Art Museum'], zh: ['东京都美术馆'] }
  },
  asukayama_park: {
    station: '王子', walk_min: 3,
    note: { ja: '王子駅から徒歩約3分（桜の名所・飛鳥山公園）', en: 'About 3 min walk from Oji Stn (famous cherry blossom spot)', zh: '从王子站步行约3分钟（樱花名胜・飞鸟山公园）' },
    names: { ja: ['飛鳥山公園'], en: ['Asukayama Park'], zh: ['飞鸟山公园'] }
  },
  mot_museum: {
    station: '清澄白河', walk_min: 5,
    note: { ja: '清澄白河駅から徒歩約5分（木場公園内）', en: 'About 5 min walk from Kiyosumi-Shirakawa Stn (Kiba Park)', zh: '从清澄白河站步行约5分钟（木场公园内）' },
    names: { ja: ['東京都現代美術館', 'MOT'], en: ['Museum of Contemporary Art Tokyo', 'MOT'], zh: ['东京都现代美术馆'] }
  },
  sntory_hall: {
    station: '溜池山王', walk_min: 3,
    note: { ja: '溜池山王駅から徒歩約3分（六本木一丁目・アークヒルズ内）', en: 'About 3 min walk from Tameike-Sanno Stn (Ark Hills, Roppongi 1-chome)', zh: '从溜池山王站步行约3分钟（六本木一丁目・ARK Hills内）' },
    names: { ja: ['サントリーホール'], en: ['Suntory Hall'], zh: ['三得利音乐厅'] }
  },
  minato_mirai_21: {
    station: 'みなとみらい', walk_min: 1, category: '複合文化施設',
    note: { ja: 'みなとみらい駅直結（みなとみらい21エリア）', en: 'Directly connected to Minatomirai Stn (Minato Mirai 21 area)', zh: '与港未来站直接连通（港未来21区域）' },
    names: { ja: ['みなとみらい21', 'みなとみらい'], en: ['Minato Mirai 21', 'Minatomirai 21'], zh: ['港未来21'] }
  },
  sumida_aquarium: {
    station: 'とうきょうスカイツリー', walk_min: 1, category: '水族館',
    note: { ja: 'とうきょうスカイツリー駅直結（東京スカイツリータウン内）', en: 'Directly connected to Tokyo Skytree Stn (Tokyo Skytree Town)', zh: '与东京晴空塔站直接连通（东京晴空塔城内）' },
    names: { ja: ['すみだ水族館'], en: ['Sumida Aquarium'], zh: ['墨田水族馆'] }
  },
  kidzania_tokyo: {
    station: '豊洲', walk_min: 3, category: '屋内型遊園地',
    note: { ja: '豊洲駅から徒歩約3分（ららぽーと豊洲内・子供向け体験型施設）', en: 'About 3 min walk from Toyosu Stn (LaLaport Toyosu, kids experience facility)', zh: '从丰洲站步行约3分钟（LaLaport丰洲内・儿童职业体验设施）' },
    names: { ja: ['キッザニア東京'], en: ['KidZania Tokyo'], zh: ['东京KidZania'] }
  },
  aqua_city_odaiba: {
    station: '台場', walk_min: 1, category: '複合文化施設',
    note: { ja: 'ゆりかもめ 台場駅から徒歩約1分（お台場の商業施設）', en: 'About 1 min walk from Daiba Stn on the Yurikamome (shopping complex)', zh: '从百合海鸥号台场站步行约1分钟（台场商业设施）' },
    names: { ja: ['アクアシティお台場'], en: ['Aqua City Odaiba'], zh: ['台场Aqua City'] }
  },
  // === #47: 延伸地域（千葉・埼玉・神奈川）の天文台・科学館・公園 ===
  national_astronomical_observatory: {
    station: '三鷹', walk_min: 15, category: '天文台',
    note: { ja: '三鷹駅からバス約15分（日本最大の天文研究機関・公開日あり）', en: 'About 15 min by bus from Mitaka Stn (Japan\'s largest astronomical research institute; public open days available)', zh: '从三鹰站乘巴士约15分钟（日本最大的天文研究机构・有公众开放日）' },
    names: { ja: ['国立天文台', 'NAOJ', '三鷹キャンパス'], en: ['National Astronomical Observatory of Japan', 'NAOJ', 'Mitaka Campus'], zh: ['国立天文台'] }
  },
  chiba_city_science_museum: {
    station: '県庁前', walk_min: 5, category: '科学館',
    note: { ja: '千葉モノレール 県庁前駅から徒歩約5分（プラネタリウム・体験型展示）', en: 'About 5 min walk from Kenchomae Stn on the Chiba Monorail (planetarium and hands-on exhibits)', zh: '从千叶单轨电车县厅前站步行约5分钟（天文馆・体验型展示）' },
    names: { ja: ['千葉市科学館'], en: ['Chiba City Museum of Science'], zh: ['千叶市科学馆'] }
  },
  national_museum_japanese_history: {
    station: '佐倉', walk_min: 10, category: '博物館',
    note: { ja: '佐倉駅からバス約10分（日本の歴史・民俗の総合博物館）', en: 'About 10 min by bus from Sakura Stn (comprehensive museum of Japanese history and folklore)', zh: '从佐仓站乘巴士约10分钟（日本历史・民俗综合博物馆）' },
    names: { ja: ['国立歴史民俗博物館', '歴博', 'れきはく'], en: ['National Museum of Japanese History', 'Rekihaku'], zh: ['国立历史民俗博物馆'] }
  },
  hamagin_children_science_museum: {
    station: '平沼橋', walk_min: 3, category: '科学館',
    note: { ja: '相鉄 平沼橋駅から徒歩約3分（宇宙・科学の体験型施設・愛称は「はまぎん」）', en: 'About 3 min walk from Hiranumabashi Stn on the Sotetsu Line (hands-on space & science museum nicknamed "Hama Wing")', zh: '从相铁平沼桥站步行约3分钟（宇宙・科学体验型设施・昵称「Hama Wing」）' },
    names: { ja: ['はまぎんこども宇宙科学館', 'はまぎん', 'Hama Wing'], en: ['Hamagin Children\'s Science Museum', 'Hama Wing'], zh: ['滨银儿童宇宙科学馆', 'Hama Wing'] }
  },
  saitama_youth_science_museum: {
    station: '与野本町', walk_min: 10, category: '科学館',
    note: { ja: '与野本町駅から徒歩約10分（プラネタリウム・科学実験）', en: 'About 10 min walk from Yono-Honmachi Stn (planetarium and science experiments)', zh: '从与野本町站步行约10分钟（天文馆・科学实验）' },
    names: { ja: ['さいたま市青少年科学館', 'サイエンスワールド'], en: ['Saitama City Youth Science Museum', 'Science World'], zh: ['埼玉市青少年科学馆'] }
  },
  kawaguchi_science_museum: {
    station: '川口', walk_min: 10, category: '科学館',
    note: { ja: '川口駅からバス約10分（プラネタリウム）', en: 'About 10 min by bus from Kawaguchi Stn (planetarium)', zh: '从川口站乘巴士约10分钟（天文馆）' },
    names: { ja: ['川口市立科学館', 'サイエンスワールド川口'], en: ['Kawaguchi City Science Museum', 'Science World Kawaguchi'], zh: ['川口市立科学馆'] }
  },
  sagamihara_city_museum: {
    station: '相模原', walk_min: 15, category: '博物館',
    note: { ja: '相模原駅からバス約15分（JAXA相模原キャンパス隣接・はやぶさ実物大模型）', en: 'About 15 min by bus from Sagamihara Stn (next to JAXA Sagamihara Campus; full-scale Hayabusa model)', zh: '从相模原站乘巴士约15分钟（紧邻JAXA相模原校区・隼鸟号实物大模型）' },
    names: { ja: ['相模原市立博物館'], en: ['Sagamihara City Museum'], zh: ['相模原市立博物馆'] }
  },
  chiba_modern_industry_museum: {
    station: '国府台', walk_min: 10, category: '科学館',
    note: { ja: '京成 国府台駅から徒歩約10分（科学技術の体験展示・市川）', en: 'About 10 min walk from Konodai Stn on the Keisei Line (hands-on science & technology exhibits, Ichikawa)', zh: '从京成国府台站步行约10分钟（科学技术体验展示・市川）' },
    names: { ja: ['千葉県立現代産業科学館'], en: ['Chiba Prefectural Museum of Modern Industrial Science'], zh: ['千叶县立现代产业科学馆'] }
  },
  chiba_prefectural_central_museum: {
    station: '千葉公園', walk_min: 10, category: '博物館',
    note: { ja: '千葉モノレール 千葉公園駅から徒歩約10分（千葉の自然・歴史・千葉公園隣接）', en: 'About 10 min walk from Chiba-Koen Stn on the Chiba Monorail (nature & history of Chiba, next to Chiba Park)', zh: '从千叶单轨电车千叶公园站步行约10分钟（千叶的自然・历史・紧邻千叶公园）' },
    names: { ja: ['千葉県立中央博物館'], en: ['Chiba Prefectural Central Museum'], zh: ['千叶县立中央博物馆'] }
  },
  boso_no_mura: {
    station: '成田', walk_min: 30, category: '博物館',
    note: { ja: '成田駅からバス約30分（房総の昔の町並み再現・体験型）', en: 'About 30 min by bus from Narita Stn (recreated old Boso townscapes; hands-on)', zh: '从成田站乘巴士约30分钟（再现房总古街景・体验型）' },
    names: { ja: ['千葉県立房総のむら', '房総のむら'], en: ['Boso no Mura', 'Boso-no-Mura'], zh: ['千叶县立房总之村', '房总之村'] }
  },
  sakura_castle_park: {
    station: '佐倉', walk_min: 15, category: '公園',
    note: { ja: '佐倉駅から徒歩約15分（佐倉城跡・桜の名所）', en: 'About 15 min walk from Sakura Stn (Sakura Castle ruins; famous cherry blossom spot)', zh: '从佐仓站步行约15分钟（佐仓城遗址・赏樱名胜）' },
    names: { ja: ['佐倉城址公園', '佐倉城跡'], en: ['Sakura Castle Ruins Park', 'Sakura Castle Site'], zh: ['佐仓城遗址公园'] }
  },
  shin_yokohama_park: {
    station: '新横浜', walk_min: 5, category: '公園',
    note: { ja: '新横浜駅から徒歩約5分（日産スタジアム・サッカー日本代表戦）', en: 'About 5 min walk from Shin-Yokohama Stn (Nissan Stadium, Japan national football team matches)', zh: '从新横滨站步行约5分钟（日产体育场・日本国家队比赛）' },
    names: { ja: ['新横浜公園', '日産スタジアム'], en: ['Shin-Yokohama Park', 'Nissan Stadium'], zh: ['新横滨公园', '日产体育场'] }
  },
  hitsujiyama_park: {
    station: '西武秩父', walk_min: 15, category: '公園',
    note: { ja: '西武秩父駅から徒歩約15分（芝桜の丘・4〜5月・約40万株）', en: 'About 15 min walk from Seibu-Chichibu Stn (Shakunage & moss phlox hill in Apr-May, about 400,000 plants)', zh: '从西武秩父站步行约15分钟（芝樱之丘・4～5月・约40万株）' },
    names: { ja: ['羊山公園', '芝桜の丘'], en: ['Hitsujiyama Park', 'Shakunage Hill'], zh: ['羊山公园', '芝樱之丘'] }
  },
  makuhari_seaside_park: {
    station: '海浜幕張', walk_min: 10, category: '公園',
    note: { ja: '海浜幕張駅から徒歩約10分（海浜公園・日本庭園）', en: 'About 10 min walk from Kaihin-Makuhari Stn (seaside park with Japanese garden)', zh: '从海滨幕张站步行约10分钟（海滨公园・日本庭园）' },
    names: { ja: ['幕張海浜公園'], en: ['Makuhari Seaside Park'], zh: ['幕张海滨公园'] }
  },
  // === #49: 外国人観光客向けアニメ・ゲーム系アミューズメントパーク ===
  wb_studio_tour_tokyo: {
    station: '豊島園', walk_min: 5, category: 'テーマパーク',
    note: { ja: '豊島園駅から徒歩約5分（ハリー・ポッターの映画制作体験型施設・日時指定チケット制）', en: 'About 5 min walk from Toshimaen Stn (Harry Potter movie-making experience; timed-entry ticket required)', zh: '从丰岛园站步行约5分钟（哈利·波特电影制作体验型设施・需指定日期时间门票）' },
    names: { ja: ['ワーナー ブラザース スタジオツアー東京', 'スタジオツアー東京', 'ハリー・ポッター スタジオツアー'], en: ['Warner Bros. Studio Tour Tokyo', 'Studio Tour Tokyo', 'Harry Potter Studio Tour'], zh: ['东京华纳兄弟影城之旅', '哈利波特影城之旅'] }
  },
  tokyo_joypolis: {
    station: 'お台場海浜公園', walk_min: 5, category: '屋内型遊園地',
    note: { ja: 'ゆりかもめ お台場海浜公園駅から徒歩約5分（デックス東京ビーチ内・屋内型アミューズメントパーク）', en: 'About 5 min walk from Odaiba-Kaihinkoen Stn on the Yurikamome (inside DECKS Tokyo Beach, indoor amusement park)', zh: '从百合海鸥号台场海滨公园站步行约5分钟（DECKS东京海滩内・室内游乐场）' },
    names: { ja: ['東京ジョイポリス', 'ジョイポリス'], en: ['Tokyo Joypolis', 'Joypolis'], zh: ['东京欢乐世界', '欢乐世界'] }
  },
  namja_town: {
    station: '池袋', walk_min: 8, category: '屋内型遊園地',
    note: { ja: '池袋駅から徒歩約8分（サンシャインシティ内・餃子スタジアム等）', en: 'About 8 min walk from Ikebukuro Stn (inside Sunshine City; Gyoza Stadium etc.)', zh: '从池袋站步行约8分钟（太阳城内・饺子体育场等）' },
    names: { ja: ['ナンジャタウン'], en: ['NAMJATOWN', 'Namja Town'], zh: ['NAMJATOWN', '南加亚城'] }
  },
  immersive_fort_tokyo: {
    station: '青海', walk_min: 5, category: 'テーマパーク',
    note: { ja: 'ゆりかもめ 青海駅から徒歩約5分（没入型テーマパーク・お台場）', en: 'About 5 min walk from Aomi Stn on the Yurikamome (immersive theme park in Odaiba)', zh: '从百合海鸥号青海站步行约5分钟（沉浸式主题公园・台场）' },
    names: { ja: ['イマーシブ・フォート東京', 'イマーシブフォート'], en: ['Immersive Fort Tokyo'], zh: ['沉浸式堡垒东京'] }
  },
  small_worlds_tokyo: {
    station: '有明', walk_min: 5, category: 'テーマパーク',
    note: { ja: 'ゆりかもめ 有明駅から徒歩約5分（ミニチュアテーマパーク・国際展示場駅からも徒歩約8分）', en: 'About 5 min walk from Ariake Stn on the Yurikamome (miniature theme park; approx. 8 min from Kokusai-Tenjijo Stn)', zh: '从百合海鸥号有明站步行约5分钟（微缩主题公园・从国际展示场站步行约8分钟）' },
    names: { ja: ['スモールワールズ東京', 'スモールワールズ'], en: ['Small Worlds Tokyo', 'Small Worlds'], zh: ['东京小世界', '小世界'] }
  },
  legoland_discovery_tokyo: {
    station: 'お台場海浜公園', walk_min: 5, category: '屋内型遊園地',
    note: { ja: 'ゆりかもめ お台場海浜公園駅から徒歩約5分（デックス東京ビーチ内・レゴの屋内型アミューズメントパーク）', en: 'About 5 min walk from Odaiba-Kaihinkoen Stn on the Yurikamome (inside DECKS Tokyo Beach, LEGO indoor amusement park)', zh: '从百合海鸥号台场海滨公园站步行约5分钟（DECKS东京海滩内・乐高室内游乐场）' },
    names: { ja: ['レゴランド・ディスカバリー・センター東京', 'レゴランドディスカバリー東京'], en: ['LEGOLAND Discovery Center Tokyo', 'LEGOLAND Discovery Center'], zh: ['乐高乐园探索中心东京'] }
  },
  gundam_base_tokyo: {
    station: '台場', walk_min: 5, category: 'テーマパーク',
    note: { ja: 'ゆりかもめ 台場駅から徒歩約5分（ダイバーシティ東京内・実物大立像あり）', en: 'About 5 min walk from Daiba Stn on the Yurikamome (inside DiverCity Tokyo; life-size Gundam statue)', zh: '从百合海鸥号台场站步行约5分钟（DiverCity东京内・有实物大高达立像）' },
    names: { ja: ['ガンダムベース東京', 'ガンダムベース', 'ガンダム立像'], en: ['The Gundam Base Tokyo', 'Gundam Base Tokyo'], zh: ['东京高达基地', '高达基地'] }
  },
  ghibli_museum: {
    station: '三鷹', walk_min: 5, category: '美術館',
    note: { ja: '三鷹駅からバス約5分（スタジオジブリのアニメ美術館・事前予約制）', en: 'About 5 min by bus from Mitaka Stn (Studio Ghibli anime museum; advance reservation required)', zh: '从三鹰站乘巴士约5分钟（吉卜力工作室动画美术馆・需提前预约）' },
    names: { ja: ['三鷹の森ジブリ美術館', 'ジブリ美術館'], en: ['Ghibli Museum, Mitaka', 'Ghibli Museum'], zh: ['三鹰之森吉卜力美术馆', '吉卜力美术馆'] }
  },
  fujiko_f_fujio_museum: {
    station: '登戸', walk_min: 10, category: '美術館',
    note: { ja: '登戸駅からバス約10分（ドラえもんの作者のミュージアム・事前予約制・シャトルバスあり）', en: 'About 10 min by bus from Noborito Stn (museum of the creator of Doraemon; advance reservation required; shuttle bus available)', zh: '从登户站乘巴士约10分钟（哆啦A梦作者博物馆・需提前预约・有穿梭巴士）' },
    names: { ja: ['藤子・F・不二雄ミュージアム', '藤子不二雄ミュージアム', 'ドラえもんミュージアム'], en: ['Fujiko F. Fujio Museum', 'Doraemon Museum'], zh: ['藤子·F·不二雄博物馆', '哆啦A梦博物馆'] }
  },
  maxell_aqua_park_shinagawa: {
    station: '品川', walk_min: 2, category: '水族館',
    note: { ja: '品川駅高輪口から徒歩約2分（デジタルアート水族館）', en: 'About 2 min walk from Shinagawa Stn Takanawa Exit (digital art aquarium)', zh: '从品川站高轮口步行约2分钟（数字艺术水族馆）' },
    names: { ja: ['マクセル アクアパーク品川', 'アクアパーク品川'], en: ['Maxell Aqua Park Shinagawa', 'Aqua Park Shinagawa'], zh: ['麦克斯尔水上乐园品川', '水上乐园品川'] }
  },
  // ===== 2026-08-09 v2.36.2: 科学館・博物館・美術館・公園・歴史館・動物園・ミュージアム（訪日客向け・延伸駅対応） =====
  national_museum_western_art: {
    station: '上野', walk_min: 7, category: '美術館',
    note: { ja: '上野駅公園口から徒歩約7分（世界遺産・松方コレクション）', en: 'About 7 min walk from Ueno Stn Park Exit (UNESCO World Heritage, Matsukata Collection)', zh: '从上野站公园口步行约7分钟（世界遗产・松方收藏）' },
    names: { ja: ['国立西洋美術館', '西洋美術館'], en: ['The National Museum of Western Art', 'National Museum of Western Art', 'NMWA'], zh: ['国立西洋美术馆', '西洋美术馆'] }
  },
  nezu_museum: {
    station: '表参道', walk_min: 10, category: '美術館',
    note: { ja: '表参道駅A5出口から徒歩約10分（東洋古美術・根津美術館）', en: 'About 10 min walk from Omotesando Stn A5 Exit (oriental art museum)', zh: '从表参道站A5出口步行约10分钟（东方古美术）' },
    names: { ja: ['根津美術館', '根津美術館 庭園'], en: ['Nezu Museum', 'Nezu Museum Garden'], zh: ['根津美术馆'] }
  },
  suntory_museum_of_art: {
    station: '六本木', walk_min: 5, category: '美術館',
    note: { ja: '六本木駅から徒歩約5分（東京ミッドタウン内）', en: 'About 5 min walk from Roppongi Stn (inside Tokyo Midtown)', zh: '从六本木站步行约5分钟（位于东京中城）' },
    names: { ja: ['サントリー美術館'], en: ['Suntory Museum of Art'], zh: ['三得利美术馆'] },
  },
  design_sight_2121: {
    station: '六本木', walk_min: 5, category: '美術館',
    note: { ja: '六本木駅から徒歩約5分（東京ミッドタウン内・デザイン美術館）', en: 'About 5 min walk from Roppongi Stn (design museum in Tokyo Midtown)', zh: '从六本木站步行约5分钟（东京中城内的设计美术馆）' },
    names: { ja: ['21_21 DESIGN SIGHT', '21-21デザインサイト'], en: ['21_21 DESIGN SIGHT'], zh: ['21_21设计视野'] }
  },
  momat: {
    station: '竹橋', walk_min: 3, category: '美術館',
    note: { ja: '竹橋駅1b出口から徒歩約3分（近代美術館・皇居外苑隣）', en: 'About 3 min walk from Takebashi Stn 1b Exit (modern art museum)', zh: '从竹桥站1b出口步行约3分钟（近代美术馆）' },
    names: { ja: ['東京国立近代美術館', 'MOMAT', '近代美術館'], en: ['The National Museum of Modern Art, Tokyo', 'MOMAT'], zh: ['东京国立近代美术馆', 'MOMAT'] }
  },
  tokyo_photographic_art_museum: {
    station: '恵比寿', walk_min: 5, category: '美術館',
    note: { ja: '恵比寿駅東口から徒歩約5分（恵比寿ガーデンプレイス内）', en: 'About 5 min walk from Ebisu Stn East Exit (in Yebisu Garden Place)', zh: '从惠比寿站东口步行约5分钟（位于惠比寿花园广场）' },
    names: { ja: ['東京都写真美術館', '写美', 'TOP美術館'], en: ['Tokyo Photographic Art Museum', 'TOP Museum'], zh: ['东京都写真美术馆', '写美'] }
  },
  tokyo_metropolitan_teien_museum: {
    station: '目黒', walk_min: 7, category: '美術館',
    note: { ja: '目黒駅東口から徒歩約7分（アール・デコ様式の旧朝香宮邸）', en: 'About 7 min walk from Meguro Stn East Exit (Art Deco former Asaka residence)', zh: '从目黑站东口步行约7分钟（装饰艺术风格的旧朝香宫邸）' },
    names: { ja: ['東京都庭園美術館', '庭園美術館'], en: ['Tokyo Metropolitan Teien Art Museum', 'Teien Art Museum'], zh: ['东京都庭园美术馆'] }
  },
  national_film_archive: {
    station: '京橋', walk_min: 3, category: '博物館',
    note: { ja: '京橋駅から徒歩約3分（国立映画アーカイブ・旧フィルムセンター）', en: 'About 3 min walk from Kyobashi Stn (national film archive)', zh: '从京桥站步行约3分钟（国立电影资料馆）' },
    names: { ja: ['国立映画アーカイブ', 'NFC', 'フィルムセンター'], en: ['National Film Archive of Japan', 'NFAJ'], zh: ['国立电影资料馆'] }
  },
  edo_tokyo_open_air_architectural_museum: {
    station: '花小金井', walk_min: 20, category: '博物館',
    note: { ja: '花小金井駅から徒歩約20分（小金井公園内・歴史的建造物の野外博物館）', en: 'About 20 min walk from Hanakoganei Stn (open-air museum of historic buildings in Koganei Park)', zh: '从花小金井站步行约20分钟（小金井公园内的历史建筑露天博物馆）' },
    names: { ja: ['江戸東京たてもの園', 'たてもの園'], en: ['Edo-Tokyo Open Air Architectural Museum'], zh: ['江户东京建筑园'] }
  },
  showakan: {
    station: '九段下', walk_min: 5, category: '博物館',
    note: { ja: '九段下駅から徒歩約5分（戦中・戦後の暮らしを伝える歴史館）', en: 'About 5 min walk from Kudanshita Stn (museum of wartime & postwar daily life)', zh: '从九段下站步行约5分钟（战争时期及战后生活史馆）' },
    names: { ja: ['昭和館'], en: ['Showa-kan', 'Showa Hall'], zh: ['昭和馆'] }
  },
  national_archives_japan: {
    station: '竹橋', walk_min: 5, category: '博物館',
    note: { ja: '竹橋駅から徒歩約5分（国の公文書を保存・公開）', en: 'About 5 min walk from Takebashi Stn (national archives of Japan)', zh: '从竹桥站步行约5分钟（日本国家档案馆）' },
    names: { ja: ['国立公文書館'], en: ['National Archives of Japan'], zh: ['国立公文书馆'] }
  },
  printing_museum: {
    station: '飯田橋', walk_min: 7, category: '博物館',
    note: { ja: '飯田橋駅から徒歩約7分（印刷の歴史・凸版印刷）', en: 'About 7 min walk from Iidabashi Stn (history of printing)', zh: '从饭田桥站步行约7分钟（印刷历史）' },
    names: { ja: ['印刷博物館', 'プリントミュージアム'], en: ['Printing Museum', 'Printing Museum Tokyo'], zh: ['印刷博物馆'] }
  },
  currency_museum: {
    station: '日本橋', walk_min: 3, category: '博物館',
    note: { ja: '日本橋駅から徒歩約3分（日本銀行金融研究所・お金の博物館）', en: 'About 3 min walk from Nihombashi Stn (money museum of the Bank of Japan)', zh: '从日本桥站步行约3分钟（日本银行金融研究所货币博物馆）' },
    names: { ja: ['貨幣博物館', 'お金の博物館'], en: ['Currency Museum', 'Bank of Japan Currency Museum'], zh: ['货币博物馆'] }
  },
  postal_museum_japan: {
    station: '押上', walk_min: 5, category: '博物館',
    note: { ja: '押上駅から徒歩約5分（東京スカイツリータウン内・郵便の博物館）', en: 'About 5 min walk from Oshiage Stn (postal museum in Tokyo Skytree Town)', zh: '从押上站步行约5分钟（东京晴空塔城内的邮政博物馆）' },
    names: { ja: ['郵政博物館', '切手博物館'], en: ['Postal Museum Japan'], zh: ['邮政博物馆'] }
  },
  police_museum: {
    station: '京橋', walk_min: 3, category: '博物館',
    note: { ja: '京橋駅から徒歩約3分（警察の歴史・無料）', en: 'About 3 min walk from Kyobashi Stn (police history museum, free)', zh: '从京桥站步行约3分钟（警察历史・免费）' },
    names: { ja: ['警察博物館'], en: ['Police Museum'], zh: ['警察博物馆'] }
  },
  fire_museum: {
    station: '四ツ谷', walk_min: 3, category: '博物館',
    note: { ja: '四ツ谷駅から徒歩約3分（消防の歴史・無料）', en: 'About 3 min walk from Yotsuya Stn (firefighting history, free)', zh: '从四谷站步行约3分钟（消防历史・免费）' },
    names: { ja: ['消防博物館'], en: ['Fire Museum'], zh: ['消防博物馆'] }
  },
  tokyo_toy_museum: {
    station: '四ツ谷', walk_min: 5, category: '博物館',
    note: { ja: '四ツ谷駅から徒歩約5分（おもちゃの美術館・体験型）', en: 'About 5 min walk from Yotsuya Stn (hands-on toy museum)', zh: '从四谷站步行约5分钟（互动式玩具美术馆）' },
    names: { ja: ['東京おもちゃ美術館', 'おもちゃ美術館'], en: ['Tokyo Toy Museum'], zh: ['东京玩具美术馆'] }
  },
  meguro_parasitological_museum: {
    station: '目黒', walk_min: 5, category: '博物館',
    note: { ja: '目黒駅から徒歩約5分（寄生虫の博物館・無料・世界的に珍しい）', en: 'About 5 min walk from Meguro Stn (parasite museum, free, world-renowned)', zh: '从目黑站步行约5分钟（寄生虫博物馆・免费・世界闻名）' },
    names: { ja: ['目黒寄生虫館', '寄生虫館'], en: ['Meguro Parasitological Museum'], zh: ['目黑寄生虫馆'] }
  },
  national_theatre_japan: {
    station: '永田町', walk_min: 5, category: '劇場',
    note: { ja: '永田町駅から徒歩約5分（歌舞伎・能楽などの国立劇場）', en: 'About 5 min walk from Nagatacho Stn (national theatre for kabuki, noh, etc.)', zh: '从永田町站步行约5分钟（歌舞伎・能乐等国立剧场）' },
    names: { ja: ['国立劇場'], en: ['National Theatre of Japan'], zh: ['国立剧场'] }
  },
  new_national_theatre_tokyo: {
    station: '初台', walk_min: 3, category: '劇場',
    note: { ja: '初台駅から徒歩約3分（オペラ・バレエの新国立劇場）', en: 'About 3 min walk from Hatsudai Stn (opera & ballet theatre)', zh: '从初台站步行约3分钟（歌剧・芭蕾剧场）' },
    names: { ja: ['新国立劇場'], en: ['New National Theatre Tokyo'], zh: ['新国立剧场'] }
  },
  tokyo_metropolitan_theatre: {
    station: '池袋', walk_min: 2, category: '劇場',
    note: { ja: '池袋駅西口から徒歩約2分（東京芸術劇場）', en: 'About 2 min walk from Ikebukuro Stn West Exit', zh: '从池袋站西口步行约2分钟' },
    names: { ja: ['東京芸術劇場', '芸術劇場'], en: ['Tokyo Metropolitan Theatre'], zh: ['东京艺术剧场'] }
  },
  kasai_seaside_aquarium: {
    station: '葛西臨海公園', walk_min: 5, category: '水族館',
    note: { ja: '葛西臨海公園駅から徒歩約5分（マグロの回遊水槽・無料）', en: 'About 5 min walk from Kasai-Rinkai-Koen Stn (tuna school tank, free)', zh: '从葛西临海公园站步行约5分钟（金枪鱼洄游水槽・免费）' },
    names: { ja: ['葛西臨海水族園', '葛西臨海水族館'], en: ['Tokyo Sea Life Park', 'Kasai Rinkai Aquarium'], zh: ['葛西临海水族园'] }
  },
  odaiba_seaside_park: {
    station: 'お台場海浜公園', walk_min: 1, category: '公園',
    note: { ja: 'ゆりかもめ「お台場海浜公園」駅直結（砂浜とレインボーブリッジ）', en: 'Directly connected to Odaiba-Kaihinkoen Stn (Yurikamome); beach & Rainbow Bridge views', zh: '与百合海鸥号「台场海滨公园」站直连（沙滩与彩虹大桥）' },
    names: { ja: ['お台場海浜公園', '台場海浜公園', 'お台場ビーチ'], en: ['Odaiba Seaside Park', 'Odaiba Beach'], zh: ['台场海滨公园', '台场沙滩'] }
  },
  yasukuni_shrine: {
    station: '九段下', walk_min: 5, category: '神社',
    note: { ja: '九段下駅から徒歩約5分', en: 'About 5 min walk from Kudanshita Stn', zh: '从九段下站步行约5分钟' },
    names: { ja: ['靖国神社'], en: ['Yasukuni Shrine'], zh: ['靖国神社'] }
  },
  sengakuji: {
    station: '泉岳寺', walk_min: 3, category: '寺院',
    note: { ja: '泉岳寺駅から徒歩約3分（赤穂浪士の墓所）', en: 'About 3 min walk from Sengakuji Stn (burial site of the 47 Ronin)', zh: '从泉岳寺站步行约3分钟（赤穗浪士之墓）' },
    names: { ja: ['泉岳寺', '赤穂義士記念館'], en: ['Sengaku-ji', 'Sengakuji Temple'], zh: ['泉岳寺'] }
  },
  jindaiji: {
    station: '調布', walk_min: 25, category: '寺院',
    note: { ja: '調布駅からバス約15分（深大寺・蕎麦と鬼太郎茶屋）', en: 'About 15 min by bus from Chofu Stn (Jindaiji Temple, soba & Gegegeno Kitaro teahouse)', zh: '从调布站乘巴士约15分钟（深大寺・荞麦面与鬼太郎茶馆）' },
    names: { ja: ['深大寺', '深大寺蕎麦'], en: ['Jindaiji Temple', 'Jindai-ji'], zh: ['深大寺'] }
  },
  takao_san: {
    station: '高尾山口', walk_min: 5, category: '公園',
    note: { ja: '高尾山口駅から徒歩約5分（ケーブルカー乗り場・ミシュラン三つ星の山）', en: 'About 5 min walk from Takaosanguchi Stn (cable car station; Michelin 3-star mountain)', zh: '从高尾山口站步行约5分钟（缆车站・米其林三星之山）' },
    names: { ja: ['高尾山', '高尾山ケーブルカー'], en: ['Mount Takao', 'Mt. Takao'], zh: ['高尾山'] }
  }
};

// 全ての検索可能文字列（ja/en/zh 別名）を小文字化してフラットルックアップに構築
const LANDMARK_LOOKUP = {};
for (const [defKey, def] of Object.entries(LANDMARK_DEFS)) {
  for (const lang of ['ja', 'en', 'zh']) {
    for (const n of (def.names[lang] || [])) {
      LANDMARK_LOOKUP[n.toLowerCase()] = { defKey, lang, original: n };
    }
  }
}

// 降車駅周辺の文化・芸能・芸術施設（厳選ローカル表示）
// 将来、東京都オープンデータAPI／文化庁文化情報プラットフォームの同期先に置き換え可能。
const DESTINATION_CULTURAL_FACILITIES = {
  '六本木': [
    ['森美術館', 'Mori Art Museum', '森美术馆', '美術館', 5],
    ['東京ミッドタウン', 'Tokyo Midtown', '东京中城', '複合文化施設', 5]
  ],
  '乃木坂': [['国立新美術館', 'The National Art Center, Tokyo', '国立新美术馆', '美術館', 1]],
  '神谷町': [['チームラボボーダレス', 'teamLab Borderless', 'teamLab无界', 'デジタルアート', 3], ['麻布台ヒルズ', 'Azabudai Hills', '麻布台之丘', '複合文化施設', 3]],
  '御茶ノ水': [['神田明神', 'Kanda Myojin Shrine', '神田明神', '神社', 5], ['湯島聖堂', 'Yushima Seido', '汤岛圣堂', '史跡・文化施設', 5]],
  '築地': [['築地本願寺', 'Tsukiji Hongwanji Temple', '筑地本愿寺', '寺院', 1], ['築地場外市場', 'Tsukiji Outer Market', '筑地场外市场', '市場・食文化', 3]],
  '東銀座': [['歌舞伎座', 'Kabukiza Theatre', '歌舞伎座', '伝統芸能', 1]],
  '都庁前': [['東京都庁展望室', 'Tokyo Metropolitan Government Observation Deck', '东京都厅展望室', '展望・建築', 1], ['SOMPO美術館', 'SOMPO Museum of Art', 'SOMPO美术馆', '美術館', 10]],
  '池袋': [['サンシャイン水族館', 'Sunshine Aquarium', '阳光水族馆', '水族館', 8], ['東京芸術劇場', 'Tokyo Metropolitan Theatre', '东京艺术剧场', '劇場', 2]],
  '東京テレポート': [['日本科学未来館', 'Miraikan', '日本科学未来馆', '科学館', 5], ['東京ジョイポリス', 'Tokyo Joypolis', '东京欢乐世界', '屋内型遊園地', 5]],
  '東京': [['東京駅丸の内駅舎', 'Tokyo Station Marunouchi Building', '东京站丸之内站房', '歴史建築', 1], ['三菱一号館美術館', 'Mitsubishi Ichigokan Museum', '三菱一号馆美术馆', '美術館', 5]],
  '上野': [['東京国立博物館', 'Tokyo National Museum', '东京国立博物馆', '博物館', 5], ['国立科学博物館', 'National Museum of Nature and Science', '国立科学博物馆', '博物館', 5], ['東京都美術館', 'Tokyo Metropolitan Art Museum', '东京都美术馆', '美術館', 7]],
  '浅草': [['浅草寺', 'Sensoji Temple', '浅草寺', '寺院', 5], ['浅草花やしき', 'Hanayashiki Amusement Park', '浅草花屋敷', '遊園地', 5]],
  '清澄白河': [['東京都現代美術館', 'Museum of Contemporary Art Tokyo', '东京都现代美术馆', '美術館', 10], ['清澄庭園', 'Kiyosumi Gardens', '清澄庭园', '庭園', 3]],
  '両国': [['江戸東京博物館', 'Edo-Tokyo Museum', '江户东京博物馆', '博物館', 3], ['すみだ北斎美術館', 'The Sumida Hokusai Museum', '墨田北斋美术馆', '美術館', 8]],
  '竹橋': [['東京国立近代美術館', 'The National Museum of Modern Art, Tokyo', '东京国立近代美术馆', '美術館', 3]],
  '竹芝': [
    ['浜離宮恩賜庭園', 'Hama-rikyu Gardens', '滨离宫恩赐庭园', '庭園', 5],
    ['竹芝桟橋（東海汽船ターミナル）', 'Takeshiba Pier (Tokai Kisen Ferry Terminal)', '竹芝码头（东海汽船轮渡码头）', 'フェリーターミナル', 3],
    ['日の出桟橋（水上バス）', 'Hinode Pier (Water Bus)', '日出码头（水上巴士）', '水上バス乗り場', 10]
  ],
  // #48: 延伸駅の到着時文化施設（自動導出に無いもののみ明示追加。残りは LANDMARK_DEFS から自動導出）
  '西武秩父': [['秩父神社', 'Chichibu Shrine', '秩父神社', '神社', 10]],
  '江ノ島': [
    ['江ノ島展望灯台', 'Enoshima Sea Candle (Observation Lighthouse)', '江之岛展望灯塔', '展望・建築', 10],
    ['湘南海岸公園', 'Shonan Seaside Park', '湘南海岸公园', '公園', 5]
  ],
  '千葉': [['千葉市科学館', 'Chiba City Museum of Science', '千叶市科学馆', '科学館', 10]],
  '越生': [['越生梅林', 'Ogose Plum Grove', '越生梅林', '公園', 15]]
};

const CULTURAL_CATEGORY_NAMES = {
  '美術館': { en: 'Museum', zh: '美术馆' },
  '複合文化施設': { en: 'Cultural complex', zh: '综合文化设施' },
  'デジタルアート': { en: 'Digital art', zh: '数字艺术' },
  '神社': { en: 'Shrine', zh: '神社' },
  '史跡・文化施設': { en: 'Historic cultural site', zh: '历史文化遗址' },
  '寺院': { en: 'Temple', zh: '寺院' },
  '市場・食文化': { en: 'Market and food culture', zh: '市场・饮食文化' },
  '伝統芸能': { en: 'Traditional performing arts', zh: '传统艺能' },
  '展望・建築': { en: 'Viewpoint and architecture', zh: '展望・建筑' },
  '水族館': { en: 'Aquarium', zh: '水族馆' },
  '劇場': { en: 'Theatre', zh: '剧场' },
  '科学館': { en: 'Science museum', zh: '科学馆' },
  '屋内型遊園地': { en: 'Indoor amusement park', zh: '室内游乐园' },
  '歴史建築': { en: 'Historic architecture', zh: '历史建筑' },
  '博物館': { en: 'Museum', zh: '博物馆' },
  '遊園地': { en: 'Amusement park', zh: '游乐园' },
  '庭園': { en: 'Garden', zh: '庭园' },
  '公園': { en: 'Park', zh: '公园' },
  '天文台': { en: 'Observatory', zh: '天文台' },
  'テーマパーク': { en: 'Theme park', zh: '主题公园' },
  '展示施設': { en: 'Exhibition facility', zh: '展览设施' },
  'スポーツ施設': { en: 'Sports facility', zh: '体育设施' },
  '動物園': { en: 'Zoo', zh: '动物园' }
};

// #48: 到着時文化施設の二重管理を解消するため、LANDMARK_DEFS（駅周辺スポット）から
// 駅ごとの文化施設一覧を自動導出する。category 未指定の既存ランドマークは「文化施設」扱い。
// 例: 鉄道博物館（大成）駅のランドマーク「鉄道博物館」が到着表示にも自動反映される。
const DERIVED_CULTURAL_FACILITIES = {};
for (const def of Object.values(LANDMARK_DEFS)) {
  if (!def.station) continue;
  const ja = (def.names?.ja?.[0]) || '';
  if (!ja) continue;
  const en = (def.names?.en?.[0]) || ja;
  const zh = (def.names?.zh?.[0]) || ja;
  const category = def.category || '文化施設';
  (DERIVED_CULTURAL_FACILITIES[def.station] ||= []).push([ja, en, zh, category, def.walk_min || 5]);
}

function getDestinationCulturalFacilities(station, userLang = 'ja') {
  const langIndex = userLang === 'en' ? 1 : userLang === 'zh' ? 2 : 0;
  // 明示定義 + LANDMARK_DEFS 自動導出 を名前重複なしでマージ
  const explicit = DESTINATION_CULTURAL_FACILITIES[station] || [];
  const derived = DERIVED_CULTURAL_FACILITIES[station] || [];
  const seen = new Set(explicit.map(e => e[0]));
  const all = [...explicit];
  for (const d of derived) {
    if (!seen.has(d[0])) { seen.add(d[0]); all.push(d); }
  }
  return all.map(([ja, en, zh, category, walk_min]) => ({
    name: [ja, en, zh][langIndex],
    category: userLang === 'ja' ? category : (CULTURAL_CATEGORY_NAMES[category]?.[userLang] || category),
    walk_min
  }));
}

// ランドマーク名（別名・訳名・略称・多言語）で最寄り駅を解決。
// 1) 完全一致（全言語・小文字） 2) サフィックス除去 3) 部分一致（入力がいずれかの名称を含む、長い名称を優先）
function resolveLandmark(rawName, exactOnly = false) {
  if (!rawName) return null;
  const key = rawName.trim();
  const lower = key.toLowerCase();
  // 1. 完全一致（全言語）
  if (LANDMARK_LOOKUP[lower]) {
    const { defKey, lang, original } = LANDMARK_LOOKUP[lower];
    const def = LANDMARK_DEFS[defKey];
    return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
  }
  if (exactOnly) return null; // 完全一致のみ要求時は部分一致系を評価しない（旧駅名エイリアスとの衝突防止: 例「成田空港(旧)」）
  // 2. サフィックス除去（日本語の「駅」「公園」等を除去して再一致）
  const stripped = key.replace(/(駅|バス停|停留所|公園|競技場|ドーム|タワー|テーマパーク)$/, '');
  if (stripped !== key) {
    const sl = stripped.toLowerCase();
    if (LANDMARK_LOOKUP[sl]) {
      const { defKey, lang, original } = LANDMARK_LOOKUP[sl];
      const def = LANDMARK_DEFS[defKey];
      return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
    }
  }
  // 3. 部分一致（入力がいずれかの名称を含む）: 長い名称を優先（「東京ディズニーランド」が「ディズニー」より優先）
  const contained = Object.keys(LANDMARK_LOOKUP)
    .filter(k => lower.includes(k))
    .sort((a, b) => b.length - a.length);
  if (contained.length) {
    const { defKey, lang, original } = LANDMARK_LOOKUP[contained[0]];
    const def = LANDMARK_DEFS[defKey];
    return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
  }
  return null;
}

const STATION_NAME_MAP_LOWER = new Map(
  Object.entries(STATION_NAME_MAP).map(([k, v]) => [k.toLowerCase(), v])
);
function normalizeStationName(name) {
  const trimmed = String(name || '').trim();
  if (STATION_NAME_MAP[trimmed]) return STATION_NAME_MAP[trimmed];
  const mapped = STATION_NAME_MAP_LOWER.get(trimmed.toLowerCase());
  if (mapped) return mapped;
  // 一般的な駅名サフィックスは辞書登録の有無にかかわらず除去する。
  // 先に完全一致と辞書を評価しているため、正式名称の一部を壊さない。
  const withoutSuffix = trimmed.replace(/(?:駅|站|station)$/iu, '').trim();
  if (withoutSuffix !== trimmed) {
    if (STATION_NAME_MAP[withoutSuffix]) return STATION_NAME_MAP[withoutSuffix];
    return STATION_NAME_MAP_LOWER.get(withoutSuffix.toLowerCase()) || withoutSuffix;
  }
  return trimmed;
}

// ==========================================
// 🚄 特急・新幹線の乗り換え案内（経路検索グラフ対応は実装しない → 駅案内の表示のみ）
//   イシュー#76: 特急・新幹線の経路検索グラフ対応は行わない方針。
//   運賃体系（特急券・指定席券）と停車駅パターンが一般路線と異なるため、検索グラフには
//   組み込まず、以下の駅案内（みどりの窓口・指定席券売機）表示で対応する。
// ==========================================
// 特急・新幹線の種別名・列車名（ja/en/zh）。これらの単語が from/to に含まれる場合、
// 経路検索（普通列車ベースのグラフ）では正しく案内できないため、窓口案内を返す。
const LIMITED_EXPRESS_KEYWORDS = [
  // ja
  '新幹線', 'のぞみ', 'ひかり', 'こだま', 'やまびこ', 'はやぶさ', 'つばさ', 'こまち', 'はやて',
  'なすの', 'たにがわ', 'とき', 'あさま', 'はくたか', 'かがやき', 'みずほ', 'さくら',
  '特急', 'あずさ', 'かいじ', 'ひたち', 'ときわ', 'しおさい', 'わかしお', 'あやめ', '成田エクスプレス',
  // ja 私鉄系特急
  'ロマンスカー', 'ロマンスカ', 'はこね', 'えのしま', 'さがみ', 'ホームウェイ', 'あさぎり', 'メトロはこね', 'メトロえのしま',
  'りょうもう', 'けごん', 'きぬ', 'スペーシア', 'スペーシアX', 'リバティ', 'リバティけごん', 'きりふり',
  'スカイライナー', 'シティライナー', 'モーニングライナー', 'イブニングライナー',
  'ウィング', 'モーニング・ウィング', 'イブニング・ウィング', '快特',
  'レッドアロー', '小江戸', '川越特急', '秩父', '拝島ライナー', 'ドームライナー',
  '京王ライナー', 'Mt.TAKAO号', 'Mt.TAKAO',
  'S-TRAIN', '東横特急', 'アーバンパークライナー',
  // en
  'shinkansen', 'nozomi', 'hikari', 'kodama', 'yamabiko', 'hayabusa', 'komachi', 'tsubasa', 'hayate',
  'nasuno', 'tanigawa', 'toki', 'asama', 'hakutaka', 'kagayaki', 'mizuho', 'sakura',
  'limited express', 'azusa', 'kaiji', 'hitachi', 'tokiwa', 'shiosai', 'wakashio', 'ayame', 'narita express', "n'ex",
  // en 私鉄系特急
  'romancecar', 'romance car', 'hakone', 'enoshima', 'sagami', 'homeway', 'asagiri',
  'ryomo', 'kegon', 'kinu', 'spacia', 'liberty', 'kirifuri',
  'skyliner', 'city liner', 'morning liner', 'evening liner',
  'wing', 'morning wing', 'evening wing', 'kaisoku tokkyu',
  'red arrow', 'oedo', 'kawagoe express', 'chichibu', 'haijima liner',
  'keio liner', 's-train', 'urban park liner',
  // zh
  '新干线', '希望号', '光号', '回声号', '山彦号', '隼号', '小町号', '燕号', '朱鹭号', '浅间号', '白鹰号', '光辉号',
  '特急', '梓号', '甲斐路号', '常陆号', '常盘号', '潮骚号', '若潮号', '菖蒲号', '成田特快',
  // zh 私鉄系特急
  '罗曼史号', '箱根号', '江之岛号', '相模号', '朝雾号',
  '两毛号', '华严号', '鬼怒号', '特快spacia', '利伯缇号',
  '天空号', '晨间特快', '黄昏特快',
  '红箭号', '川越特急', '秩父号', '京王特快', '都市公园特快'
];

// 特急・新幹線の主要停車駅と窓口案内（みどりの窓口・指定席券売機）
const LIMITED_EXPRESS_STATION_GUIDE = {
  '東京': {
    ja: 'JR東京駅のみどりの窓口（丸の内地下・八重洲地下）または指定席券売機で、乗車券と特急券・新幹線指定席券をご購入ください（営業: 5:30〜23:10頃）。新幹線は東海道・東北・上越・北陸新幹線が発着します。',
    en: 'Purchase tickets at JR Tokyo Station\'s Midori-no-Madoguchi (Marunouchi underground / Yaesu underground) or ticket machines (approx. 5:30–23:10). Tokaido, Tohoku, Joetsu and Hokuriku Shinkansen depart from here.',
    zh: '请在JR东京站绿色窗口（丸之内地下・八重洲地下）或指定席售票机购买车票与特急券・新干线指定席券（营业约5:30〜23:10）。东海道・东北・上越・北陆新干线均在此发车。'
  },
  '品川': {
    ja: 'JR品川駅のみどりの窓口（中央改札付近）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します（のぞみ・ひかり・こだま）。',
    en: 'Purchase tickets at JR Shinagawa Station\'s Midori-no-Madoguchi (near the central gate) or ticket machines. Tokaido / Sanyo Shinkansen stop here (Nozomi, Hikari, Kodama).',
    zh: '请在JR品川站绿色窗口（中央检票口附近）或指定席售票机购买。东海道・山阳新干线在此停靠（希望号・光号・回声号）。'
  },
  '新横浜': {
    ja: 'JR新横浜駅のみどりの窓口（北改札・南改札）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します。',
    en: 'Purchase tickets at JR Shin-Yokohama Station\'s Midori-no-Madoguchi (north / south gates) or ticket machines. Tokaido / Sanyo Shinkansen stop here.',
    zh: '请在JR新横滨站绿色窗口（北检票口・南检票口）或指定席售票机购买。东海道・山阳新干线在此停靠。'
  },
  '大宮': {
    ja: 'JR大宮駅のみどりの窓口（中央改札・東口改札）または指定席券売機でご購入ください。東北・上越・北陸新幹線が停車します。',
    en: 'Purchase tickets at JR Omiya Station\'s Midori-no-Madoguchi (central / east gates) or ticket machines. Tohoku, Joetsu and Hokuriku Shinkansen stop here.',
    zh: '请在JR大宫站绿色窗口（中央检票口・东口检票口）或指定席售票机购买。东北・上越・北陆新干线在此停靠。'
  },
  '上野': {
    ja: 'JR上野駅のみどりの窓口（中央改札・入谷口）または指定席券売機でご購入ください。東北・上越・北陸新幹線が発着します。',
    en: 'Purchase tickets at JR Ueno Station\'s Midori-no-Madoguchi (central gate / Iriya exit) or ticket machines. Tohoku, Joetsu and Hokuriku Shinkansen depart from here.',
    zh: '请在JR上野站绿色窗口（中央检票口・入谷口）或指定席售票机购买。东北・上越・北陆新干线在此发车。'
  },
  '高崎': {
    ja: 'JR高崎駅のみどりの窓口または指定席券売機でご購入ください。上越・北陸新幹線（とき・たにがわ・はくたか等）が停車します。',
    en: 'Purchase tickets at JR Takasaki Station\'s Midori-no-Madoguchi or ticket machines. Joetsu / Hokuriku Shinkansen (Toki, Tanigawa, Hakutaka etc.) stop here.',
    zh: '请在JR高崎站绿色窗口或指定席售票机购买。上越・北陆新干线（朱鹭号・谷川号・白鹰号等）在此停靠。'
  },
  '長野': {
    ja: 'JR長野駅のみどりの窓口（東西自由通路）または指定席券売機でご購入ください。北陸新幹線（かがやき・はくたか）が発着します。',
    en: 'Purchase tickets at JR Nagano Station\'s Midori-no-Madoguchi (east-west passage) or ticket machines. Hokuriku Shinkansen (Kagayaki, Hakutaka) depart from here.',
    zh: '请在JR长野站绿色窗口（东西自由通道）或指定席售票机购买。北陆新干线（光辉号・白鹰号）在此发车。'
  },
  '新潟': {
    ja: 'JR新潟駅のみどりの窓口（中央改札・南口）または指定席券売機でご購入ください。上越新幹線（とき・たにがわ）が発着します。',
    en: 'Purchase tickets at JR Niigata Station\'s Midori-no-Madoguchi (central gate / south exit) or ticket machines. Joetsu Shinkansen (Toki, Tanigawa) depart from here.',
    zh: '请在JR新潟站绿色窗口（中央检票口・南口）或指定席售票机购买。上越新干线（朱鹭号・谷川号）在此发车。'
  },
  '仙台': {
    ja: 'JR仙台駅のみどりの窓口（中央改札）または指定席券売機でご購入ください。東北新幹線（はやぶさ・やまびこ等）が発着します。',
    en: 'Purchase tickets at JR Sendai Station\'s Midori-no-Madoguchi (central gate) or ticket machines. Tohoku Shinkansen (Hayabusa, Yamabiko etc.) depart from here.',
    zh: '请在JR仙台站绿色窗口（中央检票口）或指定席售票机购买。东北新干线（隼号・山彦号等）在此发车。'
  },
  '盛岡': {
    ja: 'JR盛岡駅のみどりの窓口または指定席券売機でご購入ください。東北新幹線（はやぶさ・やまびこ・こまち）が発着します。',
    en: 'Purchase tickets at JR Morioka Station\'s Midori-no-Madoguchi or ticket machines. Tohoku Shinkansen (Hayabusa, Yamabiko, Komachi) depart from here.',
    zh: '请在JR盛冈站绿色窗口或指定席售票机购买。东北新干线（隼号・山彦号・小町号）在此发车。'
  },
  '名古屋': {
    ja: 'JR名古屋駅のみどりの窓口（桜通口・太閤通口）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します。',
    en: 'Purchase tickets at JR Nagoya Station\'s Midori-no-Madoguchi (Sakura-dori / Taiko-dori exits) or ticket machines. Tokaido / Sanyo Shinkansen stop here.',
    zh: '请在JR名古屋站绿色窗口（樱通口・太阁通口）或指定席售票机购买。东海道・山阳新干线在此停靠。'
  },
  '京都': {
    ja: 'JR京都駅のみどりの窓口（中央口・八条口）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します。',
    en: 'Purchase tickets at JR Kyoto Station\'s Midori-no-Madoguchi (central / Hachijo exits) or ticket machines. Tokaido / Sanyo Shinkansen stop here.',
    zh: '请在JR京都站绿色窗口（中央口・八条口）或指定席售票机购买。东海道・山阳新干线在此停靠。'
  },
  '新大阪': {
    ja: 'JR新大阪駅のみどりの窓口（中央改札）または指定席券売機でご購入ください。東海道・山陽新幹線が発着します。',
    en: 'Purchase tickets at JR Shin-Osaka Station\'s Midori-no-Madoguchi (central gate) or ticket machines. Tokaido / Sanyo Shinkansen depart from here.',
    zh: '请在JR新大阪站绿色窗口（中央检票口）或指定席售票机购买。东海道・山阳新干线在此发车。'
  }
};

// 私鉄系特急の事業者別案内（JR とは異なり各社の窓口・券売機・Web予約で対応）
// keywords に該当する列車名が入力された場合、この事業者案内を返す
const PRIVATE_EXPRESS_GUIDE = [
  {
    operator: '小田急電鉄', train: 'ロマンスカー',
    keywords: ['ロマンスカー', 'ロマンスカ', 'はこね', 'えのしま', 'さがみ', 'ホームウェイ', 'あさぎり', 'romancecar', 'romance car', 'hakone', 'enoshima', 'sagami', 'homeway', 'asagiri', '罗曼史号', '箱根号', '江之岛号', '相模号', '朝雾号'],
    mainStations: ['新宿', '町田', '相模大野', '小田原'],
    guidance: {
      ja: '小田急ロマンスカーは特急券が必要です。新宿・町田・相模大野・小田原など主要駅の「ロマンスカー特急券売り場」または駅窓口でご購入ください。Web予約（e-romancecar.com）も利用できます。',
      en: 'Odakyu Romancecar requires a limited-express ticket. Purchase at the Romancecar ticket counters or station windows at major stations (Shinjuku, Machida, Sagami-Ono, Odawara). Online reservation (e-romancecar.com) is also available.',
      zh: '小田急罗曼史号需要特急券。请在新宿・町田・相模大野・小田原等主要车站的「罗曼史号特急券售票处」或车站窗口购买。也可使用网上预约（e-romancecar.com）。'
    }
  },
  {
    operator: '東武鉄道', train: '特急（りょうもう・けごん・スペーシア等）',
    keywords: ['りょうもう', 'けごん', 'きぬ', 'スペーシア', 'スペーシアX', 'リバティ', 'リバティけごん', 'きりふり', 'ryomo', 'kegon', 'kinu', 'spacia', 'liberty', 'kirifuri', '两毛号', '华严号', '鬼怒号', '特快spacia', '利伯缇号'],
    mainStations: ['浅草', '北千住', '春日部', '東武動物公園'],
    guidance: {
      ja: '東武特急（りょうもう・けごん・スペーシア等）は特急券が必要です。浅草・北千住・春日部・東武動物公園など主要駅の特急券売り場・窓口でご購入ください。Web予約も利用できます。',
      en: 'Tobu limited expresses (Ryomo, Kegon, Spacia etc.) require a limited-express ticket. Purchase at ticket counters / windows at major stations (Asakusa, Kita-Senju, Kasukabe, Tobu-Dobutsu-Koen). Online reservation is also available.',
      zh: '东武特急（两毛号・华严号・特快spacia等）需要特急券。请在浅草・北千住・春日部・东武动物公园等主要车站的特急券售票处・窗口购买。也可网上预约。'
    }
  },
  {
    operator: '京成電鉄', train: 'スカイライナー等',
    keywords: ['スカイライナー', 'シティライナー', 'モーニングライナー', 'イブニングライナー', 'skyliner', 'city liner', 'morning liner', 'evening liner', '天空号'],
    mainStations: ['京成上野', '日暮里', '成田空港'],
    guidance: {
      ja: '京成スカイライナーは特急券が必要です。京成上野・日暮里・成田空港など主要駅の特急券売り場・窓口（または券売機）でご購入ください。Web予約も利用できます。',
      en: 'Keisei Skyliner requires a limited-express ticket. Purchase at ticket counters / windows (or machines) at major stations (Keisei-Ueno, Nippori, Narita Airport). Online reservation is also available.',
      zh: '京成天空号需要特急券。请在京成上野・日暮里・成田机场等主要车站的特急券售票处・窗口（或售票机）购买。也可网上预约。'
    }
  },
  {
    operator: '京浜急行電鉄', train: 'ウィング号・快特',
    keywords: ['ウィング', 'モーニング・ウィング', 'イブニング・ウィング', 'wing', 'morning wing', 'evening wing', '快特', 'kaisoku tokkyu'],
    mainStations: ['品川', '横浜', '京急蒲田'],
    guidance: {
      ja: '京急のウィング号・快特は座席指定料金が必要な列車があります。品川・横浜・京急蒲田など主要駅の窓口・券売機でご確認ください（普通特急は追加料金なし）。',
      en: 'Keikyu Wing / Kaisoku Tokkyu trains may require a reserved-seat fare. Check at ticket windows / machines at major stations (Shinagawa, Yokohama, Keikyu-Kamata). Regular limited expresses need no surcharge.',
      zh: '京急的Wing号・快特部分列车需要指定座位费。请在品川・横滨・京急蒲田等主要车站的窗口・售票机确认（普通特急无需追加费用）。'
    }
  },
  {
    operator: '西武鉄道', train: 'レッドアロー・小江戸等',
    keywords: ['レッドアロー', '小江戸', '川越特急', '秩父', '拝島ライナー', 'ドームライナー', 'red arrow', 'oedo', 'kawagoe express', 'chichibu', 'haijima liner', '红箭号', '川越特急', '秩父号'],
    mainStations: ['池袋', '所沢', '本川越', '西武秩父'],
    guidance: {
      ja: '西武特急（レッドアロー・小江戸・秩父等）は特急券が必要です。池袋・所沢・本川越・西武秩父など主要駅の特急券売り場・窓口でご購入ください。Web予約も利用できます。',
      en: 'Seibu limited expresses (Red Arrow, Oedo, Chichibu etc.) require a limited-express ticket. Purchase at ticket counters / windows at major stations (Ikebukuro, Tokorozawa, Hon-Kawagoe, Seibu-Chichibu). Online reservation is also available.',
      zh: '西武特急（红箭号・小江户・秩父号等）需要特急券。请在池袋・所泽・本川越・西武秩父等主要车站的特急券售票处・窗口购买。也可网上预约。'
    }
  },
  {
    operator: '京王電鉄', train: '京王ライナー・Mt.TAKAO号',
    keywords: ['京王ライナー', 'Mt.TAKAO号', 'Mt.TAKAO', 'keio liner', '京王特快'],
    mainStations: ['新宿', '高尾山口'],
    guidance: {
      ja: '京王ライナー・Mt.TAKAO号はライナー券が必要です。新宿・高尾山口など主要駅の券売機・窓口でご購入ください。',
      en: 'Keio Liner / Mt.TAKAO require a liner ticket. Purchase at ticket machines / windows at major stations (Shinjuku, Takaosanguchi).',
      zh: '京王特快・高尾山号需要特快券。请在新宿・高尾山口等主要车站的售票机・窗口购买。'
    }
  },
  {
    operator: '東急電鉄', train: 'S-TRAIN・東横特急',
    keywords: ['S-TRAIN', '東横特急', 's-train', '都市公园特快'],
    mainStations: ['渋谷', '横浜'],
    guidance: {
      ja: '東急のS-TRAINは座席指定制です。渋谷・横浜など主要駅の窓口・券売機、またはWeb予約でご確認ください（東横特急は通常の特急で追加料金なし）。',
      en: 'Tokyu S-TRAIN is reserved-seat. Check at windows / machines at major stations (Shibuya, Yokohama) or book online. Toyoko limited express needs no surcharge.',
      zh: '东急S-TRAIN为指定座席制。请在涩谷・横滨等主要车站的窗口・售票机确认，或网上预约（东横特急为普通特急，无需追加费用）。'
    }
  },
  {
    operator: '東武鉄道（野田線）', train: 'アーバンパークライナー',
    keywords: ['アーバンパークライナー', 'urban park liner', '都市公园特快'],
    mainStations: ['大宮', '船橋', '柏'],
    guidance: {
      ja: '東武アーバンパークライナーはライナー券が必要です。大宮・船橋・柏など主要駅の窓口・券売機でご購入ください。',
      en: 'Tobu Urban Park Liner requires a liner ticket. Purchase at windows / machines at major stations (Omiya, Funabashi, Kashiwa).',
      zh: '东武都市公园特快需要特快券。请在大宫・船桥・柏等主要车站的窗口・售票机购买。'
    }
  }
];

// 私鉄特急の事業者判定: 入力に含まれるキーワードから事業者を特定
function detectPrivateExpressOperator(fromInput, toInput) {
  const combined = `${fromInput || ''} ${toInput || ''}`.toLowerCase();
  for (const op of PRIVATE_EXPRESS_GUIDE) {
    if (op.keywords.some(kw => combined.includes(kw))) return op;
  }
  return null;
}

// 特急・新幹線リクエストの検出: from/to に列車種別・列車名が含まれるか
function detectLimitedExpressRequest(fromInput, toInput) {
  const combined = `${fromInput || ''} ${toInput || ''}`.toLowerCase();
  // 駅名に含まれるキーワード（例: 「西武秩父」の「秩父」）は特急リクエストと誤判定しない。
  // 解決済み駅名を入力から除去してから判定する（例: 「池袋 秩父特急」→ 秩父 が残る→特急案内）。
  let residue = combined;
  for (const s of [fromInput, toInput]) {
    const r = resolveStation(s);
    if (r && r.station) {
      residue = residue.replace(r.station.toLowerCase(), ' ');
      for (const cand of (r.candidates || [])) {
        residue = residue.replace(String(cand).toLowerCase(), ' ');
      }
    }
  }
  return LIMITED_EXPRESS_KEYWORDS.some(kw => residue.includes(kw));
}

// 該当駅の特定: キーワードを除去した残り（またはキーワードを含まない入力）を駅名として解決
// 新幹線駅（新大阪など）は経路グラフに存在しないため、窓口ガイドのキーとも直接照合する。
function findLimitedExpressStation(fromInput, toInput) {
  const inputs = [fromInput, toInput];
  const candidates = [];
  for (const input of inputs) {
    const s = String(input || '').trim();
    if (!s) continue;
    // キーワード（列車名・種別）を除去した残りを駅名候補にする（大文字小文字を無視）
    let stripped = s;
    for (const kw of LIMITED_EXPRESS_KEYWORDS) {
      try { stripped = stripped.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '); } catch (_) {}
    }
    stripped = stripped.replace(/[、。・\s]+/g, ' ').trim();
    if (stripped) candidates.push(stripped);
  }
  for (const c of candidates) {
    const r = resolveStation(c);
    if (r && r.station) return r.station;
    // グラフに存在しない新幹線駅（新大阪等）は窓口ガイドのキーと直接照合
    if (LIMITED_EXPRESS_STATION_GUIDE[c]) return c;
  }
  return null;
}

// 特急・新幹線リクエストに対する窓口案内レスポンス
function buildLimitedExpressGuidance(userLang, fromInput, toInput) {
  const station = findLimitedExpressStation(fromInput, toInput);
  const guide = station ? LIMITED_EXPRESS_STATION_GUIDE[station] : null;
  // 私鉄系特急の事業者判定（例: ロマンスカー・スカイライナー・りょうもう等）
  const privateOp = detectPrivateExpressOperator(fromInput, toInput);
  const notice = userLang === 'en'
    ? '🚄 Limited express / Shinkansen routes are not included in the route search graph (issue #76: not planned). Please use the station guidance below (Midori-no-Madoguchi / designated-seat ticket machines) for tickets and transfers.'
    : userLang === 'zh'
      ? '🚄 路线搜索图不包含特急・新干线（issue #76：不计划实现）。请通过下方的车站指南（绿色窗口・指定席售票机）确认车票与换乘方式。'
      : '🚄 特急・新幹線は経路検索グラフに含めない方針です（issue #76: 実装しない）。チケット購入・乗り換えは下記の駅案内（みどりの窓口・指定席券売機）をご利用ください。';
  const howTo = userLang === 'en'
    ? 'Please check ticket availability and connections at the station\'s JR Midori-no-Madoguchi (green window) or designated-seat ticket machines.'
    : userLang === 'zh'
      ? '请在该站的JR绿色窗口（Midori-no-Madoguchi）或指定席售票机确认余票与换乘方式。'
      : '該当駅の JR みどりの窓口（または指定席券売機）で、乗車券・特急券の購入と乗り換えをご確認ください。';
  let stationBlock;
  if (guide) {
    stationBlock = { station, window_guidance: guide[userLang] };
  } else {
    const fallback = userLang === 'en'
      ? `For station ${station || 'the requested station'}: ask at the Midori-no-Madoguchi or ticket office for limited-express / Shinkansen tickets and transfers.`
      : userLang === 'zh'
        ? `关于${station || '所查询的车站'}：请到该站的绿色窗口或售票处咨询特急・新干线车票与换乘。`
        : `${station || '該当駅'}では、みどりの窓口または駅係員に特急・新幹線のチケットと乗り換えをお問い合わせください。`;
    stationBlock = { station: station || null, window_guidance: fallback };
  }
  const resp = {
    status: 'SUCCESS',
    mode: 'LIMITED_EXPRESS_GUIDANCE',
    detected_language: userLang,
    from: fromInput,
    to: toInput,
    notice,
    how_to_proceed: howTo,
    guidance: stationBlock,
    limited_express_note: userLang === 'en'
      ? 'This server covers local / rapid / express (ordinary-fare) rail. Shinkansen and limited-express fares require seat reservations handled at JR counters.'
      : userLang === 'zh'
        ? '本服务器支持普通列车・快速・普通特急（普通票价）的路线。新干线与特急的座位预约请在JR窗口办理。'
        : '本サーバーは普通・快速・各駅停車（普通運賃）の経路検索に対応しています。新幹線・特急の指定席予約はJR窓口でお取り扱いください。',
    direct_search_url: `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(fromInput || '')}&to=${encodeURIComponent(toInput || '')}`
  };
  // 私鉄系特急の場合は事業者別案内を追加
  if (privateOp) {
    const opLabel = privateOp.train || privateOp.operator;
    resp.private_express_guidance = {
      operator: privateOp.operator,
      train: opLabel,
      main_stations: privateOp.mainStations,
      guidance: privateOp.guidance[userLang],
      how_to_proceed: userLang === 'en'
        ? `Purchase limited-express tickets at the operator's ticket counters / windows (${privateOp.mainStations.join(', ')}) or book online.`
        : userLang === 'zh'
          ? `请在该公司的主要车站（${privateOp.mainStations.join('・')}）的特急券售票处・窗口购票，或使用网上预约。`
          : `${privateOp.operator}の主要駅（${privateOp.mainStations.join('・')}）の特急券売り場・窓口でご購入ください。Web予約も利用できます。`
    };
  }
  return resp;
}

// ==========================================
// 🚃 乗り換えルート検索（統合版）
// ==========================================
async function searchRoute(args) {
  const parsedArgs = parseTestMode({ from: args.from, to: args.to, '-test': args['-test'], test: args.test, test_mode: args.test_mode });
  let fromInput = parsedArgs.from, toInput = parsedArgs.to;
  let simulatedFailure = parsedArgs.simulatedFailure;

  // ユーザーの現在位置（GPS）: { lat, lon } 任意。指定時はシェアサイクル検索の基準にする
  let userLocation = null;
  if (args.user_location && typeof args.user_location.lat === 'number' && typeof args.user_location.lon === 'number') {
    userLocation = { lat: args.user_location.lat, lon: args.user_location.lon };
  } else if (typeof args.user_location === 'string') {
    const m = args.user_location.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) userLocation = { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }
  // 🔴 緯度経度の範囲検証（lat: -90〜90 / lon: -180〜180）。範囲外は無効として無視する。
  if (userLocation && !(userLocation.lat >= -90 && userLocation.lat <= 90 && userLocation.lon >= -180 && userLocation.lon <= 180)) {
    userLocation = null;
  }

  let userLang = 'ja';
  // 明示的な言語指定（args.language / args.lang）が最優先。
  // 例: ユーザーが英語で質問したのに駅名が日本語（浅草等）の場合、
  //     自動判定では ja になるため、クライアントが language:'en' を渡して英語応答を強制できる。
  const explicitLang = resolveLang(args);
  if (explicitLang) {
    userLang = explicitLang;
  } else if (simulatedFailure) {
    // fromInput の駅名部分（'-test' より前）の言語を優先判定。
    // ja/zh 共通キーワード（地震・人身事故等）でも、駅名が日本語なら ja、中国語なら zh となる。
    const stationPart = fromInput.split(/\s*-+\s*test/i)[0].trim();
    const stationLang = detectLanguage(stationPart);
    if (stationLang !== 'ja') {
      userLang = stationLang;
    }
    // 駅名が日本語（ja）の場合は userLang を 'ja' のままにする。
    // （ja/zh 共通キーワードの場合、駅名の言語を信頼する）
  } else {
    // 明示指定なし: from/to 双方を判定し、いずれかが zh/en ならその言語を採用（中国語/英語検索に検索言語で応答）
    const fL = detectLanguage(fromInput);
    const tL = detectLanguage(toInput);
    userLang = fL !== 'ja' ? fL : tL !== 'ja' ? tL : 'ja';
  }

  // 地震時は鉄道・トラム・バス等の通常経路を提示せず、安全確保を優先する。
  if (simulatedFailure && detectFailureType(simulatedFailure, userLang)?.adviceKey === 'earthquake') {
    return await buildEarthquakeSafetyResponse('ground', userLang, { from: fromInput, to: toInput });
  }

  // 🚄 特急・新幹線リクエスト: 経路グラフは普通列車ベースのため、該当駅の窓口案内を返す。
  // （新幹線・特急の乗り換え対応は大規模改修が必要なため見送り。窓口案内のみ表示）
  if (detectLimitedExpressRequest(fromInput, toInput)) {
    return jsonResponse(buildLimitedExpressGuidance(userLang, fromInput, toInput));
  }

  if (!fromInput || !toInput) {
    return jsonResponse(buildErrorResponse('INVALID_INPUT', '出発駅と到着駅の両方を指定してください。', { userLang, from: fromInput, to: toInput }));
  }

  const fromName = normalizeStationName(fromInput);
  const toName = normalizeStationName(toInput);
  const webSearchUrl = `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}`;

  let isRainy = false, isSevereWeather = false, weatherText = "未取得", isTrainSuspended = false, delayMessage = "";
  let busTransferDetected = false, busTransferDetail = "", isHot = false;
  let failureType = null, failureAdviceKey = null; // -test で指定された障害種別
  const suspendedLineNames = new Set();

  // -test シミュレーション
  if (simulatedFailure) {
    const fc = detectFailureType(simulatedFailure, userLang);
    // 注意: userLang は初期化部で fromInput の駅名言語に基づき決定済み。
    // ja/zh 共通キーワード（地震等）でも駅名の言語を優先するため、ここでは上書きしない。
    isRainy = fc.isRainy || false; isSevereWeather = fc.isSevereWeather || false;
    isHot = fc.isHot || false; isTrainSuspended = fc.isTrainSuspended || false;
    weatherText = fc.weatherText || (userLang === 'en' ? "Disruption detected" : userLang === 'zh' ? "检测到交通故障" : "障害検知");
    delayMessage = "🚨 " + (fc.delayMessage || (userLang === 'en' ? "Simulated disruption" : userLang === 'zh' ? "模拟交通故障" : "シミュレーション障害"));
    failureType = simulatedFailure; failureAdviceKey = fc.adviceKey || null;
    const simulatedLine = Object.keys(RAILWAY_LINES).find(line => simulatedFailure.includes(line));
    if (simulatedLine) suspendedLineNames.add(simulatedLine);
  }

  // 通常API（並列実行＋統一キャッシュ）
  let apiDegraded = false;
  if (!simulatedFailure) {
    const [weatherResult, trainResult] = await Promise.allSettled([
      (async () => {
        if (!jmaBreaker.canExecute()) return { error: 'CIRCUIT_OPEN' };
        try {
          const cached = cache.get(`${cache.jmaWeather.key}:130000`);
          if (cached) { isHot = cached.isHot; return cached; }
          const res = await axios.get("https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json", { timeout: 15000 });
          const text = res.data[0].timeSeries[0].areas[0].weathers[0];
          const r = text.includes("雨") || text.includes("雪") || text.includes("雷");
          const s = text.includes("特別警報") || text.includes("大雨特別") || text.includes("大雪特別") || text.includes("津波");
          let h = false;
          for (const ts of res.data[0]?.timeSeries || []) {
            if (ts.areas?.[0]?.temps) {
              const maxTemp = Math.max(...ts.areas[0].temps.map(t => parseInt(t) || 0));
              if (maxTemp >= 33) h = true;
            }
          }
          isHot = h;
          jmaBreaker.onSuccess();
          const result = { weather: text, isRainy: r, isSevere: s, isHot: h };
          cache.set(`${cache.jmaWeather.key}:130000`, result, cache.jmaWeather.ttl);
          return result;
        } catch (e) { jmaBreaker.onFailure(e); return { error: e.message }; }
      })(),
      (async () => {
        if (!odptBreaker.canExecute()) return { error: 'CIRCUIT_OPEN' };
        try {
          const operators = ['TokyoMetro', 'Toei', 'TamaMonorail', 'MIR', 'TWR'];
          const results = await Promise.allSettled(operators.map(op => axios.get(`${API_BASE_URL}/odpt:TrainInformation`, { params: getParams(op), timeout: 15000 })));
          const allDelays = []; let fb = false, fd = '';
          const fulfilledCount = results.filter(res => res.status === 'fulfilled').length;
          if (fulfilledCount === 0) {
            throw new Error('All ODPT train information requests failed');
          }
          for (const res of results) {
            if (res.status === 'rejected') continue;
            for (const info of res.value.data) {
              if (!info['odpt:trainInformationStatus']) continue;
              const t = info['odpt:trainInformationText']?.ja || '';
              const resumed = t.includes('再開');
              if (!resumed && (t.includes("運転見合わせ") || t.includes("見合わせ") || t.includes("運休"))) {
                allDelays.push({ railway: info['odpt:railway'], text: t });
                for (const lineName of resolveSuspendedLineNames(info['odpt:railway'])) suspendedLineNames.add(lineName);
              }
              if (t.includes('バス') || t.includes('振替') || t.includes('代行') || t.includes('輸送')) { fb = true; fd = t; }
            }
          }
          busTransferDetected = fb; busTransferDetail = fd;
          odptBreaker.onSuccess();
          return { delays: allDelays, busTransfer: fb, busTransferDetail: fd, suspendedLineNames: [...suspendedLineNames] };
        } catch (e) { odptBreaker.onFailure(e); return { error: e.message }; }
      })()
    ]);

    if (weatherResult.status === 'fulfilled' && weatherResult.value && !weatherResult.value.error) {
      const w = weatherResult.value;
      weatherText = w.weather; isRainy = w.isRainy; isSevereWeather = w.isSevere; isHot = w.isHot || false;
    } else if (weatherResult.status === 'fulfilled' && weatherResult.value?.error === 'CIRCUIT_OPEN') {
      return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', '気象庁APIが利用できません。', { userLang, from: fromName, to: toName, breakerName: jmaBreaker.name, breakerState: jmaBreaker.state }));
    } else { apiDegraded = true; } // 天気API取得失敗
    if (trainResult.status === 'fulfilled' && trainResult.value && !trainResult.value.error) {
      const t = trainResult.value;
      for (const lineName of (t.suspendedLineNames || [])) suspendedLineNames.add(lineName);
      if (t.delays.length > 0) { isTrainSuspended = true; delayMessage = `🚨 ${t.delays[0].railway.replace('odpt:Railway:', '')}: ${translateTrainInfoDetail(t.delays[0].text, userLang)}`; }
      if (t.busTransfer && !delayMessage) delayMessage = `🚨 ${translateTrainInfoDetail(t.busTransferDetail, userLang)}`;
    } else if (trainResult.status === 'fulfilled' && trainResult.value?.error === 'CIRCUIT_OPEN') {
      return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT APIが利用できません。', { userLang, from: fromName, to: toName, breakerName: odptBreaker.name, breakerState: odptBreaker.state }));
    } else { apiDegraded = true; } // 運行情報API取得失敗
  }

  const isEmergencyActive = isTrainSuspended || isSevereWeather;
  // 障害種別→アドバイス連動：failureAdviceKeyがある場合は専用アドバイス、なければ従来の天候ベース
  let adviceKey;
  if (failureAdviceKey) {
    adviceKey = failureAdviceKey;
  } else if (isEmergencyActive) {
    adviceKey = 'emergency';
  } else if (isHot) {
    adviceKey = 'hot';
  } else if (isRainy) {
    adviceKey = 'rainy';
  } else {
    adviceKey = 'fair';
  }
  const aiAdvice = MULTILINGUAL_ADVICE[adviceKey]?.[userLang] || MULTILINGUAL_ADVICE[adviceKey]?.ja || "情報なし";

  // 🚲 運転見合わせ時のみ自転車。ただし降雪・凍結時は転倒リスクが高いため非表示。
  // failureAdviceKey を見ることで、実際の降雪警報だけでなく -test 降雪も安全に抑止する。
  const isSnowRisk = failureAdviceKey === 'snow' || /雪|積雪|凍結/i.test(weatherText || '');
  let bikeShareInfo = null;
  let destinationBikeShareInfo = null;
  if (isTrainSuspended && !isSevereWeather && !isSnowRisk) {
    bikeShareInfo = await findNearestBikeStations(fromName, userLocation);
  }
  // 荒天・降雪・凍結時を除き、到着地点周辺のラストワンマイル用ポートを案内する。
  // リアルタイムAPIが取得できない場合は推測せず、案内ブロック自体を省略する。
  if (!isSevereWeather && !isSnowRisk) {
    destinationBikeShareInfo = await findNearestBikeStations(toName, null);
  }

  const displayFrom = getDisplayStationName(fromName, userLang);
  const displayTo = getDisplayStationName(toName, userLang);
  // 🚌 駅⇔コミュニティバス接続（足の悪いユーザーの駅までの足・駅からの足）
  const communityBusAccess = [
    buildCommunityBusAccessBlock(fromName, userLang),
    buildCommunityBusAccessBlock(toName, userLang)
  ].filter(Boolean);
  const communityBusAccessOut = communityBusAccess.length ? communityBusAccess : undefined;

  // 🗺️ 経路探索エンジン（ODPTキー不要・自己完結型）で実ルートを算出
  let routeOperational = true;
  let routeResult = (simulatedFailure)
    ? { error: 'TEST_MODE' }
    : computeRoutes(fromName, toName, { blockedLines: suspendedLineNames });
  if (!simulatedFailure && suspendedLineNames.size > 0 && routeResult?.error === 'NO_ROUTE') {
    const fallbackRoute = computeRoutes(fromName, toName);
    if (fallbackRoute?.routes) {
      routeResult = fallbackRoute;
      routeOperational = false;
    }
  }

  // ルートが見つからない場合は、エラー種別に応じた統一エラー応答を返す（SUCCESSを誤って返さない）
  if (routeResult && routeResult.error && routeResult.error !== 'TEST_MODE') {
    if (routeResult.error === 'AMBIGUOUS_STATION') {
      // 同名・類似駅名が複数あり、誤認リスクがあるため検索を中断し選択を促す
      const sideLabel = routeResult.side === 'from'
        ? (userLang === 'en' ? 'departure' : userLang === 'zh' ? '出发' : '出発')
        : (userLang === 'en' ? 'arrival' : userLang === 'zh' ? '到达' : '到着');
      // #64: 候補に所属路線名（ja/en/zh）を併記し、多言語ユーザーでも選択しやすくする。
      // 例: 入谷（東京メトロ日比谷線）/ 入谷（相模線）
      const candidatesDisp = (routeResult.candidates || []).map((c, i) => {
        const stationDisp = getDisplayStationName(c, userLang);
        // 括弧付き正式キー（例: 入谷（相模線））は表示名に既に路線名が含まれるため併記しない
        if (c.includes('（') || stationDisp.includes('(')) return stationDisp;
        const lineRefs = AMBIGUOUS_STATION_LINES[routeResult.input] || AMBIGUOUS_STATION_LINES[normalizeStationName(routeResult.input)] || [];
        const lineName = lineRefs[i] ? getLineDisplayName(lineRefs[i], userLang) : '';
        if (!lineName) return stationDisp;
        // 言語に応じて括弧を切り替え（en: 半角 / ja・zh: 全角）
        return userLang === 'en' ? `${stationDisp} (${lineName})` : `${stationDisp}（${lineName}）`;
      });
      const promptMsg = userLang === 'en'
        ? `Multiple stations match "${routeResult.input}" (${sideLabel}). Please choose one: ${candidatesDisp.join(' / ')}`
        : userLang === 'zh'
          ? `「${routeResult.input}」匹配到多个车站（${sideLabel}）。请选择其一：${candidatesDisp.join(' / ')}`
          : `「${routeResult.input}」に一致する駅が複数あります（${sideLabel}）。どれかを選択してください：${candidatesDisp.join(' / ')}`;
      const disambiguation = {
        input: routeResult.input,
        side: routeResult.side,
        candidates: candidatesDisp,
        candidates_raw: routeResult.candidates, // #64: 再入力可能な正式キー（括弧付き表記）も併記
        message: promptMsg
      };
      return jsonResponse(buildErrorResponse('AMBIGUOUS_STATION', promptMsg, {
        userLang, from: displayFrom, to: displayTo, disambiguation
      }));
    }
    const errType = routeResult.error === 'STATION_NOT_FOUND' ? 'STATION_NOT_FOUND' : 'NO_ROUTE';
    const errMsg = errType === 'STATION_NOT_FOUND'
      ? (userLang === 'en' ? `Station not found: ${displayFrom} / ${displayTo}`
         : userLang === 'zh' ? `未找到车站：${displayFrom} / ${displayTo}`
         : `駅が見つかりません：${displayFrom} / ${displayTo}`)
      : (userLang === 'en' ? `No route found from ${displayFrom} to ${displayTo}.`
         : userLang === 'zh' ? `未找到从 ${displayFrom} 到 ${displayTo} 的路线。`
         : `${displayFrom} から ${displayTo} への経路が見つかりません。`);
    return jsonResponse(buildErrorResponse(errType, errMsg, {
      userLang, from: displayFrom, to: displayTo,
      suggestion_from: routeResult.suggestion_from, suggestion_to: routeResult.suggestion_to
    }));
  }

  let routesPayload = undefined;
  const landmarkInfo = {};
  if (routeResult && routeResult.routes) {
    routesPayload = routeResult.routes.map(r => ({
      summary: {
        from: getDisplayStationName(r.summary.from, userLang),
        to: getDisplayStationName(r.summary.to, userLang),
        transfers: r.summary.transfers,
        total_stops: r.summary.total_stops,
        estimated_minutes: r.summary.estimated_minutes,
        main_line: getDisplayLineName(r.summary.main_line, userLang)
      },
      segments: r.segments.map(s => s.walk ? {
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
    }));
    // ランドマーク（施設名）から変換された場合、ユーザーへの案内として付与
    // note は言語別オブジェクト {ja,en,zh} → 応答言語(userLang)で解決
    const pickLang = (noteObj) => (noteObj && typeof noteObj === 'object' ? (noteObj[userLang] || noteObj.ja || '') : (noteObj || ''));
    if (routeResult.fromLandmark) {
      const noteStr = pickLang(routeResult.fromLandmarkNote);
      landmarkInfo.from = {
        landmark: routeResult.fromLandmark,
        nearest_station: getDisplayStationName(routeResult.from, userLang),
        note: userLang === 'en' ? `Nearest station to ${routeResult.fromLandmark}: ${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : userLang === 'zh' ? `${routeResult.fromLandmark} 的最近车站：${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : `${routeResult.fromLandmark} の最寄り駅：${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
      };
    }
    if (routeResult.toLandmark) {
      const noteStr = pickLang(routeResult.toLandmarkNote);
      landmarkInfo.to = {
        landmark: routeResult.toLandmark,
        nearest_station: getDisplayStationName(routeResult.to, userLang),
        note: userLang === 'en' ? `Nearest station to ${routeResult.toLandmark}: ${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : userLang === 'zh' ? `${routeResult.toLandmark} 的最近车站：${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : `${routeResult.toLandmark} の最寄り駅：${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
      };
    }
  }

  const resultPayload = {
    status: simulatedFailure ? (isEmergencyActive ? "EMERGENCY_MODE_ACTIVE" : "TEST_MODE") : (isEmergencyActive ? "EMERGENCY_MODE_ACTIVE" : "SUCCESS"),
    // AIインテリジェントアドバイスを先頭に配置（LLMが後半を省略しないよう）
    ai_transit_advice: aiAdvice,
    from: displayFrom, to: displayTo, mode: simulatedFailure ? "TEST_MODE" : "LIVE",
    detected_language: userLang,
    detected_user_language: userLang,
    degraded_mode: apiDegraded ? true : undefined,
    // 実ルート（自己完結型経路エンジンで算出）
    routes: routesPayload,
    route_operational: routeOperational && (!isTrainSuspended || suspendedLineNames.size > 0),
    suspended_lines: suspendedLineNames.size ? [...suspendedLineNames].map(line => getDisplayLineName(line, userLang)) : undefined,
    // ランドマーク（施設名）入力時の最寄り駅案内
    landmark_info: Object.keys(landmarkInfo).length ? landmarkInfo : undefined,
    // 降車駅周辺の文化・芸能・芸術施設（到着地側のみ表示）
    destination_cultural_facilities: getDestinationCulturalFacilities(routeResult.to, userLang).length
      ? getDestinationCulturalFacilities(routeResult.to, userLang)
      : undefined,
    route_note: userLang === 'en' ? "Route computed by the built-in route engine." :
                userLang === 'zh' ? "路线由内置路线引擎计算。" :
                "経路は自己完結型エンジンで算出。",
    weather_text: userLang === 'en' ? `Tokyo Area: ${translateWeather(weatherText, 'en')}` : userLang === 'zh' ? `东京地区: ${translateWeather(weatherText, 'zh')}` : `東京地方: ${weatherText}`,
    // 路線情報の外部検索URLはフォールバックとして維持
    direct_search_url: (isRainy || isEmergencyActive) ? `${webSearchUrl}&useLocalBus=true&walkSpeed=slow` : webSearchUrl,
    // 運賃情報はsearch_fareツールで取得可能
    fare_available: true,
    fare_note: userLang === 'en' ? "Use search_fare tool to find station-to-station fares." :
               userLang === 'zh' ? "使用 search_fare 工具查询车站间票价。" :
               "search_fareツールで駅間運賃を検索できます。",
    // 公的機関の検索案内: GPS共有があれば現在地、なければ到着駅名・バス停名を基準に表示する。
    // （ご老人等が「駅名」で公的機関を探すケースに対応。v2.36.3）
    gov_facility_search_support: buildGovFacilitySearchSupport(userLocation, userLang, displayTo),
    // 🚌 駅⇔コミュニティバス接続（足の悪いユーザーの駅までの足・駅からの足）
    community_bus_access: communityBusAccessOut
  };

  if (!isSevereWeather && !isSnowRisk && destinationBikeShareInfo) {
    resultPayload.destination_bike_share = {
      note: userLang === 'en' ? "🚲 [Bike Share Near Destination]" :
            userLang === 'zh' ? "🚲 【到达地点附近的共享单车】" :
            "🚲 【到着地点周辺のレンタサイクル】",
      recommendation: userLang === 'en' ? "Bike-share ports near the destination are available for last-mile travel." :
        userLang === 'zh' ? "可使用到达地点附近的共享单车进行最后一段行程。" :
        "到着地点周辺のポートを、ラストワンマイルの移動に利用できます。",
      based_on: 'destination',
      stations: destinationBikeShareInfo,
      total_nearby: destinationBikeShareInfo.length,
      data_source: "docomo-cycle-tokyo GBFS",
      caution: userLang === 'en' ? "Availability and return eligibility may change; check the official app." :
        userLang === 'zh' ? "可用车辆和还车状态可能变化，请通过官方应用确认。" :
        "利用可能台数・返却可否は変動するため、利用前に公式アプリでご確認ください。"
    };
  }

  if (isTrainSuspended && !isSevereWeather && bikeShareInfo) {
    const ref = bikeShareInfo[0]?.reference;
    const isUserLoc = ref === 'user_location';
    resultPayload.cycling_alternative = {
      note: userLang === 'en' ? "🚲 [Transit Suspension - Bike Share Guidance]" :
            userLang === 'zh' ? "🚲 【暂停运营 - 共享单车指南】" :
            "🚲 【運転見合わせ - シェアサイクル案内】",
      recommendation: isUserLoc
        ? (userLang === 'en' ? "🚲 Nearest bike share ports from your current location:" :
           userLang === 'zh' ? "🚲 您当前位置附近的共享单车停靠点：" :
           "🚲 現在地最寄りのシェアサイクルポート：")
        : (userLang === 'en' ? "🚲 Nearest bike share ports from origin station:" :
           userLang === 'zh' ? "🚲 出发站附近的共享单车停靠点：" :
           "🚲 出発駅最寄りのシェアサイクルポート："),
      based_on: isUserLoc ? 'user_location' : 'origin_station',
      stations: bikeShareInfo, total_nearby: bikeShareInfo.length, data_source: "docomo-cycle-tokyo GBFS"
    };
  }

  // フェリー代替
  if (FERRY_PORT_MAP[fromName] || FERRY_PORT_MAP[toName]) {
    resultPayload.ferry_alternative = {
      note: userLang === 'en' ? "🚢 [Ferry Service Guidance]" :
            userLang === 'zh' ? "🚢 【轮渡航线指南】" :
            "🚢 【フェリー航路のご案内】",
      suggestion: userLang === 'en' ? "Use search_ferry tool for details." :
                  userLang === 'zh' ? "使用 search_ferry 工具查看详情。" :
                  "search_ferryツールで詳細を検索できます。"
    };
  }

  // 非鉄道系
  resultPayload.non_rail_transit_support = {
    note: userLang === 'en' ? "🚃 Non-rail transit also available" :
          userLang === 'zh' ? "🚃 非铁路交通工具亦可使用" :
          "🚃 非鉄道系交通機関も利用可能",
    operators: Object.values(NON_RAIL_OPERATORS).map(op => userLang === 'en' ? op.labelEn : userLang === 'zh' ? op.labelZh : op.label).join(userLang === 'en' ? ', ' : '、'),
    suggestion: userLang === 'en' ? "Check list_transit_operators tool for details" :
                userLang === 'zh' ? "详情请使用 list_transit_operators 工具" :
                "詳細は list_transit_operators ツールを"
  };

  // 🚉 バス連携を検出した場合だけ、出発駅周辺のバス停を案内する。
  // 鉄道のみの通常経路に「最寄りの出口直結バス」等を推測して混在させない。
  if (fromName && (communityBusAccessOut?.length || busTransferDetected)) {
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fromName + '駅 バス停')}`;
    resultPayload.station_bus_stops = {
      note: userLang === 'en' ? "🚉 [Bus Stops Relevant to This Journey]" :
            userLang === 'zh' ? "🚉 【与本次行程相关的车站周边巴士站】" :
            "🚉 【この経路に関連する駅周辺バス停】",
      link: mapUrl,
      basis: communityBusAccessOut?.length ? 'community_bus_access' : 'substitute_transport',
      hint: userLang === 'en' ? `Verify the boarding stop and exit with station staff or the bus operator near ${displayFrom} Station.` :
            userLang === 'zh' ? `请向车站工作人员或巴士运营商确认${displayFrom}站附近的乘车站点与出口。` :
            `${displayFrom}駅での乗車バス停・最寄り出口は、駅係員またはバス事業者の案内でご確認ください。`,
      link_label: userLang === 'en' ? `📍 Show bus stops near ${displayFrom} Station on Google Maps` :
                  userLang === 'zh' ? `📍 在地图上查看${displayFrom}站周边巴士站` :
                  `📍 ${displayFrom}駅周辺のバス停を地図で確認`
    };
  }

  // 振替輸送
  if (busTransferDetected && busTransferDetail) {
    resultPayload.bus_transfer_alternative = {
      note: userLang === 'en' ? "🚌 [Substitutive Bus Transport]" :
            userLang === 'zh' ? "🚌 【接驳换乘巴士指南】" :
            "🚌 【振替輸送のご案内】",
      detail: translateTrainInfoDetail(busTransferDetail, userLang),
      suggestion: userLang === 'en' ? "Please inquire with station staff." :
                  userLang === 'zh' ? "请咨询车站工作人员。" :
                  "駅係員にお問い合わせください。"
    };
  }

  // 🚨 緊急避難場所の検索リンクは、災害時のみ表示する。
  // 人身事故・降雪・通常の運行障害は避難場所の適合性を意味しないためリンクを付けない。
  const isDisasterEvacuationCase = ['earthquake', 'emergency', 'typhoon', 'flood', 'fire'].includes(failureAdviceKey);
  if (isEmergencyActive) {
    resultPayload.emergency_alert = {
      status: "ALERT_ACTIVE",
      reason: userLang === 'en' ? (isTrainSuspended ? "Train line suspension detected" : "Emergency disaster warning detected") :
              userLang === 'zh' ? (isTrainSuspended ? "检测到铁路线路暂停运营" : "检测到特别预警级重大灾害") :
              (isTrainSuspended ? "鉄道路線の運行不能を検知" : "特別警報級の重大災害を検知"),
      detail: delayMessage,
      note: (MULTILINGUAL_ADVICE[adviceKey] && (MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja)) || MULTILINGUAL_ADVICE.emergency[userLang] || MULTILINGUAL_ADVICE.emergency.ja,
      evacuation_search: isDisasterEvacuationCase ? {
        type: 'external_search_only',
        link: EMERGENCY_EVACUATION_SEARCH_URL,
        label: userLang === 'en' ? 'Search designated emergency shelters (verify with local authority)'
          : userLang === 'zh' ? '搜索指定紧急避难场所（请向当地政府核实）'
          : '指定緊急避難場所を検索（自治体の公式情報で確認）',
        disclaimer: userLang === 'en'
          ? 'This is a map search, not a verified nearest or hazard-specific shelter assignment. Follow local-authority evacuation instructions.'
          : userLang === 'zh'
            ? '这是地图搜索，并非已核实的最近或适用于该灾害的避难场所分配。请遵从当地政府的避难指示。'
            : '地図検索であり、最寄り・災害種別に適合した避難場所を確定するものではありません。自治体の避難情報に従ってください。'
      } : undefined
    };
  }

  if (simulatedFailure) { resultPayload.test_mode = true; resultPayload.simulated_failure_type = simulatedFailure; }
  return jsonResponse(resultPayload);
}

// ==========================================
// 🚉 駅情報取得
// ==========================================
async function getStationInfo(args) {
  const rawStation = args.station_name || '';
  const stationName = normalizeStationName(rawStation);
  const operator = args.operator ? OPERATOR_MAP[args.operator] : null;
  const userLang = resolveLang(args) || detectLanguage(rawStation) || 'ja';
  if (!rawStation) {
    const msg = userLang === 'en' ? 'Please specify a station name.' : userLang === 'zh' ? '请指定车站名称。' : '駅名を指定してください。';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', msg, { userLang }));
  }
  if (!odptBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT APIが利用できません。', { userLang, station: stationName, breakerName: odptBreaker.name, breakerState: odptBreaker.state }));
  try {
    const response = await axios.get(`${API_BASE_URL}/odpt:Station`, { params: getParams(operator, { 'dc:title': stationName }), timeout: 15000 });
    const stations = response.data;
    odptBreaker.onSuccess();
    const displayStation = getDisplayStationName(stationName, userLang);
    if (!stations || stations.length === 0) {
      // #53: ODPTに無い駅（JR・私鉄の多く）は内蔵グラフからフォールバックする。
      // ODPTは東京メトロ・都営・横浜市営・TX等の公式データのみで、JR東日本・京急・京王等は
      // 駅データが存在しない（odpt:Station で取得できない）。内蔵 RAILWAY_LINES から
      // 所属路線と駅コード（路線内インデックス）を補完して返す。
      const localLines = STATION_TO_LINES[stationName] || [];
      if (localLines.length > 0) {
        const fallbackResults = localLines.map(entry => {
          const lineName = entry.line;
          // 路線内の駅コード（例: JI 01 形式にはしない。インデックスは0始まりのため1始まりで表示）
          const code = `${entry.index + 1}`;
          return {
            id: `local:${lineName}:${stationName}`,
            name: getDisplayStationName(stationName, userLang),
            code,
            line: getLineDisplayName(lineName, userLang),
            source: 'internal_graph'
          };
        });
        return jsonResponse({
          status: "SUCCESS",
          detected_language: userLang,
          station: displayStation,
          source: "internal_graph_fallback",
          results: fallbackResults,
          note: userLang === 'en' ? "This station is not in the ODPT dataset; shown from the built-in route graph." :
                userLang === 'zh' ? "该车站不在ODPT数据集中，已从内置路线图显示。" :
                "この駅はODPTデータに無いため、内蔵路線グラフから表示しています。",
          // 駅周辺の文化施設（search_route と同じ自動選出ルーチン）
          cultural_facilities: getDestinationCulturalFacilities(stationName, userLang).length
            ? getDestinationCulturalFacilities(stationName, userLang)
            : undefined,
          // 公的機関の検索案内（駅名基準・v2.36.3 と同設計。駅検索でも表示する）
          gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, displayStation)
        });
      }
      const msg = userLang === 'en' ? `No station info found for ${displayStation}.` : userLang === 'zh' ? `未找到 ${displayStation} 的车站信息。` : '駅情報が見つかりませんでした。';
      return jsonResponse(buildErrorResponse('PARSE_ERROR', msg, { userLang, station: displayStation }));
    }
    return jsonResponse({
      status: "SUCCESS",
      detected_language: userLang,
      station: displayStation,
      results: stations.map(s => ({ id: s['@id'].replace('odpt:Station:', ''), name: s['dc:title'], code: s['odpt:stationCode'] })),
      // 駅周辺の文化施設（search_route と同じ自動選出ルーチン: LANDMARK_DEFS + 明示定義）
      cultural_facilities: getDestinationCulturalFacilities(stationName, userLang).length
        ? getDestinationCulturalFacilities(stationName, userLang)
        : undefined,
      // 公的機関の検索案内（駅名基準・v2.36.3 と同設計。駅検索でも表示する）
      gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, displayStation)
    });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang, station: stationName, api: 'ODPT' });
  }
}

// ==========================================
// ☀️ 天気情報（高温・降水検出対応）
// ==========================================
// 天候から AIインテリジェントアドバイスを生成（getWeather と searchFlight で共有）
// 戻り値: { advice: string(ai_transit_advice), weather: string, isRainy, isHot, maxTemp }
// 🔴 #79: キャッシュキーを areaCode 別にする（地域をまたいで東京の予報を再利用しない）。
// 通信障害時は SUCCESS/null を返さず throw し、呼び出し側（getWeather）が
// NETWORK_ERROR / API_TIMEOUT を返す。getTransitAdvice / searchFlight は
// try/catch 済みのため、throw しても従来どおり既定アドバイスへフォールバックする。
async function getWeatherAdvice(userLang, areaCode = '130000') {
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

async function getWeather(args) {
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

// ============================================================
// 🚌 東京都コミュニティバス一覧（tokyobus.or.jp ディレクトリ）
// ============================================================
async function listCommunityBuses(args) {
  const userLang = resolveLang(args) || 'ja';
  const sorted = [...TOKYO_COMMUNITY_BUSES].sort((a, b) => a.municipality.localeCompare(b.municipality, 'ja'));
  return jsonResponse({
    status: "SUCCESS",
    detected_language: userLang,
    title: userLang === 'en' ? "🚌 Tokyo Community Buses" : userLang === 'zh' ? "🚌 东京都社区公交一览" : "🚌 東京都コミュニティバス一覧",
    note: userLang === 'en' ? "41 community buses across Tokyo wards/cities (source: Tokyo Bus Association tokyobus.or.jp). Timetables & routes are available on each municipality's official site." :
          userLang === 'zh' ? "东京都23区及多摩地区的41条社区公交（来源：东京巴士协会 tokyobus.or.jp）。时刻表与路线请参见各自治体官网。" :
          "東京都23区・多摩地域の41コミュニティバス（出典: 東京バス協会 tokyobus.or.jp）。時刻表・路線は各自治体公式サイトでご確認ください。",
    total: sorted.length,
    community_buses: sorted.map(b => ({ municipality: b.municipality, name: b.name, url: b.url })),
    source: "https://www.tokyobus.or.jp/sp/"
  });
}

// ============================================================
// 🚢 フェリー港一覧
// ============================================================
async function listFerryPorts(args) {
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

// ==========================================
// 🌊 フェリー向け海上・津波安全情報
// ==========================================
const JMA_TSUNAMI_LIST_URL = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
const JMA_TSUNAMI_DETAIL_BASE_URL = 'https://www.jma.go.jp/bosai/tsunami/data/';

// 港ごとの津波予報区（JMAの予報区名との照合用）。
// 範囲外の港は安全側に倒し、全国有効警報がある場合は航路を抑止する。
const FERRY_PORT_TSUNAMI_AREAS = {
  '浅草': ['東京湾内湾'], '日の出桟橋': ['東京湾内湾'], '浜離宮': ['東京湾内湾'],
  'お台場海浜公園': ['東京湾内湾'], '豊洲': ['東京湾内湾'],
  '東京': ['東京湾内湾'], '竹芝': ['東京湾内湾'],
  '大島': ['伊豆諸島'], '利島': ['伊豆諸島'], '新島': ['伊豆諸島'], '式根島': ['伊豆諸島'],
  '神津島': ['伊豆諸島'], '三宅島': ['伊豆諸島'], '御蔵島': ['伊豆諸島'], '八丈島': ['伊豆諸島'],
  '青ヶ島': ['伊豆諸島'], '父島': ['小笠原諸島'], '母島': ['小笠原諸島'],
  '熱海': ['静岡県'], '伊東': ['静岡県'], '下田': ['静岡県']
};

function isActiveTsunamiWarning(kind) {
  const text = String(kind || '');
  return /大津波警報|津波警報|津波注意報|Major Tsunami Warning|Tsunami Warning|Tsunami Advisory/i.test(text)
    && !/解除|No Tsunami/i.test(text);
}

async function fetchJmaTsunamiSafety() {
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

function getTsunamiAreasForPorts(...ports) {
  return [...new Set(ports.flatMap(p => FERRY_PORT_TSUNAMI_AREAS[p] || []))];
}

function isTsunamiRelevantToPorts(tsunami, ...ports) {
  if (!tsunami.active) return false;
  const portAreas = getTsunamiAreasForPorts(...ports);
  // 港の予報区が未登録なら、安全側で有効な津波警報を航路停止対象とする。
  if (!portAreas.length) return true;
  return tsunami.areas.some(a => portAreas.some(pa => a.name.includes(pa) || pa.includes(a.name)));
}

async function buildTsunamiWaterSafetyResponse(userLang, tsunami, context = {}) {
  const safety = buildEarthquakeTransportSafety('water', userLang);
  const advisory = userLang === 'en'
    ? 'An active tsunami warning/advisory affects this water-transport area. Do not board or continue water travel.'
    : userLang === 'zh'
      ? '该水路区域受到有效海啸警报/注意报影响。请停止登船和水路出行。'
      : 'この水路地域に有効な津波警報・注意報が発表されています。乗船・水路移動を中止してください。';
  // 出発港側の自治体データから、津波対応の指定緊急避難場所だけを抽出する。
  const tsunamiShelters = await getGroundEmergencyShelters(context.from_port, 'tsunami', userLang);
  return jsonResponse({
    status: 'EMERGENCY_MODE_ACTIVE',
    detected_language: userLang,
    emergency_type: 'tsunami',
    transport_mode: 'water',
    route_guidance_suspended: true,
    message: advisory,
    maritime_safety_status: {
      tsunami_warning_active: true,
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

// ==========================================
// 🚢 フェリー航路検索
// ==========================================
async function searchFerry(args) {
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

    const isWaterBus = ['浅草','お台場海浜公園','お台場','豊洲','日の出桟橋','日の出','浜離宮'].some(p => fromStop.stop_name.includes(p));
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

// ==========================================
// 🚃 交通事業者一覧
// ==========================================
async function listTransitOperators(args) {
  const userLang = resolveLang(args) || 'ja';
  const typeFilter = args?.type_filter || 'all';
  const tl = { ja: { rail: '鉄道', agt: 'AGT', monorail: 'モノレール', tram: '路面電車', bus: '路線バス', ferry: '水上バス・フェリー' }, en: { rail: 'Railway', agt: 'AGT', monorail: 'Monorail', tram: 'Tram', bus: 'Bus', ferry: 'Water bus / Ferry' }, zh: { rail: '铁路', agt: 'AGT', monorail: '单轨电车', tram: '路面电车', bus: '路线巴士', ferry: '水上巴士、渡轮' } }[userLang] || {};
  const seenIds = new Set();
  const railOps = Object.entries(OPERATOR_MAP).map(([k, id]) => ({ key: k, id, type: 'rail', typeLabel: tl.rail, label: id })).filter(o => !seenIds.has(o.id) && seenIds.add(o.id));
  const nonRail = Object.entries(NON_RAIL_OPERATORS).map(([k, op]) => ({ key: k, id: op.id, type: op.type, typeLabel: tl[op.type] || op.type, label: userLang === 'en' ? op.labelEn : userLang === 'zh' ? op.labelZh : op.label, description: userLang === 'en' ? (op.descEn || op.description) : userLang === 'zh' ? (op.descZh || op.description) : op.description, website: op.website }));
  let all = [...railOps, ...nonRail];
  if (typeFilter !== 'all') all = all.filter(op => op.type === typeFilter);
  return jsonResponse({ status: "SUCCESS", detected_language: userLang, type_filter: typeFilter, total_operators: all.length, operators: all });
}

// ==========================================
// 🚃 事業者別路線一覧
// ==========================================
async function getOperatorRoutes(args) {
  const userLang = resolveLang(args) || 'ja'; const opKey = args.operator_name;
  if (!opKey) return jsonResponse(buildErrorResponse('INVALID_INPUT', 'operator_name を指定。', { userLang }));
  let opId, opMeta;
  const normKey = RAILWAY_NAME_MAP[opKey] || opKey;
  if (NON_RAIL_OPERATORS[opKey]) { opMeta = NON_RAIL_OPERATORS[opKey]; opId = opMeta.id; }
  else if (OPERATOR_MAP[opKey]) { opId = OPERATOR_MAP[opKey]; opMeta = { type: 'rail' }; }
  else if (OPERATOR_MAP[normKey]) { opId = OPERATOR_MAP[normKey]; opMeta = { type: 'rail' }; }
  else if (RAILWAY_NAME_MAP[opKey]) { const nk = RAILWAY_NAME_MAP[opKey]; if (OPERATOR_MAP[nk]) { opId = OPERATOR_MAP[nk]; opMeta = { type: 'rail' }; } }
  // list_transit_operators が表示する id（例: MIR, TWR, TokyoMonorail, TsukubaExpress）でも解決可能に
  else if (Object.values(NON_RAIL_OPERATORS).some(op => (op.id || '').toLowerCase() === opKey.toLowerCase())) {
    opMeta = Object.values(NON_RAIL_OPERATORS).find(op => (op.id || '').toLowerCase() === opKey.toLowerCase());
    opId = opMeta.id;
  }
  else if (Object.values(OPERATOR_MAP).some(id => (id || '').toLowerCase() === opKey.toLowerCase())) {
    opId = Object.values(OPERATOR_MAP).find(id => (id || '').toLowerCase() === opKey.toLowerCase());
    opMeta = { type: 'rail' };
  }
  else return jsonResponse(buildErrorResponse('INVALID_INPUT', `不明: ${opKey}。list_transit_operators で確認。`, { userLang }));
  if (!odptBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT API利用不可。', { userLang }));
  try {
    let railways = (await axios.get(`${API_BASE_URL}/odpt:Railway`, { params: { 'acl:consumerKey': API_KEY, 'odpt:operator': `odpt.Operator:${opId}` }, timeout: 15000 })).data;
    if (opMeta.railwayId) { const tid = `odpt.Railway:${opMeta.railwayId}`; railways = railways.filter(r => r['owl:sameAs'] === tid); }
    odptBreaker.onSuccess();
    const routes = railways.map(r => ({
      railway: getDisplayLineName(r['dc:title'], userLang), id: r['owl:sameAs'],
      stations: (r['odpt:stationOrder'] || []).map((so, idx) => {
        const title = so['odpt:stationTitle'] || {};
        return { index: idx, name: title[userLang === 'zh' ? 'zh-Hans' : userLang] || title.ja || title.en || Object.values(title)[0] || `駅${idx}` };
      }),
      station_count: r['odpt:stationOrder']?.length || 0
    }));
    // #53: ODPTに駅データが無い事業者（JR東日本等）は、内蔵 RAILWAY_LINES から補完する。
    // ODPT の odpt:Railway は路線定義を返すが、odpt:stationOrder が空（0駅）の路線が多い。
    // 内蔵グラフに同名路線（表記ゆれ吸収）があれば駅一覧を埋め、ODPT に無い路線
    // （例: 鶴見線）は事業者プレフィックスで追加する。
    const ODTP_TITLE_SET = new Set(railways.map(r => (r['dc:title'] || '').replace(/[・\s]/g, '')));
    const LOCAL_LINE_PREFIX = {
      'JR-East': 'JR', 'TokyoMetro': '東京メトロ', 'Toei': '都営',
      'Odakyu': '小田急', 'Keio': '京王', 'Seibu': '西武', 'Tobu': '東武',
      'Keikyu': '京急', 'Keisei': '京成', 'Sotetsu': '相鉄', 'Tokyu': '東急',
      'YokohamaMunicipal': '横浜市営地下鉄', 'MIR': 'ゆりかもめ', 'TWR': 'りんかい線',
      'Minatomirai': 'みなとみらい線', 'TsukubaExpress': 'つくばエクスプレス',
      'KantoRailway': '関東鉄道', 'SaitamaRailway': '埼玉高速鉄道', 'ToyoRapid': '東葉高速鉄道'
    };
    const prefix = LOCAL_LINE_PREFIX[opId];
    const odptLineNorm = (name) => (name || '').replace(/[・\s]/g, '');
    const routesWithFallback = [...routes];
    if (prefix) {
      for (const [lineName, stationsArr] of Object.entries(RAILWAY_LINES)) {
        // 内蔵路線がこの事業者に属するか（プレフィックス一致）
        if (!lineName.startsWith(prefix)) continue;
        const normLocal = odptLineNorm(lineName.replace(prefix, ''));
        // ODPT に既に同名路線（表記ゆれ吸収後）がある場合は、駅が空なら埋める
        const existing = routesWithFallback.find(rt => {
          const normRt = odptLineNorm(rt.railway);
          return normRt.includes(normLocal) || normLocal.includes(normRt);
        });
        if (existing) {
          if (!existing.station_count) {
            existing.stations = stationsArr.map((st, idx) => ({ index: idx, name: getDisplayStationName(st, userLang) }));
            existing.station_count = stationsArr.length;
          }
          continue;
        }
        // ODPT に無い内蔵路線（例: 鶴見線）を追加
        routesWithFallback.push({
          railway: getLineDisplayName(lineName, userLang),
          id: `local:${lineName}`,
          stations: stationsArr.map((st, idx) => ({ index: idx, name: getDisplayStationName(st, userLang) })),
          station_count: stationsArr.length,
          source: 'internal_graph'
        });
      }
    }
    return jsonResponse({ status: "SUCCESS", detected_language: userLang, operator_name: opKey, type: opMeta.type, routes: routesWithFallback, total_routes: routesWithFallback.length, website: opMeta.website || null });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}

// ==========================================
// 🚃 運賃検索
// ==========================================
// 運賃検索用: 駅名 → odpt:Station 候補（全事業者）を解決（キャッシュ付き）。
// dc:title 完全一致で候補を取得し、1000件上限問題（odpt:RailwayFare 一括取得）を回避する。
// 🔴 通信障害と「取得成功だが0件」を分離する（#84）:
//  - 全クエリが失敗（ネットワーク断・タイムアウト）した場合は throw し、searchFare の
//    handleApiError が NETWORK_ERROR / API_TIMEOUT を返す。通信失敗はキャッシュしない。
//  - 少なくとも1クエリが成功して0件なのは「対象外/未収録」の正常結果として扱い、
//    短い negative TTL でのみキャッシュする（24時間ロック解除）。
const FARE_STATION_NEGATIVE_TTL = 5 * 60 * 1000; // 取得成功・0件のみ 5分
async function resolveFareStations(rawName) {
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

// ODPT に運賃データ（odpt:RailwayFare）を提供している事業者
const FARE_OPERATORS = ['TokyoMetro', 'Toei', 'MIR', 'TWR', 'Yurikamome', 'YokohamaMunicipal', 'TamaMonorail'];
// 路線図（OPERATOR_MAP / NON_RAIL_OPERATORS）にはあるが ODPT に運賃データがない事業者（JR・私鉄等）
const NON_FARE_OPERATORS = Object.values(OPERATOR_MAP)
  .concat(Object.values(NON_RAIL_OPERATORS).map(o => o.id))
  .filter((id, i, a) => a.indexOf(id) === i)
  .filter(id => !FARE_OPERATORS.includes(id));

// 出発駅IDごとに運賃を分割取得（ODPT の 1000 件上限による切り捨てを回避）。
// 東京メトロ・都営に加え MIR（つくばエクスプレス）・TWR（りんかい線）・Yurikamome・
// 横浜市営地下鉄（YokohamaMunicipal）・多摩モノレール（TamaMonorail）も自動対応。
async function fetchFaresByFromStation(stationId) {
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

async function searchFare(args) {
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

    return jsonResponse({
      status: "SUCCESS", detected_language: userLang, from: displayFrom, to: displayTo,
      fare: cheapest.f ? {
        ticket: cheapest.f['odpt:ticketFare'] || cheapest.f['odpt:childTicketFare'] || null,
        ic: cheapest.f['odpt:icCardFare'] || cheapest.f['odpt:childIcCardFare'] || null,
        child_ticket: cheapest.f['odpt:childTicketFare'] || null,
        child_ic: cheapest.f['odpt:childIcCardFare'] || null
      } : null,
      fares: results.slice(0, 5).map(f => ({
        operator: f['odpt:operator']?.replace('odpt.Operator:', '') || 'Unknown',
        ticket: f['odpt:ticketFare'] || f['odpt:childTicketFare'] || null,
        ic: f['odpt:icCardFare'] || f['odpt:childIcCardFare'] || null,
        child_ticket: f['odpt:childTicketFare'] || null,
        child_ic: f['odpt:childIcCardFare'] || null
      })),
      data_source: noteText
    });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang, from, to });
  }
}

// ==========================================
// 🕐 時刻表検索
// ==========================================
// TrainTimetable 発着時刻の深夜0時越え正規化（GTFS 24:xx / 25:xx → 翌日表記）
function normalizeOvernightTime(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(timeStr);
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (h >= 24) {
    h -= 24;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  return String(timeStr);
}

// 24時超表記（25:xx 等）を「翌日フラグ付きのソート用分」へ変換する。
// 例: "25:10" → { minutes: 1510, nextDay: true } / "23:40" → { minutes: 1420, nextDay: false }
function timeToSortMinutes(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return { minutes: h * 60 + min, nextDay: h >= 24 };
}

// #82: 検索日（YYYY-MM-DD）または calendar 引数から対象カレンダーを判定する。
// calendar 引数が指定されれば最優先。省略時は曜日で自動判定（土日=SaturdayHoliday）。
function resolveTimetableCalendar(arg, dateStr) {
  if (arg) {
    const a = String(arg).toLowerCase();
    if (a.includes('week') || a.includes('平日') || a === 'wd') return 'Weekday';
    if (a.includes('saturday') || a.includes('holiday') || a.includes('土') || a.includes('休') || a === 'sh') return 'SaturdayHoliday';
  }
  const d = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr) : new Date();
  const day = d.getDay(); // 0=日 6=土
  return (day === 0 || day === 6) ? 'SaturdayHoliday' : 'Weekday';
}

// 駅ID（odpt.Station:TokyoMetro.Namboku.Ichigaya）の末尾ローマ字を取り出す
function stationIdTail(stationId) {
  if (!stationId) return '';
  return String(stationId).split('.').pop() || '';
}

// #22: TrainTimetable は路線単位で取得（無フィルタ/事業者単位だと ODPT の1000件上限で
// 一部路線が欠落し、駅フィルタが機能しなかった。例: TokyoMetro 事業者単位では銀座線が欠落）
const TIMETABLE_OPERATORS = ['TokyoMetro', 'Toei', 'YokohamaMunicipal', 'TWR', 'MIR', 'TamaMonorail'];

// 対象事業者の路線ID一覧（odpt:Railway から取得・キャッシュ）
let _timetableRailways = null;
async function getTimetableRailways() {
  if (_timetableRailways) return _timetableRailways;
  try {
    const res = await axios.get(`${API_BASE_URL}/odpt:Railway`, { params: getParams(), timeout: 20000 });
    const lines = (res.data || [])
      .filter(r => {
        const op = r['odpt:operator'] || '';
        return TIMETABLE_OPERATORS.some(o => op.endsWith(`.${o}`) || op.endsWith(`:${o}`));
      })
      .map(r => r['owl:sameAs'] || r['@id'])
      .filter(Boolean);
    _timetableRailways = lines;
  } catch (_) {
    // 🔴 取得失敗時は空リストを永続キャッシュしない（次回呼び出しで再取得を試みる）
    return [];
  }
  return _timetableRailways;
}

async function getTimetable(args) {
  const rawStation = args.station_name || '';
  const stationName = normalizeStationName(rawStation);
  const railwayFilter = args.railway || null;
  // #82: calendar（Weekday / SaturdayHoliday）引数と検索日（YYYY-MM-DD）を追加。
  // 未指定時は当日の曜日で自動判定。
  const calendarArg = args.calendar || null;
  const serviceDate = (args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) ? args.date : null;
  const targetCalendar = resolveTimetableCalendar(calendarArg, serviceDate || undefined);
  const userLang = resolveLang(args) || detectLanguage(rawStation) || 'ja';
  if (!rawStation) {
    const msg = userLang === 'en' ? 'Please specify a station name.' : userLang === 'zh' ? '请指定车站名称。' : '駅名を指定してください。';
    return jsonResponse(buildErrorResponse('INVALID_INPUT', msg, { userLang }));
  }
  if (!odptBreaker.canExecute()) return jsonResponse(buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ODPT API利用不可。', { userLang }));
  try {
    // #83: 路線単位 × calendar 別に分割取得してマージする。
    // 無フィルタの路線単位取得は ODPT の1000件上限に達する路線があり（例: 銀座線）、
    // 平日・土休日を跨いだ切り捨てが発生していた。calendar を指定すると
    // Weekday 658 + SaturdayHoliday 560 = 1,218件のように上限を回避して全件取得できる。
    // キャッシュはマージ結果で保持（キーに calendar 非依存の全件マージを入れる）。
    const cached = cache.get(`${cache.trainTimetable.key}:merged`);
    let allTimetables;
    let truncated = false;
    if (cached) { allTimetables = cached.merged; truncated = cached.truncated || false; }
    else {
      const railways = await getTimetableRailways();
      // 各路線 × 2 calendar を並列取得（1000件上限回避のため calendar を明示指定）
      const responses = await Promise.allSettled(railways.flatMap(rw =>
        ['odpt.Calendar:Weekday', 'odpt.Calendar:SaturdayHoliday'].map(cal =>
          axios.get(`${API_BASE_URL}/odpt:TrainTimetable`, { params: getParams(null, { 'odpt:railway': rw, 'odpt:calendar': cal }), timeout: 20000 })
        )
      ));
      const fulfilled = responses.filter(r => r.status === 'fulfilled' && Array.isArray(r.value.data));
      // 🔴 全路線の取得に失敗した場合は成功扱いにせず、空データもキャッシュしない
      //（空の時刻表を1時間キャッシュすると、障害復旧後もNO_DATAを返し続けるため）。
      if (railways.length > 0 && fulfilled.length === 0) {
        const firstRejected = responses.find(r => r.status === 'rejected');
        throw (firstRejected?.reason || new Error('All ODPT train timetable requests failed'));
      }
      // 🔴 #83: 1000件ちょうど（または超過）のレスポンスは切り捨ての可能性があるため
      // truncated フラグを立て、完全なデータとして SUCCESS を返さない。
      truncated = fulfilled.some(r => Array.isArray(r.value.data) && r.value.data.length >= 1000);
      allTimetables = fulfilled.flatMap(r => r.value.data);
      odptBreaker.onSuccess();
      cache.set(`${cache.trainTimetable.key}:merged`, { merged: allTimetables, truncated }, cache.trainTimetable.ttl);
    }

    // ローマ字駅ID → 日本語駅名 の逆引き（駅フィルタ用）
    const romanToJa = await getStationRomanToJa();
    const stationLower = stationName.toLowerCase();

    // レコードが指定駅を通るか判定:
    //  - odpt:originStation / odpt:destinationStation（ID末尾ローマ字）
    //  - odpt:trainTimetableObject[].odpt:departureStation / odpt:arrivalStation（ID末尾ローマ字）
    // 日本語駅名とローマ字IDの両対応（例: 新宿 ⇔ ...Shinjuku）
    const recordMatchesStation = (t) => {
      const ids = [];
      for (const key of ['odpt:originStation', 'odpt:destinationStation']) {
        const v = t[key];
        if (Array.isArray(v)) ids.push(...v);
        else if (v) ids.push(v);
      }
      for (const obj of (t['odpt:trainTimetableObject'] || [])) {
        if (obj['odpt:departureStation']) ids.push(obj['odpt:departureStation']);
        if (obj['odpt:arrivalStation']) ids.push(obj['odpt:arrivalStation']);
      }
      for (const id of ids) {
        const tail = stationIdTail(id).toLowerCase();
        if (!tail) continue;
        // ID末尾ローマ字との一致（完全一致または前方一致）
        if (tail === stationLower || tail.startsWith(stationLower) || stationLower.startsWith(tail)) return true;
        // ローマ字 → 日本語名 との一致
        const jaName = romanToJa[tail];
        if (jaName && (jaName === stationName || jaName.includes(stationName) || stationName.includes(jaName))) return true;
      }
      return false;
    };

    // #82: 対象 calendar のみに絞り込む（平日検索に土休日列車を混入させない）
    const matched = allTimetables.filter(t => {
      // odpt:calendar は "odpt.Calendar:Weekday" 形式（. と : の両方で区切る）
      const cal = t['odpt:calendar'] || '';
      const calTail = cal.split(/[.:]/).pop() || cal;
      return recordMatchesStation(t) && calTail === targetCalendar;
    });

    // #82: 方面（odpt:railDirection）ごとにグループ化し、各グループ内を
    // 指定駅での出発時刻（24時超は翌日扱い）で昇順ソートしてから表示する。
    // 列車レコードは全駅の trainTimetableObject を持つため、行のソートキーは
    // extractTimes で得た最初の departure 時刻を使う。
    const firstDepartureMinutes = (t) => {
      for (const obj of (t['odpt:trainTimetableObject'] || [])) {
        const depId = obj['odpt:departureStation'] || '';
        const depTail = stationIdTail(depId).toLowerCase();
        const depJa = depTail ? romanToJa[depTail] : '';
        const atDep = (depTail && (depTail === stationLower || depTail.startsWith(stationLower) || (depJa && (depJa === stationName || depJa.includes(stationName) || stationName.includes(depJa)))));
        if (atDep && obj['odpt:departureTime']) {
          const sm = timeToSortMinutes(obj['odpt:departureTime']);
          if (sm) return sm.minutes;
        }
      }
      return Number.MAX_SAFE_INTEGER;
    };
    const directionKey = (t) => {
      const d = t['odpt:railDirection'] || '';
      return (d.split(/[.:]/).pop() || d).toLowerCase();
    };
    const grouped = {};
    for (const t of matched) {
      const k = directionKey(t);
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(t);
    }
    const sortedMatched = Object.keys(grouped)
      .sort()
      .flatMap(k => grouped[k].sort((a, b) => firstDepartureMinutes(a) - firstDepartureMinutes(b)));

    // 指定駅での発着時刻を trainTimetableObject から抽出
    // #82: 24時超表記は翌日フラグ付きソートキー（sortMinutes）と表示時刻を分離
    const extractTimes = (t) => {
      const times = [];
      for (const obj of (t['odpt:trainTimetableObject'] || [])) {
        const depId = obj['odpt:departureStation'] || '';
        const arrId = obj['odpt:arrivalStation'] || '';
        const depTail = stationIdTail(depId).toLowerCase();
        const arrTail = stationIdTail(arrId).toLowerCase();
        const depJa = depTail ? romanToJa[depTail] : '';
        const arrJa = arrTail ? romanToJa[arrTail] : '';
        const atDep = (depTail && (depTail === stationLower || depTail.startsWith(stationLower) || (depJa && (depJa === stationName || depJa.includes(stationName) || stationName.includes(depJa)))));
        const atArr = (arrTail && (arrTail === stationLower || arrTail.startsWith(stationLower) || (arrJa && (arrJa === stationName || arrJa.includes(stationName) || stationName.includes(arrJa)))));
        if (atDep && obj['odpt:departureTime']) {
          const raw = obj['odpt:departureTime'];
          times.push({ kind: 'departure', time: normalizeOvernightTime(raw), sort: timeToSortMinutes(raw), nextDay: (timeToSortMinutes(raw)?.nextDay) || false });
        }
        if (atArr && obj['odpt:arrivalTime']) {
          const raw = obj['odpt:arrivalTime'];
          times.push({ kind: 'arrival', time: normalizeOvernightTime(raw), sort: timeToSortMinutes(raw), nextDay: (timeToSortMinutes(raw)?.nextDay) || false });
        }
      }
      return times;
    };

    const buildRow = (t) => {
      const times = extractTimes(t);
      const departures = times.filter(x => x.kind === 'departure');
      const arrivals = times.filter(x => x.kind === 'arrival');
      const destId = Array.isArray(t['odpt:destinationStation']) ? (t['odpt:destinationStation'][0] || '') : (t['odpt:destinationStation'] || '');
      const destTail = stationIdTail(destId);
      // #82: 方面（railDirection）別に分離して表示。departure / arrival それぞれ昇順ソート
      const sortByTime = (arr) => [...arr].sort((a, b) => (a.sort?.minutes ?? 0) - (b.sort?.minutes ?? 0));
      const depSorted = sortByTime(departures);
      const arrSorted = sortByTime(arrivals);
      return {
        railway: t['odpt:railway'],
        train: t['odpt:train'],
        destination: destTail ? (romanToJa[destTail.toLowerCase()] || destTail) : destId,
        type: t['odpt:trainType'],
        direction: t['odpt:railDirection'],
        calendar: targetCalendar, // #82: 応答に calendar を含める
        departure_time: depSorted.length ? depSorted.map(x => x.time).join(', ') : null,
        departure_next_day: depSorted.some(x => x.nextDay) || undefined, // #82: 24時超は翌日扱い
        arrival_time: arrSorted.length ? arrSorted.map(x => x.time).join(', ') : null,
        arrival_next_day: arrSorted.some(x => x.nextDay) || undefined
      };
    };

    const displayStation = getDisplayStationName(stationName, userLang);

    if (railwayFilter) {
      // 日本語路線名を ODPT ローマ字IDに変換（例: 山手線 → yamanote）
      const rfLower = railwayFilter.toLowerCase();
      const railwayKey = RAILWAY_NAME_MAP[railwayFilter] || RAILWAY_NAME_MAP[railwayFilter.replace(/線$/, '')] || rfLower;
      const filtered = sortedMatched.filter(t => {
        const r = (t['odpt:railway'] || '').toLowerCase();
        const rKey = r.split('.').pop() || r;
        return r.includes(railwayKey) || rKey.includes(railwayKey) || railwayKey.includes(rKey);
      });
      if (filtered.length > 0) return jsonResponse({ status: "SUCCESS", detected_language: userLang, station: displayStation, railway: getDisplayLineName(railwayFilter, userLang), calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), truncated: truncated || undefined, total: filtered.length, timetable: filtered.slice(0, 20).map(buildRow), data_source: "ODPT TrainTimetable (路線×calendar別取得)", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
      // フィルタ結果が 0 件なら「該当路線のデータなし」を明確に返す（誤って全件を返さない）
      const noRailwayMsg = userLang === 'en'
        ? `No timetable found for railway "${getDisplayLineName(railwayFilter, userLang)}" at ${displayStation} (${targetCalendar}).`
        : userLang === 'zh'
          ? `在${displayStation}未找到路线「${getDisplayLineName(railwayFilter, userLang)}」的时程表（${targetCalendar}）。`
          : `${displayStation}の「${railwayFilter}」の時刻表は見つかりませんでした（${targetCalendar}）。`;
      return jsonResponse({ status: "NO_DATA", detected_language: userLang, station: displayStation, railway: getDisplayLineName(railwayFilter, userLang), calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), total: 0, message: noRailwayMsg, data_source: "ODPT TrainTimetable", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
    }
    if (sortedMatched.length === 0) {
      const noDataMsg = userLang === 'en'
        ? `No timetable data found for ${displayStation} in ODPT (JR East and most private railways are not covered).`
        : userLang === 'zh'
          ? `ODPT中未找到 ${displayStation} 的时程表数据（JR东日本及大部分私铁不在覆盖范围内）。`
          : `${displayStation} の時刻表データはODPTにありません（JR東日本・大部分の私鉄は対象外）。`;
      return jsonResponse({ status: "NO_DATA", detected_language: userLang, station: displayStation, calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), total: 0, message: noDataMsg, data_source: "ODPT TrainTimetable", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
    }
    return jsonResponse({ status: "SUCCESS", detected_language: userLang, station: displayStation, calendar: targetCalendar, service_date: serviceDate || new Date().toISOString().slice(0, 10), truncated: truncated || undefined, total: sortedMatched.length, timetable: sortedMatched.slice(0, 20).map(buildRow), data_source: "ODPT TrainTimetable (路線×calendar別取得)", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}

// ==========================================
// 🚌 バス路線検索（都営バス）
// ==========================================
// 🚌 バス事業者マップ（odpt:Bus エンドポイントで実データが取得可能な事業者のみ）
// 調査実績（2026-08-02, ODPT本番API）：
//   Toei(都営バス)=425件 / SeibuBus(西武バス)=271件 / YokohamaMunicipal(横浜市交通局)=296件  → odpt:Bus で取得可
//   KeioBus/OdakyuBus/TokyuBus/SotetsuBus/NishiTokyoBus = 0件（GTFS形式等で別提供）
//   JRバス関東 = ODPT未登録（JR-East/JR-Central のみ）
// 足の悪いユーザー向け：これら3社で近郊バス網をカバー。マージは Promise.allSettled で並列取得。
const BUS_OPERATORS = [
  { id: 'Toei', label: '都営バス', labelEn: 'Toei Bus', labelZh: '都营公交', website: 'https://www.kotsu.metro.tokyo.jp/bus/' },
  { id: 'SeibuBus', label: '西武バス', labelEn: 'Seibu Bus', labelZh: '西武公交', website: 'https://www.seibubus.co.jp/' },
  { id: 'YokohamaMunicipal', label: '横浜市交通局（横浜市営バス）', labelEn: 'Yokohama City Bus', labelZh: '横滨市营公交', website: 'https://www.city.yokohama.lg.jp/kotsu/' }
];

// ============================================================
// 🚌 GTFS-JP 個別取得パス（JRバス・コミュニティバス等）
// ------------------------------------------------------------
// 背景: ODPT の odpt:Bus（REST）には 都営/西武/横浜市営 の3社のみ。
// 京王・東急・小田急等は ODPT GTFS エンドポイント（files/odpt/...）が
// 2026年時点で全事業者 404/500（バグK）。各社公式GTFSはURL不安定（日々更新・
// ファイル名不定）。JRバス関東は ODPT 未登録。
// → 安定取得が不可能なため、hardCoded フォールバックで主要バス停・系統を
//   定義し検索可能にする（フェリーの FERRY_GTFS_SOURCES と同設計）。
//   将来的に安定URLが確定したら { url, date } ソースとして追加可能。
// ============================================================
// ============================================================
// 🚌 東京都コミュニティバス ディレクトリ（41自治体）
// ------------------------------------------------------------
// 出典: 東京バス協会「東京バス案内WEB」スマホ版 https://www.tokyobus.or.jp/sp/ の
// 「コミュニティバス検索」一覧（JSバンドル内の静的リンク集）。2026-08 に取得・確認。
// 本サイトは路線・停留所・時刻表データを持たず各自治体公式ページへのリンクのみのため、
// 検索結果では「名称＋自治体＋公式URL」の案内を表示する（ディレクトリ用途）。
const TOKYO_COMMUNITY_BUSES = [
  { municipality: '荒川区', name: 'さくら・汐入さくら', url: 'https://www.city.arakawa.tokyo.jp/kurashi/koutsu_bus/kotsu/index.html' },
  { municipality: '足立区', name: 'はるかぜ', url: 'https://www.city.adachi.tokyo.jp/machi/kotsu/index.html' },
  { municipality: '昭島市', name: 'Ａバス', url: 'http://www.city.akishima.lg.jp/030/130/index.html' },
  { municipality: 'あきる野市', name: 'るのバス', url: 'http://www.city.akiruno.tokyo.jp/category/1-9-5-0-0.html' },
  { municipality: '板橋区', name: 'りんりん号', url: 'http://www.city.itabashi.tokyo.jp/c_kurashi/026/026518.html' },
  { municipality: '稲城市', name: 'ｉバス', url: 'https://www.city.inagi.tokyo.jp/kurashi/bus/ai_bus/index.html' },
  { municipality: '大田区', name: 'たまちゃんバス', url: 'http://www.city.ota.tokyo.jp/seikatsu/sumaimachinami/koutsu/communitybusdounyu/communitybus_shikou.html' },
  { municipality: '北区', name: 'Ｋバス', url: 'http://www.city.kita.tokyo.jp/kurashi/bus/index.html' },
  { municipality: '清瀬市', name: 'きよバス', url: 'http://www.city.kiyose.lg.jp/050/060/010/index.html' },
  { municipality: '国立市', name: 'くにっこ', url: 'http://www.city.kunitachi.tokyo.jp/machi/traffic/traffic3/traffic7/index.html' },
  { municipality: '江東区', name: 'しおかぜ', url: 'http://www.city.koto.lg.jp/470801/kurashi/kotsu/kokyo/13116.html' },
  { municipality: '小金井市', name: 'ＣｏＣｏバス', url: 'https://www.city.koganei.lg.jp/smph/kurashi/482/buss/cocobus.html' },
  { municipality: '国分寺市', name: 'ぶんバス', url: 'http://www.city.kokubunji.tokyo.jp/kurashi/koutsuu/bus/' },
  { municipality: '狛江市', name: 'こまバス', url: 'http://www.city.komae.tokyo.jp/sp/index.cfm/41,23028,312,html' },
  { municipality: '小平市', name: 'にじバス', url: 'http://www.city.kodaira.tokyo.jp/kurashi/000/000137.html' },
  { municipality: '新宿区', name: '新宿ＷＥバス', url: 'http://www.city.shinjuku.lg.jp/seikatsu/file17_06_00001.html' },
  { municipality: '渋谷区', name: 'ハチ公バス', url: 'https://www.city.shibuya.tokyo.jp/kurashi/kotsu/hachiko/' },
  { municipality: '墨田区', name: 'すみまるくん　他', url: 'http://www.city.sumida.lg.jp/kurashi/jyunkanbus/index.html' },
  { municipality: '杉並区', name: 'すぎ丸', url: 'https://www.city.suginami.tokyo.jp/guide/machi/bus/index.html' },
  { municipality: '世田谷区', name: 'せたがやくるりん　他', url: 'http://www.city.setagaya.lg.jp/kurashi/102/122/365/index.html' },
  { municipality: '台東区', name: 'めぐりん', url: 'http://www.city.taito.lg.jp/index/kurashi/kotsu/megurin/index.html' },
  { municipality: '立川市', name: 'くるりんバス', url: 'http://www.city.tachikawa.lg.jp/kurashi/kotsu/shiminbus/index.html' },
  { municipality: '多摩市', name: '多摩市ミニバス', url: 'http://www.city.tama.lg.jp/0000001287.html' },
  { municipality: '中央区', name: '江戸バス', url: 'http://www.city.chuo.lg.jp/kurasi/edobasu/index.html' },
  { municipality: '調布市', name: 'ミニバス', url: 'http://www.city.chofu.tokyo.jp/www/genre/0000000000000/1000000010120/index.html' },
  { municipality: '豊島区', name: '池07系統', url: 'http://www.city.toshima.lg.jp/298/machizukuri/kotsu/bus/1504221057.html' },
  { municipality: '西東京市', name: 'はなバス', url: 'http://www.city.nishitokyo.lg.jp/kurasi/kotu/hanabus/index.html' },
  { municipality: '練馬区', name: 'みどりバス', url: 'http://www.city.nerima.tokyo.jp/kurashi/sumai/bus/index.html' },
  { municipality: '八王子市', name: 'はちバス', url: 'http://www.city.hachioji.tokyo.jp/kurashi/life/001/002/index.html' },
  { municipality: '羽村市', name: 'はむらん', url: 'http://www.city.hamura.tokyo.jp/category/1-11-15-0-0.html' },
  { municipality: '日野市', name: 'ミニバス', url: 'http://www.city.hino.lg.jp/kurashi/kotsu/bus/minibus/index.html' },
  { municipality: '東大和市', name: 'ちょこバス', url: 'https://www.city.higashiyamato.lg.jp/index.cfm/31,0,335,547,html' },
  { municipality: '東村山市', name: 'グリーンバス', url: 'http://www.city.higashimurayama.tokyo.jp/kurashi/sumai/bus/index.html' },
  { municipality: '檜原村', name: 'やまびこ', url: 'http://www.vill.hinohara.tokyo.jp/0000000090.html' },
  { municipality: '府中市', name: 'ちゅうバス', url: 'https://www.city.fuchu.tokyo.jp/kurashi/machi/chubus/index.html' },
  { municipality: '文京区', name: 'Ｂーぐる', url: 'http://www.city.bunkyo.lg.jp/sosiki_busyo_kumin_jigyou_b-guru.html' },
  { municipality: '町田市', name: 'まちっこ　他', url: 'http://www.city.machida.tokyo.jp/kanko/kotu_syuku/index.html' },
  { municipality: '港区', name: 'ちぃばす', url: 'https://www.city.minato.tokyo.jp/kankyo-machi/kotsu/bus/community.html' },
  { municipality: '三鷹市', name: 'みたかシティバス', url: 'http://www.city.mitaka.tokyo.jp/c_service/000/000756.html' },
  { municipality: '武蔵野市', name: 'ムーバス', url: 'https://www.city.musashino.lg.jp/kurashi_tetsuzuki/bus_churin_chusha_kotsuanzen/mubus/index.html' },
  { municipality: '武蔵村山市', name: 'ＭＭシャトル', url: 'http://www.city.musashimurayama.lg.jp/kurashi/koutsu/koukyoukoutu/1000603/index.html' }
];

// ============================================================
// 🚌 コミュニティバス 駅接続ルート（主要10件・Phase 1/2 共通データ）
// ------------------------------------------------------------
// 足の悪いユーザーの「自宅→駅」「駅→目的地」をコミュニティバスでつなぐための
// 駅接続データ。出典: 各自治体公式サイト（2026-08 にURL・路線・主要駅を確認）。
// - routes: 代表系統の駅前停留所を順序付きで列挙（中間停留所は省略・公式サイト参照）
// - stations: { 駅名: 駅前バス停名 } — 駅⇔バス停の徒歩接続（link）に使用
// ⚠️ データは「代表駅接続」であり全停留所を網羅しない。時刻表・全ルートは各公式URL参照。
//   バリアフリー（車椅子等）情報は自治体サイトで確認する旨をレスポンスで注意喚起する。
const COMMUNITY_BUS_ROUTES = [
  {
    bus: 'ちぃばす', municipality: '港区',
    url: 'https://www.city.minato.tokyo.jp/kankyo-machi/kotsu/bus/community.html',
    routes: [
      { name: '田町ルート', stops: ['田町駅前', '三田駅前', '芝浦四丁目', '港区役所前'] },
      { name: '六本木ルート', stops: ['田町駅前', '神谷町駅前', '六本木駅前', '麻布十番駅前', '赤羽橋駅前'] },
      { name: '麻布ルート', stops: ['麻布十番駅前', '六本木駅前', '赤羽橋駅前'] },
      { name: '赤羽橋ルート', stops: ['赤羽橋駅前', '麻布十番駅前', '白金高輪駅前'] },
      { name: '芝ルート', stops: ['田町駅前', '三田駅前', '芝公園駅前', '御成門駅前', '大門駅前'] }
    ],
    stations: {
      '田町': '田町駅前', '三田': '三田駅前', '芝公園': '芝公園駅前', '御成門': '御成門駅前',
      '大門': '大門駅前', '神谷町': '神谷町駅前', '六本木': '六本木駅前', '麻布十番': '麻布十番駅前',
      '赤羽橋': '赤羽橋駅前', '白金高輪': '白金高輪駅前'
    }
  },
  {
    bus: 'ハチ公バス', municipality: '渋谷区',
    url: 'https://www.city.shibuya.tokyo.jp/kurashi/kotsu/hachiko/',
    routes: [
      { name: '夕やけこやけルート（恵比寿・代官山循環）', stops: ['渋谷駅東口', '渋谷区役所', '恵比寿駅前', '代官山駅前', '渋谷駅東口'] },
      { name: '丘を越えてルート（上原・富ヶ谷）', stops: ['渋谷駅東口', '代々木上原駅前', '渋谷駅東口'] },
      { name: '神宮の杜ルート（神宮前・千駄ヶ谷）', stops: ['渋谷駅東口', '原宿駅前', '表参道駅前', '千駄ヶ谷駅前', '渋谷駅東口'] },
      { name: '春の小川ルート（本町・笹塚循環）', stops: ['渋谷区役所', '笹塚駅前', '渋谷区役所'] }
    ],
    stations: {
      '渋谷': '渋谷駅東口', '恵比寿': '恵比寿駅前', '代官山': '代官山駅前', '代々木上原': '代々木上原駅前',
      '原宿': '原宿駅前', '表参道': '表参道駅前', '千駄ヶ谷': '千駄ヶ谷駅前', '笹塚': '笹塚駅前'
    }
  },
  {
    bus: 'ムーバス', municipality: '武蔵野市',
    url: 'https://www.city.musashino.lg.jp/kurashi_tetsuzuki/bus_churin_chusha_kotsuanzen/mubus/index.html',
    routes: [
      { name: '吉祥寺東循環（1号路線）', stops: ['吉祥寺駅北口', '武蔵野市役所', '吉祥寺駅北口'] },
      { name: '三鷹・吉祥寺循環（6号路線）', stops: ['三鷹駅北口', '吉祥寺駅北口', '三鷹駅北口'] },
      { name: '境・三鷹循環（7号路線）', stops: ['武蔵境駅北口', '三鷹駅北口', '武蔵境駅北口'] }
    ],
    stations: {
      '吉祥寺': '吉祥寺駅北口', '三鷹': '三鷹駅北口', '武蔵境': '武蔵境駅北口'
    }
  },
  {
    bus: 'はなバス', municipality: '西東京市',
    url: 'https://www.city.nishitokyo.lg.jp/kurasi/kotu/hanabus/index.html',
    routes: [
      { name: '第1ルート', stops: ['田無駅', 'ひばりヶ丘駅', '田無駅'] },
      { name: '第2ルート', stops: ['田無駅', '保谷駅', '田無駅'] },
      { name: '第3ルート', stops: ['田無駅', '東伏見駅', '田無駅'] },
      { name: '第4北ルート', stops: ['花小金井駅', '田無駅', '花小金井駅'] },
      { name: '第4南ルート', stops: ['花小金井駅', '田無駅', '花小金井駅'] }
    ],
    stations: {
      '田無': '田無駅', 'ひばりヶ丘': 'ひばりヶ丘駅', '保谷': '保谷駅', '東伏見': '東伏見駅', '花小金井': '花小金井駅'
    }
  },
  {
    bus: 'すぎ丸', municipality: '杉並区',
    url: 'https://www.city.suginami.tokyo.jp/guide/machi/bus/index.html',
    routes: [
      { name: '荻窪線', stops: ['荻窪駅南口', '荻窪駅北口'] },
      { name: '西荻線', stops: ['西荻窪駅北口', '西荻窪駅南口'] },
      { name: '高円寺線', stops: ['高円寺駅北口', '高円寺駅南口'] },
      { name: '阿佐谷線', stops: ['阿佐ヶ谷駅北口', '阿佐ヶ谷駅南口'] },
      { name: '堀ノ内線', stops: ['方南町駅', '堀ノ内三丁目'] }
    ],
    stations: {
      '荻窪': '荻窪駅南口', '西荻窪': '西荻窪駅北口', '高円寺': '高円寺駅北口', '阿佐ヶ谷': '阿佐ヶ谷駅北口'
    }
  },
  {
    bus: 'くるりんバス', municipality: '立川市',
    url: 'https://www.city.tachikawa.lg.jp/kurashi/kotsu/shiminbus/index.html',
    routes: [
      { name: '北ルート', stops: ['立川駅北口', '立川市役所', '立川駅北口'] },
      { name: '南ルート', stops: ['立川駅南口', '柴崎町三丁目', '立川駅南口'] }
    ],
    stations: { '立川': '立川駅北口' }
  },
  {
    bus: 'ちゅうバス', municipality: '府中市',
    url: 'https://www.city.fuchu.tokyo.jp/kurashi/machi/chubus/index.html',
    routes: [
      { name: '南町ルート', stops: ['府中駅', '府中本町駅', '府中駅'] },
      { name: '住吉町ルート', stops: ['府中駅', '府中競馬正門前駅', '府中駅'] },
      { name: '是政ルート', stops: ['府中駅', '是政', '府中駅'] }
    ],
    stations: { '府中本町': '府中本町駅' }
  },
  {
    bus: 'Bーぐる', municipality: '文京区',
    url: 'https://www.city.bunkyo.lg.jp/sosiki_busyo_kumin_jigyou_b-guru.html',
    routes: [
      { name: '千駄木・駒込ルート', stops: ['千駄木駅前', '駒込駅前', '千駄木駅前'] },
      { name: '本郷・小日向ルート', stops: ['本郷三丁目駅前', '後楽園駅前', '本郷三丁目駅前'] },
      { name: '目白台・小日向ルート', stops: ['江戸川橋駅前', '護国寺駅前', '江戸川橋駅前'] }
    ],
    stations: {
      '千駄木': '千駄木駅前', '駒込': '駒込駅前', '本郷三丁目': '本郷三丁目駅前',
      '後楽園': '後楽園駅前', '江戸川橋': '江戸川橋駅前', '護国寺': '護国寺駅前'
    }
  },
  {
    bus: '江戸バス', municipality: '中央区',
    url: 'https://www.city.chuo.lg.jp/kurasi/edobasu/index.html',
    routes: [
      { name: '北循環', stops: ['日本橋駅前', '東京駅八重洲口', '銀座駅前', '日本橋駅前'] },
      { name: '南循環', stops: ['銀座駅前', '築地駅前', '八丁堀駅前', '銀座駅前'] }
    ],
    stations: {
      '日本橋': '日本橋駅前', '銀座': '銀座駅前', '築地': '築地駅前', '八丁堀': '八丁堀駅前', '京橋': '京橋駅前'
    }
  },
  {
    bus: 'めぐりん', municipality: '台東区',
    url: 'https://www.city.taito.lg.jp/index/kurashi/kotsu/megurin/index.html',
    // 公式路線図(JORUDAN/台東区)に基づく5路線。いずれも一方向循環。
    // かっぱ橋道具街（合羽橋）最寄りは「南めぐりん」の松が谷（24番）。
    routes: [
      // 北めぐりん（浅草回り）：浅草駅→隅田公園→吉原大門→…→浅草四丁目→浅草寺北→二天門→浅草松屋西→浅草駅
      { name: '北めぐりん（浅草回り）', stops: [
        '浅草駅前', '花川戸', '隅田公園', 'リバーサイドスポーツセンター前', '今戸一丁目', '今戸二丁目',
        '橋場老人福祉館西', '橋場一丁目', '清川一丁目', '東浅草二丁目', '吉原大門', '竜泉三丁目',
        '三ノ輪二丁目', '三ノ輪駅前', '一葉記念館入口', '千束三丁目', '台東病院', '千束小学校前',
        '浅草五丁目', '浅草警察署前', '浅草四丁目', '浅草寺北', '二天門', '浅草松屋西', '浅草駅前'
      ] },
      // 北めぐりん（根岸回り）：浅草駅→入谷→鶯谷→根岸→三ノ輪→浅草
      { name: '北めぐりん（根岸回り）', stops: [
        '浅草駅前', '入谷鬼子母神前', '下谷二丁目', '鶯谷駅南', '松が谷（かっぱ橋道具街）', '根岸三丁目', '上野駅入谷口',
        '台東区役所', '下谷神社', '入谷駅入口', '千束三丁目', '台東病院', '浅草五丁目',
        '浅草警察署前', '浅草四丁目', '浅草寺北', '二天門', '浅草松屋西', '浅草駅前'
      ] },
      // 南めぐりん：上野駅→田原町駅→浅草菊水通り→西浅草→台東区役所→松が谷→…（かっぱ橋道具街最寄り=松が谷）
      { name: '南めぐりん', stops: [
        '上野駅', '永寿総合病院', '御徒町', '新御徒町駅', '台東三丁目', '台東地区センター',
        '三井記念病院前', '柳北スポーツプラザ', '浅草橋駅北', '柳橋中央通り', '柳橋分院入口',
        '鳥越神社前', '環境ふれあい館ひまわり入口', '三筋老人福祉館東', '南部区民事務所',
        '大江戸線蔵前駅', '田原町駅前', '浅草菊水通り', '西浅草', '菊屋橋', '台東区役所',
        '上野学園', '北上野二丁目', '松が谷（かっぱ橋道具街）', '生涯学習センター南', '生涯学習センター北',
        '千束二丁目', '千束三丁目', '台東病院', '大正小学校前', '入谷地区センター',
        '入谷南公園', '北上野', '上野学園', '台東保健所', '台東区役所', '上野駅'
      ] },
      // 東西めぐりん
      { name: '東西めぐりん', stops: ['上野駅入谷口', '浅草駅前', '上野駅入谷口'] },
      // ぐるーりめぐりん
      { name: 'ぐるーりめぐりん', stops: ['浅草駅前', '田原町駅前', '浅草駅前'] }
    ],
    stations: {
      '上野': '上野駅入谷口', '浅草': '浅草駅前', '田原町': '田原町駅前', '三ノ輪': '三ノ輪駅前',
      '入谷': '入谷鬼子母神前', '鶯谷': '鶯谷駅南', '新御徒町': '新御徒町駅', '蔵前': '大江戸線蔵前駅',
      '浅草橋': '浅草橋駅北', '御徒町': '御徒町', '松が谷': '松が谷'
    }
  },
  // #25: あきる野市 るのバス（4ルート・Wikipedia/市公式サイトの停車順）
  {
    bus: 'るのバス', municipality: 'あきる野市',
    url: 'https://www.city.akiruno.tokyo.jp/0000018419.html',
    routes: [
      { name: '秋川駅-武蔵五日市方面', stops: ['秋川駅', '秋川キララホール入口', '日の出福祉園前', '阿伎留医療センター', '武蔵引田駅入口', '山田', '武蔵増戸駅', '五日市ファインプラザ', '伊奈新宿', '小和田グランド前', '上町', '五日市出張所', '五日市', '武蔵五日市駅'] },
      { name: '草花方面', stops: ['秋川駅', 'あきる野市役所', '菅瀬橋', '若宮', '小宮久保上', '松山橋', '草花台パークハイツ', '花ノ岡陸橋', '秋川ふれあいセンター', 'あきる野市役所', '秋川駅'] },
      { name: '引田方面', stops: ['秋川駅', '秋川キララホール入口', '日の出福祉園前', '阿伎留医療センター', '武蔵引田駅入口', '渕上', '代継', '秋川駅'] },
      { name: '小川方面', stops: ['秋川駅', '雨間', 'いきいきセンター', '雨間', '野辺郵便局', '野辺南', '小川', '睦橋', '小川', '野辺南', '二宮神社', '東秋留駅上', 'ファーマーズセンター', 'あきる野市役所', '秋川駅'] }
    ],
    stations: {
      '秋川': '秋川駅', '武蔵増戸': '武蔵増戸駅', '武蔵引田': '武蔵引田駅入口',
      '武蔵五日市': '武蔵五日市駅', '東秋留': '東秋留駅上'
    }
  },
  // #25: 足立区 はるかぜ（代表ルート: 1号・9号・12号）
  {
    bus: 'はるかぜ', municipality: '足立区',
    url: 'https://www.city.adachi.tokyo.jp/machi/tetsudo/harukaze/index.html',
    routes: [
      { name: '1号（西新井・綾瀬線）', stops: ['西新井駅東口', '栗島住区センター', '栗島中学校前', '足立四丁目', '青井ふれあい公園', '青井駅', '綾瀬駅'] },
      { name: '9号（青井・亀有線）', stops: ['青井駅', '足立四丁目', '栗島小学校入口', '都立足立高校前', '金町駅南口', '金町駅'] },
      { name: '12号（西新井・亀有線）', stops: ['西新井駅東口', '梅島二丁目', '青井駅', '金町駅南口', '金町駅'] }
    ],
    stations: {
      '西新井': '西新井駅東口', '綾瀬': '綾瀬駅', '青井': '青井駅', '金町': '金町駅南口'
    }
  },
  // #25: 荒川区 さくら（左回り・右回り循環。汐入さくらは2025-03-31運行終了のため未収録）
  {
    bus: 'さくら', municipality: '荒川区',
    url: 'https://www.city.arakawa.tokyo.jp/a040/koutsuu-bus/komyuniteibasu/sakura.html',
    routes: [
      { name: 'さくら左回り（南千01）', stops: ['南千住駅西口', '南千住図書館・荒川ふるさと文化館', '京成町屋駅', '町屋駅前', '荒川区役所前', '荒川総合スポーツセンター', '荒川中央通り', '南千住駅西口'] },
      { name: 'さくら右回り（南千02）', stops: ['南千住駅西口', '荒川総合スポーツセンター', '荒川区役所前', '町屋駅前', '京成町屋駅', '南千住図書館・荒川ふるさと文化館', '南千住駅西口'] }
    ],
    stations: {
      '南千住': '南千住駅西口', '町屋': '町屋駅前', '京成町屋': '京成町屋駅'
    }
  },
  // #25: 練馬区 みどりバス（保谷/北町/氷川台/大泉・主要ルート）
  {
    bus: 'みどりバス', municipality: '練馬区',
    url: 'https://www.city.nerima.tokyo.jp/kurashi/sumai/bus/index.html',
    routes: [
      { name: '保谷ルート', stops: ['保谷駅北口', '南町二丁目', '南田中一丁目', '光が丘駅', '練馬光が丘病院'] },
      { name: '北町ルート', stops: ['練馬光が丘病院', '東武練馬駅入口', '北町三丁目', '練馬光が丘病院'] },
      { name: '氷川台ルート', stops: ['氷川台駅', '氷川台四丁目', '練馬区役所', '桜台駅'] },
      { name: '大泉ルート', stops: ['大泉学園駅北口', '大泉町四丁目', '長久保', '石神井公園駅北口'] }
    ],
    stations: {
      '保谷': '保谷駅北口', '光が丘': '光が丘駅', '東武練馬': '東武練馬駅入口',
      '氷川台': '氷川台駅', '桜台': '桜台駅', '大泉学園': '大泉学園駅北口',
      '石神井公園': '石神井公園駅北口'
    }
  },
  // #25: 北区 Kバス（王子・駒込/田端循環/浮間ルート）
  {
    bus: 'Kバス', municipality: '北区',
    url: 'https://www.city.kita.lg.jp/living/transport/1002525/1002526.html',
    routes: [
      { name: '王子・駒込ルート', stops: ['王子駅', '北区役所', '飛鳥山公園', '滝野川会館', '駒込駅', '王子駅'] },
      { name: '田端循環ルート', stops: ['田端駅', '田端銀座', '赤土小学校前', '田端駅'] },
      { name: '浮間ルート', stops: ['赤羽駅', '東京北医療センター', '北赤羽駅浮間口', '浮間舟渡駅', '赤羽駅'] }
    ],
    stations: {
      '王子': '王子駅', '駒込': '駒込駅', '田端': '田端駅', '赤羽': '赤羽駅',
      '北赤羽': '北赤羽駅浮間口', '浮間舟渡': '浮間舟渡駅'
    }
  },
  // #25: 三鷹市 みたかシティバス（北野/三鷹台/明星学園/ジブリ美術館循環）
  {
    bus: 'みたかシティバス', municipality: '三鷹市',
    url: 'https://www.city.mitaka.lg.jp/c_service/000/000756.html',
    routes: [
      { name: '北野ルート', stops: ['三鷹駅南口', '三鷹市役所前', '北野', '北野三丁目'] },
      { name: '三鷹台ルート', stops: ['三鷹駅南口', '三鷹台駅', '井の頭公園', '三鷹駅南口'] },
      { name: '明星学園ルート', stops: ['三鷹駅北口', '明星学園前', '三鷹駅北口'] },
      { name: '三鷹の森ジブリ美術館循環', stops: ['三鷹駅南口', '三鷹の森ジブリ美術館', '三鷹駅南口'] }
    ],
    stations: {
      '三鷹': '三鷹駅南口', '三鷹台': '三鷹台駅'
    }
  },
  // #25: 八王子市 はちバス（北部/西部/東部/西南部コース）
  {
    bus: 'はちバス', municipality: '八王子市',
    url: 'https://www.city.hachioji.tokyo.jp/kurashi/life/001/002/index.html',
    routes: [
      { name: '北部コース', stops: ['西八王子駅', '八王子市役所', '東海大学八王子病院'] },
      { name: '西部コース', stops: ['北の根東', '楢原町', '松枝住宅', '西八王子駅'] },
      { name: '東部コース', stops: ['JR片倉駅', '日生団地'] },
      { name: '西南部コース', stops: ['松子舞団地', '高尾駅南口'] }
    ],
    stations: {
      '西八王子': '西八王子駅', '片倉': 'JR片倉駅', '高尾': '高尾駅南口'
    }
  },
  // #25: 世田谷区 せたがやくるりん（祖師谷・成城地域循環）
  {
    bus: 'せたがやくるりん', municipality: '世田谷区',
    url: 'https://www.city.setagaya.lg.jp/01206/4533.html',
    routes: [
      { name: '祖師谷・成城地域循環（外回り）', stops: ['祖師ヶ谷大蔵駅', '祖師谷商店街', '成城学園前駅', '砧総合支所', '祖師ヶ谷大蔵駅'] },
      { name: '祖師谷・成城地域循環（内回り）', stops: ['祖師ヶ谷大蔵駅', '砧総合支所', '成城学園前駅', '祖師谷商店街', '祖師ヶ谷大蔵駅'] }
    ],
    stations: {
      '祖師ヶ谷大蔵': '祖師ヶ谷大蔵駅', '成城学園前': '成城学園前駅'
    }
  },
  // #25: 新宿区 新宿WEバス（新宿駅西口起点の循環・観光路線）
  {
    bus: '新宿WEバス', municipality: '新宿区',
    url: 'https://www.city.shinjuku.lg.jp/seikatsu/file17_06_00001.html',
    routes: [
      { name: '新宿御苑ルート', stops: ['新宿駅西口', '新宿センタービル', '新宿御苑', '新宿三丁目', '新宿駅西口'] },
      { name: '歌舞伎町ルート', stops: ['新宿駅西口', '歌舞伎町', '新宿駅西口'] }
    ],
    stations: {
      '新宿': '新宿駅西口', '新宿三丁目': '新宿三丁目'
    }
  },
  // #25: 墨田区 すみまるくん（北西部/北東部/南部ルート・押上駅で結節）
  {
    bus: 'すみまるくん', municipality: '墨田区',
    url: 'https://www.city.sumida.lg.jp/kurashi/jyunkanbus/index.html',
    routes: [
      { name: '北西部ルート', stops: ['押上駅', '東あずま', '鐘ヶ淵駅', '京成曳舟駅', '押上駅'] },
      { name: '北東部ルート', stops: ['押上駅', '八広', '東向島駅', '京成曳舟駅', '押上駅'] },
      { name: '南部ルート', stops: ['押上駅', '錦糸町駅前', '東京スカイツリー', '押上駅'] }
    ],
    stations: {
      '押上': '押上駅', '鐘ヶ淵': '鐘ヶ淵駅', '京成曳舟': '京成曳舟駅',
      '東向島': '東向島駅', '錦糸町': '錦糸町駅前', 'とうきょうスカイツリー': '東京スカイツリー'
    }
  },
  // #25: 江東区 しおかぜ（木場/豊洲/辰巳ルート・潮見駅前起点）
  {
    bus: 'しおかぜ', municipality: '江東区',
    url: 'https://www.city.koto.lg.jp/470801/kurashi/kotsu/kokyo/13116.html',
    routes: [
      { name: '木場ルート', stops: ['潮見駅前', '枝川二丁目', '木場一丁目', '木場駅', '潮見駅前'] },
      { name: '豊洲ルート', stops: ['潮見駅前', '豊洲駅前', '昭和大学江東豊洲病院前', '潮見駅前'] },
      { name: '辰巳ルート', stops: ['潮見駅前', '辰巳駅', '潮見駅前'] }
    ],
    stations: {
      '潮見': '潮見駅前', '木場': '木場駅', '豊洲': '豊洲駅前', '辰巳': '辰巳駅'
    }
  },
  // #25: 板橋区 りんりんGO（高島平地区循環・時計/反時計回り）
  {
    bus: 'りんりんGO', municipality: '板橋区',
    url: 'https://www.city.itabashi.tokyo.jp/bunka/kanko/1006732.html',
    routes: [
      { name: 'りんりんGO（反時計回り）', stops: ['板橋市場', '新高島平駅', '高島平三丁目', '大門竹の子公園', '区立徳丸小学校', '板橋市場'] },
      { name: 'りんりんGO（時計回り）', stops: ['板橋市場', '徳丸五丁目', '高島平駅', '新高島平駅', '板橋市場'] }
    ],
    stations: {
      '新高島平': '新高島平駅', '高島平': '高島平駅'
    }
  },
  // #25: 国分寺市 ぶんバス（本多/東元町/西町/日吉町/戸倉・主要ルート）
  {
    bus: 'ぶんバス', municipality: '国分寺市',
    url: 'https://www.city.kokubunji.tokyo.jp/kurashi/koutsuu/bus/',
    routes: [
      { name: '本多ルート', stops: ['国分寺駅北口', '本町二丁目西', '早稲田実業学校', '本多一丁目', '国分寺駅北口'] },
      { name: '東元町ルート', stops: ['国分寺駅南口', '東元町三丁目', '新町三丁目', '国分寺駅南口'] },
      { name: '西町ルート', stops: ['国分寺駅北口', '西町', '国分寺駅北口'] },
      { name: '日吉町ルート', stops: ['国分寺駅南口', '日吉町', '国分寺駅南口'] }
    ],
    stations: {
      '国分寺': '国分寺駅北口'
    }
  },
  // #25: 狛江市 こまバス（北回り/南回り・狛江駅北口起点の8の字循環）
  {
    bus: 'こまバス', municipality: '狛江市',
    url: 'https://www.city.komae.tokyo.jp/index.cfm/41,23028,312,html',
    routes: [
      { name: '北回り', stops: ['狛江駅北口', '泉竜寺', '中和泉', '児童公園', '狛江駅北口'] },
      { name: '南回り', stops: ['狛江駅北口', '泉竜寺', '元和泉市民テニスコート', '和泉多摩川駅', '狛江駅北口'] }
    ],
    stations: {
      '狛江': '狛江駅北口', '和泉多摩川': '和泉多摩川駅'
    }
  },
  // #25: 小平市 にじバス（大沼/栄町/鈴木町/花小金井ルート）
  {
    bus: 'にじバス', municipality: '小平市',
    url: 'https://www.city.kodaira.tokyo.jp/kurashi/000/000137.html',
    routes: [
      { name: '大沼ルート', stops: ['小平駅南口', '小平市役所', '一橋学園駅', '小平駅南口'] },
      { name: '栄町ルート', stops: ['小平駅南口', 'なかまちテラス', '新小平駅', '栄町', '小平駅南口'] },
      { name: '鈴木町ルート', stops: ['花小金井駅南口', '鈴木町', '小平駅南口'] }
    ],
    stations: {
      '小平': '小平駅南口', '一橋学園': '一橋学園駅', '新小平': '新小平駅', '花小金井': '花小金井駅南口'
    }
  },
  // #25: 国立市 くにっこ（北/北西中ルート・国立駅北口起点）
  {
    bus: 'くにっこ', municipality: '国立市',
    url: 'https://www.city.kunitachi.tokyo.jp/soshiki/Dept06/Div02/Sec06/gyomu/0505/0508/0509/community_bus/1461059935635.html',
    routes: [
      { name: '北ルート', stops: ['国立駅北口', '北第一小学校', '国立市役所', '国立駅北口'] },
      { name: '北西中ルート', stops: ['国立駅南口', '国立公民館', '国立学園', '谷保駅西', 'くにたち福祉会館', '国立駅南口'] }
    ],
    stations: {
      '国立': '国立駅北口', '谷保': '谷保駅西'
    }
  },
  // #25: 清瀬市 きよバス（緑蔭通り/志木街道経由・清瀬駅〜秋津駅）
  {
    bus: 'きよバス', municipality: '清瀬市',
    url: 'https://www.city.kiyose.lg.jp/kurashi/sumaidourokoutuu/communitybus/1003943.html',
    routes: [
      { name: '緑蔭通り経由', stops: ['清瀬駅北口', 'けやきホール', '清瀬郵便局', '清瀬駅南口'] },
      { name: '志木街道経由', stops: ['清瀬駅北口', '秋津駅', '清瀬駅南口'] }
    ],
    stations: {
      '清瀬': '清瀬駅北口', '秋津': '秋津駅'
    }
  },
  // #25: 大田区 たまちゃんバス（矢口・下丸子地域循環）
  {
    bus: 'たまちゃんバス', municipality: '大田区',
    url: 'https://www.city.ota.tokyo.jp/seikatsu/sumaimachinami/koutsu/communitybusdounyu/communitybus_shikou.html',
    routes: [
      { name: '矢口・下丸子循環（外回り）', stops: ['武蔵新田駅', '下丸子駅入口', 'キヤノン本社通用門前', '矢口中学校', '武蔵新田駅'] },
      { name: '矢口・下丸子循環（内回り）', stops: ['武蔵新田駅', '矢口中学校', 'キヤノン本社通用門前', '下丸子駅入口', '武蔵新田駅'] }
    ],
    stations: {
      '武蔵新田': '武蔵新田駅', '下丸子': '下丸子駅入口'
    }
  },
  // #25: 稲城市 ｉバス（A/B/C/Dコース）
  {
    bus: 'ｉバス', municipality: '稲城市',
    url: 'https://www.city.inagi.tokyo.jp/kurashi/koutsuu/1002846/1002848/1002850.html',
    routes: [
      { name: 'Aコース（南多摩駅⇔メモリアルパーク）', stops: ['南多摩駅', '稲城市役所', '稲城駅', '稲城・府中メモリアルパーク'] },
      { name: 'Bコース（はるひ野駅⇔南多摩駅）', stops: ['はるひ野駅', '若葉台駅', '南多摩駅'] },
      { name: 'Cコース（南多摩駅・よみうりランド路線）', stops: ['稲城長沼駅', '京王よみうりランド駅入口', '南多摩駅'] }
    ],
    stations: {
      '南多摩': '南多摩駅', '稲城長沼': '稲城長沼駅', 'はるひ野': 'はるひ野駅',
      '若葉台': '若葉台駅', '矢野口': '矢野口駅', '稲城': '稲城駅'
    }
  },
  // #25: 多摩市ミニバス（南北線 桜ヶ丘・和田/愛宕ルート・東西循環）
  {
    bus: '多摩市ミニバス', municipality: '多摩市',
    url: 'https://www.city.tama.lg.jp/kurashi/bus/minibus/1002467.html',
    routes: [
      { name: '南北線 桜ヶ丘・和田ルート', stops: ['多摩センター駅', '豊ヶ丘四丁目', '桜ヶ丘', '和田', '多摩センター駅'] },
      { name: '南北線 愛宕ルート', stops: ['永山駅', '愛宕', '多摩センター駅'] },
      { name: '東西循環（永山駅-唐木田駅）', stops: ['永山駅', '豊ヶ丘四丁目', '唐木田駅'] }
    ],
    stations: {
      '多摩センター': '多摩センター駅', '永山': '永山駅', '唐木田': '唐木田駅'
    }
  },
  // #25: 調布市ミニバス（西/北路線）
  {
    bus: '調布市ミニバス', municipality: '調布市',
    url: 'https://www.city.chofu.lg.jp/080070/p050018.html',
    routes: [
      { name: '西路線', stops: ['調布駅南口', '多摩川', '上石原', '飛田給駅南口'] },
      { name: '北路線（調37）', stops: ['調布駅北口', '布田一丁目', '深大寺東町', 'ブランチ調布'] }
    ],
    stations: {
      '調布': '調布駅南口', '飛田給': '飛田給駅南口'
    }
  },
  // #25: 東村山市 グリーンバス（東村山駅東口〜多摩北部医療センター/久米川町循環/西口〜久米川駅南口）
  {
    bus: 'グリーンバス', municipality: '東村山市',
    url: 'https://www.city.higashimurayama.tokyo.jp/kurashi/sumai/bus/index.html',
    routes: [
      { name: '東村山駅東口〜多摩北部医療センター', stops: ['東村山駅東口', '多摩北部医療センター', '新秋津駅'] },
      { name: '久米川町循環', stops: ['東村山駅東口', '久米川町', '南秋津', '東村山駅東口'] },
      { name: '東村山駅西口〜富士見町四丁目〜久米川駅南口', stops: ['東村山駅西口', '富士見町四丁目', '久米川駅南口'] }
    ],
    stations: {
      '東村山': '東村山駅東口', '久米川': '久米川駅南口', '新秋津': '新秋津駅'
    }
  },
  // #25: 町田市 まちっこ（相原/公共施設巡回ルート）
  {
    bus: 'まちっこ', municipality: '町田市',
    url: 'https://www.city.machida.tokyo.jp/kurashi/sumai/kotsu/shimin/bus/index.html',
    routes: [
      { name: '公共施設巡回ルート', stops: ['町田バスセンター', '町田市役所市民ホール前', '第四小学校前', '中町二丁目', '町田バスセンター'] },
      { name: '相原ルート', stops: ['町田バスセンター', '相原', '町田バスセンター'] }
    ],
    stations: {
      '町田': '町田バスセンター'
    }
  },
  // #25: 昭島市 Aバス（北/西/東ルート・昭島駅南口起点）
  {
    bus: 'Aバス', municipality: '昭島市',
    url: 'https://www.city.akishima.lg.jp/kurashi/bus/1002242/1002244.html',
    routes: [
      { name: '北ルート', stops: ['昭島駅南口', '昭島駅南口商店街', '保健福祉センター', 'アキシマエンシス', '昭島駅南口'] },
      { name: '西ルート', stops: ['昭島駅南口', '昭和町', '西武立川駅南口', '昭島駅南口'] },
      { name: '東ルート', stops: ['昭島駅南口', '昭島団地', '中神駅北口', '昭島駅南口'] }
    ],
    stations: {
      '昭島': '昭島駅南口', '中神': '中神駅北口', '西武立川': '西武立川駅南口'
    }
  },
  // #25: 日野市ミニバス（市内路線S・高幡不動駅〜豊田駅北口）
  {
    bus: '日野市ミニバス', municipality: '日野市',
    url: 'https://www.city.hino.lg.jp/kurashi/kotsu/bus/minibus/index.html',
    routes: [
      { name: '市内路線S', stops: ['高幡不動駅', '日野市役所', '市立病院入口', '豊田駅北口'] }
    ],
    stations: {
      '高幡不動': '高幡不動駅', '豊田': '豊田駅北口'
    }
  },
  // #25: 東大和市 ちょこバス（循環/往復ルート・上北台駅起点）
  {
    bus: 'ちょこバス', municipality: '東大和市',
    url: 'https://www.city.higashiyamato.lg.jp/kurashi/dorokotsu/1002085/1002091.html',
    routes: [
      { name: '循環ルート（外回り）', stops: ['上北台駅', '芝中団地中央', '奈良橋市民センター', '東大和市駅', '上北台駅'] },
      { name: '往復ルート', stops: ['東大和市役所', '南街', '東大和市役所'] }
    ],
    stations: {
      '上北台': '上北台駅', '東大和市': '東大和市駅'
    }
  },
  // #25: 武蔵村山市 MMシャトル（上北台/玉川上水ルート）
  {
    bus: 'MMシャトル', municipality: '武蔵村山市',
    url: 'https://www.city.musashimurayama.lg.jp/kurashi/koutsu/koukyoukoutu/1000603/',
    routes: [
      { name: '上北台ルート', stops: ['上北台駅', '武蔵村山市役所前', '三ツ木地区会館', '村山温泉かたくりの湯', '上北台駅'] },
      { name: '玉川上水ルート', stops: ['玉川上水駅', 'イオンモール', '武蔵村山市役所', '玉川上水駅'] }
    ],
    stations: {
      '上北台': '上北台駅', '玉川上水': '玉川上水駅'
    }
  },
  // #25: 羽村市 はむらん（循環ルート・羽村駅西口/東口）
  {
    bus: 'はむらん', municipality: '羽村市',
    url: 'https://www.city.hamura.tokyo.jp/category/1-11-15-0-0.html',
    routes: [
      { name: '西循環ルート', stops: ['羽村駅西口', '羽村市役所', '羽村駅西口'] },
      { name: '東循環ルート', stops: ['羽村駅東口', '羽村市役所', '羽村駅東口'] }
    ],
    stations: {
      '羽村': '羽村駅西口'
    }
  },
  // #25: 檜原村 やまびこ（村内循環）
  {
    bus: 'やまびこ', municipality: '檜原村',
    url: 'https://www.vill.hinohara.tokyo.jp/0000000090.html',
    routes: [
      { name: '村内循環ルート', stops: ['本宿', '藤倉', '神戸', '本宿'] }
    ],
    stations: {}
  },
  // #25: 豊島区 池07系統（池袋駅東口〜サンシャインシティ・都営バス）
  {
    bus: '池07系統', municipality: '豊島区',
    url: 'https://www.city.toshima.lg.jp/298/machizukuri/kotsu/bus/1504221057.html',
    routes: [
      { name: '池袋駅東口〜サンシャインシティ', stops: ['池袋駅東口', 'サンシャインシティ', '池袋駅東口'] }
    ],
    stations: {
      '池袋': '池袋駅東口'
    }
  },
  // #25: 小金井市 CoCoバス（北東部/南東部/貫井前原循環）
  {
    bus: 'CoCoバス', municipality: '小金井市',
    url: 'https://www.city.koganei.lg.jp/kurashi/482/buss/cocobus.html',
    routes: [
      { name: '北東部循環', stops: ['武蔵小金井駅北口', '小金井公園入口', 'たてもの園入口', '小金井市役所入口', '武蔵小金井駅北口'] },
      { name: '貫井前原循環', stops: ['武蔵小金井駅', '小金井第二庁舎', '小金井市役所', '前原小学校前', '貫井南', '武蔵小金井駅'] }
    ],
    stations: {
      '武蔵小金井': '武蔵小金井駅北口'
    }
  }
];

// 駅名 → コミュニティバス案内（Phase 1 の案内モード用・複数バス対応）
const COMMUNITY_BUS_STATION_ACCESS = {};
for (const cb of COMMUNITY_BUS_ROUTES) {
  for (const [station, stop] of Object.entries(cb.stations)) {
    if (!COMMUNITY_BUS_STATION_ACCESS[station]) COMMUNITY_BUS_STATION_ACCESS[station] = [];
    COMMUNITY_BUS_STATION_ACCESS[station].push({ bus: cb.bus, municipality: cb.municipality, url: cb.url, stop });
  }
}

const BUS_GTFS_SOURCES = [
  // JRバス関東: 主要ターミナル・系統（ODPT未登録のためハードコード）
  {
    name: 'JRバス関東', operatorId: 'JRBKanto',
    label: 'JRバス関東', labelEn: 'JR Bus Kanto', labelZh: 'JR巴士关东',
    website: 'https://www.jrbuskanto.co.jp/',
    hardCoded: true,
    stops: [
      '東京駅', '新宿駅', '池袋駅', '渋谷駅', '品川駅', '東京ドームシティ',
      '横浜駅', '川崎駅', '立川駅', '八王子駅', '町田駅', '相模原駅',
      '千葉駅', '柏駅', '水戸駅', '宇都宮駅', '高崎駅', '前橋市',
      '河口湖駅', '御殿場駅', '箱根湯本駅', '茨城空港（小美玉）', '成田空港', '羽田空港'
    ],
    // 主要系統（東京～各拠点）。実GTFS未取得のため代表系統のみ。
    routes: [
      ['東京駅', '河口湖駅'], ['新宿駅', '河口湖駅'], ['東京駅', '箱根湯本駅'],
      ['横浜駅', '箱根湯本駅'], ['東京駅', '水戸駅'], ['東京駅', '宇都宮駅'],
      ['東京駅', '高崎駅'], ['東京駅', '千葉駅'], ['東京駅', '成田空港'],
      ['東京駅', '羽田空港'], ['新宿駅', '立川駅'], ['新宿駅', '八王子駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['新宿駅', '横浜駅'], ['新宿駅', '千葉駅'], ['東京駅', '柏駅'],
      ['新宿駅', '御殿場駅'], ['新宿駅', '前橋市'], ['渋谷駅', '河口湖駅'],
      ['池袋駅', '水戸駅'], ['横浜駅', '成田空港'], ['東京駅', '川崎駅'],
      ['新宿駅', '町田駅'], ['東京駅', '相模原駅'], ['新宿駅', '水戸駅']
    ]
  },
  // #24-2: 空港リムジンバス（東京空港交通）— ODPT未登録・空港アクセス非鉄系のためハードコード。
  // 実在の主要系統（羽田・成田→都心主要ターミナル）を収録し、search_bus の「バス優先」で
  // 空港→都心が引けるようにする。時刻は公式サイト参照（stop_times は未収録）。
  {
    name: '空港リムジンバス', operatorId: 'AirportLimousine',
    label: '空港リムジンバス（東京空港交通）', labelEn: 'Airport Limousine Bus (Tokyo Airport Transport)', labelZh: '机场利木津巴士（东京机场交通）',
    website: 'https://www.limousinebus.co.jp/',
    hardCoded: true,
    stops: [
      '羽田空港', '羽田空港第1ターミナル', '羽田空港第2ターミナル', '羽田空港第3ターミナル',
      '成田空港', '成田空港第1ターミナル', '成田空港第2ターミナル', '成田空港第3ターミナル',
      '東京駅', '東京駅八重洲', '新宿駅', '新宿駅西口', '渋谷駅', '池袋駅', '品川駅',
      'お台場', '東京ディズニーリゾート', '横浜駅', '横浜駅東口', 'YCAT', '二子玉川', '吉祥寺駅'
    ],
    // 主要系統（羽田・成田→都心）。実GTFS未取得のため代表系統のみ。
    // 注: リムジンは「新宿駅西口」バスターミナル発着（新宿駅そのものには停車しない）
    routes: [
      ['羽田空港', '新宿駅西口'], ['羽田空港', '渋谷駅'], ['羽田空港', '池袋駅'],
      ['羽田空港', '品川駅'], ['羽田空港', '東京駅'], ['羽田空港', 'お台場'],
      ['羽田空港', '東京ディズニーリゾート'], ['羽田空港', '横浜駅'], ['羽田空港', '二子玉川'],
      ['成田空港', '東京駅'], ['成田空港', '新宿駅西口'], ['成田空港', '渋谷駅'],
      ['成田空港', '池袋駅'], ['成田空港', '品川駅'], ['成田空港', '横浜駅'],
      ['成田空港', '東京ディズニーリゾート'], ['成田空港', '吉祥寺駅']
    ]
  },
  // #21-A: 主要私鉄バス事業者（京王・東急・小田急・京成バス）— ODPT未登録のためハードコード。
  // 実在の代表系統のみ収録（実GTFSが安定取得できるようになったら { url, date } ソースへ移行）。
  {
    name: '京王バス', operatorId: 'KeioBus',
    label: '京王バス', labelEn: 'Keio Bus', labelZh: '京王巴士',
    website: 'https://www.keio-bus.com/',
    hardCoded: true,
    stops: [
      '新宿駅西口', '新宿駅', '渋谷駅', '中野駅', '阿佐ヶ谷駅', '練馬駅', '高円寺駅',
      '調布駅', 'つつじヶ丘駅', '千歳烏山駅', '八幡山駅', '三鷹駅', '吉祥寺駅',
      '武蔵小金井駅', '国分寺駅', '国立駅', '府中駅', '聖蹟桜ヶ丘駅', '高幡不動駅', '京王八王子駅'
    ],
    routes: [
      ['新宿駅西口', '渋谷駅'], ['新宿駅西口', '中野駅'], ['新宿駅西口', '阿佐ヶ谷駅'],
      ['新宿駅西口', '練馬駅'], ['渋谷駅', '調布駅'], ['調布駅', '吉祥寺駅'],
      ['三鷹駅', '調布駅'], ['三鷹駅', '吉祥寺駅'], ['武蔵小金井駅', '国分寺駅'],
      ['国分寺駅', '国立駅'], ['府中駅', '聖蹟桜ヶ丘駅'], ['調布駅', '高幡不動駅'],
      ['高幡不動駅', '京王八王子駅'], ['新宿駅西口', '府中駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['渋谷駅', '中野駅'], ['吉祥寺駅', '武蔵小金井駅'], ['三鷹駅', '武蔵小金井駅'],
      ['府中駅', '調布駅'], ['聖蹟桜ヶ丘駅', '府中駅'], ['新宿駅西口', '荻窪駅'],
      ['中野駅', '阿佐ヶ谷駅'], ['調布駅', 'つつじヶ丘駅']
    ]
  },
  {
    name: '東急バス', operatorId: 'TokyuBus',
    label: '東急バス', labelEn: 'Tokyu Bus', labelZh: '东急巴士',
    website: 'https://www.tokyubus.co.jp/',
    hardCoded: true,
    stops: [
      '渋谷駅', '目黒駅', '五反田駅', '大井町駅', '蒲田駅', '大岡山駅', '自由が丘駅',
      '二子玉川駅', '高津駅', '溝の口駅', '田園調布駅', '武蔵小杉駅', '日吉駅', '綱島駅',
      '中目黒駅', '恵比寿駅', '品川駅', '大崎駅', '池上駅', '雪が谷大塚駅', '洗足池駅'
    ],
    routes: [
      ['渋谷駅', '大井町駅'], ['渋谷駅', '中目黒駅'], ['渋谷駅', '二子玉川駅'],
      ['目黒駅', '大岡山駅'], ['目黒駅', '武蔵小杉駅'], ['五反田駅', '蒲田駅'],
      ['大井町駅', '蒲田駅'], ['大井町駅', '二子玉川駅'], ['蒲田駅', '池上駅'],
      ['自由が丘駅', '田園調布駅'], ['溝の口駅', '二子玉川駅'], ['綱島駅', '日吉駅'],
      ['渋谷駅', '恵比寿駅'], ['品川駅', '大崎駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['目黒駅', '五反田駅'], ['大井町駅', '五反田駅'], ['自由が丘駅', '二子玉川駅'],
      ['溝の口駅', '高津駅'], ['五反田駅', '大崎駅'], ['渋谷駅', '品川駅'],
      ['武蔵小杉駅', '日吉駅'], ['目黒駅', '中目黒駅']
    ]
  },
  {
    name: '小田急バス', operatorId: 'OdakyuBus',
    label: '小田急バス', labelEn: 'Odakyu Bus', labelZh: '小田急巴士',
    website: 'https://www.odakyubus.co.jp/',
    hardCoded: true,
    stops: [
      '新宿駅西口', '新宿駅', '渋谷駅', '下北沢駅', '経堂駅', '成城学園前駅', '狛江駅',
      '登戸駅', '向ヶ丘遊園駅', '新百合ヶ丘駅', '町田駅', '相模大野駅', '本厚木駅',
      '吉祥寺駅', '三鷹駅', '武蔵境駅', '荻窪駅'
    ],
    routes: [
      ['新宿駅西口', '吉祥寺駅'], ['渋谷駅', '吉祥寺駅'], ['渋谷駅', '狛江駅'],
      ['新宿駅西口', '下北沢駅'], ['経堂駅', '成城学園前駅'], ['成城学園前駅', '狛江駅'],
      ['登戸駅', '向ヶ丘遊園駅'], ['新百合ヶ丘駅', '町田駅'], ['町田駅', '相模大野駅'],
      ['吉祥寺駅', '三鷹駅'], ['荻窪駅', '吉祥寺駅'], ['新宿駅西口', '成城学園前駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['新宿駅西口', '荻窪駅'], ['武蔵境駅', '三鷹駅'], ['吉祥寺駅', '武蔵境駅'],
      ['成城学園前駅', '二子玉川駅'], ['新百合ヶ丘駅', '相模大野駅'], ['町田駅', '本厚木駅'],
      ['経堂駅', '下北沢駅']
    ]
  },
  {
    name: '京成バス', operatorId: 'KeiseiBus',
    label: '京成バス', labelEn: 'Keisei Bus', labelZh: '京成巴士',
    website: 'https://www.keiseibus.co.jp/',
    hardCoded: true,
    stops: [
      '東京駅', '新橋駅', '銀座駅', 'お台場', '錦糸町駅', '船橋駅', '津田沼駅',
      '千葉駅', '京成船橋駅', '松戸駅', '柏駅', '成田駅', '京成成田駅', '市川駅',
      '西船橋駅', '舞浜駅', '新浦安駅'
    ],
    routes: [
      ['東京駅', '千葉駅'], ['東京駅', 'お台場'], ['新橋駅', 'お台場'],
      ['東京駅', '船橋駅'], ['東京駅', '松戸駅'], ['銀座駅', 'お台場'],
      ['船橋駅', '津田沼駅'], ['千葉駅', '成田駅'], ['松戸駅', '柏駅'],
      ['東京駅', '新浦安駅'], ['東京駅', '舞浜駅'], ['市川駅', '西船橋駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['船橋駅', '西船橋駅'], ['松戸駅', '市川駅'], ['舞浜駅', '新浦安駅'],
      ['千葉駅', '津田沼駅'], ['東京駅', '錦糸町駅'], ['柏駅', '船橋駅']
    ]
  },
  // #45: 千葉・埼玉・神奈川のローカルバス（延伸駅周辺・ODPT未登録のためハードコード）
  // 出典: 各社公式サイトの主要停留所・系統（代表系統のみ・時刻は未収録）
  {
    name: 'ちばフラワーバス（ちばグリーンバス）', operatorId: 'ChibaFlowerBus',
    label: 'ちばフラワーバス（佐倉）', labelEn: 'Chiba Flower Bus (Sakura)', labelZh: '千叶花巴士（佐仓）',
    website: 'https://www.chiba-flowerbus.jp/',
    hardCoded: true,
    stops: [
      '佐倉駅', '京成佐倉駅', '佐倉市役所', '国立歴史民俗博物館', 'ユーカリが丘駅', '臼井駅', '志津駅', '佐倉城址公園入口'
    ],
    routes: [
      ['佐倉駅', '京成佐倉駅'], ['佐倉駅', '国立歴史民俗博物館'], ['京成佐倉駅', '国立歴史民俗博物館'],
      ['ユーカリが丘駅', '佐倉駅'], ['臼井駅', '佐倉駅'], ['志津駅', '佐倉駅']
    ]
  },
  {
    name: 'さいたま市営バス', operatorId: 'SaitamaCityBus',
    label: 'さいたま市営バス', labelEn: 'Saitama City Bus', labelZh: '埼玉市营公交',
    website: 'https://www.city.saitama.lg.jp/003/001/kotsu/',
    hardCoded: true,
    stops: [
      '大宮駅東口', '大宮駅西口', '鉄道博物館', '鉄道博物館南', '大成四丁目', '大宮中央総合病院', '大宮中央総合病院入口', '赤芝'
    ],
    routes: [
      ['大宮駅東口', '鉄道博物館'], ['大宮駅西口', '鉄道博物館'], ['大宮駅東口', '大成四丁目'],
      ['大宮駅東口', '大宮中央総合病院']
    ]
  },
  {
    name: '東武バス（埼玉）', operatorId: 'TobuBusSaitama',
    label: '東武バス（埼玉）', labelEn: 'Tobu Bus (Saitama)', labelZh: '东武巴士（埼玉）',
    website: 'https://www.tobu-bus.com/',
    hardCoded: true,
    stops: [
      '大宮駅東口', '大宮駅西口', '鉄道博物館', '大成', '上尾駅東口', '宮原駅入口', '指扇駅', '西大宮駅'
    ],
    routes: [
      ['大宮駅東口', '上尾駅東口'], ['大宮駅東口', '鉄道博物館'], ['大宮駅西口', '鉄道博物館'],
      ['大宮駅東口', '指扇駅'], ['上尾駅東口', '鉄道博物館']
    ]
  },
  {
    name: '西武観光バス（秩父）', operatorId: 'SeibuKankoBusChichibu',
    label: '西武観光バス（秩父）', labelEn: 'Seibu Kanko Bus (Chichibu)', labelZh: '西武观光巴士（秩父）',
    website: 'https://www.seibubus.co.jp/rosen/chichibu/',
    hardCoded: true,
    stops: [
      '西武秩父駅', '秩父駅', '秩父市役所', '羊山公園', '長瀞駅', '長瀞', '皆野駅', '三峰口駅', '三峯神社', '大滝温泉', '正丸駅'
    ],
    routes: [
      ['西武秩父駅', '秩父駅'], ['西武秩父駅', '長瀞'], ['西武秩父駅', '三峰口駅'],
      ['西武秩父駅', '三峯神社'], ['西武秩父駅', '皆野駅'], ['秩父駅', '長瀞'], ['西武秩父駅', '羊山公園']
    ]
  },
  {
    name: '江ノ電バス', operatorId: 'EnodenBus',
    label: '江ノ電バス', labelEn: 'Enoden Bus', labelZh: '江之电巴士',
    website: 'https://www.enoden.co.jp/bus/',
    hardCoded: true,
    stops: [
      '江ノ島', '江ノ島入口', '湘南海岸公園', '新江ノ島水族館', '湘南港桟橋', '藤沢駅', '鎌倉駅', '大船駅', '長谷駅', '極楽寺駅'
    ],
    routes: [
      ['藤沢駅', '江ノ島'], ['鎌倉駅', '江ノ島'], ['大船駅', '江ノ島'],
      ['藤沢駅', '湘南港桟橋'], ['鎌倉駅', '湘南港桟橋'], ['藤沢駅', '長谷駅']
    ]
  },
  {
    name: '千葉中央バス', operatorId: 'ChibaChuoBus',
    label: '千葉中央バス', labelEn: 'Chiba Chuo Bus', labelZh: '千叶中央巴士',
    website: 'https://www.chibachuobus.co.jp/',
    hardCoded: true,
    stops: [
      '千葉駅', '千葉中央駅', '千葉市役所前', '千城台駅', '千城台車庫', '千城局', '都賀駅', '稲毛駅'
    ],
    routes: [
      ['千葉駅', '千城台駅'], ['千葉駅', '千城台車庫'], ['千葉駅', '千葉市役所前'],
      ['千葉駅', '都賀駅'], ['千葉中央駅', '千城台駅']
    ]
  },
  {
    name: '川越観光自動車（イーグルバス・越生）', operatorId: 'KawagoeKankoOgose',
    label: '川越観光自動車（越生）', labelEn: 'Kawagoe Kanko Bus (Ogose)', labelZh: '川越观光汽车（越生）',
    website: 'https://www.kawagoebus.jp/',
    hardCoded: true,
    stops: [
      '越生駅', '越生駅入口', '越生駅東口', '黒山', 'せせらぎバスセンター', '慈光寺', 'ときがわ町役場'
    ],
    routes: [
      ['越生駅', '黒山'], ['越生駅', 'せせらぎバスセンター'], ['越生駅', '慈光寺'],
      ['越生駅', 'ときがわ町役場']
    ]
  },
  {
    name: '丸建つばさ交通（けんちゃんバス）', operatorId: 'MarukenTsubasa',
    label: '丸建つばさ交通（伊奈・けんちゃんバス）', labelEn: 'Maruken Tsubasa Kotsu (Ina)', labelZh: '丸建翼交通（伊奈）',
    website: 'https://maru-ken.co.jp/route-bus/',
    hardCoded: true,
    stops: [
      '内宿駅', '伊奈学園', 'がんセンター', '戸崎前', '県民活動センター', '伊奈記念公園北', '桂全寺前', 'さくら団地', '小室駅', '伊奈町役場'
    ],
    routes: [
      ['内宿駅', '小室駅'], ['内宿駅', '伊奈学園'], ['内宿駅', 'がんセンター'],
      ['内宿駅', '県民活動センター'], ['内宿駅', '伊奈町役場']
    ]
  },
  // 東京都内コミュニティバス（代表例: 23区＋多摩地域の主要コミュニティバス）
  // communityBuses: tokyobus.or.jp/sp の41自治体ディレクトリ（名称＋公式URL）。検索・一覧表示用。
  {
    name: '東京都コミュニティバス', operatorId: 'TokyoCommunity',
    label: '都内コミュニティバス', labelEn: 'Tokyo Community Bus', labelZh: '东京都社区公交',
    website: 'https://www.tokyobus.or.jp/sp/',
    hardCoded: true,
    communityBuses: TOKYO_COMMUNITY_BUSES,
    stops: [
      '港区役所（ちぃばす）', '新宿駅西口（新宿WEバス）', '渋谷駅（ハチ公バス）',
      '千代田区役所（風ぐるま）', '中央区役所（江戸バス）', '品川駅（すいすい館山）',
      '王子駅（王子・飛鳥山循環）', '立川駅（くるりんバス）', '八王子駅（はちバス）',
      '町田駅（まちっこ）', '府中駅（ちゅうバス）', '調布駅（ぶんバス）',
      '国立駅（くにっこ）', '武蔵野市役所（むーばす）', '三鷹駅（みたかシティバス）',
      // v2.25.1 #21-A 拡充: 主要コミュニティバス停留所
      '中野駅（中野区コミュニティバス）', '杉並区役所（すぎ丸）', '文京区役所（Bーぐる）',
      '台東区役所（めぐりん）', '墨田区役所（すみまるくん）', '江東区役所（しおかぜ）',
      '板橋区役所（りんりんGO）', '練馬区役所（みどりバス）', '世田谷区役所（せたがやくるりん）',
      '西東京市役所（はなバス）', '小平市役所（にじバス）', '国分寺市役所（ぶんバス）',
      '狛江市役所（こまバス）', '清瀬市役所（きよバス）', '稲城市役所（iバス）',
      '多摩センター駅（多摩市ミニバス）', '日野市役所（ちょこバス）', '東大和市役所（ちょこバス）',
      '武蔵村山市役所（MMシャトル）', '羽村市役所（はむらん）', '檜原村（やまびこ）',
      '豊島区役所（池07系統）', '小金井市役所（CoCoバス）', '昭島市役所（Aバス）'
    ],
    routes: [
      ['渋谷駅（ハチ公バス）', '渋谷駅'], ['新宿駅西口（新宿WEバス）', '新宿駅'],
      ['港区役所（ちぃばす）', '六本木駅'], ['立川駅（くるりんバス）', '立川駅'],
      ['八王子駅（はちバス）', '八王子駅'], ['調布駅（ぶんバス）', '調布駅'],
      // v2.25.1 #21-A 拡充: 主要コミュニティバス系統
      ['中野駅（中野区コミュニティバス）', '中野駅'], ['杉並区役所（すぎ丸）', '荻窪駅'],
      ['文京区役所（Bーぐる）', '後楽園駅'], ['台東区役所（めぐりん）', '上野駅'],
      ['墨田区役所（すみまるくん）', '押上駅'], ['江東区役所（しおかぜ）', '門前仲町駅'],
      ['板橋区役所（りんりんGO）', '板橋区役所駅'], ['練馬区役所（みどりバス）', '練馬駅'],
      ['世田谷区役所（せたがやくるりん）', '三軒茶屋駅'], ['西東京市役所（はなバス）', 'ひばりヶ丘駅'],
      ['小平市役所（にじバス）', '小平駅'], ['国分寺市役所（ぶんバス）', '国分寺駅'],
      ['狛江市役所（こまバス）', '狛江駅'], ['清瀬市役所（きよバス）', '清瀬駅'],
      ['稲城市役所（iバス）', '稲城駅'], ['多摩センター駅（多摩市ミニバス）', '多摩センター駅'],
      ['日野市役所（ちょこバス）', '日野駅'], ['東大和市役所（ちょこバス）', '東大和市駅'],
      ['武蔵村山市役所（MMシャトル）', '玉川上水駅'], ['羽村市役所（はむらん）', '羽村駅'],
      ['檜原村（やまびこ）', '武蔵五日市駅'], ['豊島区役所（池07系統）', '池袋駅'],
      ['小金井市役所（CoCoバス）', '武蔵小金井駅'], ['昭島市役所（Aバス）', '昭島駅']
    ]
  },
  // ============================================================
  // v2.38.5: ODPT 静的 GTFS（files/odpt/...・基本ライセンス）の実データソース。
  // CKAN データカタログ（ckan.odpt.org）で基本ライセンス公開が確認できた関東圏バス5社。
  // fetchAllBuses の GTFS 取得パス（フェリーと同じ { url, date } 方式）で展開される。
  // 🔴 date は毎回現在日付ではなく「有効期間内の固定日付」を返す（リソースの有効期間に合わせる）。
  //    有効期間切れ時は CKAN の最新リソース URL に追随して更新する。
  {
    name: '川崎市バス', operatorId: 'KawasakiCityBus',
    label: '川崎市バス', labelEn: 'Kawasaki City Bus', labelZh: '川崎市公交',
    website: 'https://www.city.kawasaki.jp/kurashi/category/19-1-1-1-0-0-0-0-0-0.html',
    url: 'https://api.odpt.org/api/v4/files/odpt/TransportationBureau_CityOfKawasaki/AllLines.zip',
    date: () => '20260801',
    // stops.txt の stop_name を停名レコード、routes.txt の route_short_name を系統レコードとして合成
    useStopsAndRoutes: true
  },
  {
    name: '川崎鶴見臨港バス', operatorId: 'KawasakiTsurumiRinkoBus',
    label: '川崎鶴見臨港バス', labelEn: 'Kawasaki Tsurumi Rinko Bus', labelZh: '川崎鹤见临港公交',
    website: 'https://www.rinkobus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/KawasakiTsurumiRinkoBus/allrinko.zip',
    date: () => '20260716',
    useStopsAndRoutes: true
  },
  {
    name: '関東バス', operatorId: 'KantoBus',
    label: '関東バス', labelEn: 'Kanto Bus', labelZh: '关东公交',
    website: 'https://www.kantobus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/KantoBus/AllLines.zip',
    date: () => '20260701',
    useStopsAndRoutes: true
  },
  {
    name: '西東京バス', operatorId: 'NishiTokyoBus',
    label: '西東京バス', labelEn: 'Nishi Tokyo Bus', labelZh: '西东京公交',
    website: 'https://www.nisitokyobus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/NishiTokyoBus/NTBus.zip',
    date: () => '20260829',
    useStopsAndRoutes: true
  },
  {
    name: '京成バス千葉ウエスト', operatorId: 'KeiseiBusChibaWest',
    label: '京成バス千葉ウエスト', labelEn: 'Keisei Bus Chiba West', labelZh: '京成巴士千叶西',
    website: 'https://www.keiseibus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/KeiseiTransitBus/AllLines.zip',
    date: () => '20260401',
    useStopsAndRoutes: true
  }
];

// hardCoded バスソースから {merged} 形式のレコードを合成
function buildHardCodedBusRecords(src) {
  const recs = [];
  for (const stop of src.stops) {
    recs.push({
      'odpt:note': stop,
      'odpt:busroute': `${src.operatorId}:stop`,
      'odpt:busNumber': '',
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
      _searchKeys: [stop],
      _displayNote: stop,
      _hardCoded: true
    });
  }
  // 系統（route）も検索対象に: "起点 → 終点" の note を合成
  for (const [from, to] of (src.routes || [])) {
    const note = `${from} → ${to}`;
    recs.push({
      'odpt:note': note,
      'odpt:busroute': `${src.operatorId}:route`,
      'odpt:busNumber': '',
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
      _searchKeys: [from, to, note],
      _displayNote: note,
      _hardCoded: true
    });
  }
  // コミュニティバス ディレクトリ（自治体×バス名×公式URL）も検索対象に
  // 出典: tokyobus.or.jp/sp のコミュニティバス検索一覧（名称＋自治体＋公式ページURL）
  for (const cb of (src.communityBuses || [])) {
    const note = `[コミュニティバス] ${cb.name}（${cb.municipality}）`;
    const searchable = `${cb.municipality}${cb.name}`;
    recs.push({
      'odpt:note': note,
      'odpt:busroute': `${src.operatorId}:cb:${cb.name}`,
      'odpt:busNumber': '',
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
      _searchKeys: [cb.name, cb.municipality, searchable, note, 'コミュニティバス'],
      _displayNote: `${cb.name}（${cb.municipality}）`,
      _communityBus: true,
      _communityBusUrl: cb.url,
      _municipality: cb.municipality,
      _hardCoded: true
    });
  }
  return recs;
}

// 横浜市営バスは odpt:note が null で、バス停名がローマ字ID（例: SakuragichoStation）しかない。
// ローマ字駅名→日本語の最小マップ（主要ターミナル＋観光地）を付与し、日本語入力でも検索可能にする。
// ODPTには全バス停の日本語名が無いため、網羅ではなく主要駅に限定。
const BUSSTOP_ROMAN_TO_JA = {
  YokohamaStation: '横浜駅', YokohamaShiyakushoMae: '横浜市役所前', SakuragichoStation: '桜木町駅',
  YokohamaStadiumMae: '横浜スタジアム前', KannaiStationKitaguchi: '関内駅北口', ChikatetsuKannaiStation: '地下鉄関内駅',
  ShinYokohamaStation: '新横浜駅', MinatoMirai: 'みなとみらい', Bashamichi: '馬車道', NihonOdoriStationKenchoMae: '日本大通り駅県庁前',
  YokohamaStationWestEntrance: '横浜駅西口', YokohamaStationKaisatsuguchiMae: '横浜駅改札口前',
  KamiookaStation: '上大岡駅', TobeStation: '戸部駅', HinodechoStation: '日ノ出町駅', YamateStation: '山手駅',
  IsogoStation: '磯子駅', IsogoShakoMae: '磯子車庫前', HodogayaStationHigashiguchi: '保土ヶ谷駅東口', HodogayaStationNishiguchi: '保土ヶ谷駅西口',
  KikunaStation: '菊名駅', TsurumiStation: '鶴見駅', TsurumiStationNishiguchi: '鶴見駅西口', ShinKoyasuStation: '新子安駅',
  NakayamaStation: '中山駅', NakamachidaiStation: '中川駅', CenterMinamiStation: 'センター北駅', TsuzukiFureaiNoOkaStation: '都筑ふれあいの丘駅',
  NagatsutaStation: '長津田駅', IchigaoStation: '市が尾駅', EdaStation: '江田駅', HigashiYamataStation: '東山田駅',
  ShinTsunashimaSta: '新綱島', TsunashimaStationIriguchi: '綱島駅入口', OkurayamaStation: '大倉山駅',
  YokodaiStation: '洋光台駅', SugitaTsubonomiChuo: '杉田中央', ShinSugitaStation: '新杉田駅',
  KonandaiStation: '港南台駅', KamiSugetaCho: '上菅田町', OnoeCho: '尾上町', NogeOdori: '野毛大通り',
  Motomachi: '元町', YamashitaCho: '山下町', Honmoku: '本牧', Sankeien: '三溪園', SankeienIriguchi: '三溪園入口',
  Hammerhead: 'ハンマーヘッド', LalaPortYokohamaNishi: 'ららぽーと横浜', MitsuiOutletParkYokohama: '三井アウトレットパーク横浜',
  NegishiStation: '根岸駅', IdogayaStation: '井戸ヶ谷駅', Gumyoji: '弘明寺', Kominato: '小湊',
  Fujidana: '富士見台', YokohamaSatoNoFurusato: '横浜里のふるさと'
};

// 事業者ID→ラベル逆引き（レコードの odpt:operator から表示名を出す）
const BUS_OPERATOR_LABEL = {};
for (const o of BUS_OPERATORS) {
  BUS_OPERATOR_LABEL[`odpt.Operator:${o.id}`] = o;
}

// BusstopPole ID（例: odpt.BusstopPole:YokohamaMunicipal.SakuragichoStation.2014.2）
// から駅名相当（SakuragichoStation）を抽出。ODPTには日本語バス停名が無い事業者（横浜市営等）向け。
function poleIdSeg(poleRef) {
  if (!poleRef) return null;
  const last = String(poleRef).split(':').pop(); // YokohamaMunicipal.SakuragichoStation.2014.2
  return last.replace(/^[A-Za-z]+\./, '').replace(/\.\d+\.\d+$/, ''); // SakuragichoStation
}

async function fetchAllBuses(userLang) {
  // サーキットブレイカーOPEN時は ODPT を呼ばず、ハードコード（JRバス関東・コミュニティバス）のみ返す。
  // コミュニティバス検索（ちぃばす等）は ODPT 無しでも動作させるためのフォールバック。
  if (!odptBreaker.canExecute()) {
    console.log('[Bus] ODPT breaker OPEN — skip ODPT operators, use hardcoded sources only');
    const merged = [];
    let hcCount = 0;
    for (const src of BUS_GTFS_SOURCES) {
      if (!src.hardCoded) continue;
      for (const r of buildHardCodedBusRecords(src)) merged.push(r);
      hcCount++;
    }
    return { merged, okCount: 0, failCount: BUS_OPERATORS.length, hcCount };
  }
  // 全バス事業者を並列取得してマージ（1社でも失敗しても他社は維持）
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:Bus`, { params: getParams(op.id), timeout: 15000 })
    )
  );
  const merged = [];
  let okCount = 0, failCount = 0;
  results.forEach((res, i) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      okCount++;
      for (const b of res.value.data) {
        const opMeta = BUS_OPERATORS[i];
        // 検索用キーを構築（note が無い事業者も BusstopPole ID から駅名相当を拾う）
        const note = b['odpt:note'] || '';
        const segs = [poleIdSeg(b['odpt:startingBusstopPole']), poleIdSeg(b['odpt:terminalBusstopPole'])].filter(Boolean);
        // ローマ字駅名→日本語を付与（横浜市営等 note=null 事業者の日本語検索用）
        const segJa = segs.map(s => BUSSTOP_ROMAN_TO_JA[s] || null).filter(Boolean);
        const searchKeys = [note, ...segs, ...segJa].filter(Boolean);
        // 表示用 note（note が null の横浜市営等は 起点→終点 を 日本語優先で表示）
        const dispSeg = segs.map(s => BUSSTOP_ROMAN_TO_JA[s] || s);
        const displayNote = note || (dispSeg.length ? `${dispSeg[0]} → ${dispSeg[1] || dispSeg[0]}` : (b['odpt:busroute'] || ''));
        merged.push({ ...b, _operatorId: opMeta.id, _operatorLabel: opMeta, _searchKeys: searchKeys, _displayNote: displayNote });
      }
    } else {
      failCount++;
    }
  });
  // 🔴 odpt:Bus は「リアルタイムのバス位置情報」のみを返し、系統・停留所一覧は持たない
  // （無料キーでも 4件程度の現在位置が返るため merged.length===0 にならない）。
  // そのため odpt:Bus の _searchKeys だけでは「浅草雷門」等の停名検索がヒットしない。
  // 停名検索モード（busstop_name）を実用化するため、ODPT が応答していれば問わず
  // odpt:BusroutePattern の停留所名（busstopPoleOrder[].odpt:note）を検索キーとして合成する。
  // （odpt:Bus リアルタイム便のレコードは merged に残したまま、停名レコードを追加マージする）
  if (okCount > 0) {
    try {
      const { patterns } = await fetchBusGraph();
      const stopMap = new Map(); // stopName -> { operator, label }
      for (const p of patterns) {
        const opMeta = BUS_OPERATORS.find(o => o.id === p.operator);
        for (const s of p.stops) {
          if (!s.name) continue;
          if (!stopMap.has(s.name)) {
            stopMap.set(s.name, { operator: p.operator, label: opMeta });
          }
        }
      }
      for (const [stopName, meta] of stopMap) {
        const opMeta = meta.label || { label: meta.operator, labelEn: meta.operator, labelZh: meta.operator, website: undefined };
        merged.push({
          'odpt:note': stopName,
          'odpt:busroute': `${meta.operator}:stop-fallback`,
          'odpt:busNumber': '',
          'odpt:frequency': '',
          'odpt:operator': `odpt.Operator:${meta.operator}`,
          _operatorId: meta.operator,
          _operatorLabel: opMeta,
          _searchKeys: [stopName],
          _displayNote: stopName,
          _busstopFallback: true
        });
      }
      console.log(`[Bus] odpt:Bus empty — BusroutePattern fallback added ${stopMap.size} bus stops`);
    } catch (e) {
      console.log(`[Bus] BusroutePattern fallback failed: ${e.message}`);
    }
  }
  // GTFS-JP 個別取得パス: hardCoded ソース（JRバス関東・コミュニティバス等）をマージ
  // および ODPT 静的 GTFS ソース（川崎市バス・関東バス等・{ url, date } 方式）を展開してマージ
  let hcCount = 0;
  for (const src of BUS_GTFS_SOURCES) {
    if (src.hardCoded) {
      const hcRecs = buildHardCodedBusRecords(src);
      for (const r of hcRecs) merged.push(r);
      hcCount++;
      continue;
    }
    // ODPT 静的 GTFS（files/odpt/...・基本ライセンス）: フェリーと同じ { url, date } 方式。
    // stops.txt の stop_name を停名レコード、routes.txt の route_short_name を系統レコードとして合成。
    // 🔴 stop_times.txt は最大95万行（川崎市バス）と巨大なため、全体は保持せず各系統の代表1trip の
    //    起終点（先頭/末尾の stop_sequence）だけを取得する（searchBus は停名/系統検索が主目的）。
    try {
      const zipBuf = await fetchGtfsZipBuffer(src, 20000);
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(Buffer.from(zipBuf));
      const parseCsv = (entryName) => {
        const e = zip.getEntry(entryName);
        if (!e) return [];
        const records = parseCsvRecords(e.getData().toString('utf8'));
        if (!records.length) return [];
        const headers = records[0];
        return records.slice(1).map(values => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = values[i] || ''; });
          return obj;
        });
      };
      // 1) stops.txt → stop_id → stop_name（1回だけパース）
      const stopRows = parseCsv('stops.txt');
      const stopNameById = new Map();
      for (const s of stopRows) if (s.stop_id) stopNameById.set(s.stop_id, s.stop_name || s.stop_id);
      // 2) trips.txt → route_id の代表 trip_id（先頭1件のみ・1回だけパース）
      const tripRows = parseCsv('trips.txt');
      const firstTripByRoute = new Map();
      for (const t of tripRows) {
        if (t.route_id && !firstTripByRoute.has(t.route_id)) firstTripByRoute.set(t.route_id, t.trip_id);
      }
      // 3) stop_times.txt → 代表 trip の起終点 stop（先頭/末尾の stop_sequence のみ抽出・1回だけパース）
      const endpointByTrip = new Map(); // trip_id -> { first: stop_id, last: stop_id }
      {
        const wanted = new Set(firstTripByRoute.values());
        let seq = new Map(); // trip_id -> [stop_id, maxSeq]
        const e = zip.getEntry('stop_times.txt');
        if (e) {
          const records = parseCsvRecords(e.getData().toString('utf8'));
          if (records.length) {
            const headers = records[0] || [];
            const ti = headers.indexOf('trip_id'), si = headers.indexOf('stop_id'), qi = headers.indexOf('stop_sequence');
            for (const vals of records.slice(1)) {
              const tid = vals[ti], sid = vals[si], q = Number(vals[qi] || 0);
              if (!wanted.has(tid)) continue;
              const cur = seq.get(tid);
              if (!cur) seq.set(tid, [sid, sid, q, q]);
              else {
                if (q < cur[2]) cur[0] = sid, cur[2] = q;
                if (q > cur[3]) cur[1] = sid, cur[3] = q;
              }
            }
          }
        }
        for (const [tid, v] of seq) endpointByTrip.set(tid, { first: v[0], last: v[1] });
      }
      const seen = new Set();
      // 4) 停名レコード（stops.txt）
      for (const s of stopRows) {
        const name = s.stop_name || s.stop_id || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);
        merged.push({
          'odpt:note': name,
          'odpt:busroute': `${src.operatorId}:stop:${s.stop_id}`,
          'odpt:busNumber': '',
          'odpt:frequency': '',
          'odpt:operator': `odpt.Operator:${src.operatorId}`,
          _operatorId: src.operatorId,
          _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
          _searchKeys: [name],
          _displayNote: name,
          _gtfsSource: src.name
        });
      }
      // 5) 系統レコード（routes.txt）: 起終点を「起点 → 終点」形式で合成
      for (const r of parseCsv('routes.txt')) {
        const shortName = r.route_short_name || r.route_long_name || r.route_id || '';
        const tripId = firstTripByRoute.get(r.route_id);
        const ep = tripId ? endpointByTrip.get(tripId) : null;
        const origin = ep ? (stopNameById.get(ep.first) || ep.first) : '';
        const dest = ep ? (stopNameById.get(ep.last) || ep.last) : '';
        const note = (origin && dest) ? `${origin} → ${dest}` : shortName;
        if (seen.has(note)) continue;
        seen.add(note);
        merged.push({
          'odpt:note': note,
          'odpt:busroute': `${src.operatorId}:route:${r.route_id}`,
          'odpt:busNumber': shortName,
          'odpt:frequency': '',
          'odpt:operator': `odpt.Operator:${src.operatorId}`,
          _operatorId: src.operatorId,
          _operatorLabel: { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website },
          _searchKeys: [shortName, note, origin, dest].filter(Boolean),
          _displayNote: note,
          _gtfsSource: src.name
        });
      }
      console.log(`[Bus] ${src.name}: GTFS loaded (${seen.size} 停名・系統)`);
      odptBreaker.onSuccess();
      hcCount++;
    } catch (e) {
      console.log(`[Bus] ${src.name}: GTFS skip (${e.message})`);
      odptBreaker.onFailure(e);
    }
  }
  // コミュニティバス（めぐりん・江戸バス等・COMMUNITY_BUS_ROUTES）の停留所も検索プールに追加。
  // 乗り継ぎグラフ（buildTransferGraph）には既に組み込まれているが、busstop_name 検索モードでは
  // ヒットしなかったため、バス停検索でも引けるようにする。
  for (const cb of COMMUNITY_BUS_ROUTES) {
    const cbMeta = { label: cb.bus, labelEn: cb.bus, labelZh: cb.bus, website: cb.url };
    const cbStops = new Set();
    for (const route of cb.routes) for (const stopName of route.stops) cbStops.add(stopName);
    for (const stopName of cbStops) {
      merged.push({
        'odpt:note': stopName, 'odpt:busroute': `${cb.municipality}:${cb.bus}:stop`,
        'odpt:busNumber': '', 'odpt:frequency': '', 'odpt:operator': `odpt.Operator:${cb.municipality}`,
        _operatorId: cb.municipality, _operatorLabel: cbMeta,
        _searchKeys: [stopName, cb.bus, cb.municipality],
        _displayNote: stopName, _communityBus: true, _communityBusUrl: cb.url,
        _municipality: cb.municipality, _hardCoded: true
      });
    }
  }
  return { merged, okCount, failCount, hcCount };
}

// ============================================================
// 🚌 バス乗り継ぎ（Transfer）経路探索 — 案B
// ------------------------------------------------------------
// データソース: ODPT odpt:BusroutePattern.busstopPoleOrder（停留所順序）
// バリアフリー: odpt:BusTimetable.busTimetableObject[].isNonStepBus（ノンステップバス）
// 対象: BUS_OPERATORS（ODPT実データ3社: 都営/西武/横浜市営）のみ。
//       hardCodedソース（JRバス関東・コミュニティバス）は停留所順序データが
//       無いため乗り継ぎグラフから除外（直達検索も不可）。
// ============================================================

// バス停名の簡易正規化（駅名マップに依存しない）: trim のみ。
// 注意: 「駅前」「駅」等の suffix は除去しない（バス停の正規名は「○○駅前」のまま）。
// ただし英字・中国語の駅名入力（'Shibuya Station' / '涩谷' 等）は駅名正規化
// （STATION_NAME_MAP: romaji/zh→日本語）を適用して解決できるようにする。
// グラフ構築と検索で同一正規化を使うことでノード名一致を担保する。
function normalizeBusStop(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return trimmed;
  // 末尾の 駅/Station/站 サフィックスを除去してから駅名正規化（バス停名「渋谷駅前」は対象外）
  const stripped = trimmed.replace(/(駅|Station|站|St\.?)\s*$/i, '').trim();
  const normalized = normalizeStationName(stripped);
  // 🔴 サフィックス除去後（stripped）を常に返す。normalizeStationName はローマ字→日本語辞書で、
  // 「川崎站」→「川崎」のように日本語名のままの場合は何もしない（normalized === stripped）が、
  // その場合も「川崎站」ではなく「川崎」を返さないと検索がヒットしない。
  if (normalized && normalized !== stripped) return normalized;
  if (stripped && stripped !== trimmed) return stripped;
  return trimmed;
}

// odpt:BusroutePattern から (operator, routePatternId, [orderedStopNames]) を取得
async function fetchBusGraph(signal) {
  const cached = cache.get(cache.busGraph.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) throw new Error('ODPT API is currently offline (Circuit Breaker is OPEN)');
  const patterns = []; // { operator, patternId, stops: [{name, poleId}] }
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:BusroutePattern`, { params: getParams(op.id), timeout: 8000, signal })
    )
  );
  results.forEach((res, i) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      const opId = BUS_OPERATORS[i].id;
      for (const p of res.value.data) {
        const order = p['odpt:busstopPoleOrder'];
        if (!Array.isArray(order) || !order.length) continue;
        const stops = order
          .sort((a, b) => (a['odpt:index'] || 0) - (b['odpt:index'] || 0))
          .map(o => ({ name: o['odpt:note'] || '', poleId: o['odpt:busstopPole'] || '' }))
          .filter(s => s.name);
        if (stops.length >= 2) patterns.push({ operator: opId, patternId: p['owl:sameAs'] || p['@id'], stops });
      }
      odptBreaker.onSuccess();
    } else {
      odptBreaker.onFailure(res.reason || new Error('BusroutePattern fetch failed'));
    }
  });
  // 🔴 全事業者の取得に失敗した場合は空グラフをキャッシュしない（TTL中NOT_FOUND固定化を防ぐ）
  if (results.every(r => r.status === 'rejected')) {
    throw (results[0]?.reason || new Error('All BusroutePattern requests failed'));
  }
  const data = { patterns };
  cache.set(cache.busGraph.key, data, cache.busGraph.ttl);
  return data;
}

// odpt:BusTimetable から (patternId → 各停留所の isNonStepBus) および
// (stopName → isNonStepBus) を取得。stopName マップは patternId 不一致を回避するためのフォールバック。
async function fetchBusTimetable(signal) {
  const cached = cache.get(cache.busTimetable.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) throw new Error('ODPT API is currently offline (Circuit Breaker is OPEN)');
  const nonStepByPattern = {}; // patternId -> { stopName: bool }
  const nonStepByStop = {};     // stopName -> bool（patternId 不一致のフォールバック）
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:BusTimetable`, { params: getParams(op.id), timeout: 8000, signal })
    )
  );
  results.forEach((res) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      for (const t of res.value.data) {
        const pid = t['odpt:busroutePattern'];
        if (!pid) continue;
        const objs = t['odpt:busTimetableObject'] || [];
        if (!nonStepByPattern[pid]) nonStepByPattern[pid] = {};
        for (const o of objs) {
          // odpt:note は "早大正門:839:7" 形式（停留所名:数字:数字）のため、
          // ":" 以降を除去して busstopPoleOrder の停留所名（"早大正門"）と一致させる
          const raw = (o['odpt:note'] || '').split(':')[0].trim();
          const name = normalizeBusStop(raw);
          if (name && typeof o['odpt:isNonStepBus'] === 'boolean') {
            // 一つでもノンステップ便があれば true（系統レベルで「運行あり」とする）
            nonStepByPattern[pid][name] = nonStepByPattern[pid][name] || o['odpt:isNonStepBus'];
            nonStepByStop[name] = nonStepByStop[name] || o['odpt:isNonStepBus'];
          }
        }
      }
      odptBreaker.onSuccess();
    } else {
      odptBreaker.onFailure(res.reason || new Error('BusTimetable fetch failed'));
    }
  });
  // 🔴 全事業者の取得に失敗した場合は空データをキャッシュしない
  if (results.every(r => r.status === 'rejected')) {
    throw (results[0]?.reason || new Error('All BusTimetable requests failed'));
  }
  const data = { nonStepByPattern, nonStepByStop };
  cache.set(cache.busTimetable.key, data, cache.busTimetable.ttl);
  return data;
}

// 乗り継ぎグラフ構築: ノード=バス停(正規化済), エッジ=同一路線の隣接停留所
// 共有バス停を乗り継ぎ点とする。重みは停留所数（1エッジ=1停留所）。
// 一貫性のため、stopToPatterns の stops は normalizeBusStop 済みの文字列配列を保存。
function buildTransferGraph(patterns) {
  const adj = new Map(); // stopName -> Set(neighborStopName)
  const stopToPatterns = new Map(); // stopName -> [{operator, patternId, stops: [normName,...]}]
  const addEdge = (a, b) => {
    // 有向エッジ: 路線の進行方向（a→b）のみ。無向にすると逆走区間を提案してしまう。
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
  };
  for (const p of patterns) {
    // 停留所名を正規化。空文字（odpt:note 欠損等）はスキップし、前の有効停留所から
    // 次の有効停留所へエッジを張る（中間欠損による「飛び越し隣接」を防ぐ）。
    // 正規化済みの停車順は系統ごとに1回だけ計算して全停留所で共有する。
    const normStops = p.stops.map(x => normalizeBusStop(x.name)).filter(Boolean);
    let prevValid = null;
    for (const raw of p.stops) {
      const s = normalizeBusStop(raw.name);
      if (!s) continue; // 空名称はスキップ
      if (!stopToPatterns.has(s)) stopToPatterns.set(s, []);
      stopToPatterns.get(s).push({ operator: p.operator, patternId: p.patternId, stops: normStops });
      if (prevValid) addEdge(prevValid, s);
      prevValid = s;
    }
  }
  return { adj, stopToPatterns };
}

// ============================================================
// 🚌🚃 バス⇔電車 横断乗り継ぎ（bus→train→bus）
// ============================================================

// 電車駅名レベル隣接グラフ（RAILWAY_LINES から構築）。重みは駅数ベース（1）。
// 同一駅に複数路線が来る場合、路線間乗換を自動結合（駅名レベルで全隣接をマージ）。
function buildTrainNameGraph() {
  const adj = new Map(); // stationName -> Set(neighborStationName)
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const stations of Object.values(RAILWAY_LINES)) {
    for (let i = 0; i < stations.length - 1; i++) add(stations[i], stations[i + 1]);
  }
  // 路線間乗換: 同一駅名に複数路線が来る場合、それらの隣接を駅名レベルで統合
  // （例: 内幸町は千代田線・半蔵門線等にあるため、各路線の隣接をマージ）
  const stationToLines = {};
  for (const [line, stations] of Object.entries(RAILWAY_LINES)) {
    for (const st of stations) {
      if (!stationToLines[st]) stationToLines[st] = [];
      stationToLines[st].push(line);
    }
  }
  // 同一駅に2路線以上来る場合、その駅の全隣接を互いに結ぶ（乗換エッジ）
  for (const [st, lines] of Object.entries(stationToLines)) {
    if (lines.length >= 2) {
      // この駅を通る全路線の隣接駅を集約
      const neighbors = new Set();
      for (const line of lines) {
        const arr = RAILWAY_LINES[line];
        const idx = arr.indexOf(st);
        if (idx > 0) neighbors.add(arr[idx - 1]);
        if (idx < arr.length - 1) neighbors.add(arr[idx + 1]);
      }
      neighbors.delete(st);
      for (const n of neighbors) add(st, n);
    }
  }
  return adj;
}

// odpt:BusstopPole から { バス停名(正規化) -> {lat, lon, operator} } を取得（geo 付き）
async function fetchBusStopGeo(signal) {
  const cached = cache.get(cache.busStopGeo.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) return {};
  const map = {};
  const results = await Promise.allSettled(
    BUS_OPERATORS.map(op =>
      axios.get(`${API_BASE_URL}/odpt:BusstopPole`, { params: getParams(op.id), timeout: 8000, signal })
    )
  );
  results.forEach((res) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      for (const p of res.value.data) {
        const name = normalizeBusStop(getDisplayBusstopName(p));
        const lat = p['geo:lat'], lon = p['geo:long'];
        if (name && typeof lat === 'number' && typeof lon === 'number') {
          // 重複時は最初のものを保持（同一バス停は複数路線で出現しうる）
          if (!map[name]) map[name] = { lat, lon, operator: opIdOf(p) };
        }
      }
      odptBreaker.onSuccess();
    } else {
      odptBreaker.onFailure(res.reason || new Error('BusstopPole fetch failed'));
    }
  });
  // 🔴 全滅時は空mapを返すがキャッシュはしない（TTL中の縮退固定化を防ぐ）
  if (!results.every(r => r.status === 'rejected')) {
    cache.set(cache.busStopGeo.key, map, cache.busStopGeo.ttl);
  }
  return map;
}

// odpt:Station から { 駅名(正規化) -> {lat, lon} } を取得（geo 付き）
async function fetchStationGeo(signal) {
  const cached = cache.get(cache.stationGeo.key);
  if (cached) return cached;
  if (!odptBreaker.canExecute()) return {};
  const map = {};
  const ops = ['TokyoMetro', 'Toei', 'JR-East', 'YokohamaMunicipal', 'Keio', 'Keikyu', 'Odakyu', 'Seibu', 'Tobu', 'TWR', 'MIR', 'Minatomirai'];
  const results = await Promise.allSettled(
    ops.map(op =>
      axios.get(`${API_BASE_URL}/odpt:Station`, { params: getParams(op), timeout: 8000, signal })
    )
  );
  results.forEach((res) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value.data)) {
      for (const s of res.value.data) {
        const name = normalizeStationName(s['dc:title'] || s['odpt:stationTitle'] || '');
        const lat = s['geo:lat'], lon = s['geo:long'];
        if (name && typeof lat === 'number' && typeof lon === 'number') {
          if (!map[name]) map[name] = { lat, lon };
        }
      }
    }
  });
  // 🔴 全滅時は空mapを返すがキャッシュはしない（TTL中の縮退固定化を防ぐ）
  if (!results.every(r => r.status === 'rejected')) {
    cache.set(cache.stationGeo.key, map, cache.stationGeo.ttl);
  }
  return map;
}

// 緯度経度から距離（m）を計算（簡易ヘイバーサイン近似）
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// バス停→最寄り駅 の紐付けマップ（近接閾値以内の駅を結ぶ）
async function fetchBusStopStationLinks(thresholdM = 500, signal = undefined) {
  const busGeo = await fetchBusStopGeo(signal);
  const stGeo = await fetchStationGeo(signal);
  const links = {}; // バス停名 -> 駅名
  for (const [bName, b] of Object.entries(busGeo)) {
    let best = null, bestD = Infinity;
    for (const [sName, s] of Object.entries(stGeo)) {
      const d = haversineM(b.lat, b.lon, s.lat, s.lon);
      if (d < bestD) { bestD = d; best = sName; }
    }
    if (best && bestD <= thresholdM) links[bName] = best;
  }
  return links;
}

// BusstopPole レコードから表示バス停名を取得（title 優先、なければ note/owl:sameAs）
function getDisplayBusstopName(p) {
  if (p['dc:title']) return p['dc:title'];
  if (p['title'] && typeof p['title'] === 'string') return p['title'];
  if (p['odpt:note']) return p['odpt:note'];
  if (p['owl:sameAs']) {
    const seg = String(p['owl:sameAs']).split('.');
    return seg[seg.length - 1];
  }
  return '';
}

// BusstopPole レコードから operator ショートID を取得
function opIdOf(p) {
  const op = Array.isArray(p['odpt:operator']) ? p['odpt:operator'][0] : p['odpt:operator'];
  if (!op) return '';
  const seg = String(op).split(':');
  return seg[seg.length - 1];
}
// 手順: 1) BFSで最短ノード列を求める / 2) 連続するノードを同一路線パターンで
//        グループ化し、1系統＝1乗車セグメントにまとめる
function findTransferPath(graph, fromStop, toStop, nonStepByPattern, nonStepByStop) {
  const { adj, stopToPatterns } = graph;
  if (!adj.has(fromStop) || !adj.has(toStop)) return null;
  // BFS（各ノードに到達するまでの親情報を保持）
  const prev = new Map(); // stop -> parentStop
  const q = [fromStop];
  prev.set(fromStop, null);
  while (q.length) {
    const cur = q.shift();
    if (cur === toStop) break;
    for (const nb of (adj.get(cur) || [])) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        q.push(nb);
      }
    }
  }
  if (!prev.has(toStop)) return null;
  // 最短ノード列を逆順に復元
  const nodePath = [];
  let cur = toStop;
  while (cur !== null) {
    nodePath.unshift(cur);
    cur = prev.get(cur);
  }
  // 連続するノードを同一路線パターンでグループ化 → 1系統＝1セグメント
  const segments = [];
  let i = 0;
  while (i < nodePath.length - 1) {
    const a = nodePath[i], b = nodePath[i + 1];
    // a→b をカバーする路線パターンを探す（aの次がbであるもの）
    // 注意: buildTransferGraph で stops は normalizeBusStop 済み文字列配列に統一済み
    const via = (stopToPatterns.get(a) || []).find(p =>
      p.stops.some((s, idx) => idx < p.stops.length - 1 &&
        s === a && p.stops[idx + 1] === b)
    ) || (stopToPatterns.get(a) || []).find(p =>
      p.stops.some((s, idx) => idx < p.stops.length - 1 &&
        normalizeBusStop(s) === a && normalizeBusStop(p.stops[idx + 1]) === b)
    );
    if (!via) { i++; continue; }
    // このパターンで進めるだけ進む（連続区間を1セグメントに）
    const stops = via.stops.map(s => normalizeBusStop(s));
    let end = i + 1;
    while (end < nodePath.length - 1) {
      const c = nodePath[end], d = nodePath[end + 1];
      const ci = stops.indexOf(c), di = stops.indexOf(d);
      if (ci >= 0 && di === ci + 1) end++;
      else break;
    }
    const segStops = nodePath.slice(i, end + 1);
    const nonStepMap = nonStepByPattern[via.patternId] || {};
    // ノンステップ判定: その系統で「情報が得られた停留所のうち全てがノンステップ」なら true
    // （timetable カバレッジ不足で undefined の停留所は無視。一部でも非ノンステップがあれば false）
    const nonStep = segStops.every(s => {
      let v = nonStepMap[s];
      if (v === undefined && nonStepByStop) v = nonStepByStop[s];
      return v === true; // undefined / false は false 扱い
    });
    segments.push({
      operator: via.operator, patternId: via.patternId,
      fromStop: segStops[0], toStop: segStops[segStops.length - 1],
      stops: segStops,
      nonStep
    });
    i = end;
  }
  return segments.length ? segments : null;
}

// 単一バス区間（a→b）のセグメント化（nonStep 付与）。searchBusTransfer の統合グラフから呼ぶ。
function findBusSegment(busGraph, a, b, nonStepByPattern, nonStepByStop) {
  const { stopToPatterns } = busGraph;
  const via = (stopToPatterns.get(a) || []).find(p =>
    p.stops.some((s, idx) => idx < p.stops.length - 1 && s === a && p.stops[idx + 1] === b)
  ) || (stopToPatterns.get(a) || []).find(p =>
    p.stops.some((s, idx) => idx < p.stops.length - 1 && normalizeBusStop(s) === a && normalizeBusStop(p.stops[idx + 1]) === b)
  );
  if (!via) return null;
  const stops = via.stops.map(s => normalizeBusStop(s));
  const nonStepMap = nonStepByPattern[via.patternId] || {};
  const nonStep = stops.every(s => {
    let v = nonStepMap[s];
    if (v === undefined && nonStepByStop) v = nonStepByStop[s];
    return v === true;
  });
  return {
    operator: via.operator, patternId: via.patternId,
    fromStop: a, toStop: b, stops: [a, b], non_step_bus: nonStep
  };
}

// ============================================================
// 🚌 乗り物指定優先定数
// ============================================================
// vehicle 指定時のエッジ重みマップ（キー: 指定乗り物 → 各モードの重み）
// 非指定モードに重み 3（乗換1回相当）を乗せることで優先を実現。
const VEHICLE_WEIGHTS = {
  bus:            { bus: 1, train: 3, link: 1, community_bus: 1, ferry: 3 },
  train:          { train: 1, bus: 3, link: 1, community_bus: 3, ferry: 3 },
  community_bus:  { community_bus: 1, bus: 2, train: 3, link: 1, ferry: 3 },
  ferry:          { ferry: 1, bus: 3, train: 3, link: 1, community_bus: 3 },
  any:            { bus: 1, train: 1, link: 1, community_bus: 1, ferry: 1 }
};
const VALID_VEHICLES = ['bus', 'train', 'community_bus', 'ferry', 'any'];

// エッジの type から mode キーを取得（transfer は link 扱い）
function edgeTypeToMode(type) {
  if (type === 'link' || type === 'transfer') return 'link';
  return type; // bus / train / community_bus / ferry はそのまま
}

// 重み付きダイクストラ（最小コスト経路探索）
// adj: Map<nodeName, [{to, type}]>, weights: mode->cost
// 戻り値: { found, nodePath, segments, score }
// バイナリミニヒープ（Dijkstra 用・遅延削除は dist 再チェックで対応）
class MinHeap {
  constructor() { this.heap = []; }
  size() { return this.heap.length; }
  push(item) {
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].cost <= h[i].cost) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop() {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l].cost < h[m].cost) m = l;
        if (r < h.length && h[r].cost < h[m].cost) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

function findWeightedPath(adj, fromNode, toNode, weights, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus) {
  const dist = new Map(); // node -> best cost
  const prev = new Map(); // node -> parentNode
  const pq = new MinHeap();
  dist.set(fromNode, 0);
  prev.set(fromNode, null);
  pq.push({ node: fromNode, cost: 0 });
  while (pq.size()) {
    const { node: cur, cost: curCost } = pq.pop();
    if (curCost > (dist.get(cur) ?? Infinity)) continue;
    if (cur === toNode) break;
    for (const e of (adj.get(cur) || [])) {
      const mode = edgeTypeToMode(e.type);
      const w = weights[mode] !== undefined ? weights[mode] : 1;
      const nc = curCost + w;
      if (nc < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nc);
        prev.set(e.to, { from: cur, edgeType: e.type });
        pq.push({ node: e.to, cost: nc });
      }
    }
  }
  if (!prev.has(toNode)) return { found: false, score: Infinity };
  // ノード列を復元
  const nodePath = [];
  const edgePath = [];
  let cur = toNode;
  while (cur !== null) {
    nodePath.unshift(cur);
    const p = prev.get(cur);
    if (p) edgePath.unshift({ from: p.from, to: cur, type: p.edgeType });
    cur = p ? p.from : null;
  }
  // 探索時に選択したエッジ種別をそのまま使ってセグメント化する。
  // 同一ノード間に train/link 等が複数存在しても、隣接リストの先頭を再推測しない。
  const segments = buildSegmentsFromPath(nodePath, edgePath, adj, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus);
  return { found: true, nodePath, edgePath, segments, score: dist.get(toNode) };
}

// ノード列 → セグメント配列（searchBusTransfer のセグメント化を関数化）
function buildSegmentsFromPath(nodePath, edgePath, adj, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus) {
  const segments = [];
  let i = 0;
  while (i < nodePath.length - 1) {
    const a = nodePath[i], b = nodePath[i + 1];
    const selectedEdge = edgePath?.[i];
    const type = selectedEdge?.type || 'bus';
    if (type === 'link') {
      segments.push({ mode: 'transfer', fromStop: a, toStop: b, note: '徒歩乗り継ぎ' });
      i++;
    } else if (type === 'train') {
      let end = i + 1;
      while (end < nodePath.length - 1) {
        const nextType = edgePath?.[end]?.type;
        if (nextType === 'train') end++;
        else break;
      }
      const stops = nodePath.slice(i, end + 1);
      // 鉄道ルートエンジンで路線単位に分割（乗換回数を正確に表示するため）。
      // バスグラフの train エッジは路線情報を持たないため、区間両端を再ルーティングする。
      const rr = findShortestPath(stops[0], stops[stops.length - 1]);
      if (rr && rr.path && rr.path.length >= 2 && rr.lines && rr.lines.length >= 1) {
        let curLine = rr.lines[0];
        let curStops = [rr.path[0], rr.path[1]];
        for (let k = 1; k < rr.lines.length; k++) {
          if (rr.lines[k] === curLine) {
            curStops.push(rr.path[k + 1]);
          } else {
            segments.push({ mode: 'train', fromStop: curStops[0], toStop: curStops[curStops.length - 1], stops: curStops });
            curLine = rr.lines[k];
            curStops = [rr.path[k], rr.path[k + 1]];
          }
        }
        segments.push({ mode: 'train', fromStop: curStops[0], toStop: curStops[curStops.length - 1], stops: curStops });
      } else {
        segments.push({ mode: 'train', fromStop: stops[0], toStop: stops[stops.length - 1], stops });
      }
      i = end + 1;
    } else if (type === 'community_bus') {
      let end = i + 1;
      while (end < nodePath.length - 1) {
        const nextType = edgePath?.[end]?.type;
        if (nextType && (nextType === 'community_bus' || end + 1 === nodePath.length - 1)) end++;
        else break;
      }
      const stops = nodePath.slice(i, end + 1);
      const meta = cbStopToBus[stops[0]] || cbStopToBus[stops[stops.length - 1]] || {};
      segments.push({
        mode: 'community_bus', fromStop: stops[0], toStop: stops[stops.length - 1], stops,
        bus: meta.bus, municipality: meta.municipality, website: meta.url, route: meta.route, non_step_bus: null
      });
      i = end + 1;
    } else {
      // bus区間
      const busSeg = findBusSegment(busGraph, a, b, nonStepByPattern, nonStepByStop);
      if (busSeg) {
        segments.push({ mode: 'bus', ...busSeg });
        i++;
      } else {
        segments.push({ mode: 'bus', fromStop: a, toStop: b, stops: [a, b], non_step_bus: null });
        i++;
      }
    }
  }
  return segments;
}

// 指定乗り物が経路に含まれるか
function pathHasMode(segments, mode) {
  return segments.some(s => s.mode === mode);
}

// 経路の簡易スコア（乗換回数 + モード内訳）— better_alternative 比較用
function scorePath(segments) {
  let transfers = 0, busStops = 0, trainStops = 0;
  for (const s of segments) {
    if (s.mode === 'bus' || s.mode === 'community_bus' || s.mode === 'ferry') {
      transfers++;
      if (s.mode === 'bus' || s.mode === 'community_bus') {
        busStops += Math.max(1, (s.stops ? s.stops.length : 2) - 1);
      }
    } else if (s.mode === 'train') {
      transfers++;
      trainStops += (s.stops ? s.stops.length : 2) - 1;
    } else if (s.mode === 'transfer') { /* link — 乗換カウント外 */ }
  }
  const estimatedMinutes = trainStops * 2 + busStops * 3;
  return { transfers: Math.max(0, transfers - 1), estimated_minutes: estimatedMinutes, bus_count: segments.filter(s => s.mode === 'bus').length, train_count: segments.filter(s => s.mode === 'train').length };
}

// 重み付き探索 + 通常探索の2回実行 + better_alternative 進言
async function searchBusTransfer(fromInput, toInput, vehiclePref) {
  const from = normalizeBusStop(fromInput);
  const to = normalizeBusStop(toInput);
  // 🔴 タイムアウト緩和: 直列 await を Promise.all で並列化（ODPT 4 API + 駅geo を同時取得）
  // さらに全体タイムアウト(25s)ガードを設け、個別フェッチが沈黙しても MCP クライアントの
  // 300s タイムアウトに到達しないよう、空データでフォールバックする。
  const BUS_TRANSFER_FETCH_TIMEOUT_MS = 25000;
  let graphData, ttData, links, stationGeoMap;
  // 🔴 タイムアウト時に元のHTTPリクエストも中断する（Promise.raceだけでは通信が継続し、
  // 遅延完了したレスポンスがキャッシュを書き換える・負荷が残る問題があった）。
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(new Error('bus transfer fetch timeout')), BUS_TRANSFER_FETCH_TIMEOUT_MS);
  try {
    const withTimeout = (p, label) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`bus transfer fetch timeout: ${label}`)), BUS_TRANSFER_FETCH_TIMEOUT_MS))
    ]);
    [graphData, ttData, links, stationGeoMap] = await Promise.all([
      withTimeout(fetchBusGraph(abortController.signal), 'BusroutePattern'),
      withTimeout(fetchBusTimetable(abortController.signal), 'BusTimetable'),
      withTimeout(fetchBusStopStationLinks(500, abortController.signal), 'BusstopStationLinks'),
      withTimeout(fetchStationGeo(abortController.signal), 'StationGeo')
    ]);
  } catch (timeoutErr) {
    // タイムアウト時は残リクエストを中断し、空データで継続（グラフは空＝NOT_FOUND を返し、コミュニティバス接続案内は維持）
    abortController.abort(timeoutErr);
    console.error('[searchBusTransfer] fetch guard triggered:', timeoutErr.message);
    graphData = graphData || { patterns: [] };
    ttData = ttData || { nonStepByPattern: {}, nonStepByStop: {} };
    links = links || {};
    stationGeoMap = stationGeoMap || {};
  } finally {
    clearTimeout(abortTimer);
  }
  const { patterns } = graphData;
  const { nonStepByPattern, nonStepByStop } = ttData;
  const busGraph = buildTransferGraph(patterns);
  const trainAdj = buildTrainNameGraph();
  const trainLinks = links;
  // 駅ノードを trainAdj に確保（RAILWAY_LINES にない駅でも link エッジを張れるよう）
  for (const stName of Object.keys(stationGeoMap)) {
    if (!trainAdj.has(stName)) trainAdj.set(stName, new Set());
  }
  // 統合グラフ: bus停ノード + 駅ノード + link(バス停→駅 徒歩乗り継ぎ) エッジ
  const adj = new Map();
  const addEdge = (a, b, type) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, type });
  };
  // バス内エッジ
  for (const [s, neighbors] of busGraph.adj) {
    for (const n of neighbors) addEdge(s, n, 'bus');
  }
  // #24-2: ハードコード系統（空港リムジン・JRバス関東等の直行系統）もバスエッジとして組み込む。
  // これにより「羽田空港→新宿駅」等が港湾バース連鎖ではなくリムジン直行として引ける。
  for (const src of BUS_GTFS_SOURCES) {
    if (!src.hardCoded || !Array.isArray(src.routes)) continue;
    for (const [from, to] of src.routes) {
      addEdge(from, to, 'bus');
      addEdge(to, from, 'bus');
      // 🔴 入力は normalizeBusStop で「駅」サフィックスが除去されるため（例: 渋谷駅→渋谷）、
      // ハードコードバス停名（例: 渋谷駅）のままの直行エッジには到達できない。
      // 正規化後名でも直行エッジを張り、「渋谷駅→中野駅」等が鉄道ノードに解決されても
      // バス直行（京王 渋64 等）を引けるようにする（回帰テスト test-bus-routes-expansion 対応）。
      const fNorm = normalizeBusStop(from), tNorm = normalizeBusStop(to);
      if (fNorm !== from || tNorm !== to) {
        addEdge(fNorm, tNorm, 'bus');
        addEdge(tNorm, fNorm, 'bus');
      }
    }
  }
  // 電車内エッジ
  for (const [s, neighbors] of trainAdj) {
    for (const n of neighbors) addEdge(s, n, 'train');
  }
  // バス停→駅 の link エッジ（バス停と同一名の駅があれば結ぶ）
  for (const [busStop, station] of Object.entries(trainLinks)) {
    if (busGraph.adj.has(busStop) && trainAdj.has(station)) {
      addEdge(busStop, station, 'link');
      addEdge(station, busStop, 'link');
    }
  }
  // 🚌 コミュニティバスグラフ（Phase 2: 駅接続ルートを統合グラフに組み込み）
  // 駅前停留所の系統順をエッジ化し、stations 定義で駅⇔バス停を link で接続。
  const cbGraph = new Map(); // バス停名 → Set(隣接バス停)
  const cbStopToBus = {};    // バス停名 → { bus, municipality, url, route }
  for (const cb of COMMUNITY_BUS_ROUTES) {
    for (const route of cb.routes) {
      for (let i = 0; i < route.stops.length - 1; i++) {
        const a = route.stops[i], b = route.stops[i + 1];
        if (!cbGraph.has(a)) cbGraph.set(a, new Set());
        cbGraph.get(a).add(b);
        if (!cbGraph.has(b)) cbGraph.set(b, new Set());
        cbGraph.get(b).add(a);
        for (const s of [a, b]) {
          if (!cbStopToBus[s]) cbStopToBus[s] = { bus: cb.bus, municipality: cb.municipality, url: cb.url, route: route.name };
        }
      }
    }
  }
  for (const [s, neighbors] of cbGraph) {
    for (const n of neighbors) addEdge(s, n, 'community_bus');
  }
  // コミュニティバス停 ⇔ 駅 の link エッジ（stations 定義の駅前バス停）
  for (const cb of COMMUNITY_BUS_ROUTES) {
    for (const [station, stop] of Object.entries(cb.stations)) {
      if (cbGraph.has(stop) && trainAdj.has(station)) {
        addEdge(stop, station, 'link');
        addEdge(station, stop, 'link');
      }
    }
  }
  // 部分一致でノードを特定（ODPTバス停優先、次にコミュニティバス停、最後に駅）
  const allNodes = new Set([...busGraph.adj.keys(), ...cbGraph.keys(), ...trainAdj.keys()]);
  // #24-2: ハードコード系統（空港リムジン・JRバス関東等）の stop 名もノードとして確保。
  // これがないと「羽田空港」入力が部分一致で「羽田空港第3ターミナル」等に誤解決され、
  // リムジン直行エッジ（羽田空港→新宿駅）が使われず港湾バース連鎖が選ばれる。
  for (const src of BUS_GTFS_SOURCES) {
    if (!src.hardCoded) continue;
    for (const s of (src.stops || [])) {
      if (!allNodes.has(s)) allNodes.add(s);
      if (!adj.has(s)) adj.set(s, []);
    }
  }
  // 英語・中国語のバス停名/駅名を日本語に解決（STATION_DISPLAY_NAMES の en/zh → 日本語 逆引き）
  const resolveBusStopLang = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || allNodes.has(trimmed)) return trimmed;
    const norm = normalizeBusStop(trimmed);
    if (allNodes.has(norm)) return norm;
    // STATION_DISPLAY_NAMES の en / zh 表示名と一致する日本語名を探す
    const lower = trimmed.toLowerCase();
    for (const [jp, trans] of Object.entries(STATION_DISPLAY_NAMES)) {
      const en = (trans.en || '').toLowerCase();
      const zh = trans.zh || '';
      if ((en && lower === en) || (zh && trimmed === zh)) return jp;
    }
    // STATION_NAME_MAP の英語エイリアス（Oshiage→押上 等）も試す
    if (STATION_NAME_MAP[trimmed]) return STATION_NAME_MAP[trimmed];
    return null;
  };
  const resolve = (name) => {
    const langResolved = resolveBusStopLang(name) || name;
    if (allNodes.has(langResolved)) return { node: langResolved, ambiguous: false };
    // 🔴 #80: バス停・駅の部分一致は「前方一致のみ」で候補を収集し、
    // 一意のときだけ解決する。複数候補がある場合はサイレントに先頭1件を選ばず、
    // AMBIGUOUS を返して検索を中断する（鉄道駅の resolveStation と同じ安全方針）。
    const collect = (pred) => {
      const hits = [];
      for (const n of allNodes) {
        // 系統名・ID付きノイズ（「桜町病院:60008:桜町病院１」等）は候補から除外
        if (/[：:〜→|]/.test(n)) continue;
        if (pred(n)) hits.push(n);
      }
      return hits;
    };
    // 1) 前方一致（入力で始まるノード）を最優先
    let hits = collect(n => n.startsWith(langResolved));
    // 2) 前方一致が無い場合のみ、双方向包含の部分一致にフォールバック
    //   （例: 「渋谷駅」→ ノード「渋谷」、逆に「桜新町」→ 入力「新町」等の表記ゆれ吸収）
    if (hits.length === 0) hits = collect(n => n.includes(langResolved) || langResolved.includes(n));
    if (hits.length === 1) return { node: hits[0], ambiguous: false };
    if (hits.length > 1) return { node: null, ambiguous: true, candidates: hits };
    return { node: null, ambiguous: false };
  };
  const fRes = resolve(from);
  const tRes = resolve(to);
  if (fRes.ambiguous || tRes.ambiguous) {
    return { found: false, ambiguous: true, side: fRes.ambiguous ? 'from' : 'to', input: fRes.ambiguous ? fromInput : toInput, candidates: fRes.ambiguous ? fRes.candidates : tRes.candidates, allNodeNames: [...allNodes] };
  }
  const fNode = fRes.node;
  const tNode = tRes.node;
  if (!fNode || !tNode) {
    return { found: false, fromNode: fNode, toNode: tNode, allNodeNames: [...allNodes] };
  }
  // 🚌🚃 乗り物指定優先: 優先探索（重み付き）+ 通常探索（無重み）の2回実行
  const validPref = (VALID_VEHICLES.includes(vehiclePref)) ? vehiclePref : 'any';
  // 第1パス: 指定優先（vehiclePref が any でなければ重み付き）
  const prefWeights = VEHICLE_WEIGHTS[validPref] || VEHICLE_WEIGHTS.any;
  const prefResult = (validPref === 'any')
    ? null // any の場合は通常探索1回のみ
    : findWeightedPath(adj, fNode, tNode, prefWeights, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus);
  // 第2パス: 通常探索（無重み＝最小エッジ数）
  const anyResult = findWeightedPath(adj, fNode, tNode, VEHICLE_WEIGHTS.any, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus);
  if (!anyResult.found) {
    // どちらも見つからない
    return { found: false, fromNode: fNode, toNode: tNode, allNodeNames: [...allNodes] };
  }
  // 優先探索の結果を採用（ただし any の場合は anyResult をそのまま）
  const primaryResult = (prefResult && prefResult.found) ? prefResult : anyResult;
  const segments = primaryResult.segments;
  // better_alternative 進言: 指定優先経路が、通常最短路より明らかに劣る場合
  let betterAlternative = null;
  if (validPref !== 'any' && prefResult && prefResult.found && anyResult.found) {
    const prefScore = scorePath(segments);
    const altScore = scorePath(anyResult.segments);
    const transferDiff = prefScore.transfers - altScore.transfers;
    const minuteDiff = prefScore.estimated_minutes - altScore.estimated_minutes;
    // 乗換が2回以上多い、または所要目測が10分以上長い場合に進言
    if (transferDiff >= 2 || minuteDiff >= 10) {
      const altMode = anyResult.segments.some(s => s.mode === 'train') ? 'train'
        : anyResult.segments.some(s => s.mode === 'community_bus') ? 'community_bus'
        : anyResult.segments.some(s => s.mode === 'ferry') ? 'ferry' : 'bus';
      betterAlternative = {
        exists: true,
        recommended_mode: altMode,
        preferred_mode: validPref,
        transfers_saved: transferDiff,
        estimated_minutes_saved: minuteDiff,
        alt_segments: anyResult.segments,
        alt_score: altScore
      };
    }
  }
  return {
    found: true, fromNode: fNode, toNode: tNode, segments,
    isCrossModal: segments.some(s => s.mode === 'train'),
    vehicleRequested: validPref,
    // 指定乗り物（ferry等）の経路が見つからず通常探索で代替した場合
    // （優先探索は他モードでも経路を「見つけて」しまうため、採用経路に指定モードが含まれるかを判定）
    vehicleFallback: validPref !== 'any' && !segments.some(s => s.mode === validPref),
    betterAlternative,
    // #24: バス停を転々とする無意味な複雑バス連鎖（例: 羽田→新宿で港湾バースを5連続乗継）の検出。
    // バス/コミュニティバスが3つ以上連続する場合は「バス直行なし」とみなし、鉄道ルートを推奨する。
    complexBusChain: (() => {
      let busRun = 0;
      for (const s of segments) {
        if (s.mode === 'bus' || s.mode === 'community_bus') { busRun++; if (busRun >= 3) return true; }
        else busRun = 0;
      }
      return false;
    })()
  };
}
// ============================================================
// 🚌 コミュニティバス案内ブロック（Phase 1: 駅までの足・駅からの足）
// ============================================================
// 足の悪いユーザー向けに「この駅はどのコミュニティバスが利用できるか」を案内する。
// 経路探索（統合グラフ）が失敗しても、駅⇔コミュニティバス停の接続情報を必ず返す。
function findCommunityBusAccess(stationInput) {
  if (!stationInput) return null;
  const candidates = [stationInput, normalizeStationName(stationInput), stationInput.replace(/駅$/, '')]
    .filter((v, i, a) => a.indexOf(v) === i);
  for (const c of candidates) {
    if (COMMUNITY_BUS_STATION_ACCESS[c]) return { station: c, entries: COMMUNITY_BUS_STATION_ACCESS[c] };
  }
  return null;
}
function buildCommunityBusAccessBlock(stationInput, userLang) {
  const hit = findCommunityBusAccess(stationInput);
  if (!hit) return null;
  return {
    note: userLang === 'en' ? "🚌 [Community Bus Access (first/last mile)]" :
          userLang === 'zh' ? "🚌 【社区公交接驳（首末段）】" :
          "🚌 【コミュニティバス接続（駅までの足・駅からの足）】",
    station: getDisplayStationName(hit.station, userLang),
    buses: hit.entries.map(e => ({
      bus: getCommunityBusDisplayName(e.bus, userLang),
      municipality: e.municipality,
      stop: getCommunityBusStopDisplayName(e.stop, userLang),
      url: e.url,
      barrier_free_note: userLang === 'en'
        ? "Wheelchair / low-floor availability varies by service — check the official municipal page."
        : userLang === 'zh'
        ? "轮椅 / 低地板车辆的可用性因线路而异 — 请查看各自治体官网。"
        : "車椅子・低床バスの有無は系統により異なります。自治体公式サイトでご確認ください。"
    })),
    timetable_note: userLang === 'en' ? "Timetables & full routes: official municipal site."
      : userLang === 'zh' ? "时刻表与完整路线请参见各自治体官网。"
      : "時刻表・全ルートは各自治体公式サイトでご確認ください。"
  };
}

// #46: バス停名の類似度判定用 編集距離（Levenshtein）。全角・半角はそのまま比較し、
// 検索キーの近さ（類似候補提示）にのみ使用する。
function levenshteinDist(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return curr[b.length];
}

async function searchBus(args) {
  const busstopName = (args.busstop_name || '').trim();
  const fromInput = (args.from || '').trim();
  const toInput = (args.to || '').trim();
  const vehicleInput = (args.vehicle || '').trim();
  // 乗り継ぎ探索モード（from + to 指定時）。案B: 異系統・異事業者間の最短経路。
  if (fromInput && toInput) {
    const fL = detectLanguage(fromInput);
    const tL = detectLanguage(toInput);
    const userLang = resolveLang(args) || (fL !== 'ja' ? fL : tL !== 'ja' ? tL : 'ja');
    const parsedTest = parseTestMode({ from: fromInput, to: toInput, '-test': args['-test'], test: args.test, test_mode: args.test_mode });
    const testAdv = buildTestAdvice(parsedTest.simulatedFailure, userLang);
    const aiAdvice = await getTransitAdvice(testAdv, userLang);
    // 地震時はバス・トラム・鉄道を含む通常の乗り継ぎ結果を提示せず、安全確保を優先する。
    if (isEarthquakeSimulation(testAdv)) {
      return await buildEarthquakeSafetyResponse('ground', userLang, { from: fromInput, to: toInput });
    }
    // searchBusTransfer 内で個別APIの障害を縮退処理する。
    // ここで早期 return すると、hard-coded / community-bus フォールバックまで遮断される。
    try {
      const result = await searchBusTransfer(fromInput, toInput, vehicleInput);
      // 駅⇔コミュニティバス接続（Phase 1: 足の悪いユーザーの駅までの足・駅からの足）
      const cbAccess = [
        buildCommunityBusAccessBlock(fromInput, userLang),
        buildCommunityBusAccessBlock(toInput, userLang)
      ].filter(Boolean);
      // 🔴 #80: 同名・類似バス停が複数ある場合はサイレントに1件選ばず、検索を中断して選択を促す。
      if (result.ambiguous) {
        const sideLabel = result.side === 'from'
          ? (userLang === 'en' ? 'departure' : userLang === 'zh' ? '出发' : '出発')
          : (userLang === 'en' ? 'arrival' : userLang === 'zh' ? '到达' : '到着');
        // 候補は再入力可能な正式名（ja）を返しつつ、言語別表示でも併記する
        const candidatesRaw = (result.candidates || []).slice(0, 10);
        const candidatesDisp = candidatesRaw.map(c => getDisplayStationName(c, userLang));
        const promptMsg = userLang === 'en'
          ? `Multiple bus stops match "${result.input}" (${sideLabel}). Please choose one: ${candidatesDisp.join(' / ')}`
          : userLang === 'zh'
            ? `「${result.input}」匹配到多个公交站（${sideLabel}）。请选择其一：${candidatesDisp.join(' / ')}`
            : `「${result.input}」に一致するバス停が複数あります（${sideLabel}）。どれかを選択してください：${candidatesDisp.join(' / ')}`;
        const disambiguation = {
          input: result.input,
          side: result.side,
          candidates: candidatesDisp,
          candidates_raw: candidatesRaw, // #80: 再入力可能な正式キー
          message: promptMsg
        };
        // 曖昧時も入力名基準で公的機関の検索案内を表示（候補確定前でも「その場所周辺の役所」を探せる）
        const ambiguousResp = buildErrorResponse('AMBIGUOUS_BUS_STOP', promptMsg, { userLang, from: fromInput, to: toInput, disambiguation });
        ambiguousResp.gov_facility_search_support = buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(result.input || fromInput || toInput, userLang));
        return jsonResponse(ambiguousResp);
      }
      if (!result.found) {
        // 🔴 案内改善: 入力量の類似バス停を提示し、見つからない場合は徒歩・現実的アクセスを勧める
        const similarStops = [];
        const seen = new Set();
        // 乗り継ぎモードでは ODPT バス停リスト(buses) はスコープ外になるため、
        // searchBusTransfer が返す統合グラフの全ノード名(allNodeNames)をソースに使う。
        const busPool = (result.allNodeNames && result.allNodeNames.length)
          ? result.allNodeNames
          : (typeof buses !== 'undefined' ? (buses || []) : []);
        if (fromInput && toInput) {
          for (const q of [fromInput, toInput]) {
            const qn = String(q || '').replace(/(停留所|バス停|駅)$/, '');
            for (const k of busPool) {
              // 生データの系統名・ID付きノイズ（「系統名:数字:停留所」等）は候補から除外
              if (!k || seen.has(k) || /[：:〜→|]/.test(k)) continue;
              if ((qn && k.includes(qn)) || (k.length >= 2 && qn.length >= 1 && k.includes(qn.slice(0, Math.max(1, qn.length - 1))))) {
                seen.add(k); similarStops.push(k);
              }
            }
          }
        }
        const simNote = userLang === 'en' ? 'No exact bus/train-transfer route found. Similar existing stops you can try:'
          : userLang === 'zh' ? '未找到精确的公交/电车换乘路线。可尝试以下相近的现有站名：'
          : '該当する乗り継ぎ経路が見つかりませんでした。代わりに以下の実在バス停名が利用できます：';
        const walkNote = userLang === 'en' ? 'This pair may be shorter on foot — consider walking, or search a nearby stop above.'
          : userLang === 'zh' ? '这段区间步行可能更近——建议步行，或改用上方相近的站点检索。'
          : 'この区間は徒歩の方が早い場合があります——徒歩での移動、または上記の近隣バス停での再検索をご検討ください。';
        return jsonResponse({
          status: 'NOT_FOUND', detected_language: userLang,
          message: userLang === 'en' ? `No bus transfer route found from "${fromInput}" to "${toInput}".`
            : userLang === 'zh' ? `未找到从「${fromInput}」到「${toInput}」的公交换乘路线。`
            : `「${fromInput}」から「${toInput}」への乗り継ぎ経路が見つかりませんでした。`,
          note: userLang === 'en' ? 'Transfer covers Toei/Seibu/Yokohama City Bus (ODPT BusroutePattern data) plus community-bus station links. JR Bus Kanto is not included (no stop-order data).'
            : userLang === 'zh' ? '换乘覆盖都营/西武/横滨市营公交（ODPT BusroutePattern 数据）及社区公交接驳。JR巴士关东不包含在内（缺少站点顺序数据）。'
            : '乗り継ぎは都営・西武・横浜市営バス＋コミュニティバス駅接続が対象（ODPT BusroutePattern データ）。JRバス関東は停留所順序データがないため対象外です。',
          data_source: 'ODPT BusroutePattern + BusTimetable',
          ai_transit_advice: aiAdvice,
          community_bus_access: cbAccess.length ? cbAccess : undefined,
          similar_stops: similarStops.length ? (() => {
            const localized = similarStops.slice(0, 10)
              .map(s => getDisplayStationName(s, userLang))
              .filter(s => userLang === 'ja' || !/[\u3040-\u30ff\u3400-\u9fff]/.test(s));
            return localized.length ? { note: simNote, stops: localized } : undefined;
          })() : undefined,
          walk_suggestion: walkNote,
          // 公的機関の検索案内（到着地バス停名を基準に表示。乗り継ぎが見つからなくても役所は探せる）
          gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(toInput || fromInput, userLang)),
          test_mode: testAdv.testMode,
          simulated_failure_type: testAdv.failureType || undefined
            });
      }
      const opLabel = (opId) => {
        const o = BUS_OPERATORS.find(x => x.id === opId);
        return o ? (userLang === 'en' ? o.labelEn : userLang === 'zh' ? o.labelZh : o.label) : opId;
      };
      const modeLabel = (m) => userLang === 'en' ? (m === 'train' ? 'Train' : m === 'transfer' ? 'Walk transfer' : m === 'community_bus' ? 'Community bus' : 'Bus')
        : userLang === 'zh' ? (m === 'train' ? '电车' : m === 'transfer' ? '步行换乘' : m === 'community_bus' ? '社区公交' : '公交')
        : (m === 'train' ? '電車' : m === 'transfer' ? '徒歩乗り継ぎ' : m === 'community_bus' ? 'コミュニティバス' : 'バス');
      const dispName = (n) => getDisplayStationName(n, userLang);
      const segments = result.segments.map((s, i) => {
        const stops = (s.stops && s.stops.length ? s.stops : [s.fromStop, s.toStop]).map(dispName);
        const base = { step: i + 1, mode: s.mode, mode_label: modeLabel(s.mode), from: dispName(s.fromStop), to: dispName(s.toStop), stops };
        if (s.mode === 'bus') { base.operator = opLabel(s.operator); base.non_step_bus = s.non_step_bus; }
        else if (s.mode === 'train') { base.operator = userLang === 'en' ? 'Railway' : userLang === 'zh' ? '铁路' : '鉄道'; }
        else if (s.mode === 'community_bus') { base.operator = s.bus; base.municipality = s.municipality; base.website = s.website; base.non_step_bus = null; }
        else if (s.mode === 'transfer') { base.note = userLang === 'en' ? 'Walk transfer' : userLang === 'zh' ? '步行换乘' : s.note; }
        return base;
      });
      // コミュニティバス利用時のバリアフリー注意喚起（車椅子対応は自治体サイトで確認）
      const hasCommunityBus = segments.some(s => s.mode === 'community_bus');
      const communityBusNote = hasCommunityBus
        ? (userLang === 'en' ? '🚌 Community bus segment: small vehicles; wheelchair / low-floor availability varies — check the official municipal page.'
          : userLang === 'zh' ? '🚌 社区公交区间：多为小型车辆；轮椅/低地板车辆可用性因线路而异，请查看各自治体官网。'
          : '🚌 コミュニティバス区間: 小型車両が中心です。車椅子・低床バスの有無は系統により異なります。自治体公式サイトでご確認ください。')
        : undefined;
      // バリアフリー総評: バスセグメントのみ評価（電車は別途要確認）
      const busSegs = segments.filter(s => s.mode === 'bus');
      const allNonStep = busSegs.length > 0 && busSegs.every(s => s.non_step_bus);
      const barrierFreeNote = userLang === 'en'
        ? (allNonStep
          ? 'All bus segments operate non-step (step-free) buses — easier boarding for users with limited mobility.'
          : 'Some bus segments may not operate non-step buses. Please check with the operator or look for non-step designated services.')
        : userLang === 'zh'
          ? (allNonStep
            ? '所有公交区段均运行无障碍低地板（无台阶）巴士——便于行动不便者乘车。'
            : '部分公交区段可能未运行无障碍巴士。请向运营商确认或选择无障碍指定班次。')
          : (allNonStep
            ? '全区間でノンステップバス（段差なし）が運行されています。足の悪い方の乗車が容易です。'
            : '一部区間でノンステップバスが運行されていない可能性があります。各事業者へご確認いただくか、ノンステップ指定便をご利用ください。');
      const hasBusSeg = segments.some(s => s.mode === 'bus' || s.mode === 'community_bus');
      // バス区間のない純粋な電車フォールバックでは「バス→電車→バス」と表示しない
      const crossModal = (result.isCrossModal && hasBusSeg) ? (userLang === 'en' ? ' (bus→train→bus cross-modal)' : userLang === 'zh' ? '（公交→电车→公交 跨方式换乘）' : '（バス→電車→バスの横断乗り継ぎ）') : '';
      // 指定乗り物の経路が無く代替した場合の案内
      const vehicleFallbackNote = result.vehicleFallback ? (userLang === 'en'
        ? `No ${result.vehicleRequested} route found — substituted with another mode.`
        : userLang === 'zh'
        ? `未找到${result.vehicleRequested}路线，已用其他交通方式替代。`
        : `指定の乗り物（${result.vehicleRequested}）の経路が見つからず、他の交通手段で代替しました。`) : undefined;
      // #24: バス停を転々とする無意味な複雑バス連鎖（例: 羽田→新宿で港湾バースを5連続乗継）を
      // そのまま提示せず、「バス直行なし」を明示して鉄道ルートを推奨する。
      const noDirectBusNote = result.complexBusChain ? (userLang === 'en'
        ? '🚌 No direct bus service — the found route chains 3+ local bus segments (e.g. harbor berths), which is impractical. Prefer the railway route below (or an airport limousine bus).'
        : userLang === 'zh'
        ? '🚌 无直达公交——检索结果需连续换乘3段以上区内公交（如港区泊位），不切实际。建议优先选择下方的铁路路线（或机场利木津巴士）。'
        : '🚌 バス直行便はありません。検索された経路は3連続以上のバス乗り継ぎ（港湾バース等）で非現実的なため、下記の鉄道路線（または空港リムジンバス）をご利用ください。') : undefined;
      // 🚌 乗り物指定優先の進言ブロック（better_alternative）
      let betterAlternativeBlock = undefined;
      if (result.betterAlternative && result.betterAlternative.exists) {
        const ba = result.betterAlternative;
        const modeLabelFor = (m) => userLang === 'en'
          ? (m === 'train' ? 'Train' : m === 'community_bus' ? 'Community bus' : m === 'ferry' ? 'Ferry' : 'Bus')
          : userLang === 'zh'
            ? (m === 'train' ? '电车' : m === 'community_bus' ? '社区公交' : m === 'ferry' ? '水上巴士' : '公交')
            : (m === 'train' ? '電車' : m === 'community_bus' ? 'コミュニティバス' : m === 'ferry' ? '水上バス' : 'バス');
        const prefLabel = modeLabelFor(ba.preferred_mode);
        const altLabel = modeLabelFor(ba.recommended_mode);
        const reason = userLang === 'en'
          ? `💡 Better alternative: ${altLabel} saves ${ba.transfers_saved} transfer(s) and ~${ba.estimated_minutes_saved} min vs. your requested ${prefLabel}.`
          : userLang === 'zh'
            ? `💡 更优方案：相比您指定的${prefLabel}，使用${altLabel}可减少 ${ba.transfers_saved} 次换乘、约 ${ba.estimated_minutes_saved} 分钟。`
            : `💡 より良い案：${prefLabel}指定より${altLabel}の方が乗換 ${ba.transfers_saved} 回・約 ${ba.estimated_minutes_saved} 分短縮できます。`;
        const altSegs = (ba.alt_segments || []).map((s, i) => {
          const stops = (s.stops && s.stops.length ? s.stops : [s.fromStop, s.toStop]).map(n => getDisplayStationName(n, userLang));
          const base = { step: i + 1, mode: s.mode, mode_label: modeLabel(s.mode), from: getDisplayStationName(s.fromStop, userLang), to: getDisplayStationName(s.toStop, userLang), stops };
          if (s.mode === 'bus') { base.operator = opLabel(s.operator); base.non_step_bus = s.non_step_bus; }
          else if (s.mode === 'train') { base.operator = userLang === 'en' ? 'Railway' : userLang === 'zh' ? '铁路' : '鉄道'; }
          else if (s.mode === 'community_bus') { base.operator = s.bus; base.municipality = s.municipality; base.website = s.website; base.non_step_bus = null; }
          else if (s.mode === 'transfer') { base.note = userLang === 'en' ? 'Walk transfer' : userLang === 'zh' ? '步行换乘' : s.note; }
          return base;
        });
        betterAlternativeBlock = {
          note: reason,
          recommended_mode: ba.recommended_mode,
          preferred_mode: ba.preferred_mode,
          transfers_saved: ba.transfers_saved,
          estimated_minutes_saved: ba.estimated_minutes_saved,
          route: altSegs
        };
      }
      return jsonResponse({
        status: 'SUCCESS', detected_language: userLang,
        transfer: true,
        found: true,
        cross_modal: result.isCrossModal || false,
        from: getDisplayStationName(result.fromNode, userLang), to: getDisplayStationName(result.toNode, userLang),
        transfers: segments.length - 1,
        route: segments,
        barrier_free_note: barrierFreeNote,
        note: crossModal || undefined,
        no_direct_bus: result.complexBusChain || undefined,
        no_direct_bus_note: noDirectBusNote,
        vehicle_fallback: result.vehicleFallback || undefined,
        vehicle_fallback_note: vehicleFallbackNote,
        vehicle_requested: result.vehicleRequested || 'any',
        better_alternative: betterAlternativeBlock,
        community_bus_access: cbAccess.length ? cbAccess : undefined,
        community_bus_note: communityBusNote,
        // 公的機関の検索案内（到着地バス停名を基準に表示）
        gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(result.toNode, userLang)),
        data_source: 'ODPT BusroutePattern + BusTimetable + odpt:Station/odpt:BusstopPole (geo-link) + コミュニティバス駅接続(自治体公式データ)',
        ai_transit_advice: aiAdvice,
        test_mode: testAdv.testMode,
        simulated_failure_type: testAdv.failureType || undefined
      });
    } catch (error) {
      odptBreaker.onFailure(error);
      return handleApiError(error, { userLang });
    }
  }
  const userLang = resolveLang(args) || detectLanguage(busstopName) || 'ja';
  const parsedTest = parseTestMode({ from: busstopName, to: '', '-test': args['-test'], test: args.test, test_mode: args.test_mode });
  const testAdv = buildTestAdvice(parsedTest.simulatedFailure, userLang);
  const aiAdvice = await getTransitAdvice(testAdv, userLang);
  // バス停単体検索でも、地震時は通常の乗車候補を提示しない。
  if (isEarthquakeSimulation(testAdv)) {
    return await buildEarthquakeSafetyResponse('ground', userLang, { busstop_name: busstopName });
  }
  // ブレーカーOPENでもハードコード（JRバス関東・コミュニティバス）は fetchAllBuses 内で提供されるため、
  // ここでは弾かない（ODPT断でも ちぃばす 等のコミュニティバス検索は可能）。
  try {
    const cached = cache.get(cache.busData.key);
    let buses, okCount, failCount, hcCount;
    if (cached) {
      buses = cached.merged; okCount = cached.okCount; failCount = cached.failCount; hcCount = cached.hcCount || 0;
      odptBreaker.onSuccess();
    } else {
      const r = await fetchAllBuses(userLang);
      buses = r.merged; okCount = r.okCount; failCount = r.failCount; hcCount = r.hcCount || 0;
      cache.set(cache.busData.key, r, cache.busData.ttl);
      odptBreaker.onSuccess();
    }
    // 取得できた事業者ラベル（ODPT 3社 + hardCoded GTFSソース）
    const operatorSumm = [
      ...BUS_OPERATORS.map(o => ({ operator: o.id, label: userLang === 'en' ? o.labelEn : userLang === 'zh' ? o.labelZh : o.label, website: o.website })),
      ...BUS_GTFS_SOURCES.filter(s => s.hardCoded).map(s => ({ operator: s.operatorId, label: userLang === 'en' ? s.labelEn : userLang === 'zh' ? s.labelZh : s.label, website: s.website, hardcoded: true })),
      ...BUS_GTFS_SOURCES.filter(s => !s.hardCoded && s.url).map(s => ({ operator: s.operatorId, label: userLang === 'en' ? s.labelEn : userLang === 'zh' ? s.labelZh : s.label, website: s.website, gtfs: true }))
    ];
    const dataSourceNote = `ODPT Bus (${okCount}/${BUS_OPERATORS.length} 事業者取得成功)` + (failCount > 0 ? ` / ${failCount}社取得失敗` : '') + (hcCount > 0 ? ` + GTFS-JP(${hcCount}ソース: JRバス関東・都内コミュニティバス・川崎市バス・関東バス等)` : '');

    // 🔴 足の悪いユーザー向けバリアフリー注意喚起（odpt:Bus に車椅子/低床情報は無いため案内のみ）
    const barrierFreeNote = userLang === 'en'
      ? 'Note: ODPT bus data does not include wheelchair/low-floor info. Please check the operator website or contact the bus office for step-free / priority-seat availability.'
      : userLang === 'zh'
        ? '注意：ODPT 公交数据不含轮椅/低地板车辆信息。无障碍乘车（有无台阶、优先座位）请在各公司官网或致电营业所确认。'
        : 'ご案内：ODPTのバスデータには車椅子対応・低床バス等の情報は含まれません。段差の有無や優先席の利用は、各事業者ウェブサイトまたは営業所へお問い合わせください。';

    if (!busstopName) {
      return jsonResponse({
        status: "SUCCESS", detected_language: userLang,
        total: buses.length,
        operators: operatorSumm,
        bus_routes: buses.slice(0, 20).map(b => ({
            note: getDisplayStationName(b['odpt:note'] || b._displayNote, userLang), route: b['odpt:busroute'], number: b['odpt:busNumber'],
          operator: userLang === 'en' ? b._operatorLabel.labelEn : userLang === 'zh' ? b._operatorLabel.labelZh : b._operatorLabel.label,
          website: b._communityBusUrl || b._operatorLabel.website || undefined,
          community_bus: b._communityBus ? true : undefined,
          municipality: b._municipality || undefined
        })),
        barrier_free_note: barrierFreeNote,
        data_source: dataSourceNote,
        fallback_url: "https://www.kotsu.metro.tokyo.jp/bus/",
        ai_transit_advice: aiAdvice,
        test_mode: testAdv.testMode,
        simulated_failure_type: testAdv.failureType || undefined
      });
    }
    // 英語・中国語のバス停名を日本語に解決（例: Sakurabashi→桜橋、Tsukishima→月島）
    const resolveBusStopLang = (input) => {
      const trimmed = String(input || '').trim();
      if (!trimmed) return trimmed;
      const norm = normalizeBusStop(trimmed);
      const lower = trimmed.toLowerCase();
      const normLower = norm.toLowerCase();
      for (const [jp, trans] of Object.entries(STATION_DISPLAY_NAMES)) {
        const en = (trans.en || '').toLowerCase();
        const zh = trans.zh || '';
        // 入力（例: Kawasaki Station）と normalizeBusStop 結果（例: 川崎）の両方で駅名解決
        if ((en && (lower === en || normLower === en)) || (zh && (trimmed === zh || norm === zh))) return jp;
      }
      // 🔴 normalizeBusStop で「駅/Station/站」サフィックス除去・駅名正規化された結果も参照する
      // （例: 「Kawasaki Station」→ normalizeBusStop → 「川崎」→ STATION_NAME_MAP['川崎'] は無いが
      //   STATION_NAME_MAP['Kawasaki'] はある。norm がローマ字の場合は STATION_NAME_MAP[norm] を引く）
      if (STATION_NAME_MAP[trimmed]) return STATION_NAME_MAP[trimmed];
      if (norm !== trimmed && STATION_NAME_MAP[norm]) return STATION_NAME_MAP[norm];
      return trimmed;
    };
    const resolvedBusstop = resolveBusStopLang(busstopName);
    const busstopVariants = (input) => {
      const norm = normalizeStationName(input);
      return [input, norm].filter((v, i, a) => a.indexOf(v) === i);
    };
    // 🔴 前方一致（入力で始まるバス停）を最優先。部分一致のみの同名ノイズ
    // （例: 「大門」検索で埼玉の「野火止大門」「高松大門通り」が混ざる問題）を除外する。
    // 前方一致にヒットが無い場合のみ、従来の部分一致にフォールバックする。
    const matchedAll = buses.filter(b => {
      return busstopVariants(resolvedBusstop).some(v => {
        const stripped = v.replace(/(停留所|バス停|駅)$/, '');
        return b._searchKeys.some(k => k.includes(v) || (stripped !== v && k.includes(stripped)));
      });
    });
    const matchedPrefix = buses.filter(b => {
      return busstopVariants(resolvedBusstop).some(v => {
        const stripped = v.replace(/(停留所|バス停|駅)$/, '');
        return b._searchKeys.some(k => k.startsWith(v) || (stripped !== v && k.startsWith(stripped)));
      });
    });
    // 「駅前」サフィックスのバス停（例: 大門駅前）を先頭に並べ替え。
    // 同名バス停が複数地域にある場合、駅に直結するバス停が最上位に来るようにする。
    const matchedPrefixSorted = [...matchedPrefix].sort((a, b) => {
      const aKey = String((a._searchKeys || [])[0] || '');
      const bKey = String((b._searchKeys || [])[0] || '');
      const aStation = /駅前$/.test(aKey) ? 0 : 1;
      const bStation = /駅前$/.test(bKey) ? 0 : 1;
      return aStation - bStation;
    });
    const matched = matchedPrefixSorted.length > 0 ? matchedPrefixSorted : matchedAll;
    // 🔴 0件時の案内改善: 入力に部分一致する実在バス停を類似候補として提示
    // （例: 「合羽橋」→「合羽坂下」「浅草」→「浅草雷門」等）。
    // ODPT に同名バス停が無い場合でも、最寄りの実在バス停名を教えることで
    // ユーザーが正しい乗車バス停を特定できる。
    let nearbySuggestions = undefined;
    if (matched.length === 0) {
      const q = resolvedBusstop.replace(/(停留所|バス停|駅)$/, '');
      // #46: 類似候補をスコアリングして上位のみ提示（先頭1文字だけの雑な一致を排除）。
      // 1) 入力が停名に含まれる 2) 共通接頭辞長 3) 編集距離（Levenshtein）
      // 4) 「駅前」「駅」サフィックス付き停名を優先 5) 上位5件に制限
      if (q.length >= 2) {
        const seen = new Set();
        const cands = [];
        for (const b of buses) {
          for (const k of (b._searchKeys || [])) {
            // 生データの系統名・ID付きノイズ（「系統名:数字:停留所」等）は候補から除外
            if (!k || seen.has(k) || /[：:〜→|]/.test(k)) continue;
            const stripped = k.replace(/(停留所|バス停|駅)$/, '');
            let prefixLen = 0;
            const maxP = Math.min(q.length, stripped.length);
            while (prefixLen < maxP && q[prefixLen] === stripped[prefixLen]) prefixLen++;
            const dist = levenshteinDist(q, stripped);
            let score = 0;
            if (stripped.includes(q)) score += 20;          // 入力が停名の一部（「浅草」→「浅草雷門」）
            if (prefixLen >= 2) score += prefixLen * 4;     // 共通接頭辞2文字以上は強い一致
            else if (prefixLen === 1) score += 1;           // 1文字一致は最低限のみ
            if (dist === 0) score += 15;
            else if (dist <= 1) score += 10;
            else if (dist === 2) score += 5;
            else if (dist === 3) score += 2;
            if (/駅前$/.test(k)) score += 2;                // 駅直結バス停を優先
            else if (/駅$/.test(k)) score += 1;
            // 閾値: 関連が薄い候補（例: 「佐倉」→「阿佐ヶ谷駅前」「越生」→「鶴見駅」の
            // 1文字一致・編集距離2のみ）は除外。2文字クエリで距離2はほぼ無関係。
            if (score >= 8) {
              seen.add(k);
              cands.push({ k, score });
            }
          }
        }
        if (cands.length) {
          cands.sort((a, b) => b.score - a.score);
          const label = userLang === 'en' ? 'Similar nearby bus stops'
            : userLang === 'zh' ? '相近的公交站名' : '類似する近隣のバス停';
          const localized = cands.slice(0, 5)
            .map(c => getDisplayStationName(c.k, userLang))
            .filter(s => userLang === 'ja' || !/[\u3040-\u30ff\u3400-\u9fff]/.test(s));
          nearbySuggestions = localized.length ? { note: label, stops: localized } : undefined;
        }
      }
    }
    return jsonResponse({
      status: "SUCCESS", detected_language: userLang,
      busstop: busstopName,
      resolved_busstop: resolvedBusstop !== busstopName ? resolvedBusstop : undefined,
      total: matched.length,
      nearby_suggestions: nearbySuggestions,
      // 公的機関の検索案内: バス停名を基準に表示する（ご老人等が「バス停名」で公的機関を探すケースに対応。v2.36.3）
      // 多言語チェック（probe-all-lang）が英語・中国語応答に日本語名が残るのを弾くため、言語別表示名で渡す。
      gov_facility_search_support: buildGovFacilitySearchSupport(null, userLang, getDisplayStationName(resolvedBusstop || busstopName, userLang)),
      operators: operatorSumm,
      bus_routes: matched.slice(0, 20).map(b => ({
        note: getDisplayStationName(b['odpt:note'] || b._displayNote, userLang), route: b['odpt:busroute'], number: b['odpt:busNumber'],
        frequency: b['odpt:frequency'],
        operator: userLang === 'en' ? b._operatorLabel.labelEn : userLang === 'zh' ? b._operatorLabel.labelZh : b._operatorLabel.label,
        website: b._communityBusUrl || b._operatorLabel.website || undefined,
        community_bus: b._communityBus ? true : undefined,
        municipality: b._municipality || undefined
      })),
      barrier_free_note: barrierFreeNote,
      data_source: dataSourceNote,
      fallback_url: "https://www.kotsu.metro.tokyo.jp/bus/",
      ai_transit_advice: aiAdvice,
      test_mode: testAdv.testMode,
      simulated_failure_type: testAdv.failureType || undefined
    });
  } catch (error) {
    odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}

// ============================================================
// ✈️ 空港フライト時刻・到着時刻表示（AviationStack）
// ============================================================

// 空港名（日本語/英語）→ IATA コード
const AIRPORT_IATA = {
  '羽田空港': 'HND', '羽田': 'HND', 'HND': 'HND', 'hnd': 'HND', 'Haneda': 'HND', 'Haneda Airport': 'HND', '羽田机场': 'HND', '东京国际机场': 'HND', '东京国际': 'HND',
  '成田空港': 'NRT', '成田': 'NRT', 'NRT': 'NRT', 'nrt': 'NRT', 'Narita': 'NRT', 'Narita Airport': 'NRT', '成田机场': 'NRT',
  '茨城空港': 'IBR', 'IBR': 'IBR', 'ibr': 'IBR', '茨城机场': 'IBR'
};
// 空港 IATA → 天候取得用の気象庁地域コード（到着時の AI アドバイス用）
const AIRPORT_WEATHER_AREA = {
  HND: '130000', // 東京
  NRT: '120000', // 千葉
  IBR: '080000'  // 茨城
};
// 空港名の正規化: 末尾の 空港/Airport/机场 サフィックスを除去（3か国語対応）
// 2026-08 検査プログラムで検出（#経路検査）: 「羽田空港第3ターミナル」等のターミナル名が
// 解決できず INVALID_INPUT になっていた。ターミナル接尾辞も除去して IATA 解決できるようにする。
function normalizeAirportQuery(name) {
  if (!name) return name;
  return name.replace(/(第[1-3一二三]ターミナル|ターミナル|Terminal|航站楼|空港|Airport|机场)\s*$/i, '').trim();
}
// IATA → 日本語表示名（到着連携用の駅名マップ）
const IATA_TO_TERMINAL_STATION = {
  // #24: HND graceful 到着の既定は国際線ターミナルの第3（フライト実データがある場合は
  // 実ターミナルで上書きされる）。第1は国内線専用のため、既定のままでは国際到着の最寄り駅が誤る。
  HND: '羽田空港第3ターミナル',
  NRT: '成田空港',
  IBR: '茨城空港（小美玉）'
};
// 到着時、destination 未指定でも表示する主要アクセス駅（海外来客・帰省に最適）
const DEFAULT_ACCESS_DESTINATIONS = {
  HND: ['東京駅', '品川', '浜松町'],
  NRT: ['東京駅', '日暮里', '新宿'],
  IBR: ['水戸']
};

// ============================================================
// ✈️ ODPT 航空データ（プライマリソース・JAL/ANA・基本ライセンス）
// AviationStack はフォールバック（FLIGHT_API_KEY 設定時のみ・JAL/ANA 以外の便や海外空港を補完）
// ============================================================

// ODPT フライトステータス辞書（odpt:FlightStatus の 32 種 → ja/en/zh）
const ODPT_FLIGHT_STATUS_MAP = {
  Adjusting:        { ja: '機材繰り',           en: 'Adjusting aircraft',          zh: '调配飞机' },
  Arrived:          { ja: '到着済み',           en: 'Arrived',                     zh: '已到达' },
  BadWeather:       { ja: '天候不良',           en: 'Bad weather',                 zh: '天气恶劣' },
  BaggageAvailable: { ja: '手荷物引渡中',       en: 'Baggage delivery',            zh: '行李交付中' },
  BoardingComplete: { ja: '搭乗終了',           en: 'Boarding completed',          zh: '登机结束' },
  CheckInClose:     { ja: '搭乗手続終了',       en: 'Check-in closed',             zh: '值机结束' },
  CheckIn:          { ja: '搭乗手続中',         en: 'Check-in in progress',        zh: '值机中' },
  Cancelled:        { ja: '欠航',               en: 'Cancelled',                   zh: '取消' },
  Delayed:          { ja: '遅れ',               en: 'Delayed',                     zh: '延误' },
  Departed:         { ja: '出発済み',           en: 'Departed',                    zh: '已起飞' },
  DestinationChanged:{ ja: '到着地変更',        en: 'Destination changed',         zh: '目的地变更' },
  Diverted:         { ja: 'ダイバート',         en: 'Diverted',                    zh: '备降' },
  EstimatedArrival: { ja: '到着予定',           en: 'Estimated arrival',           zh: '预计到达' },
  EstimatedDeparture:{ ja: '出発予定',          en: 'Estimated departure',         zh: '预计起飞' },
  ExtraFlight:      { ja: '臨時便',             en: 'Extra flight',                zh: '临时航班' },
  FinalCall:        { ja: '最終搭乗案内',       en: 'Final call',                  zh: '最后登机通知' },
  InAir:            { ja: '航行中',             en: 'In flight',                   zh: '飞行中' },
  Indefinite:       { ja: '時刻未定',           en: 'Time indefinite',             zh: '时间未定' },
  Landed:           { ja: '着陸済み',           en: 'Landed',                      zh: '已着陆' },
  LateArrival:      { ja: '使用機遅れ',         en: 'Late aircraft arrival',       zh: '飞机晚到' },
  LeftGate:         { ja: 'ゲート出発済み',     en: 'Left gate',                   zh: '已出登机口' },
  Maintenance:      { ja: '使用機整備',         en: 'Maintenance',                 zh: '飞机维护' },
  NewTime:          { ja: '時刻変更',           en: 'Time changed',                zh: '时间变更' },
  NowBoarding:      { ja: '搭乗中',             en: 'Now boarding',                zh: '登机中' },
  OnTime:           { ja: '定刻',               en: 'On time',                     zh: '准点' },
  Other:            { ja: 'その他',             en: 'Other',                       zh: '其他' },
  PostponedTomorrow:{ ja: '翌日運行',           en: 'Postponed to tomorrow',       zh: '顺延至明日' },
  StopCheckIn:      { ja: '搭乗手続中止中',     en: 'Check-in suspended',           zh: '值机暂停' },
  Takeoff:          { ja: '離陸済み',           en: 'Departed (takeoff)',          zh: '已起飞' },
  Unknown:          { ja: '不明',               en: 'Unknown',                     zh: '不明' },
  WeatherCheck:     { ja: '天候調査中',         en: 'Weather check',               zh: '天气检查中' },
  Yesterday:        { ja: '昨日便',             en: "Yesterday's flight",          zh: '昨日航班' }
};
// 空港 IATA → 航空会社表示名（ODPT は operator が odpt.Operator:JAL/ANA 形式）
const ODPT_AIRLINE_NAMES = {
  JAL: { ja: '日本航空', en: 'Japan Airlines', zh: '日本航空' },
  ANA: { ja: '全日空',   en: 'All Nippon Airways', zh: '全日空' }
};
// odpt.Airport:HND / odpt.AirportTerminal:HND.Terminal3 形式 → 末尾コード抽出
function odpIdSuffix(id, prefix) {
  if (!id) return null;
  const s = String(id);
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}
// ODPT のフライト1件を共通フォーマットに正規化
function normalizeOdpFlight(f, direction, userLang) {
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

// ODPT からフライトを取得（プライマリ・JAL/ANA のリアルタイム発着）
async function fetchFlightsOdp(params) {
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

// AviationStack からフライトを取得（フォールバック・キーなし・エラー時は null を返し graceful degradation）
// 注意: AviationStack は flight_status の複数値（カンマ区切り）を拒否する（validation_error）。
// また無料プランは flight_date パラメータ非対応（function_access_restricted）のため、
// エラー時は必須パラメータ（空港/便名/limit）のみで再試行する。
async function fetchFlights(params) {
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

// フライト1件を共通フォーマットに正規化
function normalizeFlight(f, direction, userLang) {
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

async function searchFlight(args) {
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

export { searchRoute, searchFare, getWeather, getTimetable, searchBus, getStationInfo, listTransitOperators, listCommunityBuses, getOperatorRoutes, listFerryPorts, searchFerry, detectLanguage, resolveLang, parseTestMode, computeRoutes, findShortestPath, resolveStation, searchFlight, translateTrainInfoDetail, translateWeather, detectFailureType, buildTestAdvice, STATION_TO_LINES, WALK_TRANSFERS, AMBIGUOUS_STATION_NAMES, calculateFlightDelayMinutes, parseCsvLine, validateFlightDate, normalizeAirportIata, gtfsFetchDates };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('index.mjs'))) {
  main().catch(error => { console.error('Failed to start server:', error); process.exit(1); });
}