#!/usr/bin/env node
/**
 * check-line-geometry.mjs — RAILWAY_LINES の「路線内の駅順が地理的に正しいか」を機械検証する。
 *
 * 背景:
 *   ローカル RAILWAY_LINES（src/data/railway-lines.mjs）の路線データが
 *   ・誤った駅順（駅が入れ替わっている）
 *   ・欠落駅（駅が抜かれている）
 *   ・存在しない駅名の混入
 *   を持つと、経路検索（search_route）が誤ったルートを返す。
 *   そこで駅座標（STATION_COORDS / STATION_COORDS_EXTRA / Wikidata スライス）を
 *   手掛かりに、路線ごとの駅列の幾何学的な整合性を機械的に検査する。
 *
 * 検査項目:
 *   [1] 隣接駅間距離の乖離  : 隣接ペア距離が「その路線の中央値ペア距離の 3 倍超」→ 駅欠落/駅順飛びの疑い
 *   [2] 路線座標連続性低下  : 隣接駅間距離の標準偏差/平均（変動係数 CV）が大きい路線
 *   [3] 左側/右側データ不整合: 各駅の「前後駅の弦に対する左右のずれ」と「経度/緯度の単調性違反」
 *   [4] 共通路線との駅順照合: 共通駅を持つ他路線と駅順が矛盾する（cross-check）
 *   [5] 局所座標 vs Wikidata: ローカル座標と Wikidata 座標の乖離（同名異駅の取り違え検出）
 *   [6] Wikipedia 実在性    : Wikipedia(ja) 記事が無い駅名（実在性の要確認）
 *
 * 使い方:
 *   node scripts/check-line-geometry.mjs
 *   node scripts/check-line-geometry.mjs --top=20          … 重要 detections の表示件数を指定
 *   node scripts/check-line-geometry.mjs --no-wikidata     … Wikidata スライスを使わず ローカル座標のみ
 *   node scripts/check-line-geometry.mjs --wikipedia       … Wikipedia 実在性検査も実行（ネットワーク必須）
 *   node scripts/check-line-geometry.mjs --all-stations    … Wikipedia 検査対象を全駅に拡張
 *   node scripts/check-line-geometry.mjs --json            … JSON 出力
 *
 * 終了コード: 0 = 検出なし / 1 = 検出あり / 2 = 実行環境エラー
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RAILWAY_LINES, STATION_COORDS } from '../src/data/railway-lines.mjs';
import { STATION_COORDS_EXTRA } from '../src/data/station-coords-extra.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 定数・既定値
// ---------------------------------------------------------------------------

/** Wikidata 駅座標スライスの既定パス（環境変数 WIKIDATA_STATIONS_JSON で上書き可） */
const WIKIDATA_PATH = process.env.WIKIDATA_STATIONS_JSON
  || 'C:/Users/oresama/AppData/Local/hermes/cache/scratch/wikidata-stations.json';

/** 地球の半径（km） */
const EARTH_R = 6371;

/** 1 纬度 ≒ 111.32km / 1 経度 ≒ 111.32km*cos(lat) */
const KM_PER_DEG = 111.32;

/** 路線内の「中央値ペア距離」の何倍を超えたら乖離として報告するか */
const OUTLIER_RATIO = 3.0;

/** 乖離報告の下限距離（km）。この未満は「駅間隔がもともと狭い」ため見送る */
const MIN_OUTLIER_KM = 1.0;

/** 路線連続性（CV）の報告しきい値 */
const CV_THRESHOLD = 0.5;

/** 連続性の計算に必要な最小ペア数 */
const MIN_PAIRS = 3;

/** 左右（弦）判定で「ほぼ直線上」とみなす tolerated ずれ（km） */
const SIDE_EPS = 0.08;

/** 単調性判定で「後退」とみなす最小逆行量（km） */
const MONO_EPS = 0.20;

/** 欠落候補探索の最大半径（km） */
const MISSING_RADIUS_KM = 6.0;

/** Wikipedia 実在性検査の User-Agent（Wikimedia の etiquette に従い識別可能なものを付ける） */
const WIKI_UA = 'tokyo-transit-mcp-geometry-audit/1.0 (local data integrity check; local user)';

/** 日本本土+JDK・沖縄のおおよその緯度経度バウンディングボックス（外国の同名駅を除外する） */
const JP_BBOX = { minLat: 25.0, maxLat: 46.0, minLon: 125.0, maxLon: 146.0 };

/** 「快速」等 legitimately 駅間隔が長い路線（報告時に注記を付ける） */
const RAPID_LINES = new Set([
  'JR中央線快速', 'JR総武線快速', 'JR常磐線快速', 'JR埼京線', 'JR湘南新宿ライン',
  'JR湘南新宿ライン（宇都宮線直通）', 'JR湘南新宿ライン（高崎線直通）',
  'JR上野東京ライン（宇都宮線直通）', 'JR上野東京ライン（高崎線直通）',
  'JR高崎線', 'JR宇都宮線', 'JR横須賀線', 'JR東海道線',
]);

// ---------------------------------------------------------------------------
// コマンドライン引数
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const OPT = {
  top: Number(flagValue('top', 20)),
  useWikidata: !hasFlag('no-wikidata'),
  useWikipedia: hasFlag('wikipedia'),
  allStations: hasFlag('all-stations'),
  json: hasFlag('json'),
  wikidataPath: flagValue('wikidata', WIKIDATA_PATH),
};

// ---------------------------------------------------------------------------
// 幾何ヘルパー
// ---------------------------------------------------------------------------

/** 2点間のハーバサイン距離（km） */
function haversine(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(x));
}

/** 中央値 */
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 平均 */
const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);

/** 母標準偏差 */
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((x, y) => x + (y - m) ** 2, 0) / arr.length);
}

/** 駅名から路線名などの括弧表記を取り除く（例: 両国（大江戸線）→ 両国） */
function baseName(name) {
  return String(name).replace(/[（(〈【][^）)〉】]*[）)〉】]/g, '').trim();
}

/** 括弧の中身を取り出す */
function suffixOf(name) {
  const m = String(name).match(/[（(〈【]([^）)〉】]*)[）)〉】]/);
  return m ? m[1] : null;
}

/** 括弧が「線名修飾」か「同一駅の別表記」かの判定 */
const LINE_QUALIFIER_RE = /(線|電鉄|鉄道|地下鉄|モノレール|ライナー|バス|フェリー|エクスプレス|シャトル|レール)/;

/**
 * 括弧付き駅名について、括弧が「同一駅の別表記」か「別駅を示す線名修飾」かを返す。
 * 例:
 *   明治神宮前〈原宿〉 → 'same' （原宿は地名の一部）
 *   両国（大江戸線）   → 'line' （大江戸線側の別駅）
 */
function qualifierKind(name) {
  const suf = suffixOf(name);
  if (!suf) return 'none';
  if (LINE_QUALIFIER_RE.test(suf)) return 'line';
  return 'same';
}

// ---------------------------------------------------------------------------
// 座標辞書の構築
// ---------------------------------------------------------------------------

/** ローカル座標（STATION_COORDS + STATION_COORDS_EXTRA）の統合 */
function buildLocalCoords() {
  const map = new Map();
  for (const [k, v] of Object.entries(STATION_COORDS || {})) {
    if (!v || typeof v.lat !== 'number' || typeof v.lon !== 'number') continue;
    map.set(k, { lat: v.lat, lon: v.lon, src: 'STATION_COORDS' });
  }
  for (const [k, v] of Object.entries(STATION_COORDS_EXTRA || {})) {
    if (!Array.isArray(v)) continue;
    map.set(k, { lat: v[0], lon: v[1], src: 'STATION_COORDS_EXTRA' });
  }
  return map;
}

/** Wikidata スライスを読み込み、駅名 → 候補座標リスト の索引を作る */
function buildWikidataIndex(filePath) {
  const index = new Map();
  if (!fs.existsSync(filePath)) return { index, available: false, error: 'ファイルが見つからない' };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { index, available: false, error: e.message };
  }
  const inJp = (lat, lon) => lat >= JP_BBOX.minLat && lat <= JP_BBOX.maxLat
    && lon >= JP_BBOX.minLon && lon <= JP_BBOX.maxLon;

  for (const [label, entries] of Object.entries(raw)) {
    if (!Array.isArray(entries)) continue;
    // ラベル末尾の「駅」を取り除いたものを基準名とする。
    // 「京王電鉄 京王線新宿駅」のような路線名付きラベルは、
    // 末尾の「◯◯駅」部分を切り出した名称も候補として登録する。
    const bases = new Set();
    if (label.endsWith('駅')) bases.add(label.slice(0, -1));
    const parts = label.split(/[・\s/]/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const tail = parts.slice(i).join('');
      if (tail.endsWith('駅')) bases.add(tail.slice(0, -1));
    }
    for (const base of bases) {
      if (!base) continue;
      for (const e of entries) {
        if (!e || typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
        if (!inJp(e.lat, e.lon)) continue; // 日本国外の同名駅は除外
        if (!index.has(base)) index.set(base, []);
        index.get(base).push({
          lat: e.lat,
          lon: e.lon,
          src: `Wikidata:${String(e.item || '').split('/').pop()}`,
          label,
        });
      }
    }
  }
  // 同一座標・同一 QID の重複（同一項目が複数回入る等）を潰す
  for (const [k, list] of index) {
    const seen = new Set();
    const out = [];
    for (const c of list) {
      const key = `${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.src}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    index.set(k, out);
  }
  return { index, available: true, raw };
}

/**
 * 駅名に対して候補座標を集める。
 * - 完全一致のローカル座標を最優先（手動検証済みデータを尊重）
 * - 括弧が「同一駅の別表記」なら、括弧を外した名前のローカル座標も候補にする
 * - Wikidata の候補を足す（同名異駅の解決は路線文脈で行う）
 */
function candidatesFor(name, localCoords, wdIndex) {
  const out = [];
  const push = (c, tag) => {
    if (!c) return;
    const key = `${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.tag || ''}`;
    if (out.some((x) => `${x.lat.toFixed(4)},${x.lon.toFixed(4)},${x.tag || ''}` === key)) return;
    out.push({ ...c, tag });
  };

  const exact = localCoords.get(name);
  if (exact) push(exact, 'local-exact');

  const base = baseName(name);
  const kind = qualifierKind(name);
  if (base !== name && kind === 'same') {
    const localBase = localCoords.get(base);
    if (localBase) push(localBase, 'local-same-station');
  }

  if (wdIndex) {
    for (const c of wdIndex.get(base) || []) push(c, 'wikidata');
    if (base !== name) {
      for (const c of wdIndex.get(name) || []) push(c, 'wikidata-exact');
    }
  }
  return out;
}

/**
 * 路線文脈で候補座標を1つ選ぶ。
 *  ・exact なローカル座標があればそれを最優先（手動検証済みデータを尊重）
 *  ・それ以外は、同一路線内の他駅から最も近い候補を文脈上の最良とする
 */
function resolveStations(stations, localCoords, wdIndex) {
  const cands = stations.map((s) => candidatesFor(s, localCoords, wdIndex));
  const chosen = cands.map((list) => {
    const ex = list.find((c) => c.tag === 'local-exact');
    if (ex) return { ...ex, locked: true };
    if (list.length) return { ...list[0], locked: false };
    return null;
  });

  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (let i = 0; i < cands.length; i++) {
      if (chosen[i]?.locked || cands[i].length < 2) continue;
      let best = null;
      let bestScore = Infinity;
      for (const c of cands[i]) {
        let sum = 0;
        let n = 0;
        for (let j = 0; j < cands.length; j++) {
          if (j === i || !chosen[j]) continue;
          sum += haversine(c, chosen[j]);
          n++;
        }
        const score = n ? sum / n : Infinity;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (best && best !== chosen[i]) {
        chosen[i] = { ...best, locked: false };
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { cands, chosen };
}

// ---------------------------------------------------------------------------
// 検査 [1] 隣接駅間距離の乖離
// ---------------------------------------------------------------------------

/**
 * 「A→B 間の直線上付近にある、この路線に載っていない駅」を欠落候補として探す。
 * （線路は曲がるため完全一致はしないが、駅欠落の手掛かりになる）
 */
function findMissingCandidates(stations, a, b, coordOf, globalCoords) {
  const A = coordOf.get(a);
  const B = coordOf.get(b);
  if (!A || !B) return [];
  const la0 = A.lat * Math.PI / 180;
  const ax = (B.lon - A.lon) * Math.cos(la0) * KM_PER_DEG;
  const ay = (B.lat - A.lat) * KM_PER_DEG;
  const L = Math.hypot(ax, ay);
  if (L < 1) return [];
  const onLine = new Set(stations);
  const hits = [];
  for (const [name, c] of globalCoords) {
    if (onLine.has(name)) continue;
    const px = (c.lon - A.lon) * Math.cos(la0) * KM_PER_DEG;
    const py = (c.lat - A.lat) * KM_PER_DEG;
    const t = (px * ax + py * ay) / (L * L);
    if (t < -0.2 || t > 1.2) continue;
    const perp = Math.abs(px * ay - py * ax) / L;
    if (perp > MISSING_RADIUS_KM) continue;
    hits.push({ name, t, perp });
  }
  hits.sort((x, y) => x.perp - y.perp);
  return hits.slice(0, 5).map((h) => h.name);
}

// ---------------------------------------------------------------------------
// 検査 [3] 左側/右側（弦）チェックと 単調性チェック
// ---------------------------------------------------------------------------

/**
 * 路線軸に沿って各駅を投影し、進行方向が後退している箇所を検出する。
 * （経度/緯度が単調減少/単調増加していない箇所の検出）
 */
function analyseMonotonicity(stations, chosen) {
  const idx = [];
  for (let i = 0; i < stations.length; i++) if (chosen[i]) idx.push(i);
  if (idx.length < 4) return { reversals: [], loopLike: false, axis: null };

  const first = chosen[idx[0]];
  const last = chosen[idx[idx.length - 1]];
  const la0 = first.lat * Math.PI / 180;
  const ax = (last.lon - first.lon) * Math.cos(la0) * KM_PER_DEG;
  const ay = (last.lat - first.lat) * KM_PER_DEG;

  // 経路長（折れ線）を求める
  let pathLen = 0;
  for (let k = 1; k < idx.length; k++) pathLen += haversine(chosen[idx[k - 1]], chosen[idx[k]]);
  const span = Math.hypot(ax, ay);
  // 始点と終点が近ければ環状路線（山手線・テーマパーク線）なので軸解析は不適
  const loopLike = pathLen > 0 && span / pathLen < 0.5;
  if (loopLike || span < 1) return { reversals: [], loopLike, axis: null };

  const ux = ax / span;
  const uy = ay / span;
  const proj = idx.map((i) => {
    const p = chosen[i];
    const px = (p.lon - first.lon) * Math.cos(la0) * KM_PER_DEG;
    const py = (p.lat - first.lat) * KM_PER_DEG;
    return px * ux + py * uy;
  });

  // 進行方向が反転する箇所を検出する
  const deltas = [];
  for (let k = 1; k < proj.length; k++) deltas.push(proj[k] - proj[k - 1]);

  const reversals = [];
  let lastSign = 0;
  let lastSignIdx = -1;
  for (let k = 0; k < deltas.length; k++) {
    if (Math.abs(deltas[k]) < MONO_EPS) continue;
    const s = Math.sign(deltas[k]);
    if (lastSign !== 0 && s !== lastSign) {
      const prevStation = stations[idx[lastSignIdx]];
      const curStation = stations[idx[k + 1]];
      reversals.push({
        prevIndex: idx[lastSignIdx],
        index: idx[k + 1],
        prevName: prevStation,
        name: curStation,
        backKm: Math.abs(deltas[lastSignIdx] || 0),
        swingKm: Math.abs(deltas[k]),
        totalKm: Math.abs(deltas[lastSignIdx] || 0) + Math.abs(deltas[k]),
      });
    }
    lastSign = s;
    lastSignIdx = k;
  }
  return { reversals, loopLike, axis: { ux, uy, span, pathLen } };
}

/** 検査[1]〜[3]を実行する */
function analyseLine(lineName, stations) {
  const { chosen, cands } = resolveStations(stations, LOCAL_COORDS, WD_INDEX);
  const coordOf = new Map();
  for (let i = 0; i < stations.length; i++) {
    if (chosen[i]) coordOf.set(stations[i], chosen[i]);
  }

  // 隣接ペア距離
  const pairs = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const ca = chosen[i];
    const cb = chosen[i + 1];
    if (!ca || !cb) continue; // 座標が無い駅はスキップ
    pairs.push({ index: i, a: stations[i], b: stations[i + 1], dist: haversine(ca, cb) });
  }

  const dists = pairs.map((p) => p.dist);
  const med = median(dists);
  const avg = mean(dists);
  const sd = stdev(dists);
  const cv = avg > 0 ? sd / avg : 0;

  // [1] 乖離ペア
  const outliers = [];
  if (pairs.length >= MIN_PAIRS && med > 0) {
    for (const p of pairs) {
      if (p.dist > OUTLIER_RATIO * med && p.dist >= MIN_OUTLIER_KM) {
        outliers.push({ ...p, ratio: p.dist / med });
      }
    }
  }
  for (const o of outliers) {
    o.missingCandidates = findMissingCandidates(stations, o.a, o.b, coordOf, LOCAL_COORDS);
  }

  // [3a] 左右（弦）チェック
  const sides = [];
  for (let i = 1; i < stations.length - 1; i++) {
    const A = chosen[i - 1];
    const B = chosen[i];
    const C = chosen[i + 1];
    if (!A || !B || !C) continue;
    const la0 = A.lat * Math.PI / 180;
    const ax = (C.lon - A.lon) * Math.cos(la0) * KM_PER_DEG;
    const ay = (C.lat - A.lat) * KM_PER_DEG;
    const px = (B.lon - A.lon) * Math.cos(la0) * KM_PER_DEG;
    const py = (B.lat - A.lat) * KM_PER_DEG;
    const chord = Math.hypot(ax, ay);
    if (chord < 1e-6) continue;
    const t = (px * ax + py * ay) / (chord * chord);
    const perp = (px * ay - py * ax) / chord; // 符号付き（左=+/右=-）
    sides.push({ index: i, name: stations[i], t, perp, chord });
  }

  const sideFlips = [];
  const outOfChord = [];
  let prevSign = 0;
  for (const s of sides) {
    if (Math.abs(s.perp) < SIDE_EPS) continue;
    const sign = Math.sign(s.perp);
    if (prevSign !== 0 && sign !== prevSign) sideFlips.push(s);
    prevSign = sign;
  }
  for (const s of sides) {
    if (s.t < -0.1 || s.t > 1.1) outOfChord.push(s);
  }

  // [3b] 単調性チェック
  const mono = analyseMonotonicity(stations, chosen);

  const unresolved = stations.filter((s, i) => !chosen[i]);
  const ambiguous = stations.filter((s, i) => cands[i] && cands[i].length > 1);

  return {
    lineName,
    stations,
    chosen,
    pairs,
    median: med,
    mean: avg,
    stdev: sd,
    cv,
    outliers,
    sideFlips,
    outOfChord,
    mono,
    unresolved,
    ambiguous,
  };
}

// ---------------------------------------------------------------------------
// 検査 [4] 共通路線との駅順照合（cross-check）
// ---------------------------------------------------------------------------

/**
 * 2路線の共通駅の並び順を比較する。
 *
 * A 側で連続している共通駅区間（＝同じ線路を走っている区間）だけを見る。
 * 共通駅を B 側でのインデックスに置き換えると、
 *   ・単調増加 かつ 差分 +1 … B は A と同じ方向・同じ駅間隔 → 正当
 *   ・単調減少 かつ 差分 -1 … B は A と逆方向の運行        → 正当
 *   ・単調だが差分が +1 以外 … B は間に駅を挟んで通過（快速/各停の違い）→ informational
 *   ・単調でない … 共通駅の前後関係が矛盾 → 駅順の破綻（重大）
 */
function compareRouteOrder(aStations, bStations) {
  const shared = aStations.filter((s) => bStations.includes(s));
  if (shared.length < 2) return null;

  // A 側で連続している共通駅の区間（run）を切り出す
  const runs = [];
  let cur = [];
  for (const s of aStations) {
    if (shared.includes(s)) {
      cur.push(s);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);

  const contradictions = [];
  const passages = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    const bIdx = run.map((s) => bStations.indexOf(s));

    // 単調性（増加 or 減少）を判定する
    let ascending = true;
    let descending = true;
    for (let k = 1; k < bIdx.length; k++) {
      if (bIdx[k] <= bIdx[k - 1]) ascending = false;
      if (bIdx[k] >= bIdx[k - 1]) descending = false;
    }

    if (ascending || descending) {
      // 単調なら前後関係に矛盾はない。usteps が 1 以外なら「駅を挟んで通過」
      const step = ascending ? 1 : -1;
      const gaps = [];
      for (let k = 1; k < bIdx.length; k++) {
        if (bIdx[k] - bIdx[k - 1] !== step) {
          for (let j = Math.min(bIdx[k - 1], bIdx[k]) + 1; j < Math.max(bIdx[k - 1], bIdx[k]); j++) {
            gaps.push(bStations[j]);
          }
        }
      }
      if (gaps.length) passages.push({ run, bIdx, gaps });
      continue;
    }

    // 単調でない＝共通駅の前後関係が矛盾している
    const intruders = [];
    const lo = Math.min(...bIdx);
    const hi = Math.max(...bIdx);
    for (let k = lo; k <= hi; k++) {
      const st = bStations[k];
      if (!run.includes(st)) intruders.push(st);
    }
    // 具体的に入れ替わっている駅ペアを1つ示す
    let pair = null;
    for (let i = 0; i < run.length && !pair; i++) {
      for (let j = i + 1; j < run.length; j++) {
        if ((bIdx[i] < bIdx[j]) !== (i < j)) { pair = { a: run[i], b: run[j] }; break; }
      }
    }
    contradictions.push({ run, bIdx, intruders, pair });
  }
  if (!contradictions.length && !passages.length) return null;
  return { shared, contradictions, passages };
}

// ---------------------------------------------------------------------------
// 検査 [5] ローカル座標 vs Wikidata 座標の乖離
// ---------------------------------------------------------------------------

/**
 * 各路線について「その駅のローカル座標」と「近傍の駅から見て最も整合する Wikidata 座標」を比較する。
 * ローカル座標が路線から大きく外れ、Wikipedia 側の座標の方が路線に整合する場合は
 * 「ローカル座標（同名異駅の取り違え）」の疑いがある。
 */
function compareLocalVsWikidata(analyses) {
  const rows = [];
  for (const a of analyses) {
    const { stations } = a;
    for (let i = 0; i < stations.length; i++) {
      const local = LOCAL_COORDS.get(stations[i]);
      if (!local) continue;
      if (!WD_INDEX) continue;
      const base = baseName(stations[i]);
      const wdList = WD_INDEX.get(base) || WD_INDEX.get(stations[i]) || [];
      if (!wdList.length) continue;

      // 近傍のローカル座標（自身は除く）を基準にする
      const neighbours = [];
      for (let j = Math.max(0, i - 3); j <= Math.min(stations.length - 1, i + 3); j++) {
        if (j === i) continue;
        const c = LOCAL_COORDS.get(stations[j]);
        if (c) neighbours.push(c);
      }
      if (!neighbours.length) continue;

      const avgTo = (pt) => mean(neighbours.map((n) => haversine(pt, n)));
      const dLocal = avgTo(local);
      let best = null;
      let bestD = Infinity;
      for (const w of wdList) {
        const d = avgTo(w);
        if (d < bestD) { bestD = d; best = w; }
      }
      if (!best) continue;
      const delta = haversine(local, best);
      // ローカル座標が路線から大きく外れ、かつ Wikipedia 座標の方が整合している場合のみ報告
      if (dLocal - bestD > 2.0 && dLocal > 5.0) {
        rows.push({
          name: stations[i],
          line: a.lineName,
          local: { lat: local.lat, lon: local.lon },
          wd: { lat: best.lat, lon: best.lon },
          wdSrc: best.src,
          delta,
          localOffset: dLocal,
          wdOffset: bestD,
        });
      }
    }
  }
  // 同一駅名は最悪の例でまとめる
  const byName = new Map();
  for (const r of rows) {
    const prev = byName.get(r.name);
    if (!prev || r.delta > prev.delta) byName.set(r.name, r);
  }
  return [...byName.values()].sort((x, y) => y.delta - x.delta);
}

// ---------------------------------------------------------------------------
// 検査 [6] Wikipedia 実在性
// ---------------------------------------------------------------------------

/** 駅名から Wikipedia 記事タイトル候補を作る */
function wikiTitleCandidates(name) {
  const out = new Set();
  out.add(`${name}駅`);
  const base = baseName(name);
  if (base !== name) {
    out.add(`${base}駅`);
    const suf = suffixOf(name);
    if (suf) out.add(`${suf}（${base}駅）`);
  }
  return [...out];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wikipedia 記事が存在するか（REST API）。429 は「判定不能」として扱う */
async function wikiExists(title) {
  const url = `https://ja.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(title)}/bare`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': WIKI_UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 200) return { title, status: 'exists' };
      if (res.status === 404) return { title, status: 'missing' };
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after') || 0);
        await sleep(Math.min(Math.max(ra, 3) * 1000, 20000));
        continue;
      }
      return { title, status: 'error', code: res.status };
    } catch (e) {
      await sleep(2000 * (attempt + 1));
    }
  }
  return { title, status: 'unknown' };
}

/** 対象駅名について Wikipedia 実在性を調べる */
async function checkWikipedia(stationNames) {
  const results = [];
  let undetermined = 0;
  for (const name of stationNames) {
    const titles = wikiTitleCandidates(name);
    let verdict = { title: titles[0], status: 'unknown' };
    for (const t of titles) {
      verdict = await wikiExists(t);
      if (verdict.status === 'exists' || verdict.status === 'missing') break;
    }
    if (verdict.status === 'unknown' || verdict.status === 'error') undetermined++;
    results.push({ name, ...verdict });
    await sleep(1200); // レート制限対策
  }
  return { results, undetermined };
}

// ---------------------------------------------------------------------------
// 出力（日本語・重大度順）
// ---------------------------------------------------------------------------

const line = (ch = '─', n = 78) => ch.repeat(n);
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-');
const bySeverity = (a, b) => (b.deviationKm ?? 0) - (a.deviationKm ?? 0);

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

// グローバル参照用（関数内から使うため）
let LOCAL_COORDS = new Map();
let WD_INDEX = null;
let WD_AVAILABLE = false;

async function main() {
  LOCAL_COORDS = buildLocalCoords();

  if (OPT.useWikidata) {
    const wd = buildWikidataIndex(OPT.wikidataPath);
    WD_INDEX = wd.index;
    WD_AVAILABLE = wd.available;
    if (!wd.available && wd.error) {
      console.error(`[警告] Wikidata スライスを読めませんでした（${OPT.wikidataPath}）: ${wd.error}`);
    }
  }

  const lines = Object.entries(RAILWAY_LINES);
  const analyses = lines.map(([name, stations]) => analyseLine(name, stations));

  // 検出をまとめる
  const findings = { gap: [], cv: [], side: [], mono: [], cross: [], coord: [] };

  // [1] 乖離ペア
  for (const a of analyses) {
    for (const o of a.outliers) {
      findings.gap.push({
        type: 'gap',
        line: a.lineName,
        stationA: o.a,
        stationB: o.b,
        distanceKm: o.dist,
        deviationKm: o.dist,
        order: `${o.a} → ${o.b}`,
        ratio: o.ratio,
        medianKm: a.median,
        missingCandidates: o.missingCandidates,
        rapid: RAPID_LINES.has(a.lineName),
      });
    }
  }

  // [2] 路線連続性
  for (const a of analyses) {
    if (a.pairs.length < MIN_PAIRS) continue;
    if (a.cv >= CV_THRESHOLD) {
      findings.cv.push({
        type: 'cv',
        line: a.lineName,
        stationA: '-',
        stationB: '-',
        distanceKm: a.mean,
        deviationKm: a.stdev,
        order: `平均 ${fmt(a.mean)}km / 中央値 ${fmt(a.median)}km`,
        cv: a.cv,
        pairs: a.pairs.length,
        medianKm: a.median,
      });
    }
  }

  // [3a] 左側/右側（弦）不整合
  for (const a of analyses) {
    for (const s of a.outOfChord) {
      findings.side.push({
        type: 'out-of-chord',
        line: a.lineName,
        stationA: a.stations[s.index - 1] || '-',
        stationB: s.name,
        distanceKm: Math.abs(s.perp),
        deviationKm: Math.abs(s.perp),
        order: `${a.stations[s.index - 1] || '-'} → ${s.name} → ${a.stations[s.index + 1] || '-'}`,
        detail: `弦外れ（投影位置 t=${fmt(s.t)}・弦ずれ ${fmt(Math.abs(s.perp))}km）`,
      });
    }
  }

  // [3b] 単調性違反（左tor右の並びが単調でない）
  for (const a of analyses) {
    for (const r of a.mono.reversals) {
      findings.mono.push({
        type: 'monotonicity',
        line: a.lineName,
        stationA: r.prevName,
        stationB: r.name,
        distanceKm: r.totalKm,
        deviationKm: r.totalKm,
        order: `${r.prevName} → ${r.name}`,
        detail: `進行方向の反転（後退 ${fmt(r.backKm)}km）`,
      });
    }
  }

  // [4] 共通路線との駅順照合
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const cmp = compareRouteOrder(lines[i][1], lines[j][1]);
      if (!cmp) continue;
      for (const c of cmp.contradictions) {
        const intruders = c.intruders.join('/') || '—';
        const pair = c.pair ? `${c.pair.a} / ${c.pair.b}` : '—';
        const d = (() => {
          const first = c.run[0];
          const last = c.run[c.run.length - 1];
          const ca = LOCAL_COORDS.get(first) || LOCAL_COORDS.get(baseName(first));
          const cb = LOCAL_COORDS.get(last) || LOCAL_COORDS.get(baseName(last));
          return ca && cb ? haversine(ca, cb) : 0;
        })();
        findings.cross.push({
          type: 'cross-order',
          line: lines[i][0],
          other: lines[j][0],
          stationA: c.pair ? c.pair.a : c.run[0],
          stationB: c.pair ? c.pair.b : c.run[c.run.length - 1],
          distanceKm: d,
          deviationKm: d,
          order: c.run.join(' → '),
          detail: `前後関係が矛盾（入れ替わり: ${pair} / 割り込み: ${intruders}）`,
          severity: 'critical',
          shared: cmp.shared,
        });
      }
      for (const p of cmp.passages) {
        const d = (() => {
          const first = p.run[0];
          const last = p.run[p.run.length - 1];
          const ca = LOCAL_COORDS.get(first) || LOCAL_COORDS.get(baseName(first));
          const cb = LOCAL_COORDS.get(last) || LOCAL_COORDS.get(baseName(last));
          return ca && cb ? haversine(ca, cb) : 0;
        })();
        findings.cross.push({
          type: 'cross-passage',
          line: lines[i][0],
          other: lines[j][0],
          stationA: p.run[0],
          stationB: p.run[p.run.length - 1],
          distanceKm: d,
          deviationKm: d,
          order: p.run.join(' → '),
          detail: `他路線が駅を挟んで通過: ${p.gaps.join('/')}`,
          severity: 'info',
          shared: cmp.shared,
        });
      }
    }
  }

  // [5] ローカル座標 vs Wikidata
  if (WD_AVAILABLE) {
    for (const r of compareLocalVsWikidata(analyses)) {
      findings.coord.push({
        type: 'coord-delta',
        line: r.line,
        stationA: r.name,
        stationB: '-',
        distanceKm: r.delta,
        deviationKm: r.delta,
        order: `ローカル ${fmt(r.local.lat, 4)},${fmt(r.local.lon, 4)} / ${r.wdSrc} ${fmt(r.wd.lat, 4)},${fmt(r.wd.lon, 4)}`,
        detail: `路線からのずれ ローカル ${fmt(r.localOffset, 1)}km → Wikidata ${fmt(r.wdOffset, 1)}km`,
      });
    }
  }

  // [6] Wikipedia 実在性
  let wiki = null;
  if (OPT.useWikipedia) {
    const flagged = new Set();
    for (const f of [...findings.gap, ...findings.side, ...findings.mono]) {
      for (const s of [f.stationA, f.stationB]) {
        if (s && s !== '-') flagged.add(s);
      }
    }
    for (const f of findings.cross) {
      if (f.severity === 'info') continue;
      for (const s of [f.stationA, f.stationB]) {
        if (s && s !== '-') flagged.add(s);
      }
    }
    const targets = OPT.allStations
      ? [...new Set(Object.values(RAILWAY_LINES).flat())]
      : [...flagged];
    console.error(`[INFO] Wikipedia 実在性検査を開始（対象 ${targets.length} 駅）…`);
    wiki = await checkWikipedia(targets);
  }

  // ---------------------------------------------------------------------
  // JSON 出力
  // ---------------------------------------------------------------------
  if (OPT.json) {
    const payload = {
      summary: {
        lines: lines.length,
        stations: new Set(Object.values(RAILWAY_LINES).flat()).size,
        localCoords: LOCAL_COORDS.size,
        wikidataAvailable: WD_AVAILABLE,
        counts: {
          gap: findings.gap.length,
          cv: findings.cv.length,
          side: findings.side.length,
          mono: findings.mono.length,
          cross: findings.cross.filter((f) => f.severity !== 'info').length,
          crossInfo: findings.cross.filter((f) => f.severity === 'info').length,
          coord: findings.coord.length,
          wikiMissing: wiki ? wiki.results.filter((r) => r.status === 'missing').length : 0,
        },
      },
      findings,
      wikipedia: wiki,
    };
    console.log(JSON.stringify(payload, null, 2));
    const total = Object.values(findings).reduce((s, a) => s + a.length, 0)
      - findings.cross.filter((f) => f.severity === 'info').length
      + (wiki ? wiki.results.filter((r) => r.status === 'missing').length : 0);
    process.exit(total > 0 ? 1 : 0);
  }

  // ---------------------------------------------------------------------
  // 人が読むレポート
  // ---------------------------------------------------------------------
  const gapSorted = findings.gap.sort(bySeverity);
  const sideSorted = findings.side.sort(bySeverity);
  const monoSorted = findings.mono.sort(bySeverity);
  const crossSorted = findings.cross.sort(bySeverity);
  const coordSorted = findings.coord.sort(bySeverity);
  const cvSorted = findings.cv.sort((a, b) => b.cv - a.cv);

  console.log(line('═'));
  console.log('  路線ジオメトリ検証 / RAILWAY_LINES 駅順チェック');
  console.log(line('═'));
  console.log(`  路線数              : ${lines.length} 本`);
  console.log(`  路線内駅名（重複除）: ${new Set(Object.values(RAILWAY_LINES).flat()).size} 駅`);
  console.log(`  ローカル座標数      : ${LOCAL_COORDS.size} 駅（STATION_COORDS + STATION_COORDS_EXTRA）`);
  console.log(`  Wikidata スライス    : ${WD_AVAILABLE ? `有効（${WD_INDEX.size} 駅名索引）` : `不使用/未読込（${OPT.wikidataPath}）`}`);
  console.log(`  判定しきい値        : 乖離 > 中央値×${OUTLIER_RATIO}（かつ ${MIN_OUTLIER_KM}km 以上）/ CV >= ${CV_THRESHOLD} / 単調性 逆行 >= ${MONO_EPS}km`);
  console.log('');

  // --- [1] 乖離ペア ---
  console.log(line());
  console.log(`【1】隣接駅間距離の乖離（中央値ペア距離の ${OUTLIER_RATIO} 倍超） … ${gapSorted.length} 件`);
  console.log(line());
  if (!gapSorted.length) {
    console.log('  該当なし');
  } else {
    console.log('  乖離km | 路線名 | 駅A → 駅B | 実距離km | 倍率 | 欠落候補');
    console.log(`  ${line('-', 74)}`);
    for (const f of gapSorted.slice(0, OPT.top)) {
      const miss = f.missingCandidates.length ? f.missingCandidates.join('/') : '—';
      const tag = f.rapid ? ' ※快速路線' : '';
      console.log(`  ${fmt(f.deviationKm, 1).padStart(7)} | ${f.line}${tag} | ${f.order} | ${fmt(f.distanceKm, 1)} | ×${fmt(f.ratio, 1)} | ${miss}`);
    }
    if (gapSorted.length > OPT.top) console.log(`  … 他 ${gapSorted.length - OPT.top} 件`);
  }
  console.log('');

  // --- [2] 連続性 ---
  console.log(line());
  console.log(`【2】路線座標連続性の低下（隣接距離の標準偏差/平均） … ${cvSorted.length} 件`);
  console.log(line());
  if (!cvSorted.length) {
    console.log('  該当なし');
  } else {
    console.log('  CV    | 路線名 | 平均km | 中央値km | 標準偏差km | ペア数');
    console.log(`  ${line('-', 74)}`);
    for (const f of cvSorted.slice(0, OPT.top)) {
      console.log(`  ${fmt(f.cv, 2).padStart(5)} | ${f.line} | ${fmt(f.distanceKm, 2)} | ${fmt(f.medianKm, 2)} | ${fmt(f.deviationKm, 2)} | ${f.pairs}`);
    }
    if (cvSorted.length > OPT.top) console.log(`  … 他 ${cvSorted.length - OPT.top} 件`);
  }
  console.log('');

  // --- [3] 左側/右側データ不整合 ---
  console.log(line());
  console.log(`【3】左側/右側（弦）データ不整合 … ${sideSorted.length} 件`);
  console.log('    ※ 前後駅の弦に対して、駅が弦の外側（＝左右の並びが崩れている）にある箇所');
  console.log(line());
  if (!sideSorted.length) {
    console.log('  該当なし');
  } else {
    console.log('  乖離km | 路線名 | 駅順 | 詳細');
    console.log(`  ${line('-', 74)}`);
    for (const f of sideSorted.slice(0, OPT.top)) {
      console.log(`  ${fmt(f.deviationKm, 2).padStart(7)} | ${f.line} | ${f.order} | ${f.detail}`);
    }
    if (sideSorted.length > OPT.top) console.log(`  … 他 ${sideSorted.length - OPT.top} 件`);
  }
  console.log('');

  // --- [3b] 単調性 ---
  console.log(line());
  console.log(`【3b】経度/緯度の単調性違反（進行方向の反転） … ${monoSorted.length} 件`);
  console.log('    ※ 路線軸に沿って見たとき、経度・緯度が単調減少/単調増加していない箇所');
  console.log(line());
  if (!monoSorted.length) {
    console.log('  該当なし');
  } else {
    console.log('  乖離km | 路線名 | 駅A → 駅B | 詳細');
    console.log(`  ${line('-', 74)}`);
    for (const f of monoSorted.slice(0, OPT.top)) {
      console.log(`  ${fmt(f.deviationKm, 2).padStart(7)} | ${f.line} | ${f.order} | ${f.detail}`);
    }
    if (monoSorted.length > OPT.top) console.log(`  … 他 ${monoSorted.length - OPT.top} 件`);
  }
  console.log('');

  // --- [4] 共通路線との駅順照合 ---
  const crossCritical = crossSorted.filter((f) => f.severity !== 'info');
  const crossInfo = crossSorted.filter((f) => f.severity === 'info');
  console.log(line());
  console.log(`【4】共通路線との駅順照合（cross-check） … 矛盾 ${crossCritical.length} 件 / 参考（駅挟み通過） ${crossInfo.length} 件`);
  console.log('    ※ 共通駅を持つ他路線と、共通駅の前後関係が矛盾する組');
  console.log(line());
  if (!crossCritical.length) {
    console.log('  矛盾なし');
  } else {
    console.log('  乖離km | 路線A | 路線B | 共通駅区間 | 詳細');
    console.log(`  ${line('-', 74)}`);
    for (const f of crossCritical.slice(0, OPT.top)) {
      console.log(`  ${fmt(f.deviationKm, 2).padStart(7)} | ${f.line} | ${f.other} | ${f.order} | ${f.detail}`);
    }
    if (crossCritical.length > OPT.top) console.log(`  … 他 ${crossCritical.length - OPT.top} 件`);
  }
  if (crossInfo.length) {
    console.log(`  ※ 参考（同一線路を走りながら駅を挟んで通過する関係）: ${crossInfo.length} 件（矛盾ではない）`);
  }
  console.log('');

  // --- [5] 座標乖離 ---
  console.log(line());
  console.log(`【5】ローカル座標 vs Wikidata 座標の乖離（同名異駅の取り違え） … ${coordSorted.length} 件`);
  console.log(line());
  if (!coordSorted.length) {
    console.log('  該当なし');
  } else {
    console.log('  乖離km | 路線名 | 駅名 | ローカル / Wikidata');
    console.log(`  ${line('-', 74)}`);
    for (const f of coordSorted.slice(0, OPT.top)) {
      console.log(`  ${fmt(f.deviationKm, 2).padStart(7)} | ${f.line} | ${f.stationA} | ${f.order}`);
    }
    if (coordSorted.length > OPT.top) console.log(`  … 他 ${coordSorted.length - OPT.top} 件`);
  }
  console.log('');

  // --- [6] Wikipedia ---
  if (wiki) {
    const missing = wiki.results.filter((r) => r.status === 'missing');
    console.log(line());
    console.log(`【6】Wikipedia(ja) 実在性 … 記事なし ${missing.length} 件 / 判定不能 ${wiki.undetermined} 件（検査対象 ${wiki.results.length} 駅）`);
    console.log(line());
    if (!missing.length) {
      console.log('  記事なしなし');
    } else {
      for (const m of missing.slice(0, OPT.top)) {
        const ls = [];
        for (const [ln, sts] of Object.entries(RAILWAY_LINES)) {
          if (sts.includes(m.name)) ls.push(ln);
        }
        console.log(`  ⚠ ${m.name} [${ls.join('/')}]`);
      }
      if (missing.length > OPT.top) console.log(`  … 他 ${missing.length - OPT.top} 件`);
    }
    console.log('');
  }

  // --- 総合サマリー ---
  const total = gapSorted.length + cvSorted.length + sideSorted.length + monoSorted.length
    + crossCritical.length + coordSorted.length
    + (wiki ? wiki.results.filter((r) => r.status === 'missing').length : 0);
  console.log(line('═'));
  console.log('  総合サマリー');
  console.log(line('═'));
  console.log(`  [1] 隣接駅間乖離        : ${gapSorted.length} 件`);
  console.log(`  [2] 路線連続性低下      : ${cvSorted.length} 件`);
  console.log(`  [3] 左側/右側（弦）不整合: ${sideSorted.length} 件`);
  console.log(`  [3b] 単調性違反          : ${monoSorted.length} 件`);
  console.log(`  [4] 共通路線との駅順矛盾: ${crossCritical.length} 件`);
  console.log(`  [5] 座標乖離            : ${coordSorted.length} 件`);
  if (wiki) console.log(`  [6] Wikipedia 記事なし  : ${wiki.results.filter((r) => r.status === 'missing').length} 件`);
  console.log(`  検出合計               : ${total} 件`);
  console.log('');

  // 重要な検出（乖離km降順で横断的に上位）
  const all = [...gapSorted, ...sideSorted, ...monoSorted, ...crossCritical, ...coordSorted].sort(bySeverity);
  console.log(line());
  console.log(`  ◆ 重要な検出 TOP ${Math.min(OPT.top, all.length)}（乖離 km 降順）`);
  console.log(line());
  for (let i = 0; i < Math.min(OPT.top, all.length); i++) {
    const f = all[i];
    const kind = {
      gap: '乖離', 'out-of-chord': '弦外れ', monotonicity: '単調性違反',
      'cross-order': '駅順矛盾', 'coord-delta': '座標乖離',
    }[f.type] || f.type;
    console.log(`  ${String(i + 1).padStart(2)}. [${kind}] ${fmt(f.deviationKm, 2).padStart(7)}km | ${f.line}${f.other ? ` ⇔ ${f.other}` : ''} | ${f.order}`);
  }
  console.log('');

  process.exit(total > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('実行エラー:', e);
  process.exit(2);
});
