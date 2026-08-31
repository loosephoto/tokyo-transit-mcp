/**
 * 時刻表ハンドラ（モノリス分割 Phase 4b-4）
 * 依存: config / data/misc / data/railway-lines / lib / advice
 */
import { cache, odptBreaker, API_BASE_URL, API_KEY } from '../config.mjs';
import { OPERATOR_MAP } from '../data/misc.mjs';
import { RAILWAY_NAME_MAP, ODPT_RAILWAY_NAME_MAP } from '../data/station-names.mjs';
import { RAILWAY_LINES } from '../data/railway-lines.mjs';
import { getParams, jsonResponse, buildErrorResponse, handleApiError, isInternalError } from '../lib/common.mjs';
import { normalizeOvernightTime, timeToSortMinutes, getJstDateStr, getJstDay } from '../lib/time.mjs';
import { resolveLang, detectLanguage, getDisplayStationName, getDisplayLineName, translateTrainInfoDetail } from '../lib/lang.mjs';
import { normalizeStationName, getStationRomanToJa } from './search-route.mjs';
import { getToeiGtfsStationTimetable } from '../lib/toei-gtfs-timetable.mjs';
import { parseTestMode, buildTestAdvice, getTransitAdvice, detectFailureType } from '../advice/transit-advice.mjs';
import { isEarthquakeSimulation, buildEarthquakeSafetyResponse } from '../advice/earthquake.mjs';
import axios from 'axios';

export function resolveTimetableCalendar(arg, dateStr) {
  if (arg) {
    const a = String(arg).toLowerCase();
    if (a.includes('week') || a.includes('平日') || a === 'wd') return 'Weekday';
    if (a.includes('saturday') || a.includes('holiday') || a.includes('土') || a.includes('休') || a === 'sh') return 'SaturdayHoliday';
  }
  // 🔴 v2.50.1: 曜日は JST 基準で判定する（従来は new Date().getDay() のローカル/環境依存）。
  // dateStr（YYYY-MM-DD）指定時はその日付の曜日、未指定時は JST の今日。
  const day = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr))
    ? new Date(`${dateStr}T12:00:00Z`).getUTCDay()
    : getJstDay();
  return (day === 0 || day === 6) ? 'SaturdayHoliday' : 'Weekday';
}

export function stationIdTail(stationId) {
  if (!stationId) return '';
  return String(stationId).split('.').pop() || '';
}

// 🔴 v2.50.1: 駅ID（ローマ字末尾）と日本語駅名の「完全一致」判定。
// 従来は tail.startsWith / jaName.includes を使っていたため、
// 「上野」クエリに上野広小路・上野御徒町（上野駅を通らない列車）が混入し、
// マッチ件数が異常に膨らんでいた（実測1628件。接頭辞衝突ペアは路線図内に132組）。
// 曖昧さを排除し、完全一致のみをマッチとする。
export function stationIdMatchesStation(tailLower, stationName, romanToJa = {}) {
  const stationLower = String(stationName || '').toLowerCase();
  const tail = String(tailLower || '').toLowerCase();
  if (!tail || !stationLower) return false;
  // ローマ字ID末尾との完全一致（例: ueno === ueno）
  if (tail === stationLower) return true;
  // ローマ字 → 日本語名変換後の完全一致（例: uenohirokoji → 上野広小路 ≠ 上野）
  const jaName = romanToJa[tail];
  if (jaName && String(jaName).toLowerCase() === stationLower) return true;
  return false;
}

// レコードが指定駅を経由するか（origin/destination/途中駅の発着いずれかに完全一致）。
export function stationRecordMatches(record, stationName, romanToJa = {}) {
  const ids = [];
  for (const key of ['odpt:originStation', 'odpt:destinationStation']) {
    const v = record?.[key];
    if (Array.isArray(v)) ids.push(...v);
    else if (v) ids.push(v);
  }
  for (const obj of (record?.['odpt:trainTimetableObject'] || [])) {
    if (obj['odpt:departureStation']) ids.push(obj['odpt:departureStation']);
    if (obj['odpt:arrivalStation']) ids.push(obj['odpt:arrivalStation']);
  }
  return ids.some(id => stationIdMatchesStation(stationIdTail(id), stationName, romanToJa));
}

export const TIMETABLE_OPERATORS = ['TokyoMetro', 'Toei', 'YokohamaMunicipal', 'TWR', 'MIR', 'TamaMonorail'];

export async function getTimetableRailways() {
  // 🔴 #94: モジュール変数の無期限保持をやめ、cache（TTL付き）に一本化。
  // 障害中に取得した古い路線リストを復旧後も返し続ける問題を防ぐ。
  const cacheKey = `${cache.trainTimetable.key}:railways`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const res = await axios.get(`${API_BASE_URL}/odpt:Railway`, { params: getParams(), timeout: 20000 });
    const lines = (res.data || [])
      .filter(r => {
        const op = r['odpt:operator'] || '';
        return TIMETABLE_OPERATORS.some(o => op.endsWith(`.${o}`) || op.endsWith(`:${o}`));
      })
      .map(r => r['owl:sameAs'] || r['@id'])
      .filter(Boolean);
    if (lines.length > 0) cache.set(cacheKey, lines, cache.trainTimetable.ttl);
    return lines;
  } catch (error) {
    // 🔴 #95: 二重カウント防止 — このヘルパーでは onFailure を呼ばず、getTimetable の
    // 単一の catch（L291）でブレーカーに通知する。呼び出し元が失敗を1回だけ数えられるようにする。
    throw error;
  }
}

export async function getTimetable(args) {
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

    // レコードが指定駅を通るか判定（純関数 stationRecordMatches 参照）。
    // 日本語駅名とローマ字IDの両対応（例: 新宿 ⇔ ...Shinjuku）
    const recordMatchesStation = (t) => stationRecordMatches(t, stationName, romanToJa);

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
        const atDep = depTail && stationIdMatchesStation(depTail, stationName, romanToJa);
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
        const atDep = depTail && stationIdMatchesStation(depTail, stationName, romanToJa);
        const atArr = arrTail && stationIdMatchesStation(arrTail, stationName, romanToJa);
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

    const translateTrainType = (typeUri, lang) => {
      if (!typeUri) return undefined;
      const raw = String(typeUri).split(/[.:]/).pop() || '';
      const map = {
        'Local': { ja: '各駅停車', en: 'Local', zh: '各站停车' },
        'Rapid': { ja: '快速', en: 'Rapid', zh: '快速' },
        'Express': { ja: '急行', en: 'Express', zh: '急行' },
        'LimitedExpress': { ja: '特急', en: 'Limited Express', zh: '特快' },
        'SemiExpress': { ja: '準急', en: 'Semi Express', zh: '准急' }
      };
      return map[raw]?.[lang] || raw;
    };

    const translateRailDirection = (dirUri, lang) => {
      if (!dirUri) return undefined;
      const raw = String(dirUri).split(/[.:]/).pop() || '';
      const map = {
        'Inbound': { ja: '上り', en: 'Inbound', zh: '上行' },
        'Outbound': { ja: '下り', en: 'Outbound', zh: '下行' },
        'Eastbound': { ja: '東行', en: 'Eastbound', zh: '东行' },
        'Westbound': { ja: '西行', en: 'Westbound', zh: '西行' },
        'Northbound': { ja: '北行', en: 'Northbound', zh: '北行' },
        'Southbound': { ja: '南行', en: 'Southbound', zh: '南行' }
      };
      return map[raw]?.[lang] || raw;
    };

    const buildRow = (t) => {
      const times = extractTimes(t);
      const departures = times.filter(x => x.kind === 'departure');
      const arrivals = times.filter(x => x.kind === 'arrival');
      const destId = Array.isArray(t['odpt:destinationStation']) ? (t['odpt:destinationStation'][0] || '') : (t['odpt:destinationStation'] || '');
      const destTail = stationIdTail(destId);
      const destJa = destTail ? (romanToJa[destTail.toLowerCase()] || destTail) : destId;
      const destDisplay = getDisplayStationName(destJa, userLang);

      const rwRaw = t['odpt:railway'] || '';
      const rwKey = rwRaw.replace(/^odpt\.Railway:/, '');
      const rwJapanese = ODPT_RAILWAY_NAME_MAP[rwKey] || rwKey;
      const rwDisplay = getDisplayLineName(rwJapanese, userLang);

      // #82: 方面（railDirection）別に分離して表示。departure / arrival それぞれ昇順ソート
      const sortByTime = (arr) => [...arr].sort((a, b) => (a.sort?.minutes ?? 0) - (b.sort?.minutes ?? 0));
      const depSorted = sortByTime(departures);
      const arrSorted = sortByTime(arrivals);
      return {
        railway: rwDisplay,
        train: t['odpt:train'],
        destination: destDisplay,
        type: translateTrainType(t['odpt:trainType'], userLang),
        direction: translateRailDirection(t['odpt:railDirection'], userLang),
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
      if (filtered.length > 0) return jsonResponse({ status: "SUCCESS", detected_language: userLang, station: displayStation, railway: getDisplayLineName(railwayFilter, userLang), calendar: targetCalendar, service_date: serviceDate || getJstDateStr(), truncated: truncated || undefined, total: filtered.length, timetable: filtered.slice(0, 20).map(buildRow), data_source: "ODPT TrainTimetable (路線×calendar別取得)", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
      // フィルタ結果が 0 件なら「該当路線のデータなし」を明確に返す（誤って全件を返さない）
      const noRailwayMsg = userLang === 'en'
        ? `No timetable found for railway "${getDisplayLineName(railwayFilter, userLang)}" at ${displayStation} (${targetCalendar}).`
        : userLang === 'zh'
          ? `在${displayStation}未找到路线「${getDisplayLineName(railwayFilter, userLang)}」的时程表（${targetCalendar}）。`
          : `${displayStation}の「${railwayFilter}」の時刻表は見つかりませんでした（${targetCalendar}）。`;
      return jsonResponse({ status: "NO_DATA", detected_language: userLang, station: displayStation, railway: getDisplayLineName(railwayFilter, userLang), calendar: targetCalendar, service_date: serviceDate || getJstDateStr(), total: 0, message: noRailwayMsg, data_source: "ODPT TrainTimetable", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
    }
    if (sortedMatched.length === 0) {
      // 🔴 v2.45.0: ODPT が都営駅の時刻表を持たない場合、都営鉄道GTFSをフォールバックとして使用する。
      // ODPT TrainTimetable が障害時・未カバーでも、都営（浅草線・大江戸線・三田線・新宿線・
      // 都電荒川線・日暮里舎人ライナー）の時刻表を GTFS から提供（レジリエンス）。
      const gtfsTT = await getToeiGtfsStationTimetable(stationName);
      if (gtfsTT) {
        return jsonResponse({
          status: "SUCCESS", detected_language: userLang, station: displayStation, calendar: targetCalendar,
          service_date: serviceDate || getJstDateStr(),
          total: gtfsTT.length,
          timetable: gtfsTT.slice(0, 20).map((l) => ({
            railway: getDisplayLineName(l.railway, userLang),
            destination: getDisplayStationName(l.destination, userLang),
            departure_time: l.departure_time,
            calendar: targetCalendar
          })),
          data_source: "Toei Train GTFS (fallback)",
          fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}`
        });
      }
      const noDataMsg = userLang === 'en'
        ? `No timetable data found for ${displayStation} in ODPT (JR East and most private railways are not covered).`
        : userLang === 'zh'
          ? `ODPT中未找到 ${displayStation} 的时程表数据（JR东日本及大部分私铁不在覆盖范围内）。`
          : `${displayStation} の時刻表データはODPTにありません（JR東日本・大部分の私鉄は対象外）。`;
      return jsonResponse({ status: "NO_DATA", detected_language: userLang, station: displayStation, calendar: targetCalendar, service_date: serviceDate || getJstDateStr(), total: 0, message: noDataMsg, data_source: "ODPT TrainTimetable", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
    }
    return jsonResponse({ status: "SUCCESS", detected_language: userLang, station: displayStation, calendar: targetCalendar, service_date: serviceDate || getJstDateStr(), truncated: truncated || undefined, total: sortedMatched.length, timetable: sortedMatched.slice(0, 20).map(buildRow), data_source: "ODPT TrainTimetable (路線×calendar別取得)", fallback_url: `https://transit.yahoo.co.jp/station/list?q=${encodeURIComponent(stationName)}` });
  } catch (error) {
    // 🔴 #95: 内部エラー（実装バグ）はブレーカー失敗として数えない（#91 方針との整合）。
    // 外部 API 障害のみ onFailure でカウントする。ヘルパー（getTimetableRailways）側で
    // onFailure を呼ばないようにしたため、ここで1回だけカウントされる（二重カウント防止）。
    if (!isInternalError(error)) odptBreaker.onFailure(error);
    return handleApiError(error, { userLang });
  }
}
