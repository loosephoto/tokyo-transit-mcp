// v2.25.1 #21-A 回帰テスト: ハードコードバス系統の拡充検証
// 実在の主要系統（京王・東急・小田急・京成・JRバス関東・コミュニティバス）が
// searchBus で 0乗換 で引けることを確認する。
import assert from 'assert';

const { searchBus } = await import('../src/index.mjs');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`);
};

const unwrap = (res) => {
  const texts = (res.content || []).filter(c => c.type === 'text').map(c => c.text);
  return JSON.parse(texts.find(t => t.trim().startsWith('{')) || texts[0]);
};

// 各事業者の実在主要系統（追加分）が 0乗換 で引けること
const cases = [
  // 京王バス: 渋64（中野〜渋谷）、吉04（吉祥寺〜武蔵小金井）系
  ['渋谷駅', '中野駅', '京王バス 渋64'],
  ['吉祥寺駅', '武蔵小金井駅', '京王バス 吉04'],
  ['府中駅', '調布駅', '京王バス'],
  ['新宿駅西口', '荻窪駅', '京王バス 宿31系'],
  // 東急バス: 黒07（目黒〜五反田）、井01（大井町〜五反田）系
  ['目黒駅', '五反田駅', '東急バス 黒07'],
  ['大井町駅', '五反田駅', '東急バス 井01'],
  ['自由が丘駅', '二子玉川駅', '東急バス 自01'],
  ['渋谷駅', '品川駅', '東急バス 渋41'],
  // 小田急バス: 宿31（新宿西口〜荻窪）、吉06（三鷹〜吉祥寺）系
  ['武蔵境駅', '三鷹駅', '小田急バス 吉06'],
  ['成城学園前駅', '二子玉川駅', '小田急バス 成02'],
  ['町田駅', '本厚木駅', '小田急バス'],
  // 京成バス
  ['船橋駅', '西船橋駅', '京成バス'],
  ['松戸駅', '市川駅', '京成バス'],
  ['舞浜駅', '新浦安駅', '京成バス'],
  // JRバス関東
  ['新宿駅', '横浜駅', 'JRバス関東'],
  ['新宿駅', '千葉駅', 'JRバス関東'],
  ['東京駅', '柏駅', 'JRバス関東'],
  // コミュニティバス: 駅→バス停は徒歩乗り継ぎ（transfer）で返るのが正しい
  ['上野駅', '台東区役所（めぐりん）', 'コミュニティバス めぐりん'],
  ['後楽園駅', '後楽園駅前', 'コミュニティバス Bーぐる'],
  ['押上駅', '墨田区役所（すみまるくん）', 'コミュニティバス すみまるくん'],
];

for (const [from, to, label] of cases) {
  try {
    const p = unwrap(await searchBus({ from, to, language: 'ja' }));
    // バス直行 or 徒歩乗り継ぎで到達できること（transfers=0）
    const direct = p.found === true
      || (p.route && p.route[0] && (p.route[0].mode === 'bus' || p.route[0].mode === 'transfer') && p.transfers === 0);
    check(`${from}→${to} (${label})`, direct, `status=${p.status} transfers=${p.transfers} found=${p.found} mode=${p.route?.[0]?.mode}`);
  } catch (e) {
    check(`${from}→${to} (${label})`, false, e.message?.slice(0, 80));
  }
}

const failed = results.filter(r => !r.ok);
console.log(failed.length === 0 ? '\n🎉 ALL PASS' : `\n💥 ${failed.length} FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
