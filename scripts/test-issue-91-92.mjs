// イシュー#91/#92 回帰テスト（ODPT静的GTFS import漏れ・get_station_info 内蔵フォールバック）
// node scripts/test-issue-91-92.mjs
// #91: get_station_info が ODPT未収録駅で internal_graph_fallback を返し、
//      実在しない駅名は STATION_NOT_FOUND（NETWORK_ERROR に化けない）を検証。
// #92: fetchGtfsZipBuffer が lib/gtfs.mjs から双方(ferry/bus)に正しく import され、
//      非 hardCoded の ODPT静的GTFSソースが取得できる（ReferenceError にならない）ことを検証。
import { readFileSync } from 'fs';
import { fetchGtfsZipBuffer } from '../src/lib/gtfs.mjs';
import { BUS_GTFS_SOURCES } from '../src/data/bus-routes.mjs';
import { getStationInfo } from '../src/index.mjs';

let pass = 0, fail = 0;
const assert = (cond, name) => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}`); }
};

const parseResp = (res) => {
  const cont = res?.content || [];
  for (const c of cont) {
    if (c?.type === 'text' && (c.text || '').trim().startsWith('{')) {
      try { const j = JSON.parse(c.text); if (j.status) return j; } catch (e) {}
    }
  }
  return { status: 'UNPARSED' };
};

// ─────────────── #92: GTFS 取得ユーティリティの import 整合性（決定的） ───────────────
// 1) fetchGtfsZipBuffer が lib/gtfs.mjs から export されている
assert(typeof fetchGtfsZipBuffer === 'function', '#92 fetchGtfsZipBuffer が lib/gtfs.mjs から import 可能');

// 2) bus.mjs が lib/gtfs.mjs から import している（handlers → lib 依存・handlers 相互依存なし）
const busSrc = readFileSync(new URL('../src/handlers/bus.mjs', import.meta.url), 'utf8');
assert(/\bfrom '\.\.\/lib\/gtfs\.mjs'/.test(busSrc), '#92 bus.mjs が lib/gtfs.mjs を import');
assert(!/from '\.\/ferry\.mjs'/.test(busSrc), '#92 bus.mjs は ferry.mjs に依存しない（handlers 相互依存回避）');

// 3) ferry.mjs も lib/gtfs.mjs から import（同一実装・定義重複なし）
const ferrySrc = readFileSync(new URL('../src/handlers/ferry.mjs', import.meta.url), 'utf8');
assert(/\bfrom '\.\.\/lib\/gtfs\.mjs'/.test(ferrySrc), '#92 ferry.mjs が lib/gtfs.mjs を import');
assert(!/export async function fetchGtfsZipBuffer/.test(ferrySrc), '#92 ferry.mjs に定義重複なし');

// 4) BUS_GTFS_SOURCES の非 hardCoded ソース（ODPT静的GTFS・{url,date}方式）が正しい構造を持つ
const liveGtfsSources = BUS_GTFS_SOURCES.filter(s => !s.hardCoded);
assert(liveGtfsSources.length >= 5, `#92 ODPT静的GTFSソースが5件以上定義（実測 ${liveGtfsSources.length}件）`);
for (const s of liveGtfsSources) {
  assert(s.url && /^https:\/\/api\.odpt\.org\//.test(s.url), `#92 ${s.name} は ODPT URL を持つ`);
  assert(typeof s.date === 'function', `#92 ${s.name} は date() 関数を持つ`);
}

// 5) 非 hardCoded ソースが fetchGtfsZipBuffer で取得できる（ReferenceError にならない）・ネットワーク縮退時はスキップ
//    ※ 外部 API 依存のため、失敗しても実装バグ(ReferenceError)とネットワーク不可を区別する。
(async () => {
  let refErr = 0, fetched = 0, failed = 0;
  for (const s of liveGtfsSources) {
    try {
      const buf = await fetchGtfsZipBuffer(s, 15000);
      if (buf && buf.length > 0) { fetched++; }
      else { failed++; }
    } catch (e) {
      if (e instanceof ReferenceError || e instanceof TypeError) refErr++;
      else failed++;
      console.log(`   [skip] ${s.name}: ${e?.response?.status || e?.code || e.message}`);
    }
  }
  assert(refErr === 0, '#92 fetchGtfsZipBuffer が ReferenceError/TypeError を出さない（実装バグなし）');
  assert(fetched > 0, `#92 実GTFS取得が少なくとも1件成功（成功 ${fetched}件 / 失敗 ${failed}件 / 内部エラー ${refErr}件）`);
  console.log(`\n[#92] GTFSソース取得結果: 成功 ${fetched} / 失敗 ${failed} / ReferenceError ${refErr}`);

  // ─────────────── #91: get_station_info フォールバック（ODPT 実データ） ───────────────
  // ODPT未収録駅（JR・私鉄）は内蔵グラフから source: internal_graph_fallback を返す
  for (const st of ['高円寺', '西荻窪']) {
    const r = await getStationInfo({ station_name: st });
    const j = parseResp(r);
    assert(j.status === 'SUCCESS' && j.source === 'internal_graph_fallback' && Array.isArray(j.results) && j.results.length > 0,
      `#91 ${st} → SUCCESS + internal_graph_fallback（所属路線 ${Array.isArray(j.results) ? j.results.length : 0}件）`);
  }
  // ローマ字入力も解決
  const koenji = await getStationInfo({ station_name: 'Koenji' });
  const kk = parseResp(koenji);
  assert(kk.status === 'SUCCESS' && kk.source === 'internal_graph_fallback', '#91 Koenji → internal_graph_fallback');

  // 実在しない駅名は STATION_NOT_FOUND（NETWORK_ERROR に化けない・retryable:false）
  const hg = await getStationInfo({ station_name: 'ホグワーツ' });
  const hj = parseResp(hg);
  assert(hj.status === 'ERROR' && hj.error_type === 'STATION_NOT_FOUND' && hj.retryable === false,
    '#91 ホグワーツ → STATION_NOT_FOUND（retryable:false）NETWORK_ERROR でない');

  // ODPT収録駅（東京メトロ）は従来どおり SUCCESS
  const sb = await getStationInfo({ station_name: '渋谷' });
  const sj = parseResp(sb);
  assert(sj.status === 'SUCCESS' && Array.isArray(sj.results) && sj.results.length > 0, '#91 渋谷 → SUCCESS（ODPTデータ）');

  console.log(`\n${fail === 0 ? '✅ 全テスト PASS' : '❌ FAIL あり'} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})();
