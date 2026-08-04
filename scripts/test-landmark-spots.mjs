// 追加観光スポット（後楽園・六本木ヒルズ等）の決定的テスト（API不要）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes } = mod;

// 日本語
assert(resolveStation('後楽園').station === '後楽園', 'ja 後楽園 → 後楽園');
assert(resolveStation('東京ドームシティ').station === '後楽園', 'ja 東京ドームシティ → 後楽園');
assert(resolveStation('六本木ヒルズ').station === '六本木', 'ja 六本木ヒルズ → 六本木');
assert(resolveStation('麻布十番').station === '麻布十番', 'ja 麻布十番 → 麻布十番');
assert(resolveStation('表参道').station === '表参道', 'ja 表参道 → 表参道');
assert(resolveStation('増上寺').station === '芝公園', 'ja 増上寺 → 芝公園');
assert(resolveStation('浜離宮').station === '竹芝', 'ja 浜離宮 → 竹芝');
assert(resolveStation('築地').station === '築地', 'ja 築地 → 築地');
assert(resolveStation('豊洲').station === '豊洲', 'ja 豊洲 → 豊洲');
assert(resolveStation('皇居').station === '東京', 'ja 皇居 → 東京');
assert(resolveStation('二重橋').station === '東京', 'ja 二重橋 → 東京');
assert(resolveStation('国会議事堂').station === '永田町', 'ja 国会議事堂 → 永田町');

// 英語
assert(resolveStation('Roppongi Hills').station === '六本木', 'en Roppongi Hills → 六本木');
assert(resolveStation('Tokyo Dome City').station === '後楽園', 'en Tokyo Dome City → 後楽園');
assert(resolveStation('Azabu-juban').station === '麻布十番', 'en Azabu-juban → 麻布十番');
assert(resolveStation('Omotesando').station === '表参道', 'en Omotesando → 表参道');
assert(resolveStation('Zojoji').station === '芝公園', 'en Zojoji → 芝公園');
assert(resolveStation('Tsukiji Market').station === '築地', 'en Tsukiji Market → 築地');
assert(resolveStation('Imperial Palace').station === '東京', 'en Imperial Palace → 東京');
assert(resolveStation('National Diet Building').station === '永田町', 'en National Diet Building → 永田町');

// 中国語
assert(resolveStation('六本木之丘').station === '六本木', 'zh 六本木之丘 → 六本木');
assert(resolveStation('后乐园').station === '後楽園', 'zh 后乐园 → 後楽園');
assert(resolveStation('表参道').station === '表参道', 'zh 表参道 → 表参道');
assert(resolveStation('筑地').station === '築地', 'zh 筑地 → 築地');
assert(resolveStation('皇居').station === '東京', 'zh 皇居 → 東京');
assert(resolveStation('国会议事堂').station === '永田町', 'zh 国会议事堂 → 永田町');

// 経路検索（後楽園 → 六本木ヒルズ）
const route = computeRoutes('後楽園', '六本木ヒルズ');
assert(!route.error, '後楽園→六本木ヒルズ 経路エラーなし');
assert(route.from === '後楽園' && route.to === '六本木', 'from=後楽園, to=六本木 に変換');

// 金町→黄金町 誤認は依然防がれている
assert(computeRoutes('金町', '新宿').error === 'STATION_NOT_FOUND', '金町 は誤認せず STATION_NOT_FOUND');

console.log('done');
