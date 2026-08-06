// 運賃検索の追加対応事業者テスト（横浜市営地下鉄・多摩モノレール）
import fs from 'fs';

const loadEnv = () => {
  const env = fs.readFileSync('.env', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
};
loadEnv();

const { searchFare } = await import('../src/index.mjs');

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log('✅', msg); }
  else { fail++; console.error('❌ FAIL:', msg); }
};

const parse = async (res) => {
  const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text)
    .find(t => t.trim().startsWith('{'));
  return JSON.parse(text);
};

// 1. 横浜市営地下鉄（ブルーライン）: 横浜 → 新横浜
const yokohama = await parse(await searchFare({ from: '横浜', to: '新横浜', language: 'ja' }));
console.log('横浜→新横浜 fares:', JSON.stringify(yokohama.fares));
assert(yokohama.fares?.length > 0, '横浜→新横浜 で運賃が見つかる');
assert(yokohama.fares?.some(f => f.operator === 'YokohamaMunicipal'), 'operator が YokohamaMunicipal を含む');

// 2. 多摩モノレール: 多摩センター → 立川北
const tama = await parse(await searchFare({ from: '多摩センター', to: '立川北', language: 'ja' }));
console.log('多摩センター→立川北 fares:', JSON.stringify(tama.fares));
assert(tama.fares?.length > 0, '多摩センター→立川北 で運賃が見つかる');
assert(tama.fares?.some(f => f.operator === 'TamaMonorail'), 'operator が TamaMonorail を含む');

// 3. 従来の東京メトロも引き続き動作
const metro = await parse(await searchFare({ from: '渋谷', to: '新宿', language: 'ja' }));
assert(metro.fares?.some(f => f.operator === 'TokyoMetro'), '渋谷→新宿 で TokyoMetro 運賃が引き続き見つかる');

// 4. fallback_url の表示タイミング: 料金取得成功時はリンクなし
assert(!('fallback_url' in metro), '料金取得できた場合は fallback_url を表示しない（渋谷→新宿）');
assert(!('fallback_url' in yokohama), '料金取得できた場合は fallback_url を表示しない（横浜→新横浜）');

// 5. fallback_url の表示タイミング: 料金計算不可（ODPT に対象データなし）ならリンクあり
const notFound = await parse(await searchFare({ from: '浅草', to: '八丈島', language: 'ja' }));
console.log('浅草→八丈島 message:', notFound.message);
assert(notFound.fares === undefined || notFound.fares?.length === 0, '浅草→八丈島 は運賃なし');
assert(typeof notFound.fallback_url === 'string' && notFound.fallback_url.includes('transit.yahoo.co.jp'), '料金計算不可の場合は fallback_url（Yahoo!路線情報）を表示する');

// 6. fare_coverage に対応・対象外事業者が明記される
assert(Array.isArray(notFound.fare_coverage?.supported) && notFound.fare_coverage.supported.includes('YokohamaMunicipal') && notFound.fare_coverage.supported.includes('TamaMonorail'), 'fare_coverage.supported に対応事業者（横浜市営・多摩モノレール）が明記される');
assert(Array.isArray(notFound.fare_coverage?.unsupported) && notFound.fare_coverage.unsupported.includes('JR-East') && notFound.fare_coverage.unsupported.includes('JR-Central') && notFound.fare_coverage.unsupported.includes('TokyoMonorail'), 'fare_coverage.unsupported に対象外（JR-East / JR-Central / 東京モノレール）が明記される');

console.log(`\n=== 結果: PASS=${pass} FAIL=${fail} ===`);
process.exit(fail ? 1 : 0);
