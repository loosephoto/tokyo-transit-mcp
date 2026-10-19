// 路線幾何（駅順・実在性）の回帰テスト — v2.58.5
// 実行: node tests/line-geometry-regression.test.mjs
//
// 背景: check-line-geometry.mjs の機械検査で実在しない駅名と駅順の誤りが検出された。
//   1. 横浜市営地下鉄グリーンライン: 実在しない「川和中央」「東新田」を含み、
//      センター南/センター北・北山田/東山田の前後関係が Wikipedia と逆だった。
//      → ブルーラインとの共通5駅の前後関係も矛盾（乖離4.87km）。
//   2. 京王高尾線: 「目白台」は正しくは「めじろ台」（Wikipedia 記事が存在しない表記）。
//   3. 東武宇都宮線: 実在しない「栃木」駅が混入し、野州大塚→壬生 の弦が折り返していた。
import { RAILWAY_LINES, STATION_COORDS } from '../src/data/railway-lines.mjs';
import { STATION_COORDS_EXTRA } from '../src/data/station-coords-extra.mjs';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('=== 路線幾何 回帰テスト (v2.58.5) ===');

// ---- 1. 実在しない駅名・表記揺れ ----
console.log('-- 実在しない駅名・表記揺れが除去されていること --');
const ALL = new Set();
for (const stations of Object.values(RAILWAY_LINES)) for (const s of stations) ALL.add(s.replace(/（.*?）/g, ''));
for (const bogus of ['川和中央', '東新田', '目白台']) {
  if (ALL.has(bogus)) fail(`「${bogus}」が路線駅列に残存している`);
  else ok(`「${bogus}」は路線駅列に存在しない`);
}
// 正称が-Par
if (!ALL.has('めじろ台')) fail('「めじろ台」が路線駅列に存在しない');
else ok('「めじろ台」が路線駅列に存在する');

// 「栃木」は東武日光線には実在するが、東武宇都宮線には無い
{
  const utsunomiya = RAILWAY_LINES['東武宇都宮線'];
  if (utsunomiya.includes('栃木')) fail('東武宇都宮線に実在しない「栃木」，本站が残存');
  else ok('東武宇都宮線に「栃木」站は無い（実在する日光線側の「栃木」は保持）');
  if (!RAILWAY_LINES['東武日光線'].includes('栃木')) fail('東武日光線の「栃木」站が失われている');
  else ok('東武日光線の「栃木」站は保持されている');
}

// ---- 2. Wikipedia の正駅順 ----
console.log('-- 路線駅順が Wikipedia の正順であること --');
const SEQ_CASES = [
  ['横浜市営地下鉄グリーンライン',
    ['中山','川和町','都筑ふれあいの丘','センター南','センター北','北山田','東山田','高田','日吉本町','日吉'],
    'G01 中山 → G10 日吉（10駅）'],
  ['京王高尾線',
    ['北野','京王片倉','山田','めじろ台','狭間','高尾','高尾山口'],
    'KO33 北野 → KO53 高尾山口（7駅）'],
  ['東武宇都宮線',
    ['新栃木','野州平川','野州大塚','壬生','国谷','おもちゃのまち','安塚','西川田','江曽島','南宇都宮','東武宇都宮'],
    'TN-12 新栃木 → TN-40 東武宇都宮（11駅）'],
];
for (const [line, expected, note] of SEQ_CASES) {
  const actual = RAILWAY_LINES[line];
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(`${line}: ${note}`);
  else fail(`${line}: 期待 ${expected.join(',')} / 実際 ${actual.join(',')}`);
}

// ---- 3. 座標の単調性（グリーンラインは北→南へ進む）----
console.log('-- 座標の幾何学的整合 --');
function coordOf(name) {
  const c = STATION_COORDS_EXTRA[name];
  if (c) return c;
  return null;
}
// グリーンライン: センター南 → センター北 → 北山田 は北方向へ進む（緯度が増加）
{
  const [sMinami, sKita, kYamada] = ['センター南', 'センター北', '北山田'].map(coordOf);
  if (!sMinami || !sKita || !kYamada) fail('グリーンラインの座標が不足している');
  else if (sMinami[0] < sKita[0] && sKita[0] < kYamada[0]) {
    ok('グリーンライン: センター南 → センター北 → 北山田 が北方向へ単調増加');
  } else {
    fail(`グリーンラインの緯度単調性が崩れている: ${sMinami[0]} / ${sKita[0]} / ${kYamada[0]}`);
  }
}

// 東武宇都宮線: 新栃木 → 野州平川 → 野州大塚 → 壬生 は北東方向へ進む
{
  const pts = ['新栃木', '野州平川', '野州大塚', '壬生'].map(coordOf);
  if (pts.some(p => !p)) fail('東武宇都宮線の座標が不足している');
  else {
    let okAll = true;
    for (let i = 1; i < pts.length; i++) {
      // 連続する駅間で緯度が 1.0km 以上逆行していないこと（概略）
      const dLat = (pts[i][0] - pts[i - 1][0]) * 111;
      if (dLat < -1.0) okAll = false;
    }
    if (okAll) ok('東武宇都宮線: 新栃木 → 壬生 で大幅な逆行なし');
    else fail('東武宇都宮線: 新栃木 → 壬生 で大幅な逆行がある');
  }
}

// ---- 4. ブルーラインとの共通駅の前後関係 ----
console.log('-- ブルーラインとの共通駅の前後関係の一致 --');
{
  const blue = RAILWAY_LINES['横浜市営地下鉄ブルーライン'];
  const green = RAILWAY_LINES['横浜市営地下鉄グリーンライン'];
  const COMMON = ['北新横浜', '新羽', '仲町台', 'センター南', 'センター北'];
  const inBlue = COMMON.filter(s => blue.includes(s));
  const inGreen = COMMON.filter(s => green.includes(s));
  if (inGreen.length === 0) {
    ok('グリーンラインは共通駅を持たない（修正後は該当なし）');
  } else {
    // 共通駅が両路線に存在する場合、順序の前後関係（index の大小の符号）が一致するか
    let consistent = true;
    for (const s of inGreen) {
      const bi = blue.indexOf(s), gi = green.indexOf(s);
      if (bi < 0) continue;
      // 隣接する共通駅との符号比較
      const others = inGreen.filter(o => o !== s && blue.includes(o));
      for (const o of others) {
        const bo = blue.indexOf(o), go = green.indexOf(o);
        if (Math.sign(bi - bo) !== Math.sign(gi - go) && bi !== bo && gi !== go) consistent = false;
      }
    }
    if (consistent) ok('共通駅の前後関係が一致している');
    else fail('共通駅の前後関係が矛盾している');
  }
}

// ---- 5. 大宮駅の座標が Wikipedia infobox 値であること ----
console.log('-- 大宮駅の座標（Wikidata との乖離で検出された誤座標）--');
{
  const wikiLat = 35.906278, wikiLon = 139.623833;  // Wikipedia infobox（埼玉県さいたま市大宮区錦町）
  const c = STATION_COORDS['大宮'];
  if (!c) fail('STATION_COORDS に「大宮」が無い');
  else {
    const dLat = (c.lat - wikiLat) * 111;
    const dLon = (c.lon - wikiLon) * 111 * Math.cos(wikiLat * Math.PI / 180);
    const dKm = Math.sqrt(dLat * dLat + dLon * dLon);
    if (dKm < 0.5) ok(`大宮の座標が Wikipedia 値と一致（乖離 ${dKm.toFixed(2)}km）`);
    else fail(`大宮の座標が Wikipedia 値と ${dKm.toFixed(2)}km 乖離（${c.lat}, ${c.lon}）`);
  }
}

console.log('');
if (failures === 0) {
  console.log('✅ 路線幾何回帰テスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ 路線幾何回帰テスト: ${failures} 件の失敗`);
  process.exit(1);
}