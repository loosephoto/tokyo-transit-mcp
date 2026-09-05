// 西武線 駅情報・乗り換えの回帰テスト
// 公式（西武鉄道Webサイト駅番号・Wikipedia駅一覧）との突合で修正した:
// 1. 秩父線: 飯能起点4駅 → 吾野起点6駅（西吾野・横瀬を補完）
// 2. 狭山線: 上山口（1954年廃止駅）→ 下山口
// 3. 有楽町線: 駅順を公式（小竹向原起点）に統一
import * as mod from '../src/index.mjs';

const { computeRoutes, STATION_TO_LINES, resolveStation, AMBIGUOUS_STATION_NAMES } = mod;

let failCount = 0;
function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); failCount++; }
  else console.log('✅ OK:', msg);
}

function lineStations(line) {
  return Object.keys(STATION_TO_LINES)
    .filter(s => STATION_TO_LINES[s].some(e => e.line === line))
    .sort((a, b) => STATION_TO_LINES[a].find(e => e.line === line).index
      - STATION_TO_LINES[b].find(e => e.line === line).index);
}

// 1. 秩父線が公式6駅（吾野起点）
const chichibu = lineStations('西武秩父線');
const expectChichibu = ['吾野','西吾野','正丸','芦ヶ久保','横瀬','西武秩父'];
assert(chichibu.length === 6, `西武秩父線は6駅（現在 ${chichibu.length}駅）`);
for (const [i, st] of expectChichibu.entries()) {
  assert(chichibu[i] === st, `秩父線 ${i + 1}駅目は「${st}」（現在「${chichibu[i]}」）`);
}
// 飯能は秩父線に含まれない（池袋線のみ）
assert(!STATION_TO_LINES['飯能'].some(e => e.line === '西武秩父線'), '飯能は秩父線に含まれない（池袋線のみ）');
assert(STATION_TO_LINES['吾野'].some(e => e.line === '西武秩父線'), '吾野は秩父線の起点');
assert(STATION_TO_LINES['吾野'].some(e => e.line === '西武池袋線'), '吾野は池袋線にも所属（乗換駅）');

// 2. 狭山線が公式3駅（下山口）
const sayama = lineStations('西武狭山線');
assert(sayama.length === 3 && sayama[1] === '下山口', `狭山線は 西所沢→下山口→西武球場前（現在: ${sayama.join('→')}）`);
assert(!STATION_TO_LINES['上山口'], '上山口（廃止駅）は登録されていない');
assert(!resolveStation('上山口').exact, '上山口は駅として解決されない');

// 3. 有楽町線が公式駅順（小竹向原起点）
const yurakucho = lineStations('西武有楽町線');
assert(yurakucho.length === 3 && yurakucho[0] === '小竹向原' && yurakucho[2] === '練馬',
  `有楽町線は 小竹向原→新桜台→練馬（現在: ${yurakucho.join('→')}）`);

// 4. 新駅が解決でき、曖昧ではない
for (const [q, expect] of [['下山口','下山口'],['Shimo-Yamaguchi','下山口'],['西吾野','西吾野'],['Nishi-Agano','西吾野'],['横瀬','横瀬'],['Yokoze','横瀬']]) {
  const r = resolveStation(q);
  assert(r.exact && r.station === expect, `${q} が exact 解決できる（→ ${expect}）`);
  assert(!AMBIGUOUS_STATION_NAMES[expect], `${expect} は曖昧駅ではない`);
}

// 5. 乗り換え経路の検証
const routePairs = [
  ['池袋', '西武秩父'],   // 吾野で池袋線→秩父線
  ['飯能', '西武秩父'],   // 飯能から秩父線へ
  ['西所沢', '西武球場前'], // 狭山線（下山口経由）
  ['練馬', '小竹向原'],   // 有楽町線
  ['西武秩父', '池袋'],   // 逆方向
];
for (const [a, b] of routePairs) {
  const r = computeRoutes(a, b);
  if (r.error) {
    assert(false, `${a} → ${b} が検索可能（${r.error}）`);
  } else {
    const s = r.routes[0].summary;
    assert(s.transfers <= 2 && s.estimated_minutes < 120, `${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分（常識的な範囲）`);
    console.log(`   ${a} → ${b}: ${s.transfers}乗換 ${s.estimated_minutes}分 | ${r.routes[0].path.join('→')}`);
  }
}

// 6. 池袋→西武秩父は吾野経由（正しいルート）
const r = computeRoutes('池袋', '西武秩父');
if (!r.error) {
  const path = r.routes[0].path.join('→');
  assert(path.includes('吾野') && path.includes('西吾野') && path.includes('横瀬'),
    '池袋→西武秩父が 吾野→西吾野→…→横瀬 経由（正しい秩父線ルート）');
}

console.log(failCount === 0 ? '\n🎉 全テスト PASS' : `\n❌ ${failCount} 件 FAIL`);
process.exit(failCount === 0 ? 0 : 1);
