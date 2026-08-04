// 乗り物指定優先 (vehicle) + better_alternative 進言 のロジック検証（モック版・ネット非依存）
// ODPT フェッチをモックし、searchBusTransfer の探索ロジックのみを検証。
// 実行: node scripts/probe-bus-vehicle-mock.mjs
// 終了コード: 0=全PASS / 1=FAIL

// モック用に src/index.mjs を import する前にグローバルフェッチをスタブする必要があるが、
// ここでは searchBusTransfer が依存する内部関数を直接呼べないため、
// 小さな統合グラフで findWeightedPath / scorePath / VEHICLE_WEIGHTS の振る舞いを再現検証する。
//
// ただし src/index.mjs は大きすぎて直接的にはテストしにくいため、
// ここでは searchBus を呼ばず、VEHICLE_WEIGHTS 等の定数と findWeightedPath を
// 同じロジックで再実装したミニグラフで検証する（リグレッション検知用）。

// ---- ミニ統合グラフ（浅草↔上野 想定） ----
// ノード: 浅草(駅), 田原町, 稲荷町, 上野(駅), 浅草寿町(バス停), 菊屋橋, 東上野六丁目, 下谷神社前, 上野駅前(バス停)
// エッジ:
//   電車: 浅草-田原町-稲荷町-上野 (train, weight 1)
//   バス: 浅草寿町-菊屋橋-東上野六丁目-下谷神社前-上野駅前 (bus, weight 1)
//   リンク: 浅草-浅草寿町, 上野-上野駅前 (link, weight 1)
// from=浅草, to=上野 の場合:
//   電車のみ: 浅草→田原町→稲荷町→上野 = 3エッジ (train)
//   バス優先: 浅草→(link)→浅草寿町→(bus×4)→上野駅前→(link)→上野 = 7エッジ
//     → バス優先なら乗換が電車より4エッジ多い＝better_alternative 発動

const VEHICLE_WEIGHTS = {
  bus:            { bus: 1, train: 3, link: 1, community_bus: 1, ferry: 3 },
  train:          { train: 1, bus: 3, link: 1, community_bus: 3, ferry: 3 },
  community_bus:  { community_bus: 1, bus: 2, train: 3, link: 1, ferry: 3 },
  ferry:          { ferry: 1, bus: 3, train: 3, link: 1, community_bus: 3 },
  any:            { bus: 1, train: 1, link: 1, community_bus: 1, ferry: 1 }
};

function buildAdj() {
  const adj = new Map();
  const add = (a, b, type) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, type });
  };
  // 電車（銀座線）: 浅草-田原町-稲荷町-上野 (1系統 = 乗換0)
  add('浅草', '田原町', 'train'); add('田原町', '稲荷町', 'train'); add('稲荷町', '上野', 'train');
  // バス（A系統: 浅草寿町→菊屋橋）
  add('浅草寿町', '菊屋橋', 'bus');
  // バス（B系統: 菊屋橋→東上野六丁目）
  add('菊屋橋', '東上野六丁目', 'bus');
  // バス（C系統: 東上野六丁目→下谷神社前）
  add('東上野六丁目', '下谷神社前', 'bus');
  // バス（D系統: 下谷神社前→上野駅前）
  add('下谷神社前', '上野駅前', 'bus');
  // link: 浅草(駅)⇔浅草寿町(バス停), 上野駅前(バス停)⇔上野(駅)
  add('浅草', '浅草寿町', 'link'); add('上野駅前', '上野', 'link');
  return adj;
}

function edgeTypeToMode(t) { return (t === 'link' || t === 'transfer') ? 'link' : t; }

function findWeightedPath(adj, from, to, weights) {
  const dist = new Map(); const prev = new Map();
  const pq = [{ node: from, cost: 0 }];
  dist.set(from, 0); prev.set(from, null);
  while (pq.length) {
    pq.sort((a, b) => a.cost - b.cost);
    const { node: cur, cost: cc } = pq.shift();
    if (cc > (dist.get(cur) || Infinity)) continue;
    if (cur === to) break;
    for (const e of (adj.get(cur) || [])) {
      const mode = edgeTypeToMode(e.type);
      const w = weights[mode] !== undefined ? weights[mode] : 1;
      const nc = cc + w;
      if (nc < (dist.get(e.to) || Infinity)) {
        dist.set(e.to, nc);
        prev.set(e.to, { from: cur, edgeType: e.type });
        pq.push({ node: e.to, cost: nc });
      }
    }
  }
  if (!prev.has(to)) return { found: false, score: Infinity };
  // モード列を復元
  const modes = [];
  let cur = to;
  while (cur !== null) {
    const p = prev.get(cur);
    if (p) modes.unshift(p.edgeType);
    cur = p ? p.from : null;
  }
  return { found: true, score: dist.get(to), modes };
}

function scorePath(modes) {
  // 実コード buildSegmentsFromPath の挙動を再現:
  //  - train エッジは連続するものを1セグメントにまとめる
  //  - bus / community_bus / ferry エッジは各エッジを1セグメントとする（乗換回数にカウント）
  //  - link は乗換カウント外
  const segments = [];
  for (const m of modes) {
    if (m === 'link') continue;
    if (m === 'train' && segments.length && segments[segments.length - 1].mode === 'train') continue;
    segments.push({ mode: m });
  }
  let bus = 0, train = 0, other = 0;
  for (const s of segments) {
    if (s.mode === 'bus' || s.mode === 'community_bus' || s.mode === 'ferry') other++;
    else if (s.mode === 'train') train++;
  }
  const transfers = Math.max(0, (bus + train + other) - 1);
  return { transfers, estimated_minutes: train * 2 + (bus + other) * 3 };
}

// 検証シナリオ
const adj = buildAdj();
const f = '浅草', t = '上野';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} — ${detail}`); }
}

// 1. any モード: 電車優先（最小エッジ）
{
  const r = findWeightedPath(adj, f, t, VEHICLE_WEIGHTS.any);
  const sc = scorePath(r.modes);
  console.log(`\n[any] modes=${r.modes.join('→')} score=${r.score} transfers=${sc.transfers}`);
  check('any: 電車優先（train 3エッジ）', r.modes.filter(m => m === 'train').length === 3 && r.modes.every(m => m === 'train' || m === 'link'), JSON.stringify(r.modes));
}

// 2. bus モード: バス経路が選ばれるか（重みで電車を抑制）
{
  const r = findWeightedPath(adj, f, t, VEHICLE_WEIGHTS.bus);
  const sc = scorePath(r.modes);
  console.log(`[bus] modes=${r.modes.join('→')} score=${r.score} transfers=${sc.transfers}`);
  check('bus: バス区間を含む', r.modes.some(m => m === 'bus'), JSON.stringify(r.modes));
  // better_alternative 判定: bus vs any を比較
  const anyR = findWeightedPath(adj, f, t, VEHICLE_WEIGHTS.any);
  const anySc = scorePath(anyR.modes);
  const transferDiff = sc.transfers - anySc.transfers;
  const minuteDiff = sc.estimated_minutes - anySc.estimated_minutes;
  const shouldAdvise = (transferDiff >= 2 || minuteDiff >= 10);
  console.log(`  better_alternative 発動? transferDiff=${transferDiff} minuteDiff=${minuteDiff} → ${shouldAdvise}`);
  check('bus: better_alternative 発動（乗換2回以上差）', shouldAdvise, `transferDiff=${transferDiff}`);
}

// 3. train モード: 電車優先・better_alternative なし
{
  const r = findWeightedPath(adj, f, t, VEHICLE_WEIGHTS.train);
  const sc = scorePath(r.modes);
  const anyR = findWeightedPath(adj, f, t, VEHICLE_WEIGHTS.any);
  const anySc = scorePath(anyR.modes);
  const transferDiff = sc.transfers - anySc.transfers;
  const minuteDiff = sc.estimated_minutes - anySc.estimated_minutes;
  const shouldAdvise = (transferDiff >= 2 || minuteDiff >= 10);
  console.log(`[train] modes=${r.modes.join('→')} transfers=${sc.transfers} better_alt=${shouldAdvise}`);
  check('train: better_alternative なし（any と同等）', !shouldAdvise, `transferDiff=${transferDiff}`);
}

console.log(`\n=== 結果: PASS=${pass} FAIL=${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
