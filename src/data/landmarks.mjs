/**
 * ランドマーク・文化施設データ（モノリス分割 Phase 2c）
 * LANDMARK_DEFS / DESTINATION_CULTURAL_FACILITIES / CULTURAL_CATEGORY_NAMES は純データ。
 * LANDMARK_LOOKUP / DERIVED_CULTURAL_FACILITIES は LANDMARK_DEFS から自動構築する。
 * 参照ロジック（getDestinationCulturalFacilities / resolveLandmark）は index.mjs 側。
 */

export const LANDMARK_DEFS = {
  tokyo_disneyland: {
    station: '舞浜', walk_min: 10, category: 'テーマパーク',
    note: { ja: '舞浜駅から徒歩約10分（ディズニーリゾートライン利用可）', en: 'About 10 min walk from Maihama Stn (Disney Resort Line available)', zh: '从舞滨站步行约10分钟（可乘坐迪士尼度假区线）' },
    names: { ja: ['東京ディズニーランド', 'ディズニーランド', 'ディズニーリゾート', 'ディズニー'], en: ['Tokyo Disneyland', 'Disneyland', 'Tokyo Disney Resort', 'Disney', 'TDL'], zh: ['东京迪士尼乐园', '迪士尼乐园', '迪士尼', '东京迪士尼度假区'] }
  },
  tokyo_disneysea: {
    station: '舞浜', walk_min: 10, category: 'テーマパーク',
    note: { ja: '舞浜駅からディズニーリゾートライン「リゾートゲートウェイ・ステーション」乗換', en: 'Transfer at Resort Gateway Stn on the Disney Resort Line from Maihama Stn', zh: '在舞滨站换乘迪士尼度假区线至度假区门户站' },
    names: { ja: ['東京ディズニーシー', 'ディズニーシー'], en: ['Tokyo DisneySea', 'DisneySea'], zh: ['东京迪士尼海洋', '迪士尼海洋'] }
  },
  kappabashi: {
    station: '田原町', walk_min: 15, category: '商店街',
    note: { ja: '田原町駅から徒歩約15分（銀座線田原町・浅草間・台東区の道具街）', en: 'About 15 min walk from Tawaramachi Stn on the Ginza Line (kitchenware district in Taito ward)', zh: '从田原町站步行约15分钟（银座线田原町站・台东区的厨房用具街）' },
    names: { ja: ['かっぱ橋', 'かっぱ橋道具街', '合羽橋'], en: ['Kappabashi', 'Kappabashi Street', 'Kappabashi Dogugai'], zh: ['河童桥', '合羽桥道具街'] }
  },
  tokyo_skytree: {
    station: 'とうきょうスカイツリー', walk_min: 1, category: '展望・建築',
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['東京スカイツリー', 'スカイツリー'], en: ['Tokyo Skytree', 'Skytree'], zh: ['东京晴空塔', '晴空塔'] }
  },
  tokyo_tower: {
    station: '御成門', walk_min: 10, category: '展望・建築',
    note: { ja: '御成門駅から徒歩約10分（赤羽橋駅からも約10分）', en: 'About 10 min walk from Onarimon Stn (also ~10 min from Akabanebashi Stn)', zh: '从御成门站步行约10分钟（赤羽桥站也可步行约10分钟）' },
    names: { ja: ['東京タワー'], en: ['Tokyo Tower'], zh: ['东京塔'] }
  },
  odaiba: {
    station: '台場', walk_min: 2, category: '複合文化施設',
    note: { ja: 'りんかい線・ゆりかもめ', en: 'Rinkai Line / Yurikamome', zh: '临海线・百合海鸥号' },
    names: { ja: ['お台場', '台場'], en: ['Odaiba'], zh: ['台场', '御台场'] }
  },
  tokyo_dome: {
    station: '水道橋', walk_min: 5, category: 'スポーツ施設',
    note: { ja: '水道橋駅から徒歩約5分', en: 'About 5 min walk from Suidobashi Stn', zh: '从水道桥站步行约5分钟' },
    names: { ja: ['東京ドーム'], en: ['Tokyo Dome'], zh: ['东京巨蛋'] }
  },
  nippon_budokan: {
    station: '九段下', walk_min: 5, category: 'スポーツ施設',
    note: { ja: '九段下駅から徒歩約5分', en: 'About 5 min walk from Kudanshita Stn', zh: '从九段下站步行约5分钟' },
    names: { ja: ['日本武道館'], en: ['Nippon Budokan', 'Budokan'], zh: ['日本武道馆'] }
  },
  tokyo_bigsight: {
    station: '国際展示場', walk_min: 3, category: '展示施設',
    note: { ja: 'りんかい線', en: 'Rinkai Line', zh: '临海线' },
    names: { ja: ['東京ビッグサイト'], en: ['Tokyo Big Sight'], zh: ['东京国际展览中心', '东京国际展示场'] }
  },
  akihabara: {
    station: '秋葉原', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['秋葉原電気街', '秋葉原'], en: ['Akihabara', 'Akihabara Electric Town'], zh: ['秋叶原', '秋叶原电器街'] }
  },
  shibuya_scramble: {
    station: '渋谷', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['渋谷スクランブル交差点', '渋谷'], en: ['Shibuya Crossing', 'Shibuya'], zh: ['涩谷十字路口', '涩谷'] }
  },
  sensoji: {
    station: '浅草', walk_min: 5,
    note: { ja: '浅草駅から徒歩約5分', en: 'About 5 min walk from Asakusa Stn', zh: '从浅草站步行约5分钟' },
    names: { ja: ['浅草寺', '雷門'], en: ['Sensoji', 'Kaminarimon', 'Asakusa Temple'], zh: ['浅草寺', '雷门'] }
  },
  shinjuku_gyoen: {
    station: '新宿御苑前', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['新宿御苑'], en: ['Shinjuku Gyoen'], zh: ['新宿御苑'] }
  },
  ueno_zoo: {
    station: '上野', walk_min: 5, category: '動物園',
    note: { ja: '上野駅から徒歩約5分', en: 'About 5 min walk from Ueno Stn', zh: '从上野站步行约5分钟' },
    names: { ja: ['上野動物園'], en: ['Ueno Zoo'], zh: ['上野动物园'] }
  },
  tskuba_botanical: {
    station: 'うしく', walk_min: 15,
    note: { ja: '駅から路線バス・タクシー', en: 'Local bus / taxi from the station', zh: '从车站乘坐路线巴士或出租车' },
    names: { ja: ['筑波実験植物園'], en: ['Tsukuba Botanical Garden'], zh: ['筑波实验植物园'] }
  },
  kasairinkai_park: {
    station: '葛西臨海公園', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['葛西臨海公園'], en: ['Kasai Rinkai Park'], zh: ['葛西临海公园'] }
  },
  inokashira_park: {
    station: '吉祥寺', walk_min: 5,
    note: { ja: '吉祥寺駅から徒歩約5分', en: 'About 5 min walk from Kichijoji Stn', zh: '从吉祥寺站步行约5分钟' },
    names: { ja: ['井の頭恩賜公園'], en: ['Inokashira Park'], zh: ['井之头恩赐公园'] }
  },
  tama_zoo: {
    station: '多摩動物公園', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['多摩動物公園'], en: ['Tama Zoological Park', 'Tama Zoo'], zh: ['多摩动物园'] }
  },
  tokyo_racecourse: {
    station: '府中競馬正門前', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['東京競馬場'], en: ['Tokyo Racecourse'], zh: ['东京赛马场'] }
  },
  yokohama_chinatown: {
    station: '元町・中華街', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['横浜中華街'], en: ['Yokohama Chinatown'], zh: ['横滨中华街'] }
  },
  yokohama_minatomirai: {
    station: 'みなとみらい', walk_min: 1,
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['横浜みなとみらい'], en: ['Yokohama Minatomirai', 'Minatomirai'], zh: ['横滨港未来', '港未来'] }
  },
  makuhari_messe: {
    station: '海浜幕張', walk_min: 1, category: '展示施設',
    note: { ja: '駅直結', en: 'Directly connected to the station', zh: '与车站直接连通' },
    names: { ja: ['幕張メッセ'], en: ['Makuhari Messe'], zh: ['幕张展览馆'] }
  },
  tokyo_station: {
    station: '東京', walk_min: 0,
    note: { ja: '', en: '', zh: '' },
    names: { ja: ['東京駅'], en: ['Tokyo Station'], zh: ['东京站'] }
  },
  haneda_airport: {
    station: '羽田空港第3ターミナル', walk_min: 1,
    note: { ja: '京急・モノレール', en: 'Keikyu / Monorail', zh: '京急・单轨电车' },
    names: { ja: ['羽田空港', '羽田'], en: ['Haneda Airport', 'Haneda', 'HND'], zh: ['羽田机场'] }
  },
  narita_airport: {
    station: '成田空港', walk_min: 1,
    note: { ja: '京成・JR', en: 'Keisei / JR', zh: '京成・JR' },
    names: { ja: ['成田空港'], en: ['Narita Airport', 'Narita'], zh: ['成田机场'] }
  },
  // ===== 有名神社仏閣・観光スポット（追加） =====
  meiji_jingu: {
    station: '原宿', walk_min: 5,
    note: { ja: '原宿駅から徒歩約5分（表参道口・明治神宮前〈原宿〉駅も利用可）', en: 'About 5 min walk from Harajuku Stn (also near Meiji-jingumae Stn)', zh: '从原宿站步行约5分钟（亦可使用明治神宫前〈原宿〉站）' },
    names: { ja: ['明治神宮', '明治神社', 'めいじじんぐう'], en: ['Meiji Shrine', 'Meiji Jingu'], zh: ['明治神宫'] }
  },
  narita_san: {
    station: '成田', walk_min: 15,
    note: { ja: '成田駅から徒歩約15分（京成成田駅からも。JR成田線「成田」駅が最寄り）', en: 'About 15 min walk from Narita Stn (also Keisei Narita Stn)', zh: '从成田站步行约15分钟（亦可使用京成成田站）' },
    names: { ja: ['成田山新勝寺', '成田山', '成田山公園'], en: ['Naritasan Shinshoji', 'Naritasan', 'Narita Temple'], zh: ['成田山新胜寺', '成田山'] }
  },
  ueno_park: {
    station: '上野', walk_min: 5, category: '公園',
    note: { ja: '上野駅から徒歩約5分（恩賜上野動物園・東京国立博物館・寛永寺等）', en: 'About 5 min walk from Ueno Stn (Ueno Zoo, Tokyo National Museum, Kaneiji Temple)', zh: '从上野站步行约5分钟（上野动物园・东京国立博物馆・宽永寺等）' },
    names: { ja: ['上野恩賜公園', '恩賜上野動物園', '上野動物園', '寛永寺', '東京国立博物館', '国立科学博物館'], en: ['Ueno Park', 'Ueno Zoo', 'Tokyo National Museum', 'Kaneiji'], zh: ['上野恩赐公园', '上野动物园', '东京国立博物馆', '宽永寺'] }
  },
  tokyo_university: {
    station: '本郷三丁目', walk_min: 5,
    note: { ja: '本郷三丁目駅から徒歩約5分（赤門・東京大学本郷キャンパス）', en: 'About 5 min walk from Hongo-sanchome Stn (Red Gate / UTokyo Hongo Campus)', zh: '从本乡三丁目站步行约5分钟（红门・东京大学本乡校区）' },
    names: { ja: ['東京大学', '東大', '赤門'], en: ['University of Tokyo', 'Tokyo University', 'UTokyo', 'Akamon'], zh: ['东京大学', '东大', '赤门'] }
  },
  rikugi_en: {
    station: '駒込', walk_min: 5,
    note: { ja: '駒込駅から徒歩約5分（六義園・旧岩崎邸庭園も近接）', en: 'About 5 min walk from Komagome Stn (Rikugien & former Iwasaki residence nearby)', zh: '从驹込站步行约5分钟（六义园・旧岩崎宅邸庭园邻近）' },
    names: { ja: ['六義園', '旧岩崎邸庭園'], en: ['Rikugien', 'Former Iwasaki Residence'], zh: ['六义园', '旧岩崎邸庭园'] }
  },
  negoro_shrine: {
    station: '後楽園', walk_min: 8,
    note: { ja: '後楽園駅から徒歩約8分（根津神社・湯島聖堂も近接）', en: 'About 8 min walk from Korakuen Stn (Nezu Shrine & Yushima Seido nearby)', zh: '从后乐园站步行约8分钟（根津神社・汤岛圣堂邻近）' },
    names: { ja: ['根津神社', '湯島聖堂', '湯島天満宮'], en: ['Nezu Shrine', 'Yushima Seido', 'Yushima Tenjin'], zh: ['根津神社', '汤岛圣堂', '汤岛天满宫'] }
  },
  gokokuji: {
    station: '護国寺', walk_min: 3,
    note: { ja: '護国寺駅から徒歩約3分', en: 'About 3 min walk from Gokokuji Stn', zh: '从护国寺站步行约3分钟' },
    names: { ja: ['護国寺'], en: ['Gokokuji Temple'], zh: ['护国寺'] }
  },
  yanaka: {
    station: '日暮里', walk_min: 5,
    note: { ja: '日暮里駅から徒歩約5分（谷中霊園・谷中銀座・根津・千駄木の古い町並み）', en: 'About 5 min walk from Nippori Stn (Yanaka Cemetery, Yanaka Ginza, historic town)', zh: '从日暮里站步行约5分钟（谷中灵园・谷中银座・根津・千駄木老街）' },
    names: { ja: ['谷中霊園', '谷中銀座', '谷中', '根津', '千駄木'], en: ['Yanaka', 'Yanaka Cemetery', 'Yanaka Ginza'], zh: ['谷中灵园', '谷中银座', '谷中'] }
  },
  // ===== 東京近郊の主要観光スポット（追加） =====
  tokyo_dome_city: {
    station: '後楽園', walk_min: 2,
    note: { ja: '後楽園駅から徒歩約2分（東京ドーム・ラクーア・ユニークビューホテル）', en: 'About 2 min walk from Korakuen Stn (Tokyo Dome, LaQua)', zh: '从后乐园站步行约2分钟（东京巨蛋・LaQua）' },
    names: { ja: ['後楽園', '東京ドームシティ', 'ラクーア', '東京ドームシティアトラクションズ'], en: ['Tokyo Dome City', 'Korakuen', 'LaQua'], zh: ['后乐园', '东京巨蛋城', '东京巨蛋之城'] }
  },
  roppongi_hills: {
    station: '六本木', walk_min: 5,
    note: { ja: '六本木駅から徒歩約5分（六本木ヒルズ・毛利庭園）', en: 'About 5 min walk from Roppongi Stn (Roppongi Hills, Mohri Garden)', zh: '从六本木站步行约5分钟（六本木之丘・毛利庭园）' },
    names: { ja: ['六本木ヒルズ', '六本木之丘', '毛利庭園', '六本木'], en: ['Roppongi Hills', 'Roppongi'], zh: ['六本木之丘', '六本木新城', '六本木'] }
  },
  azabu_juban: {
    station: '麻布十番', walk_min: 3,
    note: { ja: '麻布十番駅から徒歩約3分（麻布十番商店街・東京タワーも近接）', en: 'About 3 min walk from Azabu-juban Stn (shopping street; near Tokyo Tower)', zh: '从麻布十番站步行约3分钟（麻布十番商店街・邻近东京塔）' },
    names: { ja: ['麻布十番', '麻布十番商店街'], en: ['Azabu-juban', 'Azabu Juban'], zh: ['麻布十番', '麻布十番商店街'] }
  },
  omotesando: {
    station: '表参道', walk_min: 3,
    note: { ja: '表参道駅から徒歩約3分（表参道・青山・キラー通り）', en: 'About 3 min walk from Omotesando Stn (Omotesando, Aoyama)', zh: '从表参道站步行约3分钟（表参道・青山）' },
    names: { ja: ['表参道', 'オモテソウリョウ', '青山'], en: ['Omotesando', 'Omotesando', 'Aoyama'], zh: ['表参道', '青山'] }
  },
  zojoji: {
    station: '芝公園', walk_min: 3,
    note: { ja: '芝公園駅から徒歩約3分（増上寺・東京タワーも近接）', en: 'About 3 min walk from Shiba-koen Stn (Zojoji Temple; near Tokyo Tower)', zh: '从芝公园站步行约3分钟（增上寺・邻近东京塔）' },
    names: { ja: ['増上寺', '芝公園'], en: ['Zojoji', 'Zojo-ji Temple'], zh: ['增上寺', '芝公园'] }
  },
  hamarikyu: {
    station: '竹芝', walk_min: 5,
    note: { ja: '水上バス（東京クルーズ）の「浜離宮」発着場が最も近い。陸路なら竹芝駅から徒歩約5分（浜松町駅からもアクセス可）', en: 'The "Hama-rikyu" water bus (Tokyo Cruise) stop is the closest. By land, about 5 min walk from Takeshiba Stn (also Hamamatsucho Stn)', zh: '水上巴士（东京巡航）「滨离宫」码头最近。陆路则从竹芝站步行约5分钟（亦可从滨松町站前往）' },
    names: { ja: ['浜離宮', '浜離宮恩賜庭園', '浜離宮発着場', '水上バス浜離宮'], en: ['Hama-rikyu', 'Hamarikyu', 'Hama Rikyu Gardens', 'Hama-rikyu Water Bus', 'Hamarikyu Garden'], zh: ['浜离宫', '滨离宫', '浜离宫恩赐庭园', '滨离宫恩赐庭园', '滨离宫水上巴士'] }
  },
  takeshiba_pier: {
    station: '竹芝', walk_min: 3,
    note: { ja: '東海汽船フェリーターミナル（竹芝桟橋）へは竹芝駅から徒歩約3分。伊豆諸島・小笠原航路の乗船口（竹芝客船ターミナル）', en: 'About 3 min walk from Takeshiba Stn to the Tokai Kisen ferry terminal (Takeshiba Pier) for the Izu Islands / Ogasawara routes', zh: '从竹芝站步行约3分钟即可到达东海汽船轮渡码头（竹芝码头），可搭乘伊豆诸岛・小笠原航线（竹芝客船码头）' },
    names: { ja: ['竹芝桟橋', '竹芝客船ターミナル', '竹芝フェリーターミナル', '竹芝埠頭', '竹芝ピア', '東京・竹芝'], en: ['Takeshiba Pier', 'Takeshiba Passenger Terminal', 'Takeshiba Ferry Terminal', 'Tokyo Takeshiba Pier'], zh: ['竹芝码头', '竹芝客船码头', '竹芝轮渡码头', '东京·竹芝码头'] }
  },
  hinode_pier: {
    station: '浜松町', walk_min: 5,
    note: { ja: '水上バス（東京クルーズ）の「日の出桟橋」乗り場へは浜松町駅から徒歩約5分（竹芝駅からも徒歩圏・お台場ライン/レインボーブリッジ遊覧）', en: 'About 5 min walk from Hamamatsucho Stn to Hinode Pier (Tokyo Cruise water bus; also within walking distance of Takeshiba Stn. Odaiba Line / Rainbow Bridge cruise)', zh: '从滨松町站步行约5分钟即可到达日出码头（东京巡航水上巴士，从竹芝站亦可步行前往。台场航线/彩虹桥游览）' },
    names: { ja: ['日の出桟橋', '日の出埠頭', '水上バス日の出', '日の出桟橋発着場'], en: ['Hinode Pier', 'Hinode Water Bus', 'Hinode Pier Terminal'], zh: ['日出码头', '日出水上巴士码头'] }
  },
  tsukiji: {
    station: '築地', walk_min: 3,
    note: { ja: '築地駅から徒歩約3分（築地場外市場・新規飲食店街）', en: 'About 3 min walk from Tsukiji Stn (Outer Market)', zh: '从筑地站步行约3分钟（筑地场外市场）' },
    names: { ja: ['築地', '築地場外市場', '築地市場'], en: ['Tsukiji', 'Tsukiji Market'], zh: ['筑地', '筑地场外市场'] }
  },
  toyosu: {
    station: '豊洲', walk_min: 5,
    note: { ja: '豊洲駅から徒歩約5分（豊洲市場・チームラボボーダレス）', en: 'About 5 min walk from Toyosu Stn (Toyosu Market, teamLab)', zh: '从丰洲站步行约5分钟（丰洲市场・teamLab）' },
    names: { ja: ['豊洲', '豊洲市場', 'チームラボボーダレス', 'チームラボ'], en: ['Toyosu', 'Toyosu Market', 'teamLab Borderless'], zh: ['丰洲', '丰洲市场', 'teamLab无界'] }
  },
  imperial_palace: {
    station: '東京', walk_min: 10,
    note: { ja: '東京駅から徒歩約10分（皇居・二重橋・皇居外苑）', en: 'About 10 min walk from Tokyo Stn (Imperial Palace, Nijubashi)', zh: '从东京站步行约10分钟（皇居・二重桥・皇居外苑）' },
    names: { ja: ['皇居', '二重橋', '皇居外苑', '千鳥ヶ淵'], en: ['Imperial Palace', 'Nijubashi', 'Imperial Palace East Gardens'], zh: ['皇居', '二重桥', '皇居外苑'] }
  },
  national_diet: {
    station: '永田町', walk_min: 5,
    note: { ja: '永田町駅から徒歩約5分（国会議事堂・日比谷公園も近接）', en: 'About 5 min walk from Nagatacho Stn (National Diet Building)', zh: '从永田町站步行约5分钟（国会议事堂）' },
    names: { ja: ['国会議事堂', '永田町'], en: ['National Diet Building', 'Diet Building'], zh: ['国会议事堂', '国会议事堂'] }
  },
  // ===== 主要公園・庭園（追加） =====
  toneri_park: {
    station: '舎人公園', walk_min: 1,
    note: { ja: '日暮里・舎人ライナー「舎人公園駅」下車すぐ', en: 'Immediately outside Toneri-koen Stn on the Nippori-Toneri Liner', zh: '在日暮里・舍人线舍人公园站下车即到' },
    names: { ja: ['舎人公園'], en: ['Toneri Park'], zh: ['舍人公园'] }
  },
  yoyogi_park: {
    station: '原宿', walk_min: 10,
    note: { ja: '原宿駅から徒歩約10分（明治神宮前駅・代々木公園駅も利用可）', en: 'About 10 min walk from Harajuku Stn (also near Meiji-jingumae and Yoyogi-koen)', zh: '从原宿站步行约10分钟（亦可使用明治神宫前站、代代木公园站）' },
    names: { ja: ['代々木公園'], en: ['Yoyogi Park'], zh: ['代代木公园'] }
  },
  koishikawa_korakuen: {
    station: '後楽園', walk_min: 8,
    note: { ja: '後楽園駅から徒歩約8分（飯田橋駅からもアクセス可）', en: 'About 8 min walk from Korakuen Stn (also accessible from Iidabashi)', zh: '从后乐园站步行约8分钟（亦可从饭田桥站前往）' },
    names: { ja: ['小石川後楽園'], en: ['Koishikawa Korakuen Gardens', 'Koishikawa Korakuen'], zh: ['小石川后乐园'] }
  },
  kiyose_garden: {
    station: '清澄白河', walk_min: 3,
    note: { ja: '清澄白河駅から徒歩約3分', en: 'About 3 min walk from Kiyosumi-shirakawa Stn', zh: '从清澄白河站步行约3分钟' },
    names: { ja: ['清澄庭園'], en: ['Kiyosumi Gardens', 'Kiyosumi Teien'], zh: ['清澄庭园'] }
  },
  mizumoto_park: {
    station: '松戸', walk_min: 20,
    note: { ja: '松戸駅からバス等を利用（公園入口まで徒歩約20分の目安）', en: 'Bus recommended from Matsudo Stn; about 20 min walk to the park entrance', zh: '建议从松户站乘坐巴士；到公园入口步行约20分钟' },
    names: { ja: ['水元公園'], en: ['Mizumoto Park'], zh: ['水元公园'] }
  },
  showa_kinen_park: {
    station: '立川', walk_min: 15,
    note: { ja: '立川駅から徒歩約15分（あけぼの口）。西立川駅は路線データ未登録のため立川を案内', en: 'About 15 min walk from Tachikawa Stn (Akebono Gate); Tachikawa is used because Nishitachikawa is not in the route graph', zh: '从立川站步行约15分钟（曙口）；由于西立川未登记在路线数据中，暂以立川站为目的地' },
    names: { ja: ['国営昭和記念公園', '昭和記念公園'], en: ['Showa Kinen Park', 'Showa Memorial Park'], zh: ['国营昭和纪念公园', '昭和纪念公园'] }
  },
  kinuta_park: {
    station: '用賀', walk_min: 20,
    note: { ja: '用賀駅から徒歩約20分（バス利用可）', en: 'About 20 min walk from Yoga Stn; bus recommended', zh: '从用贺站步行约20分钟；建议乘坐巴士' },
    names: { ja: ['砧公園'], en: ['Kinuta Park'], zh: ['砧公园'] }
  },
  komazawa_park: {
    station: '駒沢大学', walk_min: 15,
    note: { ja: '駒沢大学駅から徒歩約15分', en: 'About 15 min walk from Komazawa-daigaku Stn', zh: '从驹泽大学站步行约15分钟' },
    names: { ja: ['駒沢オリンピック公園', '駒沢公園'], en: ['Komazawa Olympic Park', 'Komazawa Park'], zh: ['驹泽奥林匹克公园', '驹泽公园'] }
  },
  arisugawa_park: {
    station: '広尾', walk_min: 3,
    note: { ja: '広尾駅から徒歩約3分', en: 'About 3 min walk from Hiro-o Stn', zh: '从广尾站步行约3分钟' },
    names: { ja: ['有栖川宮記念公園'], en: ['Arisugawa-no-miya Memorial Park'], zh: ['有栖川宫纪念公园'] }
  },
  hinokicho_park: {
    station: '六本木', walk_min: 5,
    note: { ja: '六本木駅から徒歩約5分（東京ミッドタウン隣接）', en: 'About 5 min walk from Roppongi Stn (next to Tokyo Midtown)', zh: '从六本木站步行约5分钟（毗邻东京中城）' },
    names: { ja: ['檜町公園'], en: ['Hinokicho Park'], zh: ['桧町公园'] }
  },
  meguro_sky_park: {
    station: '池尻大橋', walk_min: 7,
    note: { ja: '池尻大橋駅から徒歩約7分', en: 'About 7 min walk from Ikejiri-ōhashi Stn', zh: '从池尻大桥站步行约7分钟' },
    names: { ja: ['目黒天空庭園'], en: ['Meguro Sky Garden'], zh: ['目黑天空庭园'] }
  },
  wakasu_park: {
    station: '新木場', walk_min: 15,
    note: { ja: '新木場駅からバス利用（徒歩では距離があります）', en: 'Bus recommended from Shin-kiba Stn; it is a long walk', zh: '建议从新木场站乘坐巴士；步行距离较远' },
    names: { ja: ['若洲海浜公園'], en: ['Wakasu Seaside Park'], zh: ['若洲海滨公园'] }
  },
  yumenoshima_park: {
    station: '新木場', walk_min: 10,
    note: { ja: '新木場駅から徒歩約10分', en: 'About 10 min walk from Shin-kiba Stn', zh: '从新木场站步行约10分钟' },
    names: { ja: ['夢の島公園'], en: ['Yumenoshima Park'], zh: ['梦之岛公园'] }
  },
  oi_futo_park: {
    station: '大井町', walk_min: 15,
    note: { ja: '大井町駅からバス等を利用', en: 'Bus recommended from Oimachi Stn', zh: '建议从大井町站乘坐巴士' },
    names: { ja: ['大井ふ頭中央海浜公園'], en: ['Oi Central Seaside Park'], zh: ['大井埠头中央海滨公园'] }
  },
  wadakura_park: {
    station: '大手町', walk_min: 5,
    note: { ja: '大手町駅から徒歩約5分（東京駅からもアクセス可）', en: 'About 5 min walk from Otemachi Stn (also accessible from Tokyo Stn)', zh: '从大手町站步行约5分钟（亦可从东京站前往）' },
    names: { ja: ['和田倉噴水公園'], en: ['Wadakura Fountain Park'], zh: ['和田仓喷泉公园'] }
  },
  hibiyakoen: {
    station: '日比谷', walk_min: 1,
    note: { ja: '日比谷駅から徒歩約1分（霞ケ関駅・有楽町駅も利用可）', en: 'About 1 min walk from Hibiya Stn (also Kasumigaseki and Yurakucho)', zh: '从日比谷站步行约1分钟（亦可使用霞关站、有乐町站）' },
    names: { ja: ['日比谷公園'], en: ['Hibiya Park'], zh: ['日比谷公园'] }
  },
  kogaine_park: {
    station: '花小金井', walk_min: 20,
    note: { ja: '花小金井駅から徒歩約20分（バス利用可）', en: 'About 20 min walk from Hanakoganei Stn; bus recommended', zh: '从花小金井站步行约20分钟；建议乘坐巴士' },
    names: { ja: ['小金井公園'], en: ['Koganei Park'], zh: ['小金井公园'] }
  },
  // ===== 美術館・博物館・歴史文化施設（追加） =====
  mori_art_museum: {
    station: '六本木', walk_min: 5,
    note: { ja: '六本木ヒルズ森タワー内。六本木駅から徒歩約5分', en: 'Inside Roppongi Hills Mori Tower; about 5 min walk from Roppongi Stn', zh: '位于六本木之丘森大厦内；从六本木站步行约5分钟' },
    names: { ja: ['森美術館'], en: ['Mori Art Museum'], zh: ['森美术馆'] }
  },
  national_art_center: {
    station: '乃木坂', walk_min: 1,
    note: { ja: '乃木坂駅直結（六本木駅からも徒歩約10分）', en: 'Directly connected to Nogizaka Stn; about 10 min walk from Roppongi', zh: '与乃木坂站直接连通；从六本木站步行约10分钟' },
    names: { ja: ['国立新美術館'], en: ['The National Art Center, Tokyo', 'National Art Center Tokyo'], zh: ['国立新美术馆'] }
  },
  teamlab_planets: {
    station: '新豊洲', walk_min: 1, category: 'デジタルアート',
    note: { ja: '新豊洲駅から徒歩約1分', en: 'About 1 min walk from Shin-toyosu Stn', zh: '从新丰洲站步行约1分钟' },
    names: { ja: ['チームラボプラネッツ', 'チームラボプラネッツTOKYO'], en: ['teamLab Planets', 'teamLab Planets TOKYO'], zh: ['teamLab Planets', 'teamLab行星'] }
  },
  teamlab_borderless: {
    station: '神谷町', walk_min: 3, category: 'デジタルアート',
    note: { ja: '麻布台ヒルズ内。神谷町駅から徒歩約3分', en: 'Inside Azabudai Hills; about 3 min walk from Kamiyacho Stn', zh: '位于麻布台之丘内；从神谷町站步行约3分钟' },
    names: { ja: ['チームラボボーダレス', '麻布台ヒルズチームラボ'], en: ['teamLab Borderless', 'teamLab Borderless Azabudai Hills'], zh: ['teamLab无界', '麻布台之丘teamLab'] }
  },
  kanda_myojin: {
    station: '御茶ノ水', walk_min: 5,
    note: { ja: '御茶ノ水駅から徒歩約5分（末広町駅・秋葉原駅からもアクセス可）', en: 'About 5 min walk from Ochanomizu Stn; also accessible from Suehirocho and Akihabara', zh: '从御茶之水站步行约5分钟；也可从末广町站、秋叶原站前往' },
    names: { ja: ['神田明神', '神田神社'], en: ['Kanda Myojin', 'Kanda Shrine'], zh: ['神田明神', '神田神社'] }
  },
  tsukiji_honganji: {
    station: '築地', walk_min: 1,
    note: { ja: '築地駅から徒歩約1分（築地場外市場に隣接）', en: 'About 1 min walk from Tsukiji Stn, next to the Outer Market', zh: '从筑地站步行约1分钟，毗邻筑地场外市场' },
    names: { ja: ['築地本願寺'], en: ['Tsukiji Hongwanji Temple'], zh: ['筑地本愿寺'] }
  },
  kabukiza: {
    station: '東銀座', walk_min: 1,
    note: { ja: '東銀座駅直結', en: 'Directly connected to Higashi-ginza Stn', zh: '与东银座站直接连通' },
    names: { ja: ['歌舞伎座'], en: ['Kabukiza Theatre', 'Kabuki-za'], zh: ['歌舞伎座'] }
  },
  tokyo_metropolitan_gov: {
    station: '都庁前', walk_min: 1,
    note: { ja: '都庁前駅直結。展望室は東京都庁第一本庁舎', en: 'Directly connected to Tochomae Stn; observation decks are in the Tokyo Metropolitan Government Building No. 1', zh: '与都厅前站直接连通；展望室位于东京都厅第一本厅舍' },
    names: { ja: ['東京都庁展望室', '東京都庁', '都庁展望台'], en: ['Tokyo Metropolitan Government Building', 'Tokyo Metropolitan Government Observation Deck'], zh: ['东京都厅展望室', '东京都厅'] }
  },
  sunshine_city: {
    station: '池袋', walk_min: 8, category: '複合文化施設',
    note: { ja: '池袋駅から徒歩約8分（サンシャイン水族館・展望台）', en: 'About 8 min walk from Ikebukuro Stn (aquarium and observatory)', zh: '从池袋站步行约8分钟（阳光水族馆・展望台）' },
    names: { ja: ['サンシャインシティ', 'サンシャイン水族館', 'サンシャイン60'], en: ['Sunshine City', 'Sunshine Aquarium', 'Sunshine 60'], zh: ['太阳城', '阳光水族馆', 'Sunshine 60'] }
  },
  miraikan: {
    station: '東京テレポート', walk_min: 5,
    note: { ja: '東京テレポート駅から徒歩約5分（日本科学未来館）', en: 'About 5 min walk from Tokyo Teleport Stn', zh: '从东京电讯港站步行约5分钟' },
    names: { ja: ['日本科学未来館'], en: ['Miraikan', 'National Museum of Emerging Science and Innovation'], zh: ['日本科学未来馆'] }
  },
  tokyo_station_marunouchi: {
    station: '東京', walk_min: 1,
    note: { ja: '東京駅丸の内側。丸の内中央口からすぐ', en: 'Marunouchi side of Tokyo Stn, just outside the Marunouchi Central Exit', zh: '东京站丸之内一侧，紧邻丸之内中央口' },
    names: { ja: ['東京駅丸の内駅舎', '丸の内駅舎', '東京駅赤レンガ駅舎'], en: ['Tokyo Station Marunouchi Building', 'Tokyo Station Marunouchi'], zh: ['东京站丸之内站房', '东京站红砖站房'] }
  },
  // ===== 首都圏の主要テーマパーク（追加） =====
  sanrio_puroland: {
    station: '多摩センター', walk_min: 5, category: 'テーマパーク',
    note: { ja: '多摩センター駅から徒歩約5分（京王線・小田急線・多摩モノレール）', en: 'About 5 min walk from Tama Center Stn (Keio, Odakyu and Tama Monorail)', zh: '从多摩中心站步行约5分钟（京王线・小田急线・多摩单轨电车）' },
    names: { ja: ['サンリオピューロランド', 'サンリオ ピューロランド', 'ピューロランド'], en: ['Sanrio Puroland', 'Puroland'], zh: ['三丽鸥彩虹乐园', '三丽鸥彩虹乐园 Puroland'] }
  },
  yomiuriland: {
    station: '京王よみうりランド', walk_min: 10, category: '遊園地',
    note: { ja: '京王よみうりランド駅からゴンドラまたはバス等を利用', en: 'Use the gondola or bus from Keio-yomiuriland Stn', zh: '从京王读卖乐园站乘坐缆车或巴士前往' },
    names: { ja: ['よみうりランド', 'よみうりランド遊園地', 'HANA・BIYORI'], en: ['Yomiuriland', 'Yomiuri Land', 'HANA・BIYORI'], zh: ['读卖乐园', '读卖乐园游乐园'] }
  },
  moomin_valley_park: {
    station: '飯能', walk_min: 30, category: 'テーマパーク',
    note: { ja: '飯能駅からバス利用（メッツァ・ムーミンバレーパーク）', en: 'Take a bus from Hanno Stn to Metsä / Moominvalley Park', zh: '从饭能站乘坐巴士前往Metsa・姆明谷公园' },
    names: { ja: ['ムーミンバレーパーク', 'メッツァ', 'メッツァビレッジ'], en: ['Moominvalley Park', 'Metsa', 'Metsa Village'], zh: ['姆明谷公园', 'Metsa'] }
  },
  tobu_zoo: {
    station: '東武動物公園', walk_min: 10,
    note: { ja: '東武動物公園駅から徒歩約10分（バスも利用可）', en: 'About 10 min walk from Tobu-dobutsu-koen Stn; bus also available', zh: '从东武动物公园站步行约10分钟；也可乘坐巴士' },
    names: { ja: ['東武動物公園', '東武スーパープール'], en: ['Tobu Zoo', 'Tobu Dobutsu Koen'], zh: ['东武动物公园'] }
  },
  // ===== 2026-08 横浜・千葉近郊のテーマパーク・遊園地（v2.25.3 追加） =====
  yokohama_cosmo_world: {
    station: 'みなとみらい', walk_min: 3,
    note: { ja: 'みなとみらい駅から徒歩約3分（観覧車コスモクロック21）', en: 'About 3 min walk from Minatomirai Stn (Cosmo Clock 21 ferris wheel)', zh: '从港未来站步行约3分钟（摩天轮宇宙时钟21）' },
    names: { ja: ['よこはまコスモワールド', 'コスモワールド', 'コスモクロック21'], en: ['Yokohama Cosmo World', 'Cosmo World', 'Cosmo Clock 21'], zh: ['横滨宇宙世界游乐园', '宇宙世界', '宇宙时钟21'] }
  },
  yokohama_landmark_tower: {
    station: 'みなとみらい', walk_min: 3,
    note: { ja: 'みなとみらい駅直結（スカイガーデン69階展望）', en: 'Directly connected to Minatomirai Stn (Sky Garden observatory on the 69th floor)', zh: '与港未来站直接连通（69层空中花园展望台）' },
    names: { ja: ['横浜ランドマークタワー', 'ランドマークタワー', 'スカイガーデン'], en: ['Yokohama Landmark Tower', 'Landmark Tower', 'Sky Garden'], zh: ['横滨地标大厦', '地标大厦', '空中花园'] }
  },
  yokohama_cupnoodles_museum: {
    station: 'みなとみらい', walk_min: 5,
    note: { ja: 'みなとみらい駅から徒歩約5分（旧名: 安藤百福発明記念館）', en: 'About 5 min walk from Minatomirai Stn (formerly Momofuku Ando Instant Ramen Museum)', zh: '从港未来站步行约5分钟（原安藤百福发明纪念馆）' },
    names: { ja: ['カップヌードルミュージアム', '安藤百福発明記念館', 'インスタントラーメン発明記念館', 'インスタントラーメン博物館'], en: ['CupNoodles Museum', 'Momofuku Ando Instant Ramen Museum'], zh: ['杯面博物馆', '安藤百福发明纪念馆'] }
  },
  // カップヌードルミュージアムパーク（旧・新港パーク）: 2017年ネーミングライツ改称。ミュージアムとは別施設の公園（#27）
  cupnoodles_museum_park: {
    station: 'みなとみらい', walk_min: 5,
    note: { ja: 'みなとみらい駅から徒歩約5分（旧名: 新港パーク。カップヌードルミュージアム隣接の公園）', en: 'About 5 min walk from Minatomirai Stn (formerly Shinko Park; park next to the CupNoodles Museum)', zh: '从港未来站步行约5分钟（原新港公园，杯面博物馆旁的公园）' },
    names: { ja: ['カップヌードルミュージアムパーク', '新港パーク', 'カップヌードルパーク'], en: ['CupNoodles Museum Park', 'Shinko Park', 'CupNoodles Park'], zh: ['杯面博物馆公园', '新港公园', '杯面公园'] }
  },
  yokohama_redbrick: {
    station: '馬車道', walk_min: 5,
    note: { ja: '馬車道駅から徒歩約5分（横浜赤レンガ倉庫）', en: 'About 5 min walk from Bashamichi Stn (Yokohama Red Brick Warehouse)', zh: '从马车道站步行约5分钟（横滨红砖仓库）' },
    names: { ja: ['横浜赤レンガ倉庫', '赤レンガ倉庫', '赤レンガパーク'], en: ['Yokohama Red Brick Warehouse', 'Red Brick Warehouse', 'Akarenga'], zh: ['横滨红砖仓库', '红砖仓库'] }
  },
  yokohama_chinatown_gate: {
    station: '元町・中華街', walk_min: 3,
    note: { ja: '元町・中華街駅からすぐ（横浜中華街）', en: 'Just outside Motomachi-Chukagai Stn (Yokohama Chinatown)', zh: '元町・中华街站出口即达（横滨中华街）' },
    names: { ja: ['横浜中華街', '中華街', '山下町公園'], en: ['Yokohama Chinatown', 'Chinatown'], zh: ['横滨中华街', '中华街'] }
  },
  hakkeijima_seaparadise: {
    station: '金沢八景', walk_min: 30, category: '遊園地',
    note: { ja: '金沢八景駅からシーサイドライン八景島駅へ乗換（徒歩約3分）またはバス。水族館＋遊園地', en: 'Transfer to Seaside Line Hakkeijima Stn at Kanazawa-Hakkei (about 3 min walk) or take a bus. Aquarium + amusement park', zh: '在金泽八景站换乘海岸线至八景岛站（步行约3分钟）或乘坐巴士。水族馆+游乐园' },
    names: { ja: ['横浜・八景島シーパラダイス', '八景島シーパラダイス', 'シーパラダイス', '八景島'], en: ['Yokohama Hakkeijima Sea Paradise', 'Hakkeijima Sea Paradise', 'Sea Paradise'], zh: ['横滨八景岛海岛乐园', '八景岛海岛乐园', '海岛乐园'] }
  },
  yokohama_zoorasia: {
    station: '鶴ヶ峰', walk_min: 30,
    note: { ja: '鶴ヶ峰駅からバス約15分（よこはま動物園ズーラシア）', en: 'About 15 min by bus from Tsurugamine Stn (Yokohama Zoological Gardens Zoorasia)', zh: '从鹤峰站乘坐巴士约15分钟（横滨动物园Zoorasia）' },
    names: { ja: ['よこはま動物園ズーラシア', 'ズーラシア', '横浜動物園'], en: ['Yokohama Zoological Gardens Zoorasia', 'Zoorasia'], zh: ['横滨动物园Zoorasia', 'Zoorasia'] }
  },
  sankeien_garden: {
    station: '根岸', walk_min: 20,
    note: { ja: '根岸駅からバスまたは徒歩約20分（三溪園）', en: 'About 20 min by bus or on foot from Negishi Stn (Sankeien Garden)', zh: '从根岸站乘坐巴士或步行约20分钟（三溪园）' },
    names: { ja: ['三溪園', '三渓園'], en: ['Sankeien Garden', 'Sankeien'], zh: ['三溪园'] }
  },
  yamashita_park: {
    station: '元町・中華街', walk_min: 5,
    note: { ja: '元町・中華街駅から徒歩約5分（山下公園・氷川丸）', en: 'About 5 min walk from Motomachi-Chukagai Stn (Yamashita Park / Hikawa Maru)', zh: '从元町・中华街站步行约5分钟（山下公园・冰川丸）' },
    names: { ja: ['山下公園', '氷川丸', 'マリンタワー'], en: ['Yamashita Park', 'Hikawa Maru', 'Marine Tower'], zh: ['山下公园', '冰川丸', '海洋塔'] }
  },
  yokohama_bay_quarter: {
    station: '新高島', walk_min: 3,
    note: { ja: '新高島駅から徒歩約3分（横浜ベイクォーター・臨港パーク）', en: 'About 3 min walk from Shin-Takashima Stn (Yokohama Bay Quarter / Rinko Park)', zh: '从新高岛站步行约3分钟（横滨Bay Quarter・临港公园）' },
    names: { ja: ['横浜ベイクォーター', 'ベイクォーター', '臨港パーク'], en: ['Yokohama Bay Quarter', 'Bay Quarter', 'Rinko Park'], zh: ['横滨Bay Quarter', 'Bay Quarter', '临港公园'] }
  },
  // ===== 千葉県のテーマパーク・遊園地・レジャー =====
  // ※ マザー牧場（最寄り: 君津駅）・東京ドイツ村（姉ケ崎駅）・市原ぞうの国（五井駅）は
  //    JR内房線が路線グラフに未収録のため保留（グラフ拡張時に追加）
  narita_yume_farm: {
    station: '京成成田', walk_min: 30,
    note: { ja: '京成成田駅からバス約15分（成田ゆめ牧場）', en: 'About 15 min by bus from Keisei-Narita Stn (Narita Yume Farm)', zh: '从京成成田站乘坐巴士约15分钟（成田梦牧场）' },
    names: { ja: ['成田ゆめ牧場', 'ゆめ牧場', '成田夢牧場'], en: ['Narita Yume Farm', 'Narita Dream Farm'], zh: ['成田梦牧场', '梦牧场'] }
  },
  chiba_zoo: {
    station: '千葉', walk_min: 30, category: '動物園',
    note: { ja: '千葉駅から千葉都市モノレールまたはバス（千葉市動物公園）', en: 'Take the Chiba Urban Monorail or bus from Chiba Stn (Chiba City Zoo)', zh: '从千叶站乘坐千叶都市单轨电车或巴士（千叶市动物公园）' },
    names: { ja: ['千葉市動物公園', '千葉動物公園', '千葉市動物公園 モノレール'], en: ['Chiba City Zoo', 'Chiba Zoo'], zh: ['千叶市动物公园', '千叶动物公园'] }
  },
  chiba_port_tower: {
    station: '千葉みなと', walk_min: 5, category: '展望・建築',
    note: { ja: '千葉みなと駅から徒歩約5分（千葉ポートタワー）', en: 'About 5 min walk from Chiba-Minato Stn (Chiba Port Tower)', zh: '从千叶港站步行约5分钟（千叶港塔）' },
    names: { ja: ['千葉ポートタワー', 'ポートタワー'], en: ['Chiba Port Tower', 'Port Tower'], zh: ['千叶港塔', '港塔'] }
  },
  zozo_marine_stadium: {
    station: '海浜幕張', walk_min: 15, category: 'スポーツ施設',
    note: { ja: '海浜幕張駅から徒歩約15分（ZOZOマリンスタジアム・千葉マリンスタジアム）', en: 'About 15 min walk from Kaihin-Makuhari Stn (ZOZO Marine Stadium)', zh: '从海滨幕张站步行约15分钟（ZOZO海洋球场）' },
    names: { ja: ['ZOZOマリンスタジアム', '千葉マリンスタジアム', 'マリンスタジアム'], en: ['ZOZO Marine Stadium', 'Chiba Marine Stadium', 'Marine Stadium'], zh: ['ZOZO海洋球场', '千叶海洋球场'] }
  },
  kashima_sea: {
    station: '新浦安', walk_min: 5, category: 'スポーツ施設',
    note: { ja: '新浦安駅から徒歩約5分（浦安市総合公園・総合体育館）', en: 'About 5 min walk from Shin-Urayasu Stn (Urayasu General Park)', zh: '从新浦安站步行约5分钟（浦安市综合公园）' },
    names: { ja: ['浦安市総合公園', '浦安総合公園'], en: ['Urayasu General Park'], zh: ['浦安市综合公园'] }
  },
  edotokyo_museum: {
    station: '両国', walk_min: 3,
    note: { ja: '江戸東京博物館へは両国駅から徒歩約3分（大相撲の国技館も隣接）', en: 'About 3 min walk from Ryogoku Stn to the Edo-Tokyo Museum (Ryogoku Kokugikan sumo hall is adjacent)', zh: '从两国站步行约3分钟即可到达江户东京博物馆（国技馆相扑馆就在旁边）' },
    names: { ja: ['江戸東京博物館', '江戸東京博物館（EDOMUS）'], en: ['Edo-Tokyo Museum', 'Edo Tokyo Museum'], zh: ['江户东京博物馆'] }
  },
  tokyo_summerland: {
    station: '武蔵引田', walk_min: 5,
    note: { ja: 'JR五日市線 武蔵引田駅から徒歩約5分（プール・温泉・遊園地の複合レジャー施設）', en: 'About 5 min walk from Musashi-Hikida Stn on the JR Itsukaichi Line (pool, hot spring & amusement park complex)', zh: '从JR五日市线武藏引田站步行约5分钟（泳池・温泉・游乐园综合休闲设施）' },
    names: { ja: ['東京サマーランド', 'サマーランド'], en: ['Tokyo Summerland', 'Summerland'], zh: ['东京夏日乐园', '夏日乐园'] }
  },
  // ===== Issue #40: 鉄道博物館系（7施設） =====
  railway_museum: {
    station: '鉄道博物館（大成）', walk_min: 1, category: '博物館',
    note: { ja: '埼玉新都市交通 鉄道博物館（大成）駅から徒歩約1分（大宮駅からニューシャトルで約3分）', en: 'About 1 min walk from Tetsudo-Hakubutsukan (Taisho) Stn on the New Shuttle (approx. 3 min from Omiya Stn)', zh: '从埼玉新都市交通铁道博物馆（大成）站步行约1分钟（大宫站乘新交通系统约3分钟）' },
    names: { ja: ['鉄道博物館', '大宮鉄道博物館'], en: ['The Railway Museum', 'Railway Museum'], zh: ['铁道博物馆'] }
  },
  metro_museum: {
    station: '葛西', walk_min: 1,
    note: { ja: '東京メトロ東西線 葛西駅から徒歩約1分（駅高架下）', en: 'About 1 min walk from Kasai Stn on the Tozai Line (under the elevated track)', zh: '从东京地铁东西线葛西站步行约1分钟（高架桥下）' },
    names: { ja: ['地下鉄博物館'], en: ['Tokyo Metro Museum', 'Metro Museum'], zh: ['地铁博物馆'] }
  },
  tobu_museum: {
    station: '東向島', walk_min: 1,
    note: { ja: '東武伊勢崎線 東向島駅から徒歩約1分', en: 'About 1 min walk from Higashi-Mukojima Stn on the Tobu Isesaki Line', zh: '从东武伊势崎线东向岛站步行约1分钟' },
    names: { ja: ['東武博物館'], en: ['Tobu Museum'], zh: ['东武博物馆'] }
  },
  keio_rail_land: {
    station: '多摩動物公園', walk_min: 2,
    note: { ja: '京王動物園線 多摩動物公園駅から徒歩約2分', en: 'About 2 min walk from Tama-Dobutsu-Koen Stn on the Keio Dobutsuen Line', zh: '从京王动物园线多摩动物园站步行约2分钟' },
    names: { ja: ['京王れいんらんど', '京王レールランド'], en: ['Keio Rail Land'], zh: ['京王铁路乐园'] }
  },
  ome_railway_park: {
    station: '青梅', walk_min: 5,
    note: { ja: 'JR青梅線 青梅駅から徒歩約5分', en: 'About 5 min walk from Ome Stn on the JR Ome Line', zh: '从JR青梅线青梅站步行约5分钟' },
    names: { ja: ['青梅鉄道公園'], en: ['Ome Railway Park'], zh: ['青梅铁道公园'] }
  },
  train_bus_museum: {
    station: '向ヶ丘遊園', walk_min: 3,
    note: { ja: '小田急小田原線 向ヶ丘遊園駅から徒歩約3分', en: 'About 3 min walk from Mukogaoka-Yuen Stn on the Odakyu Odawara Line', zh: '从小田急小田原线向丘游园站步行约3分钟' },
    names: { ja: ['電車とバスの博物館'], en: ['Electric Car and Bus Museum', 'Train and Bus Museum'], zh: ['电车与巴士博物馆'] }
  },
  yokohama_tram_museum: {
    station: '山手', walk_min: 3,
    note: { ja: 'JR根岸線 山手駅から徒歩約3分', en: 'About 3 min walk from Yamate Stn on the JR Negishi Line', zh: '从JR根岸线山手站步行约3分钟' },
    names: { ja: ['横浜市電保存館'], en: ['Yokohama City Tram Museum'], zh: ['横滨市电保存馆'] }
  },
  // ===== Issue #41: 科学館（2施設） =====
  science_museum: {
    station: '竹橋', walk_min: 1,
    note: { ja: '東京メトロ東西線 竹橋駅から徒歩約1分（北の丸公園内）', en: 'About 1 min walk from Takebashi Stn on the Tozai Line (Kitanomaru Park)', zh: '从东京地铁东西线竹桥站步行约1分钟（北之丸公园内）' },
    names: { ja: ['科学技術館'], en: ['Science Museum'], zh: ['科学技术馆'] }
  },
  tokyo_water_science_museum: {
    station: '豊洲', walk_min: 3,
    note: { ja: '豊洲駅から徒歩約3分', en: 'About 3 min walk from Toyosu Stn', zh: '从丰洲站步行约3分钟' },
    names: { ja: ['東京都水の科学館'], en: ['Tokyo Water Science Museum'], zh: ['东京都水科学馆'] }
  },
  // ===== Issue #44: 公園・文化施設（上野公園・上野動物園は ueno_park でカバー済みのため個別追加分のみ） =====
  tokyo_metro_art_museum: {
    station: '上野', walk_min: 3,
    note: { ja: '上野駅から徒歩約3分（上野恩賜公園内）', en: 'About 3 min walk from Ueno Stn (Ueno Park)', zh: '从上野站步行约3分钟（上野恩赐公园内）' },
    names: { ja: ['東京都美術館', '都美術館'], en: ['Tokyo Metropolitan Art Museum'], zh: ['东京都美术馆'] }
  },
  asukayama_park: {
    station: '王子', walk_min: 3,
    note: { ja: '王子駅から徒歩約3分（桜の名所・飛鳥山公園）', en: 'About 3 min walk from Oji Stn (famous cherry blossom spot)', zh: '从王子站步行约3分钟（樱花名胜・飞鸟山公园）' },
    names: { ja: ['飛鳥山公園'], en: ['Asukayama Park'], zh: ['飞鸟山公园'] }
  },
  mot_museum: {
    station: '清澄白河', walk_min: 5,
    note: { ja: '清澄白河駅から徒歩約5分（木場公園内）', en: 'About 5 min walk from Kiyosumi-Shirakawa Stn (Kiba Park)', zh: '从清澄白河站步行约5分钟（木场公园内）' },
    names: { ja: ['東京都現代美術館', 'MOT'], en: ['Museum of Contemporary Art Tokyo', 'MOT'], zh: ['东京都现代美术馆'] }
  },
  sntory_hall: {
    station: '溜池山王', walk_min: 3,
    note: { ja: '溜池山王駅から徒歩約3分（六本木一丁目・アークヒルズ内）', en: 'About 3 min walk from Tameike-Sanno Stn (Ark Hills, Roppongi 1-chome)', zh: '从溜池山王站步行约3分钟（六本木一丁目・ARK Hills内）' },
    names: { ja: ['サントリーホール'], en: ['Suntory Hall'], zh: ['三得利音乐厅'] }
  },
  minato_mirai_21: {
    station: 'みなとみらい', walk_min: 1, category: '複合文化施設',
    note: { ja: 'みなとみらい駅直結（みなとみらい21エリア）', en: 'Directly connected to Minatomirai Stn (Minato Mirai 21 area)', zh: '与港未来站直接连通（港未来21区域）' },
    names: { ja: ['みなとみらい21', 'みなとみらい'], en: ['Minato Mirai 21', 'Minatomirai 21'], zh: ['港未来21'] }
  },
  sumida_aquarium: {
    station: 'とうきょうスカイツリー', walk_min: 1, category: '水族館',
    note: { ja: 'とうきょうスカイツリー駅直結（東京スカイツリータウン内）', en: 'Directly connected to Tokyo Skytree Stn (Tokyo Skytree Town)', zh: '与东京晴空塔站直接连通（东京晴空塔城内）' },
    names: { ja: ['すみだ水族館'], en: ['Sumida Aquarium'], zh: ['墨田水族馆'] }
  },
  kidzania_tokyo: {
    station: '豊洲', walk_min: 3, category: '屋内型遊園地',
    note: { ja: '豊洲駅から徒歩約3分（ららぽーと豊洲内・子供向け体験型施設）', en: 'About 3 min walk from Toyosu Stn (LaLaport Toyosu, kids experience facility)', zh: '从丰洲站步行约3分钟（LaLaport丰洲内・儿童职业体验设施）' },
    names: { ja: ['キッザニア東京'], en: ['KidZania Tokyo'], zh: ['东京KidZania'] }
  },
  aqua_city_odaiba: {
    station: '台場', walk_min: 1, category: '複合文化施設',
    note: { ja: 'ゆりかもめ 台場駅から徒歩約1分（お台場の商業施設）', en: 'About 1 min walk from Daiba Stn on the Yurikamome (shopping complex)', zh: '从百合海鸥号台场站步行约1分钟（台场商业设施）' },
    names: { ja: ['アクアシティお台場'], en: ['Aqua City Odaiba'], zh: ['台场Aqua City'] }
  },
  // === #47: 延伸地域（千葉・埼玉・神奈川）の天文台・科学館・公園 ===
  national_astronomical_observatory: {
    station: '三鷹', walk_min: 15, category: '天文台',
    note: { ja: '三鷹駅からバス約15分（日本最大の天文研究機関・公開日あり）', en: 'About 15 min by bus from Mitaka Stn (Japan\'s largest astronomical research institute; public open days available)', zh: '从三鹰站乘巴士约15分钟（日本最大的天文研究机构・有公众开放日）' },
    names: { ja: ['国立天文台', 'NAOJ', '三鷹キャンパス'], en: ['National Astronomical Observatory of Japan', 'NAOJ', 'Mitaka Campus'], zh: ['国立天文台'] }
  },
  chiba_city_science_museum: {
    station: '県庁前', walk_min: 5, category: '科学館',
    note: { ja: '千葉モノレール 県庁前駅から徒歩約5分（プラネタリウム・体験型展示）', en: 'About 5 min walk from Kenchomae Stn on the Chiba Monorail (planetarium and hands-on exhibits)', zh: '从千叶单轨电车县厅前站步行约5分钟（天文馆・体验型展示）' },
    names: { ja: ['千葉市科学館'], en: ['Chiba City Museum of Science'], zh: ['千叶市科学馆'] }
  },
  national_museum_japanese_history: {
    station: '佐倉', walk_min: 10, category: '博物館',
    note: { ja: '佐倉駅からバス約10分（日本の歴史・民俗の総合博物館）', en: 'About 10 min by bus from Sakura Stn (comprehensive museum of Japanese history and folklore)', zh: '从佐仓站乘巴士约10分钟（日本历史・民俗综合博物馆）' },
    names: { ja: ['国立歴史民俗博物館', '歴博', 'れきはく'], en: ['National Museum of Japanese History', 'Rekihaku'], zh: ['国立历史民俗博物馆'] }
  },
  hamagin_children_science_museum: {
    station: '平沼橋', walk_min: 3, category: '科学館',
    note: { ja: '相鉄 平沼橋駅から徒歩約3分（宇宙・科学の体験型施設・愛称は「はまぎん」）', en: 'About 3 min walk from Hiranumabashi Stn on the Sotetsu Line (hands-on space & science museum nicknamed "Hama Wing")', zh: '从相铁平沼桥站步行约3分钟（宇宙・科学体验型设施・昵称「Hama Wing」）' },
    names: { ja: ['はまぎんこども宇宙科学館', 'はまぎん', 'Hama Wing'], en: ['Hamagin Children\'s Science Museum', 'Hama Wing'], zh: ['滨银儿童宇宙科学馆', 'Hama Wing'] }
  },
  saitama_youth_science_museum: {
    station: '与野本町', walk_min: 10, category: '科学館',
    note: { ja: '与野本町駅から徒歩約10分（プラネタリウム・科学実験）', en: 'About 10 min walk from Yono-Honmachi Stn (planetarium and science experiments)', zh: '从与野本町站步行约10分钟（天文馆・科学实验）' },
    names: { ja: ['さいたま市青少年科学館', 'サイエンスワールド'], en: ['Saitama City Youth Science Museum', 'Science World'], zh: ['埼玉市青少年科学馆'] }
  },
  kawaguchi_science_museum: {
    station: '川口', walk_min: 10, category: '科学館',
    note: { ja: '川口駅からバス約10分（プラネタリウム）', en: 'About 10 min by bus from Kawaguchi Stn (planetarium)', zh: '从川口站乘巴士约10分钟（天文馆）' },
    names: { ja: ['川口市立科学館', 'サイエンスワールド川口'], en: ['Kawaguchi City Science Museum', 'Science World Kawaguchi'], zh: ['川口市立科学馆'] }
  },
  sagamihara_city_museum: {
    station: '相模原', walk_min: 15, category: '博物館',
    note: { ja: '相模原駅からバス約15分（JAXA相模原キャンパス隣接・はやぶさ実物大模型）', en: 'About 15 min by bus from Sagamihara Stn (next to JAXA Sagamihara Campus; full-scale Hayabusa model)', zh: '从相模原站乘巴士约15分钟（紧邻JAXA相模原校区・隼鸟号实物大模型）' },
    names: { ja: ['相模原市立博物館'], en: ['Sagamihara City Museum'], zh: ['相模原市立博物馆'] }
  },
  chiba_modern_industry_museum: {
    station: '国府台', walk_min: 10, category: '科学館',
    note: { ja: '京成 国府台駅から徒歩約10分（科学技術の体験展示・市川）', en: 'About 10 min walk from Konodai Stn on the Keisei Line (hands-on science & technology exhibits, Ichikawa)', zh: '从京成国府台站步行约10分钟（科学技术体验展示・市川）' },
    names: { ja: ['千葉県立現代産業科学館'], en: ['Chiba Prefectural Museum of Modern Industrial Science'], zh: ['千叶县立现代产业科学馆'] }
  },
  chiba_prefectural_central_museum: {
    station: '千葉公園', walk_min: 10, category: '博物館',
    note: { ja: '千葉モノレール 千葉公園駅から徒歩約10分（千葉の自然・歴史・千葉公園隣接）', en: 'About 10 min walk from Chiba-Koen Stn on the Chiba Monorail (nature & history of Chiba, next to Chiba Park)', zh: '从千叶单轨电车千叶公园站步行约10分钟（千叶的自然・历史・紧邻千叶公园）' },
    names: { ja: ['千葉県立中央博物館'], en: ['Chiba Prefectural Central Museum'], zh: ['千叶县立中央博物馆'] }
  },
  boso_no_mura: {
    station: '成田', walk_min: 30, category: '博物館',
    note: { ja: '成田駅からバス約30分（房総の昔の町並み再現・体験型）', en: 'About 30 min by bus from Narita Stn (recreated old Boso townscapes; hands-on)', zh: '从成田站乘巴士约30分钟（再现房总古街景・体验型）' },
    names: { ja: ['千葉県立房総のむら', '房総のむら'], en: ['Boso no Mura', 'Boso-no-Mura'], zh: ['千叶县立房总之村', '房总之村'] }
  },
  sakura_castle_park: {
    station: '佐倉', walk_min: 15, category: '公園',
    note: { ja: '佐倉駅から徒歩約15分（佐倉城跡・桜の名所）', en: 'About 15 min walk from Sakura Stn (Sakura Castle ruins; famous cherry blossom spot)', zh: '从佐仓站步行约15分钟（佐仓城遗址・赏樱名胜）' },
    names: { ja: ['佐倉城址公園', '佐倉城跡'], en: ['Sakura Castle Ruins Park', 'Sakura Castle Site'], zh: ['佐仓城遗址公园'] }
  },
  shin_yokohama_park: {
    station: '新横浜', walk_min: 5, category: '公園',
    note: { ja: '新横浜駅から徒歩約5分（日産スタジアム・サッカー日本代表戦）', en: 'About 5 min walk from Shin-Yokohama Stn (Nissan Stadium, Japan national football team matches)', zh: '从新横滨站步行约5分钟（日产体育场・日本国家队比赛）' },
    names: { ja: ['新横浜公園', '日産スタジアム'], en: ['Shin-Yokohama Park', 'Nissan Stadium'], zh: ['新横滨公园', '日产体育场'] }
  },
  hitsujiyama_park: {
    station: '西武秩父', walk_min: 15, category: '公園',
    note: { ja: '西武秩父駅から徒歩約15分（芝桜の丘・4〜5月・約40万株）', en: 'About 15 min walk from Seibu-Chichibu Stn (Shakunage & moss phlox hill in Apr-May, about 400,000 plants)', zh: '从西武秩父站步行约15分钟（芝樱之丘・4～5月・约40万株）' },
    names: { ja: ['羊山公園', '芝桜の丘'], en: ['Hitsujiyama Park', 'Shakunage Hill'], zh: ['羊山公园', '芝樱之丘'] }
  },
  makuhari_seaside_park: {
    station: '海浜幕張', walk_min: 10, category: '公園',
    note: { ja: '海浜幕張駅から徒歩約10分（海浜公園・日本庭園）', en: 'About 10 min walk from Kaihin-Makuhari Stn (seaside park with Japanese garden)', zh: '从海滨幕张站步行约10分钟（海滨公园・日本庭园）' },
    names: { ja: ['幕張海浜公園'], en: ['Makuhari Seaside Park'], zh: ['幕张海滨公园'] }
  },
  // === #49: 外国人観光客向けアニメ・ゲーム系アミューズメントパーク ===
  wb_studio_tour_tokyo: {
    station: '豊島園', walk_min: 5, category: 'テーマパーク',
    note: { ja: '豊島園駅から徒歩約5分（ハリー・ポッターの映画制作体験型施設・日時指定チケット制）', en: 'About 5 min walk from Toshimaen Stn (Harry Potter movie-making experience; timed-entry ticket required)', zh: '从丰岛园站步行约5分钟（哈利·波特电影制作体验型设施・需指定日期时间门票）' },
    names: { ja: ['ワーナー ブラザース スタジオツアー東京', 'スタジオツアー東京', 'ハリー・ポッター スタジオツアー'], en: ['Warner Bros. Studio Tour Tokyo', 'Studio Tour Tokyo', 'Harry Potter Studio Tour'], zh: ['东京华纳兄弟影城之旅', '哈利波特影城之旅'] }
  },
  tokyo_joypolis: {
    station: 'お台場海浜公園', walk_min: 5, category: '屋内型遊園地',
    note: { ja: 'ゆりかもめ お台場海浜公園駅から徒歩約5分（デックス東京ビーチ内・屋内型アミューズメントパーク）', en: 'About 5 min walk from Odaiba-Kaihinkoen Stn on the Yurikamome (inside DECKS Tokyo Beach, indoor amusement park)', zh: '从百合海鸥号台场海滨公园站步行约5分钟（DECKS东京海滩内・室内游乐场）' },
    names: { ja: ['東京ジョイポリス', 'ジョイポリス'], en: ['Tokyo Joypolis', 'Joypolis'], zh: ['东京欢乐世界', '欢乐世界'] }
  },
  namja_town: {
    station: '池袋', walk_min: 8, category: '屋内型遊園地',
    note: { ja: '池袋駅から徒歩約8分（サンシャインシティ内・餃子スタジアム等）', en: 'About 8 min walk from Ikebukuro Stn (inside Sunshine City; Gyoza Stadium etc.)', zh: '从池袋站步行约8分钟（太阳城内・饺子体育场等）' },
    names: { ja: ['ナンジャタウン'], en: ['NAMJATOWN', 'Namja Town'], zh: ['NAMJATOWN', '南加亚城'] }
  },
  immersive_fort_tokyo: {
    station: '青海', walk_min: 5, category: 'テーマパーク',
    note: { ja: 'ゆりかもめ 青海駅から徒歩約5分（没入型テーマパーク・お台場）', en: 'About 5 min walk from Aomi Stn on the Yurikamome (immersive theme park in Odaiba)', zh: '从百合海鸥号青海站步行约5分钟（沉浸式主题公园・台场）' },
    names: { ja: ['イマーシブ・フォート東京', 'イマーシブフォート'], en: ['Immersive Fort Tokyo'], zh: ['沉浸式堡垒东京'] }
  },
  small_worlds_tokyo: {
    station: '有明', walk_min: 5, category: 'テーマパーク',
    note: { ja: 'ゆりかもめ 有明駅から徒歩約5分（ミニチュアテーマパーク・国際展示場駅からも徒歩約8分）', en: 'About 5 min walk from Ariake Stn on the Yurikamome (miniature theme park; approx. 8 min from Kokusai-Tenjijo Stn)', zh: '从百合海鸥号有明站步行约5分钟（微缩主题公园・从国际展示场站步行约8分钟）' },
    names: { ja: ['スモールワールズ東京', 'スモールワールズ'], en: ['Small Worlds Tokyo', 'Small Worlds'], zh: ['东京小世界', '小世界'] }
  },
  legoland_discovery_tokyo: {
    station: 'お台場海浜公園', walk_min: 5, category: '屋内型遊園地',
    note: { ja: 'ゆりかもめ お台場海浜公園駅から徒歩約5分（デックス東京ビーチ内・レゴの屋内型アミューズメントパーク）', en: 'About 5 min walk from Odaiba-Kaihinkoen Stn on the Yurikamome (inside DECKS Tokyo Beach, LEGO indoor amusement park)', zh: '从百合海鸥号台场海滨公园站步行约5分钟（DECKS东京海滩内・乐高室内游乐场）' },
    names: { ja: ['レゴランド・ディスカバリー・センター東京', 'レゴランドディスカバリー東京'], en: ['LEGOLAND Discovery Center Tokyo', 'LEGOLAND Discovery Center'], zh: ['乐高乐园探索中心东京'] }
  },
  gundam_base_tokyo: {
    station: '台場', walk_min: 5, category: 'テーマパーク',
    note: { ja: 'ゆりかもめ 台場駅から徒歩約5分（ダイバーシティ東京内・実物大立像あり）', en: 'About 5 min walk from Daiba Stn on the Yurikamome (inside DiverCity Tokyo; life-size Gundam statue)', zh: '从百合海鸥号台场站步行约5分钟（DiverCity东京内・有实物大高达立像）' },
    names: { ja: ['ガンダムベース東京', 'ガンダムベース', 'ガンダム立像'], en: ['The Gundam Base Tokyo', 'Gundam Base Tokyo'], zh: ['东京高达基地', '高达基地'] }
  },
  ghibli_museum: {
    station: '三鷹', walk_min: 5, category: '美術館',
    note: { ja: '三鷹駅からバス約5分（スタジオジブリのアニメ美術館・事前予約制）', en: 'About 5 min by bus from Mitaka Stn (Studio Ghibli anime museum; advance reservation required)', zh: '从三鹰站乘巴士约5分钟（吉卜力工作室动画美术馆・需提前预约）' },
    names: { ja: ['三鷹の森ジブリ美術館', 'ジブリ美術館'], en: ['Ghibli Museum, Mitaka', 'Ghibli Museum'], zh: ['三鹰之森吉卜力美术馆', '吉卜力美术馆'] }
  },
  fujiko_f_fujio_museum: {
    station: '登戸', walk_min: 10, category: '美術館',
    note: { ja: '登戸駅からバス約10分（ドラえもんの作者のミュージアム・事前予約制・シャトルバスあり）', en: 'About 10 min by bus from Noborito Stn (museum of the creator of Doraemon; advance reservation required; shuttle bus available)', zh: '从登户站乘巴士约10分钟（哆啦A梦作者博物馆・需提前预约・有穿梭巴士）' },
    names: { ja: ['藤子・F・不二雄ミュージアム', '藤子不二雄ミュージアム', 'ドラえもんミュージアム'], en: ['Fujiko F. Fujio Museum', 'Doraemon Museum'], zh: ['藤子·F·不二雄博物馆', '哆啦A梦博物馆'] }
  },
  maxell_aqua_park_shinagawa: {
    station: '品川', walk_min: 2, category: '水族館',
    note: { ja: '品川駅高輪口から徒歩約2分（デジタルアート水族館）', en: 'About 2 min walk from Shinagawa Stn Takanawa Exit (digital art aquarium)', zh: '从品川站高轮口步行约2分钟（数字艺术水族馆）' },
    names: { ja: ['マクセル アクアパーク品川', 'アクアパーク品川'], en: ['Maxell Aqua Park Shinagawa', 'Aqua Park Shinagawa'], zh: ['麦克斯尔水上乐园品川', '水上乐园品川'] }
  },
  // ===== 2026-08-09 v2.36.2: 科学館・博物館・美術館・公園・歴史館・動物園・ミュージアム（訪日客向け・延伸駅対応） =====
  national_museum_western_art: {
    station: '上野', walk_min: 7, category: '美術館',
    note: { ja: '上野駅公園口から徒歩約7分（世界遺産・松方コレクション）', en: 'About 7 min walk from Ueno Stn Park Exit (UNESCO World Heritage, Matsukata Collection)', zh: '从上野站公园口步行约7分钟（世界遗产・松方收藏）' },
    names: { ja: ['国立西洋美術館', '西洋美術館'], en: ['The National Museum of Western Art', 'National Museum of Western Art', 'NMWA'], zh: ['国立西洋美术馆', '西洋美术馆'] }
  },
  nezu_museum: {
    station: '表参道', walk_min: 10, category: '美術館',
    note: { ja: '表参道駅A5出口から徒歩約10分（東洋古美術・根津美術館）', en: 'About 10 min walk from Omotesando Stn A5 Exit (oriental art museum)', zh: '从表参道站A5出口步行约10分钟（东方古美术）' },
    names: { ja: ['根津美術館', '根津美術館 庭園'], en: ['Nezu Museum', 'Nezu Museum Garden'], zh: ['根津美术馆'] }
  },
  suntory_museum_of_art: {
    station: '六本木', walk_min: 5, category: '美術館',
    note: { ja: '六本木駅から徒歩約5分（東京ミッドタウン内）', en: 'About 5 min walk from Roppongi Stn (inside Tokyo Midtown)', zh: '从六本木站步行约5分钟（位于东京中城）' },
    names: { ja: ['サントリー美術館'], en: ['Suntory Museum of Art'], zh: ['三得利美术馆'] },
  },
  design_sight_2121: {
    station: '六本木', walk_min: 5, category: '美術館',
    note: { ja: '六本木駅から徒歩約5分（東京ミッドタウン内・デザイン美術館）', en: 'About 5 min walk from Roppongi Stn (design museum in Tokyo Midtown)', zh: '从六本木站步行约5分钟（东京中城内的设计美术馆）' },
    names: { ja: ['21_21 DESIGN SIGHT', '21-21デザインサイト'], en: ['21_21 DESIGN SIGHT'], zh: ['21_21设计视野'] }
  },
  momat: {
    station: '竹橋', walk_min: 3, category: '美術館',
    note: { ja: '竹橋駅1b出口から徒歩約3分（近代美術館・皇居外苑隣）', en: 'About 3 min walk from Takebashi Stn 1b Exit (modern art museum)', zh: '从竹桥站1b出口步行约3分钟（近代美术馆）' },
    names: { ja: ['東京国立近代美術館', 'MOMAT', '近代美術館'], en: ['The National Museum of Modern Art, Tokyo', 'MOMAT'], zh: ['东京国立近代美术馆', 'MOMAT'] }
  },
  tokyo_photographic_art_museum: {
    station: '恵比寿', walk_min: 5, category: '美術館',
    note: { ja: '恵比寿駅東口から徒歩約5分（恵比寿ガーデンプレイス内）', en: 'About 5 min walk from Ebisu Stn East Exit (in Yebisu Garden Place)', zh: '从惠比寿站东口步行约5分钟（位于惠比寿花园广场）' },
    names: { ja: ['東京都写真美術館', '写美', 'TOP美術館'], en: ['Tokyo Photographic Art Museum', 'TOP Museum'], zh: ['东京都写真美术馆', '写美'] }
  },
  tokyo_metropolitan_teien_museum: {
    station: '目黒', walk_min: 7, category: '美術館',
    note: { ja: '目黒駅東口から徒歩約7分（アール・デコ様式の旧朝香宮邸）', en: 'About 7 min walk from Meguro Stn East Exit (Art Deco former Asaka residence)', zh: '从目黑站东口步行约7分钟（装饰艺术风格的旧朝香宫邸）' },
    names: { ja: ['東京都庭園美術館', '庭園美術館'], en: ['Tokyo Metropolitan Teien Art Museum', 'Teien Art Museum'], zh: ['东京都庭园美术馆'] }
  },
  national_film_archive: {
    station: '京橋', walk_min: 3, category: '博物館',
    note: { ja: '京橋駅から徒歩約3分（国立映画アーカイブ・旧フィルムセンター）', en: 'About 3 min walk from Kyobashi Stn (national film archive)', zh: '从京桥站步行约3分钟（国立电影资料馆）' },
    names: { ja: ['国立映画アーカイブ', 'NFC', 'フィルムセンター'], en: ['National Film Archive of Japan', 'NFAJ'], zh: ['国立电影资料馆'] }
  },
  edo_tokyo_open_air_architectural_museum: {
    station: '花小金井', walk_min: 20, category: '博物館',
    note: { ja: '花小金井駅から徒歩約20分（小金井公園内・歴史的建造物の野外博物館）', en: 'About 20 min walk from Hanakoganei Stn (open-air museum of historic buildings in Koganei Park)', zh: '从花小金井站步行约20分钟（小金井公园内的历史建筑露天博物馆）' },
    names: { ja: ['江戸東京たてもの園', 'たてもの園'], en: ['Edo-Tokyo Open Air Architectural Museum'], zh: ['江户东京建筑园'] }
  },
  showakan: {
    station: '九段下', walk_min: 5, category: '博物館',
    note: { ja: '九段下駅から徒歩約5分（戦中・戦後の暮らしを伝える歴史館）', en: 'About 5 min walk from Kudanshita Stn (museum of wartime & postwar daily life)', zh: '从九段下站步行约5分钟（战争时期及战后生活史馆）' },
    names: { ja: ['昭和館'], en: ['Showa-kan', 'Showa Hall'], zh: ['昭和馆'] }
  },
  national_archives_japan: {
    station: '竹橋', walk_min: 5, category: '博物館',
    note: { ja: '竹橋駅から徒歩約5分（国の公文書を保存・公開）', en: 'About 5 min walk from Takebashi Stn (national archives of Japan)', zh: '从竹桥站步行约5分钟（日本国家档案馆）' },
    names: { ja: ['国立公文書館'], en: ['National Archives of Japan'], zh: ['国立公文书馆'] }
  },
  printing_museum: {
    station: '飯田橋', walk_min: 7, category: '博物館',
    note: { ja: '飯田橋駅から徒歩約7分（印刷の歴史・凸版印刷）', en: 'About 7 min walk from Iidabashi Stn (history of printing)', zh: '从饭田桥站步行约7分钟（印刷历史）' },
    names: { ja: ['印刷博物館', 'プリントミュージアム'], en: ['Printing Museum', 'Printing Museum Tokyo'], zh: ['印刷博物馆'] }
  },
  currency_museum: {
    station: '日本橋', walk_min: 3, category: '博物館',
    note: { ja: '日本橋駅から徒歩約3分（日本銀行金融研究所・お金の博物館）', en: 'About 3 min walk from Nihombashi Stn (money museum of the Bank of Japan)', zh: '从日本桥站步行约3分钟（日本银行金融研究所货币博物馆）' },
    names: { ja: ['貨幣博物館', 'お金の博物館'], en: ['Currency Museum', 'Bank of Japan Currency Museum'], zh: ['货币博物馆'] }
  },
  postal_museum_japan: {
    station: '押上', walk_min: 5, category: '博物館',
    note: { ja: '押上駅から徒歩約5分（東京スカイツリータウン内・郵便の博物館）', en: 'About 5 min walk from Oshiage Stn (postal museum in Tokyo Skytree Town)', zh: '从押上站步行约5分钟（东京晴空塔城内的邮政博物馆）' },
    names: { ja: ['郵政博物館', '切手博物館'], en: ['Postal Museum Japan'], zh: ['邮政博物馆'] }
  },
  police_museum: {
    station: '京橋', walk_min: 3, category: '博物館',
    note: { ja: '京橋駅から徒歩約3分（警察の歴史・無料）', en: 'About 3 min walk from Kyobashi Stn (police history museum, free)', zh: '从京桥站步行约3分钟（警察历史・免费）' },
    names: { ja: ['警察博物館'], en: ['Police Museum'], zh: ['警察博物馆'] }
  },
  fire_museum: {
    station: '四ツ谷', walk_min: 3, category: '博物館',
    note: { ja: '四ツ谷駅から徒歩約3分（消防の歴史・無料）', en: 'About 3 min walk from Yotsuya Stn (firefighting history, free)', zh: '从四谷站步行约3分钟（消防历史・免费）' },
    names: { ja: ['消防博物館'], en: ['Fire Museum'], zh: ['消防博物馆'] }
  },
  tokyo_toy_museum: {
    station: '四ツ谷', walk_min: 5, category: '博物館',
    note: { ja: '四ツ谷駅から徒歩約5分（おもちゃの美術館・体験型）', en: 'About 5 min walk from Yotsuya Stn (hands-on toy museum)', zh: '从四谷站步行约5分钟（互动式玩具美术馆）' },
    names: { ja: ['東京おもちゃ美術館', 'おもちゃ美術館'], en: ['Tokyo Toy Museum'], zh: ['东京玩具美术馆'] }
  },
  meguro_parasitological_museum: {
    station: '目黒', walk_min: 5, category: '博物館',
    note: { ja: '目黒駅から徒歩約5分（寄生虫の博物館・無料・世界的に珍しい）', en: 'About 5 min walk from Meguro Stn (parasite museum, free, world-renowned)', zh: '从目黑站步行约5分钟（寄生虫博物馆・免费・世界闻名）' },
    names: { ja: ['目黒寄生虫館', '寄生虫館'], en: ['Meguro Parasitological Museum'], zh: ['目黑寄生虫馆'] }
  },
  national_theatre_japan: {
    station: '永田町', walk_min: 5, category: '劇場',
    note: { ja: '永田町駅から徒歩約5分（歌舞伎・能楽などの国立劇場）', en: 'About 5 min walk from Nagatacho Stn (national theatre for kabuki, noh, etc.)', zh: '从永田町站步行约5分钟（歌舞伎・能乐等国立剧场）' },
    names: { ja: ['国立劇場'], en: ['National Theatre of Japan'], zh: ['国立剧场'] }
  },
  new_national_theatre_tokyo: {
    station: '初台', walk_min: 3, category: '劇場',
    note: { ja: '初台駅から徒歩約3分（オペラ・バレエの新国立劇場）', en: 'About 3 min walk from Hatsudai Stn (opera & ballet theatre)', zh: '从初台站步行约3分钟（歌剧・芭蕾剧场）' },
    names: { ja: ['新国立劇場'], en: ['New National Theatre Tokyo'], zh: ['新国立剧场'] }
  },
  tokyo_metropolitan_theatre: {
    station: '池袋', walk_min: 2, category: '劇場',
    note: { ja: '池袋駅西口から徒歩約2分（東京芸術劇場）', en: 'About 2 min walk from Ikebukuro Stn West Exit', zh: '从池袋站西口步行约2分钟' },
    names: { ja: ['東京芸術劇場', '芸術劇場'], en: ['Tokyo Metropolitan Theatre'], zh: ['东京艺术剧场'] }
  },
  kasai_seaside_aquarium: {
    station: '葛西臨海公園', walk_min: 5, category: '水族館',
    note: { ja: '葛西臨海公園駅から徒歩約5分（マグロの回遊水槽・無料）', en: 'About 5 min walk from Kasai-Rinkai-Koen Stn (tuna school tank, free)', zh: '从葛西临海公园站步行约5分钟（金枪鱼洄游水槽・免费）' },
    names: { ja: ['葛西臨海水族園', '葛西臨海水族館'], en: ['Tokyo Sea Life Park', 'Kasai Rinkai Aquarium'], zh: ['葛西临海水族园'] }
  },
  odaiba_seaside_park: {
    station: 'お台場海浜公園', walk_min: 1, category: '公園',
    note: { ja: 'ゆりかもめ「お台場海浜公園」駅直結（砂浜とレインボーブリッジ）', en: 'Directly connected to Odaiba-Kaihinkoen Stn (Yurikamome); beach & Rainbow Bridge views', zh: '与百合海鸥号「台场海滨公园」站直连（沙滩与彩虹大桥）' },
    names: { ja: ['お台場海浜公園', '台場海浜公園', 'お台場ビーチ'], en: ['Odaiba Seaside Park', 'Odaiba Beach'], zh: ['台场海滨公园', '台场沙滩'] }
  },
  yasukuni_shrine: {
    station: '九段下', walk_min: 5, category: '神社',
    note: { ja: '九段下駅から徒歩約5分', en: 'About 5 min walk from Kudanshita Stn', zh: '从九段下站步行约5分钟' },
    names: { ja: ['靖国神社'], en: ['Yasukuni Shrine'], zh: ['靖国神社'] }
  },
  sengakuji: {
    station: '泉岳寺', walk_min: 3, category: '寺院',
    note: { ja: '泉岳寺駅から徒歩約3分（赤穂浪士の墓所）', en: 'About 3 min walk from Sengakuji Stn (burial site of the 47 Ronin)', zh: '从泉岳寺站步行约3分钟（赤穗浪士之墓）' },
    names: { ja: ['泉岳寺', '赤穂義士記念館'], en: ['Sengaku-ji', 'Sengakuji Temple'], zh: ['泉岳寺'] }
  },
  jindaiji: {
    station: '調布', walk_min: 25, category: '寺院',
    note: { ja: '調布駅からバス約15分（深大寺・蕎麦と鬼太郎茶屋）', en: 'About 15 min by bus from Chofu Stn (Jindaiji Temple, soba & Gegegeno Kitaro teahouse)', zh: '从调布站乘巴士约15分钟（深大寺・荞麦面与鬼太郎茶馆）' },
    names: { ja: ['深大寺', '深大寺蕎麦'], en: ['Jindaiji Temple', 'Jindai-ji'], zh: ['深大寺'] }
  },
  takao_san: {
    station: '高尾山口', walk_min: 5, category: '公園',
    note: { ja: '高尾山口駅から徒歩約5分（ケーブルカー乗り場・ミシュラン三つ星の山）', en: 'About 5 min walk from Takaosanguchi Stn (cable car station; Michelin 3-star mountain)', zh: '从高尾山口站步行约5分钟（缆车站・米其林三星之山）' },
    names: { ja: ['高尾山', '高尾山ケーブルカー'], en: ['Mount Takao', 'Mt. Takao'], zh: ['高尾山'] }
  }
};

export const LANDMARK_LOOKUP = {};
for (const [defKey, def] of Object.entries(LANDMARK_DEFS)) {
  for (const lang of ['ja', 'en', 'zh']) {
    for (const n of (def.names[lang] || [])) {
      LANDMARK_LOOKUP[n.toLowerCase()] = { defKey, lang, original: n };
    }
  }
}

export const DESTINATION_CULTURAL_FACILITIES = {
  '六本木': [
    ['森美術館', 'Mori Art Museum', '森美术馆', '美術館', 5],
    ['東京ミッドタウン', 'Tokyo Midtown', '东京中城', '複合文化施設', 5]
  ],
  '乃木坂': [['国立新美術館', 'The National Art Center, Tokyo', '国立新美术馆', '美術館', 1]],
  '神谷町': [['チームラボボーダレス', 'teamLab Borderless', 'teamLab无界', 'デジタルアート', 3], ['麻布台ヒルズ', 'Azabudai Hills', '麻布台之丘', '複合文化施設', 3]],
  '御茶ノ水': [['神田明神', 'Kanda Myojin Shrine', '神田明神', '神社', 5], ['湯島聖堂', 'Yushima Seido', '汤岛圣堂', '史跡・文化施設', 5]],
  '築地': [['築地本願寺', 'Tsukiji Hongwanji Temple', '筑地本愿寺', '寺院', 1], ['築地場外市場', 'Tsukiji Outer Market', '筑地场外市场', '市場・食文化', 3]],
  '東銀座': [['歌舞伎座', 'Kabukiza Theatre', '歌舞伎座', '伝統芸能', 1]],
  '都庁前': [['東京都庁展望室', 'Tokyo Metropolitan Government Observation Deck', '东京都厅展望室', '展望・建築', 1], ['SOMPO美術館', 'SOMPO Museum of Art', 'SOMPO美术馆', '美術館', 10]],
  '池袋': [['サンシャイン水族館', 'Sunshine Aquarium', '阳光水族馆', '水族館', 8], ['東京芸術劇場', 'Tokyo Metropolitan Theatre', '东京艺术剧场', '劇場', 2]],
  '東京テレポート': [['日本科学未来館', 'Miraikan', '日本科学未来馆', '科学館', 5], ['東京ジョイポリス', 'Tokyo Joypolis', '东京欢乐世界', '屋内型遊園地', 5]],
  '東京': [['東京駅丸の内駅舎', 'Tokyo Station Marunouchi Building', '东京站丸之内站房', '歴史建築', 1], ['三菱一号館美術館', 'Mitsubishi Ichigokan Museum', '三菱一号馆美术馆', '美術館', 5]],
  '上野': [['東京国立博物館', 'Tokyo National Museum', '东京国立博物馆', '博物館', 5], ['国立科学博物館', 'National Museum of Nature and Science', '国立科学博物馆', '博物館', 5], ['東京都美術館', 'Tokyo Metropolitan Art Museum', '东京都美术馆', '美術館', 7]],
  '浅草': [['浅草寺', 'Sensoji Temple', '浅草寺', '寺院', 5], ['浅草花やしき', 'Hanayashiki Amusement Park', '浅草花屋敷', '遊園地', 5]],
  '清澄白河': [['東京都現代美術館', 'Museum of Contemporary Art Tokyo', '东京都现代美术馆', '美術館', 10], ['清澄庭園', 'Kiyosumi Gardens', '清澄庭园', '庭園', 3]],
  '両国': [['江戸東京博物館', 'Edo-Tokyo Museum', '江户东京博物馆', '博物館', 3], ['すみだ北斎美術館', 'The Sumida Hokusai Museum', '墨田北斋美术馆', '美術館', 8]],
  '竹橋': [['東京国立近代美術館', 'The National Museum of Modern Art, Tokyo', '东京国立近代美术馆', '美術館', 3]],
  '竹芝': [
    ['浜離宮恩賜庭園', 'Hama-rikyu Gardens', '滨离宫恩赐庭园', '庭園', 5],
    ['竹芝桟橋（東海汽船ターミナル）', 'Takeshiba Pier (Tokai Kisen Ferry Terminal)', '竹芝码头（东海汽船轮渡码头）', 'フェリーターミナル', 3],
    ['日の出桟橋（水上バス）', 'Hinode Pier (Water Bus)', '日出码头（水上巴士）', '水上バス乗り場', 10]
  ],
  // #48: 延伸駅の到着時文化施設（自動導出に無いもののみ明示追加。残りは LANDMARK_DEFS から自動導出）
  '西武秩父': [['秩父神社', 'Chichibu Shrine', '秩父神社', '神社', 10]],
  '江ノ島': [
    ['江ノ島展望灯台', 'Enoshima Sea Candle (Observation Lighthouse)', '江之岛展望灯塔', '展望・建築', 10],
    ['湘南海岸公園', 'Shonan Seaside Park', '湘南海岸公园', '公園', 5]
  ],
  '千葉': [['千葉市科学館', 'Chiba City Museum of Science', '千叶市科学馆', '科学館', 10]],
  '越生': [['越生梅林', 'Ogose Plum Grove', '越生梅林', '公園', 15]]
};

export const CULTURAL_CATEGORY_NAMES = {
  '美術館': { en: 'Museum', zh: '美术馆' },
  '複合文化施設': { en: 'Cultural complex', zh: '综合文化设施' },
  'デジタルアート': { en: 'Digital art', zh: '数字艺术' },
  '神社': { en: 'Shrine', zh: '神社' },
  '史跡・文化施設': { en: 'Historic cultural site', zh: '历史文化遗址' },
  '寺院': { en: 'Temple', zh: '寺院' },
  '市場・食文化': { en: 'Market and food culture', zh: '市场・饮食文化' },
  '伝統芸能': { en: 'Traditional performing arts', zh: '传统艺能' },
  '展望・建築': { en: 'Viewpoint and architecture', zh: '展望・建筑' },
  '水族館': { en: 'Aquarium', zh: '水族馆' },
  '劇場': { en: 'Theatre', zh: '剧场' },
  '科学館': { en: 'Science museum', zh: '科学馆' },
  '屋内型遊園地': { en: 'Indoor amusement park', zh: '室内游乐园' },
  '歴史建築': { en: 'Historic architecture', zh: '历史建筑' },
  '博物館': { en: 'Museum', zh: '博物馆' },
  '遊園地': { en: 'Amusement park', zh: '游乐园' },
  '庭園': { en: 'Garden', zh: '庭园' },
  '公園': { en: 'Park', zh: '公园' },
  '天文台': { en: 'Observatory', zh: '天文台' },
  'テーマパーク': { en: 'Theme park', zh: '主题公园' },
  '展示施設': { en: 'Exhibition facility', zh: '展览设施' },
  'スポーツ施設': { en: 'Sports facility', zh: '体育设施' },
  '動物園': { en: 'Zoo', zh: '动物园' }
};

export const DERIVED_CULTURAL_FACILITIES = {};
for (const def of Object.values(LANDMARK_DEFS)) {
  if (!def.station) continue;
  const ja = (def.names?.ja?.[0]) || '';
  if (!ja) continue;
  const en = (def.names?.en?.[0]) || ja;
  const zh = (def.names?.zh?.[0]) || ja;
  const category = def.category || '文化施設';
  (DERIVED_CULTURAL_FACILITIES[def.station] ||= []).push([ja, en, zh, category, def.walk_min || 5]);
}
