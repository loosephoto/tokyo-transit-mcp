/**
 * GTFS-JP 静的GTFS の ZIP 解凍＋CSV パース用ワーカースレッド（#93）
 *
 * 従来は bus.mjs の fetchAllBuses 内で、リクエスト処理中に adm-zip の同期解凍と
 * CSV パース（stop_times.txt は最大95万行）をメインスレッドで実行しており、
 * その間イベントループがブロックされ他の MCP リクエストに応答できなかった。
 *
 * 本ワーカーは zipBuf とソース定義を受け取り、専用スレッド上でパースを行って
 * 結果の停名・系統レコード配列を返す。メインスレッドは完了通知を待つだけでよい。
 *
 * 依存: csv.mjs（parseCsvRecords）/ adm-zip。構造化クローンで受け渡し可能なプレーンなデータのみ扱う。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { parseCsvRecords } from './csv.mjs';

async function parseGtfs(zipBuf, src) {
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

  const records = [];
  const seen = new Set();
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
    let seq = new Map(); // trip_id -> [stop_id, stop_id, minSeq, maxSeq]
    const e = zip.getEntry('stop_times.txt');
    if (e) {
      const rows = parseCsvRecords(e.getData().toString('utf8'));
      if (rows.length) {
        const headers = rows[0] || [];
        const ti = headers.indexOf('trip_id'), si = headers.indexOf('stop_id'), qi = headers.indexOf('stop_sequence');
        for (const vals of rows.slice(1)) {
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

  const opLabel = { label: src.label, labelEn: src.labelEn, labelZh: src.labelZh, website: src.website };
  // 4) 停名レコード（stops.txt）
  for (const s of stopRows) {
    const name = s.stop_name || s.stop_id || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    records.push({
      'odpt:note': name,
      'odpt:busroute': `${src.operatorId}:stop:${s.stop_id}`,
      'odpt:busNumber': '',
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: opLabel,
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
    records.push({
      'odpt:note': note,
      'odpt:busroute': `${src.operatorId}:route:${r.route_id}`,
      'odpt:busNumber': shortName,
      'odpt:frequency': '',
      'odpt:operator': `odpt.Operator:${src.operatorId}`,
      _operatorId: src.operatorId,
      _operatorLabel: opLabel,
      _searchKeys: [shortName, note, origin, dest].filter(Boolean),
      _displayNote: note,
      _gtfsSource: src.name
    });
  }
  return records;
}

parseGtfs(workerData.zipBuf, workerData.src)
  .then(records => parentPort.postMessage({ records }))
  .catch(err => parentPort.postMessage({ error: err?.message || String(err) }));
