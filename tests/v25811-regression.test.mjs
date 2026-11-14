// v2.58.11 監査修正（バッチ2）の回帰テスト
// 実行: node tests/v25811-regression.test.mjs
//
// 背景: 4層監査で確定した残りの不具合の回帰防止。
//   D-3 座標キー「大島」が伊豆大島港と都営新宿線駅で衝突（差 107.8km、モジュール間で解決先が反転）
//   P-3 get_timetable が 42 本を無制限並列で取得し、railway フィルタが取得に効かず 55MB を捨てていた
//   P-4 部分失敗（429 で一部だけ落ちた）時刻表を 1 時間「完全なスナップショット」としてキャッシュ
//   H-4 search_bus の vehicle:'ferry' が絶対に達成不能（ferry 辺 0 本）なのに鉄道経路を返していた
//   H-5 「データ無し」が 4 語彙（NO_DATA / NOT_FOUND / SUCCESS+null / SUCCESS+available:false）に分裂
import { STATION_COORDS } from '../src/data/railway-lines.mjs';
import { STATION_COORDS_EXTRA } from '../src/data/station-coords-extra.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

const haversine = (p, q) => {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(q.lat - p.lat), dLon = rad(q.lon - p.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

console.log('-- 座標キー「大島」の名前空間分離 (D-3) --');
{
  eq(STATION_COORDS['大島'], undefined, 'STATION_COORDS に駅と衝突する素の「大島」が無い');
  const port = STATION_COORDS['大島（伊豆大島）'];
  const st = STATION_COORDS_EXTRA['大島'];
  if (port && st) ok('港は「大島（伊豆大島）」、駅は STATION_COORDS_EXTRA の「大島」に分離されている');
  else fail(`分離できていない: port=${JSON.stringify(port)} station=${JSON.stringify(st)}`);
  if (port && st) {
    const d = haversine(port, { lat: st[0], lon: st[1] });
    if (d > 100) ok(`港と駅の距離は ${d.toFixed(1)}km（別地点であることを確認）`);
    else fail(`港と駅が近すぎる: ${d.toFixed(2)}km`);
  }
}

// ---- ここから下は ODPT への実通信を含む（未達時は SKIP）----
const { searchFare } = await import('../src/handlers/fare.mjs');
const { searchFerry } = await import('../src/handlers/ferry.mjs');
const { searchBusTransfer } = await import('../src/handlers/bus.mjs');
const { getTimetable } = await import('../src/handlers/timetable.mjs');

let NET_OK = true;
try {
  const probe = await searchFare({ from: '新宿', to: '東京', language: 'ja' });
  if (!probe?.structuredContent) NET_OK = false;
} catch {
  NET_OK = false;
}
if (!NET_OK) {
  console.log('  - ODPT に到達できないため通信系の検証は SKIP');
}

if (NET_OK) {
  console.log('-- 「データ無し」の語彙統一 (H-5) --');
  {
    const fare = await searchFare({ from: '新宿', to: '立川', language: 'en' });
    const sc = fare.structuredContent || {};
    if (sc.status === 'NO_DATA') ok('search_fare の該当なしは NO_DATA');
    else fail(`search_fare の該当なしが ${sc.status}（NO_DATA でない）`);
    eq(!!fare.isError, false, 'NO_DATA に isError を付けない（失敗ではなく該当なし）');

    const ferry = await searchFerry({ from_port: '浅草', to_port: '大島', language: 'en' });
    const fc = ferry.structuredContent || {};
    if (fc.status === 'NO_DATA') ok('search_ferry の航路なしは NO_DATA');
    else fail(`search_ferry の航路なしが ${fc.status}（NO_DATA でない）`);
  }

  console.log('-- search_bus の vehicle:ferry (H-4) --');
  {
    const r = await searchBusTransfer('竹芝', '大島', 'ferry');
    eq(r.found, false, 'ferry 指定は「経路なし（誘導）」で返る');
    eq(!!r.ferryRedirect, true, 'search_ferry への誘導フラグが立つ');
    eq(!!r.vehicleFallback, false, '黙って鉄道経路へ差し替えない（vehicleFallback を立てない）');
    const anyR = await searchBusTransfer('竹芝', '大島', 'any');
    eq(!!anyR.found, true, 'vehicle:any は従来通り経路を返す（退行していない）');
  }

  console.log('-- get_timetable の取得範囲と部分失敗 (P-3 / P-4) --');
  {
    const t0 = Date.now();
    const jr = await getTimetable({ station_name: '新宿', railway: 'JR山手線', language: 'ja' });
    const jrMs = Date.now() - t0;
    const jsc = jr.structuredContent || {};
    eq(jsc.status, 'NO_DATA', 'ODPT 対象外の路線は NO_DATA');
    if (jrMs < 3000) ok(`対象外の路線は取得せずに即返る（実測 ${jrMs}ms）`);
    else fail(`対象外なのに ${jrMs}ms かかった（全量取得している疑い）`);

    const gz = await getTimetable({ station_name: '銀座', railway: '銀座線', language: 'ja' });
    const gsc = gz.structuredContent || {};
    eq(gsc.status, 'SUCCESS', 'フィルタした路線は SUCCESS');
    if (Array.isArray(gsc.timetable) && gsc.timetable.length > 0) {
      const lines = new Set(gsc.timetable.map((r) => r.railway));
      if (lines.size === 1) ok(`フィルタした 1 路線だけが返る（${[...lines][0]}）`);
      else fail(`複数路線が混入: ${[...lines].join(' / ')}`);
    } else fail('timetable が空');

    const full = await getTimetable({ station_name: '新宿', language: 'ja' });
    const fsc = full.structuredContent || {};
    eq(fsc.status, 'SUCCESS', 'フィルタ無しは SUCCESS');
    if (fsc.partial === undefined) ok('部分失敗フラグが立っていない（正常取得）');
    else console.log(`  - 今回は partial=${fsc.partial} / missing=${fsc.missing_sources}（429 が発生した）`);
  }
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
