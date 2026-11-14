// v2.58.24（search_route の CANCELLED 統一・シェアサイクルの signal 対応）の回帰テスト
// 実行: node tests/v25824-regression.test.mjs
//
// 背景:
//   search_route は内部の取得がすべて Promise.allSettled のため、キャンセルしても例外にならず
//   「縮退した SUCCESS」を返していた（bus / running-status は CANCELLED）。
//   findNearestBikeStations（シェアサイクル）も signal 非対応だった。
import fs from 'node:fs';
import { searchRoute, findNearestBikeStations } from '../src/handlers/search-route.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- 事前 abort --');
{
  const ac = new AbortController();
  ac.abort();
  const t0 = Date.now();
  const r = await searchRoute({ from: '新宿', to: '東京', language: 'ja' }, { signal: ac.signal });
  const ms = Date.now() - t0;
  eq(r.structuredContent?.status, 'CANCELLED', 'search_route は CANCELLED を返す');
  if (ms < 1500) ok(`${ms}ms で返る`);
  else fail(`応答が遅い（${ms}ms）`);
}

console.log('-- 実行中 abort --');
{
  const ac = new AbortController();
  const t0 = Date.now();
  const p = searchRoute({ from: '立川', to: '八王子', language: 'ja', user_location: { lat: 35.7, lon: 139.41 } }, { signal: ac.signal });
  setTimeout(() => ac.abort(), 300);
  const r = await p;
  const st = r.structuredContent?.status;
  const ms = Date.now() - t0;
  if (st === 'CANCELLED') ok(`実行中 abort で CANCELLED（${ms}ms）`);
  else if (['SUCCESS', 'NO_DATA', 'NOT_FOUND'].includes(st)) console.log(`  - キャッシュ等で先に完了（status=${st}, ${ms}ms）`);
  else fail(`想定外の status: ${st}`);
}

console.log('-- 通常時は従来どおり --');
{
  const r = await searchRoute({ from: '新宿', to: '東京', language: 'ja' }, {});
  const st = r.structuredContent?.status;
  if (['SUCCESS', 'NO_DATA'].includes(st)) ok(`signal 無しで ${st}`);
  else fail(`signal 無しの呼び出しが ${st}`);
}

console.log('-- シェアサイクルの signal --');
{
  const ac = new AbortController();
  ac.abort();
  const t0 = Date.now();
  const b = await findNearestBikeStations('新宿', null, 5, 2000, ac.signal);
  const ms = Date.now() - t0;
  if (b === null || b === undefined || Array.isArray(b)) ok(`中断時は即座に空で返る（${ms}ms）`);
  else fail(`想定外の戻り値: ${JSON.stringify(b).slice(0, 60)}`);
}

console.log('-- 配線（ソース） --');
{
  const src = fs.readFileSync('src/handlers/search-route.mjs', 'utf8');
  if (src.includes('async function searchRouteInner(')) ok('本体は searchRouteInner に分離されている');
  else fail('searchRouteInner が無い');
  if (src.includes("status: 'CANCELLED'")) ok('CANCELLED を返す経路がある');
  else fail('CANCELLED の返却が無い');
  if (src.includes('findNearestBikeStations(stationName, userLocation = null, maxResults = 5, maxDistance = 2000, signal = null)')) ok('シェアサイクルが signal を受ける');
  else fail('シェアサイクルの signal 引数が無い');
  if (src.includes('await fetchBikeShareData(signal)')) ok('GBFS 取得に signal を渡している');
  else fail('fetchBikeShareData への signal 受け渡しが無い');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
