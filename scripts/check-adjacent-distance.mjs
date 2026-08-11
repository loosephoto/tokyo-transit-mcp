// 隣接駅間距離チェック: 路線内で隣接する駅ペアの距離が異常に長い（駅欠落の疑い）ものを検出
// 緯度経度（STATION_COORDS）からハーバサイン距離を計算
import * as mod from '../src/index.mjs';

const { STATION_COORDS } = mod;

// STATION_COORDS はエクスポートされているか確認（されていなければダンプから取る）
console.log('STATION_COORDS エクスポート:', typeof STATION_COORDS);

// エクスポートされていない場合のフォールバック: ソースから抽出
import fs from 'fs';
let coords = STATION_COORDS;
if (!coords) {
  const src = fs.readFileSync('src/data/railway-lines.mjs', 'utf8');
  const start = src.indexOf('const STATION_COORDS = {');
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const block = src.slice(start, end);
  const re = /'([^']+)':\s*\{\s*lat:\s*([\d.]+),\s*lon:\s*([\d.]+)\s*\}/g;
  coords = {};
  let m;
  while ((m = re.exec(block)) !== null) coords[m[1]] = { lat: parseFloat(m[2]), lon: parseFloat(m[3]) };
}
console.log('座標数:', Object.keys(coords).length);

function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// 全路線の駅リストをソースから抽出
const src = fs.readFileSync('src/data/railway-lines.mjs', 'utf8');
const startRL = src.indexOf('const RAILWAY_LINES = {');
let depth = 0, end = -1;
for (let i = startRL; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const block = src.slice(startRL, end);
const re = /'([^']+)':\s*\[([^\]]*)\]/g;
const lines = [];
let m;
while ((m = re.exec(block)) !== null) {
  const name = m[1];
  const stations = m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  lines.push({ name, stations });
}

console.log('\n=== 隣接駅間距離が異常に長いペア（駅欠落の疑い） ===');
// 快速路線は停車駅間が長いのが正常なため、その旨をコメントに出す
const rapidLines = new Set(['JR中央線快速', 'JR常磐線快速', 'JR埼京線', 'JR湘南新宿ライン', 'JR高崎線', 'JR宇都宮線', 'JR横須賀線']);
const longPairs = [];
for (const l of lines) {
  const isRapid = rapidLines.has(l.name);
  for (let i = 0; i < l.stations.length - 1; i++) {
    const a = l.stations[i], b = l.stations[i + 1];
    const ca = coords[a], cb = coords[b];
    if (!ca || !cb) continue;
    const dist = haversine(ca, cb);
    // 6km以上は要確認（東京圏の駅間は平均1-3km、郊外の快速でも5km程度まで）
    if (dist > 6) {
      const tag = isRapid ? '（快速のため許容範囲か）' : '⚠️ 各停なのに長距離';
      longPairs.push({ line: l.name, a, b, dist: dist.toFixed(1), tag });
    }
  }
}
longPairs.sort((x, y) => parseFloat(y.dist) - parseFloat(x.dist));
for (const p of longPairs) {
  console.log(`${p.dist}km | ${p.line} | ${p.a} ⇔ ${p.b} ${p.tag}`);
}
console.log(`\n検出数: ${longPairs.length}件`);
