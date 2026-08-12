/**
 * バス検索・横断乗り継ぎハンドラ（モノリス分割 Phase 4b-7）
 * ODPT バス + GTFS-JP ハードコード + コミュニティバスの統合グラフ探索。
 * 依存: config / data / lib / advice / handlers/search-route（駅名解決・コミュニティバス接続）
 */
import { cache, odptBreaker, API_BASE_URL, API_KEY } from '../config.mjs';
import { BUS_OPERATORS, TOKYO_COMMUNITY_BUSES, COMMUNITY_BUS_ROUTES, COMMUNITY_BUS_STATION_ACCESS,
         BUS_GTFS_SOURCES, BUSSTOP_ROMAN_TO_JA, BUS_OPERATOR_LABEL,
         COMMUNITY_BUS_NAME_MAP, BUS_STOP_SUFFIX_MAP } from '../data/bus-routes.mjs';
import { MULTILINGUAL_ADVICE, NON_RAIL_OPERATORS, OPERATOR_MAP } from '../data/misc.mjs';
import { STATION_COORDS, RAILWAY_LINES } from '../data/railway-lines.mjs';
import { STATION_NAME_MAP, STATION_DISPLAY_NAMES, RAILWAY_NAME_MAP } from '../data/station-names.mjs';
import { getParams, jsonResponse, buildErrorResponse, handleApiError, buildGovFacilitySearchSupport } from '../lib/common.mjs';
import { getDisplayStationName, getCommunityBusDisplayName, getCommunityBusStopDisplayName,
         resolveLang, detectLanguage, translateTrainInfoDetail } from '../lib/lang.mjs';
import { haversineDistance, haversineM } from '../lib/geo.mjs';
import { parseCsvRecords } from '../lib/csv.mjs';
import { fetchGtfsZipBuffer } from '../lib/gtfs.mjs';
import { parseTestMode, buildTestAdvice, getTransitAdvice, detectFailureType } from '../advice/transit-advice.mjs';
import { isEarthquakeSimulation, buildEarthquakeSafetyResponse } from '../advice/earthquake.mjs';
import { getWeatherAdvice } from '../advice/weather.mjs';
import { normalizeStationName, resolveStation, getStationRomanToJa, buildCommunityBusAccessBlock, findShortestPath } from './search-route.mjs';
import axios from 'axios';

export function buildHardCodedBusRecords(src) {
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

export function poleIdSeg(poleRef) {
  if (!poleRef) return null;
  const last = String(poleRef).split(':').pop(); // YokohamaMunicipal.SakuragichoStation.2014.2
  return last.replace(/^[A-Za-z]+\./, '').replace(/\.\d+\.\d+$/, ''); // SakuragichoStation
}

export async function fetchAllBuses(userLang) {
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
      const httpStatus = e?.response?.status ?? (e?.code || '');
      console.log(`[Bus] ${src.name}: GTFS skip (${e.message})${httpStatus ? ` [HTTP ${httpStatus}]` : ''}`);
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

export function normalizeBusStop(name) {
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

export async function fetchBusGraph(signal) {
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

export async function fetchBusTimetable(signal) {
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

export function buildTransferGraph(patterns) {
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

export function buildTrainNameGraph() {
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

export async function fetchBusStopGeo(signal) {
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

export async function fetchStationGeo(signal) {
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

export async function fetchBusStopStationLinks(thresholdM = 500, signal = undefined) {
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

export function getDisplayBusstopName(p) {
  if (p['dc:title']) return p['dc:title'];
  if (p['title'] && typeof p['title'] === 'string') return p['title'];
  if (p['odpt:note']) return p['odpt:note'];
  if (p['owl:sameAs']) {
    const seg = String(p['owl:sameAs']).split('.');
    return seg[seg.length - 1];
  }
  return '';
}

export function opIdOf(p) {
  const op = Array.isArray(p['odpt:operator']) ? p['odpt:operator'][0] : p['odpt:operator'];
  if (!op) return '';
  const seg = String(op).split(':');
  return seg[seg.length - 1];
}

export function findTransferPath(graph, fromStop, toStop, nonStepByPattern, nonStepByStop) {
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

export function findBusSegment(busGraph, a, b, nonStepByPattern, nonStepByStop) {
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

export const VEHICLE_WEIGHTS = {
  bus:            { bus: 1, train: 3, link: 1, community_bus: 1, ferry: 3 },
  train:          { train: 1, bus: 3, link: 1, community_bus: 3, ferry: 3 },
  community_bus:  { community_bus: 1, bus: 2, train: 3, link: 1, ferry: 3 },
  ferry:          { ferry: 1, bus: 3, train: 3, link: 1, community_bus: 3 },
  any:            { bus: 1, train: 1, link: 1, community_bus: 1, ferry: 1 }
};
const VALID_VEHICLES = ['bus', 'train', 'community_bus', 'ferry', 'any'];

export function edgeTypeToMode(type) {
  if (type === 'link' || type === 'transfer') return 'link';
  return type; // bus / train / community_bus / ferry はそのまま
}

export function findWeightedPath(adj, fromNode, toNode, weights, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus) {
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

export function buildSegmentsFromPath(nodePath, edgePath, adj, busGraph, nonStepByPattern, nonStepByStop, cbStopToBus) {
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

export function pathHasMode(segments, mode) {
  return segments.some(s => s.mode === mode);
}

export function scorePath(segments) {
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

export async function searchBusTransfer(fromInput, toInput, vehiclePref) {
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

export function levenshteinDist(a, b) {
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

export async function searchBus(args) {
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

export class MinHeap {
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
