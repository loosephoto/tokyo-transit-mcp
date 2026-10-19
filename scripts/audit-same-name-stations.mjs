// 同名別駅（地理的に離れている同名駅）の権威照合スクリプト
//
// 目的:
//   1) 同一駅名の別位置にある駅（同名別駅）が、グラフ上で1ノードに統合されていないか検証する
//      （統合されると「赤坂でメトロの赤坂へ乗り換える」等の実在しない乗換＝幽霊乗換が生まれる）
//   2) 路線駅列に駅が欠落していないか検証する
//      （欠落すると隣接駅間距離 grossly に大きく表示され、同一駅の座標矛盾と誤検出される）
//
// 出典:
//   すべて 日本語 Wikipedia の駅記事の infobox（所在地・座標・駅番号）と路線記事で確認済み（2026-10）。
//   座標は infobox の「座標」行の値（度単位、小数点以下7桁）をそのまま保持する。
//
// 使い方:
//   node scripts/audit-same-name-stations.mjs
//   ※ ネットワーク不要（Wikipedia 済みの値を内蔵したオフライン照合）
import { RAILWAY_LINES, STATION_COORDS, AMBIGUOUS_STATION_NAMES, AMBIGUOUS_STATION_LINES } from '../src/data/railway-lines.mjs';
import { STATION_COORDS_EXTRA } from '../src/data/station-coords-extra.mjs';

// ---------- 座標の統合 ----------
const coords = {};
for (const [k, v] of Object.entries(STATION_COORDS)) coords[k] = { lat: v.lat, lon: v.lon, src: 'CORE' };
for (const [k, v] of Object.entries(STATION_COORDS_EXTRA)) {
  const [lat, lon] = Array.isArray(v) ? v : [v.lat, v.lon];
  if (!coords[k]) coords[k] = { lat, lon, src: 'EXTRA' };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- 1) 実在の同名別駅（Wikipedia で所在地と座標を確認済み） ----------
// 「同一ノードに統合されると幽霊乗換になる」ペア。
// farSide: 別位置側Manipulator のローカル駅名。nearSide: 関東圏側のローカル駅名。
const SAME_NAME_STATIONS = [
  {
    near: '赤坂', far: '赤坂（富士急行線）',
    nearInfo: { line: '東京メトロ千代田線', place: '東京都港区赤坂五丁目', num: 'C06', lat: 35.672361, lon: 139.736528, url: 'https://ja.wikipedia.org/wiki/赤坂駅_(東京都)' },
    farInfo: { line: '富士急行線', place: '山梨県都留市四日市場87-2', num: 'FJ05', lat: 35.5661611, lon: 138.9162167, url: 'https://ja.wikipedia.org/wiki/赤坂駅_(山梨県)' },
  },
  {
    near: '十日市場', far: '十日市場（富士急行線）',
    nearInfo: { line: 'JR横浜線', place: '神奈川県横浜市緑区', num: '—', lat: 35.5263056, lon: 139.5165915, url: 'https://ja.wikipedia.org/wiki/十日市場駅_(神奈川県)' },
    farInfo: { line: '富士急行線', place: '山梨県都留市十日市場769-3', num: 'FJ09', lat: 35.5389278, lon: 138.8875028, url: 'https://ja.wikipedia.org/wiki/十日市場駅_(山梨県)' },
  },
  {
    near: '栄町', far: '栄町（千葉モノレール）',
    nearInfo: { line: '都電荒川線', place: '東京都北区王子', num: '—', lat: 35.750865, lon: 139.742186, url: 'https://ja.wikipedia.org/wiki/栄町駅' },
    farInfo: { line: '千葉都市モノレール1号線', place: '千葉県千葉市中央区栄町29-9', num: 'CM16', lat: 35.613, lon: 140.11861, url: 'https://ja.wikipedia.org/wiki/栄町駅_(千葉県)' },
  },
];

// ---------- 2) 「同名別駅ではない」と Wikipedia で確定した誤検出パターン ----------
// check-ghost-transfer.mjs が要確認として挙げるが、実際には同一駅であるケース。
// 原因は路線駅列の欠落（隣接駅 leaps して距離が大きくなる）か、路線名の誤り。
const FALSE_POSITIVES = [
  {
    name: '大崎',
    why: '路線名の誤り（v2.58.2 で修正済み）。「大崎支線」は東海道貨物支線（品鶴線）品川〜西大井 間の旧蛇窪信号場⇔山手線大崎駅を結ぶ約2kmの連絡線で、全区間が大崎駅構内。Wikipedia によれば「正式な路線とはみなされていない」。西浦和は武蔵野線「大宮支線／西浦和支線」の駅であり大崎支線とは無関係。旧定義のままだと大崎⇔西浦和（実距離26.6km）が隣接1区間としてグラフに張られ、実在しない経路「大崎 → 西浦和」（1区間）が返されていた。実在する「JR武蔵野線大宮支線」（西浦和・与野）に置換済み。',
    url: 'https://ja.wikipedia.org/wiki/大崎支線',
  },
  {
    name: '川崎',
    why: '同一駅（35.531389, 139.696944）。JR東海道線の駅列に「鶴見・新子安・東神奈川」が欠落しており、隣接駅が飛ばされ距離が大きく出ていたため誤検出。v2.58.2 で欠落3駅を補完済み。',
    url: 'https://ja.wikipedia.org/wiki/川崎駅',
  },
  {
    name: '横浜',
    why: '同一駅（35.466111, 139.6225）。JR東海道線側の駅列欠落（鶴見・新子安・東神奈川）に起因する誤検出。v2.58.2 で欠落3駅を補完済み。',
    url: 'https://ja.wikipedia.org/wiki/横浜駅',
  },
  {
    name: '京成高砂',
    why: '同一駅（35.750972, 139.866944）。京成成田空港線の駅列に「東松戸」が欠落しており、京成高砂→新鎌ヶ谷が 12.4km と大きく表示されていた。v2.58.2 で欠落を補完済み。',
    url: 'https://ja.wikipedia.org/wiki/京成高砂駅',
  },
  {
    name: '新鎌ヶ谷',
    why: '同一駅（35.779797, 139.999516）。北総鉄道・京成松戸線・京成成田空港線・東武野田線の4路線を乗り入れる総合駅で、実体は1か所。',
    url: 'https://ja.wikipedia.org/wiki/新鎌ヶ谷駅',
  },
];

// ---------- 3) Wikipedia の駅一覧とローカルの駅列の突合 ----------
// 公式駅数・Wikipedia 駅一覧で確定している路線。
const LINE_STATION_LISTS = [
  {
    line: '京成成田空港線',
    url: 'https://ja.wikipedia.org/wiki/京成成田空港線',
    note: '成田スカイアクセス線。Wikipedia infobox「駅数 8駅」',
    stations: ['京成高砂', '東松戸', '新鎌ヶ谷', '千葉ニュータウン中央', '印旛日本医大', '成田湯川', '空港第2ビル', '成田空港'],
  },
  {
    line: 'JR東海道線',
    url: 'https://ja.wikipedia.org/wiki/東海道本線',
    note: '鶴見駅 infobox「線路名称上は東海道本線」。Web 上のJR線形図（京浜東北線と重複）でも鶴見・新子安・東神奈川を東海道本線扱い',
    stations: ['東京', '新橋', '品川', '川崎', '鶴見', '新子安', '東神奈川', '横浜', '東戸塚', '戸塚', '大船', '藤沢', '辻堂', '茅ヶ崎', '平塚', '大磯', '二宮', '国府津', '鴨宮', '小田原', '早川', '根府川', '真鶴', '湯河原', '熱海'],
  },
];

// ---------- 判定 ----------
let fail = 0;
const warn = [];

console.log('=== 1) 実在の同名別駅: 分離状況の検証 ===\n');
for (const s of SAME_NAME_STATIONS) {
  const near = coords[s.near], far = coords[s.far];
  if (!near || !far) {
    console.log(`❌ ${s.near} / ${s.far}: 座標が足りない（near=${!!near} far=${!!far}）`);
    fail++; continue;
  }
  const dNear = haversineKm(near, s.nearInfo);
  const dFar = haversineKm(far, s.farInfo);
  const gap = haversineKm(near, far);
  const registered = Object.prototype.hasOwnProperty.call(AMBIGUOUS_STATION_NAMES, s.near)
    && AMBIGUOUS_STATION_NAMES[s.near].includes(s.far);
  const inFarLine = (RAILWAY_LINES[s.farInfo.line] || []).includes(s.far);
  const inNearLine = (RAILWAY_LINES[s.nearInfo.line] || []).includes(s.near);
  const okCoord = dNear < 0.3 && dFar < 0.3;   // 300m 以内なら infobox と一致とみなす
  const okAll = okCoord && registered && inFarLine && inNearLine;
  if (!okAll) fail++;
  console.log(`${okAll ? '✅' : '❌'} ${s.near} ⇔ ${s.far}`);
  console.log(`   ${s.nearInfo.line}（${s.nearInfo.place} ${s.nearInfo.num}） ${near.lat.toFixed(6)},${near.lon.toFixed(6)}  ※Wikipedia比 ${(dNear * 1000).toFixed(0)}m`);
  console.log(`   ${s.farInfo.line}（${s.farInfo.place} ${s.farInfo.num}） ${far.lat.toFixed(6)},${far.lon.toFixed(6)}  ※Wikipedia比 ${(dFar * 1000).toFixed(0)}m`);
  console.log(`   離隔 ${gap.toFixed(1)}km / 路線登録: ${inNearLine ? 'OK' : 'NG'}+${inFarLine ? 'OK' : 'NG'} / AMBIGUOUS登録: ${registered ? 'OK' : 'NG'}`);
  console.log(`   出典: ${s.nearInfo.url} , ${s.farInfo.url}`);
}

console.log('\n=== 2) 誤検出パターン（同一駅・分離不要）の記録 ===\n');
for (const f of FALSE_POSITIVES) {
  const c = coords[f.name];
  console.log(`ℹ️  ${f.name}  ${c ? `座標 ${c.lat.toFixed(6)},${c.lon.toFixed(6)}` : '座標なし'}`);
  console.log(`   ${f.why}`);
  console.log(`   出典: ${f.url}`);
}

console.log('\n=== 3) 路線駅列と Wikipedia 駅一覧の突合 ===\n');
for (const l of LINE_STATION_LISTS) {
  const local = RAILWAY_LINES[l.line] || [];
  const missing = l.stations.filter(s => !local.includes(s));
  const extra = local.filter(s => !l.stations.includes(s));
  const nodeExists = missing.every(s => Object.prototype.hasOwnProperty.call(coords, s));
  if (missing.length) {
    warn.push({ line: l.line, missing, nodeExists, url: l.url, note: l.note });
    console.log(`⚠️  ${l.line}（${l.note}）`);
    console.log(`   ローカル ${local.length}駅 / Wikipedia ${l.stations.length}駅`);
    console.log(`   欠落: ${missing.join(', ')}  ${nodeExists ? '※座標は既に存在（ノードは有・路線定義のみ欠落）' : '※座標も無い'}`);
    console.log(`   出典: ${l.url}`);
  } else {
    console.log(`✅ ${l.line}: Wikipedia ${l.stations.length}駅と一致`);
    if (extra.length) console.log(`   余剰: ${extra.join(', ')}`);
  }
}

console.log(`\n===== サマリー =====`);
console.log(`同名別駅の分離検証: ${SAME_NAME_STATIONS.length}件中 ${fail ? `${fail}件が要修正` : '全てOK'}`);
console.log(`路線駅列の欠落: ${warn.length}件`);
for (const w of warn) console.log(`  - ${w.line}: ${w.missing.join(', ')} が欠落（要追加）`);
if (fail) {
  console.error('同名別駅の照合に失敗があります');
  process.exit(1);
}
