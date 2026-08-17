// STATION_NAME_MAP をセクションファイルへ分割するワンタイムリファクタスクリプト
// 使い方: node scripts/split-station-names.mjs
// 前提: station-names.mjs の STATION_NAME_MAP が単一オブジェクトリテラル（線6〜878）。
// 分割後、station-names.mjs の STATION_NAME_MAP をスプレッドマージに置き換え、7つのセクションファイルを生成する。
// 検証: 分割後のマージ結果が元のオブジェクトと（キー→値の最終勝ちを保って）完全一致することを確認する。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(__dirname, '..', 'src', 'data', 'station-names.mjs');
const outDir = path.join(__dirname, '..', 'src', 'data');

const src = fs.readFileSync(srcPath, 'utf8');
// オブジェクト本体（線6〜878）を行単位で取得（行は1始まり）
const lines = src.split('\n');
// 行1-indexed → array index
const bodyStart = 6;      // 'export const STATION_NAME_MAP = {'
const bodyEnd = 878;      // '};'
const bodyLines = lines.slice(bodyStart - 1, bodyEnd - 1); // index 5..877 = lines 6..878
// 本文（{} の中身）は lines 7..877 = index 6..876
const innerLines = lines.slice(7 - 1, 877); // index 6..876

// セクション定義: [名前, 開始行(1-indexed), 終了行(1-indexed)]
const sections = [
  ['core', 7, 43, 'STATION_NAME_CORE'],               // 汎用英字ベース・近接異名・関東鉄道・常磐線延伸・コミュニティバス駅接続
  ['zh-old', 44, 129, 'STATION_NAME_ZH_OLD'],          // 中文・旧駅名(#26)・補完駅・京成押上/成田空港線
  ['private-main', 130, 208, 'STATION_NAME_PRIVATE_MAIN'], // 私鉄主要駅・表記揺れ・都営/TX/モノレール/新交通/路面電車
  ['extra-lines', 209, 274, 'STATION_NAME_EXTRA_LINES'],   // 追加路線(#10-#19)・是正
  ['expansion237', 275, 452, 'STATION_NAME_EXPANSION_237'], // v2.25 #20 追加237駅
  ['yokohama-chiba', 453, 853, 'STATION_NAME_YOKOHAMA_CHIBA'], // 横浜・千葉・全路線表記揺れ・東武日光
  ['disney', 854, 877, 'STATION_NAME_DISNEY'],         // ディズニーリゾートライン
];

// 検証用: 元のオブジェクトを評価（元コードの最後勝ちを再現）
// eslint-disable-next-line no-eval
const origObj = (0, eval)(`({\n${innerLines.join('\n')}\n})`);

const merged = {};
const files = [];
for (const [slug, start, end, exportName] of sections) {
  const partInner = lines.slice(start - 1, end); // index start-1 .. end-1
  // 各セクションは export const X = { ... }; に包む
  const fileContent = `/**\n * STATION_NAME_MAP セクション: ${slug}\n * 元: station-names.mjs（並行作業・ドメイン分割のための独立編集ファイル）\n */\nexport const ${exportName} = {\n${partInner.join('\n')}\n};\n`;
  const fname = `station-names-${slug}.mjs`;
  fs.writeFileSync(path.join(outDir, fname), fileContent, 'utf8');
  files.push({ slug, exportName, fname });
  Object.assign(merged, (0, eval)(`({\n${partInner.join('\n')}\n})`));
}

// 検証: 元と分割後マージのキー集合・各値が一致するか
const origKeys = Object.keys(origObj);
const mergedKeys = Object.keys(merged);
const keyMatch = origKeys.length === mergedKeys.length &&
  origKeys.every((k) => Object.prototype.hasOwnProperty.call(merged, k));
let valueMismatch = 0;
for (const k of origKeys) {
  if (merged[k] !== origObj[k]) valueMismatch++;
}

console.log(`元キー数: ${origKeys.length} / 分割後マージキー数: ${mergedKeys.length}`);
console.log(`キー集合一致: ${keyMatch}`);
console.log(`値不一致数: ${valueMismatch}`);
if (!keyMatch || valueMismatch > 0) {
  console.error('❌ 検証失敗: 分割によってデータが変化');
  process.exit(1);
}

// --- station-names.mjs を書き換え: ヘッダー + import + スプレッドマージ + 残り（RAILWAY_NAME_MAP 以降） ---
const header = lines.slice(0, 5).join('\n'); // 線1〜5（ヘッダーコメント + 空行）
const imports = files.map((f) => `import { ${f.exportName} } from './${f.fname}';`).join('\n');
const mergedExport = `export const STATION_NAME_MAP = {\n${files.map((f) => `  ...${f.exportName},`).join('\n')}\n};`;
const rest = lines.slice(878).join('\n'); // 線879以降（RAILWAY_NAME_MAP / STATION_DISPLAY_NAMES 等）
const newSrc = `${header}\n\n${imports}\n\n${mergedExport}\n\n${rest}`;
fs.writeFileSync(srcPath, newSrc, 'utf8');

// --- 再インポート検証: 書き換え後の STATION_NAME_MAP が元と一致するか ---
const { pathToFileURL } = await import('node:url');
const reloaded = await import(pathToFileURL(srcPath).href);
const reloadedKeys = Object.keys(reloaded.STATION_NAME_MAP);
const reloadMatch = reloadedKeys.length === origKeys.length &&
  origKeys.every((k) => reloaded.STATION_NAME_MAP[k] === origObj[k]);
console.log(`再インポート後キー数: ${reloadedKeys.length} / 値一致: ${reloadMatch}`);
if (!reloadMatch) {
  console.error('❌ 書き換え後の station-names.mjs の STATION_NAME_MAP が元と不一致');
  process.exit(1);
}

console.log(`✅ 分割検証 OK（${files.length} ファイル）:`);
for (const f of files) console.log(`   ${f.fname} -> ${f.exportName}`);

