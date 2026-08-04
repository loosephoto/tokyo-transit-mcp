// ランドマーク多言語・別名（訳名・略称）対応の決定的テスト（API不要）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes, searchRoute } = mod;

// 日本語（正式名称・略称・訳名）
assert(resolveStation('東京ディズニーランド').station === '舞浜', 'ja 東京ディズニーランド → 舞浜');
assert(resolveStation('ディズニーランド').station === '舞浜', 'ja ディズニーランド（略称） → 舞浜');
assert(resolveStation('ディズニー').station === '舞浜', 'ja ディズニー（訳名） → 舞浜');
assert(resolveStation('ディズニーシー').station === '舞浜', 'ja ディズニーシー → 舞浜');
assert(resolveStation('東京スカイツリー').station === 'とうきょうスカイツリー', 'ja 東京スカイツリー → とうきょうスカイツリー');
assert(resolveStation('スカイツリー').station === 'とうきょうスカイツリー', 'ja スカイツリー（略称） → とうきょうスカイツリー');
assert(resolveStation('東京タワー').station === '御成門', 'ja 東京タワー → 御成門');
assert(resolveStation('浅草寺').station === '浅草', 'ja 浅草寺 → 浅草');
assert(resolveStation('雷門').station === '浅草', 'ja 雷門 → 浅草');

// 英語
assert(resolveStation('Tokyo Disneyland').station === '舞浜', 'en Tokyo Disneyland → 舞浜');
assert(resolveStation('Disneyland').station === '舞浜', 'en Disneyland → 舞浜');
assert(resolveStation('Disney').station === '舞浜', 'en Disney → 舞浜');
assert(resolveStation('Tokyo Skytree').station === 'とうきょうスカイツリー', 'en Tokyo Skytree → とうきょうスカイツリー');
assert(resolveStation('Skytree').station === 'とうきょうスカイツリー', 'en Skytree → とうきょうスカイツリー');
assert(resolveStation('Tokyo Tower').station === '御成門', 'en Tokyo Tower → 御成門');
assert(resolveStation('Tokyo Dome').station === '水道橋', 'en Tokyo Dome → 水道橋');
assert(resolveStation('Sensoji').station === '浅草', 'en Sensoji → 浅草');
assert(resolveStation('Akihabara').station === '秋葉原', 'en Akihabara → 秋葉原');
assert(resolveStation('Haneda Airport').station === '羽田空港第3ターミナル', 'en Haneda Airport → 羽田空港第3ターミナル');

// 中国語
assert(resolveStation('东京迪士尼乐园').station === '舞浜', 'zh 东京迪士尼乐园 → 舞浜');
assert(resolveStation('迪士尼').station === '舞浜', 'zh 迪士尼 → 舞浜');
assert(resolveStation('东京迪士尼度假区').station === '舞浜', 'zh 东京迪士尼度假区 → 舞浜');
assert(resolveStation('东京晴空塔').station === 'とうきょうスカイツリー', 'zh 东京晴空塔 → とうきょうスカイツリー');
assert(resolveStation('东京塔').station === '御成門', 'zh 东京塔 → 御成門');
assert(resolveStation('东京巨蛋').station === '水道橋', 'zh 东京巨蛋 → 水道橋');
assert(resolveStation('浅草寺').station === '浅草', 'zh 浅草寺 → 浅草');
assert(resolveStation('横滨中华街').station === '元町・中華街', 'zh 横滨中华街 → 元町・中華街');
assert(resolveStation('羽田机场').station === '羽田空港第3ターミナル', 'zh 羽田机场 → 羽田空港第3ターミナル');

// searchRoute の言語別 note 確認（ja/en/zh）
for (const lang of ['ja', 'en', 'zh']) {
  const full = await searchRoute({ from: '東京', to: '東京ディズニーランド', language: lang });
  const textBlocks = full?.content || [];
  const jsonText = textBlocks.map(b => b.text).find(t => t && t.trim().startsWith('{')) || '{}';
  const data = JSON.parse(jsonText);
  const li = data?.landmark_info?.to;
  assert(li && li.landmark === '東京ディズニーランド', `${lang}: landmark_info.to に含まれる`);
  assert(li && li.nearest_station === '舞浜', `${lang}: nearest_station = 舞浜`);
  assert(li && typeof li.note === 'string' && li.note.length > 0, `${lang}: note は非空文字列`);
  console.log(`   ${lang} note: ${li?.note}`);
}

// 金町→黄金町 誤認は依然防がれている
assert(computeRoutes('金町', '新宿').error === 'STATION_NOT_FOUND', '金町 は誤認せず STATION_NOT_FOUND');

console.log('done');
