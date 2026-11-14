/**
 * 駅名の読み（かな）を**人手で確定した表**から補完する。
 *
 * 使い方:
 *   node scripts/fill-station-readings-curated.mjs [--dry]
 *
 * なぜ手で持つか:
 *   残りは「曖昧さ回避ページ」「駅名が記事タイトルと一致しない」「複数駅の共同記事」などで、
 *   fill-station-readings.mjs の自動抽出では取り切れない（実測: 74 → 27 で停止）。
 *   各読みは日本語版 Wikipedia の記事冒頭・曖昧さ回避ページの該当行で確認した（下の source 列）。
 *   自動化できるものは自動化し、**取りこぼしだけを根拠つきで固定する**方針。
 */
import fs from 'node:fs';
import { STATION_READINGS } from '../src/data/station-readings.mjs';

const OUT = 'src/data/station-readings.mjs';
const dryRun = process.argv.includes('--dry');

// [駅名, 読み, source（Wikipedia の記事名 + 確認箇所）]
const CURATED = [
  ['日本橋', 'にほんばし', '日本橋駅 (東京都)'],
  ['平井', 'ひらい', '平井駅 (東京都)'],
  ['阿佐ヶ谷', 'あさがや', '阿佐ケ谷駅'],
  ['市ヶ谷', 'いちがや', '市ケ谷駅'],
  ['麴町', 'こうじまち', '麹町駅'],
  ['大山', 'おおやま', '大山駅 (東京都)'],
  ['霞ヶ関（東武東上線）', 'かすみがせき', '霞ヶ関駅 (埼玉県)'],
  ['佐貫', 'さぬき', '佐貫駅（龍ケ崎市駅の旧名）'],
  ['元町・中華街', 'もとまち・ちゅうかがい', '元町・中華街駅'],
  ['東葉勝田台', 'とうようかつただい', '勝田台駅 の Infobox（東葉勝田台駅 よみがな）'],
  ['中央大学・明星大学', 'ちゅうおうだいがく・めいせいだいがく', '中央大学・明星大学駅'],
  ['大塚・帝京大学', 'おおつか・ていきょうだいがく', '大塚・帝京大学駅'],
  ['町屋駅前', 'まちやえきまえ', '町屋駅 内の記述「町屋駅前停留場（まちやえきまえていりゅうじょう）」'],
  ['栄町', 'さかえちょう', '栄町停留場 (東京都)'],
  ['王子駅前', 'おうじえきまえ', '王子駅 内の記述「王子駅前停留場（おうじえきまえていりゅうじょう）」'],
  ['大塚駅前', 'おおつかえきまえ', '大塚駅前停留場'],
  ['京王永山', 'ながやま', '永山駅 (東京都)'],
  ['小田急永山', 'ながやま', '永山駅 (東京都)'],
  ['京王多摩センター', 'たまセンター', '多摩センター駅'],
  ['小田急多摩センター', 'たまセンター', '多摩センター駅'],
  ['羽田空港第1・第2ターミナル', 'はねだくうこうだいいち・だいにターミナル', '羽田空港第1・第2ターミナル駅'],
  ['雪が谷大塚', 'ゆきがやおおつか', '雪が谷大塚駅'],
  ['逗子・葉山', 'ずし・はやま', '逗子・葉山駅'],
  ['古里', 'こり', '古里駅 (東京都)'],
  ['京成幕張本郷', 'まくはりほんごう', '幕張本郷駅'],
  ['東京ディズニーランド・ステーション', 'とうきょうディズニーランド・ステーション', '東京ディズニーランド・ステーション駅'],
  ['東京ディズニーシー・ステーション', 'とうきょうディズニーシー・ステーション', '東京ディズニーシー・ステーション駅'],
];

const added = {};
for (const [ja, reading, source] of CURATED) {
  if (STATION_READINGS[ja] === reading) continue;
  if (!/^[ぁ-んァ-ヶー・]+$/.test(reading)) {
    console.error(`読みの形式が不正: ${ja} = ${reading}`);
    process.exit(1);
  }
  added[ja] = { reading, source };
}
console.log(`辞書 ${Object.keys(STATION_READINGS).length} 件 / 追加 ${Object.keys(added).length} 件`);
if (Object.keys(added).length) console.log('追加:', Object.entries(added).map(([k, v]) => `${k}=${v.reading}`).join(' | '));
if (dryRun) process.exit(0);

const merged = { ...STATION_READINGS };
for (const [ja, v] of Object.entries(added)) merged[ja] = v.reading;
const keys = Object.keys(merged).sort((a, b) => a.localeCompare(b, 'ja'));
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k])},`).join('\n');
const header = `/**
 * 駅名 → 読み（かな）辞書。
 *
 * ⚠️ 生成物。手で編集しない。
 *   - 欠落分の自動補完: node scripts/fill-station-readings.mjs（--disambig）
 *   - 自動で取れない分の固定: node scripts/fill-station-readings-curated.mjs
 */
export const STATION_READINGS = {
`;
fs.writeFileSync(OUT, `${header}${body}\n};\n`, 'utf8');
console.log(`wrote ${OUT}: ${keys.length} 件（+${Object.keys(added).length}）`);
