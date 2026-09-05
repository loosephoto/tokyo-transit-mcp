// 八高線 高麗川以遠延長（毛呂・越生・寄居）回帰テスト
// 高麗川→寄居間の駅追加（毛呂駅は新規・他は東武越生線/東武東上線の既存駅再利用）の回帰を防ぐ。
import * as mod from '../src/index.mjs';

const { computeRoutes, STATION_TO_LINES, resolveStation, AMBIGUOUS_STATION_NAMES } = mod;

let failCount = 0;
function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); failCount++; }
  else console.log('✅ OK:', msg);
}

// 1. JR八高線が公式16駅（八王子→寄居、index順）
const hkStations = Object.keys(STATION_TO_LINES)
  .filter(s => STATION_TO_LINES[s].some(e => e.line === 'JR八高線'))
  .sort((a, b) => STATION_TO_LINES[a].find(e => e.line === 'JR八高線').index
    - STATION_TO_LINES[b].find(e => e.line === 'JR八高線').index);
const expectHk = ['八王子','北八王子','小宮','拝島','東福生','箱根ケ崎','金子','東飯能','高麗川','毛呂','越生','東毛呂','武州唐沢','川角','西大家','寄居'];
assert(hkStations.length === 16, `JR八高線は16駅（現在 ${hkStations.length}駅）`);
for (const [i, st] of expectHk.entries()) {
  assert(hkStations[i] === st, `八高線 ${i + 1}駅目は「${st}」（現在「${hkStations[i]}」）`);
}

// 2. 毛呂駅が新規登録され、曖昧ではなく解決できる
assert(!!STATION_TO_LINES['毛呂'], '毛呂が STATION_TO_LINES に登録されている');
assert(!AMBIGUOUS_STATION_NAMES['毛呂'], '毛呂は曖昧駅ではない');
assert(resolveStation('毛呂').exact, '毛呂が exact 解決できる（日本語）');
assert(resolveStation('Moro').exact, '毛呂が exact 解決できる（ローマ字 Moro）');

// 3. 接続駅の所属（既存駅の路線追加が正しい）
const ogoseLines = STATION_TO_LINES['越生'].map(e => e.line);
assert(ogoseLines.includes('JR八高線') && ogoseLines.includes('東武越生線'), '越生は八高線・東武越生線の両方に所属');
const yoriiLines = STATION_TO_LINES['寄居'].map(e => e.line);
assert(yoriiLines.includes('JR八高線') && yoriiLines.includes('東武東上線'), '寄居は八高線・東武東上線の両方に所属');

// 4. 八高線の経路が検索可能（全区間・接続先）
const routePairs = [
  ['高麗川', '寄居'],   // 延長区間
  ['八王子', '寄居'],   // 八高線全区間
  ['寄居', '八王子'],   // 逆方向
  ['越生', '池袋'],     // 東武越生線との接続
  ['寄居', '川越'],     // 東武東上線経由で川越へ
];
for (const [a, b] of routePairs) {
  const r = computeRoutes(a, b);
  if (r.error) {
    assert(false, `${a} → ${b} が検索可能（${r.error}）`);
  } else {
    const s = r.routes[0].summary;
    assert(s.transfers <= 3 && s.estimated_minutes < 120, `${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分（常識的な範囲）`);
    console.log(`   ${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分 | ${r.routes[0].path.join('→')}`);
  }
}

// 5. 既存の西武エリア回帰（多摩湖線・拝島線が壊れていない）
const r = computeRoutes('国分寺', '多摩湖');
assert(!r.error && r.routes[0].summary.transfers === 0, '国分寺 → 多摩湖: 0乗換（西武多摩湖線の回帰なし）');

console.log(failCount === 0 ? '\n🎉 全テスト PASS' : `\n❌ ${failCount} 件 FAIL`);
process.exit(failCount === 0 ? 0 : 1);
