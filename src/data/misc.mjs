/**
 * その他辞書・設定（モノリス分割 Phase 2d-3）
 * WEATHER_TERM_MAP / TRAIN_INFO_TERM_MAP / OPERATOR_MAP / NON_RAIL_OPERATORS /
 * JMA_AREA_MAP / JMA_AREA_LABELS / GSI_* / FAILURE_TYPES / MULTILINGUAL_ADVICE /
 * LIMITED_EXPRESS_* / AIRPORT_* / GBFS_BASE / 公的機関・避難所検索URL。
 * 参照ロジック（translateWeather / searchFlight / buildLimitedExpressGuidance 等）は index.mjs 側。
 */

export const FAILURE_TYPES = {
  'typhoon': {
    type: 'weather', adviceKey: 'typhoon', isRainy: true, isSevereWeather: true, isTrainSuspended: true,
    keywords: { ja: ['台風'], en: ['typhoon'], zh: ['台风', '颱風'] },
    weatherText: { ja: "台風接近に伴う大雨・暴風特別警報", en: "Special heavy rain and wind warning due to approaching typhoon", zh: "台风逼近引发的大雨暴风特别警报" },
    delayMessage: { ja: "台風接近・特別警報・運転見合わせ", en: "Approaching typhoon / Emergency warning / Service suspended", zh: "台风逼近・特别警报・列车暂停运行" }
  },
  'earthquake': {
    type: 'disaster', adviceKey: 'earthquake', isTrainSuspended: true,
    keywords: { ja: ['地震'], en: ['earthquake', 'quake'], zh: ['地震'] },
    weatherText: { ja: "地震発生に伴う緊急情報", en: "Emergency notice due to earthquake", zh: "地震引发的紧急信息" },
    delayMessage: { ja: "地震による一時運行停止", en: "Temporary service suspension due to earthquake", zh: "因地震导致临时暂停运行" }
  },
  'flood': {
    type: 'flood', adviceKey: 'flood', isRainy: true, isSevereWeather: true, isTrainSuspended: true,
    keywords: { ja: ['浸水'], en: ['flood', 'flooding', 'inundation'], zh: ['积水', '積水', '淹水', '浸水'] },
    weatherText: { ja: "浸水による運行停止", en: "Service suspended due to flooding", zh: "因积水导致暂停运行" },
    delayMessage: { ja: "駅周辺浸水・運転見合わせ", en: "Station area flooding / Service suspended", zh: "车站周边积水・列车暂停运行" }
  },
  'accident': {
    type: 'accident', adviceKey: 'accident', isTrainSuspended: true,
    keywords: { ja: ['人身事故', '事故', '列車衝突事故', '列車脱線事故', '踏切障害事故', '道路障害事故', '鉄道人身事故', '鉄道物損事故'], en: ['accident', 'personal_accident', 'injury', 'person_accident', 'crash'], zh: ['人身事故', '人员伤亡', '人員傷亡', '事故'] },
    weatherText: { ja: "人身事故発生", en: "Personal accident occurred", zh: "发生人身事故" },
    delayMessage: { ja: "人身事故による運転見合わせ", en: "Service suspended due to a personal injury accident", zh: "因人身事故导致列车暂停运行" }
  },
  'fire': {
    type: 'disaster', adviceKey: 'fire', isTrainSuspended: true,
    keywords: { ja: ['火災', '列車火災事故'], en: ['fire'], zh: ['火灾', '火災'] },
    weatherText: { ja: "火災発生に伴う緊急警戒", en: "Emergency alert due to fire incident", zh: "火灾引发的紧急警戒" },
    delayMessage: { ja: "火災による運行停止", en: "Service suspended due to fire", zh: "因发生火灾导致列车暂停运行" }
  },
  'power_outage': {
    type: 'infrastructure', adviceKey: 'infrastructure', isRainy: true, isTrainSuspended: true,
    keywords: { ja: ['停電'], en: ['power_outage', 'blackout', 'power_failure', 'outage'], zh: ['停电', '停電'] },
    weatherText: { ja: "停電による雨天警戒", en: "Warning due to power outage", zh: "因停电发布警戒" },
    delayMessage: { ja: "停電による列車停止", en: "Train stopped due to power outage", zh: "因停电导致列车停止运行" }
  },
  'signal_failure': {
    type: 'infrastructure', adviceKey: 'infrastructure', isTrainSuspended: true,
    keywords: { ja: ['信号故障', '線路破損'], en: ['signal_failure', 'signal', 'track_damage'], zh: ['信号故障', '信號故障', '线路损坏'] },
    weatherText: { ja: "信号系統設備障害", en: "Signal system infrastructure failure", zh: "信号系统设备故障" },
    delayMessage: { ja: "信号故障による運行停止", en: "Service suspended due to signal failure", zh: "因信号故障导致列车暂停运行" }
  },
  'extreme_heat': {
    type: 'weather', adviceKey: 'hot', isHot: true,
    keywords: { ja: ['猛暑'], en: ['extreme_heat', 'heatwave', 'heat_wave'], zh: ['酷暑', '高温', '高溫'] },
    weatherText: { ja: "猛暑日・高温注意報", en: "Extreme heat day / High temperature advisory", zh: "酷暑日・高温预警" },
    delayMessage: { ja: "熱中症注意", en: "Heatstroke warning in effect", zh: "注意预防中暑" }
  },
  'heatstroke': {
    type: 'weather', adviceKey: 'hot', isHot: true,
    keywords: { ja: ['熱中症'], en: ['heatstroke', 'heat_stroke'], zh: ['中暑'] },
    weatherText: { ja: "熱中症警戒アラート発令中", en: "Heatstroke alert issued", zh: "防暑降温预警生效中" },
    delayMessage: { ja: "熱中症警戒アラート", en: "Heatstroke Alert", zh: "高温中暑警戒预警" }
  },
  'snow': {
    type: 'weather', adviceKey: 'snow', isRainy: true, isTrainSuspended: true,
    keywords: { ja: ['降雪', '積雪', '大雪'], en: ['snow', 'snowfall', 'heavy_snow'], zh: ['降雪', '积雪', '積雪', '大雪'] },
    weatherText: { ja: "降雪による路面凍結注意", en: "Beware of frozen walkways due to snowfall", zh: "降雪路面结冰请注意安全" },
    delayMessage: { ja: "積雪による運行遅延・駅構内滑り注意", en: "Delays due to snow / Beware of slippery walkways in stations", zh: "因积雪导致列车延误・请注意车站内地面湿滑" }
  },
  'heavy_rain': {
    type: 'weather', adviceKey: 'flood', isRainy: true, isSevereWeather: true, isTrainSuspended: true,
    keywords: { ja: ['豪雨', '大雨'], en: ['heavy_rain', 'torrential_rain'], zh: ['暴雨', '豪雨', '大雨'] },
    weatherText: { ja: "豪雨による洪水・土砂災害警戒", en: "Flood and landslide warning due to heavy rain", zh: "暴雨引发洪水・泥石流灾害预警" },
    delayMessage: { ja: "大雨による視界不良・浸水注意報", en: "Poor visibility due to heavy rain / Flood advisory", zh: "大雨视线不良・发布浸水预警" }
  },
  'tsunami': {
    type: 'disaster', adviceKey: 'emergency', isTrainSuspended: true,
    keywords: { ja: ['津波'], en: ['tsunami'], zh: ['海啸', '海嘯', '津波'] },
    weatherText: { ja: "津波警報発表", en: "Tsunami warning issued", zh: "发布海啸预警" },
    delayMessage: { ja: "津波による運行停止", en: "Service suspended due to tsunami warning", zh: "因海啸预警暂停运行" }
  },
  'vehicle_failure': {
    type: 'equipment', adviceKey: 'vehicle_failure', isTrainSuspended: true,
    keywords: { ja: ['車両故障', '車両トラブル', '車両火災', 'ドア故障', 'ドア閉鎖不良', 'バス車両故障', 'バス故障', '機材故障', '航空機故障', '機体故障'], en: ['vehicle_failure', 'vehicle_trouble', 'train_failure', 'rolling_stock_failure', 'door_failure', 'bus_failure', 'aircraft_failure', 'equipment_failure'], zh: ['车辆故障', '車輛故障', '列车故障', '车门故障', '巴士故障', '公交故障', '飞机故障', '機材故障', '機體故障'] },
    weatherText: { ja: "機材故障の発生", en: "Vehicle/equipment failure occurred", zh: "发生机材故障" },
    delayMessage: { ja: "機材故障による運行見合わせ", en: "Service suspended due to equipment failure", zh: "因机材故障暂停运行" }
  },
  'vehicle_delay': {
    type: 'equipment', adviceKey: 'vehicle_delay', isTrainSuspended: false,
    keywords: { ja: ['遅延', '列車遅延', '車両遅延', 'ダイヤ乱れ', 'ダイヤ遅延', '運転遅延', '到着遅れ'], en: ['delay', 'train_delay', 'vehicle_delay', 'service_delay', 'delayed', 'running_late'], zh: ['晚点', '晚點', '延误', '延誤', '列车晚点', '列车延误', '车辆延误'] },
    weatherText: { ja: "車両遅延の発生", en: "Train/vehicle delay occurred", zh: "发生列车晚点" },
    delayMessage: { ja: "車両遅延によりダイヤが乱れています", en: "Services are delayed due to a train/vehicle delay", zh: "因列车晚点导致运行时刻表混乱" }
  },
  'gate_baggage_delay': {
    type: 'airport', adviceKey: 'gate_baggage_delay', isTrainSuspended: false,
    keywords: { ja: ['ゲート遅延', '手荷物遅延', '手荷物受取遅延', 'ゲート変更', '到着ゲート遅れ'], en: ['gate_delay', 'baggage_delay', 'gate_change', 'baggage_claim_delay', 'arrival_gate_delay'], zh: ['登机口延误', '行李延误', '行李领取延误', '登机口变更', '到达口延误'] },
    weatherText: { ja: "ゲート・手荷物の遅延", en: "Gate/baggage delay", zh: "登机口/行李延误" },
    delayMessage: { ja: "ゲート変更または手荷物受取の遅延が発生しています", en: "Gate change or baggage claim delay occurred", zh: "发生登机口变更或行李领取延误" }
  },
  'bus_traffic_jam': {
    type: 'bus', adviceKey: 'bus_traffic_jam', isTrainSuspended: false,
    keywords: { ja: ['渋滞', 'バス渋滞', '道路渋滞', '交通渋滞'], en: ['traffic_jam', 'bus_traffic_jam', 'congestion', 'road_congestion'], zh: ['堵车', '巴士拥堵', '公交拥堵', '交通拥堵', '道路拥堵'] },
    weatherText: { ja: "渋滞によるバス遅延", en: "Bus delay due to traffic congestion", zh: "因交通拥堵导致公交延误" },
    delayMessage: { ja: "道路渋滞によるバス遅延が発生しています", en: "Bus delays due to road congestion", zh: "因道路拥堵发生公交延误" }
  },
  'ferry_rough_seas': {
    type: 'ferry', adviceKey: 'ferry_rough_seas', isTrainSuspended: false,
    keywords: { ja: ['荒天', '高波', '強風', 'フェリー欠航', '船舶トラブル', '機関故障'], en: ['rough_seas', 'high_waves', 'ferry_cancelled', 'ferry_suspended', 'vessel_trouble'], zh: ['风浪', '大浪', '大风', '渡轮停航', '船舶故障'] },
    weatherText: { ja: "荒天・高波によるフェリー欠航", en: "Ferry cancellation due to rough seas", zh: "因风浪导致渡轮停航" },
    delayMessage: { ja: "荒天・高波によりフェリー・水上バスが欠航しています", en: "Ferries and water buses suspended due to rough seas", zh: "因风浪渡轮及水上巴士停航" }
  },
  'fallen_tree': {
    type: 'weather', adviceKey: 'fallen_tree', isRainy: true, isSevereWeather: true, isTrainSuspended: true,
    keywords: { ja: ['倒木', '倒木除去', '倒木処理', '樹木倒伏', '木の倒壊'], en: ['fallen_tree', 'falling_tree', 'tree_fall', 'tree_on_track', 'trees_on_line', 'uprooted_tree'], zh: ['倒木', '树木倒伏', '樹木倒伏', '断树', '树木倒塌'] },
    weatherText: { ja: "強風による倒木・運転見合わせ", en: "Service suspended due to fallen trees from strong winds", zh: "因强风导致树木倒伏・暂停运行" },
    delayMessage: { ja: "倒木による運転見合わせ", en: "Service suspended due to fallen trees", zh: "因倒木暂停运行" }
  },
  'service_suspension': {
    type: 'disaster', adviceKey: 'service_suspension', isTrainSuspended: true,
    keywords: { ja: ['運転見合わせ', '運休', '終日運転見合わせ'], en: ['service_suspension', 'operation_suspended', 'not_running', 'services_suspended'], zh: ['暂停运行', '停运', '暂停运营'] },
    weatherText: { ja: "運転見合わせ・運休", en: "Service suspension", zh: "列车暂停运行" },
    delayMessage: { ja: "運転を見合わせています", en: "Train services are suspended", zh: "列车暂停运行" }
  },
  'service_resumed': {
    type: 'weather', adviceKey: 'service_resumed', isTrainSuspended: false,
    keywords: { ja: ['運転再開', '再開しました', '復旧しました', '運転を再開'], en: ['resumed', 'service_resumed', 'reopened', 'restored', 'running_again'], zh: ['恢复运行', '恢复运营', '恢复通车'] },
    weatherText: { ja: "運転を再開しました・復旧", en: "Services resumed / recovered", zh: "恢复运行・已恢复" },
    delayMessage: { ja: "運転を再開しました（遅延が残る場合があります）", en: "Services resumed (residual delays may remain)", zh: "已恢复运行（可能仍有残余晚点）" }
  }
};

export const GSI_MUNICIPALITY_CODES = {
  '東京': '13101', '大手町': '13101', '秋葉原': '13101', '神田': '13101', '御茶ノ水': '13101',
  '有楽町': '13101', '日比谷': '13101', '新宿': '13104', '渋谷': '13113', '池袋': '13116',
  '上野': '13106', '浅草': '13106', '品川': '13109', '浜松町': '13103', '田町': '13103',
  '六本木': '13103', '新橋': '13103', '銀座': '13102', '築地': '13102', 'お台場海浜公園': '13108',
    '豊洲': '13108', '日の出桟橋': '13103', '浜離宮': '13102', '竹芝': '13103',
  '羽田空港': '13111', '羽田空港第1ターミナル': '13111', '羽田空港第2ターミナル': '13111', '羽田空港第1・第2ターミナル': '13111',
  '羽田空港第3ターミナル': '13111', '横浜': '14100', '川崎': '14130'
};

export const GSI_MUNICIPALITY_LABELS = {
  '13101': '東京都千代田区', '13102': '東京都中央区', '13103': '東京都港区', '13104': '東京都新宿区',
  '13105': '東京都文京区', '13106': '東京都台東区', '13108': '東京都江東区', '13109': '東京都品川区',
  '13111': '東京都大田区', '13113': '東京都渋谷区', '13116': '東京都豊島区',
  '14100': '神奈川県横浜市', '14130': '神奈川県川崎市'
};

export const GSI_SHELTER_HAZARD_FIELDS = {
  earthquake: '地震', tsunami: '津波', flood: '洪水', storm_surge: '高潮', fire: '大規模な火事', inland_flood: '内水氾濫'
};

export const WEATHER_TERM_MAP = {
  en: [
    ['昼過ぎ', 'in the afternoon'], ['時々', 'occasionally'], ['一時', 'temporarily'], ['のち', 'then'], ['後', 'then'],
    ['所により雨', 'scattered rain'], ['所により雪', 'scattered snow'], ['所により', 'in places'],
    ['夜遅く', 'late at night'], ['夜のはじめ頃', 'in the early night'], ['明け方', 'dawn'], ['未明', 'before dawn'],
    // 複合句（最長一致で先に置換し、逐語訳の破綻を防ぐ）
    ['雨で雷を伴い激しく降る', 'rain, heavy at times, with thunderstorms'],
    ['雨で雷を伴い', 'rain with thunderstorms'],
    ['雪で雷を伴い', 'snow with thunderstorms'],
    ['雷を伴う', 'with thunder'], ['雷を伴い', 'with thunderstorms'], ['激しく', 'heavily'], ['で', 'then'],
    ['夕方', 'evening'], ['夜', 'night'], ['朝', 'morning'], ['日中', 'during the day'], ['から', 'from'],
    ['晴れ', 'sunny'], ['くもり', 'cloudy'], ['曇り', 'cloudy'], ['雨', 'rain'],
    ['雪', 'snow'], ['雷', 'thunder'], ['風', 'wind'], ['強い', 'strong'], ['弱い', 'light'], ['降る', 'falling'],
    // 2026-08 天気表示障害の修正（v2.25.0）
    // 「まで」は「で」→then より先に最長一致で翻訳される必要がある（旧: まthen/ま并 に化けていた）
    ['まで', 'until'],
    ['大雨', 'heavy rain'], ['大雪', 'heavy snow'], ['非常に', 'very'], ['激しい', 'intense'],
    ['降り続く', 'continuing to fall'], ['台風', 'typhoon'], ['おおむね', 'mostly'],
    ['晴れ間', 'clear spells'], ['山沿い', 'mountain areas'], ['平地', 'plains'],
    ['暖かい', 'warm'], ['寒い', 'cold'], ['蒸し暑い', 'humid'], ['荒れた天気', 'rough weather'],
    ['回復', 'recovering'], ['回復する', 'recovering'], ['吹く', 'blowing'], ['風が強い', 'windy'],
    // v2.39.1: #89/#90 対応 — 風・波の用語（get_weather の wind/wave 翻訳用）
    ['北西の風', 'northwest wind'], ['北東の風', 'northeast wind'], ['南西の風', 'southwest wind'], ['南東の風', 'southeast wind'],
    ['北の風', 'north wind'], ['南の風', 'south wind'], ['東の風', 'east wind'], ['西の風', 'west wind'],
    ['やや強く', 'rather strong'], ['非常に強く', 'very strong'], ['うねりを伴う', 'with swell'], ['メートル', ' meters'], ['海上', 'on the sea']
  ],
  zh: [
    ['昼過ぎ', '午后'], ['時々', '有时'], ['一時', '短暂'], ['のち', '转'], ['後', '转'],
    ['所により雨', '局部有雨'], ['所により雪', '局部有雪'], ['所により', '局部'],
    ['夜遅く', '深夜'], ['夜のはじめ頃', '入夜时分'], ['明け方', '清晨'], ['未明', '凌晨'],
    ['雨で雷を伴い激しく降る', '有雨并将伴有雷电、降雨猛烈'],
    ['雨で雷を伴い', '有雨并伴有雷电'],
    ['雪で雷を伴い', '有雪并伴有雷电'],
    ['雷を伴う', '伴有雷电'], ['雷を伴い', '伴有雷电'], ['激しく', '猛烈地'], ['で', '并'],
    ['夕方', '傍晚'], ['夜', '夜间'], ['朝', '早晨'], ['日中', '白天'], ['から', '从'],
    ['晴れ', '晴'], ['くもり', '多云'], ['曇り', '多云'], ['雨', '雨'],
    ['雪', '雪'], ['雷', '雷'], ['風', '风'], ['強い', '强'], ['弱い', '弱'], ['降る', '下'],
    // 2026-08 天気表示障害の修正（v2.25.0）
    ['まで', '为止'],
    ['大雨', '大雨'], ['大雪', '大雪'], ['非常に', '非常'], ['激しい', '猛烈'],
    ['降り続く', '持续下'], ['台風', '台风'], ['おおむね', '大致'],
    ['晴れ間', '晴间'], ['山沿い', '山区'], ['平地', '平原'],
    ['暖かい', '温暖'], ['寒い', '寒冷'], ['蒸し暑い', '闷热'], ['荒れた天気', '恶劣天气'],
    ['回復', '转好'], ['回復する', '转好'], ['吹く', '刮'], ['風が強い', '风大'],
    // v2.39.1: #89/#90 対応 — 風・波の用語
    ['北西の風', '西北风'], ['北東の風', '东北风'], ['南西の風', '西南风'], ['南東の風', '东南风'],
    ['北の風', '北风'], ['南の風', '南风'], ['東の風', '东风'], ['西の風', '西风'],
    ['やや強く', '较强'], ['非常に強く', '非常强'], ['うねりを伴う', '伴有涌浪'], ['メートル', '米'], ['海上', '海上']
  ]
};

export const TRAIN_INFO_TERM_MAP = {
  en: [
    ['振替輸送を実施しています', 'Substitute bus transport is in operation.'],
    ['ダイヤが乱れています', 'services are disrupted.'],
    ['運転を見合わせています', 'train services are suspended.'],
    ['運転を見合わせ', 'suspension of train services'],
    ['振替輸送', 'substitute bus transport'],
    ['人身事故', 'a personal-injury accident'],
    ['踏切障害', 'a level-crossing obstruction'],
    ['信号故障', 'a signal failure'],
    ['車両故障', 'a rolling-stock fault'],
    ['設備点検', 'equipment inspection'],
    ['内にて発生した', ' occurred in '],
    ['にて発生した', ' occurred in '],
    ['で発生した', ' occurred at '],
    ['の影響で', 'due to'],
    ['のため、', ', so '],
    ['のため', 'due to'],
    ['強風', 'strong wind'], ['大雨', 'heavy rain'], ['大雪', 'heavy snow'],
    ['運休', 'service suspension'], ['再開', 'services resumed'],
    ['遅延が発生', 'delays occurred'], ['遅延', 'delays'],
    ['ダイヤ', 'services'], ['輸送', 'transport'], ['発生', 'occurred'],
    ['時', ':'], ['分', ''], ['頃', ' around'],
    ['駅', ' Station'], ['線', ' Line'], ['内', ' within'],
    ['は、', ' '], ['。', ''], ['、', ', '],
  ],
  zh: [
    ['振替輸送を実施しています', '正在实施接驳换乘巴士。'],
    ['ダイヤが乱れています', '运行时刻表出现混乱。'],
    ['運転を見合わせています', '列车暂停运行。'],
    ['運転を見合わせ', '暂停运行'],
    ['振替輸送', '接驳换乘巴士'],
    ['人身事故', '人身事故'],
    ['踏切障害', '道口障碍'], ['信号故障', '信号故障'], ['車両故障', '车辆故障'], ['設備点検', '设备检查'],
    ['内にて発生した', '发生在'], ['にて発生した', '发生在'], ['で発生した', '发生于'],
    ['の影響で', '受其影响'], ['のため、', '，因此'], ['のため', '因'],
    ['強風', '强风'], ['大雨', '大雨'], ['大雪', '大雪'],
    ['運休', '停运'], ['再開', '恢复运行'], ['遅延', '晚点'],
    ['ダイヤ', '运行时刻'], ['輸送', '运输'], ['発生', '发生'],
    ['時', ':'], ['分', ''], ['頃', '左右'],
    ['駅', '站'], ['線', '线'], ['内', '以内'],
    ['は、', ' '], ['。', ''], ['、', '，'],
  ],
};

export const OPERATOR_MAP = {
  tokyometro: 'TokyoMetro', toei: 'Toei', jreast: 'JR-East',
  odakyu: 'Odakyu', keio: 'Keio', seibu: 'Seibu', tobu: 'Tobu',
  keikyu: 'Keikyu', keisei: 'Keisei', sotetsu: 'Sotetsu', tokyu: 'Tokyu',
  yokohama: 'YokohamaMunicipal',
  mir: 'MIR', twr: 'TWR', minatomirai: 'Minatomirai',
  odakyuhakone: 'OdakyuHakone', hokuso: 'Hokuso',
  saitamarailway: 'SaitamaRailway', toyorapid: 'ToyoRapid',
  shibayama: 'Shibayama', jrcentral: 'JR-Central',
  kantetsu: 'KantoRailway', // #55: 関東鉄道（常総線・竜ヶ崎線）
  tsukuba: 'MIR' // つくばエクスプレスの ODPT 事業者ID（首都圏新都市鉄道）
};

export const NON_RAIL_OPERATORS = {
  yurikamome: { id: 'Yurikamome', type: 'agt', label: 'ゆりかもめ', labelEn: 'Yurikamome', labelZh: '百合海鸥线', description: '新交通システム（AGT）- 東京臨海部', descEn: 'New transit system (AGT) - Tokyo waterfront', descZh: '新交通系统（AGT）- 东京临海地区', website: 'https://www.yurikamome.co.jp/' },
  tokyomonorail: { id: 'TokyoMonorail', type: 'monorail', label: '東京モノレール', labelEn: 'Tokyo Monorail', labelZh: '东京单轨电车', description: 'モノレール - 浜松町～羽田空港', descEn: 'Monorail - Hamamatsucho to Haneda Airport', descZh: '单轨电车 - 滨松町至羽田机场', website: 'https://www.tokyo-monorail.co.jp/' },
  tamamonorail: { id: 'TamaMonorail', type: 'monorail', label: '多摩モノレール', labelEn: 'Tama Monorail', labelZh: '多摩单轨电车', description: 'モノレール - 上北台～多摩センター～立川北', descEn: 'Monorail - Kamikitadai to Tama-Center to Tachikawa-Kita', descZh: '单轨电车 - 上北台至多摩中心至立川北', website: 'https://www.tama-monorail.co.jp/' },
  toden: { id: 'Toei', type: 'tram', railwayId: 'Toei.Arakawa', label: '都電荒川線', labelEn: 'Toden Arakawa Line', labelZh: '都电荒川线', description: '路面電車（東京さくらトラム）- 三ノ輪橋～早稲田', descEn: 'Tram (Tokyo Sakura Tram) - Minowabashi to Waseda', descZh: '路面电车（东京樱花有轨电车）- 三轮桥至早稻田', website: 'https://www.kotsu.metro.tokyo.jp/toden/' },
  nipporitoneri: { id: 'Toei', type: 'agt', railwayId: 'Toei.NipporiToneri', label: '日暮里・舎人ライナー', labelEn: 'Nippori-Toneri Liner', labelZh: '日暮里·舍人线', description: '新交通システム（AGT）- 日暮里～見沼代親水公園', descEn: 'New transit system (AGT) - Nippori to Minumadai-Shinsuikoen', descZh: '新交通系统（AGT）- 日暮里至见沼代亲水公园', website: 'https://www.kotsu.metro.tokyo.jp/nippori_toneri_liner/' },
  // 2026-08 v2.25 #21-D: 非鉄道カテゴリに路線バス・水上バス・フェリーを追加
  toei_bus: { id: 'ToeiBus', type: 'bus', label: '都営バス', labelEn: 'Toei Bus', labelZh: '都营巴士', description: '路線バス - 都心・23区', descEn: 'City bus - central Tokyo / 23 wards', descZh: '路线巴士 - 东京都心及23区', website: 'https://www.kotsu.metro.tokyo.jp/bus/' },
  seibu_bus: { id: 'SeibuBus', type: 'bus', label: '西武バス', labelEn: 'Seibu Bus', labelZh: '西武巴士', description: '路線バス - 西東京・埼玉方面', descEn: 'City bus - western Tokyo / Saitama', descZh: '路线巴士 - 西东京及埼玉方向', website: 'https://www.seibubus.co.jp/' },
  yokohama_bus: { id: 'YokohamaMunicipalBus', type: 'bus', label: '横浜市営バス', labelEn: 'Yokohama Municipal Bus', labelZh: '横滨市营巴士', description: '路線バス - 横浜市内', descEn: 'City bus - Yokohama', descZh: '路线巴士 - 横滨市内', website: 'https://www.city.yokohama.lg.jp/kotsu/' },
  keio_bus: { id: 'KeioBus', type: 'bus', label: '京王バス', labelEn: 'Keio Bus', labelZh: '京王巴士', description: '路線バス - 多摩・都心', descEn: 'City bus - Tama / central Tokyo', descZh: '路线巴士 - 多摩及东京都心', website: 'https://www.keiobus.co.jp/' },
  tokyu_bus: { id: 'TokyuBus', type: 'bus', label: '東急バス', labelEn: 'Tokyu Bus', labelZh: '东急巴士', description: '路線バス - 目黒・世田谷・川崎', descEn: 'City bus - Meguro / Setagaya / Kawasaki', descZh: '路线巴士 - 目黑、世田谷、川崎', website: 'https://www.tokyubus.co.jp/' },
  odakyu_bus: { id: 'OdakyuBus', type: 'bus', label: '小田急バス', labelEn: 'Odakyu Bus', labelZh: '小田急巴士', description: '路線バス - 多摩・世田谷', descEn: 'City bus - Tama / Setagaya', descZh: '路线巴士 - 多摩、世田谷', website: 'https://www.odakyubus.co.jp/' },
  keisei_bus: { id: 'KeiseiBus', type: 'bus', label: '京成バス', labelEn: 'Keisei Bus', labelZh: '京成巴士', description: '路線バス - 千葉・江戸川区', descEn: 'City bus - Chiba / Edogawa', descZh: '路线巴士 - 千叶、江户川区', website: 'https://www.keiseibus.co.jp/' },
  jrbuskanto: { id: 'JRBuskanto', type: 'bus', label: 'JRバス関東', labelEn: 'JR Bus Kanto', labelZh: 'JR巴士关东', description: '高速・路線バス - 関東広域', descEn: 'Highway / city bus - Kanto wide area', descZh: '高速路线巴士 - 关东广域', website: 'https://www.jrbuskanto.co.jp/' },
  // #45: 千葉・埼玉・神奈川のローカルバス（延伸駅周辺）
  chiba_flower_bus: { id: 'ChibaFlowerBus', type: 'bus', label: 'ちばフラワーバス（佐倉）', labelEn: 'Chiba Flower Bus (Sakura)', labelZh: '千叶花巴士（佐仓）', description: '路線バス - 佐倉市・四街道市', descEn: 'City bus - Sakura / Yotsukaido', descZh: '路线巴士 - 佐仓市、四街道市', website: 'https://www.chiba-flowerbus.jp/' },
  saitama_city_bus: { id: 'SaitamaCityBus', type: 'bus', label: 'さいたま市営バス', labelEn: 'Saitama City Bus', labelZh: '埼玉市营巴士', description: '路線バス - さいたま市（大宮・浦和）', descEn: 'City bus - Saitama City (Omiya / Urawa)', descZh: '路线巴士 - 埼玉市（大宫、浦和）', website: 'https://www.city.saitama.lg.jp/003/001/kotsu/' },
  tobu_bus_saitama: { id: 'TobuBusSaitama', type: 'bus', label: '東武バス（埼玉）', labelEn: 'Tobu Bus (Saitama)', labelZh: '东武巴士（埼玉）', description: '路線バス - 埼玉県南東部', descEn: 'City bus - southeastern Saitama', descZh: '路线巴士 - 埼玉县东南部', website: 'https://www.tobu-bus.com/' },
  seibu_kanko_chichibu: { id: 'SeibuKankoBusChichibu', type: 'bus', label: '西武観光バス（秩父）', labelEn: 'Seibu Kanko Bus (Chichibu)', labelZh: '西武观光巴士（秩父）', description: '路線バス - 秩父・長瀞エリア', descEn: 'City bus - Chichibu / Nagatoro area', descZh: '路线巴士 - 秩父、长瀞地区', website: 'https://www.seibubus.co.jp/rosen/chichibu/' },
  enoden_bus: { id: 'EnodenBus', type: 'bus', label: '江ノ電バス', labelEn: 'Enoden Bus', labelZh: '江之电巴士', description: '路線バス - 藤沢・鎌倉・大船', descEn: 'City bus - Fujisawa / Kamakura / Ofuna', descZh: '路线巴士 - 藤泽、镰仓、大船', website: 'https://www.enoden.co.jp/bus/' },
  chiba_chuo_bus: { id: 'ChibaChuoBus', type: 'bus', label: '千葉中央バス', labelEn: 'Chiba Chuo Bus', labelZh: '千叶中央巴士', description: '路線バス - 千葉市', descEn: 'City bus - Chiba City', descZh: '路线巴士 - 千叶市', website: 'https://www.chibachuobus.co.jp/' },
  maruken_tsubasa: { id: 'MarukenTsubasa', type: 'bus', label: '丸建つばさ交通（けんちゃんバス）', labelEn: 'Maruken Tsubasa Kotsu (Ina)', labelZh: '丸建翼交通（伊奈）', description: 'コミュニティバス - 伊奈町・上尾市', descEn: 'Community bus - Ina / Ageo', descZh: '社区巴士 - 伊奈町、上尾市', website: 'https://maru-ken.co.jp/route-bus/' },
  kawagoe_kanko_ogose: { id: 'KawagoeKankoOgose', type: 'bus', label: '川越観光自動車（越生）', labelEn: 'Kawagoe Kanko Bus (Ogose)', labelZh: '川越观光汽车（越生）', description: '路線バス - 越生・ときがわ町', descEn: 'City bus - Ogose / Tokigawa', descZh: '路线巴士 - 越生、都几川町', website: 'https://www.kawagoebus.jp/' },
  tokaikisen: { id: 'TokaiKisen', type: 'ferry', label: '東海汽船', labelEn: 'Tokai Kisen', labelZh: '东海汽船', description: 'フェリー - 伊豆諸島・小笠原航路', descEn: 'Ferry - Izu Islands / Ogasawara routes', descZh: '渡轮 - 伊豆诸岛、小笠原航线', website: 'https://www.tokaikisen.co.jp/' },
  tokyocruise: { id: 'TokyoCruise', type: 'ferry', label: '東京クルーズ（水上バス）', labelEn: 'Tokyo Cruise (Water Bus)', labelZh: '东京游船（水上巴士）', description: '水上バス - 隅田川・お台場', descEn: 'Water bus - Sumida River / Odaiba', descZh: '水上巴士 - 隅田川、御台场', website: 'https://www.tokyo-park.or.jp/cruise/' },
  // 2026-08 v2.36.1: 鉄道カテゴリから除外した非鉄道系を正しい種別で登録（README の分類表と整合）
  shonanmonorail: { id: 'ShonanMonorail', type: 'monorail', label: '湘南モノレール', labelEn: 'Shonan Monorail', labelZh: '湘南单轨电车', description: 'モノレール（懸垂式）- 大船～湘南江の島', descEn: 'Monorail (suspended) - Ofuna to Shonan-Enoshima', descZh: '单轨电车（悬挂式）- 大船至湘南江之岛', website: 'https://www.shonan-monorail.co.jp/' },
  chibamonorail: { id: 'ChibaUrbanMonorail', type: 'monorail', label: '千葉都市モノレール', labelEn: 'Chiba Urban Monorail', labelZh: '千叶都市单轨电车', description: 'モノレール（跨座式・世界最長）- 1号線・2号線', descEn: 'Monorail (straddle-type, world longest) - Lines 1 & 2', descZh: '单轨电车（跨座式、世界最长）- 1号线、2号线', website: 'https://chiba-monorail.co.jp/' },
  newshuttle: { id: 'SaitamaNewUrbanTransit', type: 'agt', label: '埼玉新都市交通（ニューシャトル）', labelEn: 'Saitama New Urban Transit (New Shuttle)', labelZh: '埼玉新都市交通（新交通系统）', description: '新交通システム（AGT）- 大宮～内宿', descEn: 'New transit system (AGT) - Omiya to Uchijuku', descZh: '新交通系统（AGT）- 大宫至内宿', website: 'https://www.new-shuttle.jp/' },
  seibuyamaguchiline: { id: 'Seibu', type: 'agt', railwayId: 'Seibu.Yamaguchi', label: '西武山口線（おとぎ線）', labelEn: 'Seibu Yamaguchi Line (Otogi Line)', labelZh: '西武山口线（御伽线）', description: '案内軌条式鉄道（AGT）- 多摩湖～西武球場前', descEn: 'Guideway transit (AGT) - Tamako to Seibu-Kyujomae', descZh: '导引轨条式铁道（AGT）- 多摩湖至西武球场前', website: 'https://www.seiburailway.jp/railway/otogi/' },
  tokyusetagayaline: { id: 'Tokyu', type: 'tram', railwayId: 'Tokyu.Setagaya', label: '東急世田谷線', labelEn: 'Tokyu Setagaya Line', labelZh: '东急世田谷线', description: '路面電車（軌道法）- 三軒茶屋～下高井戸', descEn: 'Tram (Tram Act) - Sangenjaya to Shimotakaido', descZh: '路面电车（轨道法）- 三轩茶屋至下高井户', website: 'https://www.tokyu.co.jp/railway/railway/top/setagaya/' }
};

export const JMA_AREA_MAP = {
  // 🔴 v2.39.4: JMA forecast API は府県予報区コード（130000等）のみ有効。区市町村コード（131020等）は 404 になるため
  // すべて府県コードへ正規化（無効コードによる NETWORK_ERROR を解消。#93）。区・市の表示は PLACE_MUNICIPALITY で行う。
  '東京': '130000', '東京都': '130000', '渋谷': '130000', '新宿': '130000',
  '港': '130000', '千代田': '130000', '中央': '130000', '台東': '130000', '横浜': '140000',
  // v2.37.1: 常磐線延伸（土浦・水戸方面）の気象庁エリアコード（茨城県）
  '茨城': '080000', '牛久': '080000', 'ひたち野うしく': '080000', '荒川沖': '080000', '土浦': '080000',
  '神立': '080000', '高浜': '080000', '石岡': '080000', '羽鳥': '080000', '岩間': '080000',
  '友部': '080000', '内原': '080000', '赤塚': '080000', '水戸': '080000',
  // v2.39.1: #88 対応 — 県名・主要駅→県コードを拡張（千葉・埼玉・神奈川・栃木・群馬・静岡）
  '千葉': '120000', '千葉県': '120000', '船橋': '120000', '津田沼': '120000', '柏': '120000',
  '松戸': '120000', '成田': '120000', '蘇我': '120000', '木更津': '120000', '館山': '120000',
  '埼玉': '110000', '埼玉県': '110000', '大宮': '110000', '浦和': '110000', '川越': '110000',
  '川口': '110000', '所沢': '110000', '上尾': '110000',
  '越谷': '110000', '越谷レイクタウン': '110000',
  '神奈川': '140000', '神奈川県': '140000', '川崎': '140000', '新横浜': '140000', '小田原': '140000',
  '藤沢': '140000', '鎌倉': '140000',
  '栃木': '090000', '栃木県': '090000', '宇都宮': '090000',
  '群馬': '100000', '群馬県': '100000', '高崎': '100000',
  '静岡': '220000', '静岡県': '220000', '熱海': '220000', '沼津': '220000',
  // v2.39.1: #90 対応 — フェリー港名→県コード（強風・高波ゲート用）
  '東京・竹芝': '130000', 'お台場海浜公園': '130000', '豊洲': '130000', '日の出桟橋': '130000', '浜離宮': '130000',
  '久里浜': '140000', '館山': '120000', '伊東': '220000', '稲取': '220000', '下田': '220000',
  '大島': '130000', '利島': '130000', '新島': '130000', '式根島': '130000', '神津島': '130000',
  '三宅島': '130000', '御蔵島': '130000', '八丈島': '130000', '青ヶ島': '130000', '父島': '130000', '母島': '130000'
};

export const JMA_AREA_LABELS = {
  // 🔴 v2.39.4: 府県予報区コードのみ（区・市コード 131010〜/140010 は JMA forecast で無効のため削除。#93）。区・市の表示は PLACE_MUNICIPALITY で行う。
  '130000': { ja: '東京', en: 'Tokyo', zh: '东京' },
  '080000': { ja: '茨城', en: 'Ibaraki', zh: '茨城' },
  '120000': { ja: '千葉', en: 'Chiba', zh: '千叶' },
  '110000': { ja: '埼玉', en: 'Saitama', zh: '埼玉' },
  '140000': { ja: '神奈川', en: 'Kanagawa', zh: '神奈川' },
  '090000': { ja: '栃木', en: 'Tochigi', zh: '栃木' },
  '100000': { ja: '群馬', en: 'Gunma', zh: '群马' },
  '220000': { ja: '静岡', en: 'Shizuoka', zh: '静冈' }
};

// v2.39.4 (#93): 駅名・場所 → 自治体名（3言語）。JMA forecast は区市町村レベルの予報を返さないため、
// 「東京ざっくり」を避け、駅名指定時に具体的な自治体名を表示するための辞書。
export const PLACE_MUNICIPALITY = {
  // 東京23区
  '上野': { ja: '台東区', en: 'Taito', zh: '台东区' },
  // 横浜は都道府県ラベル（神奈川）ではなく、市域の表示名を優先する。
  '横浜': { ja: '横浜', en: 'Yokohama', zh: '横滨' },
  '横浜駅': { ja: '横浜', en: 'Yokohama', zh: '横滨' },
  '浅草': { ja: '台東区', en: 'Taito', zh: '台东区' },
  '渋谷': { ja: '渋谷区', en: 'Shibuya', zh: '涩谷区' },
  '新宿': { ja: '新宿区', en: 'Shinjuku', zh: '新宿区' },
  '高田馬場': { ja: '新宿区', en: 'Shinjuku', zh: '新宿区' },
  '池袋': { ja: '豊島区', en: 'Toshima', zh: '丰岛区' },
  '巣鴨': { ja: '豊島区', en: 'Toshima', zh: '丰岛区' },
  '大塚': { ja: '豊島区', en: 'Toshima', zh: '丰岛区' },
  '品川': { ja: '品川区', en: 'Shinagawa', zh: '品川区' },
  '大井町': { ja: '品川区', en: 'Shinagawa', zh: '品川区' },
  '神田': { ja: '千代田区', en: 'Chiyoda', zh: '千代田区' },
  '大手町': { ja: '千代田区', en: 'Chiyoda', zh: '千代田区' },
  '有楽町': { ja: '千代田区', en: 'Chiyoda', zh: '千代田区' },
  '秋葉原': { ja: '千代田区', en: 'Chiyoda', zh: '千代田区' },
  '御茶ノ水': { ja: '文京区', en: 'Bunkyo', zh: '文京区' },
  '両国': { ja: '墨田区', en: 'Sumida', zh: '墨田区' },
  '錦糸町': { ja: '墨田区', en: 'Sumida', zh: '墨田区' },
  '豊洲': { ja: '江東区', en: 'Koto', zh: '江东区' },
  'お台場海浜公園': { ja: '江東区', en: 'Koto', zh: '江东区' },
  '銀座': { ja: '中央区', en: 'Chuo', zh: '中央区' },
  '築地': { ja: '中央区', en: 'Chuo', zh: '中央区' },
  '六本木': { ja: '港区', en: 'Minato', zh: '港区' },
  '新橋': { ja: '港区', en: 'Minato', zh: '港区' },
  '浜松町': { ja: '港区', en: 'Minato', zh: '港区' },
  '田町': { ja: '港区', en: 'Minato', zh: '港区' },
  '竹芝': { ja: '港区', en: 'Minato', zh: '港区' },
  '日の出桟橋': { ja: '港区', en: 'Minato', zh: '港区' },
  '羽田空港': { ja: '大田区', en: 'Ota', zh: '大田区' },
  '中野': { ja: '中野区', en: 'Nakano', zh: '中野区' },
  '荻窪': { ja: '杉並区', en: 'Suginami', zh: '杉并区' },
  '下北沢': { ja: '世田谷区', en: 'Setagaya', zh: '世田谷区' },
  '二子玉川': { ja: '世田谷区', en: 'Setagaya', zh: '世田谷区' },
  '板橋': { ja: '板橋区', en: 'Itabashi', zh: '板桥区' },
  '越谷': { ja: '越谷', en: 'Koshigaya', zh: '越谷' },
  '越谷レイクタウン': { ja: '越谷', en: 'Koshigaya', zh: '越谷' }
};

// v2.39.4 (#93): 駅名・場所 → JMA 一次細分区域コード（府県 JSON 内の区域データ選択用）。
// 伊豆諸島・小笠原の島は東京地方とは異なる区域のため、区域を明示する。島以外は既定 areas[0] を使う。
export const PLACE_SUBAREA = {
  // 伊豆諸島北部（130020）※「伊豆大島」は大島の正式名
  '大島': '130020', '伊豆大島': '130020', '利島': '130020', '新島': '130020', '式根島': '130020', '神津島': '130020',
  // 伊豆諸島南部（130030）
  '三宅島': '130030', '御蔵島': '130030', '八丈島': '130030', '青ヶ島': '130030',
  // 小笠原諸島（130040）※「小笠原」は小笠原村・小笠原諸島全体の総称（v2.50.1追加: 未登録で東京地方にフォールバックしていた）
  '小笠原': '130040', '小笠原諸島': '130040', '父島': '130040', '母島': '130040',
  // 埼玉県南部（110010）— 越谷・春日部など。既定は北部(110020)のため明示
  '越谷': '110010', '越谷レイクタウン': '110010'
};

// 🔴 v2.50.1: 気象庁の気温データ（timeSeries[].areas[].temps）は「観測地点名」で提供され、
// 予報区域名（東京地方・東部・北部 等）とは一致しない。subAreaCode（予報区コード）を
// 指定されたときに正しい地点の気温を返すため、予報区コード→気温観測地点名の対応表を持つ。
// （地点名は JMA 府県予報 JSON の temps 保有エリア実測に基づく: 2026-08-31 確認）
export const TEMP_AREA_BY_SUBAREA = {
  // 東京（130000）: 東京地方→東京, 伊豆諸島北部→大島, 伊豆諸島南部→八丈島, 小笠原諸島→父島
  '130010': '東京', '130020': '大島', '130030': '八丈島', '130040': '父島',
  // 埼玉（110000）: 南部→さいたま, 北部→熊谷, 秩父地方→秩父
  '110010': 'さいたま', '110020': '熊谷', '110030': '秩父',
  // 千葉（120000）: 北西部→千葉, 北東部→銚子, 南部→館山
  '120010': '千葉', '120020': '銚子', '120030': '館山',
  // 神奈川（140000）: 東部→横浜, 西部→小田原
  '140010': '横浜', '140020': '小田原'
};

export const GOV_FACILITY_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query=%E5%BD%B9%E6%89%80+%E5%87%BA%E5%BC%B5%E6%89%80+%E5%85%AC%E6%B0%91%E9%A4%A8+%E5%B8%82%E6%B0%91%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC";

export const EMERGENCY_EVACUATION_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query=%E6%8C%87%E5%AE%9A%E7%B7%8A%E6%80%A5%E9%81%BF%E9%9B%A3%E5%A0%B4%E6%89%80+%E9%81%BF%E9%9B%A3%E6%89%80";

export const MULTILINGUAL_ADVICE = {
  // 基本天候
  fair: {
    ja: "🤖 【AIからのインテリジェントアドバイス】\n☀ 晴れの良好なお天気です！快適な移動をお楽しみください。",
    en: "🤖 [AI Intelligent Transit Advice]\n☀ Fair and clear weather! Enjoy your comfortable journey.",
    zh: "🤖 【AI智能出行建议】\n☀ 天气晴朗良好！祝您旅途愉快顺畅。"
  },
  rainy: {
    ja: "🤖 【AIからのインテリジェントアドバイス (雨天時)】\n☔ 駅構内・階段・ホームが滑りやすくなります。足元に注意し、乗換時間には余裕を持ってください。バスへの乗換は、この経路に接続情報がある場合のみ駅係員・事業者の案内で確認してください。",
    en: "🤖 [AI Intelligent Transit Advice (Rainy)]\n☔ Station floors, stairs, and platforms may be slippery. Watch your step and allow extra transfer time. Only use bus connections when they are shown for this journey and confirmed by staff or the operator.",
    zh: "🤖 【AI智能出行建议 (雨天)】\n☔ 车站大厅、楼梯和站台可能湿滑，请注意脚下并预留换乘时间。仅在本行程显示巴士接驳信息时，才向车站工作人员或运营商确认乘车安排。"
  },
  hot: {
    ja: "🤖 【AIからのインテリジェントアドバイス (熱中症警戒)】\n☀ 本日は気温が著しく上昇しています。駅構内や車内でもこまめな水分補給を心がけ、熱中症に十分ご注意ください。",
    en: "🤖 [AI Intelligent Transit Advice (Heat Alert)]\n☀ Extreme heat expected today. Stay hydrated even inside stations and trains.",
    zh: "🤖 【AI智能出行建议 (高温预警)】\n☀ 今天气温显著上升，请在站内也注意补充水分，小心中暑。"
  },
  // 障害種別連動アドバイス
  typhoon: {
    ja: "🤖 【AIからのインテリジェントアドバイス (台風接近)】\n🌀 大雨・強風により列車の運転見合わせや遅延が発生する可能性が高いです。外出は可能であれば控え、やむを得ない場合は最新の運行情報をご確認ください。駅周辺の看板や木の倒壊にも注意。",
    en: "🤖 [AI Intelligent Transit Advice (Typhoon Alert)]\n🌀 Heavy rain and strong winds may cause train suspensions. Check latest info before going out.",
    zh: "🤖 【AI智能出行建议 (台风接近)】\n🌀 强风暴雨可能导致列车停运，请确认最新运行信息后再出行。"
  },
  fallen_tree: {
    ja: "🤖 【AIからのインテリジェントアドバイス (倒木・強風)】\n🌀 強風により倒木や折れた枝が線路・道路に落下しています。運転見合わせや遅延が発生中です。線路沿い・街路樹の下・高架下では頭上に十分注意し、駅係員の指示に従ってください。",
    en: "🤖 [AI Intelligent Transit Advice (Fallen Trees / Wind)]\n🌀 Fallen trees and broken branches are on tracks/roads due to strong winds. Services are suspended or delayed. Watch overhead near tracks, trees, and viaducts, and follow station staff instructions.",
    zh: "🤖 【AI智能出行建议 (倒木・强风)】\n🌀 强风导致倒木和断枝掉落在轨道和道路上，列车暂停运行或延误。在轨道旁、行道树下和高架下方请注意头顶安全，听从车站工作人员指示。"
  },
  flood: {
    ja: "🤖 【AIからのインテリジェントアドバイス (浸水注意)】\n⚠ 周辺道路や駅構内が冠水している可能性があります。長靴や雨具をご準備ください。地下街やアンダーパスへの立ち入りは危険です。やむを得ない外出以外はお控えください。",
    en: "🤖 [AI Intelligent Transit Advice (Flood Alert)]\n⚠ Surrounding roads and station areas may be flooded. Avoid underpasses and underground areas.",
    zh: "🤖 【AI智能出行建议 (浸水注意)】\n⚠ 周边道路和车站内可能积水。请远离地下通道和地下商场。"
  },
  earthquake: {
    ja: "🤖 【AIからのインテリジェントアドバイス (地震発生)】\n🔴 鉄道は安全確認のため一時運転見合わせ中です。揺れが収まるまで駅構内では落下物に注意し、係員の指示に従ってください。急な動きは控え、落ち着いて行動。",
    en: "🤖 [AI Intelligent Transit Advice (Earthquake Alert)]\n🔴 Train operations suspended for safety checks. Follow station staff instructions and watch for falling objects.",
    zh: "🤖 【AI智能出行建议 (地震)】\n🔴 为确保安全列车暂停运行。请遵照车站工作人员指示，注意高空坠物。"
  },
  snow: {
    ja: "🤖 【AIからのインテリジェントアドバイス (降雪注意)】\n❄ 積雪により列車に遅延が発生しています。駅構内やホームは大変滑りやすくなっています。滑りにくい靴でのご出行をおすすめし、階段・ホーム端では特に足元にご注意ください。",
    en: "🤖 [AI Intelligent Transit Advice (Snow Advisory)]\n❄ Train delays due to snowfall. Platforms and stairs are extremely slippery. Wear non-slip shoes.",
    zh: "🤖 【AI智能出行建议 (降雪)】\n❄ 积雪导致列车延误。站台和楼梯非常湿滑，请穿防滑鞋并注意脚下。"
  },
  accident: {
    ja: "🤖 【AIからのインテリジェントアドバイス (人身事故・運転見合わせ)】\n⚠ 人身事故の影響で一部列車が運転を見合わせています。振替輸送が実施されている場合は駅係員の案内に従ってください。お急ぎの方は代替ルート（他社線・バス）をご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Accident Alert)]\n⚠ Train suspended due to a human accident. Follow staff for substitute transport or consider alternative routes.",
    zh: "🤖 【AI智能出行建议 (人身事故)】\n⚠ 因人身事故部分列车停运。请听从工作人员安排换乘，或考虑其他路线。"
  },
  fire: {
    ja: "🤖 【AIからのインテリジェントアドバイス (火災発生)】\n🔥 列車火災または駅周辺での火災が報告されています。駅員の指示に従い落ち着いて避難してください。煙を吸い込まないようハンカチ等で口元を覆って低い姿勢で移動。",
    en: "🤖 [AI Intelligent Transit Advice (Fire Alert)]\n🔥 Fire reported near the station. Follow evacuation instructions from station staff.",
    zh: "🤖 【AI智能出行建议 (火灾)】\n🔥 车站附近发生火灾，请遵照工作人员指示有序疏散。"
  },
  infrastructure: {
    ja: "🤖 【AIからのインテリジェントアドバイス (設備障害)】\n⚡ 信号故障・停電など設備に障害が発生しています。復旧まで時間を要する場合があります。駅係員の案内に従い、可能であれば別ルートをご利用ください。",
    en: "🤖 [AI Intelligent Transit Advice (Infrastructure Failure)]\n⚡ Signal/power failure affecting train operations. Consider alternative routes.",
    zh: "🤖 【AI智能出行建议 (设备故障)】\n⚡ 信号或供电故障影响列车运行，请考虑其他路线。"
  },
  emergency: {
    ja: "🤖 【AIからのインテリジェントアドバイス (緊急アラート)】\n🚨 重大な災害または交通機関の運行不能を検知しました。身の安全を最優先とし、以下のリンクから最寄りの指定緊急避難場所を確認してください。",
    en: "🤖 [AI Intelligent Transit Advice (Emergency Alert)]\n🚨 Major disaster or transit suspension detected. Check the link for nearest evacuation shelters.",
    zh: "🤖 【AI智能出行建议 (紧急避难)】\n🚨 检测到重大灾害或交通中断，请点击下方链接查看最近的指定紧急避难场所。"
  },
  service_suspension: {
    ja: "🤖 【AIからのインテリジェントアドバイス (運転見合わせ)】\n🚨 一部路線が運転を見合わせています。最新の運行情報と振替輸送の有無を確認してください。お急ぎの場合は代替ルート（他社線・バス）をご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Service Suspension)]\n🚨 Some lines have suspended service. Check the latest service status and substitute transport. If you are in a hurry, consider an alternative route (other lines or buses).",
    zh: "🤖 【AI智能出行建议 (暂停运行)】\n🚨 部分线路暂停运行。请确认最新运行信息和接驳换乘安排。如急于出行，请考虑替代路线（其他线路或巴士）。"
  },
  service_resumed: {
    ja: "🤖 【AIからのインテリジェントアドバイス (運転再開・復旧)】\n🚆 運転を再開しました。復旧直後はダイヤの乱れや遅延が残る場合があります。時間に余裕を持ち、最新の運行情報をご確認ください。",
    en: "🤖 [AI Intelligent Transit Advice (Services Resumed)]\n🚆 Service has resumed. Residual delays or disruption may remain right after recovery. Allow extra time and check the latest service status.",
    zh: "🤖 【AI智能出行建议 (恢复运行)】\n🚆 列车已恢复运行。恢复初期可能仍有时刻表混乱或残余晚点，请预留时间并确认最新运行信息。"
  },
  vehicle_failure: {
    ja: "🤖 【AIからのインテリジェントアドバイス (機材故障)】\n🚃 機材故障の影響で一部の運行が見合わせています（鉄道・バス・航空機を問いません）。復旧まで時間を要する場合があり、振替輸送や他社線・バス・他モードへの乗り継ぎが案内されることもあります。係員の案内に従い、お急ぎの方は代替ルートをご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Equipment Failure)]\n🚃 Some services are suspended due to an equipment/vehicle failure (rail, bus, or aircraft). Allow extra time; follow staff for substitute transport or consider alternative routes.",
    zh: "🤖 【AI智能出行建议 (机材故障)】\n🚃 因机材故障部分运行暂停（铁路、巴士、飞机均有可能）。恢复可能需要时间。请听从工作人员安排换乘，或考虑其他路线。"
  },
  vehicle_delay: {
    ja: "🤖 【AIからのインテリジェントアドバイス (車両遅延)】\n🚃 車両遅延・ダイヤ乱れのため列車に遅れが生じています（運転は継続中）。乗り換え時間に余裕がない場合は係員へお問い合わせいただくか、並行する他路線の利用をご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Train Delay)]\n🚃 Trains are running behind schedule due to a vehicle delay / disrupted timetable (service continues). If your connection is tight, ask station staff or consider parallel lines.",
    zh: "🤖 【AI智能出行建议 (列车晚点)】\n🚃 因车辆延误/时刻表混乱，列车正在晚点运行（运营仍在继续）。若换乘时间紧张，请咨询车站工作人员或考虑平行线路。"
  },
  gate_baggage_delay: {
    ja: "🤖 【AIからのインテリジェントアドバイス (ゲート・手荷物遅延)】\n✈ ゲート変更または手荷物受取の遅延が発生しています。搭乗ゲート・到着口の案内板をご確認ください。お急ぎの方は空港スタッフへお問い合わせください。",
    en: "🤖 [AI Intelligent Transit Advice (Gate/Baggage Delay)]\n✈ A gate change or baggage claim delay has occurred. Check the gate/arrival display boards and ask airport staff if you are in a hurry.",
    zh: "🤖 【AI智能出行建议 (登机口/行李延误)】\n✈ 发生登机口变更或行李领取延误。请查看登机口/到达口显示屏，如有急事请咨询机场工作人员。"
  },
  bus_traffic_jam: {
    ja: "🤖 【AIからのインテリジェントアドバイス (バス渋滞遅延)】\n🚌 道路渋滞の影響でバスが大幅に遅延しています。時間に余裕を持ってご移動ください。急ぐ場合は、並行する鉄道路線や徒歩・シェアサイクルの利用をご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Bus Traffic Delay)]\n🚌 Buses are significantly delayed due to road congestion. Allow extra time; consider parallel train lines, walking, or bike-share if you are in a hurry.",
    zh: "🤖 【AI智能出行建议 (公交拥堵延误)】\n🚌 因道路拥堵公交大幅延误。请预留充足时间；若着急可考虑平行铁路线、步行或共享单车。"
  },
  ferry_rough_seas: {
    ja: "🤖 【AIからのインテリジェントアドバイス (フェリー・水上バス欠航)】\n⛴ 荒天・高波のためフェリーおよび水上バスが欠航しています。離島方面へは翌日の運航状況をご確認ください。陸路（鉄道・高速バス）への切り替えをご検討ください。",
    en: "🤖 [AI Intelligent Transit Advice (Ferry/Water Bus Suspension)]\n⛴ Ferries and water buses are suspended due to rough seas. Check next-day operations for island routes and consider land alternatives (train/express bus).",
    zh: "🤖 【AI智能出行建议 (渡轮/水上巴士停航)】\n⛴ 因风浪渡轮及水上巴士停航。离岛方向请确认次日运航情况，并考虑改走陆路（铁路/高速巴士）。"
  }
};

export const GBFS_BASE = 'https://api-public.odpt.org/api/v4/gbfs/docomo-cycle-tokyo';
// 🔴 v2.45.0: ハローサイクリング（OpenStreet・日本全国）を追加。CC BY 4.0 クレジット表示必須。
export const GBFS_BASE_HELLOCYCLING = 'https://api-public.odpt.org/api/v4/gbfs/hellocycling';

export const LIMITED_EXPRESS_KEYWORDS = [
  // ja
  '新幹線', 'のぞみ', 'ひかり', 'こだま', 'やまびこ', 'はやぶさ', 'つばさ', 'こまち', 'はやて',
  'なすの', 'たにがわ', 'とき', 'あさま', 'はくたか', 'かがやき', 'みずほ', 'さくら',
  '特急', 'あずさ', 'かいじ', 'ひたち', 'ときわ', 'しおさい', 'わかしお', 'あやめ', '成田エクスプレス',
  // ja 私鉄系特急
  'ロマンスカー', 'ロマンスカ', 'はこね', 'えのしま', 'さがみ', 'ホームウェイ', 'あさぎり', 'メトロはこね', 'メトロえのしま',
  'りょうもう', 'けごん', 'きぬ', 'スペーシア', 'スペーシアX', 'リバティ', 'リバティけごん', 'きりふり',
  'スカイライナー', 'シティライナー', 'モーニングライナー', 'イブニングライナー',
  'ウィング', 'モーニング・ウィング', 'イブニング・ウィング', '快特',
  'レッドアロー', '小江戸', '川越特急', '秩父', '拝島ライナー', 'ドームライナー',
  '京王ライナー', 'Mt.TAKAO号', 'Mt.TAKAO',
  'S-TRAIN', '東横特急', 'アーバンパークライナー',
  // en
  'shinkansen', 'nozomi', 'hikari', 'kodama', 'yamabiko', 'hayabusa', 'komachi', 'tsubasa', 'hayate',
  'nasuno', 'tanigawa', 'toki', 'asama', 'hakutaka', 'kagayaki', 'mizuho', 'sakura',
  'limited express', 'azusa', 'kaiji', 'hitachi', 'tokiwa', 'shiosai', 'wakashio', 'ayame', 'narita express', "n'ex",
  // en 私鉄系特急
  'romancecar', 'romance car', 'hakone', 'enoshima', 'sagami', 'homeway', 'asagiri',
  'ryomo', 'kegon', 'kinu', 'spacia', 'liberty', 'kirifuri',
  'skyliner', 'city liner', 'morning liner', 'evening liner',
  'wing', 'morning wing', 'evening wing', 'kaisoku tokkyu',
  'red arrow', 'oedo', 'kawagoe express', 'chichibu', 'haijima liner',
  'keio liner', 's-train', 'urban park liner',
  // zh
  '新干线', '希望号', '光号', '回声号', '山彦号', '隼号', '小町号', '燕号', '朱鹭号', '浅间号', '白鹰号', '光辉号',
  '特急', '梓号', '甲斐路号', '常陆号', '常盘号', '潮骚号', '若潮号', '菖蒲号', '成田特快',
  // zh 私鉄系特急
  '罗曼史号', '箱根号', '江之岛号', '相模号', '朝雾号',
  '两毛号', '华严号', '鬼怒号', '特快spacia', '利伯缇号',
  '天空号', '晨间特快', '黄昏特快',
  '红箭号', '川越特急', '秩父号', '京王特快', '都市公园特快'
];

export const LIMITED_EXPRESS_STATION_GUIDE = {
  '東京': {
    ja: 'JR東京駅のみどりの窓口（丸の内地下・八重洲地下）または指定席券売機で、乗車券と特急券・新幹線指定席券をご購入ください（営業: 5:30〜23:10頃）。新幹線は東海道・東北・上越・北陸新幹線が発着します。',
    en: 'Purchase tickets at JR Tokyo Station\'s Midori-no-Madoguchi (Marunouchi underground / Yaesu underground) or ticket machines (approx. 5:30–23:10). Tokaido, Tohoku, Joetsu and Hokuriku Shinkansen depart from here.',
    zh: '请在JR东京站绿色窗口（丸之内地下・八重洲地下）或指定席售票机购买车票与特急券・新干线指定席券（营业约5:30〜23:10）。东海道・东北・上越・北陆新干线均在此发车。'
  },
  '品川': {
    ja: 'JR品川駅のみどりの窓口（中央改札付近）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します（のぞみ・ひかり・こだま）。',
    en: 'Purchase tickets at JR Shinagawa Station\'s Midori-no-Madoguchi (near the central gate) or ticket machines. Tokaido / Sanyo Shinkansen stop here (Nozomi, Hikari, Kodama).',
    zh: '请在JR品川站绿色窗口（中央检票口附近）或指定席售票机购买。东海道・山阳新干线在此停靠（希望号・光号・回声号）。'
  },
  '新横浜': {
    ja: 'JR新横浜駅のみどりの窓口（北改札・南改札）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します。',
    en: 'Purchase tickets at JR Shin-Yokohama Station\'s Midori-no-Madoguchi (north / south gates) or ticket machines. Tokaido / Sanyo Shinkansen stop here.',
    zh: '请在JR新横滨站绿色窗口（北检票口・南检票口）或指定席售票机购买。东海道・山阳新干线在此停靠。'
  },
  '大宮': {
    ja: 'JR大宮駅のみどりの窓口（中央改札・東口改札）または指定席券売機でご購入ください。東北・上越・北陸新幹線が停車します。',
    en: 'Purchase tickets at JR Omiya Station\'s Midori-no-Madoguchi (central / east gates) or ticket machines. Tohoku, Joetsu and Hokuriku Shinkansen stop here.',
    zh: '请在JR大宫站绿色窗口（中央检票口・东口检票口）或指定席售票机购买。东北・上越・北陆新干线在此停靠。'
  },
  '上野': {
    ja: 'JR上野駅のみどりの窓口（中央改札・入谷口）または指定席券売機でご購入ください。東北・上越・北陸新幹線が発着します。',
    en: 'Purchase tickets at JR Ueno Station\'s Midori-no-Madoguchi (central gate / Iriya exit) or ticket machines. Tohoku, Joetsu and Hokuriku Shinkansen depart from here.',
    zh: '请在JR上野站绿色窗口（中央检票口・入谷口）或指定席售票机购买。东北・上越・北陆新干线在此发车。'
  },
  '高崎': {
    ja: 'JR高崎駅のみどりの窓口または指定席券売機でご購入ください。上越・北陸新幹線（とき・たにがわ・はくたか等）が停車します。',
    en: 'Purchase tickets at JR Takasaki Station\'s Midori-no-Madoguchi or ticket machines. Joetsu / Hokuriku Shinkansen (Toki, Tanigawa, Hakutaka etc.) stop here.',
    zh: '请在JR高崎站绿色窗口或指定席售票机购买。上越・北陆新干线（朱鹭号・谷川号・白鹰号等）在此停靠。'
  },
  '長野': {
    ja: 'JR長野駅のみどりの窓口（東西自由通路）または指定席券売機でご購入ください。北陸新幹線（かがやき・はくたか）が発着します。',
    en: 'Purchase tickets at JR Nagano Station\'s Midori-no-Madoguchi (east-west passage) or ticket machines. Hokuriku Shinkansen (Kagayaki, Hakutaka) depart from here.',
    zh: '请在JR长野站绿色窗口（东西自由通道）或指定席售票机购买。北陆新干线（光辉号・白鹰号）在此发车。'
  },
  '新潟': {
    ja: 'JR新潟駅のみどりの窓口（中央改札・南口）または指定席券売機でご購入ください。上越新幹線（とき・たにがわ）が発着します。',
    en: 'Purchase tickets at JR Niigata Station\'s Midori-no-Madoguchi (central gate / south exit) or ticket machines. Joetsu Shinkansen (Toki, Tanigawa) depart from here.',
    zh: '请在JR新潟站绿色窗口（中央检票口・南口）或指定席售票机购买。上越新干线（朱鹭号・谷川号）在此发车。'
  },
  '仙台': {
    ja: 'JR仙台駅のみどりの窓口（中央改札）または指定席券売機でご購入ください。東北新幹線（はやぶさ・やまびこ等）が発着します。',
    en: 'Purchase tickets at JR Sendai Station\'s Midori-no-Madoguchi (central gate) or ticket machines. Tohoku Shinkansen (Hayabusa, Yamabiko etc.) depart from here.',
    zh: '请在JR仙台站绿色窗口（中央检票口）或指定席售票机购买。东北新干线（隼号・山彦号等）在此发车。'
  },
  '盛岡': {
    ja: 'JR盛岡駅のみどりの窓口または指定席券売機でご購入ください。東北新幹線（はやぶさ・やまびこ・こまち）が発着します。',
    en: 'Purchase tickets at JR Morioka Station\'s Midori-no-Madoguchi or ticket machines. Tohoku Shinkansen (Hayabusa, Yamabiko, Komachi) depart from here.',
    zh: '请在JR盛冈站绿色窗口或指定席售票机购买。东北新干线（隼号・山彦号・小町号）在此发车。'
  },
  '名古屋': {
    ja: 'JR名古屋駅のみどりの窓口（桜通口・太閤通口）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します。',
    en: 'Purchase tickets at JR Nagoya Station\'s Midori-no-Madoguchi (Sakura-dori / Taiko-dori exits) or ticket machines. Tokaido / Sanyo Shinkansen stop here.',
    zh: '请在JR名古屋站绿色窗口（樱通口・太阁通口）或指定席售票机购买。东海道・山阳新干线在此停靠。'
  },
  '京都': {
    ja: 'JR京都駅のみどりの窓口（中央口・八条口）または指定席券売機でご購入ください。東海道・山陽新幹線が停車します。',
    en: 'Purchase tickets at JR Kyoto Station\'s Midori-no-Madoguchi (central / Hachijo exits) or ticket machines. Tokaido / Sanyo Shinkansen stop here.',
    zh: '请在JR京都站绿色窗口（中央口・八条口）或指定席售票机购买。东海道・山阳新干线在此停靠。'
  },
  '新大阪': {
    ja: 'JR新大阪駅のみどりの窓口（中央改札）または指定席券売機でご購入ください。東海道・山陽新幹線が発着します。',
    en: 'Purchase tickets at JR Shin-Osaka Station\'s Midori-no-Madoguchi (central gate) or ticket machines. Tokaido / Sanyo Shinkansen depart from here.',
    zh: '请在JR新大阪站绿色窗口（中央检票口）或指定席售票机购买。东海道・山阳新干线在此发车。'
  }
};

export const PRIVATE_EXPRESS_GUIDE = [
  {
    operator: '小田急電鉄', train: 'ロマンスカー',
    keywords: ['ロマンスカー', 'ロマンスカ', 'はこね', 'えのしま', 'さがみ', 'ホームウェイ', 'あさぎり', 'romancecar', 'romance car', 'hakone', 'enoshima', 'sagami', 'homeway', 'asagiri', '罗曼史号', '箱根号', '江之岛号', '相模号', '朝雾号'],
    mainStations: ['新宿', '町田', '相模大野', '小田原'],
    guidance: {
      ja: '小田急ロマンスカーは特急券が必要です。新宿・町田・相模大野・小田原など主要駅の「ロマンスカー特急券売り場」または駅窓口でご購入ください。Web予約（e-romancecar.com）も利用できます。',
      en: 'Odakyu Romancecar requires a limited-express ticket. Purchase at the Romancecar ticket counters or station windows at major stations (Shinjuku, Machida, Sagami-Ono, Odawara). Online reservation (e-romancecar.com) is also available.',
      zh: '小田急罗曼史号需要特急券。请在新宿・町田・相模大野・小田原等主要车站的「罗曼史号特急券售票处」或车站窗口购买。也可使用网上预约（e-romancecar.com）。'
    }
  },
  {
    operator: '東武鉄道', train: '特急（りょうもう・けごん・スペーシア等）',
    keywords: ['りょうもう', 'けごん', 'きぬ', 'スペーシア', 'スペーシアX', 'リバティ', 'リバティけごん', 'きりふり', 'ryomo', 'kegon', 'kinu', 'spacia', 'liberty', 'kirifuri', '两毛号', '华严号', '鬼怒号', '特快spacia', '利伯缇号'],
    mainStations: ['浅草', '北千住', '春日部', '東武動物公園'],
    guidance: {
      ja: '東武特急（りょうもう・けごん・スペーシア等）は特急券が必要です。浅草・北千住・春日部・東武動物公園など主要駅の特急券売り場・窓口でご購入ください。Web予約も利用できます。',
      en: 'Tobu limited expresses (Ryomo, Kegon, Spacia etc.) require a limited-express ticket. Purchase at ticket counters / windows at major stations (Asakusa, Kita-Senju, Kasukabe, Tobu-Dobutsu-Koen). Online reservation is also available.',
      zh: '东武特急（两毛号・华严号・特快spacia等）需要特急券。请在浅草・北千住・春日部・东武动物公园等主要车站的特急券售票处・窗口购买。也可网上预约。'
    }
  },
  {
    operator: '京成電鉄', train: 'スカイライナー等',
    keywords: ['スカイライナー', 'シティライナー', 'モーニングライナー', 'イブニングライナー', 'skyliner', 'city liner', 'morning liner', 'evening liner', '天空号'],
    mainStations: ['京成上野', '日暮里', '成田空港'],
    guidance: {
      ja: '京成スカイライナーは特急券が必要です。京成上野・日暮里・成田空港など主要駅の特急券売り場・窓口（または券売機）でご購入ください。Web予約も利用できます。',
      en: 'Keisei Skyliner requires a limited-express ticket. Purchase at ticket counters / windows (or machines) at major stations (Keisei-Ueno, Nippori, Narita Airport). Online reservation is also available.',
      zh: '京成天空号需要特急券。请在京成上野・日暮里・成田机场等主要车站的特急券售票处・窗口（或售票机）购买。也可网上预约。'
    }
  },
  {
    operator: '京浜急行電鉄', train: 'ウィング号・快特',
    keywords: ['ウィング', 'モーニング・ウィング', 'イブニング・ウィング', 'wing', 'morning wing', 'evening wing', '快特', 'kaisoku tokkyu'],
    mainStations: ['品川', '横浜', '京急蒲田'],
    guidance: {
      ja: '京急のウィング号・快特は座席指定料金が必要な列車があります。品川・横浜・京急蒲田など主要駅の窓口・券売機でご確認ください（普通特急は追加料金なし）。',
      en: 'Keikyu Wing / Kaisoku Tokkyu trains may require a reserved-seat fare. Check at ticket windows / machines at major stations (Shinagawa, Yokohama, Keikyu-Kamata). Regular limited expresses need no surcharge.',
      zh: '京急的Wing号・快特部分列车需要指定座位费。请在品川・横滨・京急蒲田等主要车站的窗口・售票机确认（普通特急无需追加费用）。'
    }
  },
  {
    operator: '西武鉄道', train: 'レッドアロー・小江戸等',
    keywords: ['レッドアロー', '小江戸', '川越特急', '秩父', '拝島ライナー', 'ドームライナー', 'red arrow', 'oedo', 'kawagoe express', 'chichibu', 'haijima liner', '红箭号', '川越特急', '秩父号'],
    mainStations: ['池袋', '所沢', '本川越', '西武秩父'],
    guidance: {
      ja: '西武特急（レッドアロー・小江戸・秩父等）は特急券が必要です。池袋・所沢・本川越・西武秩父など主要駅の特急券売り場・窓口でご購入ください。Web予約も利用できます。',
      en: 'Seibu limited expresses (Red Arrow, Oedo, Chichibu etc.) require a limited-express ticket. Purchase at ticket counters / windows at major stations (Ikebukuro, Tokorozawa, Hon-Kawagoe, Seibu-Chichibu). Online reservation is also available.',
      zh: '西武特急（红箭号・小江户・秩父号等）需要特急券。请在池袋・所泽・本川越・西武秩父等主要车站的特急券售票处・窗口购买。也可网上预约。'
    }
  },
  {
    operator: '京王電鉄', train: '京王ライナー・Mt.TAKAO号',
    keywords: ['京王ライナー', 'Mt.TAKAO号', 'Mt.TAKAO', 'keio liner', '京王特快'],
    mainStations: ['新宿', '高尾山口'],
    guidance: {
      ja: '京王ライナー・Mt.TAKAO号はライナー券が必要です。新宿・高尾山口など主要駅の券売機・窓口でご購入ください。',
      en: 'Keio Liner / Mt.TAKAO require a liner ticket. Purchase at ticket machines / windows at major stations (Shinjuku, Takaosanguchi).',
      zh: '京王特快・高尾山号需要特快券。请在新宿・高尾山口等主要车站的售票机・窗口购买。'
    }
  },
  {
    operator: '東急電鉄', train: 'S-TRAIN・東横特急',
    keywords: ['S-TRAIN', '東横特急', 's-train', '都市公园特快'],
    mainStations: ['渋谷', '横浜'],
    guidance: {
      ja: '東急のS-TRAINは座席指定制です。渋谷・横浜など主要駅の窓口・券売機、またはWeb予約でご確認ください（東横特急は通常の特急で追加料金なし）。',
      en: 'Tokyu S-TRAIN is reserved-seat. Check at windows / machines at major stations (Shibuya, Yokohama) or book online. Toyoko limited express needs no surcharge.',
      zh: '东急S-TRAIN为指定座席制。请在涩谷・横滨等主要车站的窗口・售票机确认，或网上预约（东横特急为普通特急，无需追加费用）。'
    }
  },
  {
    operator: '東武鉄道（野田線）', train: 'アーバンパークライナー',
    keywords: ['アーバンパークライナー', 'urban park liner', '都市公园特快'],
    mainStations: ['大宮', '船橋', '柏'],
    guidance: {
      ja: '東武アーバンパークライナーはライナー券が必要です。大宮・船橋・柏など主要駅の窓口・券売機でご購入ください。',
      en: 'Tobu Urban Park Liner requires a liner ticket. Purchase at windows / machines at major stations (Omiya, Funabashi, Kashiwa).',
      zh: '东武都市公园特快需要特快券。请在大宫・船桥・柏等主要车站的窗口・售票机购买。'
    }
  }
];

export const AIRPORT_IATA = {
  '羽田空港': 'HND', '羽田': 'HND', 'HND': 'HND', 'hnd': 'HND', 'Haneda': 'HND', 'Haneda Airport': 'HND', '羽田机场': 'HND', '东京国际机场': 'HND', '东京国际': 'HND',
  '成田空港': 'NRT', '成田': 'NRT', 'NRT': 'NRT', 'nrt': 'NRT', 'Narita': 'NRT', 'Narita Airport': 'NRT', '成田机场': 'NRT',
  '茨城空港': 'IBR', 'IBR': 'IBR', 'ibr': 'IBR', '茨城机场': 'IBR'
};

export const AIRPORT_WEATHER_AREA = {
  HND: '130000', // 東京
  NRT: '120000', // 千葉
  IBR: '080000'  // 茨城
};

export const IATA_TO_TERMINAL_STATION = {
  // #24: HND graceful 到着の既定は国際線ターミナルの第3（フライト実データがある場合は
  // 実ターミナルで上書きされる）。第1は国内線専用のため、既定のままでは国際到着の最寄り駅が誤る。
  HND: '羽田空港第3ターミナル',
  NRT: '成田空港',
  IBR: '茨城空港（小美玉）'
};

export const DEFAULT_ACCESS_DESTINATIONS = {
  HND: ['東京駅', '品川', '浜松町'],
  NRT: ['東京駅', '日暮里', '新宿'],
  IBR: ['水戸']
};

export const ODPT_FLIGHT_STATUS_MAP = {
  Adjusting:        { ja: '機材繰り',           en: 'Adjusting aircraft',          zh: '调配飞机' },
  Arrived:          { ja: '到着済み',           en: 'Arrived',                     zh: '已到达' },
  BadWeather:       { ja: '天候不良',           en: 'Bad weather',                 zh: '天气恶劣' },
  BaggageAvailable: { ja: '手荷物引渡中',       en: 'Baggage delivery',            zh: '行李交付中' },
  BoardingComplete: { ja: '搭乗終了',           en: 'Boarding completed',          zh: '登机结束' },
  CheckInClose:     { ja: '搭乗手続終了',       en: 'Check-in closed',             zh: '值机结束' },
  CheckIn:          { ja: '搭乗手続中',         en: 'Check-in in progress',        zh: '值机中' },
  Cancelled:        { ja: '欠航',               en: 'Cancelled',                   zh: '取消' },
  Delayed:          { ja: '遅れ',               en: 'Delayed',                     zh: '延误' },
  Departed:         { ja: '出発済み',           en: 'Departed',                    zh: '已起飞' },
  DestinationChanged:{ ja: '到着地変更',        en: 'Destination changed',         zh: '目的地变更' },
  Diverted:         { ja: 'ダイバート',         en: 'Diverted',                    zh: '备降' },
  EstimatedArrival: { ja: '到着予定',           en: 'Estimated arrival',           zh: '预计到达' },
  EstimatedDeparture:{ ja: '出発予定',          en: 'Estimated departure',         zh: '预计起飞' },
  ExtraFlight:      { ja: '臨時便',             en: 'Extra flight',                zh: '临时航班' },
  FinalCall:        { ja: '最終搭乗案内',       en: 'Final call',                  zh: '最后登机通知' },
  InAir:            { ja: '航行中',             en: 'In flight',                   zh: '飞行中' },
  Indefinite:       { ja: '時刻未定',           en: 'Time indefinite',             zh: '时间未定' },
  Landed:           { ja: '着陸済み',           en: 'Landed',                      zh: '已着陆' },
  LateArrival:      { ja: '使用機遅れ',         en: 'Late aircraft arrival',       zh: '飞机晚到' },
  LeftGate:         { ja: 'ゲート出発済み',     en: 'Left gate',                   zh: '已出登机口' },
  Maintenance:      { ja: '使用機整備',         en: 'Maintenance',                 zh: '飞机维护' },
  NewTime:          { ja: '時刻変更',           en: 'Time changed',                zh: '时间变更' },
  NowBoarding:      { ja: '搭乗中',             en: 'Now boarding',                zh: '登机中' },
  OnTime:           { ja: '定刻',               en: 'On time',                     zh: '准点' },
  Other:            { ja: 'その他',             en: 'Other',                       zh: '其他' },
  PostponedTomorrow:{ ja: '翌日運行',           en: 'Postponed to tomorrow',       zh: '顺延至明日' },
  StopCheckIn:      { ja: '搭乗手続中止中',     en: 'Check-in suspended',           zh: '值机暂停' },
  Takeoff:          { ja: '離陸済み',           en: 'Departed (takeoff)',          zh: '已起飞' },
  Unknown:          { ja: '不明',               en: 'Unknown',                     zh: '不明' },
  WeatherCheck:     { ja: '天候調査中',         en: 'Weather check',               zh: '天气检查中' },
  Yesterday:        { ja: '昨日便',             en: "Yesterday's flight",          zh: '昨日航班' }
};

export const ODPT_AIRLINE_NAMES = {
  JAL: { ja: '日本航空', en: 'Japan Airlines', zh: '日本航空' },
  ANA: { ja: '全日空',   en: 'All Nippon Airways', zh: '全日空' }
};
