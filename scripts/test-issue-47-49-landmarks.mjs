// v2.29.0 #47/#49 回帰テスト
// #47: 延伸地域の天文台・科学館・公園（14件追加＋成田山新勝寺の最寄り駅修正）
// #49: アニメ・ゲーム系アミューズメントパーク（10施設）
// 全ランドマークが ja/en/zh で解決され、最寄り駅が実在駅であることを確認する。
import * as mod from '../src/index.mjs';

const { resolveStation, searchRoute } = mod;

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const unwrap = (res) => {
  const texts = (res.content || []).filter(c => c.type === 'text').map(c => c.text);
  return JSON.parse(texts.find(t => t.trim().startsWith('{')) || texts[0]);
};

// 施設名 → 期待される最寄り駅（#47）
const LANDMARKS_47 = {
  '国立天文台': '三鷹',
  '千葉市科学館': '県庁前',
  '国立歴史民俗博物館': '佐倉',
  'はまぎんこども宇宙科学館': '平沼橋',
  'さいたま市青少年科学館': '与野本町',
  '川口市立科学館': '川口',
  '相模原市立博物館': '相模原',
  '千葉県立現代産業科学館': '国府台',
  '千葉県立中央博物館': '千葉公園',
  '千葉県立房総のむら': '成田',
  '佐倉城址公園': '佐倉',
  '新横浜公園': '新横浜',
  '羊山公園': '西武秩父',
  '幕張海浜公園': '海浜幕張',
  '成田山新勝寺': '成田' // 最寄り駅修正（成田空港→成田）
};

// 施設名 → 期待される最寄り駅（#49）
const LANDMARKS_49 = {
  'ワーナー ブラザース スタジオツアー東京': '豊島園',
  '東京ジョイポリス': 'お台場海浜公園',
  'ナンジャタウン': '池袋',
  'イマーシブ・フォート東京': '青海',
  'スモールワールズ東京': '有明',
  'レゴランド・ディスカバリー・センター東京': 'お台場海浜公園',
  'ガンダムベース東京': '台場',
  '三鷹の森ジブリ美術館': '三鷹',
  '藤子・F・不二雄ミュージアム': '登戸',
  'マクセル アクアパーク品川': '品川'
};

for (const [name, expected] of Object.entries({ ...LANDMARKS_47, ...LANDMARKS_49 })) {
  const r = resolveStation(name);
  assert(r && r.station === expected, `ja ${name} → ${expected}（実際: ${r?.station}）`);
}

// 英語名でも解決できる（主要施設）
const EN_CASES = {
  'National Astronomical Observatory of Japan': '三鷹',
  'National Museum of Japanese History': '佐倉',
  'Ghibli Museum': '三鷹',
  'Warner Bros. Studio Tour Tokyo': '豊島園',
  'The Gundam Base Tokyo': '台場',
  'Fujiko F. Fujio Museum': '登戸',
  'Maxell Aqua Park Shinagawa': '品川'
};
for (const [name, expected] of Object.entries(EN_CASES)) {
  const r = resolveStation(name);
  assert(r && r.station === expected, `en ${name} → ${expected}（実際: ${r?.station}）`);
}

// 中国語名でも解決できる
const ZH_CASES = {
  '三鹰之森吉卜力美术馆': '三鷹',
  '东京华纳兄弟影城之旅': '豊島園',
  '千叶市科学馆': '県庁前',
  '哆啦A梦博物馆': '登戸'
};
for (const [name, expected] of Object.entries(ZH_CASES)) {
  const r = resolveStation(name);
  assert(r && r.station === expected, `zh ${name} → ${expected}（実際: ${r?.station}）`);
}

// searchRoute の landmark_info で施設名・最寄り駅・note が返る（ja/en/zh）
for (const [name, lang] of [['国立天文台', 'ja'], ['Ghibli Museum', 'en'], ['千叶市科学馆', 'zh']]) {
  const p = unwrap(await searchRoute({ from: name, to: '東京', language: lang }));
  const li = p.landmark_info?.from;
  assert(li && li.landmark === name, `${lang}: landmark_info.from.landmark = ${name}`);
  assert(li && li.nearest_station && typeof li.note === 'string' && li.note.length > 0, `${lang}: nearest_station と note が返る`);
}

console.log('\n#47/#49 回帰テスト完了');
