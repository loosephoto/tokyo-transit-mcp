// 全ランドマークの ja/en/zh 別名が resolveStation で解決されるか一括プローブ
import * as mod from '../src/index.mjs';

// LANDMARK_DEFS は未エクスポートのため、直接参照できない。
// 代わりに STATION_NAME_MAP の全キー + 主要ランドマーク名を解決テストする。
// ここでは LANDMARK_DEFS の全 names を import 経由で取得できないため、
// 既知の主要ランドマーク名（ja/en/zh）を列挙して解決確認する。

const { resolveStation } = mod;

const landmarks = [
  // [name, 期待解決駅]
  ['東京ディズニーランド', '舞浜'], ['Tokyo Disneyland', '舞浜'], ['东京迪士尼乐园', '舞浜'],
  ['ディズニーランド', '舞浜'], ['Disneyland', '舞浜'], ['迪士尼乐园', '舞浜'],
  ['東京ディズニーシー', '舞浜'], ['Tokyo DisneySea', '舞浜'], ['东京迪士尼海洋', '舞浜'],
  ['スカイツリー', 'とうきょうスカイツリー'], ['Tokyo Skytree', 'とうきょうスカイツリー'], ['东京晴空塔', 'とうきょうスカイツリー'],
  ['お台場', '台場'], ['Odaiba', '台場'], ['台场', '台場'],
  ['横浜ランドマークタワー', 'みなとみらい'], ['Yokohama Landmark Tower', 'みなとみらい'], ['横滨地标大厦', 'みなとみらい'],
  ['カップヌードルミュージアム', 'みなとみらい'], ['CupNoodles Museum', 'みなとみらい'], ['杯面博物馆', 'みなとみらい'],
  ['横浜赤レンガ倉庫', '馬車道'], ['Red Brick Warehouse', '馬車道'], ['横滨红砖仓库', '馬車道'],
  ['横浜中華街', '元町・中華街'], ['Chinatown', '元町・中華街'], ['横滨中华街', '元町・中華街'],
  ['八景島シーパラダイス', '金沢八景'], ['Hakkeijima Sea Paradise', '金沢八景'], ['八景岛海岛乐园', '金沢八景'],
  ['ズーラシア', '鶴ヶ峰'], ['Zoorasia', '鶴ヶ峰'],
  ['三溪園', '根岸'], ['Sankeien Garden', '根岸'], ['三溪园', '根岸'],
  ['山下公園', '元町・中華街'], ['Yamashita Park', '元町・中華街'], ['山下公园', '元町・中華街'],
  ['成田ゆめ牧場', '京成成田'], ['Narita Yume Farm', '京成成田'], ['成田梦牧场', '京成成田'],
  ['千葉市動物公園', '千葉'], ['Chiba City Zoo', '千葉'], ['千叶市动物公园', '千葉'],
  ['千葉ポートタワー', '千葉みなと'], ['Chiba Port Tower', '千葉みなと'], ['千叶港塔', '千葉みなと'],
  ['ZOZOマリンスタジアム', '海浜幕張'], ['ZOZO Marine Stadium', '海浜幕張'], ['ZOZO海洋球场', '海浜幕張'],
  ['浦安市総合公園', '新浦安'], ['Urayasu General Park', '新浦安'], ['浦安市综合公园', '新浦安'],
  ['浜離宮', '竹芝'], ['Hama-rikyu', '竹芝'], ['Hamarikyu', '竹芝'], ['浜离宫', '竹芝'], ['滨离宫', '竹芝'],
  ['竹芝桟橋', '竹芝'], ['Takeshiba Pier', '竹芝'], ['竹芝码头', '竹芝'],
  ['日の出桟橋', '浜松町'], ['Hinode Pier', '浜松町'], ['日出码头', '浜松町'],
  ['麻布十番商店街', '麻布十番'], ['Azabu-juban', '麻布十番'], ['麻布十番商店街', '麻布十番'],
  ['表参道', '表参道'], ['Omotesando', '表参道'], ['青山', '表参道'],
  ['増上寺', '芝公園'], ['Zojoji', '芝公園'], ['增上寺', '芝公園'],
  ['築地場外市場', '築地'], ['Tsukiji Market', '築地'], ['筑地市场', '築地'],
  ['豊洲市場', '豊洲'], ['Toyosu Market', '豊洲'], ['丰洲市场', '豊洲'],
  ['皇居', '東京'], ['Imperial Palace', '東京'], ['皇居', '東京'],
  ['国立新美術館', '乃木坂'], ['The National Art Center, Tokyo', '乃木坂'], ['国立新美术馆', '乃木坂'],
  ['浅草寺', '浅草'], ['Sensoji Temple', '浅草'], ['浅草寺', '浅草'],
  ['江戸東京博物館', '両国'], ['Edo-Tokyo Museum', '両国'], ['江户东京博物馆', '両国'],
];

let fail = 0;
console.log('=== 主要ランドマークの ja/en/zh 解決一括プローブ ===');
for (const [name, expected] of landmarks) {
  const r = resolveStation(name);
  const ok = r.station === expected;
  if (!ok) {
    fail++;
    console.log(`❌ ${name} → ${r.station || 'NULL'}（期待: ${expected}）`);
  }
}
if (fail === 0) {
  console.log(`✅ 全 ${landmarks.length} 件のランドマーク名が正しく解決`);
} else {
  console.log(`❌ ${fail} 件 FAIL`);
  process.exitCode = 1;
}
