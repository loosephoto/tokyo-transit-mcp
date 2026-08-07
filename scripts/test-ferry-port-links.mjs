// 東京クルーズ水上バス港の search_route 解決一括チェック
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ OK:', msg);
}

const { resolveStation, computeRoutes } = mod;

// 東京クルーズ（水上バス）の主要港 + 東海汽船ターミナル
// [港名, 期待される解決駅, 期待される種別(駅/ランドマーク)]
const ports = [
  ['浅草', '浅草', '駅'],
  ['お台場海浜公園', 'お台場海浜公園', '駅'],
  ['豊洲', '豊洲', '駅'],
  ['浜離宮', '竹芝', 'ランドマーク'],
  ['日の出桟橋', '浜松町', 'ランドマーク'],
  ['竹芝桟橋', '竹芝', 'ランドマーク'],
  ['東京・竹芝', '竹芝', 'ランドマーク'],
];

console.log('=== 水上バス・フェリー港の駅名解決一括チェック ===');
for (const [port, expectedStation, expectedType] of ports) {
  const r = resolveStation(port);
  console.log(`${port}: station=${r.station}, landmark=${r.landmark || '-'}`);
  assert(r.station === expectedStation, `${port} が ${expectedStation} に解決される（期待: ${expectedType}）`);
}

console.log('\n=== 港間の経路計算チェック ===');
// 都心から各港へ
const fromTokyo = ['東京', '新橋', '汐留', '浜松町'];
for (const from of fromTokyo) {
  for (const [port] of ports) {
    const r = computeRoutes(from, port);
    if (r.error) {
      console.log(`❌ ${from}→${port}: ${r.error}`);
      assert(false, `${from}→${port} の経路計算に失敗しない`);
    } else {
      assert(r.routes && r.routes.length > 0, `${from}→${port} に経路がある`);
    }
  }
}

console.log('\n=== 竹芝駅から各港への多言語解決 ===');
const langs = ['ja', 'en', 'zh'];
const enNames = { '浅草': 'Asakusa', 'お台場海浜公園': 'Odaiba', '豊洲': 'Toyosu', '浜離宮': 'Hamarikyu', '日の出桟橋': 'Hinode Pier', '竹芝桟橋': 'Takeshiba Pier', '東京・竹芝': 'Takeshiba Pier' };
const zhNames = { '浅草': '浅草', 'お台場海浜公園': '台场', '豊洲': '丰洲', '浜離宮': '滨离宫', '日の出桟橋': '日出码头', '竹芝桟橋': '竹芝码头', '東京・竹芝': '东京·竹芝码头' };
for (const [port] of ports) {
  for (const lang of langs) {
    const name = lang === 'ja' ? port : lang === 'en' ? enNames[port] : zhNames[port];
    const r = resolveStation(name);
    if (!r.station) {
      console.log(`❌ [${lang}] ${name} → 解決不能`);
      assert(false, `[${lang}] ${name} が解決される`);
    }
  }
}
console.log('（多言語解決: すべて成功）');

console.log('\n🎉 水上バス・フェリー港の一括チェック完了');
