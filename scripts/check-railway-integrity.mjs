// 全路線の設定ミス一括チェック
// 1. 路線内の駅重複
// 2. 快速/各停ペアの包含関係
// 3. 同一駅が複数路線に所属する際の整合性（STATION_TO_LINES 逆引き）
// 4. 環状線のチェック（先頭=末尾なら正常扱い）
import fs from 'fs';

const src = fs.readFileSync('src/index.mjs', 'utf8');
const start = src.indexOf('const RAILWAY_LINES = {');
let depth = 0, end = -1;
for (let i = start; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const block = src.slice(start, end);
const re = /'([^']+)':\s*\[([^\]]*)\]/g;
const lines = [];
let m;
while ((m = re.exec(block)) !== null) {
  const name = m[1];
  const stations = m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  lines.push({ name, stations });
}

let issues = [];

// 1. 路線内の駅重複（環状線の先頭=末尾は除く）
console.log('=== 1. 路線内の駅重複 ===');
for (const l of lines) {
  const seen = new Set();
  const dups = [];
  for (let i = 0; i < l.stations.length; i++) {
    const s = l.stations[i];
    const isLoopEnd = (i === l.stations.length - 1 && s === l.stations[0]);
    if (seen.has(s) && !isLoopEnd) dups.push(s);
    seen.add(s);
  }
  if (dups.length) {
    console.log(`❌ ${l.name}: 重複 ${[...new Set(dups)].join(', ')}`);
    issues.push(`路線内重複: ${l.name} の ${[...new Set(dups)].join(', ')}`);
  }
}
console.log('（重複なし路線は表示なし）');

// 2. 快速/各停ペアの包含関係
console.log('\n=== 2. 快速/各停ペアの包含関係 ===');
const byName = Object.fromEntries(lines.map(l => [l.name, l.stations]));
const rapidLocalPairs = [
  ['JR中央線快速', 'JR中央総武線各停'],
  ['JR常磐線快速', 'JR常磐線各停'],
];
for (const [rapid, local] of rapidLocalPairs) {
  const rSet = new Set(byName[rapid] || []);
  const lSet = new Set(byName[local] || []);
  // 快速の停車駅が各停の停車駅に含まれるか（経路が異なる部分は除外: 快速の東京・神田など）
  // ここでは「各停路線の途中駅が快速に混入していないか」を重点チェック
  // → 快速駅が「各停駅にはないが、快速の独自駅（例: 東京・神田）として正当なもの」かを判定
  const rapidOnly = [...rSet].filter(s => !lSet.has(s));
  // 中央線快速の東京・神田は正当（各停は三鷹〜千葉なので経路外）。ただし立川以西（武蔵境・国分寺等）も正当。
  console.log(`${rapid} (${rSet.size}駅) のうち ${local} にない駅: ${rapidOnly.join(', ') || 'なし'}`);
  // 各停にあって快速にない（= 快速通過駅・正常）
  const localOnly = [...lSet].filter(s => !rSet.has(s));
  console.log(`  → ${local} のみ（快速通過・正常）: ${localOnly.length}駅`);
}

// 3. 全駅の所属路線数チェック（孤立駅がないか）
console.log('\n=== 3. 駅の所属路線数（1路線のみの駅で問題がないか） ===');
const stationLines = {};
for (const l of lines) {
  for (const s of l.stations) (stationLines[s] ||= new Set()).add(l.name);
}
const singleLine = Object.entries(stationLines).filter(([, v]) => v.size === 1).map(([k]) => k);
console.log(`1路線のみの駅: ${singleLine.length}駅（例: ${singleLine.slice(0, 15).join(', ')}...）`);

// 4. 路線数が少なすぎる/多すぎる路線の候補
console.log('\n=== 4. 駅数が極端な路線（要目視確認） ===');
const extremes = lines.filter(l => l.stations.length <= 2 || l.stations.length >= 40);
for (const l of extremes) console.log(`${l.stations.length}駅 | ${l.name} | ${l.stations.join(',')}`);

console.log('\n=== 5. 公式駅数の目視チェック対象（主要路線） ===');
const known = {
  'JR山手線': 30, 'JR中央線快速': 17, 'JR総武線各停': 22, 'JR中央総武線各停': 39,
  'JR常磐線快速': 12, 'JR常磐線各停': 20, 'JR埼京線': 19, 'JR横須賀線': 14,
  '東京メトロ銀座線': 19, '東京メトロ丸ノ内線': 25, '都営大江戸線': 38, '都営浅草線': 20,
};
for (const [name, expected] of Object.entries(known)) {
  const actual = byName[name] ? byName[name].length : 0;
  const flag = actual === expected ? 'OK' : `⚠️ 期待${expected} vs 実際${actual}`;
  console.log(`${flag} | ${name}: ${actual}駅`);
}
