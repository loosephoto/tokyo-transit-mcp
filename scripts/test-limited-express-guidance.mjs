// 特急・新幹線リクエスト時の窓口案内テスト
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ OK:', msg);
}

const { searchRoute } = mod;

async function parseResult(res) {
  const texts = (res?.content || []).filter(c => c.type === 'text').map(c => c.text);
  const jsonText = texts.find(t => t.trim().startsWith('{')) || texts[0] || '{}';
  try { return JSON.parse(jsonText); } catch (_) { return {}; }
}

console.log('=== 特急・新幹線リクエスト → 窓口案内 ===');
// 新幹線・特急リクエストは LIMITED_EXPRESS_GUIDANCE を返す
const leCases = [
  { from: '東京', to: '新幹線で京都', language: 'ja', station: '東京' },
  { from: '新大阪', to: 'のぞみ 東京', language: 'ja', station: '新大阪' },
  { from: '京都', to: 'ひかり 東京', language: 'ja', station: '京都' },
  { from: '大宮', to: 'はやぶさ 新青森', language: 'ja', station: '大宮' },
  { from: 'Tokyo', to: 'Shinkansen Kyoto', language: 'en', station: '東京' },
  { from: '东京', to: '新干线 京都', language: 'zh', station: '東京' },
];
for (const c of leCases) {
  const data = await parseResult(await searchRoute(c));
  assert(data.mode === 'LIMITED_EXPRESS_GUIDANCE', `[${c.language}] ${c.from}→${c.to} が窓口案内になる`);
  assert(data.guidance?.station === c.station, `[${c.language}] 該当駅が ${c.station} になる（実際: ${data.guidance?.station}）`);
  assert(!!data.how_to_proceed, `[${c.language}] 窓口案内文が含まれる`);
}

console.log('\n=== 通常検索は従来どおり（回帰） ===');
const normalCases = [
  { from: '新橋', to: '汐留', language: 'ja' },
  { from: '新宿', to: '渋谷', language: 'ja' },
  { from: '東京', to: '横浜', language: 'ja' },
  { from: 'Shibuya', to: 'Shinjuku', language: 'en' },
];
for (const c of normalCases) {
  const data = await parseResult(await searchRoute(c));
  assert(data.status === 'SUCCESS' && data.routes?.length > 0, `[${c.language}] ${c.from}→${c.to} が通常の経路検索結果を返す`);
  assert(data.mode !== 'LIMITED_EXPRESS_GUIDANCE', `[${c.language}] ${c.from}→${c.to} が窓口案内に誤検出されない`);
}

console.log('\n=== 私鉄系特急 → 事業者別案内 ===');
const privateCases = [
  { from: '新宿', to: 'ロマンスカー 箱根湯本', language: 'ja', operator: '小田急電鉄' },
  { from: '浅草', to: 'りょうもう 伊勢崎', language: 'ja', operator: '東武鉄道' },
  { from: '京成上野', to: 'スカイライナー 成田空港', language: 'ja', operator: '京成電鉄' },
  { from: '池袋', to: 'レッドアロー 西武秩父', language: 'ja', operator: '西武鉄道' },
  { from: '品川', to: 'ウィング 横浜', language: 'ja', operator: '京浜急行電鉄' },
  { from: '新宿', to: '京王ライナー 高尾山口', language: 'ja', operator: '京王電鉄' },
  { from: '渋谷', to: 'S-TRAIN 横浜', language: 'ja', operator: '東急電鉄' },
  { from: '大宮', to: 'アーバンパークライナー 船橋', language: 'ja', operator: '東武鉄道（野田線）' },
  { from: 'Shinjuku', to: 'Romancecar Hakone', language: 'en', operator: '小田急電鉄' },
  { from: '新宿', to: '罗曼史号 箱根汤本', language: 'zh', operator: '小田急電鉄' },
];
for (const c of privateCases) {
  const data = await parseResult(await searchRoute(c));
  assert(data.mode === 'LIMITED_EXPRESS_GUIDANCE', `[${c.language}] ${c.from}→${c.to} が窓口案内になる`);
  assert(data.private_express_guidance?.operator === c.operator, `[${c.language}] 事業者が ${c.operator} になる（実際: ${data.private_express_guidance?.operator}）`);
  assert(!!data.private_express_guidance?.guidance, `[${c.language}] 事業者案内文が含まれる`);
}

console.log('\n=== 窓口ガイドの全駅が多言語対応 ===');
// LIMITED_EXPRESS_STATION_GUIDE は未エクスポートのため、主要駅のみ検証
for (const st of ['東京', '品川', '新横浜', '大宮', '上野', '高崎', '長野', '新潟', '仙台', '盛岡', '名古屋', '京都', '新大阪']) {
  for (const lang of ['ja', 'en', 'zh']) {
    const data = await parseResult(await searchRoute({ from: st, to: '新幹線で東京', language: lang }));
    assert(data.guidance?.station === st && data.guidance?.window_guidance, `[${lang}] ${st} の窓口案内が表示される`);
  }
}

console.log('\n🎉 特急・新幹線窓口案内テスト完了');
