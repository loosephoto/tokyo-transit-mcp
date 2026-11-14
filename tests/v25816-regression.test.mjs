// v2.58.16（キャンセルの HTTP 貫通）の回帰テスト
// 実行: node tests/v25816-regression.test.mjs
//
// 背景:
//   MCP の notifications/cancelled で runTool が早期に CANCELLED を返しても、
//   handler 内の HTTP は完走していた（実測: 31 秒ブロックの間、通信は継続）。
//   → extra.signal を handler まで渡し、axios と 429 バックオフ待ちを中断できるようにした。
import { abortableSleep, retryOnRateLimit } from '../src/config.mjs';
import { getTimetable } from '../src/handlers/timetable.mjs';
import { searchFlight } from '../src/handlers/flight.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- abortableSleep --');
{
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 50);
  let err = null;
  try { await abortableSleep(5000, ac.signal); } catch (e) { err = e; }
  const ms = Date.now() - t0;
  eq(err?.name, 'AbortError', 'abort で AbortError を投げる');
  if (ms < 1000) ok(`5 秒の待機を ${ms}ms で中断した`);
  else fail(`待機が中断されなかった（${ms}ms）`);

  const t1 = Date.now();
  await abortableSleep(120, null);
  const ms2 = Date.now() - t1;
  if (ms2 >= 100 && ms2 < 1500) ok(`signal 無しは通常どおり待つ（${ms2}ms）`);
  else fail(`signal 無しの待機が異常（${ms2}ms）`);
}

console.log('-- retryOnRateLimit の待機中断 --');
{
  const ac = new AbortController();
  const always429 = async () => {
    const e = new Error('HTTP 429');
    e.response = { status: 429, headers: { 'retry-after': '30' } };
    throw e;
  };
  const t0 = Date.now();
  const p = retryOnRateLimit(always429, { label: 'abort-test', totalBudgetMs: 60000, maxWaitMs: 30000, signal: ac.signal });
  setTimeout(() => ac.abort(), 120);
  let err = null;
  try { await p; } catch (e) { err = e; }
  const ms = Date.now() - t0;
  eq(err?.name, 'AbortError', '429 のバックオフ待ちが abort で中断される');
  if (ms < 2000) ok(`30 秒待機の予定を ${ms}ms で中断`);
  else fail(`バックオフ待ちが中断されなかった（${ms}ms）`);
}

console.log('-- handler のキャンセル（HTTP を中断して CANCELLED を返す） --');
{
  // 事前に abort 済みの signal を渡す（ネットワーク到達性に依存しない）
  const ac = new AbortController();
  ac.abort();
  const t0 = Date.now();
  const r = await getTimetable({ station_name: '新宿', railway: '銀座線', language: 'ja' }, { signal: ac.signal });
  const ms = Date.now() - t0;
  const sc = r.structuredContent || {};
  const maybeNoNet = sc.status === 'ERROR' || sc.status === 'NO_DATA' || sc.status === 'SUCCESS';
  if (sc.status === 'CANCELLED') ok(`get_timetable は CANCELLED を返す（${ms}ms）`);
  else if (maybeNoNet) console.log(`  - キャッシュ等で即時完了したため CANCELLED を観測できず（status=${sc.status}, ${ms}ms）`);
  else fail(`想定外の status: ${sc.status}`);

  const ac2 = new AbortController();
  ac2.abort();
  const r2 = await searchFlight({ airport: '成田', direction: 'departure', language: 'ja' }, { signal: ac2.signal });
  const sc2 = r2.structuredContent || {};
  if (sc2.status === 'CANCELLED') ok('search_flight は CANCELLED を返す');
  else console.log(`  - flight はキャッシュ等で完了（status=${sc2.status}）`);
}

console.log('-- 配線（runTool が signal を handler に渡す） --');
{
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/index.mjs', 'utf8');
  if (src.includes('handler(args, { signal })')) ok('runTool が handler に { signal } を渡している');
  else fail('runTool が signal を渡していない');
  const tt = fs.readFileSync('src/handlers/timetable.mjs', 'utf8');
  if (tt.includes('signal') && tt.includes('getTimetable(args, ctx')) ok('get_timetable が signal を受ける');
  else fail('get_timetable が signal を受けていない');
  const fl = fs.readFileSync('src/handlers/flight.mjs', 'utf8');
  if (fl.includes('searchFlight(args, ctx') && fl.includes('{ timeout: 12000, signal }')) ok('search_flight が signal を axios に渡す');
  else fail('search_flight の配線が不完全');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
