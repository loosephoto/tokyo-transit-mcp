// 新規237駅のen/zh表示名を生成してSTATION_DISPLAY_NAMESに挿入するスクリプト
// ローマ字変換は手動マップ（精度優先）+ フォールバック
import fs from 'node:fs';

let src = fs.readFileSync('src/data/station-names.mjs', 'utf8');

// 手動ローマ字マップ（新規駅のみ）
const ROMAN = {
  // 東急池上線
  '大崎広小路': ['Osaki-Hirokoji', '大崎广小路'], '戸越銀座': ['Togoshi-Ginza', '户越银座'],
  '荏原中延': ['Ebara-Nakanobu', '荏原中延'], '長原': ['Nagahara', '长原'],
  '洗足池': ['Senzokuike', '洗足池'], '石川台': ['Ishikawadai', '石川台'],
  '雪が谷大塚': ['Yukigaya-Otsuka', '雪谷大冢'], '御嶽山': ['Ontakesan', '御岳山'],
  '久が原': ['Kugahara', '久原'], '千鳥町': ['Chidoricho', '千鸟町'],
  '池上': ['Ikegami', '池上'], '蓮沼': ['Hasunuma', '莲沼'],
  // 東急多摩川線
  '沼部': ['Numabe', '沼部'], '鵜の木': ['Unoki', '鹈之木'],
  '下丸子': ['Shimomaruko', '下丸子'], '武蔵新田': ['Musashi-Nitta', '武藏新田'],
  '矢口渡': ['Yaguchinowatashi', '矢口渡'],
  // 東急世田谷線
  '西太子堂': ['Nishi-Taishido', '西太子堂'], '若林': ['Wakabayashi', '若林'],
  '松陰神社前': ['Shoin-Jinja-mae', '松阴神社前'], '世田谷': ['Setagaya', '世田谷'],
  '上町': ['Kamimachi', '上町'], '宮の坂': ['Miyanosaka', '宫之坂'],
  '山下': ['Yamashita', '山下'], '松原': ['Matsubara', '松原'],
  // 京成金町線
  '柴又': ['Shibamata', '柴又'], '京成金町': ['Keisei-Kanamachi', '京成金町'],
  // 東武亀戸線
  '小村井': ['Omurai', '小村井'], '東あずま': ['Higashi-Azuma', '东吾妻'],
  '亀戸水神': ['Kameido-Suijin', '龟户水神'],
  // 京急大師線
  '港町': ['Minatocho', '港町'], '鈴木町': ['Suzukicho', '铃木町'],
  '川崎大師': ['Kawasaki-Daishi', '川崎大师'], '東門前': ['Higashi-Monzen', '东门前'],
  '大師橋': ['Daishibashi', '大师桥'], '小島新田': ['Kojimashinden', '小岛新田'],
  // 西武多摩川線
  '新小金井': ['Shin-Koganei', '新小金井'], '多磨': ['Tama', '多磨'],
  '白糸台': ['Shiraitodai', '白糸台'], '競艇場前': ['Kyoteijo-mae', '赛艇场前'],
  '是政': ['Koremasa', '是政'],
  // 西武国分寺線
  '恋ヶ窪': ['Koigakubo', '恋洼'], '鷹の台': ['Takanodai', '鹰之台'],
  '小川': ['Ogawa', '小川'],
  // 小田急江ノ島線
  '東林間': ['Higashi-Rinkan', '东林间'], '中央林間': ['Chuo-Rinkan', '中央林间'],
  '南林間': ['Minami-Rinkan', '南林间'], '鶴間': ['Tsuruma', '鹤间'],
  '桜ヶ丘': ['Sakuragaoka', '樱丘'], '高座渋谷': ['Koza-Shibuya', '高座涩谷'],
  '長後': ['Chogo', '长后'], '六会日大前': ['Mutsuzai-Nichidai-mae', '六会日大前'],
  '善行': ['Zengyo', '善行'], '藤沢本町': ['Fujisawa-Hommachi', '藤泽本町'],
  '本鵠沼': ['Hon-Kugenuma', '本鹄沼'], '鵠沼海岸': ['Kugenuma-Kaigan', '鹄沼海岸'],
  '片瀬江ノ島': ['Katase-Enoshima', '片濑江之岛'],
  // 京急逗子線
  '六浦': ['Mutsuura', '六浦'], '神武寺': ['Jimmuji', '神武寺'],
  '逗子・葉山': ['Zushi-Hayama', '逗子·叶山'],
  // 京急久里浜線
  '新大津': ['Shin-Otsu', '新大津'], '北久里浜': ['Kita-Kurihama', '北久里浜'],
  '京急久里浜': ['Keikyu-Kurihama', '京急久里浜'], 'YRP野比': ['YRP-Nobi', 'YRP野比'],
  '京急長沢': ['Keikyu-Nagasawa', '京急长泽'], '津久井浜': ['Tsukuihama', '津久井浜'],
  '三浦海岸': ['Miura-Kaigan', '三浦海岸'], '三崎口': ['Misakiguchi', '三崎口'],
  // 相鉄いずみ野線
  '南万騎が原': ['Minami-Makigahara', '南万骑原'], '緑園都市': ['Ryokuen-Toshi', '绿园都市'],
  '弥生台': ['Yayoidai', '弥生台'], 'いずみ野': ['Izumino', '泉野'],
  'いずみ中央': ['Izumi-Chuo', '泉中央'], 'ゆめが丘': ['Yumegaoka', '梦丘'],
  // 相鉄新横浜線
  '羽沢横浜国大': ['Hazawa-Yokohama-Kokudai', '羽泽横滨国大'],
  // 湘南モノレール
  '富士見町': ['Fujimicho', '富士见町'], '湘南町屋': ['Shonan-Machiya', '湘南町屋'],
  '湘南深沢': ['Shonan-Fukasawa', '湘南深泽'], '西鎌倉': ['Nishi-Kamakura', '西镰仓'],
  '片瀬山': ['Kataseyama', '片濑山'], '目白山下': ['Mejiroyamashita', '目白山', '下'],
  '湘南江の島': ['Shonan-Enoshima', '湘南江之岛'],
  // JR青梅線
  '西立川': ['Nishi-Tachikawa', '西立川'], '東中神': ['Higashi-Nakagami', '东中神'],
  '中神': ['Nakagami', '中神'], '昭島': ['Akishima', '昭岛'],
  '拝島': ['Haijima', '拜岛'], '牛浜': ['Ushihama', '牛浜'],
  '福生': ['Fussa', '福生'], '羽村': ['Hamura', '羽村'],
  '小作': ['Ozaku', '小作'], '河辺': ['Kabe', '河边'],
  '東青梅': ['Higashi-Ome', '东青梅'], '青梅': ['Ome', '青梅'],
  '宮ノ平': ['Miyanohira', '宫之平'], '日向和田': ['Hinatawada', '日向和田'],
  '石神前': ['Ishigamimae', '石神前'], '二俣尾': ['Futamatao', '二俣尾'],
  '軍畑': ['Ikusabata', '军畑'], '沢井': ['Sawai', '泽井'],
  '御嶽': ['Mitake', '御岳'], '川井': ['Kawai', '川井'],
  '古里': ['Kori', '古里'], '鳩ノ巣': ['Hatonosu', '鸠之巢'],
  '白丸': ['Shiromaru', '白丸'], '奥多摩': ['Okutama', '奥多摩'],
  // JR五日市線
  '熊川': ['Kumagawa', '熊川'], '東秋留': ['Higashi-Akiru', '东秋留'],
  '秋川': ['Akigawa', '秋川'], '武蔵引田': ['Musashi-Hikida', '武藏引田'],
  '武蔵増戸': ['Musashi-Masuko', '武藏增户'], '武蔵五日市': ['Musashi-Itsukaichi', '武藏五日市'],
  // JR鶴見線
  '国道': ['Kokudo', '国道'], '鶴見小野': ['Tsurumi-Ono', '鹤见小野'],
  '弁天橋': ['Bentenbashi', '弁天桥'], '浅野': ['Asano', '浅野'],
  '安善': ['Anzen', '安善'], '武蔵白石': ['Musashi-Shiraishi', '武藏白石'],
  '昭和': ['Showa', '昭和'], '扇町': ['Ogimachi', '扇町'],
  // JR相模線
  '北茅ケ崎': ['Kita-Chigasaki', '北茅崎'], '香川': ['Kagawa', '香川'],
  '寒川': ['Samukawa', '寒川'], '宮山': ['Miyayama', '宫山'],
  '倉見': ['Kurami', '仓见'], '門沢橋': ['Kadosawabashi', '门泽桥'],
  '社家': ['Shake', '社家'], '厚木': ['Atsugi', '厚木'],
  '入谷': ['Iriya', '入谷'], '相武台下': ['Sobu-Daishita', '相武台下'],
  '下溝': ['Shimomizo', '下沟'], '原当麻': ['Hara-Taima', '原当麻'],
  '番田': ['Banda', '番田'], '上溝': ['Kamimizo', '上沟'],
  '南橋本': ['Minami-Hashimoto', '南桥本'],
  // JR八高線
  '北八王子': ['Kita-Hachioji', '北八王子'], '小宮': ['Komiya', '小宫'],
  '東福生': ['Higashi-Fussa', '东福生'], '箱根ケ崎': ['Hakonegasaki', '箱根崎'],
  '金子': ['Kaneko', '金子'], '東飯能': ['Higashi-Hanno', '东饭能'],
  '高麗川': ['Komagawa', '高丽川'],
  // JR川越線
  '日進': ['Nisshin', '日进'], '西大宮': ['Nishi-Omiya', '西大宫'],
  '指扇': ['Sashiogi', '指扇'], '南古谷': ['Minami-Furuya', '南古谷'],
  '川越': ['Kawagoe', '川越'], '西川越': ['Nishi-Kawagoe', '西川越'],
  '的場': ['Matoba', '的场'], '笠幡': ['Kasahata', '笠幡'],
  '武蔵高萩': ['Musashi-Takahagi', '武藏高萩'],
  // JR高崎線
  '宮原': ['Miyahara', '宫原'], '上尾': ['Ageo', '上尾'],
  '北上尾': ['Kita-Ageo', '北上尾'], '桶川': ['Okegawa', '桶川'],
  '北本': ['Kitamoto', '北本'], '鴻巣': ['Konosu', '鸿巢'],
  '北鴻巣': ['Kita-Konosu', '北鸿巢'], '吹上': ['Fukiage', '吹上'],
  '行田': ['Gyoda', '行田'], '熊谷': ['Kumagaya', '熊谷'],
  '籠原': ['Kagohara', '笼原'], '深谷': ['Fukaya', '深谷'],
  '岡部': ['Okabe', '冈部'], '本庄': ['Honjo', '本庄'],
  '神保原': ['Jimbo-hara', '神保原'], '新町': ['Shimmachi', '新町'],
  '倉賀野': ['Kuragano', '仓贺野'], '高崎': ['Takasaki', '高崎'],
  // JR宇都宮線
  '土呂': ['Toro', '土吕'], '東大宮': ['Higashi-Omiya', '东大宫'],
  '蓮田': ['Hasuda', '莲田'], '白岡': ['Shiraoka', '白冈'],
  '新白岡': ['Shin-Shiraoka', '新白冈'], '東鷲宮': ['Higashi-Washinomiya', '东鹫宫'],
  '栗橋': ['Kurihashi', '栗桥'], '古河': ['Koga', '古河'],
  '野木': ['Nogi', '野木'], '間々田': ['Mamada', '间田'],
  '小山': ['Oyama', '小山'], '小金井': ['Koganei', '小金井'],
  '自治医大': ['Jichi-Idai', '自治医大'], '石橋': ['Ishibashi', '石桥'],
  '雀宮': ['Suzumenomiya', '雀宫'], '宇都宮': ['Utsunomiya', '宇都宫'],
  // 東武野田線
  '北大宮': ['Kita-Omiya', '北大宫'], '大宮公園': ['Omiya-Koen', '大宫公园'],
  '大和田': ['Owada', '大和田'], '七里': ['Nanasato', '七里'],
  '岩槻': ['Iwatsuki', '岩槻'], '東岩槻': ['Higashi-Iwatsuki', '东岩槻'],
  '豊春': ['Toyoharu', '丰春'], '八木崎': ['Yagisaki', '八木崎'],
  '春日部': ['Kasukabe', '春日部'], '藤の牛島': ['Fujino-Ushijima', '藤之牛岛'],
  '南桜井': ['Minami-Sakurai', '南樱井'], '川間': ['Kawama', '川间'],
  '七光台': ['Nanakodai', '七光台'], '清水公園': ['Shimizu-Koen', '清水公园'],
  '愛宕': ['Atago', '爱宕'], '野田市': ['Nodashi', '野田市'],
  '梅郷': ['Umesato', '梅乡'], '運河': ['Unga', '运河'],
  '江戸川台': ['Edogawadai', '江户川台'], '初石': ['Hatsuishi', '初石'],
  '豊四季': ['Toyoshiki', '丰四季'], '新柏': ['Shin-Kashiwa', '新柏'],
  '増尾': ['Masuo', '增尾'], '六実': ['Mutsumi', '六实'],
  '鎌ヶ谷': ['Kamagaya', '镰谷'], '馬込沢': ['Magomezawa', '马込泽'],
  '塚田': ['Tsukada', '塚田'], '新船橋': ['Shin-Funabashi', '新船桥'],
  // 東武宇都宮線
  '新栃木': ['Shin-Tochigi', '新栃木'], '野州平川': ['Yashu-Hirakawa', '野州平川'],
  '野州大塚': ['Yashu-Otsuka', '野州大冢'], '壬生': ['Mibu', '壬生'],
  '国谷': ['Kuniya', '国谷'], 'おもちゃのまち': ['Omocha-no-Machi', '玩具之街'],
  '安塚': ['Yasuzuka', '安塚'], '西川田': ['Nishikawada', '西川田'],
  '江曽島': ['Esojima', '江曾岛'], '南宇都宮': ['Minami-Utsunomiya', '南宇都宫'],
  '東武宇都宮': ['Tobu-Utsunomiya', '东武宇都宫'],
  // 京成千葉線
  '京成幕張本郷': ['Keisei-Makuhari-Hongo', '京成幕张本乡'], '京成幕張': ['Keisei-Makuhari', '京成幕张'],
  '検見川': ['Kemigawa', '检见川'], '京成稲毛': ['Keisei-Inage', '京成稻毛'],
  'みどり台': ['Midoridai', '绿台'], '西登戸': ['Nishi-Nobuto', '西登户'],
  '新千葉': ['Shin-Chiba', '新千叶'], '京成千葉': ['Keisei-Chiba', '京成千叶'],
  '千葉中央': ['Chiba-Chuo', '千叶中央'],
  // 京成千原線
  '千葉寺': ['Chibadera', '千叶寺'], '大森台': ['Omoridai', '大森台'],
  '学園前': ['Gakuen-mae', '学园前'], 'おゆみ野': ['Oyumino', '御弓野'],
  'ちはら台': ['Chiharadai', '千原台'],
};

// STATION_DISPLAY_NAMES の挿入位置（'相原': { en: 'Aihara', zh: '相原' } の後・`};` の前）
const anchor = "  '相原': { en: 'Aihara', zh: '相原' },\n";
const idx = src.indexOf(anchor);
if (idx < 0) { console.error('DISPLAY ANCHOR NOT FOUND'); process.exit(1); }

const lines = [];
for (const [ja, [en, zh]] of Object.entries(ROMAN)) {
  lines.push(`  '${ja}': { en: '${en}', zh: '${zh}' },`);
}
const insert = '\n  // 2026-08 v2.25 残タスク(#20) 追加237駅\n' + lines.join('\n') + '\n';
src = src.replace(anchor, anchor + insert);
fs.writeFileSync('src/data/station-names.mjs', src);
console.log('STATION_DISPLAY_NAMES に', Object.keys(ROMAN).length, '駅を追加しました');
