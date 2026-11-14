// v2.58.20（プローブのレート制限リトライ）の回帰テスト
// 実行: node tests/v25820-regression.test.mjs
//
// 背景:
//   npm test の live probe（全 13 ツール × 3 言語）が ODPT のレート制限に当たり、
//   search_fare / get_timetable の en/zh が 4 件 FAIL することがあった（実測 2 回）。
//   同じコードで 3 分後に 29/29 PASS に戻るため、コードの退行ではなくインフラの揺らぎ。
//   → リトライ可能なエラー（429/timeout/5xx/breaker OPEN）だけを待って再試行する。
import { withRateLimitRetry, isRetryableResult } from '../src/lib/probe-retry.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

const noSleep = async () => {};

console.log('-- リトライ対象の判定 --');
{
  eq(isRetryableResult({ status: 'SUCCESS' }), false, 'SUCCESS はリトライしない');
  eq(isRetryableResult({ status: 'NO_DATA' }), false, 'NO_DATA はリトライしない');
  eq(isRetryableResult({ status: 'ERROR', error_type: 'API_TIMEOUT' }), true, '429/timeout（API_TIMEOUT）はリトライ');
  eq(isRetryableResult({ status: 'ERROR', error_type: 'API_SERVER_ERROR' }), true, '5xx はリトライ');
  eq(isRetryableResult({ status: 'ERROR', error_type: 'NETWORK_ERROR' }), true, 'ネットワーク断はリトライ');
  eq(isRetryableResult({ status: 'ERROR', error_type: 'CIRCUIT_BREAKER_OPEN' }), true, 'ブレーカー OPEN はリトライ');
  eq(isRetryableResult({ status: 'ERROR', error_type: 'INVALID_INPUT' }), false, '入力エラーはリトライしない');
  eq(isRetryableResult({ status: 'ERROR', error_type: 'NO_ROUTE' }), false, '経路なしはリトライしない');
  eq(isRetryableResult({ status: 'ERROR', error_message: 'HTTP 429 Too Many Requests' }), true, 'メッセージに 429 があればリトライ');
  eq(isRetryableResult(null), false, 'null はリトライしない');
}

console.log('-- 再試行の挙動 --');
{
  // 1 回目 429 → 2 回目 SUCCESS
  let calls = 0;
  const fn = async () => (++calls === 1
    ? { status: 'ERROR', error_type: 'API_TIMEOUT', error_message: 'timeout of 20000ms exceeded' }
    : { status: 'SUCCESS', total: 3 });
  const logs = [];
  const r = await withRateLimitRetry(fn, { retries: 2, waits: [10, 20], log: (m) => logs.push(m), sleep: noSleep });
  eq(r.data.status, 'SUCCESS', '1 回失敗 → 2 回目で成功');
  eq(r.attempts, 2, '試行回数 2');
  eq(calls, 2, '呼び出し回数 2');
  if (logs.length === 1) ok('リトライをログに残す');
  else fail(`ログ件数が ${logs.length}（期待 1）`);
}

{
  // ずっと 429 → 上限で打ち切り
  let calls = 0;
  const fn = async () => { calls++; return { status: 'ERROR', error_type: 'API_TIMEOUT' }; };
  const r = await withRateLimitRetry(fn, { retries: 2, waits: [1, 1], sleep: noSleep });
  eq(r.data.status, 'ERROR', '上限まで失敗したら ERROR を返す');
  eq(calls, 3, '初回 + リトライ 2 回 = 3 回で打ち切り');
}

{
  // リトライ対象外 → 1 回で終了
  let calls = 0;
  const fn = async () => { calls++; return { status: 'ERROR', error_type: 'INVALID_INPUT' }; };
  const r = await withRateLimitRetry(fn, { retries: 2, waits: [1], sleep: noSleep });
  eq(calls, 1, '入力エラーは再試行しない');
  eq(r.attempts, 1, '試行回数 1');
}

{
  // 成功はそのまま 1 回
  let calls = 0;
  const fn = async () => { calls++; return { status: 'SUCCESS' }; };
  const r = await withRateLimitRetry(fn, { retries: 2, waits: [1], sleep: noSleep });
  eq(calls, 1, '成功時は 1 回だけ');
  eq(r.data.status, 'SUCCESS', '結果をそのまま返す');
}

console.log('-- プローブへの配線 --');
{
  const fs = await import('node:fs');
  const src = fs.readFileSync('scripts/probe-all-lang.mjs', 'utf8');
  if (src.includes('withRateLimitRetry')) ok('probe-all-lang.mjs がリトライを使っている');
  else fail('probe-all-lang.mjs にリトライ配線が無い');
  if (src.includes('retries: 2')) ok('リトライ回数は 2（初回 + 2 回）');
  else fail('リトライ設定が見当たらない');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
