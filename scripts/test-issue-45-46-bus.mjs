// v2.29.0 #45/#46 回帰テスト
// #45: 延伸駅（千葉・埼玉・神奈川）周辺のローカルバス停が searchBus で検索できる
// #46: バス停0件時の類似候補がスコアリングされ、無関係な候補（先頭1文字一致のみ）を出さない
import * as mod from '../src/index.mjs';

const { searchBus } = mod;

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const unwrap = (res) => {
  const texts = (res.content || []).filter(c => c.type === 'text').map(c => c.text);
  return JSON.parse(texts.find(t => t.trim().startsWith('{')) || texts[0]);
};

// ---- #45: 延伸駅のバス停が検索できる（0件でない） ----
const BUS_STOP_CASES = [
  ['佐倉', 'ちばフラワーバス'],
  ['鉄道博物館', 'さいたま市営バス'],
  ['越生', '川越観光自動車'],
  ['江ノ島', '江ノ電バス'],
  ['千城台', '千葉中央バス'],
  ['内宿', '丸建つばさ交通'],
  ['正丸', '西武観光バス']
];

for (const [stop, opLabel] of BUS_STOP_CASES) {
  const p = unwrap(await searchBus({ busstop_name: stop, language: 'ja' }));
  assert(p.total > 0, `#45 ${stop} のバス停が検索できる（total=${p.total}）`);
  const ops = new Set((p.bus_routes || []).map(r => r.operator));
  assert([...ops].some(o => o.includes(opLabel)), `#45 ${stop} に ${opLabel} の系統が含まれる（${[...ops].join(' / ')}）`);
}

// ---- #46: 0件時の類似候補に無関係なバス停を出さない ----
const JUNK_STOPS = ['阿佐ヶ谷', '三越', '早大正門', '堀ノ内', '鶴見駅', '横浜駅'];
const ZERO_CASES = ['佐倉', '越生', '正丸', '内宿'];
for (const stop of ZERO_CASES) {
  const p = unwrap(await searchBus({ busstop_name: stop, language: 'ja' }));
  // #45 でデータ追加済みのため、対象駅は0件ではなく実結果が出る（候補提示自体が不要になる）
  assert(p.total > 0, `#46 ${stop} は #45 データ追加により実バス停がヒット（total=${p.total}）`);
  const sug = (p.nearby_suggestions?.stops || []).join(' / ');
  assert(!JUNK_STOPS.some(j => sug.includes(j)), `#46 ${stop} の類似候補に無関係なバス停が含まれない（${sug || '候補なし'}）`);
}

// 0件ケース（データ範囲外の入力）でも無関係な候補を出さないことを確認
const pNotFound = unwrap(await searchBus({ busstop_name: '新宿ゴールデン街入口', language: 'ja' }));
const sug2 = (pNotFound.nearby_suggestions?.stops || []);
assert(pNotFound.total === 0, '#46 データ範囲外の入力は0件');
if (sug2.length) {
  const bad = sug2.filter(s => !s.includes('新宿') && !s.includes('ゴールデン'));
  assert(bad.length === 0, `#46 0件時候補は入力に関連するもののみ（${sug2.join(' / ')}）`);
}

// 前方一致の良い候補（「浅草」→「浅草雷門」等）が従来どおり出る場合は上位5件以内に制限
const pAsakusa = unwrap(await searchBus({ busstop_name: '合羽橋', language: 'ja' }));
if (pAsakusa.total === 0 && pAsakusa.nearby_suggestions) {
  assert(pAsakusa.nearby_suggestions.stops.length <= 5, `#46 類似候補は上位5件以内（${pAsakusa.nearby_suggestions.stops.length}件）`);
}

console.log('\n#45/#46 回帰テスト完了');
