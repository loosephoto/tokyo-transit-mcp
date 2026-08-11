/**
 * 地震時安全レスポンス・国土地理院指定緊急避難場所（モノリス分割 Phase 4a）
 * 依存: config / data/misc / data/railway-lines / lib/geo / lib/common
 */
import { cache } from '../config.mjs';
import { GSI_MUNICIPALITY_CODES, GSI_MUNICIPALITY_LABELS, GSI_SHELTER_HAZARD_FIELDS,
         MULTILINGUAL_ADVICE, EMERGENCY_EVACUATION_SEARCH_URL } from '../data/misc.mjs';
import { STATION_COORDS } from '../data/railway-lines.mjs';
import { haversineDistance } from '../lib/geo.mjs';
import { jsonResponse } from '../lib/common.mjs';
import axios from 'axios';

export function buildEarthquakeTransportSafety(transport, userLang = 'ja') {
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

export function isEarthquakeSimulation(testAdv) {
  return testAdv?.failureAdviceKey === 'earthquake';
}

export function getGsiMunicipalityCode(location) {
  return GSI_MUNICIPALITY_CODES[location] || null;
}

export async function fetchGsiEmergencyShelters(municipalityCode) {
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

export async function getGroundEmergencyShelters(location, hazardType, userLang = 'ja') {
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

export async function buildEarthquakeSafetyResponse(transport, userLang = 'ja', context = {}) {
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
