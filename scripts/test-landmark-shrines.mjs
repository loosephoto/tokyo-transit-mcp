// 追加ランドマーク（神社仏閣・観光スポット）の決定的テスト（API不要）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes } = mod;

// 日本語
assert(resolveStation('明治神宮').station === '原宿', 'ja 明治神宮 → 原宿');
assert(resolveStation('めいじじんぐう').station === '原宿', 'ja めいじじんぐう → 原宿');
assert(resolveStation('成田山新勝寺').station === '成田空港', 'ja 成田山新勝寺 → 成田空港');
assert(resolveStation('成田山').station === '成田空港', 'ja 成田山 → 成田空港');
assert(resolveStation('東京大学').station === '本郷三丁目', 'ja 東京大学 → 本郷三丁目');
assert(resolveStation('東大').station === '本郷三丁目', 'ja 東大 → 本郷三丁目');
assert(resolveStation('赤門').station === '本郷三丁目', 'ja 赤門 → 本郷三丁目');
assert(resolveStation('六義園').station === '駒込', 'ja 六義園 → 駒込');
assert(resolveStation('根津神社').station === '後楽園', 'ja 根津神社 → 後楽園');
assert(resolveStation('護国寺').station === '護国寺', 'ja 護国寺 → 護国寺');
assert(resolveStation('谷中霊園').station === '日暮里', 'ja 谷中霊園 → 日暮里');
assert(resolveStation('谷中').station === '日暮里', 'ja 谷中 → 日暮里');
assert(resolveStation('上野恩賜公園').station === '上野', 'ja 上野恩賜公園 → 上野');

// 英語
assert(resolveStation('Meiji Shrine').station === '原宿', 'en Meiji Shrine → 原宿');
assert(resolveStation('Naritasan Shinshoji').station === '成田空港', 'en Naritasan Shinshoji → 成田空港');
assert(resolveStation('University of Tokyo').station === '本郷三丁目', 'en University of Tokyo → 本郷三丁目');
assert(resolveStation('Rikugien').station === '駒込', 'en Rikugien → 駒込');
assert(resolveStation('Nezu Shrine').station === '後楽園', 'en Nezu Shrine → 後楽園');
assert(resolveStation('Gokokuji Temple').station === '護国寺', 'en Gokokuji Temple → 護国寺');
assert(resolveStation('Yanaka').station === '日暮里', 'en Yanaka → 日暮里');

// 中国語
assert(resolveStation('明治神宫').station === '原宿', 'zh 明治神宫 → 原宿');
assert(resolveStation('成田山新胜寺').station === '成田空港', 'zh 成田山新胜寺 → 成田空港');
assert(resolveStation('东京大学').station === '本郷三丁目', 'zh 东京大学 → 本郷三丁目');
assert(resolveStation('六义园').station === '駒込', 'zh 六义园 → 駒込');
assert(resolveStation('根津神社').station === '後楽園', 'zh 根津神社 → 後楽園');
assert(resolveStation('护国寺').station === '護国寺', 'zh 护国寺 → 護国寺');

// searchRoute で実際に経路が引ける（明治神宮 → 成田山）
const route = computeRoutes('明治神宮', '成田山新勝寺');
assert(!route.error, '明治神宮→成田山新勝寺 経路エラーなし');
assert(route.from === '原宿' && route.to === '成田空港', 'from=原宿, to=成田空港 に変換されている');

// 金町→黄金町 誤認は依然防がれている（#14で金町駅がJR常磐線に追加済み: 実在駅として解決され、黄金町に誤認されない）
const knRoute = computeRoutes('金町', '新宿');
assert(!knRoute.error && knRoute.from === '金町', '金町 は実在駅として解決（黄金町に誤認されない）');

console.log('done');
