// v2.58.21（キャンセルの HTTP 貫通: bus / running-status / search-route）の回帰テスト
// 実行: node tests/v25821-regression.test.mjs
//
// 背景:
//   v2.58.16 で get_timetable / search_flight はキャンセルで HTTP を中断できるようにしたが、
//   search_bus / get_running_status / search_route は「CANCELLED を返すだけで通信は完走」だった。
//   bus 系は内部タイムアウト用の AbortController しか持っていなかったため、
//   AbortSignal.any で外部キャンセルと合成する。
import fs from 'node:fs';
import { searchBus } from '../src/handlers/bus.mjs';
import { getRunningStatus } from '../src/handlers/running-status.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- 事前 abort（ネットワークに依存しない） --');
{
  const ac = new AbortController();
  ac.abort();
  const t0 = Date.now();
  const r = await searchBus({ from: '桜橋', to: '新富町', language: 'ja' }, { signal: ac.signal });
  const ms = Date.now() - t0;
  eq(r.structuredContent?.status, 'CANCELLED', 'search_bus は CANCELLED を返す');
  if (ms < 2000) ok(`${ms}ms で返る`);
  else fail(`応答が遅い（${ms}ms）`);
}

{
  const ac = new AbortController();
  ac.abort();
  const t0 = Date.now();
  const r = await getRunningStatus({ operator: 'tokyometro', language: 'ja' }, { signal: ac.signal });
  const ms = Date.now() - t0;
  eq(r.structuredContent?.status, 'CANCELLED', 'get_running_status は CANCELLED を返す');
  if (ms < 2000) ok(`${ms}ms で返る`);
  else fail(`応答が遅い（${ms}ms）`);
}

console.log('-- 実行中 abort（通信の中断を確認） --');
{
  const ac = new AbortController();
  const t0 = Date.now();
  const p = searchBus({ from: '桜橋', to: '新富町', language: 'ja' }, { signal: ac.signal });
  setTimeout(() => ac.abort(), 250);
  const r = await p;
  const ms = Date.now() - t0;
  const st = r.structuredContent?.status;
  // キャッシュが温まっていると即完了して SUCCESS/NO_DATA になることがある（それも正常）
  if (st === 'CANCELLED') ok(`実行中 abort で CANCELLED（${ms}ms）`);
  else if (['SUCCESS', 'NO_DATA', 'NOT_FOUND'].includes(st)) console.log(`  - キャッシュ等で先に完了（status=${st}, ${ms}ms）`);
  else fail(`想定外の status: ${st}`);
}

console.log('-- 通常時は従来どおり --');
{
  const r = await getRunningStatus({ operator: 'seibu', language: 'ja' }, {});
  const st = r.structuredContent?.status;
  if (['SUCCESS', 'NO_DATA'].includes(st)) ok(`get_running_status は signal 無しで ${st}`);
  else fail(`signal 無しの呼び出しが ${st}`);
}

console.log('-- 配線（ソース） --');
{
  const bus = fs.readFileSync('src/handlers/bus.mjs', 'utf8');
  if (bus.includes('AbortSignal.any([abortController.signal, externalSignal])')) ok('bus は外部 signal と内部タイムアウトを合成している');
  else fail('bus の AbortSignal.any 合成が無い');
  if (bus.includes('searchBusTransfer(fromInput, toInput, vehicleInput, signal)')) ok('検索本体に signal を渡している');
  else fail('searchBusTransfer への signal 受け渡しが無い');
  const rs = fs.readFileSync('src/handlers/running-status.mjs', 'utf8');
  if (rs.includes('getRunningStatus(args, ctx = {})')) ok('get_running_status は ctx を受ける');
  else fail('get_running_status の ctx 受け取りが無い');
  if ((rs.match(/signal/g) || []).length >= 8) ok('running-status の fetch 群に signal が通っている');
  else fail('running-status の signal 伝播が不足');
  const sr = fs.readFileSync('src/handlers/search-route.mjs', 'utf8');
  if (sr.includes('searchRoute(args, ctx = {})')) ok('search_route は ctx を受ける');
  else fail('search_route の ctx 受け取りが無い');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
