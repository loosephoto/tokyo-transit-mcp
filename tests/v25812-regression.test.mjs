// v2.58.12 監査修正（バッチ3）の回帰テスト
// 実行: node tests/v25812-regression.test.mjs
//
// 背景:
//   L-2 detectLanguage の zh 語彙・字形に日本語の常用語（時間・最近・問題・銀行・種類・多少・資料・
//       および字形の 号/選/種）が混入し、「新宿 時間」「浅草 種類」が zh 判定されていた
//   G-1 check-railway-integrity に process.exit が無く、不一致でも常に exit 0（恒真のゲート）
//   G-2 check-line-geometry が検出 83 件で恒久 exit=1（ベースライン機構なし）
//   M-1 13 ツールすべてに outputSchema が無く、クライアントが structuredContent を検証できなかった
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { detectLanguage } from '../src/lib/lang.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- 言語判定: 日本語の常用語を中国語シグナルにしない (L-2) --');
{
  const jaCases = ['新宿 時間', '新宿 最近', '池袋 問題', '東京 銀行', '浅草 種類', '大阪 多少', '浅草 資料', '銀座', '時間', '種類'];
  let bad = 0;
  for (const s of jaCases) {
    const got = detectLanguage(s);
    if (got !== 'ja') { bad++; fail(`detectLanguage('${s}') = ${got}（ja 期待）`); }
  }
  if (!bad) ok(`日本語 ${jaCases.length} ケースがすべて ja`);
  const zhCases = ['涩谷', '机场', '从浅草出发', '上海', '車站', '機場', '發現', '電視', '鐵路', '几点的车'];
  let bad2 = 0;
  for (const s of zhCases) {
    const got = detectLanguage(s);
    if (got !== 'zh') { bad2++; fail(`detectLanguage('${s}') = ${got}（zh 期待）`); }
  }
  if (!bad2) ok(`中国語 ${zhCases.length} ケースがすべて zh`);
}

console.log('-- ゲート: exit code が機能しているか (G-1 / G-2) --');
{
  const run = (script, env = {}) => spawnSync(process.execPath, [script], {
    encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env },
  });
  const geo = run('scripts/check-line-geometry.mjs');
  eq(geo.status, 0, 'check-line-geometry はベースライン内なら exit 0');
  if (!/ベースライン/.test(geo.stdout || '')) fail('ベースライン判定のログが出ていない');
  else ok('ベースライン判定で通過したことがログに出る');
  const geoStrict = run('scripts/check-line-geometry.mjs', { GEOMETRY_STRICT: '1' });
  eq(geoStrict.status, 1, 'GEOMETRY_STRICT=1 なら既知の検出でも exit 1（従来動作）');

  const integ = run('scripts/check-railway-integrity.mjs');
  eq(integ.status, 0, 'check-railway-integrity は不整合 0 で exit 0');
  if (/不整合 0 件/.test(integ.stdout || '')) ok('不整合 0 件のサマリーが出る');
  else fail('不整合サマリーが出ていない');

  const baseline = JSON.parse(fs.readFileSync('scripts/geometry-baseline.json', 'utf8'));
  const keys = Object.keys(baseline.counts || {}).sort().join(',');
  eq(keys, 'coord,cross,cv,gap,mono,side,wikiMissing', 'ベースラインはカテゴリ別の件数を持つ');
  eq(typeof baseline.updated_at, 'string', 'ベースラインに更新日がある');
}

console.log('-- CI 定義 --');
{
  const p = '.github/workflows/ci.yml';
  if (!fs.existsSync(p)) fail(`${p} が無い`);
  else {
    const y = fs.readFileSync(p, 'utf8');
    for (const s of ['npm ci', 'npm run build', 'check-railway-integrity', 'check-line-geometry', 'tests/v25810-regression.test.mjs', 'tests/v25812-regression.test.mjs', 'tests/v25814-regression.test.mjs', 'tests/v25815-regression.test.mjs', 'tests/v25816-regression.test.mjs']) {
      if (y.includes(s)) ok(`CI が ${s} を実行する`);
      else fail(`CI に ${s} がない`);
    }
  }
}

console.log('-- outputSchema (M-1) --');
{
  const tools = await requestToolsList();
  eq(tools.length, 13, 'ツール数は 13');
  const missing = tools.filter((t) => !t.outputSchema).map((t) => t.name);
  eq(missing.length, 0, `outputSchema が全ツールにある（欠落 ${missing.join(',') || 'なし'}）`);
  const bad = tools.filter((t) => {
    const req = t.outputSchema?.required || [];
    return !req.includes('status');
  }).map((t) => t.name);
  eq(bad.length, 0, `outputSchema が status を必須にしている（違反 ${bad.join(',') || 'なし'}）`);
  const perm = tools.filter((t) => t.outputSchema?.additionalProperties === true).length;
  eq(perm, 13, 'outputSchema は追加キーを許容する（additionalProperties: true）');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}

function requestToolsList() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/index.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let inited = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('tools/list timeout')); }, 20000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result && !inited) {
          inited = true;
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        } else if (m.id === 2 && m.result) {
          clearTimeout(timer);
          child.kill();
          resolve(m.result.tools || []);
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'v25812', version: '1' } } }) + '\n');
  });
}
