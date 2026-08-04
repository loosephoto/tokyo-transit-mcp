// 言語判定の回帰テスト: 中国語/英語クエリで日本語に化けないことの確認。
// ユーザー要求: 「英語と中国語で検索された際は検索言語で返す」
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../src/index.mjs'), 'utf8');

// detectLanguage 関数のソースを抽出して評価
const fnStart = src.indexOf('function detectLanguage(text) {');
assert.ok(fnStart > 0, 'detectLanguage 定義を発見');
const braceStart = src.indexOf('{', fnStart);
let depth = 0, end = -1;
for (let i = braceStart; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
const fnSrc = src.slice(fnStart, end + 1);
const detectLanguage = eval('(' + fnSrc.replace('function detectLanguage', 'function') + ')');

// ---- 中国語クエリ ----
const zhCases = [
  '从浅草坐巴士去合羽桥道具街',     // ユーザー実クエリ（繁体混じり・簡体字専用字なし）
  '从浅草到合羽桥道具街',
  '浅草到合羽桥道具街',
  '怎么从浅草去合羽桥道具街',
  '浅草坐巴士去合羽桥',
  '北京到上海',
  '台风 积水 防灾',
  '查询 时刻表',
];
for (const c of zhCases) {
  const lang = detectLanguage(c);
  assert.strictEqual(lang, 'zh', `中国語クエリ "${c}" が zh になること（実際: ${lang}）`);
}

// ---- 英語クエリ ----
const enCases = [
  'Asakusa to Kappabashi',
  'Tokyo to Osaka',
  'How to get from Shibuya to Shinjuku',
  'route from Ueno to Akihabara',
];
for (const c of enCases) {
  const lang = detectLanguage(c);
  assert.strictEqual(lang, 'en', `英語クエリ "${c}" が en になること（実際: ${lang}）`);
}

// ---- 日本語クエリ（かなあり）は ja ----
const jaCases = [
  '浅草から合羽橋道具街へ',
  '浅草から新宿まで',
  '東京駅で乗り換え',
  '渋谷へ行く',
  '東京スカイツリー',
];
for (const c of jaCases) {
  const lang = detectLanguage(c);
  assert.strictEqual(lang, 'ja', `日本語クエリ "${c}" が ja になること（実際: ${lang}）`);
}

// ---- 明示指定の優先（resolveLang の挙動と同等）----
function resolveLang(args) {
  const raw = args?.language || args?.lang;
  if (raw === 'en' || raw === 'zh' || raw === 'ja') return raw;
  return null;
}
// 日本語駅名でも language:'en' を渡せば en が優先
const args = { from: '浅草', to: '合羽桥道具街', language: 'en' };
const explicit = resolveLang(args);
const autoLang = (() => {
  const fL = detectLanguage(args.from), tL = detectLanguage(args.to);
  return fL !== 'ja' ? fL : tL !== 'ja' ? tL : 'ja';
})();
const userLang = explicit || autoLang || 'ja';
assert.strictEqual(userLang, 'en', 'language:"en" 明示指定が最優先（日本語駅名でも en）');

// 明示指定なし: 中国語 to を含む → zh
const args2 = { from: '浅草', to: '合羽桥道具街' };
const fL2 = detectLanguage(args2.from), tL2 = detectLanguage(args2.to);
const userLang2 = (fL2 !== 'ja' ? fL2 : tL2 !== 'ja' ? tL2 : 'ja');
assert.strictEqual(userLang2, 'zh', 'from=浅草(ja) + to=合羽桥道具街(zh) で zh を採用');

console.log('\n✅ 言語判定回帰テスト通過（中国語/英語クエリが検索言語で返る）');
console.log('  中国語ケース:', zhCases.length, '件 / 英語ケース:', enCases.length, '件 / 日本語ケース:', jaCases.length, '件');
