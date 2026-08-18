/**
 * バス・コミュニティバスデータ（モノリス分割 Phase 2d-2）
 * 純データ＋自動構築（COMMUNITY_BUS_STATION_ACCESS / BUS_OPERATOR_LABEL）。
 * 参照ロジック（fetchAllBuses / searchBus / buildHardCodedBusRecords 等）は index.mjs 側。
 */

export const COMMUNITY_BUS_NAME_MAP = {
  en: {
    'ちぃばす': 'Chii Bus', 'ハチ公バス': 'Hachiko Bus', 'ムーバス': 'M-Bus', 'はなバス': 'Hana Bus',
    'すぎ丸': 'Sugimaru', 'くるりんバス': 'Kururin Bus', 'ちゅうバス': 'Chu Bus', 'Bーぐる': 'B-Guru',
    '江戸バス': 'Edo Bus', 'めぐりん': 'Megurin', 'るのバス': 'Runobus', 'はるかぜ': 'Harukaze',
    'さくら': 'Sakura', 'みどりバス': 'Midori Bus', 'Kバス': 'K-Bus', 'みたかシティバス': 'Mitaka City Bus',
    'はちバス': 'Hachi Bus', 'せたがやくるりん': 'Setagaya Kururin', '新宿WEバス': 'Shinjuku WE Bus',
    'すみまるくん': 'Sumimaru-kun', 'しおかぜ': 'Shiokaze', 'りんりんGO': 'Rinrin GO', 'ぶんバス': 'Bun Bus',
    'こまバス': 'Koma Bus', 'にじバス': 'Niji Bus', 'くにっこ': 'Kunikko', 'きよバス': 'Kiyo Bus',
    'たまちゃんバス': 'Tama-chan Bus', 'ｉバス': 'i-Bus', '多摩市ミニバス': 'Tama City Mini Bus',
    '調布市ミニバス': 'Chofu City Mini Bus', 'グリーンバス': 'Green Bus', 'まちっこ': 'Machikko',
    'Aバス': 'A-Bus', '日野市ミニバス': 'Hino City Mini Bus', 'ちょこバス': 'Choko Bus',
    'MMシャトル': 'MM Shuttle', 'はむらん': 'Hamuran', 'やまびこ': 'Yamabiko', '池07系統': 'Ike 07 Route',
    'CoCoバス': 'CoCo Bus'
  },
  zh: {
    'ちぃばす': '千代田循环巴士', 'ハチ公バス': '八公巴士', 'ムーバス': 'M巴士', 'はなバス': '花巴士',
    'すぎ丸': '杉丸', 'くるりんバス': '巡回巴士', 'ちゅうバス': '中巴士', 'Bーぐる': 'B-guru',
    '江戸バス': '江户巴士', 'めぐりん': '惠巡', 'るのバス': 'RU之巴士', 'はるかぜ': '春风',
    'さくら': '樱花', 'みどりバス': '绿巴士', 'Kバス': 'K巴士', 'みたかシティバス': '三鹰市巴士',
    'はちバス': '八巴士', 'せたがやくるりん': '世田谷巡回', '新宿WEバス': '新宿WE巴士',
    'すみまるくん': '隅丸君', 'しおかぜ': '潮风', 'りんりんGO': '铃铃GO', 'ぶんバス': '文巴士',
    'こまバス': '驹巴士', 'にじバス': '虹巴士', 'くにっこ': '国分寺巴士', 'きよバス': '清巴士',
    'たまちゃんバス': '玉酱巴士', 'ｉバス': 'i巴士', '多摩市ミニバス': '多摩市迷你巴士',
    '調布市ミニバス': '调布市迷你巴士', 'グリーンバス': '绿色巴士', 'まちっこ': '街小',
    'Aバス': 'A巴士', '日野市ミニバス': '日野市迷你巴士', 'ちょこバス': '小步巴士',
    'MMシャトル': 'MM班车', 'はむらん': '羽村巴士', 'やまびこ': '山彦', '池07系統': '池07路',
    'CoCoバス': 'CoCo巴士'
  }
};

export const BUS_STOP_SUFFIX_MAP = {
  en: { '西口': 'West Exit', '東口': 'East Exit', '北口': 'North Exit', '南口': 'South Exit', '駅前': 'Station Front', '中央': 'Central' },
  zh: { '西口': '西口', '東口': '东口', '北口': '北口', '南口': '南口', '駅前': '站前', '中央': '中央' }
};

export const BUS_OPERATORS = [
  { id: 'Toei', label: '都営バス', labelEn: 'Toei Bus', labelZh: '都营公交', website: 'https://www.kotsu.metro.tokyo.jp/bus/' },
  { id: 'SeibuBus', label: '西武バス', labelEn: 'Seibu Bus', labelZh: '西武公交', website: 'https://www.seibubus.co.jp/' },
  { id: 'YokohamaMunicipal', label: '横浜市交通局（横浜市営バス）', labelEn: 'Yokohama City Bus', labelZh: '横滨市营公交', website: 'https://www.city.yokohama.lg.jp/kotsu/' }
];

export const TOKYO_COMMUNITY_BUSES = [
  { municipality: '荒川区', name: 'さくら', url: 'https://www.city.arakawa.tokyo.jp/a040/koutsuu-bus/komyuniteibasu/sakura.html' },
  { municipality: '足立区', name: 'はるかぜ', url: 'https://www.city.adachi.tokyo.jp/machi/kotsu/index.html' },
  { municipality: '昭島市', name: 'Ａバス', url: 'https://www.city.akishima.lg.jp/kurashi/bus/1002242/index.html' },
  { municipality: 'あきる野市', name: 'るのバス', url: 'http://www.city.akiruno.tokyo.jp/category/1-9-5-0-0.html' },
  { municipality: '板橋区', name: 'りんりん号', url: 'http://www.city.itabashi.tokyo.jp/c_kurashi/026/026518.html' },
  { municipality: '稲城市', name: 'ｉバス', url: 'https://www.city.inagi.tokyo.jp/kurashi/koutsuu/1002846/1002848/index.html' },
  { municipality: '大田区', name: 'たまちゃんバス', url: 'http://www.city.ota.tokyo.jp/seikatsu/sumaimachinami/koutsu/communitybusdounyu/communitybus_shikou.html' },
  { municipality: '北区', name: 'Ｋバス', url: 'http://www.city.kita.tokyo.jp/kurashi/bus/index.html' },
  { municipality: '清瀬市', name: 'きよバス', url: 'http://www.city.kiyose.lg.jp/050/060/010/index.html' },
  { municipality: '国立市', name: 'くにっこ', url: 'https://www.city.kunitachi.tokyo.jp/kurashi/kotsu/3/1/index.html' },
  { municipality: '江東区', name: 'しおかぜ', url: 'http://www.city.koto.lg.jp/470801/kurashi/kotsu/kokyo/13116.html' },
  { municipality: '小金井市', name: 'ＣｏＣｏバス', url: 'https://www.city.koganei.lg.jp/smph/kurashi/482/buss/cocobus.html' },
  { municipality: '国分寺市', name: 'ぶんバス', url: 'http://www.city.kokubunji.tokyo.jp/kurashi/koutsuu/bus/' },
  { municipality: '狛江市', name: 'こまバス', url: 'http://www.city.komae.tokyo.jp/sp/index.cfm/41,23028,312,html' },
  { municipality: '小平市', name: 'にじバス', url: 'http://www.city.kodaira.tokyo.jp/kurashi/000/000137.html' },
  { municipality: '新宿区', name: '新宿ＷＥバス（運行終了）', url: 'https://www.city.shinjuku.lg.jp/seikatsu/kotsu01_000001_00022.html' },
  { municipality: '渋谷区', name: 'ハチ公バス', url: 'https://www.city.shibuya.tokyo.jp/kurashi/kotsu/hachiko/' },
  { municipality: '墨田区', name: 'すみまるくん　他', url: 'http://www.city.sumida.lg.jp/kurashi/jyunkanbus/index.html' },
  { municipality: '杉並区', name: 'すぎ丸', url: 'https://www.city.suginami.tokyo.jp/guide/machi/bus/index.html' },
  { municipality: '世田谷区', name: 'せたがやくるりん　他', url: 'http://www.city.setagaya.lg.jp/kurashi/102/122/365/index.html' },
  { municipality: '台東区', name: 'めぐりん', url: 'http://www.city.taito.lg.jp/index/kurashi/kotsu/megurin/index.html' },
  { municipality: '立川市', name: 'くるりんバス', url: 'http://www.city.tachikawa.lg.jp/kurashi/kotsu/shiminbus/index.html' },
  { municipality: '多摩市', name: '多摩市ミニバス', url: 'http://www.city.tama.lg.jp/0000001287.html' },
  { municipality: '中央区', name: '江戸バス', url: 'http://www.city.chuo.lg.jp/kurasi/edobasu/index.html' },
  { municipality: '調布市', name: 'ミニバス', url: 'https://www.city.chofu.lg.jp/080070/p050018.html' },
  { municipality: '豊島区', name: '池07系統', url: 'http://www.city.toshima.lg.jp/298/machizukuri/kotsu/bus/1504221057.html' },
  { municipality: '西東京市', name: 'はなバス', url: 'http://www.city.nishitokyo.lg.jp/kurasi/kotu/hanabus/index.html' },
  { municipality: '練馬区', name: 'みどりバス', url: 'http://www.city.nerima.tokyo.jp/kurashi/sumai/bus/index.html' },
  { municipality: '八王子市', name: 'はちバス', url: 'http://www.city.hachioji.tokyo.jp/kurashi/life/001/002/index.html' },
  { municipality: '羽村市', name: 'はむらん', url: 'http://www.city.hamura.tokyo.jp/category/1-11-15-0-0.html' },
  { municipality: '日野市', name: 'ミニバス', url: 'http://www.city.hino.lg.jp/kurashi/kotsu/bus/minibus/index.html' },
  { municipality: '東大和市', name: 'ちょこバス', url: 'https://www.city.higashiyamato.lg.jp/kurashi/dorokotsu/1002085/index.html' },
  { municipality: '東村山市', name: 'グリーンバス', url: 'http://www.city.higashimurayama.tokyo.jp/kurashi/sumai/bus/index.html' },
  { municipality: '檜原村', name: 'やまびこ', url: 'http://www.vill.hinohara.tokyo.jp/0000000090.html' },
  { municipality: '府中市', name: 'ちゅうバス', url: 'https://www.city.fuchu.tokyo.jp/kurashi/machi/chubus/index.html' },
  { municipality: '文京区', name: 'Ｂーぐる', url: 'https://www.city.bunkyo.lg.jp/b011/p001057/index.html' },
  { municipality: '町田市', name: 'まちっこ　他', url: 'http://www.city.machida.tokyo.jp/kanko/kotu_syuku/index.html' },
  { municipality: '港区', name: 'ちぃばす', url: 'https://www.city.minato.tokyo.jp/kankyo-machi/kotsu/bus/community.html' },
  { municipality: '三鷹市', name: 'みたかシティバス', url: 'http://www.city.mitaka.tokyo.jp/c_service/000/000756.html' },
  { municipality: '武蔵野市', name: 'ムーバス', url: 'https://www.city.musashino.lg.jp/kurashi_tetsuzuki/bus_churin_chusha_kotsuanzen/mubus/index.html' },
  { municipality: '武蔵村山市', name: 'ＭＭシャトル', url: 'http://www.city.musashimurayama.lg.jp/kurashi/koutsu/koukyoukoutu/1000603/index.html' }
];

export const COMMUNITY_BUS_ROUTES = [
  {
    bus: 'ちぃばす', municipality: '港区',
    url: 'https://www.city.minato.tokyo.jp/kankyo-machi/kotsu/bus/community.html',
    routes: [
      { name: '田町ルート', stops: ['田町駅前', '三田駅前', '芝浦四丁目', '港区役所前'] },
      { name: '六本木ルート', stops: ['田町駅前', '神谷町駅前', '六本木駅前', '麻布十番駅前', '赤羽橋駅前'] },
      { name: '麻布ルート', stops: ['麻布十番駅前', '六本木駅前', '赤羽橋駅前'] },
      { name: '赤羽橋ルート', stops: ['赤羽橋駅前', '麻布十番駅前', '白金高輪駅前'] },
      { name: '芝ルート', stops: ['田町駅前', '三田駅前', '芝公園駅前', '御成門駅前', '大門駅前'] }
    ],
    stations: {
      '田町': '田町駅前', '三田': '三田駅前', '芝公園': '芝公園駅前', '御成門': '御成門駅前',
      '大門': '大門駅前', '神谷町': '神谷町駅前', '六本木': '六本木駅前', '麻布十番': '麻布十番駅前',
      '赤羽橋': '赤羽橋駅前', '白金高輪': '白金高輪駅前'
    }
  },
  {
    bus: 'ハチ公バス', municipality: '渋谷区',
    url: 'https://www.city.shibuya.tokyo.jp/kurashi/kotsu/hachiko/',
    routes: [
      { name: '夕やけこやけルート（恵比寿・代官山循環）', stops: ['渋谷駅東口', '渋谷区役所', '恵比寿駅前', '代官山駅前', '渋谷駅東口'] },
      { name: '丘を越えてルート（上原・富ヶ谷）', stops: ['渋谷駅東口', '代々木上原駅前', '渋谷駅東口'] },
      { name: '神宮の杜ルート（神宮前・千駄ヶ谷）', stops: ['渋谷駅東口', '原宿駅前', '表参道駅前', '千駄ヶ谷駅前', '渋谷駅東口'] },
      { name: '春の小川ルート（本町・笹塚循環）', stops: ['渋谷区役所', '笹塚駅前', '渋谷区役所'] }
    ],
    stations: {
      '渋谷': '渋谷駅東口', '恵比寿': '恵比寿駅前', '代官山': '代官山駅前', '代々木上原': '代々木上原駅前',
      '原宿': '原宿駅前', '表参道': '表参道駅前', '千駄ヶ谷': '千駄ヶ谷駅前', '笹塚': '笹塚駅前'
    }
  },
  {
    bus: 'ムーバス', municipality: '武蔵野市',
    url: 'https://www.city.musashino.lg.jp/kurashi_tetsuzuki/bus_churin_chusha_kotsuanzen/mubus/index.html',
    routes: [
      { name: '吉祥寺東循環（1号路線）', stops: ['吉祥寺駅北口', '武蔵野市役所', '吉祥寺駅北口'] },
      { name: '三鷹・吉祥寺循環（6号路線）', stops: ['三鷹駅北口', '吉祥寺駅北口', '三鷹駅北口'] },
      { name: '境・三鷹循環（7号路線）', stops: ['武蔵境駅北口', '三鷹駅北口', '武蔵境駅北口'] }
    ],
    stations: {
      '吉祥寺': '吉祥寺駅北口', '三鷹': '三鷹駅北口', '武蔵境': '武蔵境駅北口'
    }
  },
  {
    bus: 'はなバス', municipality: '西東京市',
    url: 'https://www.city.nishitokyo.lg.jp/kurasi/kotu/hanabus/index.html',
    routes: [
      { name: '第1ルート', stops: ['田無駅', 'ひばりヶ丘駅', '田無駅'] },
      { name: '第2ルート', stops: ['田無駅', '保谷駅', '田無駅'] },
      { name: '第3ルート', stops: ['田無駅', '東伏見駅', '田無駅'] },
      { name: '第4北ルート', stops: ['花小金井駅', '田無駅', '花小金井駅'] },
      { name: '第4南ルート', stops: ['花小金井駅', '田無駅', '花小金井駅'] }
    ],
    stations: {
      '田無': '田無駅', 'ひばりヶ丘': 'ひばりヶ丘駅', '保谷': '保谷駅', '東伏見': '東伏見駅', '花小金井': '花小金井駅'
    }
  },
  {
    bus: 'すぎ丸', municipality: '杉並区',
    url: 'https://www.city.suginami.tokyo.jp/guide/machi/bus/index.html',
    routes: [
      { name: '荻窪線', stops: ['荻窪駅南口', '荻窪駅北口'] },
      { name: '西荻線', stops: ['西荻窪駅北口', '西荻窪駅南口'] },
      { name: '高円寺線', stops: ['高円寺駅北口', '高円寺駅南口'] },
      { name: '阿佐谷線', stops: ['阿佐ヶ谷駅北口', '阿佐ヶ谷駅南口'] },
      { name: '堀ノ内線', stops: ['方南町駅', '堀ノ内三丁目'] }
    ],
    stations: {
      '荻窪': '荻窪駅南口', '西荻窪': '西荻窪駅北口', '高円寺': '高円寺駅北口', '阿佐ヶ谷': '阿佐ヶ谷駅北口'
    }
  },
  {
    bus: 'くるりんバス', municipality: '立川市',
    url: 'https://www.city.tachikawa.lg.jp/kurashi/kotsu/shiminbus/index.html',
    routes: [
      { name: '北ルート', stops: ['立川駅北口', '立川市役所', '立川駅北口'] },
      { name: '南ルート', stops: ['立川駅南口', '柴崎町三丁目', '立川駅南口'] }
    ],
    stations: { '立川': '立川駅北口' }
  },
  {
    bus: 'ちゅうバス', municipality: '府中市',
    url: 'https://www.city.fuchu.tokyo.jp/kurashi/machi/chubus/index.html',
    routes: [
      { name: '南町ルート', stops: ['府中駅', '府中本町駅', '府中駅'] },
      { name: '住吉町ルート', stops: ['府中駅', '府中競馬正門前駅', '府中駅'] },
      { name: '是政ルート', stops: ['府中駅', '是政', '府中駅'] }
    ],
    stations: { '府中本町': '府中本町駅' }
  },
  {
    bus: 'Bーぐる', municipality: '文京区',
    url: 'https://www.city.bunkyo.lg.jp/b011/p001057/index.html',
    routes: [
      { name: '千駄木・駒込ルート', stops: ['千駄木駅前', '駒込駅前', '千駄木駅前'] },
      { name: '本郷・小日向ルート', stops: ['本郷三丁目駅前', '後楽園駅前', '本郷三丁目駅前'] },
      { name: '目白台・小日向ルート', stops: ['江戸川橋駅前', '護国寺駅前', '江戸川橋駅前'] }
    ],
    stations: {
      '千駄木': '千駄木駅前', '駒込': '駒込駅前', '本郷三丁目': '本郷三丁目駅前',
      '後楽園': '後楽園駅前', '江戸川橋': '江戸川橋駅前', '護国寺': '護国寺駅前'
    }
  },
  {
    bus: '江戸バス', municipality: '中央区',
    url: 'https://www.city.chuo.lg.jp/kurasi/edobasu/index.html',
    routes: [
      { name: '北循環', stops: ['日本橋駅前', '東京駅八重洲口', '銀座駅前', '日本橋駅前'] },
      { name: '南循環', stops: ['銀座駅前', '築地駅前', '八丁堀駅前', '銀座駅前'] }
    ],
    stations: {
      '日本橋': '日本橋駅前', '銀座': '銀座駅前', '築地': '築地駅前', '八丁堀': '八丁堀駅前', '京橋': '京橋駅前'
    }
  },
  {
    bus: 'めぐりん', municipality: '台東区',
    url: 'https://www.city.taito.lg.jp/index/kurashi/kotsu/megurin/index.html',
    // 公式路線図(JORUDAN/台東区)に基づく5路線。いずれも一方向循環。
    // かっぱ橋道具街（合羽橋）最寄りは「南めぐりん」の松が谷（24番）。
    routes: [
      // 北めぐりん（浅草回り）：浅草駅→隅田公園→吉原大門→…→浅草四丁目→浅草寺北→二天門→浅草松屋西→浅草駅
      { name: '北めぐりん（浅草回り）', stops: [
        '浅草駅前', '花川戸', '隅田公園', 'リバーサイドスポーツセンター前', '今戸一丁目', '今戸二丁目',
        '橋場老人福祉館西', '橋場一丁目', '清川一丁目', '東浅草二丁目', '吉原大門', '竜泉三丁目',
        '三ノ輪二丁目', '三ノ輪駅前', '一葉記念館入口', '千束三丁目', '台東病院', '千束小学校前',
        '浅草五丁目', '浅草警察署前', '浅草四丁目', '浅草寺北', '二天門', '浅草松屋西', '浅草駅前'
      ] },
      // 北めぐりん（根岸回り）：浅草駅→入谷→鶯谷→根岸→三ノ輪→浅草
      { name: '北めぐりん（根岸回り）', stops: [
        '浅草駅前', '入谷鬼子母神前', '下谷二丁目', '鶯谷駅南', '松が谷（かっぱ橋道具街）', '根岸三丁目', '上野駅入谷口',
        '台東区役所', '下谷神社', '入谷駅入口', '千束三丁目', '台東病院', '浅草五丁目',
        '浅草警察署前', '浅草四丁目', '浅草寺北', '二天門', '浅草松屋西', '浅草駅前'
      ] },
      // 南めぐりん：上野駅→田原町駅→浅草菊水通り→西浅草→台東区役所→松が谷→…（かっぱ橋道具街最寄り=松が谷）
      { name: '南めぐりん', stops: [
        '上野駅', '永寿総合病院', '御徒町', '新御徒町駅', '台東三丁目', '台東地区センター',
        '三井記念病院前', '柳北スポーツプラザ', '浅草橋駅北', '柳橋中央通り', '柳橋分院入口',
        '鳥越神社前', '環境ふれあい館ひまわり入口', '三筋老人福祉館東', '南部区民事務所',
        '大江戸線蔵前駅', '田原町駅前', '浅草菊水通り', '西浅草', '菊屋橋', '台東区役所',
        '上野学園', '北上野二丁目', '松が谷（かっぱ橋道具街）', '生涯学習センター南', '生涯学習センター北',
        '千束二丁目', '千束三丁目', '台東病院', '大正小学校前', '入谷地区センター',
        '入谷南公園', '北上野', '上野学園', '台東保健所', '台東区役所', '上野駅'
      ] },
      // 東西めぐりん
      { name: '東西めぐりん', stops: ['上野駅入谷口', '浅草駅前', '上野駅入谷口'] },
      // ぐるーりめぐりん
      { name: 'ぐるーりめぐりん', stops: ['浅草駅前', '田原町駅前', '浅草駅前'] }
    ],
    stations: {
      '上野': '上野駅入谷口', '浅草': '浅草駅前', '田原町': '田原町駅前', '三ノ輪': '三ノ輪駅前',
      '入谷': '入谷鬼子母神前', '鶯谷': '鶯谷駅南', '新御徒町': '新御徒町駅', '蔵前': '大江戸線蔵前駅',
      '浅草橋': '浅草橋駅北', '御徒町': '御徒町', '松が谷': '松が谷'
    }
  },
  // #25: あきる野市 るのバス（4ルート・Wikipedia/市公式サイトの停車順）
  {
    bus: 'るのバス', municipality: 'あきる野市',
    url: 'https://www.city.akiruno.tokyo.jp/0000018419.html',
    routes: [
      { name: '秋川駅-武蔵五日市方面', stops: ['秋川駅', '秋川キララホール入口', '日の出福祉園前', '阿伎留医療センター', '武蔵引田駅入口', '山田', '武蔵増戸駅', '五日市ファインプラザ', '伊奈新宿', '小和田グランド前', '上町', '五日市出張所', '五日市', '武蔵五日市駅'] },
      { name: '草花方面', stops: ['秋川駅', 'あきる野市役所', '菅瀬橋', '若宮', '小宮久保上', '松山橋', '草花台パークハイツ', '花ノ岡陸橋', '秋川ふれあいセンター', 'あきる野市役所', '秋川駅'] },
      { name: '引田方面', stops: ['秋川駅', '秋川キララホール入口', '日の出福祉園前', '阿伎留医療センター', '武蔵引田駅入口', '渕上', '代継', '秋川駅'] },
      { name: '小川方面', stops: ['秋川駅', '雨間', 'いきいきセンター', '雨間', '野辺郵便局', '野辺南', '小川', '睦橋', '小川', '野辺南', '二宮神社', '東秋留駅上', 'ファーマーズセンター', 'あきる野市役所', '秋川駅'] }
    ],
    stations: {
      '秋川': '秋川駅', '武蔵増戸': '武蔵増戸駅', '武蔵引田': '武蔵引田駅入口',
      '武蔵五日市': '武蔵五日市駅', '東秋留': '東秋留駅上'
    }
  },
  // #25: 足立区 はるかぜ（代表ルート: 1号・9号・12号）
  {
    bus: 'はるかぜ', municipality: '足立区',
    url: 'https://www.city.adachi.tokyo.jp/machi/tetsudo/harukaze/index.html',
    routes: [
      { name: '1号（西新井・綾瀬線）', stops: ['西新井駅東口', '栗島住区センター', '栗島中学校前', '足立四丁目', '青井ふれあい公園', '青井駅', '綾瀬駅'] },
      { name: '9号（青井・亀有線）', stops: ['青井駅', '足立四丁目', '栗島小学校入口', '都立足立高校前', '金町駅南口', '金町駅'] },
      { name: '12号（西新井・亀有線）', stops: ['西新井駅東口', '梅島二丁目', '青井駅', '金町駅南口', '金町駅'] }
    ],
    stations: {
      '西新井': '西新井駅東口', '綾瀬': '綾瀬駅', '青井': '青井駅', '金町': '金町駅南口'
    }
  },
  // #25: 荒川区 さくら（左回り・右回り循環。汐入さくらは2025-03-31運行終了のため未収録）
  {
    bus: 'さくら', municipality: '荒川区',
    url: 'https://www.city.arakawa.tokyo.jp/a040/koutsuu-bus/komyuniteibasu/sakura.html',
    routes: [
      { name: 'さくら左回り（南千01）', stops: ['南千住駅西口', '南千住図書館・荒川ふるさと文化館', '京成町屋駅', '町屋駅前', '荒川区役所前', '荒川総合スポーツセンター', '荒川中央通り', '南千住駅西口'] },
      { name: 'さくら右回り（南千02）', stops: ['南千住駅西口', '荒川総合スポーツセンター', '荒川区役所前', '町屋駅前', '京成町屋駅', '南千住図書館・荒川ふるさと文化館', '南千住駅西口'] }
    ],
    stations: {
      '南千住': '南千住駅西口', '町屋': '町屋駅前', '京成町屋': '京成町屋駅'
    }
  },
  // #25: 練馬区 みどりバス（保谷/北町/氷川台/大泉・主要ルート）
  {
    bus: 'みどりバス', municipality: '練馬区',
    url: 'https://www.city.nerima.tokyo.jp/kurashi/sumai/bus/index.html',
    routes: [
      { name: '保谷ルート', stops: ['保谷駅北口', '南町二丁目', '南田中一丁目', '光が丘駅', '練馬光が丘病院'] },
      { name: '北町ルート', stops: ['練馬光が丘病院', '東武練馬駅入口', '北町三丁目', '練馬光が丘病院'] },
      { name: '氷川台ルート', stops: ['氷川台駅', '氷川台四丁目', '練馬区役所', '桜台駅'] },
      { name: '大泉ルート', stops: ['大泉学園駅北口', '大泉町四丁目', '長久保', '石神井公園駅北口'] }
    ],
    stations: {
      '保谷': '保谷駅北口', '光が丘': '光が丘駅', '東武練馬': '東武練馬駅入口',
      '氷川台': '氷川台駅', '桜台': '桜台駅', '大泉学園': '大泉学園駅北口',
      '石神井公園': '石神井公園駅北口'
    }
  },
  // #25: 北区 Kバス（王子・駒込/田端循環/浮間ルート）
  {
    bus: 'Kバス', municipality: '北区',
    url: 'https://www.city.kita.lg.jp/living/transport/1002525/1002526.html',
    routes: [
      { name: '王子・駒込ルート', stops: ['王子駅', '北区役所', '飛鳥山公園', '滝野川会館', '駒込駅', '王子駅'] },
      { name: '田端循環ルート', stops: ['田端駅', '田端銀座', '赤土小学校前', '田端駅'] },
      { name: '浮間ルート', stops: ['赤羽駅', '東京北医療センター', '北赤羽駅浮間口', '浮間舟渡駅', '赤羽駅'] }
    ],
    stations: {
      '王子': '王子駅', '駒込': '駒込駅', '田端': '田端駅', '赤羽': '赤羽駅',
      '北赤羽': '北赤羽駅浮間口', '浮間舟渡': '浮間舟渡駅'
    }
  },
  // #25: 三鷹市 みたかシティバス（北野/三鷹台/明星学園/ジブリ美術館循環）
  {
    bus: 'みたかシティバス', municipality: '三鷹市',
    url: 'https://www.city.mitaka.lg.jp/c_service/000/000756.html',
    routes: [
      { name: '北野ルート', stops: ['三鷹駅南口', '三鷹市役所前', '北野', '北野三丁目'] },
      { name: '三鷹台ルート', stops: ['三鷹駅南口', '三鷹台駅', '井の頭公園', '三鷹駅南口'] },
      { name: '明星学園ルート', stops: ['三鷹駅北口', '明星学園前', '三鷹駅北口'] },
      { name: '三鷹の森ジブリ美術館循環', stops: ['三鷹駅南口', '三鷹の森ジブリ美術館', '三鷹駅南口'] }
    ],
    stations: {
      '三鷹': '三鷹駅南口', '三鷹台': '三鷹台駅'
    }
  },
  // #25: 八王子市 はちバス（北部/西部/東部/西南部コース）
  {
    bus: 'はちバス', municipality: '八王子市',
    url: 'https://www.city.hachioji.tokyo.jp/kurashi/life/001/002/index.html',
    routes: [
      { name: '北部コース', stops: ['西八王子駅', '八王子市役所', '東海大学八王子病院'] },
      { name: '西部コース', stops: ['北の根東', '楢原町', '松枝住宅', '西八王子駅'] },
      { name: '東部コース', stops: ['JR片倉駅', '日生団地'] },
      { name: '西南部コース', stops: ['松子舞団地', '高尾駅南口'] }
    ],
    stations: {
      '西八王子': '西八王子駅', '片倉': 'JR片倉駅', '高尾': '高尾駅南口'
    }
  },
  // #25: 世田谷区 せたがやくるりん（祖師谷・成城地域循環）
  {
    bus: 'せたがやくるりん', municipality: '世田谷区',
    url: 'https://www.city.setagaya.lg.jp/01206/4533.html',
    routes: [
      { name: '祖師谷・成城地域循環（外回り）', stops: ['祖師ヶ谷大蔵駅', '祖師谷商店街', '成城学園前駅', '砧総合支所', '祖師ヶ谷大蔵駅'] },
      { name: '祖師谷・成城地域循環（内回り）', stops: ['祖師ヶ谷大蔵駅', '砧総合支所', '成城学園前駅', '祖師谷商店街', '祖師ヶ谷大蔵駅'] }
    ],
    stations: {
      '祖師ヶ谷大蔵': '祖師ヶ谷大蔵駅', '成城学園前': '成城学園前駅'
    }
  },
  // #25: 新宿区 新宿WEバス（新宿駅西口起点の循環・観光路線）
  {
    bus: '新宿WEバス', municipality: '新宿区',
    url: 'https://www.city.shinjuku.lg.jp/seikatsu/kotsu01_000001_00022.html',
    routes: [
      { name: '新宿御苑ルート', stops: ['新宿駅西口', '新宿センタービル', '新宿御苑', '新宿三丁目', '新宿駅西口'] },
      { name: '歌舞伎町ルート', stops: ['新宿駅西口', '歌舞伎町', '新宿駅西口'] }
    ],
    stations: {
      '新宿': '新宿駅西口', '新宿三丁目': '新宿三丁目'
    }
  },
  // #25: 墨田区 すみまるくん（北西部/北東部/南部ルート・押上駅で結節）
  {
    bus: 'すみまるくん', municipality: '墨田区',
    url: 'https://www.city.sumida.lg.jp/kurashi/jyunkanbus/index.html',
    routes: [
      { name: '北西部ルート', stops: ['押上駅', '東あずま', '鐘ヶ淵駅', '京成曳舟駅', '押上駅'] },
      { name: '北東部ルート', stops: ['押上駅', '八広', '東向島駅', '京成曳舟駅', '押上駅'] },
      { name: '南部ルート', stops: ['押上駅', '錦糸町駅前', '東京スカイツリー', '押上駅'] }
    ],
    stations: {
      '押上': '押上駅', '鐘ヶ淵': '鐘ヶ淵駅', '京成曳舟': '京成曳舟駅',
      '東向島': '東向島駅', '錦糸町': '錦糸町駅前', 'とうきょうスカイツリー': '東京スカイツリー'
    }
  },
  // #25: 江東区 しおかぜ（木場/豊洲/辰巳ルート・潮見駅前起点）
  {
    bus: 'しおかぜ', municipality: '江東区',
    url: 'https://www.city.koto.lg.jp/470801/kurashi/kotsu/kokyo/13116.html',
    routes: [
      { name: '木場ルート', stops: ['潮見駅前', '枝川二丁目', '木場一丁目', '木場駅', '潮見駅前'] },
      { name: '豊洲ルート', stops: ['潮見駅前', '豊洲駅前', '昭和大学江東豊洲病院前', '潮見駅前'] },
      { name: '辰巳ルート', stops: ['潮見駅前', '辰巳駅', '潮見駅前'] }
    ],
    stations: {
      '潮見': '潮見駅前', '木場': '木場駅', '豊洲': '豊洲駅前', '辰巳': '辰巳駅'
    }
  },
  // #25: 板橋区 りんりんGO（高島平地区循環・時計/反時計回り）
  {
    bus: 'りんりんGO', municipality: '板橋区',
    url: 'https://www.city.itabashi.tokyo.jp/bunka/kanko/1006732.html',
    routes: [
      { name: 'りんりんGO（反時計回り）', stops: ['板橋市場', '新高島平駅', '高島平三丁目', '大門竹の子公園', '区立徳丸小学校', '板橋市場'] },
      { name: 'りんりんGO（時計回り）', stops: ['板橋市場', '徳丸五丁目', '高島平駅', '新高島平駅', '板橋市場'] }
    ],
    stations: {
      '新高島平': '新高島平駅', '高島平': '高島平駅'
    }
  },
  // #25: 国分寺市 ぶんバス（本多/東元町/西町/日吉町/戸倉・主要ルート）
  {
    bus: 'ぶんバス', municipality: '国分寺市',
    url: 'https://www.city.kokubunji.tokyo.jp/kurashi/koutsuu/bus/',
    routes: [
      { name: '本多ルート', stops: ['国分寺駅北口', '本町二丁目西', '早稲田実業学校', '本多一丁目', '国分寺駅北口'] },
      { name: '東元町ルート', stops: ['国分寺駅南口', '東元町三丁目', '新町三丁目', '国分寺駅南口'] },
      { name: '西町ルート', stops: ['国分寺駅北口', '西町', '国分寺駅北口'] },
      { name: '日吉町ルート', stops: ['国分寺駅南口', '日吉町', '国分寺駅南口'] }
    ],
    stations: {
      '国分寺': '国分寺駅北口'
    }
  },
  // #25: 狛江市 こまバス（北回り/南回り・狛江駅北口起点の8の字循環）
  {
    bus: 'こまバス', municipality: '狛江市',
    url: 'https://www.city.komae.tokyo.jp/index.cfm/41,23028,312,html',
    routes: [
      { name: '北回り', stops: ['狛江駅北口', '泉竜寺', '中和泉', '児童公園', '狛江駅北口'] },
      { name: '南回り', stops: ['狛江駅北口', '泉竜寺', '元和泉市民テニスコート', '和泉多摩川駅', '狛江駅北口'] }
    ],
    stations: {
      '狛江': '狛江駅北口', '和泉多摩川': '和泉多摩川駅'
    }
  },
  // #25: 小平市 にじバス（大沼/栄町/鈴木町/花小金井ルート）
  {
    bus: 'にじバス', municipality: '小平市',
    url: 'https://www.city.kodaira.tokyo.jp/kurashi/000/000137.html',
    routes: [
      { name: '大沼ルート', stops: ['小平駅南口', '小平市役所', '一橋学園駅', '小平駅南口'] },
      { name: '栄町ルート', stops: ['小平駅南口', 'なかまちテラス', '新小平駅', '栄町', '小平駅南口'] },
      { name: '鈴木町ルート', stops: ['花小金井駅南口', '鈴木町', '小平駅南口'] }
    ],
    stations: {
      '小平': '小平駅南口', '一橋学園': '一橋学園駅', '新小平': '新小平駅', '花小金井': '花小金井駅南口'
    }
  },
  // #25: 国立市 くにっこ（北/北西中ルート・国立駅北口起点）
  {
    bus: 'くにっこ', municipality: '国立市',
    url: 'https://www.city.kunitachi.tokyo.jp/soshiki/Dept06/Div02/Sec06/gyomu/0505/0508/0509/community_bus/1461059935635.html',
    routes: [
      { name: '北ルート', stops: ['国立駅北口', '北第一小学校', '国立市役所', '国立駅北口'] },
      { name: '北西中ルート', stops: ['国立駅南口', '国立公民館', '国立学園', '谷保駅西', 'くにたち福祉会館', '国立駅南口'] }
    ],
    stations: {
      '国立': '国立駅北口', '谷保': '谷保駅西'
    }
  },
  // #25: 清瀬市 きよバス（緑蔭通り/志木街道経由・清瀬駅〜秋津駅）
  {
    bus: 'きよバス', municipality: '清瀬市',
    url: 'https://www.city.kiyose.lg.jp/kurashi/sumaidourokoutuu/communitybus/1003943.html',
    routes: [
      { name: '緑蔭通り経由', stops: ['清瀬駅北口', 'けやきホール', '清瀬郵便局', '清瀬駅南口'] },
      { name: '志木街道経由', stops: ['清瀬駅北口', '秋津駅', '清瀬駅南口'] }
    ],
    stations: {
      '清瀬': '清瀬駅北口', '秋津': '秋津駅'
    }
  },
  // #25: 大田区 たまちゃんバス（矢口・下丸子地域循環）
  {
    bus: 'たまちゃんバス', municipality: '大田区',
    url: 'https://www.city.ota.tokyo.jp/seikatsu/sumaimachinami/koutsu/communitybusdounyu/communitybus_shikou.html',
    routes: [
      { name: '矢口・下丸子循環（外回り）', stops: ['武蔵新田駅', '下丸子駅入口', 'キヤノン本社通用門前', '矢口中学校', '武蔵新田駅'] },
      { name: '矢口・下丸子循環（内回り）', stops: ['武蔵新田駅', '矢口中学校', 'キヤノン本社通用門前', '下丸子駅入口', '武蔵新田駅'] }
    ],
    stations: {
      '武蔵新田': '武蔵新田駅', '下丸子': '下丸子駅入口'
    }
  },
  // #25: 稲城市 ｉバス（A/B/C/Dコース）
  {
    bus: 'ｉバス', municipality: '稲城市',
    url: 'https://www.city.inagi.tokyo.jp/kurashi/koutsuu/1002846/1002848/1002850.html',
    routes: [
      { name: 'Aコース（南多摩駅⇔メモリアルパーク）', stops: ['南多摩駅', '稲城市役所', '稲城駅', '稲城・府中メモリアルパーク'] },
      { name: 'Bコース（はるひ野駅⇔南多摩駅）', stops: ['はるひ野駅', '若葉台駅', '南多摩駅'] },
      { name: 'Cコース（南多摩駅・よみうりランド路線）', stops: ['稲城長沼駅', '京王よみうりランド駅入口', '南多摩駅'] }
    ],
    stations: {
      '南多摩': '南多摩駅', '稲城長沼': '稲城長沼駅', 'はるひ野': 'はるひ野駅',
      '若葉台': '若葉台駅', '矢野口': '矢野口駅', '稲城': '稲城駅'
    }
  },
  // #25: 多摩市ミニバス（南北線 桜ヶ丘・和田/愛宕ルート・東西循環）
  {
    bus: '多摩市ミニバス', municipality: '多摩市',
    url: 'https://www.city.tama.lg.jp/kurashi/bus/minibus/1002467.html',
    routes: [
      { name: '南北線 桜ヶ丘・和田ルート', stops: ['多摩センター駅', '豊ヶ丘四丁目', '桜ヶ丘', '和田', '多摩センター駅'] },
      { name: '南北線 愛宕ルート', stops: ['永山駅', '愛宕', '多摩センター駅'] },
      { name: '東西循環（永山駅-唐木田駅）', stops: ['永山駅', '豊ヶ丘四丁目', '唐木田駅'] }
    ],
    stations: {
      '多摩センター': '多摩センター駅', '永山': '永山駅', '唐木田': '唐木田駅'
    }
  },
  // #25: 調布市ミニバス（西/北路線）
  {
    bus: '調布市ミニバス', municipality: '調布市',
    url: 'https://www.city.chofu.lg.jp/080070/p050018.html',
    routes: [
      { name: '西路線', stops: ['調布駅南口', '多摩川', '上石原', '飛田給駅南口'] },
      { name: '北路線（調37）', stops: ['調布駅北口', '布田一丁目', '深大寺東町', 'ブランチ調布'] }
    ],
    stations: {
      '調布': '調布駅南口', '飛田給': '飛田給駅南口'
    }
  },
  // #25: 東村山市 グリーンバス（東村山駅東口〜多摩北部医療センター/久米川町循環/西口〜久米川駅南口）
  {
    bus: 'グリーンバス', municipality: '東村山市',
    url: 'https://www.city.higashimurayama.tokyo.jp/kurashi/sumai/bus/index.html',
    routes: [
      { name: '東村山駅東口〜多摩北部医療センター', stops: ['東村山駅東口', '多摩北部医療センター', '新秋津駅'] },
      { name: '久米川町循環', stops: ['東村山駅東口', '久米川町', '南秋津', '東村山駅東口'] },
      { name: '東村山駅西口〜富士見町四丁目〜久米川駅南口', stops: ['東村山駅西口', '富士見町四丁目', '久米川駅南口'] }
    ],
    stations: {
      '東村山': '東村山駅東口', '久米川': '久米川駅南口', '新秋津': '新秋津駅'
    }
  },
  // #25: 町田市 まちっこ（相原/公共施設巡回ルート）
  {
    bus: 'まちっこ', municipality: '町田市',
    url: 'https://www.city.machida.tokyo.jp/kurashi/sumai/kotsu/shimin/bus/index.html',
    routes: [
      { name: '公共施設巡回ルート', stops: ['町田バスセンター', '町田市役所市民ホール前', '第四小学校前', '中町二丁目', '町田バスセンター'] },
      { name: '相原ルート', stops: ['町田バスセンター', '相原', '町田バスセンター'] }
    ],
    stations: {
      '町田': '町田バスセンター'
    }
  },
  // #25: 昭島市 Aバス（北/西/東ルート・昭島駅南口起点）
  {
    bus: 'Aバス', municipality: '昭島市',
    url: 'https://www.city.akishima.lg.jp/kurashi/bus/1002242/1002244.html',
    routes: [
      { name: '北ルート', stops: ['昭島駅南口', '昭島駅南口商店街', '保健福祉センター', 'アキシマエンシス', '昭島駅南口'] },
      { name: '西ルート', stops: ['昭島駅南口', '昭和町', '西武立川駅南口', '昭島駅南口'] },
      { name: '東ルート', stops: ['昭島駅南口', '昭島団地', '中神駅北口', '昭島駅南口'] }
    ],
    stations: {
      '昭島': '昭島駅南口', '中神': '中神駅北口', '西武立川': '西武立川駅南口'
    }
  },
  // #25: 日野市ミニバス（市内路線S・高幡不動駅〜豊田駅北口）
  {
    bus: '日野市ミニバス', municipality: '日野市',
    url: 'https://www.city.hino.lg.jp/kurashi/kotsu/bus/minibus/index.html',
    routes: [
      { name: '市内路線S', stops: ['高幡不動駅', '日野市役所', '市立病院入口', '豊田駅北口'] }
    ],
    stations: {
      '高幡不動': '高幡不動駅', '豊田': '豊田駅北口'
    }
  },
  // #25: 東大和市 ちょこバス（循環/往復ルート・上北台駅起点）
  {
    bus: 'ちょこバス', municipality: '東大和市',
    url: 'https://www.city.higashiyamato.lg.jp/kurashi/dorokotsu/1002085/1002091.html',
    routes: [
      { name: '循環ルート（外回り）', stops: ['上北台駅', '芝中団地中央', '奈良橋市民センター', '東大和市駅', '上北台駅'] },
      { name: '往復ルート', stops: ['東大和市役所', '南街', '東大和市役所'] }
    ],
    stations: {
      '上北台': '上北台駅', '東大和市': '東大和市駅'
    }
  },
  // #25: 武蔵村山市 MMシャトル（上北台/玉川上水ルート）
  {
    bus: 'MMシャトル', municipality: '武蔵村山市',
    url: 'https://www.city.musashimurayama.lg.jp/kurashi/koutsu/koukyoukoutu/1000603/',
    routes: [
      { name: '上北台ルート', stops: ['上北台駅', '武蔵村山市役所前', '三ツ木地区会館', '村山温泉かたくりの湯', '上北台駅'] },
      { name: '玉川上水ルート', stops: ['玉川上水駅', 'イオンモール', '武蔵村山市役所', '玉川上水駅'] }
    ],
    stations: {
      '上北台': '上北台駅', '玉川上水': '玉川上水駅'
    }
  },
  // #25: 羽村市 はむらん（循環ルート・羽村駅西口/東口）
  {
    bus: 'はむらん', municipality: '羽村市',
    url: 'https://www.city.hamura.tokyo.jp/category/1-11-15-0-0.html',
    routes: [
      { name: '西循環ルート', stops: ['羽村駅西口', '羽村市役所', '羽村駅西口'] },
      { name: '東循環ルート', stops: ['羽村駅東口', '羽村市役所', '羽村駅東口'] }
    ],
    stations: {
      '羽村': '羽村駅西口'
    }
  },
  // #25: 檜原村 やまびこ（村内循環）
  {
    bus: 'やまびこ', municipality: '檜原村',
    url: 'https://www.vill.hinohara.tokyo.jp/0000000090.html',
    routes: [
      { name: '村内循環ルート', stops: ['本宿', '藤倉', '神戸', '本宿'] }
    ],
    stations: {}
  },
  // #25: 豊島区 池07系統（池袋駅東口〜サンシャインシティ・都営バス）
  {
    bus: '池07系統', municipality: '豊島区',
    url: 'https://www.city.toshima.lg.jp/298/machizukuri/kotsu/bus/1504221057.html',
    routes: [
      { name: '池袋駅東口〜サンシャインシティ', stops: ['池袋駅東口', 'サンシャインシティ', '池袋駅東口'] }
    ],
    stations: {
      '池袋': '池袋駅東口'
    }
  },
  // #25: 小金井市 CoCoバス（北東部/南東部/貫井前原循環）
  {
    bus: 'CoCoバス', municipality: '小金井市',
    url: 'https://www.city.koganei.lg.jp/kurashi/482/buss/cocobus.html',
    routes: [
      { name: '北東部循環', stops: ['武蔵小金井駅北口', '小金井公園入口', 'たてもの園入口', '小金井市役所入口', '武蔵小金井駅北口'] },
      { name: '貫井前原循環', stops: ['武蔵小金井駅', '小金井第二庁舎', '小金井市役所', '前原小学校前', '貫井南', '武蔵小金井駅'] }
    ],
    stations: {
      '武蔵小金井': '武蔵小金井駅北口'
    }
  }
];

export const COMMUNITY_BUS_STATION_ACCESS = {};
for (const cb of COMMUNITY_BUS_ROUTES) {
  for (const [station, stop] of Object.entries(cb.stations)) {
    if (!COMMUNITY_BUS_STATION_ACCESS[station]) COMMUNITY_BUS_STATION_ACCESS[station] = [];
    COMMUNITY_BUS_STATION_ACCESS[station].push({ bus: cb.bus, municipality: cb.municipality, url: cb.url, stop });
  }
}

export const BUS_GTFS_SOURCES = [
  // JRバス関東: 主要ターミナル・系統（ODPT未登録のためハードコード）
  {
    name: 'JRバス関東', operatorId: 'JRBKanto',
    label: 'JRバス関東', labelEn: 'JR Bus Kanto', labelZh: 'JR巴士关东',
    website: 'https://www.jrbuskanto.co.jp/',
    hardCoded: true,
    stops: [
      '東京駅', '新宿駅', '池袋駅', '渋谷駅', '品川駅', '東京ドームシティ',
      '横浜駅', '川崎駅', '立川駅', '八王子駅', '町田駅', '相模原駅',
      '千葉駅', '柏駅', '水戸駅', '宇都宮駅', '高崎駅', '前橋市',
      '河口湖駅', '御殿場駅', '箱根湯本駅', '茨城空港（小美玉）', '成田空港', '羽田空港'
    ],
    // 主要系統（東京～各拠点）。実GTFS未取得のため代表系統のみ。
    routes: [
      ['東京駅', '河口湖駅'], ['新宿駅', '河口湖駅'], ['東京駅', '箱根湯本駅'],
      ['横浜駅', '箱根湯本駅'], ['東京駅', '水戸駅'], ['東京駅', '宇都宮駅'],
      ['東京駅', '高崎駅'], ['東京駅', '千葉駅'], ['東京駅', '成田空港'],
      ['東京駅', '羽田空港'], ['新宿駅', '立川駅'], ['新宿駅', '八王子駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['新宿駅', '横浜駅'], ['新宿駅', '千葉駅'], ['東京駅', '柏駅'],
      ['新宿駅', '御殿場駅'], ['新宿駅', '前橋市'], ['渋谷駅', '河口湖駅'],
      ['池袋駅', '水戸駅'], ['横浜駅', '成田空港'], ['東京駅', '川崎駅'],
      ['新宿駅', '町田駅'], ['東京駅', '相模原駅'], ['新宿駅', '水戸駅']
    ]
  },
  // #24-2: 空港リムジンバス（東京空港交通）— ODPT未登録・空港アクセス非鉄系のためハードコード。
  // 実在の主要系統（羽田・成田→都心主要ターミナル）を収録し、search_bus の「バス優先」で
  // 空港→都心が引けるようにする。時刻は公式サイト参照（stop_times は未収録）。
  {
    name: '空港リムジンバス', operatorId: 'AirportLimousine',
    label: '空港リムジンバス（東京空港交通）', labelEn: 'Airport Limousine Bus (Tokyo Airport Transport)', labelZh: '机场利木津巴士（东京机场交通）',
    website: 'https://www.limousinebus.co.jp/',
    hardCoded: true,
    stops: [
      '羽田空港', '羽田空港第1ターミナル', '羽田空港第2ターミナル', '羽田空港第3ターミナル',
      '成田空港', '成田空港第1ターミナル', '成田空港第2ターミナル', '成田空港第3ターミナル',
      '東京駅', '東京駅八重洲', '新宿駅', '新宿駅西口', '渋谷駅', '池袋駅', '品川駅',
      'お台場', '東京ディズニーリゾート', '横浜駅', '横浜駅東口', 'YCAT', '二子玉川', '吉祥寺駅'
    ],
    // 主要系統（羽田・成田→都心）。実GTFS未取得のため代表系統のみ。
    // 注: リムジンは「新宿駅西口」バスターミナル発着（新宿駅そのものには停車しない）
    routes: [
      ['羽田空港', '新宿駅西口'], ['羽田空港', '渋谷駅'], ['羽田空港', '池袋駅'],
      ['羽田空港', '品川駅'], ['羽田空港', '東京駅'], ['羽田空港', 'お台場'],
      ['羽田空港', '東京ディズニーリゾート'], ['羽田空港', '横浜駅'], ['羽田空港', '二子玉川'],
      ['成田空港', '東京駅'], ['成田空港', '新宿駅西口'], ['成田空港', '渋谷駅'],
      ['成田空港', '池袋駅'], ['成田空港', '品川駅'], ['成田空港', '横浜駅'],
      ['成田空港', '東京ディズニーリゾート'], ['成田空港', '吉祥寺駅']
    ]
  },
  // 京王バス（実GTFSソースへ移行 v2.45.0）— CKAN keio_bus_all_lines 有効期間 2026/8/15〜12/31。
  // 従来のハードコード代表系統から、stops.txt/routes.txt を展開する { url, date } 方式へ移行。
  {
    name: '京王バス', operatorId: 'KeioBus',
    label: '京王バス', labelEn: 'Keio Bus', labelZh: '京王巴士',
    website: 'https://www.keio-bus.com/',
    url: 'https://api.odpt.org/api/v4/files/odpt/KeioBus/AllLines.zip',
    date: () => '20260815',
    useStopsAndRoutes: true
  },
  {
    name: '東急バス', operatorId: 'TokyuBus',
    label: '東急バス', labelEn: 'Tokyu Bus', labelZh: '东急巴士',
    website: 'https://www.tokyubus.co.jp/',
    hardCoded: true,
    stops: [
      '渋谷駅', '目黒駅', '五反田駅', '大井町駅', '蒲田駅', '大岡山駅', '自由が丘駅',
      '二子玉川駅', '高津駅', '溝の口駅', '田園調布駅', '武蔵小杉駅', '日吉駅', '綱島駅',
      '中目黒駅', '恵比寿駅', '品川駅', '大崎駅', '池上駅', '雪が谷大塚駅', '洗足池駅'
    ],
    routes: [
      ['渋谷駅', '大井町駅'], ['渋谷駅', '中目黒駅'], ['渋谷駅', '二子玉川駅'],
      ['目黒駅', '大岡山駅'], ['目黒駅', '武蔵小杉駅'], ['五反田駅', '蒲田駅'],
      ['大井町駅', '蒲田駅'], ['大井町駅', '二子玉川駅'], ['蒲田駅', '池上駅'],
      ['自由が丘駅', '田園調布駅'], ['溝の口駅', '二子玉川駅'], ['綱島駅', '日吉駅'],
      ['渋谷駅', '恵比寿駅'], ['品川駅', '大崎駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['目黒駅', '五反田駅'], ['大井町駅', '五反田駅'], ['自由が丘駅', '二子玉川駅'],
      ['溝の口駅', '高津駅'], ['五反田駅', '大崎駅'], ['渋谷駅', '品川駅'],
      ['武蔵小杉駅', '日吉駅'], ['目黒駅', '中目黒駅']
    ]
  },
  {
    name: '小田急バス', operatorId: 'OdakyuBus',
    label: '小田急バス', labelEn: 'Odakyu Bus', labelZh: '小田急巴士',
    website: 'https://www.odakyubus.co.jp/',
    hardCoded: true,
    stops: [
      '新宿駅西口', '新宿駅', '渋谷駅', '下北沢駅', '経堂駅', '成城学園前駅', '狛江駅',
      '登戸駅', '向ヶ丘遊園駅', '新百合ヶ丘駅', '町田駅', '相模大野駅', '本厚木駅',
      '吉祥寺駅', '三鷹駅', '武蔵境駅', '荻窪駅'
    ],
    routes: [
      ['新宿駅西口', '吉祥寺駅'], ['渋谷駅', '吉祥寺駅'], ['渋谷駅', '狛江駅'],
      ['新宿駅西口', '下北沢駅'], ['経堂駅', '成城学園前駅'], ['成城学園前駅', '狛江駅'],
      ['登戸駅', '向ヶ丘遊園駅'], ['新百合ヶ丘駅', '町田駅'], ['町田駅', '相模大野駅'],
      ['吉祥寺駅', '三鷹駅'], ['荻窪駅', '吉祥寺駅'], ['新宿駅西口', '成城学園前駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['新宿駅西口', '荻窪駅'], ['武蔵境駅', '三鷹駅'], ['吉祥寺駅', '武蔵境駅'],
      ['成城学園前駅', '二子玉川駅'], ['新百合ヶ丘駅', '相模大野駅'], ['町田駅', '本厚木駅'],
      ['経堂駅', '下北沢駅']
    ]
  },
  {
    name: '京成バス', operatorId: 'KeiseiBus',
    label: '京成バス', labelEn: 'Keisei Bus', labelZh: '京成巴士',
    website: 'https://www.keiseibus.co.jp/',
    hardCoded: true,
    stops: [
      '東京駅', '新橋駅', '銀座駅', 'お台場', '錦糸町駅', '船橋駅', '津田沼駅',
      '千葉駅', '京成船橋駅', '松戸駅', '柏駅', '成田駅', '京成成田駅', '市川駅',
      '西船橋駅', '舞浜駅', '新浦安駅'
    ],
    routes: [
      ['東京駅', '千葉駅'], ['東京駅', 'お台場'], ['新橋駅', 'お台場'],
      ['東京駅', '船橋駅'], ['東京駅', '松戸駅'], ['銀座駅', 'お台場'],
      ['船橋駅', '津田沼駅'], ['千葉駅', '成田駅'], ['松戸駅', '柏駅'],
      ['東京駅', '新浦安駅'], ['東京駅', '舞浜駅'], ['市川駅', '西船橋駅'],
      // v2.25.1 #21-A 拡充: 実在主要系統
      ['船橋駅', '西船橋駅'], ['松戸駅', '市川駅'], ['舞浜駅', '新浦安駅'],
      ['千葉駅', '津田沼駅'], ['東京駅', '錦糸町駅'], ['柏駅', '船橋駅']
    ]
  },
  // #45: 千葉・埼玉・神奈川のローカルバス（延伸駅周辺・ODPT未登録のためハードコード）
  // 出典: 各社公式サイトの主要停留所・系統（代表系統のみ・時刻は未収録）
  {
    name: 'ちばフラワーバス（ちばグリーンバス）', operatorId: 'ChibaFlowerBus',
    label: 'ちばフラワーバス（佐倉）', labelEn: 'Chiba Flower Bus (Sakura)', labelZh: '千叶花巴士（佐仓）',
    website: 'https://www.chiba-flowerbus.jp/',
    hardCoded: true,
    stops: [
      '佐倉駅', '京成佐倉駅', '佐倉市役所', '国立歴史民俗博物館', 'ユーカリが丘駅', '臼井駅', '志津駅', '佐倉城址公園入口'
    ],
    routes: [
      ['佐倉駅', '京成佐倉駅'], ['佐倉駅', '国立歴史民俗博物館'], ['京成佐倉駅', '国立歴史民俗博物館'],
      ['ユーカリが丘駅', '佐倉駅'], ['臼井駅', '佐倉駅'], ['志津駅', '佐倉駅']
    ]
  },
  {
    name: 'さいたま市営バス', operatorId: 'SaitamaCityBus',
    label: 'さいたま市営バス', labelEn: 'Saitama City Bus', labelZh: '埼玉市营公交',
    website: 'https://www.city.saitama.lg.jp/003/001/kotsu/',
    hardCoded: true,
    stops: [
      '大宮駅東口', '大宮駅西口', '鉄道博物館', '鉄道博物館南', '大成四丁目', '大宮中央総合病院', '大宮中央総合病院入口', '赤芝'
    ],
    routes: [
      ['大宮駅東口', '鉄道博物館'], ['大宮駅西口', '鉄道博物館'], ['大宮駅東口', '大成四丁目'],
      ['大宮駅東口', '大宮中央総合病院']
    ]
  },
  {
    name: '東武バス（埼玉）', operatorId: 'TobuBusSaitama',
    label: '東武バス（埼玉）', labelEn: 'Tobu Bus (Saitama)', labelZh: '东武巴士（埼玉）',
    website: 'https://www.tobu-bus.com/',
    hardCoded: true,
    stops: [
      '大宮駅東口', '大宮駅西口', '鉄道博物館', '大成', '上尾駅東口', '宮原駅入口', '指扇駅', '西大宮駅'
    ],
    routes: [
      ['大宮駅東口', '上尾駅東口'], ['大宮駅東口', '鉄道博物館'], ['大宮駅西口', '鉄道博物館'],
      ['大宮駅東口', '指扇駅'], ['上尾駅東口', '鉄道博物館']
    ]
  },
  {
    name: '西武観光バス（秩父）', operatorId: 'SeibuKankoBusChichibu',
    label: '西武観光バス（秩父）', labelEn: 'Seibu Kanko Bus (Chichibu)', labelZh: '西武观光巴士（秩父）',
    website: 'https://www.seibubus.co.jp/rosen/chichibu/',
    hardCoded: true,
    stops: [
      '西武秩父駅', '秩父駅', '秩父市役所', '羊山公園', '長瀞駅', '長瀞', '皆野駅', '三峰口駅', '三峯神社', '大滝温泉', '正丸駅'
    ],
    routes: [
      ['西武秩父駅', '秩父駅'], ['西武秩父駅', '長瀞'], ['西武秩父駅', '三峰口駅'],
      ['西武秩父駅', '三峯神社'], ['西武秩父駅', '皆野駅'], ['秩父駅', '長瀞'], ['西武秩父駅', '羊山公園']
    ]
  },
  {
    name: '江ノ電バス', operatorId: 'EnodenBus',
    label: '江ノ電バス', labelEn: 'Enoden Bus', labelZh: '江之电巴士',
    website: 'https://www.enoden.co.jp/bus/',
    hardCoded: true,
    stops: [
      '江ノ島', '江ノ島入口', '湘南海岸公園', '新江ノ島水族館', '湘南港桟橋', '藤沢駅', '鎌倉駅', '大船駅', '長谷駅', '極楽寺駅'
    ],
    routes: [
      ['藤沢駅', '江ノ島'], ['鎌倉駅', '江ノ島'], ['大船駅', '江ノ島'],
      ['藤沢駅', '湘南港桟橋'], ['鎌倉駅', '湘南港桟橋'], ['藤沢駅', '長谷駅']
    ]
  },
  {
    name: '千葉中央バス', operatorId: 'ChibaChuoBus',
    label: '千葉中央バス', labelEn: 'Chiba Chuo Bus', labelZh: '千叶中央巴士',
    website: 'https://www.chibachuobus.co.jp/',
    hardCoded: true,
    stops: [
      '千葉駅', '千葉中央駅', '千葉市役所前', '千城台駅', '千城台車庫', '千城局', '都賀駅', '稲毛駅'
    ],
    routes: [
      ['千葉駅', '千城台駅'], ['千葉駅', '千城台車庫'], ['千葉駅', '千葉市役所前'],
      ['千葉駅', '都賀駅'], ['千葉中央駅', '千城台駅']
    ]
  },
  {
    name: '川越観光自動車（イーグルバス・越生）', operatorId: 'KawagoeKankoOgose',
    label: '川越観光自動車（越生）', labelEn: 'Kawagoe Kanko Bus (Ogose)', labelZh: '川越观光汽车（越生）',
    website: 'https://www.kawagoebus.jp/',
    hardCoded: true,
    stops: [
      '越生駅', '越生駅入口', '越生駅東口', '黒山', 'せせらぎバスセンター', '慈光寺', 'ときがわ町役場'
    ],
    routes: [
      ['越生駅', '黒山'], ['越生駅', 'せせらぎバスセンター'], ['越生駅', '慈光寺'],
      ['越生駅', 'ときがわ町役場']
    ]
  },
  {
    name: '丸建つばさ交通（けんちゃんバス）', operatorId: 'MarukenTsubasa',
    label: '丸建つばさ交通（伊奈・けんちゃんバス）', labelEn: 'Maruken Tsubasa Kotsu (Ina)', labelZh: '丸建翼交通（伊奈）',
    website: 'https://maru-ken.co.jp/route-bus/',
    hardCoded: true,
    stops: [
      '内宿駅', '伊奈学園', 'がんセンター', '戸崎前', '県民活動センター', '伊奈記念公園北', '桂全寺前', 'さくら団地', '小室駅', '伊奈町役場'
    ],
    routes: [
      ['内宿駅', '小室駅'], ['内宿駅', '伊奈学園'], ['内宿駅', 'がんセンター'],
      ['内宿駅', '県民活動センター'], ['内宿駅', '伊奈町役場']
    ]
  },
  // 東京都内コミュニティバス（代表例: 23区＋多摩地域の主要コミュニティバス）
  // communityBuses: tokyobus.or.jp/sp の41自治体ディレクトリ（名称＋公式URL）。検索・一覧表示用。
  {
    name: '東京都コミュニティバス', operatorId: 'TokyoCommunity',
    label: '都内コミュニティバス', labelEn: 'Tokyo Community Bus', labelZh: '东京都社区公交',
    website: 'https://www.tokyobus.or.jp/sp/',
    hardCoded: true,
    communityBuses: TOKYO_COMMUNITY_BUSES,
    stops: [
      '港区役所（ちぃばす）', '新宿駅西口（新宿WEバス）', '渋谷駅（ハチ公バス）',
      '千代田区役所（風ぐるま）', '中央区役所（江戸バス）', '品川駅（すいすい館山）',
      '王子駅（王子・飛鳥山循環）', '立川駅（くるりんバス）', '八王子駅（はちバス）',
      '町田駅（まちっこ）', '府中駅（ちゅうバス）', '調布駅（ぶんバス）',
      '国立駅（くにっこ）', '武蔵野市役所（むーばす）', '三鷹駅（みたかシティバス）',
      // v2.25.1 #21-A 拡充: 主要コミュニティバス停留所
      '中野駅（中野区コミュニティバス）', '杉並区役所（すぎ丸）', '文京区役所（Bーぐる）',
      '台東区役所（めぐりん）', '墨田区役所（すみまるくん）', '江東区役所（しおかぜ）',
      '板橋区役所（りんりんGO）', '練馬区役所（みどりバス）', '世田谷区役所（せたがやくるりん）',
      '西東京市役所（はなバス）', '小平市役所（にじバス）', '国分寺市役所（ぶんバス）',
      '狛江市役所（こまバス）', '清瀬市役所（きよバス）', '稲城市役所（iバス）',
      '多摩センター駅（多摩市ミニバス）', '日野市役所（ちょこバス）', '東大和市役所（ちょこバス）',
      '武蔵村山市役所（MMシャトル）', '羽村市役所（はむらん）', '檜原村（やまびこ）',
      '豊島区役所（池07系統）', '小金井市役所（CoCoバス）', '昭島市役所（Aバス）'
    ],
    routes: [
      ['渋谷駅（ハチ公バス）', '渋谷駅'], ['新宿駅西口（新宿WEバス）', '新宿駅'],
      ['港区役所（ちぃばす）', '六本木駅'], ['立川駅（くるりんバス）', '立川駅'],
      ['八王子駅（はちバス）', '八王子駅'], ['調布駅（ぶんバス）', '調布駅'],
      // v2.25.1 #21-A 拡充: 主要コミュニティバス系統
      ['中野駅（中野区コミュニティバス）', '中野駅'], ['杉並区役所（すぎ丸）', '荻窪駅'],
      ['文京区役所（Bーぐる）', '後楽園駅'], ['台東区役所（めぐりん）', '上野駅'],
      ['墨田区役所（すみまるくん）', '押上駅'], ['江東区役所（しおかぜ）', '門前仲町駅'],
      ['板橋区役所（りんりんGO）', '板橋区役所駅'], ['練馬区役所（みどりバス）', '練馬駅'],
      ['世田谷区役所（せたがやくるりん）', '三軒茶屋駅'], ['西東京市役所（はなバス）', 'ひばりヶ丘駅'],
      ['小平市役所（にじバス）', '小平駅'], ['国分寺市役所（ぶんバス）', '国分寺駅'],
      ['狛江市役所（こまバス）', '狛江駅'], ['清瀬市役所（きよバス）', '清瀬駅'],
      ['稲城市役所（iバス）', '稲城駅'], ['多摩センター駅（多摩市ミニバス）', '多摩センター駅'],
      ['日野市役所（ちょこバス）', '日野駅'], ['東大和市役所（ちょこバス）', '東大和市駅'],
      ['武蔵村山市役所（MMシャトル）', '玉川上水駅'], ['羽村市役所（はむらん）', '羽村駅'],
      ['檜原村（やまびこ）', '武蔵五日市駅'], ['豊島区役所（池07系統）', '池袋駅'],
      ['小金井市役所（CoCoバス）', '武蔵小金井駅'], ['昭島市役所（Aバス）', '昭島駅']
    ]
  },
  // ============================================================
  // v2.38.5: ODPT 静的 GTFS（files/odpt/...・基本ライセンス）の実データソース。
  // CKAN データカタログ（ckan.odpt.org）で基本ライセンス公開が確認できた関東圏バス5社。
  // fetchAllBuses の GTFS 取得パス（フェリーと同じ { url, date } 方式）で展開される。
  // 🔴 date は毎回現在日付ではなく「有効期間内の固定日付」を返す（リソースの有効期間に合わせる）。
  //    有効期間切れ時は CKAN の最新リソース URL に追随して更新する。
  {
    name: '川崎市バス', operatorId: 'KawasakiCityBus',
    label: '川崎市バス', labelEn: 'Kawasaki City Bus', labelZh: '川崎市公交',
    website: 'https://www.city.kawasaki.jp/kurashi/category/19-1-1-1-0-0-0-0-0-0.html',
    url: 'https://api.odpt.org/api/v4/files/odpt/TransportationBureau_CityOfKawasaki/AllLines.zip',
    date: () => '20260801',
    // stops.txt の stop_name を停名レコード、routes.txt の route_short_name を系統レコードとして合成
    useStopsAndRoutes: true
  },
  {
    name: '川崎鶴見臨港バス', operatorId: 'KawasakiTsurumiRinkoBus',
    label: '川崎鶴見臨港バス', labelEn: 'Kawasaki Tsurumi Rinko Bus', labelZh: '川崎鹤见临港公交',
    website: 'https://www.rinkobus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/KawasakiTsurumiRinkoBus/allrinko.zip',
    date: () => '20260716',
    useStopsAndRoutes: true
  },
  {
    name: '関東バス', operatorId: 'KantoBus',
    label: '関東バス', labelEn: 'Kanto Bus', labelZh: '关东公交',
    website: 'https://www.kantobus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/KantoBus/AllLines.zip',
    date: () => '20260701',
    useStopsAndRoutes: true
  },
  {
    name: '西東京バス', operatorId: 'NishiTokyoBus',
    label: '西東京バス', labelEn: 'Nishi Tokyo Bus', labelZh: '西东京公交',
    website: 'https://www.nisitokyobus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/NishiTokyoBus/NTBus.zip',
    date: () => '20260829',
    useStopsAndRoutes: true
  },
  {
    name: '京成バス千葉ウエスト', operatorId: 'KeiseiBusChibaWest',
    label: '京成バス千葉ウエスト', labelEn: 'Keisei Bus Chiba West', labelZh: '京成巴士千叶西',
    website: 'https://www.keiseibus.co.jp/',
    url: 'https://api.odpt.org/api/v4/files/odpt/KeiseiTransitBus/AllLines.zip',
    date: () => '20260401',
    useStopsAndRoutes: true
  },
  // 都営バス GTFS-JP（v2.45.0 追加）— CKAN b_bus_gtfs_jp-toei（CC BY 4.0）。
  // 固定URL（dateパラメータ不可）のため noDate:true。stops.txt/routes.txt を展開。
  // これにより ODPT odpt:Bus で stop-fallback だった都営バス停（上野駅前・上野公園等）も系統を検索可能に。
  {
    name: '都営バス', operatorId: 'Toei',
    label: '都営バス', labelEn: 'Toei Bus', labelZh: '都营公交',
    website: 'https://www.kotsu.metro.tokyo.jp/bus/',
    url: 'https://api.odpt.org/api/v4/files/Toei/data/ToeiBus-GTFS.zip',
    noDate: true,
    useStopsAndRoutes: true
  }
];

export const BUSSTOP_ROMAN_TO_JA = {
  YokohamaStation: '横浜駅', YokohamaShiyakushoMae: '横浜市役所前', SakuragichoStation: '桜木町駅',
  YokohamaStadiumMae: '横浜スタジアム前', KannaiStationKitaguchi: '関内駅北口', ChikatetsuKannaiStation: '地下鉄関内駅',
  ShinYokohamaStation: '新横浜駅', MinatoMirai: 'みなとみらい', Bashamichi: '馬車道', NihonOdoriStationKenchoMae: '日本大通り駅県庁前',
  YokohamaStationWestEntrance: '横浜駅西口', YokohamaStationKaisatsuguchiMae: '横浜駅改札口前',
  KamiookaStation: '上大岡駅', TobeStation: '戸部駅', HinodechoStation: '日ノ出町駅', YamateStation: '山手駅',
  IsogoStation: '磯子駅', IsogoShakoMae: '磯子車庫前', HodogayaStationHigashiguchi: '保土ヶ谷駅東口', HodogayaStationNishiguchi: '保土ヶ谷駅西口',
  KikunaStation: '菊名駅', TsurumiStation: '鶴見駅', TsurumiStationNishiguchi: '鶴見駅西口', ShinKoyasuStation: '新子安駅',
  NakayamaStation: '中山駅', NakamachidaiStation: '中川駅', CenterMinamiStation: 'センター北駅', TsuzukiFureaiNoOkaStation: '都筑ふれあいの丘駅',
  NagatsutaStation: '長津田駅', IchigaoStation: '市が尾駅', EdaStation: '江田駅', HigashiYamataStation: '東山田駅',
  ShinTsunashimaSta: '新綱島', TsunashimaStationIriguchi: '綱島駅入口', OkurayamaStation: '大倉山駅',
  YokodaiStation: '洋光台駅', SugitaTsubonomiChuo: '杉田中央', ShinSugitaStation: '新杉田駅',
  KonandaiStation: '港南台駅', KamiSugetaCho: '上菅田町', OnoeCho: '尾上町', NogeOdori: '野毛大通り',
  Motomachi: '元町', YamashitaCho: '山下町', Honmoku: '本牧', Sankeien: '三溪園', SankeienIriguchi: '三溪園入口',
  Hammerhead: 'ハンマーヘッド', LalaPortYokohamaNishi: 'ららぽーと横浜', MitsuiOutletParkYokohama: '三井アウトレットパーク横浜',
  NegishiStation: '根岸駅', IdogayaStation: '井戸ヶ谷駅', Gumyoji: '弘明寺', Kominato: '小湊',
  Fujidana: '富士見台', YokohamaSatoNoFurusato: '横浜里のふるさと'
};

export const BUS_OPERATOR_LABEL = {};
for (const o of BUS_OPERATORS) {
  BUS_OPERATOR_LABEL[`odpt.Operator:${o.id}`] = o;
}
