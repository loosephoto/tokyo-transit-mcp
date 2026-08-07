// v2.29.0 #48 回帰テスト
// 延伸駅の到着時文化施設（destination_cultural_facilities）表示と、
// LANDMARK_DEFS からの自動導出（二重管理解消）、
// および「西武秩父」到着検索が特急案内に誤検知されないこと（既存バグ修正）を確認する。
import * as mod from '../src/index.mjs';

const { searchRoute } = mod;

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const unwrap = (res) => {
  const texts = (res.content || []).filter(c => c.type === 'text').map(c => c.text);
  return JSON.parse(texts.find(t => t.trim().startsWith('{')) || texts[0]);
};

// 到着駅 → 期待される施設名（部分一致）
const DEST_CASES = {
  '鉄道博物館（大成）': ['鉄道博物館'],           // LANDMARK_DEFS から自動導出
  '成田': ['成田山新勝寺', '千葉県立房総のむら'],  // 自動導出
  '佐倉': ['国立歴史民俗博物館', '佐倉城址公園'],  // 自動導出
  '西武秩父': ['秩父神社', '羊山公園'],            // 明示＋自動導出
  '江ノ島': ['江ノ島展望灯台', '湘南海岸公園'],    // 明示
  '千葉みなと': ['千葉ポートタワー'],              // 自動導出
  '千葉': ['千葉市科学館'],                        // 明示
  '海浜幕張': ['幕張メッセ', '幕張海浜公園'],      // 自動導出
  '新横浜': ['新横浜公園'],                        // 自動導出
  '越生': ['越生梅林']                             // 明示
};

const FROM_FOR = {
  '鉄道博物館（大成）': '池袋', '成田': '東京', '佐倉': '東京', '西武秩父': '池袋',
  '江ノ島': '鎌倉', '千葉みなと': '東京', '千葉': '東京', '海浜幕張': '東京',
  '新横浜': '東京', '越生': '池袋'
};

for (const [to, expected] of Object.entries(DEST_CASES)) {
  const p = unwrap(await searchRoute({ from: FROM_FOR[to], to, language: 'ja' }));
  const names = (p.destination_cultural_facilities || []).map(f => f.name);
  assert(p.routes && p.routes.length > 0, `#48 ${FROM_FOR[to]}→${to} のルートが算出される`);
  for (const exp of expected) {
    assert(names.some(n => n.includes(exp)), `#48 ${to} 到着時に「${exp}」が表示される（実際: ${names.join(' / ') || 'なし'}）`);
  }
  // 表示が重複していない（自動導出と明示のマージ）
  assert(new Set(names).size === names.length, `#48 ${to} の施設表示に重複がない`);
}

// 自動導出された施設のカテゴリ・徒歩時間が付与されている
const pRail = unwrap(await searchRoute({ from: '池袋', to: '鉄道博物館（大成）', language: 'ja' }));
const railFac = (pRail.destination_cultural_facilities || [])[0];
assert(railFac && railFac.category && railFac.walk_min >= 1, '#48 自動導出施設にカテゴリ・徒歩時間が付く');

// 英語表示でも施設名・カテゴリが英語化される
const pEn = unwrap(await searchRoute({ from: '東京', to: '新横浜', language: 'en' }));
const enFac = (pEn.destination_cultural_facilities || []).map(f => `${f.name} [${f.category}]`);
assert(enFac.some(s => s.includes('Shin-Yokohama Park')), `#48 en: 新横浜に Shin-Yokohama Park が表示（${enFac.join(' / ')}）`);

// 既存バグ修正: 「西武秩父」は特急キーワード「秩父」と誤判定されず、実ルートを返す
const pChichibu = unwrap(await searchRoute({ from: '池袋', to: '西武秩父', language: 'ja' }));
assert(pChichibu.routes && pChichibu.routes.length > 0 && pChichibu.routes[0].segments.length > 0,
  '#48 池袋→西武秩父 が実ルートとして算出される（特急案内への誤検知なし）');
assert(!pChichibu.guidance, '#48 西武秩父 到着時に特急案内が混ざらない');

// 明示的な特急リクエストは従来どおり特急案内を返す
const pLtd = unwrap(await searchRoute({ from: '池袋', to: '西武秩父 特急', language: 'ja' }));
assert(pLtd.guidance || (pLtd.routes === undefined && pLtd.status === 'SUCCESS'),
  '#48 明示的な「特急」リクエストは特急案内を返す');

console.log('\n#48 回帰テスト完了');
