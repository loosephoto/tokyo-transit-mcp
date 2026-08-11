// 新規駅の英字エイリアスをSTATION_NAME_MAPに追加するスクリプト
import fs from 'node:fs';

let src = fs.readFileSync('src/data/station-names.mjs', 'utf8');

const anchor = "  'Hatchonawate': '八丁畷', 'Kawasaki-Shimmachi': '川崎新町', 'KawasakiShimmachi': '川崎新町', 'Hama-Kawasaki': '浜川崎', 'HamaKawasaki': '浜川崎',\n";
if (!src.includes(anchor)) { console.error('NAME_MAP ANCHOR NOT FOUND'); process.exit(1); }

const aliases = {
  // 東急池上線
  'Osaki-Hirokoji': '大崎広小路', 'OsakiHirokoji': '大崎広小路', 'Togoshi-Ginza': '戸越銀座', 'TogoshiGinza': '戸越銀座',
  'Ebara-Nakanobu': '荏原中延', 'EbaraNakanobu': '荏原中延', 'Nagahara': '長原', 'Senzokuike': '洗足池',
  'Ishikawadai': '石川台', 'Yukigaya-Otsuka': '雪が谷大塚', 'YukigayaOtsuka': '雪が谷大塚', 'Ontakesan': '御嶽山',
  'Kugahara': '久が原', 'Chidoricho': '千鳥町', 'Ikegami': '池上', 'Hasunuma': '蓮沼',
  // 東急多摩川線
  'Numabe': '沼部', 'Unoki': '鵜の木', 'Shimomaruko': '下丸子', 'Musashi-Nitta': '武蔵新田', 'MusashiNitta': '武蔵新田',
  'Yaguchinowatashi': '矢口渡',
  // 東急世田谷線
  'Nishi-Taishido': '西太子堂', 'NishiTaishido': '西太子堂', 'Wakabayashi': '若林',
  'Shoin-Jinja-mae': '松陰神社前', 'ShoinJinjae': '松陰神社前', 'Kamimachi': '上町', 'Miyanosaka': '宮の坂',
  'Yamashita': '山下', 'Matsubara': '松原',
  // 京成金町線
  'Shibamata': '柴又', 'Keisei-Kanamachi': '京成金町', 'KeiseiKanamachi': '京成金町',
  // 東武亀戸線
  'Omurai': '小村井', 'Higashi-Azuma': '東あずま', 'HigashiAzuma': '東あずま',
  'Kameido-Suijin': '亀戸水神', 'KameidoSuijin': '亀戸水神',
  // 京急大師線
  'Minatocho': '港町', 'Suzukicho': '鈴木町', 'Kawasaki-Daishi': '川崎大師', 'KawasakiDaishi': '川崎大師',
  'Higashi-Monzen': '東門前', 'HigashiMonzen': '東門前', 'Daishibashi': '大師橋', 'Kojimashinden': '小島新田',
  // 西武多摩川線
  'Shin-Koganei': '新小金井', 'ShinKoganei': '新小金井', 'Shiraitodai': '白糸台',
  'Kyoteijo-mae': '競艇場前', 'Kyoteijomae': '競艇場前', 'Koremasa': '是政',
  // 西武国分寺線
  'Koigakubo': '恋ヶ窪', 'Takanodai': '鷹の台', 'Ogawa': '小川',
  // 小田急江ノ島線
  'Higashi-Rinkan': '東林間', 'HigashiRinkan': '東林間', 'Chuo-Rinkan': '中央林間', 'ChuoRinkan': '中央林間',
  'Minami-Rinkan': '南林間', 'MinamiRinkan': '南林間', 'Tsuruma': '鶴間', 'Sakuragaoka': '桜ヶ丘',
  'Koza-Shibuya': '高座渋谷', 'KozaShibuya': '高座渋谷', 'Chogo': '長後',
  'Mutsuzai-Nichidai-mae': '六会日大前', 'MutsuzaiNichidaimae': '六会日大前', 'Zengyo': '善行',
  'Fujisawa-Hommachi': '藤沢本町', 'FujisawaHommachi': '藤沢本町', 'Hon-Kugenuma': '本鵠沼', 'HonKugenuma': '本鵠沼',
  'Kugenuma-Kaigan': '鵠沼海岸', 'KugenumaKaigan': '鵠沼海岸', 'Katase-Enoshima': '片瀬江ノ島', 'KataseEnoshima': '片瀬江ノ島',
  // 京急逗子線
  'Mutsuura': '六浦', 'Jimmuji': '神武寺', 'Zushi-Hayama': '逗子・葉山', 'ZushiHayama': '逗子・葉山',
  // 京急久里浜線
  'Shin-Otsu': '新大津', 'ShinOtsu': '新大津', 'Kita-Kurihama': '北久里浜', 'KitaKurihama': '北久里浜',
  'Keikyu-Kurihama': '京急久里浜', 'KeikyuKurihama': '京急久里浜', 'YRP-Nobi': 'YRP野比', 'YRPNobi': 'YRP野比',
  'Keikyu-Nagasawa': '京急長沢', 'KeikyuNagasawa': '京急長沢', 'Tsukuihama': '津久井浜',
  'Miura-Kaigan': '三浦海岸', 'MiuraKaigan': '三浦海岸', 'Misakiguchi': '三崎口',
  // 相鉄いずみ野線
  'Minami-Makigahara': '南万騎が原', 'MinamiMakigahara': '南万騎が原', 'Ryokuen-Toshi': '緑園都市',
  'RyokuenToshi': '緑園都市', 'Yayoidai': '弥生台', 'Izumino': 'いずみ野',
  'Izumi-Chuo': 'いずみ中央', 'IzumiChuo': 'いずみ中央', 'Yumegaoka': 'ゆめが丘',
  // 相鉄新横浜線
  'Hazawa-Yokohama-Kokudai': '羽沢横浜国大', 'HazawaYokohamaKokudai': '羽沢横浜国大',
  // 湘南モノレール
  'Fujimicho': '富士見町', 'Shonan-Machiya': '湘南町屋', 'ShonanMachiya': '湘南町屋',
  'Shonan-Fukasawa': '湘南深沢', 'ShonanFukasawa': '湘南深沢', 'Nishi-Kamakura': '西鎌倉', 'NishiKamakura': '西鎌倉',
  'Kataseyama': '片瀬山', 'Mejiroyamashita': '目白山下', 'Shonan-Enoshima': '湘南江の島', 'ShonanEnoshima': '湘南江の島',
  // JR青梅線
  'Nishi-Tachikawa': '西立川', 'NishiTachikawa': '西立川', 'Higashi-Nakagami': '東中神', 'HigashiNakagami': '東中神',
  'Nakagami': '中神', 'Akishima': '昭島', 'Haijima': '拝島', 'Ushihama': '牛浜', 'Fussa': '福生', 'Hamura': '羽村',
  'Ozaku': '小作', 'Kabe': '河辺', 'Higashi-Ome': '東青梅', 'HigashiOme': '東青梅', 'Ome': '青梅',
  'Miyanohira': '宮ノ平', 'Hinatawada': '日向和田', 'Ishigamimae': '石神前', 'Futamatao': '二俣尾',
  'Ikusabata': '軍畑', 'Sawai': '沢井', 'Mitake': '御嶽', 'Kawai': '川井', 'Kori': '古里', 'Hatonosu': '鳩ノ巣',
  'Shiromaru': '白丸', 'Okutama': '奥多摩',
  // JR五日市線
  'Kumagawa': '熊川', 'Higashi-Akiru': '東秋留', 'HigashiAkiru': '東秋留', 'Akigawa': '秋川',
  'Musashi-Hikida': '武蔵引田', 'MusashiHikida': '武蔵引田', 'Musashi-Masuko': '武蔵増戸', 'MusashiMasuko': '武蔵増戸',
  'Musashi-Itsukaichi': '武蔵五日市', 'MusashiItsukaichi': '武蔵五日市',
  // JR鶴見線
  'Kokudo': '国道', 'Tsurumi-Ono': '鶴見小野', 'TsurumiOno': '鶴見小野', 'Bentenbashi': '弁天橋',
  'Asano': '浅野', 'Anzen': '安善', 'Musashi-Shiraishi': '武蔵白石', 'MusashiShiraishi': '武蔵白石',
  'Showa': '昭和', 'Ogimachi': '扇町',
  // JR相模線
  'Kita-Chigasaki': '北茅ケ崎', 'KitaChigasaki': '北茅ケ崎', 'Kagawa': '香川', 'Samukawa': '寒川',
  'Miyayama': '宮山', 'Kurami': '倉見', 'Kadosawabashi': '門沢橋', 'Shake': '社家', 'Atsugi': '厚木',
  'Iriya': '入谷', 'Sobu-Daishita': '相武台下', 'SobuDaishita': '相武台下', 'Shimomizo': '下溝',
  'Hara-Taima': '原当麻', 'HaraTaima': '原当麻', 'Banda': '番田', 'Kamimizo': '上溝',
  'Minami-Hashimoto': '南橋本', 'MinamiHashimoto': '南橋本',
  // JR八高線
  'Kita-Hachioji': '北八王子', 'KitaHachioji': '北八王子', 'Komiya': '小宮', 'Higashi-Fussa': '東福生',
  'HigashiFussa': '東福生', 'Hakonegasaki': '箱根ケ崎', 'Kaneko': '金子', 'Higashi-Hanno': '東飯能',
  'HigashiHanno': '東飯能', 'Komagawa': '高麗川',
  // JR川越線
  'Nisshin': '日進', 'Nishi-Omiya': '西大宮', 'NishiOmiya': '西大宮', 'Sashiogi': '指扇',
  'Minami-Furuya': '南古谷', 'MinamiFuruya': '南古谷', 'Kawagoe': '川越', 'Nishi-Kawagoe': '西川越',
  'NishiKawagoe': '西川越', 'Matoba': '的場', 'Kasahata': '笠幡', 'Musashi-Takahagi': '武蔵高萩',
  'MusashiTakahagi': '武蔵高萩',
  // JR高崎線
  'Miyahara': '宮原', 'Ageo': '上尾', 'Kita-Ageo': '北上尾', 'KitaAgeo': '北上尾', 'Okegawa': '桶川',
  'Kitamoto': '北本', 'Konosu': '鴻巣', 'Kita-Konosu': '北鴻巣', 'KitaKonosu': '北鴻巣', 'Fukiage': '吹上',
  'Gyoda': '行田', 'Kumagaya': '熊谷', 'Kagohara': '籠原', 'Fukaya': '深谷', 'Okabe': '岡部',
  'Honjo': '本庄', 'Jimbo-hara': '神保原', 'Jimbohara': '神保原', 'Shimmachi': '新町', 'Kuragano': '倉賀野',
  'Takasaki': '高崎',
  // JR宇都宮線
  'Toro': '土呂', 'Higashi-Omiya': '東大宮', 'HigashiOmiya': '東大宮', 'Hasuda': '蓮田', 'Shiraoka': '白岡',
  'Shin-Shiraoka': '新白岡', 'ShinShiraoka': '新白岡', 'Higashi-Washinomiya': '東鷲宮', 'HigashiWashinomiya': '東鷲宮',
  'Kurihashi': '栗橋', 'Koga': '古河', 'Nogi': '野木', 'Mamada': '間々田', 'Oyama': '小山',
  'Koganei': '小金井', 'Jichi-Idai': '自治医大', 'JichiIdai': '自治医大', 'Ishibashi': '石橋',
  'Suzumenomiya': '雀宮', 'Utsunomiya': '宇都宮',
  // 東武野田線
  'Kita-Omiya': '北大宮', 'KitaOmiya': '北大宮', 'Omiya-Koen': '大宮公園', 'OmiyaKoen': '大宮公園',
  'Owada': '大和田', 'Nanasato': '七里', 'Iwatsuki': '岩槻', 'Higashi-Iwatsuki': '東岩槻', 'HigashiIwatsuki': '東岩槻',
  'Toyoharu': '豊春', 'Yagisaki': '八木崎', 'Kasukabe': '春日部', 'Fujino-Ushijima': '藤の牛島', 'FujinoUshijima': '藤の牛島',
  'Minami-Sakurai': '南桜井', 'MinamiSakurai': '南桜井', 'Kawama': '川間', 'Nanakodai': '七光台',
  'Shimizu-Koen': '清水公園', 'ShimizuKoen': '清水公園', 'Atago': '愛宕', 'Nodashi': '野田市',
  'Umesato': '梅郷', 'Unga': '運河', 'Edogawadai': '江戸川台', 'Hatsuishi': '初石',
  'Toyoshiki': '豊四季', 'Shin-Kashiwa': '新柏', 'ShinKashiwa': '新柏', 'Masuo': '増尾',
  'Mutsumi': '六実', 'Kamagaya': '鎌ヶ谷', 'Magomezawa': '馬込沢', 'Tsukada': '塚田',
  'Shin-Funabashi': '新船橋', 'ShinFunabashi': '新船橋',
  // 東武宇都宮線
  'Shin-Tochigi': '新栃木', 'ShinTochigi': '新栃木', 'Yashu-Hirakawa': '野州平川', 'YashuHirakawa': '野州平川',
  'Yashu-Otsuka': '野州大塚', 'YashuOtsuka': '野州大塚', 'Mibu': '壬生', 'Kuniya': '国谷',
  'Omocha-no-Machi': 'おもちゃのまち', 'OmochaNoMachi': 'おもちゃのまち', 'Yasuzuka': '安塚',
  'Nishikawada': '西川田', 'Esojima': '江曽島', 'Minami-Utsunomiya': '南宇都宮', 'MinamiUtsunomiya': '南宇都宮',
  'Tobu-Utsunomiya': '東武宇都宮', 'TobuUtsunomiya': '東武宇都宮',
  // 京成千葉線
  'Keisei-Makuhari-Hongo': '京成幕張本郷', 'KeiseiMakuhariHongo': '京成幕張本郷', 'Keisei-Makuhari': '京成幕張',
  'KeiseiMakuhari': '京成幕張', 'Kemigawa': '検見川', 'Keisei-Inage': '京成稲毛', 'KeiseiInage': '京成稲毛',
  'Midoridai': 'みどり台', 'Nishi-Nobuto': '西登戸', 'NishiNobuto': '西登戸', 'Shin-Chiba': '新千葉',
  'ShinChiba': '新千葉', 'Keisei-Chiba': '京成千葉', 'KeiseiChiba': '京成千葉',
  'Chiba-Chuo': '千葉中央', 'ChibaChuo': '千葉中央',
  // 京成千原線
  'Chibadera': '千葉寺', 'Omoridai': '大森台', 'Gakuen-mae': '学園前', 'Gakuenmae': '学園前',
  'Oyumino': 'おゆみ野', 'Chiharadai': 'ちはら台',
};

const lines = Object.entries(aliases).map(([k, v]) => `  '${k}': '${v}',`);
const insert = '\n  // 2026-08 v2.25 残タスク(#20) 追加237駅 英字エイリアス\n' + lines.join('\n') + '\n';
src = src.replace(anchor, anchor + insert);
fs.writeFileSync('src/data/station-names.mjs', src);
console.log('STATION_NAME_MAP に', Object.keys(aliases).length, 'エイリアスを追加しました');
