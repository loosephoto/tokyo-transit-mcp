// 全RAILWAY_LINESをダンプして現状把握するスクリプト
import { readFileSync } from 'fs';
const src = readFileSync('src/index.mjs', 'utf8');
const m = src.match(/RAILWAY_LINES\s*=\s*\{([\s\S]*?)\n\};/);
if (!m) { console.log('RAILWAY_LINES block not found'); process.exit(1); }
const block = m[1];

// 各エントリを 'キー': [...], の形式で抽出
const entries = [];
const re = /^\s*'([^']+)'\s*:\s*\[([^\]]*)\],?\s*$/gm;
let match;
while ((match = re.exec(block)) !== null) {
  const name = match[1];
  const stations = match[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  entries.push({ name, stations });
}

console.log('=== 全路線数:', entries.length, '===');
// 全駅の重複チェック（どの路線に何回出るか）
const stationCount = {};
for (const e of entries) {
  for (const s of e.stations) {
    if (!stationCount[s]) stationCount[s] = [];
    stationCount[s].push(e.name);
  }
}
console.log('\n=== 複数路線に出現する駅（乗換駅として正しいか確認）===');
const multi = Object.entries(stationCount).filter(([s, lines]) => lines.length > 1);
for (const [s, lines] of multi.sort((a,b)=>b[1].length-a[1].length)) {
  console.log(` ${s}: ${lines.join(' / ')}`);
}
console.log('\n=== 新規追加予定駅が既存に存在するか ===');
const newStations = ['国立','永田町','代々木公園','虎ノ門ヒルズ','地下鉄赤塚','地下鉄成増','中野新橋','中野富士見町','落合','高田馬場','早稲田','東浦和','南越谷','越谷レイクタウン','吉川','吉川美南','新三郷','三郷','船橋法典','綾瀬','亀有','金町','北松戸','馬橋','新松戸','北小金','南柏','逆井','高柳','天王台','大師前','西新井','松戸新田','上本郷','みのり台','八柱','常盤平','五香','元山','くぬぎ山','北初富','新鎌ヶ谷','初富','鎌ヶ谷大仏','二和向台','三咲','滝不動','高根公団','高根木戸','北習志野','習志野','薬園台','前原','新津田沼','津田沼','川崎','尻手','矢向','鹿島田','平間','向河原','武蔵小杉','武蔵中原','武蔵新城','武蔵溝ノ口','津田山','久地','宿河原','登戸','中野島','稲田堤','矢野口','稲城長沼','南多摩','分倍河原','西府','谷保','矢川','西国立','多摩湖','西武園ゆうえんち','遊園地西','西武球場前','西武園','一橋学園','青梅街道','萩山','東村山','国分寺','朝霞','和光市','大宮','本八幡','武蔵浦和','西浦和','南浦和','新八柱','東松戸','市川大野','松戸'];
for (const s of newStations) {
  if (stationCount[s]) console.log(` ${s}: 既存 [${stationCount[s].join(', ')}]`);
  else console.log(` ${s}: (新規)`);
}
