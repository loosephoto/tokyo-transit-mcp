/**
 * 多言語表示名・翻訳（モノリス分割 Phase 3）
 * data/ の辞書（STATION_DISPLAY_NAMES / LINE_DISPLAY_NAMES / COMMUNITY_BUS_NAME_MAP /
 * BUS_STOP_SUFFIX_MAP / WEATHER_TERM_MAP / TRAIN_INFO_TERM_MAP）を import して使用する。
 */
import { STATION_DISPLAY_NAMES, LINE_DISPLAY_NAMES } from '../data/station-names.mjs';
import { COMMUNITY_BUS_NAME_MAP, BUS_STOP_SUFFIX_MAP } from '../data/bus-routes.mjs';
import { WEATHER_TERM_MAP, TRAIN_INFO_TERM_MAP } from '../data/misc.mjs';

export function getDisplayStationName(stationName, userLang) {
  if (!stationName) return '';
  if (userLang === 'ja') return stationName;
  const trans = STATION_DISPLAY_NAMES[stationName];
  if (trans && trans[userLang]) return trans[userLang];
  return stationName;
}

export function getLineDisplayName(lineName, userLang) {
  if (!lineName) return '';
  if (userLang === 'ja') return lineName;
  const trans = LINE_DISPLAY_NAMES[lineName];
  if (trans && trans[userLang]) return trans[userLang];
  return lineName;
}

export function getCommunityBusDisplayName(busName, userLang) {
  if (!busName || userLang === 'ja') return busName;
  const t = (COMMUNITY_BUS_NAME_MAP[userLang] || {})[busName];
  return t || busName;
}

export function getCommunityBusStopDisplayName(stopName, userLang) {
  if (!stopName || userLang === 'ja') return stopName;
  // 「新宿駅西口」→ 駅名「新宿」＋接尾辞「西口」 に分解
  for (const [suffix, trans] of Object.entries(BUS_STOP_SUFFIX_MAP[userLang] || {})) {
    if (stopName.endsWith(suffix)) {
      const stationPart = stopName.slice(0, -suffix.length);
      const stName = stationPart.replace(/駅$/, '');
      const stTrans = getDisplayStationName(stName, userLang);
      return stTrans + (stationPart.endsWith('駅') ? (userLang === 'en' ? ' Sta.' : '站') : '') + trans;
    }
  }
  // 接尾辞なし: 駅名のみ
  if (stopName.endsWith('駅')) {
    const stTrans = getDisplayStationName(stopName.replace(/駅$/, ''), userLang);
    return stTrans + (userLang === 'en' ? ' Sta.' : '站');
  }
  return stopName;
}

export function getDisplayLineName(lineName, userLang) {
  if (!lineName || userLang === 'ja') return lineName;
  const trans = LINE_DISPLAY_NAMES[lineName];
  if (trans && trans[userLang]) return trans[userLang];
  const norm = lineName.replace(/[・\s]/g, '');
  // 1. 完全一致
  for (const [key, t] of Object.entries(LINE_DISPLAY_NAMES)) {
    if (key.replace(/[・\s]/g, '') === norm) {
      if (t[userLang]) return t[userLang];
    }
  }
  // 2. 主要プレフィックス付き完全一致（東京メトロ / 都営 / JR）
  for (const p of ['東京メトロ', '都営', 'JR']) {
    const prefixed = `${p}${norm}`;
    for (const [key, t] of Object.entries(LINE_DISPLAY_NAMES)) {
      if (key.replace(/[・\s]/g, '') === prefixed) {
        if (t[userLang]) return t[userLang];
      }
    }
  }
  // 3. 部分一致で解決（例: "丸ノ内線" → "東京メトロ丸ノ内線"）
  for (const [key, t] of Object.entries(LINE_DISPLAY_NAMES)) {
    const keyNorm = key.replace(/[・\s]/g, '');
    if (keyNorm.includes(norm) || norm.includes(keyNorm)) {
      if (t[userLang]) return t[userLang];
    }
  }
  return lineName;
}

export function translateWeather(text, userLang) {
  if (!text || userLang === 'ja') return text;
  const entries = (WEATHER_TERM_MAP[userLang] || []).slice().sort((a, b) => b[0].length - a[0].length);
  const pattern = entries.map(e => e[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // 最長一致を優先した一括置換（置換結果が再度翻訳される二重翻訳を防ぐ）
  let t = pattern ? text.replace(new RegExp(pattern, 'g'), matched => {
    const entry = entries.find(e => e[0] === matched);
    return entry ? entry[1] : matched;
  }) : text;
  // 全角スペースは英中では通常のスペースに（JMAテキスト由来の整形用スペース）
  t = t.split('\u3000').join(' ');
  t = t.trim();
  // 2026-08 天気表示障害の修正（v2.25.0）: 辞書漏れで日本語が残った場合、
  // en は漢字・かなとも NG、zh はかな NG → 未翻訳語を除去し、全体が日本語のままなら汎用メッセージへ。
  if (userLang === 'en' ? /[\u3040-\u30ff\u4e00-\u9fff]/.test(t) : /[\u3040-\u30ff]/.test(t)) {
    if (userLang === 'en') {
      // かな・漢字を含む断片を除去（例: 「thunderを伴う」→「thunder」）
      t = t.replace(/[\u3040-\u30ff\u4e00-\u9fff]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    } else {
      // かなのみ除去（漢字は中国語として通用する）
      t = t.replace(/[\u3040-\u30ff]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }
    if (!t) {
      t = userLang === 'en'
        ? 'Weather forecast for the area is available in Japanese (see JMA).'
        : '该地区天气预报目前仅提供日语（请参阅日本气象厅）。';
    }
  }
  return t;
}

export function translateTrainInfoDetail(text, userLang) {
  if (!text || userLang === 'ja') return text;
  const dict = new Map();
  for (const [ja, disp] of Object.entries(LINE_DISPLAY_NAMES)) {
    if (disp && disp[userLang] && !dict.has(ja)) dict.set(ja, disp[userLang]);
  }
  for (const [ja, disp] of Object.entries(STATION_DISPLAY_NAMES)) {
    if (disp && disp[userLang] && !dict.has(ja)) dict.set(ja, disp[userLang]);
  }
  for (const [ja, localized] of (TRAIN_INFO_TERM_MAP[userLang] || [])) {
    if (!dict.has(ja)) dict.set(ja, localized);
  }
  const entries = [...dict.entries()].sort((a, b) => b[0].length - a[0].length);
  const pattern = entries.map(e => e[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  let t = pattern ? text.replace(new RegExp(pattern, 'g'), m => dict.get(m)) : text;
  // 日本語が残れば汎用メッセージにフォールバック（en はかな・漢字とも NG、zh はかなのみ NG）
  if (userLang === 'en' ? /[\u3040-\u30ff\u4e00-\u9fff]/.test(t) : /[\u3040-\u30ff]/.test(t)) {
    t = userLang === 'en'
      ? 'Train services are disrupted; substitute bus transport may be in operation. Please follow station staff guidance.'
      : '列车运行受到影响，可能正在实施接驳换乘巴士。请遵从车站工作人员的指引。';
  }
  return t.replace(/[ \t]+/g, ' ').replace(/\s*([,.])\s*/g, '$1 ').trim();
}

export function detectLanguage(text) {
  if (!text) return 'ja';
  const str = text.trim();
  if (!str) return 'ja';
  // かな（ひらがな・カタカナ）を含む → 日本語
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(str)) return 'ja';
  // 漢字（CJK）を1文字も含まない → 英語
  // （-> / → / / / ( ) などの記号を含む英字入力もすべて英語として判定される）
  if (!/[\u3400-\u9FFF\uF900-\uFAFF]/.test(str)) return 'en';
  // 中国語シグナル: 簡体字専用字（日本語に存在しない字形。漢字は日本語でも使われるため、
  // 「日本語に無い字形」のみを判定に使う。例: 場→场、東→东、線→线、関→关）
  const zhChars = /[场东车机门银视动关风积灾电号涩沪这吗呢很从您请让说时颱澀灣這嗎從請讓]/;
  // 中国語の語彙・機能語（地名・交通・天候・機能語を広くカバー）
  const zhWords = ['台风','积水','淹水','火灾','停电','酷暑','中暑','积雪','暴雨','海啸','海嘯',
    '地震','人身事故','信号故障','降雪','台场','站台','换乘','票价','时刻表','地铁','电车',
    '巴士','机场','车站','线路','路线','前往','出发','到达','查询','怎么','如何','最近','附近',
    '几点','多少','航班','列车','天气','码头','碼頭','渡轮','轮渡','要多久','多少钱',
    // 交通・地名拡充（中国語ユーザーがよく使う表記。ただし東京/大阪等の大都市名は
    // 日中で表記が共通するため判定シグナルには使わない）
    '合羽桥','坐巴士','坐车','坐地铁',' bus','坐','去','到','从','巴士站',
    '公交车','公车','捷运','高铁','火车','怎么去','怎么走','多长时间','多久','几点发车','首班车','末班车',
    '浅草寺','雷门','雷門','晴空塔','天空树'];
  if (zhWords.some(w => str.includes(w))) return 'zh';
  if (zhChars.test(str)) return 'zh';
  // かな無し・漢字のみの入力で中国語の方向助詞を含む場合 → 中国語
  // （例: 品川到新宿 / 从浅草出发。日本語は「から」「まで」「へ」をかなで書くため競合しない）
  if (/(从|到(?!着)|去|请|您|怎|吗|呢)/.test(str)) return 'zh';
  // かな無し・漢字のみ（英字・かな・簡体字専用字なし）の入力:
  // 日本語地名（浅草・新宿等）と中国語地名（合羽桥・道具街等）が混在し判定困難なため、
  // このヒューリスティクスでは「中国語らしい語彙/字形/助詞が無い」= 日本語（ja）とする。
  return 'ja';
}

export function resolveLang(args) {
  const raw = args?.language || args?.lang;
  if (raw === 'en' || raw === 'zh' || raw === 'ja') return raw;
  return null;
}
