// 台東区めぐりん「南めぐりん」追加により、浅草駅→かっぱ橋道具街（松が谷）が
// クロスモーダル（電車なし・コミュニティバス内）または 浅草駅→田原町→南めぐりん
// で解決できるようになったかを検証。
// 実ODPTフェッチに依存しないよう、searchBusTransfer のグラフ構築ロジックを
// コミュニティバス定数(COMMUNITY_BUS_ROUTES) のみで再現（南めぐりんルートを含む）。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(__dirname, '../src/index.mjs');
const src = readFileSync(srcPath, 'utf8');

// COMMUNITY_BUS_ROUTES 配列リテラルを抽出（台東区めぐりん ブロック）
const start = src.indexOf('const COMMUNITY_BUS_ROUTES = [');
assert.ok(start > 0, 'COMMUNITY_BUS_ROUTES 定義を発見');
// 対応する ]; までを探す（最も外側）
let i = src.indexOf('[', start);
let depth = 0, end = -1;
for (; i < src.length; i++) {
  if (src[i] === '[') depth++;
  else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
}
const literal = src.slice(src.indexOf('[', start), end + 1);
const COMMUNITY_BUS_ROUTES = eval(literal);
const megurin = COMMUNITY_BUS_ROUTES.find(c => c.bus === 'めぐりん' && c.municipality === '台東区');
assert.ok(megurin, '台東区めぐりん が存在');
assert.ok(megurin.routes.some(r => r.name === '南めぐりん'), '南めぐりん ルートが追加されている');
assert.ok(megurin.routes.some(r => r.name === '北めぐりん（浅草回り）'), '北めぐりん（浅草回り）が存在');

// 南めぐりんに「松が谷（かっぱ橋道具街）」が含まれるか
const minami = megurin.routes.find(r => r.name === '南めぐりん');
assert.ok(minami.stops.includes('松が谷（かっぱ橋道具街）'), '南めぐりんが松が谷（かっぱ橋道具街）を経由');
assert.ok(minami.stops.includes('田原町駅前'), '南めぐりんが田原町駅前を経由');
assert.ok(minami.stops.includes('浅草菊水通り'), '南めぐりんが浅草菊水通りを経由');

// 浅草駅（ぐるーりめぐりん/北めぐりん）から、田原町駅前（南めぐりん乗換）経由で松が谷（かっぱ橋）への
// コミュニティバス内乗継グラフを構築し、経路が存在することを確認
const cbGraph = new Map();
for (const cb of COMMUNITY_BUS_ROUTES) {
  for (const route of cb.routes) {
    for (let k = 0; k < route.stops.length - 1; k++) {
      const a = route.stops[k], b = route.stops[k + 1];
      if (!cbGraph.has(a)) cbGraph.set(a, new Set());
      cbGraph.get(a).add(b);
      if (!cbGraph.has(b)) cbGraph.set(b, new Set());
      cbGraph.get(b).add(a);
    }
  }
}
// BFS: 浅草駅前 → 松が谷（かっぱ橋道具街）
function bfs(from, to) {
  const prev = new Map(); const q = [from]; prev.set(from, null);
  while (q.length) {
    const c = q.shift();
    if (c === to) break;
    for (const nb of (cbGraph.get(c) || [])) if (!prev.has(nb)) { prev.set(nb, c); q.push(nb); }
  }
  if (!prev.has(to)) return null;
  const path = []; let cur = to;
  while (cur !== null) { path.unshift(cur); cur = prev.get(cur); }
  return path;
}
const routePath = bfs('浅草駅前', '松が谷（かっぱ橋道具街）');
console.log('浅草駅前→松が谷（かっぱ橋道具街） 経路:', routePath ? routePath.join(' → ') : '(直結経路なし)');
assert.ok(routePath, '浅草駅前から松が谷（かっぱ橋道具街）へコミュニティバス内で到達可能');

// 駅接続 link を通じたクロスモーダル（浅草駅→田原町駅前→南めぐりん）も確認
// stations: 浅草→浅草駅前, 田原町→田原町駅前
const trainAdj = new Set(['浅草駅', '田原町駅', '浅草菊水通り']); // 駅名（link 候補）
// 単純チェック: 田原町駅前 が南めぐりんにあり、浅草駅前 から 田原町駅前 へのエッジがコミュニティグラフにあるか
const via = bfs('浅草駅前', '田原町駅前');
console.log('浅草駅前→田原町駅前 経路:', via ? via.join(' → ') : '(なし)');

console.log('\n✅ 台東区めぐりん「南めぐりん」追加 + 浅草→かっぱ橋道具街 コミュニティバス内到達 検証通過');
