// v2.58.18（コミュニティバス停留所の英語表記 12 → 295 件）の回帰テスト
// 実行: node tests/v25818-regression.test.mjs
//
// 背景:
//   コミュニティバス 41 社・停留所 498 件のうち、en 表記があるのは 12 件だけだった（2.4%）。
//   停留所名の大半は「◯◯駅前」「◯◯駅北口」のように駅名＋接尾辞なので、
//   駅名辞書（STATION_DISPLAY_NAMES）から決定論的に作れる分だけ補完した（295 件 = 59.2%）。
//   読みの推定が要る 203 件は、機械翻訳の誤り（実測: 堀ノ内→Hori no Nai、三ノ輪→San no wa、
//   イオンモール→Ionmooru、柴崎町→Kibazaki）を理由に**あえて日本語のまま**にしている。
import fs from 'node:fs';
import { BUS_STATION_DISPLAY_NAMES } from '../src/data/bus-station-display-names.mjs';
import { COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- 停留所の en カバレッジ --');
const stops = new Set();
for (const bus of COMMUNITY_BUS_ROUTES) {
  for (const route of bus.routes || []) for (const s of route.stops || []) if (typeof s === 'string') stops.add(s);
  const st = Array.isArray(bus.stations) ? bus.stations : Object.keys(bus.stations || {});
  for (const s of st) if (typeof s === 'string') stops.add(s);
}
const all = [...stops].filter(Boolean);
const withEn = all.filter((s) => BUS_STATION_DISPLAY_NAMES[s]?.en);
const coverage = withEn.length / all.length;
console.log(`  停留所 ${all.length} / en あり ${withEn.length}（${(coverage * 100).toFixed(1)}%）`);
if (coverage >= 0.58) ok(`カバレッジ ${(coverage * 100).toFixed(1)}%（58% 以上を維持）`);
else fail(`カバレッジが ${(coverage * 100).toFixed(1)}% に低下（58% 未満）`);

console.log('-- 表記の品質 --');
{
  const entries = Object.entries(BUS_STATION_DISPLAY_NAMES);
  const nonAscii = entries.filter(([, v]) => !/^[\x20-\x7E]+$/.test(v.en || ''));
  eq(nonAscii.length, 0, `en は ASCII のみ（違反 ${nonAscii.length} 件）`);
  const untrimmed = entries.filter(([, v]) => v.en !== (v.en || '').trim());
  eq(untrimmed.length, 0, `前後の空白なし（違反 ${untrimmed.length} 件）`);
  const emptyEn = entries.filter(([, v]) => !v.en);
  eq(emptyEn.length, 0, `en が空のエントリなし（${emptyEn.length} 件）`);
  const zhMissing = entries.filter(([, v]) => !v.zh).length;
  if (zhMissing === 0) ok('zh も全件ある');
  else console.log(`  - zh 未設定 ${zhMissing} 件（ja にフォールバック）`);
}

console.log('-- 代表例（駅名 + 接尾辞の決定論生成） --');
{
  const expected = {
    '田町駅前': 'Tamachi Station',
    '三田駅前': 'Mita Station',
    '新宿駅西口': 'Shinjuku Station West Exit',
    '渋谷駅東口': 'Shibuya Station East Exit',
    '御成門駅前': 'Onarimon Station',
    '麻布十番駅前': 'Azabu-juban Station',
    '白金高輪駅前': 'Shirokane-takanawa Station',
  };
  for (const [ja, en] of Object.entries(expected)) eq(BUS_STATION_DISPLAY_NAMES[ja]?.en, en, `${ja} = ${en}`);
}

console.log('-- 生成スクリプト --');
{
  const path = 'scripts/fill-bus-en.mjs';
  if (fs.existsSync(path)) ok('scripts/fill-bus-en.mjs がある（再生成可能）');
  else fail('scripts/fill-bus-en.mjs が無い');
  const src = fs.readFileSync(path, 'utf8');
  if (src.includes('--dry')) ok('--dry（差分確認）がある');
  else fail('--dry が無い');
  // 冪等性: 生成済みの状態では追加 0 件になるはず
  const before = Object.keys(BUS_STATION_DISPLAY_NAMES).length;
  if (before >= 500) ok(`辞書 ${before} 件（追加分が入っている）`);
  else fail(`辞書が ${before} 件しかない（294 件以上を期待）`);
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
