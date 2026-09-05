// 秩父鉄道秩父本線（羽生〜三峰口・CR01〜CR37）回帰テスト
// 2026-09 追加: 西武秩父線の西武秩父駅⇔御花畑駅（徒歩連絡）で西武線と接続。
import * as mod from '../src/index.mjs';

const { computeRoutes, STATION_TO_LINES, resolveStation, AMBIGUOUS_STATION_NAMES } = mod;

let failCount = 0;
function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); failCount++; }
  else console.log('✅ OK:', msg);
}

const LINE = '秩父鉄道秩父本線';

function lineStations() {
  return Object.keys(STATION_TO_LINES)
    .filter(s => STATION_TO_LINES[s].some(e => e.line === LINE))
    .sort((a, b) => STATION_TO_LINES[a].find(e => e.line === LINE).index
      - STATION_TO_LINES[b].find(e => e.line === LINE).index);
}

// 1. 秩父鉄道秩父本線が公式37駅（CR01〜CR37・Wikipedia駅一覧と突合）
const expect = ['羽生','西羽生','新郷','武州荒木','東行田','行田市','持田','ソシオ流通センター','熊谷','上熊谷','石原','ひろせ野鳥の森','大麻生','明戸','武川','永田','ふかや花園','小前田','桜沢','寄居','波久礼','樋口','野上','長瀞','上長瀞','親鼻','皆野','和銅黒谷','大野原','秩父','御花畑','影森','浦山口','武州中川','武州日野','白久','三峰口'];
const sts = lineStations();
assert(sts.length === 37, `秩父鉄道秩父本線は37駅（現在 ${sts.length}駅）`);
for (const [i, st] of expect.entries()) {
  assert(sts[i] === st, `秩父本線 ${i + 1}駅目は「${st}」（現在「${sts[i]}」）`);
}

// 2. 新駅が解決でき、曖昧ではない（日本語・ローマ字）
for (const [q, expectSt] of [
  ['三峰口','三峰口'],['Mitsumineguchi','三峰口'],['長瀞','長瀞'],['Nagatoro','長瀞'],
  ['秩父','秩父'],['Chichibu','秩父'],['御花畑','御花畑'],['Ohanabatake','御花畑'],
  ['西羽生','西羽生'],['Nishi-Hanyu','西羽生'],['ひろせ野鳥の森','ひろせ野鳥の森'],['Hirose','ひろせ野鳥の森'],
]) {
  const r = resolveStation(q);
  assert(r.exact && r.station === expectSt, `${q} が exact 解決できる（→ ${expectSt}）`);
  assert(!AMBIGUOUS_STATION_NAMES[expectSt], `${expectSt} は曖昧駅ではない`);
}

// 3. 乗換駅（既存グラフとの接続）
assert(STATION_TO_LINES['羽生'].some(e => e.line === '東武伊勢崎線'), '羽生は東武伊勢崎線と接続');
assert(STATION_TO_LINES['熊谷'].some(e => e.line === 'JR高崎線'), '熊谷はJR高崎線と接続');
assert(STATION_TO_LINES['寄居'].some(e => e.line === '東武東上線'), '寄居は東武東上線と接続');
assert(STATION_TO_LINES['寄居'].some(e => e.line === 'JR八高線'), '寄居はJR八高線と接続');

// 4. 西武秩父⇔御花畑の徒歩連絡（西武秩父線との接続）
const r1 = computeRoutes('西武秩父', '三峰口');
assert(!r1.error && r1.routes[0].summary.transfers === 1,
  '西武秩父 → 三峰口: 1乗換（御花畑で秩父鉄道へ）');
if (!r1.error) {
  const path = r1.routes[0].path.join('→');
  assert(path.includes('御花畑'), '西武秩父→三峰口が御花畑経由');
}

// 5. 経路検証
const routePairs = [
  ['羽生', '三峰口'],   // 秩父本線全区間（0乗換）
  ['寄居', '長瀞'],     // 秩父本線内
  ['池袋', '三峰口'],   // 東武/高崎線経由
  ['東京', '三峰口'],   // JR高崎線→熊谷乗換
  ['三峰口', '西武秩父'], // 逆方向
];
for (const [a, b] of routePairs) {
  const r = computeRoutes(a, b);
  if (r.error) {
    assert(false, `${a} → ${b} が検索可能（${r.error}）`);
  } else {
    const s = r.routes[0].summary;
    assert(s.transfers <= 2 && s.estimated_minutes < 150, `${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分（常識的な範囲）`);
    console.log(`   ${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分 | ${r.routes[0].path.join('→')}`);
  }
}

// 6. 全駅接続性スイープ（孤立駅クラスタ検出）
const isolates = Object.keys(STATION_TO_LINES).filter(st =>
  st !== '東京' && computeRoutes(st, '東京').error === 'NO_ROUTE');
assert(isolates.length === 0, `孤立駅なし（${isolates.length}駅）`);
if (isolates.length) console.log('  孤立駅:', isolates.join(', '));

console.log(failCount === 0 ? '\n🎉 全テスト PASS' : `\n❌ ${failCount} 件 FAIL`);
process.exit(failCount === 0 ? 0 : 1);
