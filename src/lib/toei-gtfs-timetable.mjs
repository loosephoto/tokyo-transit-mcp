/**
 * 都営鉄道GTFSから駅時刻表を構築する（レジリエンス用フォールバック）。
 * ODPT `odpt:TrainTimetable` が障害時にも都営（浅草線・大江戸線・三田線・新宿線・
 * 都電荒川線・日暮里舎人ライナー）の時刻表をGTFSから提供する。
 * 依存: adm-zip / lib/csv / lib/gtfs（fetchGtfsZipBuffer）
 */
import { fetchGtfsZipBuffer } from './gtfs.mjs';
import { parseCsvRecords } from './csv.mjs';

const TOEI_TRAIN_GTFS_URL = 'https://api.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip';
const TOEI_GTFS_TTL = 6 * 60 * 60 * 1000; // 6時間キャッシュ

let cache = { data: null, ts: 0 };

function col(header, name) { return header.indexOf(name); }

async function loadToeiTrainGtfs() {
  if (cache.data && Date.now() - cache.ts < TOEI_GTFS_TTL) return cache.data;
  const AdmZip = (await import('adm-zip')).default;
  const zipBuf = await fetchGtfsZipBuffer({ url: TOEI_TRAIN_GTFS_URL, noDate: true }, 30000);
  const zip = new AdmZip(Buffer.from(zipBuf));
  const readCsv = (name) => {
    const entry = zip.getEntry(name);
    return entry ? parseCsvRecords(entry.getData().toString('utf-8')) : [];
  };

  const stops = readCsv('stops.txt');
  const routes = readCsv('routes.txt');
  const trips = readCsv('trips.txt');
  const stopTimes = readCsv('stop_times.txt');
  const translations = readCsv('translations.txt');

  // 路線名（routes.txt の route_long_name。translations は en/zh 補完用）
  // routes: route_id,agency_id,route_short_name,route_long_name,...
  const routesH = routes[0]; const ciRid = col(routesH, 'route_id'); const ciRlong = col(routesH, 'route_long_name');
  const routeNames = {};
  for (const r of routes.slice(1)) {
    if (r[ciRid]) routeNames[r[ciRid]] = r[ciRlong] || r[ciRid];
  }

  // trips: trip_id -> { route_id, headsign }
  const tripsH = trips[0]; const ciRoute = col(tripsH, 'route_id'); const ciTrip = col(tripsH, 'trip_id'); const ciHead = col(tripsH, 'trip_headsign');
  const tripInfo = {};
  for (const t of trips.slice(1)) {
    if (!t[ciTrip]) continue;
    tripInfo[t[ciTrip]] = { route_id: t[ciRoute] || '', headsign: t[ciHead] || '' };
  }

  // stops: stop_id -> name / name -> stop_id[]
  const stopsH = stops[0]; const ciSid = col(stopsH, 'stop_id'); const ciSname = col(stopsH, 'stop_name');
  const stopNameToIds = {}; const stopIdToName = {};
  for (const s of stops.slice(1)) {
    const id = s[ciSid], name = s[ciSname];
    if (!id || !name) continue;
    stopIdToName[id] = name;
    const key = name.replace(/\s+/g, '');
    (stopNameToIds[key] = stopNameToIds[key] || []).push(id);
  }

  // stop_times: stop_id -> [{trip_id, departure}]
  const stH = stopTimes[0]; const ciStTrip = col(stH, 'trip_id'); const ciStDep = col(stH, 'departure_time'); const ciStStop = col(stH, 'stop_id');
  const stopTimesByStop = {};
  for (const r of stopTimes.slice(1)) {
    const stopId = r[ciStStop], dep = r[ciStDep], tripId = r[ciStTrip];
    if (!stopId || !dep) continue;
    (stopTimesByStop[stopId] = stopTimesByStop[stopId] || []).push({ trip_id: tripId, departure: dep });
  }

  const data = { routeNames, tripInfo, stopNameToIds, stopIdToName, stopTimesByStop };
  cache = { data, ts: Date.now() };
  return data;
}

/**
 * 指定駅の都営鉄道時刻表（GTFSベース）を返す。該当なしは null。
 * @returns {{ railway, destination, departure_time }[]} | null
 */
export async function getToeiGtfsStationTimetable(stationName) {
  const key = String(stationName || '').replace(/\s+/g, '');
  if (!key) return null;
  try {
    const g = await loadToeiTrainGtfs();
    const stopIds = g.stopNameToIds[key];
    if (!stopIds || !stopIds.length) return null;

    // stop_id ごとの発車時刻（trip）を収集し、路線×行先でグループ化
    const byGroup = {};
    for (const stopId of stopIds) {
      for (const { trip_id, departure } of (g.stopTimesByStop[stopId] || [])) {
        const info = g.tripInfo[trip_id];
        if (!info) continue;
        const routeName = g.routeNames[info.route_id] || info.route_id;
        const dest = info.headsign || '';
        const gk = `${routeName}|${dest}`;
        if (!byGroup[gk]) byGroup[gk] = { railway: routeName, destination: dest, times: [] };
        byGroup[gk].times.push(departure.slice(0, 5)); // "HH:MM:SS" -> "HH:MM"
      }
    }

    const lines = Object.values(byGroup)
      .map(l => ({ railway: l.railway, destination: l.destination, departure_time: [...new Set(l.times)].sort().join(', ') }))
      .sort((a, b) => a.railway.localeCompare(b.railway, 'ja') || a.destination.localeCompare(b.destination, 'ja'));
    return lines.length ? lines : null;
  } catch (_) {
    return null; // GTFS取得・パース失敗時はフォールバックなし（従来通り NO_DATA）
  }
}
