/**
 * プローブ（live API 検証）用のレート制限リトライ。
 *
 * 背景:
 *   probe-all-lang.mjs は全 13 ツール × 3 言語を連続実行するため ODPT のレート制限
 *   （HTTP 429 → error_type: API_TIMEOUT）やサーキットブレーカーの OPEN を踏むことがある。
 *   実測: 同じコードで 29/29 PASS の回にも 4 件 FAIL した（3 分待つと全 PASS）。
 *   コードの退行とレート制限を区別するため、**リトライ可能なエラーだけ**を待って再試行する。
 */

const RETRYABLE_TYPES = new Set([
  'API_TIMEOUT',       // 429 / timeout
  'NETWORK_ERROR',
  'API_SERVER_ERROR',  // 5xx
  'CIRCUIT_BREAKER_OPEN',
  'RATE_LIMITED',
]);

const RETRYABLE_PATTERN = /429|rate.?limit|too many requests|timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up|circuit.?breaker|breaker/i;

export function isRetryableResult(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.status === 'CIRCUIT_BREAKER_OPEN') return true;
  if (data.status !== 'ERROR') return false;
  if (RETRYABLE_TYPES.has(data.error_type)) return true;
  return RETRYABLE_PATTERN.test(`${data.error_type || ''} ${data.error_message || ''}`);
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fn() の結果がリトライ可能なエラーなら待って再試行する。
 * @returns {{ data: any, attempts: number }}
 */
export async function withRateLimitRetry(fn, { retries = 2, waits = [5000, 15000], log = () => {}, sleep = realSleep } = {}) {
  let attempts = 0;
  for (;;) {
    const data = await fn();
    attempts++;
    if (!isRetryableResult(data) || attempts > retries) return { data, attempts };
    const wait = waits[Math.min(attempts - 1, waits.length - 1)];
    log(`リトライ ${attempts}/${retries}（${data.error_type || data.status}）: ${wait}ms 待機`);
    await sleep(wait);
  }
}
