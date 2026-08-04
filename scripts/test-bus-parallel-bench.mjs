// Promise.all 並列化の効果確認: searchBusTransfer 内部の 4 並列フェッチ待ち時間を模倣ベンチマーク
// 直列(旧) vs 並列(新) で所要時間を比較。実ODPTは使わずモックlatencyで比較。

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// モック: ODPT 4 API + 駅geo（各 8000ms タイムアウト上限を想定、通常は 1~3s）
async function mockFetchBusGraph() { await wait(2500); return { patterns: [] }; }
async function mockFetchBusTimetable() { await wait(2200); return { nonStepByPattern: {}, nonStepByStop: {} }; }
async function mockFetchBusStopStationLinks() { await wait(1800); return {}; }
async function mockFetchStationGeo() { await wait(1500); return {}; }

async function serialFetch() {
  const t0 = Date.now();
  const a = await mockFetchBusGraph();
  const b = await mockFetchBusTimetable();
  const c = await mockFetchBusStopStationLinks();
  const d = await mockFetchStationGeo();
  return { ms: Date.now() - t0, a, b, c, d };
}

async function parallelFetch() {
  const t0 = Date.now();
  const [a, b, c, d] = await Promise.all([
    mockFetchBusGraph(), mockFetchBusTimetable(), mockFetchBusStopStationLinks(), mockFetchStationGeo()
  ]);
  return { ms: Date.now() - t0, a, b, c, d };
}

(async () => {
  const s = await serialFetch();
  const p = await parallelFetch();
  console.log(`直列(旧): ${s.ms} ms`);
  console.log(`並列(新): ${p.ms} ms`);
  const saved = s.ms - p.ms;
  console.log(`短縮: ${saved} ms (${(saved / s.ms * 100).toFixed(0)}%)`);
  if (p.ms < s.ms * 0.6) {
    console.log('\n✅ 並列化で所要時間が大幅短縮（タイムアウトリスク低減）');
  } else {
    console.log('\n⚠ 短縮効果が小さい（個別タイムアウトがボトルネックの可能性）');
  }
})();
