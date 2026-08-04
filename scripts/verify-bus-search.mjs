// 修正後の search_bus バス停検索ロジックの検証（ODPT 実データ使用）
// 本スクリプトは src/index.mjs の修正内容(odpt:BusroutePattern フォールバック常時発動 + 類似候補提示) を
// 実データ(probe_odpt.BusroutePattern.json)で再現し、出力を確認する。
import { readFileSync } from 'fs';

const patterns = JSON.parse(readFileSync('./probe_odpt.BusroutePattern.json', 'utf8'));

// --- 修正後 fetchAllBuses の BusroutePattern フォールバック(okCount>0 で常時マージ) を再現 ---
const stopMap = new Map(); // stopName -> { operator }
for (const p of patterns) {
  const op = String(p['odpt:operator'] || '').replace('odpt.Operator:', '');
  for (const s of (p['odpt:busstopPoleOrder'] || [])) {
    const name = s['odpt:note'] || '';
    if (!name) continue;
    if (!stopMap.has(name)) stopMap.set(name, { operator: op });
  }
}
const buses = [...stopMap.entries()].map(([name, meta]) => ({ _searchKeys: [name], _operatorId: meta.operator }));
console.log(`[INFO] 合成バス停数: ${buses.length}`);

// --- バス停検索モード(部分一致) + 0件時の類似候補提案 を再現 ---
function searchBusStop(busstopName) {
  const resolved = busstopName;
  const matched = buses.filter(b => {
    const variants = [resolved].filter((v, i, a) => a.indexOf(v) === i);
    return variants.some(v => b._searchKeys.some(k => k.includes(v)));
  });
  let nearby = undefined;
  if (matched.length === 0) {
    const q = resolved.replace(/(停留所|バス停|駅)$/, '');
    const seen = new Set(); const cands = [];
    for (const b of buses) {
      for (const k of (b._searchKeys || [])) {
        if (!k || seen.has(k)) continue;
        if ((q && k.includes(q)) || (k.length >= 2 && q.length >= 1 && k.includes(q.slice(0, Math.max(1, q.length - 1))))) { seen.add(k); cands.push(k); }
      }
      if (cands.length >= 20) break;
    }
    if (cands.length) nearby = { note: '類似する近隣のバス停', stops: cands.slice(0, 10) };
  }
  return { total: matched.length, matched: matched.slice(0, 10).map(b => b._searchKeys[0]), nearby_suggestions: nearby };
}

const cases = ['浅草', '浅草雷門', '合羽橋', 'かっぱ橋道具街', '雷門'];
for (const c of cases) {
  const r = searchBusStop(c);
  console.log(`\n=== 検索: "${c}" ===`);
  console.log(`  total=${r.total}`);
  if (r.matched.length) console.log(`  一致: ${r.matched.slice(0, 8).join(', ')}`);
  if (r.nearby_suggestions) console.log(`  類似候補: ${r.nearby_suggestions.stops.join(', ')}`);
}
