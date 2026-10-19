/**
 * 共有状態（シングルトン）— tokyo-transit-mcp モノリス分割（Phase 1）
 *
 * 依存: dotenv / node:url のみ。axios・MCP SDK には依存しない。
 * 全モジュールがここから import して共有する:
 *   - envConfig / API 定数
 *   - CircuitBreaker クラス / odptBreaker / jmaBreaker
 *   - cache（統一キャッシュ管理）
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// MCP stdio プロトコル保護: stdout は JSON-RPC 専用（console.log は stderr へ）
// 他モジュールより先に評価されるよう、index.mjs から最初に import する。
console.log = (...args) => console.error('[log]', ...args);
console.debug = console.info = console.log;

// APIキーはMCPクライアントのenvではなく、プロジェクトルートの.envだけから読み込む。
// MCPクライアントの起動時カレントディレクトリに依存しないよう、src/config.mjs基準で解決する。
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const { parsed: envConfig, error: envConfigError } = loadDotenv({ path: envPath });

const API_BASE_URL = 'https://api.odpt.org/api/v4';
const API_KEY = envConfig?.ODPT_API_KEY;
const FLIGHT_API_KEY = envConfig?.FLIGHT_API_KEY; // AviationStack (optional)
const FLIGHT_API_BASE = 'https://api.aviationstack.com/v1';

if (!API_KEY) {
  console.warn('Warning: ODPT_API_KEY is not set in .env file, proceeding without key');
}
if (!FLIGHT_API_KEY) {
  console.warn('Warning: FLIGHT_API_KEY is not set; flight status will be unavailable (graceful degradation to airport access routes only)');
}

// ==========================================
// 🛡️ サーキットブレイカー（段階的クールダウン）
// ==========================================
class CircuitBreaker {
  constructor(name, failureThreshold = 3, cooldownPeriod = 180000) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.baseCooldown = cooldownPeriod;
    this.cooldownPeriod = cooldownPeriod;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.tripCount = 0; // サーキットを開放した累積エピソード数（#93: 段階的クールダウン用）
    this.lastStateChanged = Date.now();
  }

  canExecute() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastStateChanged > this.cooldownPeriod) {
        this.setState('HALF-OPEN');
        return true;
      }
      return false;
    }
    return true;
  }

  onSuccess() {
    this.failureCount = 0;
    this.tripCount = 0; // 完全回復で段階クールダウンをリセット
    this.cooldownPeriod = this.baseCooldown;
    this.setState('CLOSED');
  }

  onFailure(error) {
    // 401/403 は一時障害ではなくAPIキー・権限設定の問題。設定不備で
    // 全ODPT機能をCircuit Breaker OPENにしない。
    const status = error?.response?.status;
    if (status === 401 || status === 403) return;
    // 🔴 v2.58.3: 404/410 は「そのリソースが存在しない」= 恒久的な不在であり、
    // 回復不能。GTFS ファイル（旧 date の期限切れなど）が 404 になるたびに
    // カウントすると、failureThreshold(3) に達してブレーカーが OPEN になり、
    // 鉄道の時刻表・運賃検索（JSON API）まで巻き込んで全面停止していた（実測）。
    // 恒久不在は失敗カウントに含めない（回路上の別リソース取得は影響されない）。
    if (status === 404 || status === 410) return;
    // 🔴 v2.58.7: 429（レート制限）も失敗カウントに含めない。
    //   429 は一時的なレート制限であり、リトライ（retryOnRateLimit）で回復する。
    //   含めると、並列取得の瞬間に 429 が数件発生してブレーカーが OPEN になり、
    //   検索系ツールが一斉に失敗した（実測: probe 19/29 PASS）。
    if (status === 429) return;
    this.failureCount++;
    if (this.state === 'HALF-OPEN' || this.failureCount >= this.failureThreshold) {
      // #93 修正: 段階的クールダウンは「サーキットを開放したエピソード回数」に応じて
      // 60秒→120秒→180秒と単調に延長する。従来は failureCount ベースだったため、
      // threshold>1 ではオープン直前に 60/120秒の値が上書きされ一度も参照されなかった。
      // エピソード方式にすることで全段階の値が実際に利用される。
      // 🔴 v2.58.3: OPEN 中の追加失敗では段階を進めずクールダウンを据え置く
      // （従来は OPEN 中の失敗でも tripCount が増えて 180秒固定に張り付いた）。
      if (this.state !== 'OPEN') {
        this.tripCount++;
        if (this.tripCount === 1) this.cooldownPeriod = 60000;
        else if (this.tripCount === 2) this.cooldownPeriod = 120000;
        else this.cooldownPeriod = 180000;
      }
      this.setState('OPEN');
    }
  }

  setState(newState) {
    if (this.state !== newState) {
      this.state = newState;
      this.lastStateChanged = Date.now();
      if (newState === 'CLOSED') {
        this.failureCount = 0;
        this.cooldownPeriod = this.baseCooldown;
      }
    }
  }
}

const odptBreaker = new CircuitBreaker('ODPT_API_BREAKER', 3, 180000);
const jmaBreaker = new CircuitBreaker('JMA_API_BREAKER', 2, 120000);

// ==========================================
// 🐢 ODPT API 並列制御とレート制限（429）対策
// ==========================================
// 🔴 v2.58.7: ODPT API は同一キーの同時リクエストが多いと HTTP 429 を返す。
//   GTFS ソースを並列化した際（v2.58.7）、同時リクエスト数の増加で 429 が頻発し、
//   odptBreaker が OPEN になって検索系ツールが一斉に失敗した（実測: probe 19/29 PASS）。
//   → 429 は「一時的なレート制限」であり回復可能なので、ブレーカーの失敗カウントには含めない。
//   → 代わりに指数バックオフでリトライする。

// ODPT API への同時接続数の上限（429 を避けるためのグローバルなセマフォ）
const ODPT_MAX_CONCURRENCY = 3;
let _odptActive = 0;
const _odptQueue = [];
// 🔴 v2.58.7: ODPT のレート制限は「同時接続数」だけでなく短時間の累計リクエスト数でも生じる。
//   probe-all-lang は 29 ケースを逐次実行し、その間に ODPT へ数百リクエストが飛ぶため、
//   累積で 429 が発生し、search_flight まで巻き込まれた（実測: 29件中4〜10件が FAIL）。
//   → 同時接続数に加えて「最小リクエスト間隔」を設けて確実に上限内に収める。
const ODPT_MIN_INTERVAL_MS = 120;

// 直近のリクエスト時刻（全体で共有）
let _odptLastRequestAt = 0;

/** ODPT API 呼び出しを同時 ODPT_MAX_CONCURRENCY 件・最小間隔 ODPT_MIN_INTERVAL_MS に制限する */
export async function withOdptSlot(fn) {
  if (_odptActive >= ODPT_MAX_CONCURRENCY) {
    await new Promise(resolve => _odptQueue.push(resolve));
  }
  _odptActive++;
  try {
    // 最小間隔を保証する（直前のリクエストから ODPT_MIN_INTERVAL_MS 以上あける）
    const now = Date.now();
    const waitMs = _odptLastRequestAt + ODPT_MIN_INTERVAL_MS - now;
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    _odptLastRequestAt = Date.now();
    return await fn();
  } finally {
    _odptActive--;
    const next = _odptQueue.shift();
    if (next) next();
  }
}

/**
 * 429（レート制限）に対応するリトライ。
 * - 429 はサーキットブレーカーに失敗を通知しない（回復可能な一時障害のため）
 * - Retry-After ヘッダがあればそれを、なければ指数バックオフ（1s→2s→4s）を使う
 */
export async function retryOnRateLimit(fn, { maxRetries = 5, label = 'ODPT' } = {}) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withOdptSlot(fn);
    } catch (e) {
      const status = e?.response?.status;
      if (status !== 429 || attempt === maxRetries) throw e;
      const retryAfter = Number(e?.response?.headers?.['retry-after']);
      // 🔴 v2.58.7: 待機時間を 1s→2s→4s→8s→16s と伸ばす（最大5回）。
      //   短い間隔だと ODPT のウィンドウ内に再送出され続けて失敗する（実測: 3回では 429 継続）。
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : delay;
      console.warn(`[${label}] HTTP 429 レート制限のため ${waitMs}ms 待機してリトライ (${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, waitMs));
      delay *= 2;
    }
  }
}

// ==========================================
// 📦 統一キャッシュ管理
// ==========================================
const CACHE_MAX_ENTRIES = 2000; // メモリリーク防止: 上限を超えたら最も古いエントリを削除
const cache = {
  _store: new Map(),
  get(key) {
    const c = this._store.get(key);
    if (c === undefined) return null;
    if (Date.now() - c.ts >= c.ttl) { this._store.delete(key); return null; }
    // 参照されたエントリを末尾へ移動し、容量超過時に真のLRUとして扱う。
    this._store.delete(key);
    this._store.set(key, c);
    return c.data;
  },
  set(key, data, ttlMs) {
    // #93: 上限超過時は最古エントリ（挿入順の先頭）を O(1) で逐出（LRU近似）。
    // 従来は Object.entries の O(N) 全走査で最古を探していた。
    if (!this._store.has(key) && this._store.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = this._store.keys().next().value;
      if (oldestKey !== undefined) this._store.delete(oldestKey);
    }
    this._store.set(key, { data, ts: Date.now(), ttl: ttlMs });
  },
  // 個別キャッシュ定義
  bikeShare: { key: 'bike_share', ttl: 30000 },
  ferryGtfs: { key: 'ferry_gtfs', ttl: 3600000 },
  jmaWeather: { key: 'jma_weather', ttl: 600000 },
  // 津波警報は即時性を優先。5分間だけキャッシュし、フェリー検索の安全判定に用いる。
  jmaTsunami: { key: 'jma_tsunami', ttl: 300000 },
  // 国土地理院の自治体別指定緊急避難場所データ。更新頻度を考慮して6時間キャッシュ。
  gsiEmergencyShelters: { key: 'gsi_emergency_shelters', ttl: 21600000 },
  railwayFare: { key: 'railway_fare', ttl: 86400000 },
  stationRomanToJa: { key: 'station_roman_to_ja', ttl: 86400000 },
  trainTimetable: { key: 'train_timetable', ttl: 3600000 },
  busData: { key: 'bus_data', ttl: 600000 },
  // 🔴 v2.58.7: バス時刻表（ノンステップ情報）のキャッシュを 10分→1時間へ延長。
  //   odpt:BusTimetable は 1社あたり 7.5MB と ODPT への要求バイト数が大きく、
  //   短時間に再取得するとレート制限（429）で breaker が OPEN になる（実測）。
  //   ノンステップ車両情報の変化は緩やかなため 1時間 TTL で問題ない。
  busTimetable: { key: 'bus_timetable', ttl: 3600000 },
  busGraph: { key: 'bus_graph', ttl: 600000 },
  busStopGeo: { key: 'bus_stop_geo', ttl: 600000 },
  stationGeo: { key: 'station_geo', ttl: 600000 },
  // 🔴 v2.58.7: GTFS 静的 ZIP バッファのキャッシュ。
  //   GTFS zip は1事業者あたり数MB〜10MB超（川崎市バスは7.4MB）で、
  //   `date=current` ごとに再取得・再解凍・再パースしていた。
  //   search_bus 1回の呼出で 7事業者ぶんの zip を落とすため、
  //   初回の probe-all-lang では search_bus だけで 156秒（最悪80秒）を要していた（実測）。
  //   → zip バッファをメモリ＋ディスク（.cache/gtfs）へ二重キャッシュし、
  //     プロセス再起動をまたいでも再ダウンロードを避ける。
  //   TTL は1時間（事業者はダイヤ改正のたびに更新するため日単位では長すぎる）。
  gtfsZip: { key: 'gtfs_zip', ttl: 3600000 },
  flightData: { key: 'flight_data', ttl: 60000 } // リアルタイム性重視（60s）
};

export {
  envConfig,
  envConfigError,
  API_BASE_URL,
  API_KEY,
  FLIGHT_API_KEY,
  FLIGHT_API_BASE,
  CircuitBreaker,
  odptBreaker,
  jmaBreaker,
  cache,
};
