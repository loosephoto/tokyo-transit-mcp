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
    this.failureCount++;
    if (this.state === 'HALF-OPEN' || this.failureCount >= this.failureThreshold) {
      // #93 修正: 段階的クールダウンは「サーキットを開放したエピソード回数」に応じて
      // 60秒→120秒→180秒と単調に延長する。従来は failureCount ベースだったため、
      // threshold>1 ではオープン直前に 60/120秒の値が上書きされ一度も参照されなかった。
      // エピソード方式にすることで全段階の値が実際に利用される。
      this.tripCount++;
      if (this.tripCount === 1) this.cooldownPeriod = 60000;
      else if (this.tripCount === 2) this.cooldownPeriod = 120000;
      else this.cooldownPeriod = 180000;
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
  busTimetable: { key: 'bus_timetable', ttl: 600000 },
  busGraph: { key: 'bus_graph', ttl: 600000 },
  busStopGeo: { key: 'bus_stop_geo', ttl: 600000 },
  stationGeo: { key: 'station_geo', ttl: 600000 },
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
