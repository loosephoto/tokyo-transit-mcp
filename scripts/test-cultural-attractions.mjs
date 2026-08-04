// 主要観光スポット・文化施設の多言語ランドマーク変換テスト
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes } = mod;
const cases = [
  ['森美術館', '六本木'], ['Mori Art Museum', '六本木'], ['森美术馆', '六本木'],
  ['国立新美術館', '乃木坂'], ['The National Art Center, Tokyo', '乃木坂'], ['国立新美术馆', '乃木坂'],
  ['チームラボプラネッツ', '新豊洲'], ['teamLab Planets', '新豊洲'], ['teamLab行星', '新豊洲'],
  ['チームラボボーダレス', '神谷町'], ['teamLab Borderless', '神谷町'], ['teamLab无界', '神谷町'],
  ['神田明神', '御茶ノ水'], ['Kanda Myojin', '御茶ノ水'], ['神田神社', '御茶ノ水'],
  ['築地本願寺', '築地'], ['Tsukiji Hongwanji Temple', '築地'], ['筑地本愿寺', '築地'],
  ['歌舞伎座', '東銀座'], ['Kabukiza Theatre', '東銀座'],
  ['東京都庁展望室', '都庁前'], ['Tokyo Metropolitan Government Building', '都庁前'], ['东京都厅展望室', '都庁前'],
  ['サンシャインシティ', '池袋'], ['Sunshine City', '池袋'], ['太阳城', '池袋'],
  ['日本科学未来館', '東京テレポート'], ['Miraikan', '東京テレポート'], ['日本科学未来馆', '東京テレポート'],
  ['東京駅丸の内駅舎', '東京'], ['Tokyo Station Marunouchi Building', '東京'], ['东京站丸之内站房', '東京']
];

for (const [input, expected] of cases) {
  const result = resolveStation(input);
  assert(result.station === expected, `${input} → ${expected}`);
}

const route = computeRoutes('国立新美術館', '神田明神');
assert(!route.error, '国立新美術館→神田明神 経路エラーなし');
assert(route.from === '乃木坂' && route.to === '御茶ノ水', '文化施設同士の駅変換');

assert(computeRoutes('金町', '新宿').error === 'STATION_NOT_FOUND', '金町の誤認防止を維持');
console.log(`検証件数: ${cases.length + 3}`);
console.log('done');
