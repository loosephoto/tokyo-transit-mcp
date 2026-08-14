/**
 * 経路探索エンジン・searchRoute ハンドラ（モノリス分割 Phase 4b）
 * 駅名解決（getStationRomanToJa / resolveStation / normalizeStationName）・経路グラフ構築・
 * ダイクストラ探索・特急窓口案内・文化施設・シェアサイクル・searchRoute 本体。
 * 依存: handlers/advice → data/lib → config（一方通行）
 */
import { cache, jmaBreaker, odptBreaker, API_BASE_URL } from '../config.mjs';
import { RAILWAY_LINES, WALK_TRANSFERS, LIGHT_TRANSFER_EDGES, CIRCULAR_LINES,
         AMBIGUOUS_STATION_NAMES, AMBIGUOUS_STATION_LINES, STATION_COORDS } from '../data/railway-lines.mjs';
import { STATION_NAME_MAP, STATION_DISPLAY_NAMES, RAILWAY_NAME_MAP, LINE_DISPLAY_NAMES } from '../data/station-names.mjs';
import { LANDMARK_DEFS, LANDMARK_LOOKUP, DESTINATION_CULTURAL_FACILITIES,
         CULTURAL_CATEGORY_NAMES, DERIVED_CULTURAL_FACILITIES } from '../data/landmarks.mjs';
import { COMMUNITY_BUS_STATION_ACCESS } from '../data/bus-routes.mjs';
import { MULTILINGUAL_ADVICE, NON_RAIL_OPERATORS, EMERGENCY_EVACUATION_SEARCH_URL, GBFS_BASE,
         LIMITED_EXPRESS_KEYWORDS, LIMITED_EXPRESS_STATION_GUIDE, PRIVATE_EXPRESS_GUIDE, JMA_AREA_LABELS } from '../data/misc.mjs';
import { FERRY_PORT_MAP } from '../data/ferry-ports.mjs';
import { getDisplayStationName, getDisplayLineName, getLineDisplayName, getCommunityBusDisplayName,
         getCommunityBusStopDisplayName, detectLanguage, resolveLang, translateWeather, translateTrainInfoDetail } from '../lib/lang.mjs';
import { jsonResponse, buildErrorResponse, getParams, buildGovFacilitySearchSupport } from '../lib/common.mjs';
import { haversineDistance } from '../lib/geo.mjs';
import { parseTestMode, detectFailureType } from '../advice/transit-advice.mjs';
import { getWeatherAdvice, stationToJmaArea } from '../advice/weather.mjs';
import { buildEarthquakeSafetyResponse } from '../advice/earthquake.mjs';
import axios from 'axios';

export async function getStationRomanToJa() {
  // 🔴 #94: モジュール変数の無期限保持をやめ、cache（TTL付き）に一本化。
  // キャッシュ期限切れ後は再取得する（ODPTデータ更新を反映し、古いマップを返し続けない）。
  const cached = cache.get(cache.stationRomanToJa.key);
  if (cached) return cached;
  const map = {};
  // 手動フォールバック: STATION_DISPLAY_NAMES の en 値（ローマ字）→ 日本語
  for (const [ja, trans] of Object.entries(STATION_DISPLAY_NAMES)) {
    if (trans.en) map[trans.en.toLowerCase()] = ja;
  }
  // ODPT odpt:Station から全駅を取得して上書き（より網羅的）
  try {
    const ops = ['TokyoMetro', 'Toei'];
    const responses = await Promise.allSettled(ops.map(op =>
      axios.get(`${API_BASE_URL}/odpt:Station`, { params: getParams(op), timeout: 15000 })
    ));
    for (const r of responses) {
      if (r.status !== 'fulfilled') continue;
      for (const s of (r.value.data || [])) {
        const id = (s['owl:sameAs'] || '').split('.').pop();
        const title = s['dc:title'];
        if (id && title) map[id.toLowerCase()] = title;
      }
    }
  } catch (_) { /* フォールバックのみで続行 */ }
  cache.set(cache.stationRomanToJa.key, map, cache.stationRomanToJa.ttl);
  return map;
};

export function resolveSuspendedLineNames(railwayId) {
  const suffix = String(railwayId || '').split('.').pop().toLowerCase();
  if (!suffix) return [];
  const aliases = Object.entries(RAILWAY_NAME_MAP)
    .filter(([, value]) => String(value).toLowerCase() === suffix)
    .map(([name]) => name);
  const graphLines = new Set(Object.values(STATION_TO_LINES).flat().map(entry => entry.line));
  return [...graphLines].filter(line => aliases.some(alias => line === alias || line.includes(alias)));
}

export async function fetchBikeShareData() {
  const cached = cache.get(cache.bikeShare.key);
  if (cached) return cached;
  const [infoRes, statusRes] = await Promise.all([
    axios.get(`${GBFS_BASE}/station_information.json`, { timeout: 15000 }),
    axios.get(`${GBFS_BASE}/station_status.json`, { timeout: 15000 })
  ]);
  const stations = infoRes.data.data?.stations || [];
  const statuses = statusRes.data.data?.stations || [];
  const statusMap = {};
  statuses.forEach(s => { statusMap[s.station_id] = s; });
  const data = { stations, statuses: statusMap };
  cache.set(cache.bikeShare.key, data, cache.bikeShare.ttl);
  return data;
}

export const STATION_TO_LINES = {};
for (const [lineName, stations] of Object.entries(RAILWAY_LINES)) {
  stations.forEach((st, idx) => {
    if (!STATION_TO_LINES[st]) STATION_TO_LINES[st] = [];
    STATION_TO_LINES[st].push({ line: lineName, index: idx, total: stations.length });
  });
}

// グラフ構築
// ハイパーノード方式: 各(駅, 路線)をノードとし、同一路線内の隣接駅を重み1の「乗車エッジ」、
// 同一駅での路線間を重み TRANSFER_PENALTY の「乗換エッジ」で結ぶ。
// これによりダイクストラは「乗換を避ける・最短時間」の経路を選べる。
const TRANSFER_PENALTY = 10; // 乗換1回 ≈ 駅数10個分（所要時間ペナルティ：実乗換5〜10分相当。v2.28.0で3→10に増強、乗換多数の遠回りを抑制しつつ「1乗換で大幅短縮」を正しく評価する）

// 軽量乗換（同一ホーム・改札内直結等で乗換負担が極めて軽い駅の路線ペア）。
// 通常の乗換エッジ（TRANSFER_PENALTY・乗換1回カウント）の代わりに、軽いコストのみ加算し
// 「乗換回数」にはカウントしない。これにより同コスト帯で乗換回数が少ない遠回りに
// 負ける問題を解消する（例: 新宿→多摩センター が 京王線→高幡不動→多摩モノレール の
// 乗換1回・92分 ではなく 京王線→調布→京王相模原線→京王多摩センター→徒歩連絡 の
// 約70分 を選べるようになる。v2.38.1 新規導入）
const GRAPH = {}; // キー: "駅@路線" または "駅"（隣接駅探索用に駅のみのインデックスも保持）
function addEdge(a, b, w) {
  if (!GRAPH[a]) GRAPH[a] = {};
  if (!GRAPH[b]) GRAPH[b] = {};
  GRAPH[a][b] = w;
  GRAPH[b][a] = w;
}
// 同一路線内の隣接駅を結ぶ（乗車エッジ）。重みは駅間実距離（m）÷100（1km≈10単位）とし、
// 座標未登録の駅はフォールバック重み 10 を使用。これによりダイクストラは実距離が短い経路を選ぶ。
function stationEdgeWeight(a, b) {
  return 1; // 均等重み（駅数ベース）。距離ベースは座標未登録駅で不均一になるため使用しない
}
// 周回路線（リング状に運行する路線）: 末尾駅と先頭駅も隣接エッジで結ぶ。
// 2026-08 v2.26.0: ディズニーリゾートライン（4駅を周回・1周約13分）で初適用。
for (const [lineName, stations] of Object.entries(RAILWAY_LINES)) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = `${stations[i]}@${lineName}`;
    const b = `${stations[i + 1]}@${lineName}`;
    addEdge(a, b, stationEdgeWeight(stations[i], stations[i + 1]));
  }
  // 周回: 最終駅 → 先頭駅 も隣接エッジ（例: 東京ディズニーシー・ステーション ⇔ リゾートゲートウェイ・ステーション）
  if (CIRCULAR_LINES.has(lineName) && stations.length >= 3) {
    const last = `${stations[stations.length - 1]}@${lineName}`;
    const first = `${stations[0]}@${lineName}`;
    addEdge(last, first, stationEdgeWeight(stations[stations.length - 1], stations[0]));
  }
}
// 同一駅での路線間を結ぶ（乗換エッジ）
for (const [st, entries] of Object.entries(STATION_TO_LINES)) {
  const nodes = entries.map(e => `${st}@${e.line}`);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // 軽量乗換（同一ホーム等）: 乗換1回としてカウントせず軽いコストのみ（v2.38.1）
      // 例: 調布 京王線⇔京王相模原線（相模原線は調布始発・同一ホーム乗換）で
      //     新宿→多摩センターが高幡不動経由のモノレール遠回りを選ばず、
      //     京王相模原線経由（約70分）を選べるようにする。
      const lightKey = `${st}|${entries[i].line}|${entries[j].line}`;
      const lightCost = LIGHT_TRANSFER_EDGES[lightKey];
      addEdge(nodes[i], nodes[j], lightCost !== undefined ? lightCost : TRANSFER_PENALTY);
    }
  }
}

// ==========================================
// 近接異名駅（連絡駅）: 名称は異なるが、連絡通路・地下通路・至近距離の徒歩で
// 実質1つの乗換駅として機能する駅の組（例: 牛田(東武伊勢崎線)⇔京成関屋(京成本線)）。
// ルート検索では「徒歩連絡」セグメントとして扱い、乗換1回としてカウントする。
// ※ 公式の連絡駅案内（JR東日本乗換案内・各社連絡駅表）に基づく。
// ==========================================
// 双方向ルックアップ（buildRouteSegments での徒歩連絡検出と徒歩時間取得に使用）
const WALK_TRANSFER_LOOKUP = new Map();
for (const w of WALK_TRANSFERS) {
  WALK_TRANSFER_LOOKUP.set(`${w.from}|${w.to}`, w);
  WALK_TRANSFER_LOOKUP.set(`${w.to}|${w.from}`, w);
}

// 近接異名駅ペアを乗換エッジで接続（全路線ノード間を WALK_TRANSFER_COST で結ぶ）
// 徒歩連絡は「乗換1回」としてカウントする（同駅乗換と同じコスト）。
// ※ これより軽いコストにすると、秋葉原⇔岩本町 等で「徒歩→徒歩の往復」により
//   同駅乗換を回避するバウンス経路が発生するため、必ず TRANSFER_PENALTY 以上とする。
const WALK_TRANSFER_COST = TRANSFER_PENALTY;
for (const w of WALK_TRANSFERS) {
  const fromNodes = (STATION_TO_LINES[w.from] || []).map(e => `${w.from}@${e.line}`);
  const toNodes = (STATION_TO_LINES[w.to] || []).map(e => `${w.to}@${e.line}`);
  for (const a of fromNodes) {
    for (const b of toNodes) {
      // 🔴 既存エッジ（同一路線の乗車エッジ等）を上書きしない。
      // 例: 汐留⇔新橋は両方ゆりかもめに在線し、新橋@ゆりかもめ⇔汐留@ゆりかもめ は
      // 乗車エッジ(重み1)が先に張られている。徒歩エッジで上書きすると
      // 「ゆりかもめ1駅」が消えて徒歩連絡(乗換1回)だけになる（本セッションで実証）。
      // 東京⇔大手町（丸ノ内線）も同類。同路線の徒歩エッジは不要（乗車が最適）なので
      // スキップし、跨路線ペア（例: 新橋@山手線⇔汐留@大江戸線）のみ徒歩エッジを張る。
      if (GRAPH[a] && GRAPH[a][b] !== undefined) continue;
      addEdge(a, b, WALK_TRANSFER_COST);
    }
  }
}

// ==========================================
// 同名別駅: 同じ駅名だが別の場所にある駅（乗換不可・誤認リスク大）。
// グラフ上はマイナー側に識別子を付与して分離済み（例: 小川町（東武東上線））。
// 入力時はサイレント推測せず、検索を中断して候補を提示する（disambiguation）。
// candidates は再入力可能な正式キー（グラフ上の駅名）で返す。
// ==========================================

// #64: 曖昧駅の候補ごとの所属路線名（AMBIGUOUS_STATION_NAMES の候補配列とインデックス対応）。
// 「駅名＋路線名」スペース区切り指定（例: 入谷 相模線）の解決と、
// 候補表示への路線名併記（多言語）に使用する。

// #64: 路線名ヒントの正規化（「線」等のサフィックス除去・大文字小文字統一）。
// 「入谷 相模」と「JR相模線」のような表記差を吸収して部分一致判定を安定させる。

export function normalizeLineHint(s) {
  return s.replace(/線$/, '').replace(/jr/i, '').replace(/東京メトロ/g, '').trim().toLowerCase();
}

export function resolveStation(rawName) {
  if (!rawName) return { station: null, candidates: [], ambiguous: false, exact: false, landmark: null };
  const key = rawName.trim();

  // #64: 「駅名＋路線名」のスペース区切り指定（例: 入谷 相模線 / 入谷 日比谷線）で、
  // 曖昧駅を路線名から一意に解決する。候補が1件に絞れた場合のみ解決し、
  // 絞り込めない場合は通常の曖昧応答（候補提示）にフォールバックする。
  const spaceParts = key.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2) {
    const stationPart = spaceParts[0];
    const lineHint = spaceParts.slice(1).join(' ').toLowerCase();
    const ambBase = AMBIGUOUS_STATION_NAMES[stationPart] || AMBIGUOUS_STATION_NAMES[normalizeStationName(stationPart)];
    if (ambBase) {
      const lineRefs = AMBIGUOUS_STATION_LINES[stationPart] || AMBIGUOUS_STATION_LINES[normalizeStationName(stationPart)] || [];
      const matched = ambBase.filter((cand, i) => {
        const refLine = (lineRefs[i] || '').toLowerCase();
        // 路線名ヒントが候補の所属路線名に部分一致（含む/含まれる）すれば解決候補
        return refLine && (refLine.includes(lineHint) || lineHint.includes(refLine) ||
          normalizeLineHint(refLine).includes(normalizeLineHint(lineHint)) ||
          normalizeLineHint(lineHint).includes(normalizeLineHint(refLine)));
      });
      if (matched.length === 1) {
        return { station: matched[0], candidates: [matched[0]], ambiguous: false, exact: true, landmark: null };
      }
      if (matched.length > 1) {
        return { station: null, candidates: matched, ambiguous: true, exact: false, landmark: null };
      }
      // 路線名で絞り込めなかった場合: 駅名部分のみの曖昧応答にフォールバック
      return { station: null, candidates: ambBase, ambiguous: true, exact: false, landmark: null };
    }
  }

  // 同名別駅（小川町・両国・霞ヶ関等）: 完全一致より先に判定し、サイレント推測せず候補を提示する。
  // 例: 「霞ヶ関」は東京メトロ（霞ケ関）と東武東上線（川越市）の2駅がある。
  if (AMBIGUOUS_STATION_NAMES[key]) {
    return { station: null, candidates: AMBIGUOUS_STATION_NAMES[key], ambiguous: true, exact: false, landmark: null };
  }
  if (STATION_TO_LINES[key]) return { station: key, candidates: [key], ambiguous: false, exact: true, landmark: null };

  // ランドマーク完全一致を駅名エイリアス正規化より先に評価する。
  // 例: Yomiuriland は「読売ランド前」ではなく「京王よみうりランド」を優先。
  // ※ exactOnly: 部分一致まで先に評価すると旧駅名エイリアス（例「成田空港(旧)」→東成田）が
  //    ランドマーク「成田空港」に奪われるため、ここでは完全一致のみを評価する（#26）。
  const landmarkExact = resolveLandmark(key, true);
  if (landmarkExact && STATION_TO_LINES[landmarkExact.station]) {
    return { station: landmarkExact.station, candidates: [landmarkExact.station], ambiguous: false, exact: false, landmark: landmarkExact.landmark, landmarkNote: landmarkExact.note, walk_min: landmarkExact.walk_min };
  }

  // 完全一致（正規化後）
  const norm = normalizeStationName(key);
  // ローマ字・英語別名を日本語駅名へ正規化した後も、同名駅の曖昧性を必ず再評価する。
  // 例: Ryogoku / Ogawamachi / Iriya は日本語入力と同じ候補提示が必要。
  if (AMBIGUOUS_STATION_NAMES[norm]) {
    return { station: null, candidates: AMBIGUOUS_STATION_NAMES[norm], ambiguous: true, exact: false, landmark: null };
  }
  if (STATION_TO_LINES[norm]) return { station: norm, candidates: [norm], ambiguous: false, exact: true, landmark: null };

  // ランドマーク（施設名）から最寄り駅への変換
  // ※ 前方一致（駅名の部分一致）より先に評価する。理由: 「羽田空港」のように
  // 実在しない駅名だが施設名としては有効な入力を、駅名前方一致の「曖昧」で
  // 止めずに最寄り駅へ変換するため。駅名として完全一致する入力は上の分岐で
  // 既に処理済みなので、ここで駅名を誤って上書きすることはない。
  const lm = resolveLandmark(key);
  if (lm && STATION_TO_LINES[lm.station]) {
    return { station: lm.station, candidates: [lm.station], ambiguous: false, exact: false, landmark: lm.landmark, landmarkNote: lm.note, walk_min: lm.walk_min };
  }

  const searchKeys = [key, norm].filter((v, i, a) => a.indexOf(v) === i); // key と norm の重複排除

  // 前方一致（入力が候補の接頭辞）: 誤認を防ぐため substring 包含は使わない
  const prefixMatches = [];
  for (const s of Object.keys(STATION_TO_LINES)) {
    for (const k of searchKeys) {
      if (s === k) { if (!prefixMatches.includes(s)) prefixMatches.push(s); }
      else if (s.startsWith(k)) { if (!prefixMatches.includes(s)) prefixMatches.push(s); }
    }
  }
  if (prefixMatches.length === 1) {
    return { station: prefixMatches[0], candidates: prefixMatches, ambiguous: false, exact: false, landmark: null };
  }
  if (prefixMatches.length > 1) {
    // 複数候補 → 曖昧。ただし「入力そのものが別路線で実在する駅」なら完全一致優先済みのためここには来ない。
    return { station: null, candidates: prefixMatches, ambiguous: true, exact: false, landmark: null };
  }

  // 後方一致・その他の部分一致は「誤認」の元なので使用しない。
  // 正規化名で再試行（STATION_NAME_MAP に旧名がある場合）
  if (norm !== key && STATION_TO_LINES[normalizeStationName(key)]) {
    const nm = normalizeStationName(key);
    return { station: nm, candidates: [nm], ambiguous: false, exact: false, landmark: null };
  }
  return { station: null, candidates: [], ambiguous: false, exact: false, landmark: null };
}

// #93: 二分ヒープ（MinHeap）— ダイクストラ法の優先度付きキューを配列の毎回ソート（O(N log N)）から
// push/pop とも O(log N) に改善する。同コストなら乗換数が少ない方を優先する comparator を受け取る。
class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.a = [];
  }
  get length() { return this.a.length; }
  push(v) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(a[i], a[p]) >= 0) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.compare(a[l], a[m]) < 0) m = l;
        if (r < a.length && this.compare(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export function findShortestPath(start, goal, options = {}) {
  const blockedLines = options.blockedLines instanceof Set ? options.blockedLines : new Set(options.blockedLines || []);
  const startNodes = (STATION_TO_LINES[start] || []).map(e => `${start}@${e.line}`);
  const goalNodes = (STATION_TO_LINES[goal] || []).map(e => `${goal}@${e.line}`);
  if (!startNodes.length || !goalNodes.length) return null;
  const goalSet = new Set(goalNodes);
  if (start === goal) return { path: [start], lines: [] };
  // best[node] = { transfers, dist }。比較: 総コスト = dist + transfers × TRANSFER_PENALTY で最小を選ぶ。
// （v2.28.0 変更: 従来は transfers 優先の辞書順だったため、0乗換の遠回り（85分）が 1乗換の直通（25分）に
//   常に勝ってしまう問題があった。乗換ペナルティ加算方式にすることで「乗換1回で大幅短縮」を正しく評価する。
//   Issue #37 対応）
const costOf = (n) => n.dist + n.transfers * TRANSFER_PENALTY;
// 同コストなら乗換数の少ない方を優先（例: 大宮→船橋 は 野田線直通(cost34・0乗換) と
//   湘南新宿ライン→中央線→総武線快速(cost34・2乗換) が同コストになるため、直通を選ぶ）
const betterThan = (a, b) => {
  const ca = costOf(a), cb = costOf(b);
  return ca < cb || (ca === cb && a.transfers < b.transfers);
};
  const best = {};
  const prev = {};
  const visited = new Set();
  // #93: 配列の全体ソート（O(N log N)）を二分ヒープ（MinHeap）で置換し、ダイクストラを高速化。
  // 元の安定ソート＋shift（FIFO）と同一のタイブレークを再現するため、挿入順序 seq で
  // コスト・乗換数が完全に等しいエントリは挿入の古い順（FIFO）に pop する。
  // （これにより「北千住→綾瀬」のような等コスト並列ルートの選択が従来どおりになる）
  let seq = 0;
  const pq = new MinHeap((a, b) => costOf(a) - costOf(b) || a.transfers - b.transfers || a.seq - b.seq);
  for (const n of startNodes) {
    if (!blockedLines.has(n.split('@')[1])) {
      best[n] = { transfers: 0, dist: 0 };
      pq.push({ node: n, transfers: 0, dist: 0, seq: seq++ });
    }
  }
  let bestGoal = null; // { transfers, dist, node }
  while (pq.length) {
    const { node, transfers, dist } = pq.pop();
    // 確定的打ち切り: 既に見つけたゴール解が、これから pop する全ノードより優秀なら終了
    if (bestGoal && !betterThan({ transfers, dist }, bestGoal)) break;
    if (visited.has(node)) continue;
    visited.add(node);
    if (goalSet.has(node)) {
      if (!bestGoal || betterThan({ transfers, dist }, bestGoal)) {
        bestGoal = { transfers, dist, node };
      }
      continue; // ゴールノードからの先は探索しない（到着済み）
    }
    for (const [next, w] of Object.entries(GRAPH[node] || {})) {
      if (blockedLines.has(node.split('@')[1]) || blockedLines.has(next.split('@')[1])) continue;
      const isTransfer = w >= TRANSFER_PENALTY;
      const nTransfers = transfers + (isTransfer ? 1 : 0);
      const nDist = dist + (isTransfer ? 0 : w);
      const cur = best[next];
      if (!cur || betterThan({ transfers: nTransfers, dist: nDist }, cur)) {
        best[next] = { transfers: nTransfers, dist: nDist };
        prev[next] = node;
        pq.push({ node: next, transfers: nTransfers, dist: nDist, seq: seq++ });
      }
    }
  }
  if (!bestGoal) return null;
  // ゴールノードからパスを復元
  const node = bestGoal.node;
  const nodePath = [];
  let cur = node;
  while (cur !== undefined) {
    nodePath.unshift(cur);
    if (startNodes.includes(cur)) break;
    cur = prev[cur];
  }
  if (!nodePath.length || nodePath[0].split('@')[0] !== start) return null;
  const path = [];
  const lines = [];
  const walkEdges = [];
  for (let i = 0; i < nodePath.length; i++) {
    const [st, ln] = nodePath[i].split('@');
    path.push(st);
    if (i > 0) lines.push(nodePath[i - 1].split('@')[1]);
  }
  // 徒歩連絡（近接異名駅）エッジの判定: 「駅名が異なる」かつ「重みが乗換ペナルティ以上」のエッジ。
  // 乗車エッジは重み1、同一駅の乗換エッジは駅名が同一のため、この条件で一意に判別できる。
  // ※ 駅名ペアだけで判定すると、新橋⇔汐留のような「同一路線の隣接駅が近接異名駅でもある」ケースで
  //    乗車エッジ（ゆりかもめ1駅）を徒歩連絡と誤表示する（v2.22.0 の実バグ・v2.22.1で修正）。
  for (let i = 0; i < nodePath.length - 1; i++) {
    const a = nodePath[i], b = nodePath[i + 1];
    const w = (GRAPH[a] && GRAPH[a][b] !== undefined) ? GRAPH[a][b] : (GRAPH[b] && GRAPH[b][a] !== undefined ? GRAPH[b][a] : 0);
    walkEdges.push(a.split('@')[0] !== b.split('@')[0] && w >= TRANSFER_PENALTY);
  }
  return { path, lines, walkEdges };
}

export function buildRouteSegments(path, lines, walkEdges = []) {
  if (!path || path.length < 2) return [];
  const segments = [];
  // walkEdges[i] = エッジ i（path[i]→path[i+1]）が徒歩連絡（近接異名駅）かどうか。
  // findShortestPath が「駅名が異なる & 重み>=乗換ペナルティ」で一意に判定した値を使う
  // （駅名ペアだけで判定すると同一路線の乗車エッジを徒歩と誤表示する）。
  const isWalkEdge = (i) => !!(walkEdges && walkEdges[i]);
  const walkInfo = (i) => {
    const w = WALK_TRANSFER_LOOKUP.get(`${path[i]}|${path[i + 1]}`);
    return { line: '🚶 徒歩連絡', from: path[i], to: path[i + 1], count: 1, walk: true, minutes: w ? w.minutes : undefined };
  };
  let curLine = lines[0];
  let cur = isWalkEdge(0) ? walkInfo(0) : { line: curLine, from: path[0], to: path[1], count: 1 };
  let curIsWalk = isWalkEdge(0);
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    const isWalk = isWalkEdge(i);
    if (ln === cur.line && !curIsWalk && !isWalk) {
      cur.to = path[i + 1];
      cur.count++;
    } else {
      segments.push({ ...cur });
      cur = isWalk ? walkInfo(i) : { line: ln, from: path[i], to: path[i + 1], count: 1 };
      curIsWalk = isWalk;
    }
  }
  segments.push({ ...cur });
  return segments.filter(s => s.from && s.to);
}

export function commonLines(a, b) {
  const la = (STATION_TO_LINES[a] || []).map(x => x.line);
  const lb = (STATION_TO_LINES[b] || []).map(x => x.line);
  const shared = la.filter(l => lb.includes(l));
  // 共通路線がなければ（乗り換え駅など）それぞれの路線を返す
  return shared.length ? shared : [...new Set([...la, ...lb])];
}

export function computeRoutes(fromRaw, toRaw, options = {}) {
  const fromRes = resolveStation(fromRaw);
  const toRes = resolveStation(toRaw);
  // 曖昧（複数候補がありどれが正解か確定できない）の場合は検索を中断し選択を促す
  if (fromRes.ambiguous) {
    return { error: 'AMBIGUOUS_STATION', side: 'from', input: fromRaw, candidates: fromRes.candidates };
  }
  if (toRes.ambiguous) {
    return { error: 'AMBIGUOUS_STATION', side: 'to', input: toRaw, candidates: toRes.candidates };
  }
  const from = fromRes.station;
  const to = toRes.station;
  if (!from || !to) {
    return { error: 'STATION_NOT_FOUND', from, to, suggestion_from: fromRaw, suggestion_to: toRaw };
  }
  const result = findShortestPath(from, to, options);
  if (!result || !result.path) {
    return { error: 'NO_ROUTE', from, to, fromLandmark: fromRes.landmark, toLandmark: toRes.landmark };
  }
  const { path, lines, walkEdges } = result;
  const segments = buildRouteSegments(path, lines, walkEdges);
  const totalStops = path.length - 1;
  // 徒歩連絡（近接異名駅）も乗換1回としてカウントする（WALK_TRANSFER_COST = TRANSFER_PENALTY）
  const walkSegs = segments.filter(s => s.walk);
  const transfers = Math.max(0, segments.length - 1);
  // 徒歩連絡は「乗車駅数」に含めず、実徒歩時間を推定所要に加算する
  const walkMinutes = walkSegs.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const rideStops = segments.reduce((sum, s) => sum + (s.walk ? 0 : s.count), 0);
  const estimatedMinutes = Math.round(rideStops * 2.5 + transfers * 4 + walkMinutes);

  const routes = [{
    summary: {
      from,
      to,
      transfers,
      total_stops: totalStops,
      estimated_minutes: estimatedMinutes,
      // 徒歩連絡が先頭でもメイン路線は最初の乗車路線とする
      main_line: segments.find(s => !s.walk)?.line || segments[0]?.line || null,
      terminal_station: path[path.length - 1]
    },
    segments: segments.map(seg => ({
      line: seg.line,
      from: seg.from,
      to: seg.to,
      stops: seg.count,
      // 近接異名駅（徒歩連絡）セグメントは walk フラグと徒歩時間を保持する
      ...(seg.walk ? { walk: true, minutes: seg.minutes } : {})
    })),
    path
  }];
  return { routes, from, to, fromLandmark: fromRes.landmark, toLandmark: toRes.landmark, fromLandmarkNote: fromRes.landmarkNote, toLandmarkNote: toRes.landmarkNote };
}

export async function findNearestBikeStations(stationName, userLocation = null, maxResults = 5, maxDistance = 2000) {
  try {
    const data = await fetchBikeShareData();
    // 基準座標: ユーザーの現在位置（GPS）が指定されていればそれを優先、なければ出発駅座標
    let coord = (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lon === 'number')
      ? { lat: userLocation.lat, lon: userLocation.lon }
      : STATION_COORDS[stationName];
    if (!coord) return null;
    const baseLabel = (userLocation && typeof userLocation.lat === 'number') ? 'user_location' : 'station';
    const available = data.stations
      .filter(s => { const st = data.statuses[s.station_id]; return st && st.is_renting && st.num_bikes_available > 0; })
      .map(s => {
        const st = data.statuses[s.station_id];
        const name = typeof s.name === 'string' ? s.name : s.name?.ja || s.name?.[0]?.text || '?';
        return { station_id: s.station_id, name, distance: haversineDistance(coord.lat, coord.lon, s.lat, s.lon), bikes_available: st.num_bikes_available, docks_available: st.num_docks_available, lat: s.lat, lon: s.lon, reference: baseLabel };
      })
      .filter(s => s.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxResults);
    return available.length > 0 ? available : null;
  } catch (e) {
    console.log(`[WARN] Bike share API error: ${e.message}`);
    return null;
  }
}

export function getDestinationCulturalFacilities(station, userLang = 'ja') {
  const langIndex = userLang === 'en' ? 1 : userLang === 'zh' ? 2 : 0;
  // 明示定義 + LANDMARK_DEFS 自動導出 を名前重複なしでマージ
  const explicit = DESTINATION_CULTURAL_FACILITIES[station] || [];
  const derived = DERIVED_CULTURAL_FACILITIES[station] || [];
  const seen = new Set(explicit.map(e => e[0]));
  const all = [...explicit];
  for (const d of derived) {
    if (!seen.has(d[0])) { seen.add(d[0]); all.push(d); }
  }
  return all.map(([ja, en, zh, category, walk_min]) => ({
    name: [ja, en, zh][langIndex],
    category: userLang === 'ja' ? category : (CULTURAL_CATEGORY_NAMES[category]?.[userLang] || category),
    walk_min
  }));
}

export function resolveLandmark(rawName, exactOnly = false) {
  if (!rawName) return null;
  const key = rawName.trim();
  const lower = key.toLowerCase();
  // 1. 完全一致（全言語）
  if (LANDMARK_LOOKUP[lower]) {
    const { defKey, lang, original } = LANDMARK_LOOKUP[lower];
    const def = LANDMARK_DEFS[defKey];
    return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
  }
  if (exactOnly) return null; // 完全一致のみ要求時は部分一致系を評価しない（旧駅名エイリアスとの衝突防止: 例「成田空港(旧)」）
  // 2. サフィックス除去（日本語の「駅」「公園」等を除去して再一致）
  const stripped = key.replace(/(駅|バス停|停留所|公園|競技場|ドーム|タワー|テーマパーク)$/, '');
  if (stripped !== key) {
    const sl = stripped.toLowerCase();
    if (LANDMARK_LOOKUP[sl]) {
      const { defKey, lang, original } = LANDMARK_LOOKUP[sl];
      const def = LANDMARK_DEFS[defKey];
      return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
    }
  }
  // 3. 部分一致（入力がいずれかの名称を含む）: 長い名称を優先（「東京ディズニーランド」が「ディズニー」より優先）
  const contained = Object.keys(LANDMARK_LOOKUP)
    .filter(k => lower.includes(k))
    .sort((a, b) => b.length - a.length);
  if (contained.length) {
    const { defKey, lang, original } = LANDMARK_LOOKUP[contained[0]];
    const def = LANDMARK_DEFS[defKey];
    return { station: def.station, note: def.note, walk_min: def.walk_min, landmark: original, landmarkLang: lang };
  }
  return null;
}

export const STATION_NAME_MAP_LOWER = new Map(
  Object.entries(STATION_NAME_MAP).map(([k, v]) => [k.toLowerCase(), v])
);

export function normalizeStationName(name) {
  const trimmed = String(name || '').trim();
  if (STATION_NAME_MAP[trimmed]) return STATION_NAME_MAP[trimmed];
  const mapped = STATION_NAME_MAP_LOWER.get(trimmed.toLowerCase());
  if (mapped) return mapped;
  // 一般的な駅名サフィックスは辞書登録の有無にかかわらず除去する。
  // 先に完全一致と辞書を評価しているため、正式名称の一部を壊さない。
  const withoutSuffix = trimmed.replace(/(?:駅|站|station)$/iu, '').trim();
  if (withoutSuffix !== trimmed) {
    if (STATION_NAME_MAP[withoutSuffix]) return STATION_NAME_MAP[withoutSuffix];
    return STATION_NAME_MAP_LOWER.get(withoutSuffix.toLowerCase()) || withoutSuffix;
  }
  return trimmed;
}

export function detectPrivateExpressOperator(fromInput, toInput) {
  const combined = `${fromInput || ''} ${toInput || ''}`.toLowerCase();
  for (const op of PRIVATE_EXPRESS_GUIDE) {
    if (op.keywords.some(kw => combined.includes(kw))) return op;
  }
  return null;
}

export function detectLimitedExpressRequest(fromInput, toInput) {
  const combined = `${fromInput || ''} ${toInput || ''}`.toLowerCase();
  // 駅名に含まれるキーワード（例: 「西武秩父」の「秩父」）は特急リクエストと誤判定しない。
  // 解決済み駅名を入力から除去してから判定する（例: 「池袋 秩父特急」→ 秩父 が残る→特急案内）。
  let residue = combined;
  for (const s of [fromInput, toInput]) {
    const r = resolveStation(s);
    if (r && r.station) {
      residue = residue.replace(r.station.toLowerCase(), ' ');
      for (const cand of (r.candidates || [])) {
        residue = residue.replace(String(cand).toLowerCase(), ' ');
      }
    }
  }
  return LIMITED_EXPRESS_KEYWORDS.some(kw => residue.includes(kw));
}

export function findLimitedExpressStation(fromInput, toInput) {
  const inputs = [fromInput, toInput];
  const candidates = [];
  for (const input of inputs) {
    const s = String(input || '').trim();
    if (!s) continue;
    // キーワード（列車名・種別）を除去した残りを駅名候補にする（大文字小文字を無視）
    let stripped = s;
    for (const kw of LIMITED_EXPRESS_KEYWORDS) {
      try { stripped = stripped.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '); } catch (_) {}
    }
    stripped = stripped.replace(/[、。・\s]+/g, ' ').trim();
    if (stripped) candidates.push(stripped);
  }
  for (const c of candidates) {
    const r = resolveStation(c);
    if (r && r.station) return r.station;
    // グラフに存在しない新幹線駅（新大阪等）は窓口ガイドのキーと直接照合
    if (LIMITED_EXPRESS_STATION_GUIDE[c]) return c;
  }
  return null;
}

export function buildLimitedExpressGuidance(userLang, fromInput, toInput) {
  const station = findLimitedExpressStation(fromInput, toInput);
  const guide = station ? LIMITED_EXPRESS_STATION_GUIDE[station] : null;
  // 私鉄系特急の事業者判定（例: ロマンスカー・スカイライナー・りょうもう等）
  const privateOp = detectPrivateExpressOperator(fromInput, toInput);
  const notice = userLang === 'en'
    ? '🚄 Limited express / Shinkansen routes are not included in the route search graph (issue #76: not planned). Please use the station guidance below (Midori-no-Madoguchi / designated-seat ticket machines) for tickets and transfers.'
    : userLang === 'zh'
      ? '🚄 路线搜索图不包含特急・新干线（issue #76：不计划实现）。请通过下方的车站指南（绿色窗口・指定席售票机）确认车票与换乘方式。'
      : '🚄 特急・新幹線は経路検索グラフに含めない方針です（issue #76: 実装しない）。チケット購入・乗り換えは下記の駅案内（みどりの窓口・指定席券売機）をご利用ください。';
  const howTo = userLang === 'en'
    ? 'Please check ticket availability and connections at the station\'s JR Midori-no-Madoguchi (green window) or designated-seat ticket machines.'
    : userLang === 'zh'
      ? '请在该站的JR绿色窗口（Midori-no-Madoguchi）或指定席售票机确认余票与换乘方式。'
      : '該当駅の JR みどりの窓口（または指定席券売機）で、乗車券・特急券の購入と乗り換えをご確認ください。';
  let stationBlock;
  if (guide) {
    stationBlock = { station, window_guidance: guide[userLang] };
  } else {
    const fallback = userLang === 'en'
      ? `For station ${station || 'the requested station'}: ask at the Midori-no-Madoguchi or ticket office for limited-express / Shinkansen tickets and transfers.`
      : userLang === 'zh'
        ? `关于${station || '所查询的车站'}：请到该站的绿色窗口或售票处咨询特急・新干线车票与换乘。`
        : `${station || '該当駅'}では、みどりの窓口または駅係員に特急・新幹線のチケットと乗り換えをお問い合わせください。`;
    stationBlock = { station: station || null, window_guidance: fallback };
  }
  const resp = {
    status: 'SUCCESS',
    mode: 'LIMITED_EXPRESS_GUIDANCE',
    detected_language: userLang,
    from: fromInput,
    to: toInput,
    notice,
    how_to_proceed: howTo,
    guidance: stationBlock,
    limited_express_note: userLang === 'en'
      ? 'This server covers local / rapid / express (ordinary-fare) rail. Shinkansen and limited-express fares require seat reservations handled at JR counters.'
      : userLang === 'zh'
        ? '本服务器支持普通列车・快速・普通特急（普通票价）的路线。新干线与特急的座位预约请在JR窗口办理。'
        : '本サーバーは普通・快速・各駅停車（普通運賃）の経路検索に対応しています。新幹線・特急の指定席予約はJR窓口でお取り扱いください。',
    direct_search_url: `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(fromInput || '')}&to=${encodeURIComponent(toInput || '')}`
  };
  // 私鉄系特急の場合は事業者別案内を追加
  if (privateOp) {
    const opLabel = privateOp.train || privateOp.operator;
    resp.private_express_guidance = {
      operator: privateOp.operator,
      train: opLabel,
      main_stations: privateOp.mainStations,
      guidance: privateOp.guidance[userLang],
      how_to_proceed: userLang === 'en'
        ? `Purchase limited-express tickets at the operator's ticket counters / windows (${privateOp.mainStations.join(', ')}) or book online.`
        : userLang === 'zh'
          ? `请在该公司的主要车站（${privateOp.mainStations.join('・')}）的特急券售票处・窗口购票，或使用网上预约。`
          : `${privateOp.operator}の主要駅（${privateOp.mainStations.join('・')}）の特急券売り場・窓口でご購入ください。Web予約も利用できます。`
    };
  }
  return resp;
}

export async function searchRoute(args) {
  const parsedArgs = parseTestMode({ from: args.from, to: args.to, '-test': args['-test'], test: args.test, test_mode: args.test_mode });
  let fromInput = parsedArgs.from, toInput = parsedArgs.to;
  let simulatedFailure = parsedArgs.simulatedFailure;

  // ユーザーの現在位置（GPS）: { lat, lon } 任意。指定時はシェアサイクル検索の基準にする
  let userLocation = null;
  if (args.user_location && typeof args.user_location.lat === 'number' && typeof args.user_location.lon === 'number') {
    userLocation = { lat: args.user_location.lat, lon: args.user_location.lon };
  } else if (typeof args.user_location === 'string') {
    const m = args.user_location.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) userLocation = { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }
  // 🔴 緯度経度の範囲検証（lat: -90〜90 / lon: -180〜180）。範囲外は無効として無視する。
  if (userLocation && !(userLocation.lat >= -90 && userLocation.lat <= 90 && userLocation.lon >= -180 && userLocation.lon <= 180)) {
    userLocation = null;
  }

  let userLang = 'ja';
  // 明示的な言語指定（args.language / args.lang）が最優先。
  // 例: ユーザーが英語で質問したのに駅名が日本語（浅草等）の場合、
  //     自動判定では ja になるため、クライアントが language:'en' を渡して英語応答を強制できる。
  const explicitLang = resolveLang(args);
  if (explicitLang) {
    userLang = explicitLang;
  } else if (simulatedFailure) {
    // fromInput の駅名部分（'-test' より前）の言語を優先判定。
    // ja/zh 共通キーワード（地震・人身事故等）でも、駅名が日本語なら ja、中国語なら zh となる。
    const stationPart = fromInput.split(/\s*-+\s*test/i)[0].trim();
    const stationLang = detectLanguage(stationPart);
    if (stationLang !== 'ja') {
      userLang = stationLang;
    }
    // 駅名が日本語（ja）の場合は userLang を 'ja' のままにする。
    // （ja/zh 共通キーワードの場合、駅名の言語を信頼する）
  } else {
    // 明示指定なし: from/to 双方を判定し、いずれかが zh/en ならその言語を採用（中国語/英語検索に検索言語で応答）
    const fL = detectLanguage(fromInput);
    const tL = detectLanguage(toInput);
    userLang = fL !== 'ja' ? fL : tL !== 'ja' ? tL : 'ja';
  }

  // 地震時は鉄道・トラム・バス等の通常経路を提示せず、安全確保を優先する。
  if (simulatedFailure && detectFailureType(simulatedFailure, userLang)?.adviceKey === 'earthquake') {
    return await buildEarthquakeSafetyResponse('ground', userLang, { from: fromInput, to: toInput });
  }

  // 🚄 特急・新幹線リクエスト: 経路グラフは普通列車ベースのため、該当駅の窓口案内を返す。
  // （新幹線・特急の乗り換え対応は大規模改修が必要なため見送り。窓口案内のみ表示）
  if (detectLimitedExpressRequest(fromInput, toInput)) {
    return jsonResponse(buildLimitedExpressGuidance(userLang, fromInput, toInput));
  }

  if (!fromInput || !toInput) {
    return jsonResponse(buildErrorResponse('INVALID_INPUT', '出発駅と到着駅の両方を指定してください。', { userLang, from: fromInput, to: toInput }));
  }

  const fromName = normalizeStationName(fromInput);
  const toName = normalizeStationName(toInput);
  const webSearchUrl = `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}`;

  let isRainy = false, isSevereWeather = false, isSevereWind = false, weatherText = "未取得", isTrainSuspended = false, delayMessage = "";
  let busTransferDetected = false, busTransferDetail = "", isHot = false;
  let failureType = null, failureAdviceKey = null; // -test で指定された障害種別
  const suspendedLineNames = new Set();

  // -test シミュレーション
  if (simulatedFailure) {
    const fc = detectFailureType(simulatedFailure, userLang);
    // 注意: userLang は初期化部で fromInput の駅名言語に基づき決定済み。
    // ja/zh 共通キーワード（地震等）でも駅名の言語を優先するため、ここでは上書きしない。
    isRainy = fc.isRainy || false; isSevereWeather = fc.isSevereWeather || false;
    isHot = fc.isHot || false; isTrainSuspended = fc.isTrainSuspended || false;
    weatherText = fc.weatherText || (userLang === 'en' ? "Disruption detected" : userLang === 'zh' ? "检测到交通故障" : "障害検知");
    delayMessage = "🚨 " + (fc.delayMessage || (userLang === 'en' ? "Simulated disruption" : userLang === 'zh' ? "模拟交通故障" : "シミュレーション障害"));
    failureType = simulatedFailure; failureAdviceKey = fc.adviceKey || null;
    const simulatedLine = Object.keys(RAILWAY_LINES).find(line => simulatedFailure.includes(line));
    if (simulatedLine) suspendedLineNames.add(simulatedLine);
  }

  // 通常API（並列実行＋統一キャッシュ）
  let apiDegraded = false;
  if (!simulatedFailure) {
    const [weatherResult, trainResult] = await Promise.allSettled([
      (async () => {
        if (!jmaBreaker.canExecute()) return { error: 'CIRCUIT_OPEN' };
        try {
          // #88/#89: 出発・到着駅の県から地域コードを解決（従来の 130000 固定を廃止）
          const areas = [...new Set([stationToJmaArea(fromName), stationToJmaArea(toName)])];
          const results = await Promise.all(areas.map(a =>
            getWeatherAdvice(userLang, a).then(w => ({ code: a, ...w })).catch(() => null)
          ));
          const ok = results.filter(r => r && r.weather);
          if (ok.length === 0) return { error: 'WEATHER_FETCH_FAILED' };
          let text = '', isRainy = false, isSevere = false, isHot = false;
          for (const r of ok) {
            const lbl = (JMA_AREA_LABELS[r.code] && JMA_AREA_LABELS[r.code][userLang]) || r.code;
            text += (text ? ' ／ ' : '') + `${lbl}: ${r.weather}`;
            isRainy = isRainy || r.isRainy;
            isSevere = isSevere || r.isSevere;
            isHot = isHot || r.isHot;
          }
          return { weather: text, isRainy, isSevere, isHot };
        } catch (e) { jmaBreaker.onFailure(e); return { error: e.message }; }
      })(),
      (async () => {
        if (!odptBreaker.canExecute()) return { error: 'CIRCUIT_OPEN' };
        try {
          const operators = ['TokyoMetro', 'Toei', 'TamaMonorail', 'MIR', 'TWR'];
          const results = await Promise.allSettled(operators.map(op => axios.get(`${API_BASE_URL}/odpt:TrainInformation`, { params: getParams(op), timeout: 15000 })));
          const allDelays = []; let fb = false, fd = '';
          const fulfilledCount = results.filter(res => res.status === 'fulfilled').length;
          if (fulfilledCount === 0) {
            throw new Error('All ODPT train information requests failed');
          }
          for (const res of results) {
            if (res.status === 'rejected') continue;
            for (const info of res.value.data) {
              if (!info['odpt:trainInformationStatus']) continue;
              const t = info['odpt:trainInformationText']?.ja || '';
              // #92: 復旧検出は「運転を再開」等の肯定的表現のみ。TODO「再開は未定」は除外
              const resumed = /(運転を再開|運転再開|再開しました|復旧しました)/.test(t) && !/(再開は未定|再開未定|再開の見込み)/.test(t);
              if (!resumed && (t.includes("運転見合わせ") || t.includes("見合わせ") || t.includes("運休"))) {
                allDelays.push({ railway: info['odpt:railway'], text: t });
                for (const lineName of resolveSuspendedLineNames(info['odpt:railway'])) suspendedLineNames.add(lineName);
              }
              if (t.includes('バス') || t.includes('振替') || t.includes('代行') || t.includes('輸送')) { fb = true; fd = t; }
            }
          }
          busTransferDetected = fb; busTransferDetail = fd;
          odptBreaker.onSuccess();
          return { delays: allDelays, busTransfer: fb, busTransferDetail: fd, suspendedLineNames: [...suspendedLineNames] };
        } catch (e) { odptBreaker.onFailure(e); return { error: e.message }; }
      })()
    ]);

    if (weatherResult.status === 'fulfilled' && weatherResult.value && !weatherResult.value.error) {
      const w = weatherResult.value;
      weatherText = w.weather; isRainy = w.isRainy;
      // #88/#89: EMERGENCY（経路抑止）は特別警報・津波のみ。強風・高波は荒天注意（自転車非表示・typhoonアドバイス）
      isSevereWeather = w.isSpecial || false;
      isSevereWind = w.isSevereWind || w.isHighWave || false;
      isHot = w.isHot || false;
    } else if (weatherResult.status === 'fulfilled' && weatherResult.value?.error === 'CIRCUIT_OPEN') {
      // #93: 気象庁APIが遮断（OPEN）されても内蔵経路エンジンでルート算出を継続する（Graceful Degradation）。
      // 従来は即座にエラー応答で全体を中断していたが、自己完結型グラフ探索の強みを活かし
      // degraded_mode フラグ付きで結果を返し、天気情報のみ取得不可であることを明示する。
      apiDegraded = true;
      weatherText = userLang === 'en'
        ? 'Weather info unavailable (JMA API offline).'
        : userLang === 'zh'
          ? '天气信息不可用（气象厅API离线）。'
          : '天気情報を取得できませんでした（気象庁API利用不可）。';
    } else { apiDegraded = true; } // 天気API取得失敗
    if (trainResult.status === 'fulfilled' && trainResult.value && !trainResult.value.error) {
      const t = trainResult.value;
      for (const lineName of (t.suspendedLineNames || [])) suspendedLineNames.add(lineName);
      if (t.delays.length > 0) { isTrainSuspended = true; delayMessage = `🚨 ${t.delays[0].railway.replace('odpt:Railway:', '')}: ${translateTrainInfoDetail(t.delays[0].text, userLang)}`; }
      if (t.busTransfer && !delayMessage) delayMessage = `🚨 ${translateTrainInfoDetail(t.busTransferDetail, userLang)}`;
    } else if (trainResult.status === 'fulfilled' && trainResult.value?.error === 'CIRCUIT_OPEN') {
      // #93: 運行情報APIが遮断（OPEN）されても内蔵経路エンジンでルート算出を継続する（Graceful Degradation）。
      // 従来は即座にエラー応答で全体を中断していたが、degraded_mode フラグ付きで結果を返す。
      apiDegraded = true;
    } else { apiDegraded = true; } // 運行情報API取得失敗
  }

  const isEmergencyActive = isTrainSuspended || isSevereWeather;
  // 障害種別→アドバイス連動：failureAdviceKeyがある場合は専用アドバイス、なければ従来の天候ベース
  let adviceKey;
  if (failureAdviceKey) {
    adviceKey = failureAdviceKey;
  } else if (isEmergencyActive) {
    adviceKey = 'emergency';
  } else if (isSevereWind) {
    // #89: 強風・高波は typhoon（荒天）アドバイスに昇格（経路は抑止しない）
    adviceKey = 'typhoon';
  } else if (isHot) {
    adviceKey = 'hot';
  } else if (isRainy) {
    adviceKey = 'rainy';
  } else {
    adviceKey = 'fair';
  }
  const aiAdvice = MULTILINGUAL_ADVICE[adviceKey]?.[userLang] || MULTILINGUAL_ADVICE[adviceKey]?.ja || "情報なし";

  // 🚲 運転見合わせ時のみ自転車。ただし降雪・凍結時は転倒リスクが高いため非表示。
  // failureAdviceKey を見ることで、実際の降雪警報だけでなく -test 降雪も安全に抑止する。
  const isSnowRisk = failureAdviceKey === 'snow' || /雪|積雪|凍結/i.test(weatherText || '');
  let bikeShareInfo = null;
  let destinationBikeShareInfo = null;
  if (isTrainSuspended && !isSevereWeather && !isSevereWind && !isSnowRisk) {
    bikeShareInfo = await findNearestBikeStations(fromName, userLocation);
  }
  // 荒天・降雪・凍結時を除き、到着地点周辺のラストワンマイル用ポートを案内する。
  // リアルタイムAPIが取得できない場合は推測せず、案内ブロック自体を省略する。
  if (!isSevereWeather && !isSevereWind && !isSnowRisk) {
    destinationBikeShareInfo = await findNearestBikeStations(toName, null);
  }

  const displayFrom = getDisplayStationName(fromName, userLang);
  const displayTo = getDisplayStationName(toName, userLang);
  // 🚌 駅⇔コミュニティバス接続（降車後の足＝ラストマイル。目的地＝降車駅のみを案内）
  const communityBusAccess = [
    buildCommunityBusAccessBlock(toName, userLang)
  ].filter(Boolean);
  const communityBusAccessOut = communityBusAccess.length ? communityBusAccess : undefined;

  // 🗺️ 経路探索エンジン（ODPTキー不要・自己完結型）で実ルートを算出
  let routeOperational = true;
  let routeResult = (simulatedFailure)
    ? { error: 'TEST_MODE' }
    : computeRoutes(fromName, toName, { blockedLines: suspendedLineNames });
  if (!simulatedFailure && suspendedLineNames.size > 0 && routeResult?.error === 'NO_ROUTE') {
    const fallbackRoute = computeRoutes(fromName, toName);
    if (fallbackRoute?.routes) {
      routeResult = fallbackRoute;
      routeOperational = false;
    }
  }

  // ルートが見つからない場合は、エラー種別に応じた統一エラー応答を返す（SUCCESSを誤って返さない）
  if (routeResult && routeResult.error && routeResult.error !== 'TEST_MODE') {
    if (routeResult.error === 'AMBIGUOUS_STATION') {
      // 同名・類似駅名が複数あり、誤認リスクがあるため検索を中断し選択を促す
      const sideLabel = routeResult.side === 'from'
        ? (userLang === 'en' ? 'departure' : userLang === 'zh' ? '出发' : '出発')
        : (userLang === 'en' ? 'arrival' : userLang === 'zh' ? '到达' : '到着');
      // #64: 候補に所属路線名（ja/en/zh）を併記し、多言語ユーザーでも選択しやすくする。
      // 例: 入谷（東京メトロ日比谷線）/ 入谷（相模線）
      const candidatesDisp = (routeResult.candidates || []).map((c, i) => {
        const stationDisp = getDisplayStationName(c, userLang);
        // 括弧付き正式キー（例: 入谷（相模線））は表示名に既に路線名が含まれるため併記しない
        if (c.includes('（') || stationDisp.includes('(')) return stationDisp;
        const lineRefs = AMBIGUOUS_STATION_LINES[routeResult.input] || AMBIGUOUS_STATION_LINES[normalizeStationName(routeResult.input)] || [];
        const lineName = lineRefs[i] ? getLineDisplayName(lineRefs[i], userLang) : '';
        if (!lineName) return stationDisp;
        // 言語に応じて括弧を切り替え（en: 半角 / ja・zh: 全角）
        return userLang === 'en' ? `${stationDisp} (${lineName})` : `${stationDisp}（${lineName}）`;
      });
      const promptMsg = userLang === 'en'
        ? `Multiple stations match "${routeResult.input}" (${sideLabel}). Please choose one: ${candidatesDisp.join(' / ')}`
        : userLang === 'zh'
          ? `「${routeResult.input}」匹配到多个车站（${sideLabel}）。请选择其一：${candidatesDisp.join(' / ')}`
          : `「${routeResult.input}」に一致する駅が複数あります（${sideLabel}）。どれかを選択してください：${candidatesDisp.join(' / ')}`;
      const disambiguation = {
        input: routeResult.input,
        side: routeResult.side,
        candidates: candidatesDisp,
        candidates_raw: routeResult.candidates, // #64: 再入力可能な正式キー（括弧付き表記）も併記
        message: promptMsg
      };
      return jsonResponse(buildErrorResponse('AMBIGUOUS_STATION', promptMsg, {
        userLang, from: displayFrom, to: displayTo, disambiguation
      }));
    }
    const errType = routeResult.error === 'STATION_NOT_FOUND' ? 'STATION_NOT_FOUND' : 'NO_ROUTE';
    const errMsg = errType === 'STATION_NOT_FOUND'
      ? (userLang === 'en' ? `Station not found: ${displayFrom} / ${displayTo}`
         : userLang === 'zh' ? `未找到车站：${displayFrom} / ${displayTo}`
         : `駅が見つかりません：${displayFrom} / ${displayTo}`)
      : (userLang === 'en' ? `No route found from ${displayFrom} to ${displayTo}.`
         : userLang === 'zh' ? `未找到从 ${displayFrom} 到 ${displayTo} 的路线。`
         : `${displayFrom} から ${displayTo} への経路が見つかりません。`);
    return jsonResponse(buildErrorResponse(errType, errMsg, {
      userLang, from: displayFrom, to: displayTo,
      suggestion_from: routeResult.suggestion_from, suggestion_to: routeResult.suggestion_to
    }));
  }

  let routesPayload = undefined;
  const landmarkInfo = {};
  if (routeResult && routeResult.routes) {
    routesPayload = routeResult.routes.map(r => ({
      summary: {
        from: getDisplayStationName(r.summary.from, userLang),
        to: getDisplayStationName(r.summary.to, userLang),
        transfers: r.summary.transfers,
        total_stops: r.summary.total_stops,
        estimated_minutes: r.summary.estimated_minutes,
        main_line: getDisplayLineName(r.summary.main_line, userLang)
      },
      segments: r.segments.map(s => s.walk ? {
        // 近接異名駅（連絡駅）間の徒歩連絡セグメント
        line: userLang === 'en' ? '🚶 Walk transfer' : userLang === 'zh' ? '🚶 步行换乘' : '🚶 徒歩連絡',
        from: getDisplayStationName(s.from, userLang),
        to: getDisplayStationName(s.to, userLang),
        stops: s.stops,
        walk_minutes: s.minutes
      } : {
        line: getDisplayLineName(s.line, userLang),
        from: getDisplayStationName(s.from, userLang),
        to: getDisplayStationName(s.to, userLang),
        stops: s.stops
      })
    }));
    // ランドマーク（施設名）から変換された場合、ユーザーへの案内として付与
    // note は言語別オブジェクト {ja,en,zh} → 応答言語(userLang)で解決
    const pickLang = (noteObj) => (noteObj && typeof noteObj === 'object' ? (noteObj[userLang] || noteObj.ja || '') : (noteObj || ''));
    if (routeResult.fromLandmark) {
      const noteStr = pickLang(routeResult.fromLandmarkNote);
      landmarkInfo.from = {
        landmark: routeResult.fromLandmark,
        nearest_station: getDisplayStationName(routeResult.from, userLang),
        note: userLang === 'en' ? `Nearest station to ${routeResult.fromLandmark}: ${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : userLang === 'zh' ? `${routeResult.fromLandmark} 的最近车站：${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : `${routeResult.fromLandmark} の最寄り駅：${getDisplayStationName(routeResult.from, userLang)}${noteStr ? ' — ' + noteStr : ''}`
      };
    }
    if (routeResult.toLandmark) {
      const noteStr = pickLang(routeResult.toLandmarkNote);
      landmarkInfo.to = {
        landmark: routeResult.toLandmark,
        nearest_station: getDisplayStationName(routeResult.to, userLang),
        note: userLang === 'en' ? `Nearest station to ${routeResult.toLandmark}: ${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : userLang === 'zh' ? `${routeResult.toLandmark} 的最近车站：${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
          : `${routeResult.toLandmark} の最寄り駅：${getDisplayStationName(routeResult.to, userLang)}${noteStr ? ' — ' + noteStr : ''}`
      };
    }
  }

  const resultPayload = {
    status: simulatedFailure ? (isEmergencyActive ? "EMERGENCY_MODE_ACTIVE" : "TEST_MODE") : (isEmergencyActive ? "EMERGENCY_MODE_ACTIVE" : "SUCCESS"),
    // AIインテリジェントアドバイスを先頭に配置（LLMが後半を省略しないよう）
    ai_transit_advice: aiAdvice,
    from: displayFrom, to: displayTo, mode: simulatedFailure ? "TEST_MODE" : "LIVE",
    detected_language: userLang,
    detected_user_language: userLang,
    degraded_mode: apiDegraded ? true : undefined,
    // 実ルート（自己完結型経路エンジンで算出）
    routes: routesPayload,
    route_operational: routeOperational && (!isTrainSuspended || suspendedLineNames.size > 0),
    suspended_lines: suspendedLineNames.size ? [...suspendedLineNames].map(line => getDisplayLineName(line, userLang)) : undefined,
    // ランドマーク（施設名）入力時の最寄り駅案内
    landmark_info: Object.keys(landmarkInfo).length ? landmarkInfo : undefined,
    // 降車駅周辺の文化・芸能・芸術施設（到着地側のみ表示）
    destination_cultural_facilities: getDestinationCulturalFacilities(routeResult.to, userLang).length
      ? getDestinationCulturalFacilities(routeResult.to, userLang)
      : undefined,
    route_note: userLang === 'en' ? "Route computed by the built-in route engine." :
                userLang === 'zh' ? "路线由内置路线引擎计算。" :
                "経路は自己完結型エンジンで算出。",
    // #88: weatherText は出発・到着駅の県コードから組み立て済み（「地域名: 予報」形式）。地域プレフィックスは weatherText 側に含まれる
    weather_text: translateWeather(weatherText, userLang),
    // 路線情報の外部検索URLはフォールバックとして維持
    direct_search_url: (isRainy || isEmergencyActive) ? `${webSearchUrl}&useLocalBus=true&walkSpeed=slow` : webSearchUrl,
    // 運賃情報はsearch_fareツールで取得可能
    fare_available: true,
    fare_note: userLang === 'en' ? "Use search_fare tool to find station-to-station fares." :
               userLang === 'zh' ? "使用 search_fare 工具查询车站间票价。" :
               "search_fareツールで駅間運賃を検索できます。",
    // 公的機関の検索案内: GPS共有があれば現在地、なければ到着駅名・バス停名を基準に表示する。
    // （ご老人等が「駅名」で公的機関を探すケースに対応。v2.36.3）
    gov_facility_search_support: buildGovFacilitySearchSupport(userLocation, userLang, displayTo),
    // 🚌 駅⇔コミュニティバス接続（足の悪いユーザーの駅までの足・駅からの足）
    community_bus_access: communityBusAccessOut
  };

  if (!isSevereWeather && !isSnowRisk && destinationBikeShareInfo) {
    resultPayload.destination_bike_share = {
      note: userLang === 'en' ? "🚲 [Bike Share Near Destination]" :
            userLang === 'zh' ? "🚲 【到达地点附近的共享单车】" :
            "🚲 【到着地点周辺のレンタサイクル】",
      recommendation: userLang === 'en' ? "Bike-share ports near the destination are available for last-mile travel." :
        userLang === 'zh' ? "可使用到达地点附近的共享单车进行最后一段行程。" :
        "到着地点周辺のポートを、ラストワンマイルの移動に利用できます。",
      based_on: 'destination',
      stations: destinationBikeShareInfo,
      total_nearby: destinationBikeShareInfo.length,
      data_source: "docomo-cycle-tokyo GBFS",
      caution: userLang === 'en' ? "Availability and return eligibility may change; check the official app." :
        userLang === 'zh' ? "可用车辆和还车状态可能变化，请通过官方应用确认。" :
        "利用可能台数・返却可否は変動するため、利用前に公式アプリでご確認ください。"
    };
  }

  if (isTrainSuspended && !isSevereWeather && bikeShareInfo) {
    const ref = bikeShareInfo[0]?.reference;
    const isUserLoc = ref === 'user_location';
    resultPayload.cycling_alternative = {
      note: userLang === 'en' ? "🚲 [Transit Suspension - Bike Share Guidance]" :
            userLang === 'zh' ? "🚲 【暂停运营 - 共享单车指南】" :
            "🚲 【運転見合わせ - シェアサイクル案内】",
      recommendation: isUserLoc
        ? (userLang === 'en' ? "🚲 Nearest bike share ports from your current location:" :
           userLang === 'zh' ? "🚲 您当前位置附近的共享单车停靠点：" :
           "🚲 現在地最寄りのシェアサイクルポート：")
        : (userLang === 'en' ? "🚲 Nearest bike share ports from origin station:" :
           userLang === 'zh' ? "🚲 出发站附近的共享单车停靠点：" :
           "🚲 出発駅最寄りのシェアサイクルポート："),
      based_on: isUserLoc ? 'user_location' : 'origin_station',
      stations: bikeShareInfo, total_nearby: bikeShareInfo.length, data_source: "docomo-cycle-tokyo GBFS"
    };
  }

  // フェリー代替
  if (FERRY_PORT_MAP[fromName] || FERRY_PORT_MAP[toName]) {
    resultPayload.ferry_alternative = {
      note: userLang === 'en' ? "🚢 [Ferry Service Guidance]" :
            userLang === 'zh' ? "🚢 【轮渡航线指南】" :
            "🚢 【フェリー航路のご案内】",
      suggestion: userLang === 'en' ? "Use search_ferry tool for details." :
                  userLang === 'zh' ? "使用 search_ferry 工具查看详情。" :
                  "search_ferryツールで詳細を検索できます。"
    };
  }

  // 非鉄道系
  resultPayload.non_rail_transit_support = {
    note: userLang === 'en' ? "🚃 Non-rail transit also available" :
          userLang === 'zh' ? "🚃 非铁路交通工具亦可使用" :
          "🚃 非鉄道系交通機関も利用可能",
    operators: Object.values(NON_RAIL_OPERATORS).map(op => userLang === 'en' ? op.labelEn : userLang === 'zh' ? op.labelZh : op.label).join(userLang === 'en' ? ', ' : '、'),
    suggestion: userLang === 'en' ? "Check list_transit_operators tool for details" :
                userLang === 'zh' ? "详情请使用 list_transit_operators 工具" :
                "詳細は list_transit_operators ツールを"
  };

  // 🚉 目的地（降車駅）周辺のバス停を案内する。降車後の移動手段として、コミュニティ
  // バスや振替輸送の有無に関わらず表示する。
  if (toName) {
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toName + '駅 バス停')}`;
    resultPayload.station_bus_stops = {
      note: userLang === 'en' ? "🚉 [Bus Stops Near Your Destination]" :
            userLang === 'zh' ? "🚉 【目的地车站周边巴士站】" :
            "🚉 【目的地駅周辺バス停】",
      link: mapUrl,
      basis: communityBusAccessOut?.length ? 'community_bus_access'
           : busTransferDetected ? 'substitute_transport'
           : 'destination',
      hint: userLang === 'en' ? `Verify the nearest exit and bus stop with station staff or the bus operator near ${displayTo} Station.` :
            userLang === 'zh' ? `请向车站工作人员或巴士运营商确认${displayTo}站附近的出站口与巴士站。` :
            `${displayTo}駅での降車後の出口・バス停は、駅係員またはバス事業者の案内でご確認ください。`,
      link_label: userLang === 'en' ? `📍 Show bus stops near ${displayTo} Station on Google Maps` :
                  userLang === 'zh' ? `📍 在地图上查看${displayTo}站周边巴士站` :
                  `📍 ${displayTo}駅周辺のバス停を地図で確認`
    };
  }

  // 振替輸送
  if (busTransferDetected && busTransferDetail) {
    resultPayload.bus_transfer_alternative = {
      note: userLang === 'en' ? "🚌 [Substitutive Bus Transport]" :
            userLang === 'zh' ? "🚌 【接驳换乘巴士指南】" :
            "🚌 【振替輸送のご案内】",
      detail: translateTrainInfoDetail(busTransferDetail, userLang),
      suggestion: userLang === 'en' ? "Please inquire with station staff." :
                  userLang === 'zh' ? "请咨询车站工作人员。" :
                  "駅係員にお問い合わせください。"
    };
  }

  // 🚨 緊急避難場所の検索リンクは、災害時のみ表示する。
  // 人身事故・降雪・通常の運行障害は避難場所の適合性を意味しないためリンクを付けない。
  const isDisasterEvacuationCase = ['earthquake', 'emergency', 'typhoon', 'flood', 'fire'].includes(failureAdviceKey);
  if (isEmergencyActive) {
    resultPayload.emergency_alert = {
      status: "ALERT_ACTIVE",
      reason: userLang === 'en' ? (isTrainSuspended ? "Train line suspension detected" : "Emergency disaster warning detected") :
              userLang === 'zh' ? (isTrainSuspended ? "检测到铁路线路暂停运营" : "检测到特别预警级重大灾害") :
              (isTrainSuspended ? "鉄道路線の運行不能を検知" : "特別警報級の重大災害を検知"),
      detail: delayMessage,
      note: (MULTILINGUAL_ADVICE[adviceKey] && (MULTILINGUAL_ADVICE[adviceKey][userLang] || MULTILINGUAL_ADVICE[adviceKey].ja)) || MULTILINGUAL_ADVICE.emergency[userLang] || MULTILINGUAL_ADVICE.emergency.ja,
      evacuation_search: isDisasterEvacuationCase ? {
        type: 'external_search_only',
        link: EMERGENCY_EVACUATION_SEARCH_URL,
        label: userLang === 'en' ? 'Search designated emergency shelters (verify with local authority)'
          : userLang === 'zh' ? '搜索指定紧急避难场所（请向当地政府核实）'
          : '指定緊急避難場所を検索（自治体の公式情報で確認）',
        disclaimer: userLang === 'en'
          ? 'This is a map search, not a verified nearest or hazard-specific shelter assignment. Follow local-authority evacuation instructions.'
          : userLang === 'zh'
            ? '这是地图搜索，并非已核实的最近或适用于该灾害的避难场所分配。请遵从当地政府的避难指示。'
            : '地図検索であり、最寄り・災害種別に適合した避難場所を確定するものではありません。自治体の避難情報に従ってください。'
      } : undefined
    };
  }

  if (simulatedFailure) { resultPayload.test_mode = true; resultPayload.simulated_failure_type = simulatedFailure; }
  return jsonResponse(resultPayload);
}

export function findCommunityBusAccess(stationInput) {
  if (!stationInput) return null;
  const candidates = [stationInput, normalizeStationName(stationInput), stationInput.replace(/駅$/, '')]
    .filter((v, i, a) => a.indexOf(v) === i);
  for (const c of candidates) {
    if (COMMUNITY_BUS_STATION_ACCESS[c]) return { station: c, entries: COMMUNITY_BUS_STATION_ACCESS[c] };
  }
  return null;
}

export function buildCommunityBusAccessBlock(stationInput, userLang) {
  const hit = findCommunityBusAccess(stationInput);
  if (!hit) return null;
  return {
    note: userLang === 'en' ? "🚌 [Community Bus Access (first/last mile)]" :
          userLang === 'zh' ? "🚌 【社区公交接驳（首末段）】" :
          "🚌 【コミュニティバス接続（駅までの足・駅からの足）】",
    station: getDisplayStationName(hit.station, userLang),
    buses: hit.entries.map(e => ({
      bus: getCommunityBusDisplayName(e.bus, userLang),
      municipality: e.municipality,
      stop: getCommunityBusStopDisplayName(e.stop, userLang),
      url: e.url,
      barrier_free_note: userLang === 'en'
        ? "Wheelchair / low-floor availability varies by service — check the official municipal page."
        : userLang === 'zh'
        ? "轮椅 / 低地板车辆的可用性因线路而异 — 请查看各自治体官网。"
        : "車椅子・低床バスの有無は系統により異なります。自治体公式サイトでご確認ください。"
    })),
    timetable_note: userLang === 'en' ? "Timetables & full routes: official municipal site."
      : userLang === 'zh' ? "时刻表与完整路线请参见各自治体官网。"
      : "時刻表・全ルートは各自治体公式サイトでご確認ください。"
  };
}
