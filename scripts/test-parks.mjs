// 主要公園・庭園の多言語ランドマーク変換テスト
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes } = mod;
const cases = [
  ['舎人公園', '舎人公園'], ['Toneri Park', '舎人公園'], ['舍人公园', '舎人公園'],
  // 代々木公園は実在駅（千代田線）としてグラフに存在するため駅解決される。ランドマーク変換は英中表記で検証
  ['代々木公園', '代々木公園'], ['Yoyogi Park', '原宿'], ['代代木公园', '原宿'],
  ['小石川後楽園', '後楽園'], ['Koishikawa Korakuen Gardens', '後楽園'], ['小石川后乐园', '後楽園'],
  ['清澄庭園', '清澄白河'], ['Kiyosumi Gardens', '清澄白河'], ['清澄庭园', '清澄白河'],
  ['水元公園', '松戸'], ['Mizumoto Park', '松戸'], ['水元公园', '松戸'],
  ['国営昭和記念公園', '立川'], ['Showa Kinen Park', '立川'], ['国营昭和纪念公园', '立川'],
  ['砧公園', '用賀'], ['Kinuta Park', '用賀'], ['砧公园', '用賀'],
  ['駒沢オリンピック公園', '駒沢大学'], ['Komazawa Olympic Park', '駒沢大学'], ['驹泽公园', '駒沢大学'],
  ['有栖川宮記念公園', '広尾'], ['Arisugawa-no-miya Memorial Park', '広尾'], ['有栖川宫纪念公园', '広尾'],
  ['檜町公園', '六本木'], ['Hinokicho Park', '六本木'], ['桧町公园', '六本木'],
  ['目黒天空庭園', '池尻大橋'], ['Meguro Sky Garden', '池尻大橋'], ['目黑天空庭园', '池尻大橋'],
  ['若洲海浜公園', '新木場'], ['Wakasu Seaside Park', '新木場'], ['若洲海滨公园', '新木場'],
  ['夢の島公園', '新木場'], ['Yumenoshima Park', '新木場'], ['梦之岛公园', '新木場'],
  ['大井ふ頭中央海浜公園', '大井町'], ['Oi Central Seaside Park', '大井町'], ['大井埠头中央海滨公园', '大井町'],
  ['和田倉噴水公園', '大手町'], ['Wadakura Fountain Park', '大手町'], ['和田仓喷泉公园', '大手町'],
  ['日比谷公園', '日比谷'], ['Hibiya Park', '日比谷'], ['日比谷公园', '日比谷'],
  ['小金井公園', '花小金井'], ['Koganei Park', '花小金井'], ['小金井公园', '花小金井']
];

for (const [input, expected] of cases) {
  const result = resolveStation(input);
  assert(result.station === expected, `${input} → ${expected}`);
}

const route = computeRoutes('舎人公園', '六本木ヒルズ');
assert(!route.error, '舎人公園→六本木ヒルズ 経路エラーなし');
assert(route.from === '舎人公園' && route.to === '六本木', '公園から観光地への駅変換');

// 金町→黄金町 誤認は依然防がれている（#14で金町駅がJR常磐線に追加済み: 実在駅として解決され、黄金町に誤認されない）
const knRoute = computeRoutes('金町', '新宿');
assert(!knRoute.error && knRoute.from === '金町', '金町の誤認防止を維持（実在駅として解決）');
console.log(`検証件数: ${cases.length + 3}`);
console.log('done');
