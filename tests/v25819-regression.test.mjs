// v2.58.19（バス停の残りを Wikipedia の振り仮名＋自前ローマ字化で補完）の回帰テスト
// 実行: node tests/v25819-regression.test.mjs
//
// 背景:
//   読みの推定が要る 203 件は機械翻訳せず日本語のままにしていた（v2.58.18）。
//   Wikipedia の記事冒頭の振り仮名から**読みだけ**を取り、ローマ字化は自前実装
//   （src/lib/kana-romaji.mjs）で行う方式に変えて 73.5% まで到達。
import fs from 'node:fs';
import { kanaToRomaji, titleCase, simplify, selfCheck } from '../src/lib/kana-romaji.mjs';
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- かな→ローマ字の単体変換 --');
{
  eq(kanaToRomaji('しんじゅく'), 'shinjuku', 'しんじゅく → shinjuku');
  eq(kanaToRomaji('とうきょう'), 'toukyou', 'とうきょう → toukyou（長音はそのまま）');
  eq(simplify(kanaToRomaji('とうきょう')), 'tokyo', '長音簡略化で tokyo');
  eq(kanaToRomaji('おおつか'), 'ootsuka', 'おおつか → ootsuka');
  eq(simplify(kanaToRomaji('おおつか')), 'otsuka', '長音簡略化で otsuka');
  eq(kanaToRomaji('みた'), 'mita', 'みた → mita');
  eq(kanaToRomaji('きっさ'), 'kissa', '促音 きっさ → kissa');
  eq(titleCase('shibaura'), 'Shibaura', 'titleCase');
  eq(titleCase('shin yokohama'), 'Shin Yokohama', 'titleCase（複数語）');
}

console.log('-- 駅読み × 駅名英字表記での自己検証 --');
{
  const r = await selfCheck();
  const rate = r.ok / r.total;
  console.log(`  一致 ${r.ok}/${r.total}（${(rate * 100).toFixed(1)}%）`);
  // 残りは「センター→Center」のような意訳（ローマ字化の誤りではない）
  if (rate >= 0.93) ok(`ローマ字化の一致率 ${(rate * 100).toFixed(1)}%（93% 以上）`);
  else fail(`一致率が ${(rate * 100).toFixed(1)}% に低下（93% 未満）`);
}

console.log('-- バス停の en カバレッジ --');
const stops = new Set();
for (const bus of COMMUNITY_BUS_ROUTES) {
  for (const route of bus.routes || []) for (const s of route.stops || []) if (typeof s === 'string') stops.add(s);
  const st = Array.isArray(bus.stations) ? bus.stations : Object.keys(bus.stations || {});
  for (const s of st) if (typeof s === 'string') stops.add(s);
}
const all = [...stops].filter(Boolean);
const withEn = all.filter((s) => BUS_STATION_DISPLAY_NAMES[s]?.en);
{
  const coverage = withEn.length / all.length;
  console.log(`  停留所 ${all.length} / en あり ${withEn.length}（${(coverage * 100).toFixed(1)}%）`);
  if (coverage >= 0.72) ok(`カバレッジ ${(coverage * 100).toFixed(1)}%（72% 以上を維持）`);
  else fail(`カバレッジが ${(coverage * 100).toFixed(1)}% に低下（72% 未満）`);
  const nonAscii = Object.values(BUS_STATION_DISPLAY_NAMES).filter((v) => !/^[\x20-\x7E]+$/.test(v.en || ''));
  eq(nonAscii.length, 0, `en は ASCII のみ（違反 ${nonAscii.length} 件）`);
}

console.log('-- Wikipedia の振り仮名から作った代表例 --');
{
  const expected = {
    '芝浦四丁目': 'Shibaura 4-chome',
    '三ノ輪二丁目': 'Minowa 2-chome',
    '渋谷区役所': 'Shibuya Ward Office',
    '隅田公園': 'Sumida Park',
    '花川戸': 'Hanakawado',
    '台東病院': 'Taito Hospital',
    '浅草警察署前': 'Asakusa Police Station-mae',
    '府中競馬正門前駅': 'Fuchu Keiba Seimon-mae Station',
    '千束小学校前': 'Senzoku Elementary School-mae',
    '神戸': 'Kobe',
  };
  for (const [ja, en] of Object.entries(expected)) eq(BUS_STATION_DISPLAY_NAMES[ja]?.en, en, `${ja} = ${en}`);
}

console.log('-- 生成スクリプト --');
{
  for (const p of ['scripts/fill-bus-en.mjs', 'scripts/fill-bus-en-wiki.mjs', 'src/lib/kana-romaji.mjs']) {
    if (fs.existsSync(p)) ok(`${p} がある`);
    else fail(`${p} が無い`);
  }
  const wiki = fs.readFileSync('scripts/fill-bus-en-wiki.mjs', 'utf8');
  if (wiki.includes('--dry')) ok('--dry（差分確認）がある');
  else fail('--dry が無い');
  const entries = Object.keys(BUS_STATION_DISPLAY_NAMES).length;
  if (entries >= 550) ok(`辞書 ${entries} 件`);
  else fail(`辞書が ${entries} 件しかない（550 件以上を期待）`);
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
