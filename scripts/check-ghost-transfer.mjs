// 幽霊乗換チェック: 地理的に離れた同名駅が同一ノードに統合されていないか検証する。
//
// 問題（v2.58.0 修正）: 同一駅名の駅が複数路線で使われると、グラフ上で1ノードに統合される。
// 統合されると「赤坂でメトロの赤坂へ乗り換える」等の実在しない乗換（幽霊乗換）が生成される。
//
// 検出の考え方:
//   幽霊乗換は「駅ノードが1つにまとめられていること」が原因。したがって、
//   「同一駅名の駅ノードが複数存在し、それぞれが別々の座標を持つ」状態を
//   正常な状態とみなす。逆走チェックの要否は「分離漏れ」と「同一駅の路線間差」の
//   判別ermarkt で行う。
//
//   判別方法（Wikipedia 座標で実測済み・このリポジトリの基準）:
//     真の同名別駅 → 双方の「隣接駅集合」が共通の駅を持たず、
//                     かつ双方の隣接駅の座標が 8km 以上離れている。
//                     例: 富士急行線赤坂(山梨) ⇔ メトロ赤坂(東京) → 75km
//                         モノレール栄町(千葉) ⇔ 都電栄町(東京)   → 37km
//     同一駅（路線間の停車駅差）→ 双方の隣接駅集合は共通station を持つ
//                     （例: JR東海道線と京浜東北線は品川・川崎・横浜が共通）、
//                     あるいは片方の隣接駅が他方の路線に分岐している。
//                     例: 川崎 → JR南武線（尻手）とJR東海道線（品川/横浜）
//
//   誤検知を避けるため、判定には「共通する隣接駅が1つも無い」ことを必須とし、
//   さらに Wikipedia で確認済みの実在の同名別駅リスト（SEPARATED_STATIONS）を
//   正とする集合として持つ。リストに無いものは警告のみ（exit 1 にしない）。
import { RAILWAY_LINES, STATION_COORDS, AMBIGUOUS_STATION_NAMES } from '../src/data/railway-lines.mjs';
import { STATION_COORDS_EXTRA } from '../src/data/station-coords-extra.mjs';

const FAR_KM = 8;    // 同一駅として扱ってはいけない距離
const NEAR_KM = 3;   // 同一駅として扱ってよい距離

// Wikipedia で座標と所在地を確認済みの実在の同名別駅（2026-10 確認）。
// 「路線A の駅」⇔「路線B の駅」が同一ノードに統合されていると幽霊乗換になる。
const SEPARATED_STATIONS = {
  '赤坂': { other: '赤坂（富士急行線）', where: '東京都港区 ⇔ 山梨県都留市（約75km）' },
  '十日市場': { other: '十日市場（富士急行線）', where: '横浜市 ⇔ 山梨県都留市（約57km）' },
  '栄町': { other: '栄町（千葉モノレール）', where: '東京都北区 ⇔ 千葉市中央区（約37km）' },
};

const coords = {};
for (const [k, v] of Object.entries(STATION_COORDS)) coords[k] = { lat: v.lat, lon: v.lon };
for (const [k, v] of Object.entries(STATION_COORDS_EXTRA)) {
  const [lat, lon] = Array.isArray(v) ? v : [v.lat, v.lon];
  if (!coords[k]) coords[k] = { lat, lon };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const stationLines = {};
for (const [line, stations] of Object.entries(RAILWAY_LINES)) {
  for (const s of stations) (stationLines[s] ||= []).push(line);
}

console.log('=== 幽霊乗換チェック（同名別駅の未分離）===');

const needsFix = [];
const needsReview = [];

for (const [name, lines] of Object.entries(stationLines)) {
  if (lines.length < 2) continue;
  const c = coords[name];
  if (!c) continue;

  const perLine = lines.map(line => {
    const st = RAILWAY_LINES[line];
    const i = st.indexOf(name);
    const neighbors = [st[i - 1], st[i + 1]].filter(Boolean);
    const distances = neighbors.map(n => (coords[n] ? haversineKm(c, coords[n]) : null)).filter(d => d !== null);
    return { line, neighbors, minKm: distances.length ? Math.min(...distances) : null };
  }).filter(p => p.minKm !== null);
  if (perLine.length < 2) continue;

  const far = perLine.filter(p => p.minKm >= FAR_KM);
  const near = perLine.filter(p => p.minKm < NEAR_KM);
  if (!far.length || !near.length) continue;

  // 共通隣接駅があれば連絡駅または路線間の停車駅共有なので、幽霊乗換の根拠にならない
  let hasCommonNeighbor = false;
  for (const f of far) for (const n of near) {
    if (f.neighbors.some(x => n.neighbors.includes(x))) hasCommonNeighbor = true;
  }
  if (hasCommonNeighbor) continue;

  // 乖離側と近接側の「隣接駅同士」の最小距離
  let minCrossKm = Infinity;
  for (const f of far) for (const n of near) {
    for (const fn of f.neighbors) for (const nn of n.neighbors) {
      if (!coords[fn] || !coords[nn]) continue;
      const d = haversineKm(coords[fn], coords[nn]);
      if (d < minCrossKm) minCrossKm = d;
    }
  }
  if (!isFinite(minCrossKm)) continue;

  const entry = {
    name,
    far: far.map(p => `${p.line}（隣接${p.minKm.toFixed(1)}km）`),
    near: near.map(p => `${p.line}（隣接${p.minKm.toFixed(1)}km）`),
    crossKm: minCrossKm,
  };

  const known = SEPARATED_STATIONS[name];
  if (known) {
    // Wikipedia で実在の同名別駅と確認済み。識別子付き駅名が存在し、
    // AMBIGUOUS_STATION_NAMES に登録されていれば正常。
    const separatedExists = !!(stationLines[known.other] || []).length;
    const registered = Object.prototype.hasOwnProperty.call(AMBIGUOUS_STATION_NAMES, name);
    if (separatedExists && registered) {
      ok(`✅ ${name}: 識別子付き「${known.other}」に分離済み（${known.where}）`);
    } else {
      needsFix.push({ ...entry, note: `実在の同名別駅（${known.where}）が未分離` });
    }
    continue;
  }

  // Wikipedia で確認できていないケース。隣接駅同士が 8km 以上離れているなら
  // 実在の同名別駅の疑いがあるため警告する（ただし exit 1 にはしない）。
  if (minCrossKm >= FAR_KM) {
    needsReview.push({ ...entry, note: `隣接駅同士が ${minCrossKm.toFixed(1)}km 離隔 — 同名別駅の疑い。Wikipedia での所在地確認が必要` });
  }
}

for (const f of needsFix) {
  console.log(`❌ ${f.name}: ${f.note}`);
  console.log(`   離隔している路線: ${f.far.join(', ')}`);
  console.log(`   隣接している路線: ${f.near.join(', ')}`);
  console.log(`   隣接駅同士の距離: ${f.crossKm.toFixed(1)}km`);
  console.log(`   → 識別子付き駅名（例: ${f.name}（路線名））に分離し、AMBIGUOUS_STATION_NAMES に登録すること`);
}
for (const f of needsReview) {
  console.log(`⚠️  ${f.name}: ${f.note}`);
  console.log(`   離隔している路線: ${f.far.join(', ')}`);
  console.log(`   隣接している路線: ${f.near.join(', ')}`);
  console.log(`   隣接駅同士の距離: ${f.crossKm.toFixed(1)}km`);
}

console.log(`\n幽霊乗換チェック: 未分離 ${needsFix.length}件 / 要確認 ${needsReview.length}件`);
if (needsFix.length) {
  console.error('幽霊乗換チェック: 未分離の同名別駅あり（要修正）');
  process.exit(1);
}
