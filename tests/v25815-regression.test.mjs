// v2.58.15（駅名読みの欠落補完）の回帰テスト
// 実行: node tests/v25815-regression.test.mjs
//
// 背景:
//   監査で STATION_READINGS が 220/1,476（14.9%）欠落していた。
//   build-station-readings.mjs を丸ごと再生成すると、Wikipedia 側のレート制限と
//   曖昧さ回避ページの増加で 1,249 → 1,109 件に**退行**した（実測）。
//   → 欠落分だけを足す fill-station-readings.mjs を追加し、生成側には
//     「既存より少なければ書かない」ガードを入れた。
import fs from 'fs';
import { STATION_READINGS } from '../src/data/station-readings.mjs';
import { RAILWAY_LINES } from '../src/data/railway-lines.mjs';
import { resolveStation } from '../src/handlers/search-route.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- カバレッジ --');
const uniq = [...new Set(Object.values(RAILWAY_LINES).flat())];
const have = Object.keys(STATION_READINGS);
const missing = uniq.filter((s) => !STATION_READINGS[s]);
const coverage = 1 - missing.length / uniq.length;
console.log(`  駅 ${uniq.length} / 読み ${have.length} / 欠落 ${missing.length}（${(coverage * 100).toFixed(1)}%）`);
if (coverage >= 0.94) ok(`カバレッジ ${(coverage * 100).toFixed(1)}%（94% 以上を維持）`);
else fail(`カバレッジが ${(coverage * 100).toFixed(1)}% に低下（94% 未満）`);
if (have.length >= 1400) ok(`読み ${have.length} 件（1,400 件以上）`);
else fail(`読みが ${have.length} 件に減少（1,400 件未満）`);

console.log('-- 読みの形式 --');
{
  const bad = Object.entries(STATION_READINGS).filter(([, v]) => !/^[ぁ-んァ-ヶー]+$/.test(v));
  eq(bad.length, 0, `値はかなのみ（違反 ${bad.length} 件）`);
  const badKey = Object.keys(STATION_READINGS).filter((k) => !uniq.includes(k));
  eq(badKey.length, 0, `RAILWAY_LINES に無い駅のキーが混入していない（${badKey.length} 件）`);
}

console.log('-- 代表的な読みの正しさ --');
{
  const expected = {
    '新宿': 'しんじゅく', '渋谷': 'しぶや', '東京': 'とうきょう', '上野': 'うえの',
    '京王八王子': 'けいおうはちおうじ', '西大島': 'にしおおじま', '横浜': 'よこはま',
    '川崎': 'かわさき', '大宮': 'おおみや', '船橋': 'ふなばし',
    '仙川': 'せんがわ', '千川': 'せんかわ',
  };
  for (const [st, reading] of Object.entries(expected)) {
    eq(STATION_READINGS[st], reading, `${st} = ${reading}`);
  }
}

console.log('-- かな入力の往復（全読みが駅に解決できる） --');
{
  const failuresList = [];
  let checked = 0;
  for (const [st, reading] of Object.entries(STATION_READINGS)) {
    try {
      const res = await resolveStation(reading);
      const name = res?.name || res?.station || res?.resolved?.name;
      if (!res || (!(name === st) && !res.ambiguous && !res.candidates)) failuresList.push(`${st}/${reading}`);
      checked++;
    } catch (e) {
      failuresList.push(`${st}/${reading} (throw)`);
    }
  }
  eq(failuresList.length, 0, `${checked} 件すべてが駅名に解決できる（失敗 ${failuresList.length}）`);
  if (failuresList.length) console.log('  失敗例:', failuresList.slice(0, 8).join(', '));
}

console.log('-- 生成スクリプトのガード --');
{
  const build = fs.readFileSync('scripts/build-station-readings.mjs', 'utf8');
  if (build.includes('--force') && /既存より/.test(build)) ok('build は既存より少ない結果を書かない（--force で上書き）');
  else fail('build-station-readings.mjs に件数ガードが無い');
  if (fs.existsSync('scripts/fill-station-readings.mjs')) ok('fill-station-readings.mjs がある（欠落分の補完）');
  else fail('fill-station-readings.mjs が無い');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
