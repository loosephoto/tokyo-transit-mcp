/**
 * 運行状況ハンドラ（リアルタイム運行情報）
 * 各事業者の公式運行状況ページを取得し、路線別ステータスへ正規化して返す。
 * サイトがボット保護・JS描画等で直接取得できない事業者は「未取得＋公式リンク」へ
 * グレースフルに縮退する（全体の応答は失敗させない）。レジストリ方式で事業者を追加しやすい。
 * 依存: config / lib / lang
 */
import axios from 'axios';
import { jsonResponse, buildErrorResponse } from '../lib/common.mjs';
import { getDisplayLineName, translateTrainInfoDetail, resolveLang, detectLanguage } from '../lib/lang.mjs';
import { API_KEY, API_BASE_URL } from '../config.mjs';
import { parseGtfsRtFeed } from '../lib/gtfs-realtime.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// ステータス分類（英語・中国語翻訳付き）
const STATUS_MAP = {
  normal:    { ja: '平常運転', en: 'Normal operation', zh: '正常运行' },
  delay:     { ja: '遅延', en: 'Delayed', zh: '晚点' },
  partial:   { ja: '一部運休・一部列車遅延', en: 'Partial suspension / delayed', zh: '部分停运/晚点' },
  suspended: { ja: '運転見合わせ', en: 'Suspended', zh: '停运' },
  transfer:  { ja: '振替輸送', en: 'Alternative transport', zh: '振替运输' },
  unknown:   { ja: '状況確認中', en: 'Status unknown', zh: '确认中' },
};

export function classifyStatus(text) {
  if (/見合わせ|運休|運転取りやめ|運行停止|運転停止/.test(text)) return 'suspended';
  if (/一部|遅延|遅れ|ダイヤ乱れ|乱れ/.test(text)) return 'partial';
  if (/平常|通常通り|通常どおり|運転再開|運行再開/.test(text)) return 'normal';
  if (/振替/.test(text)) return 'transfer';
  return 'unknown';
}

// ---------- アダプタ: JR東日本（関東エリア） ----------
async function fetchJREast() {
  const url = 'https://traininfo.jreast.co.jp/train_info/kanto.aspx';
  const html = (await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA } })).data;
  const re = /traininfo-routes__name">([^<]+)<\/span>.*?traininfo-routes__status\s+[a-z]+">\s*<span>([^<]*)<\/span>(.*?)(?=traininfo-routes__name">|$)/gs;
  const lines = [];
  for (const m of html.matchAll(re)) {
    const statusText = m[2].trim();
    const detail = m[3].match(/traininfo-routes__note">(.*?)<\/p>/s);
    lines.push({
      line: m[1].trim(),
      status: classifyStatus(statusText),
      status_text: statusText || undefined,
      detail: detail ? detail[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : undefined
    });
  }
  const updated = (html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})時(\d{1,2})分/) || []);
  // 同一路線が区間別に複数行掲載されるため、line+status+detail でユニーク化する。
  // 平常運転の重複は先頭1件のみ残し、障害情報は detail 単位で保持。
  const seen = new Set();
  const deduped = [];
  for (const l of lines) {
    const key = `${l.line}|${l.status}|${l.detail || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(l);
  }
  // 同一路線で平常運転と障害が混在する場合、障害側を優先して平常の重複を落とす
  const disrupted = new Set(deduped.filter(l => l.status !== 'normal').map(l => l.line));
  const merged = [];
  const normalSeen = new Set();
  for (const l of deduped) {
    if (l.status === 'normal' && disrupted.has(l.line)) continue;
    if (l.status === 'normal') {
      if (normalSeen.has(l.line)) continue;
      normalSeen.add(l.line);
    }
    merged.push(l);
  }
  return { lines: merged, updated: updated.length ? `${updated[1]}-${updated[2]}-${updated[3]} ${updated[4]}:${updated[5]}` : undefined };
}

// ---------- アダプタ: 東武鉄道（trainop.xml） ----------
async function fetchTobu() {
  const url = 'https://www.tobu.co.jp/file/trainop/trainop.xml';
  const xml = (await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA } })).data;
  // <line>X</line><description>Y</description> の交互ペアを抽出
  const pairRe = /<line>([\s\S]*?)<\/line>\s*<description>([\s\S]*?)<\/description>/g;
  const lines = [];
  for (const m of xml.matchAll(pairRe)) {
    const statusText = m[2].trim();
    lines.push({
      line: m[1].trim(),
      status: classifyStatus(statusText),
      status_text: statusText || undefined,
      detail: undefined
    });
  }
  return { lines, updated: undefined };
}

// ---------- アダプタ: 京浜急行（京急線全体の単一ステータス） ----------
async function fetchKeikyu() {
  const url = 'https://unkou.keikyu.co.jp/';
  const html = (await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA } })).data;
  // <dt>2026/08/18 00:29更新</dt> <dd>京急線は平常通り運転しています。</dd>
  const m = html.match(/<dt>([^<]*)更新<\/dt>\s*<dd>(.*?)<\/dd>/s);
  const statusText = m ? m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  return {
    lines: [{ line: '京急線', status: classifyStatus(statusText), status_text: statusText || undefined, detail: undefined }],
    updated: m ? m[1].trim() : undefined
  };
}

// ---------- アダプタ: ODPT TrainStatus（標準ライセンス事業者向け） ----------
let railwayNameCache = null;
async function getRailwayNameMap() {
  if (railwayNameCache) return railwayNameCache;
  const map = {};
  try {
    const res = await axios.get(`${API_BASE_URL}/odpt:Railway`, {
      params: { 'acl:consumerKey': API_KEY }, timeout: 15000
    });
    for (const r of Array.isArray(res.data) ? res.data : []) {
      const id = String(r['owl:sameAs'] || '').split('.').pop();
      const title = r['odpt:railwayTitle'];
      const ja = typeof title === 'object' ? (title.ja || title.en) : (title ? String(title) : '');
      if (id && ja) map[id] = ja;
    }
  } catch (_) { /* 路線名辞書が取れなくても trainStatusText があれば動く */ }
  railwayNameCache = map;
  return map;
}

// 指定事業者の ODPT TrainStatus を取得し路線別ステータスへ正規化。
// ライセンス未付与（"There is no rdf:type"）やデータ無しは throw → 呼び出し元で unavailable に縮退。
async function fetchODPTStatus(odptOperator) {
  const res = await axios.get(`${API_BASE_URL}/odpt:TrainStatus`, {
    params: { 'acl:consumerKey': API_KEY, 'odpt:operator': `odpt.Operator:${odptOperator}` }, timeout: 15000
  });
  const data = res.data;
  if (!Array.isArray(data)) throw new Error('NO_TRAIN_STATUS'); // ライセンス未付与等
  if (data.length === 0) {
    // 平常時はエントリなし（全線平常運転）とみなす
    return { lines: [{ line: '全線', status: 'normal', status_text: '平常運転', detail: undefined }], updated: undefined };
  }
  const railMap = await getRailwayNameMap();
  const lines = data.map((s) => {
    const railwayId = String(s['odpt:railway'] || '').split('.').pop();
    const txt = s['odpt:trainStatusText'];
    const statusText = typeof txt === 'object' ? (txt.ja || txt.en || '') : (txt ? String(txt) : '');
    const info = s['odpt:trainInformation'];
    const detail = typeof info === 'object' ? (info.ja || info.en || '') : (info ? String(info) : undefined);
    return {
      line: railMap[railwayId] || railwayId,
      status: classifyStatus(statusText),
      status_text: statusText || undefined,
      detail: detail || undefined
    };
  });
  return { lines, updated: undefined };
}

// ---------- アダプタ: ODPT GTFS-RT 列車alert（標準ライセンス事業者向け） ----------
// odpt:TrainStatus がキー未付与でも、GTFS-RT alert は取得可能（メトロ・TX・りんかい・多摩モノレール）。
// 依存なしの protobuf デコーダ（src/lib/gtfs-realtime.mjs）でパースする。
async function fetchGtfsRtAlerts(feedName) {
  const res = await axios.get(`${API_BASE_URL}/gtfs/realtime/${feedName}`, {
    params: { 'acl:consumerKey': API_KEY }, responseType: 'arraybuffer', timeout: 15000
  });
  const feed = parseGtfsRtFeed(new Uint8Array(res.data));
  const alerts = (feed.entities || []).filter((e) => e.alert).map((e) => e.alert);
  if (!alerts.length) {
    // alert が無い = 平常時
    return { lines: [{ line: '全線', status: 'normal', status_text: '平常運転', detail: undefined }], updated: undefined };
  }
  const railMap = await getRailwayNameMap();
  const lines = alerts.map((a) => {
    const text = (a.header || a.description || '運行情報').trim();
    const routeNames = (a.routes || []).map((r) => {
      const last = String(r).split('.').pop();
      return railMap[last] || railMap[r] || last;
    });
    return {
      line: routeNames.length ? routeNames.join('・') : '全線',
      status: /見合わせ|運休/.test(text) ? 'suspended' : (/遅延|遅れ/.test(text) ? 'delay' : (/平常/.test(text) ? 'normal' : 'unknown')),
      status_text: text,
      detail: a.description && a.description !== text ? a.description.trim() : undefined
    };
  });
  return { lines, updated: undefined };
}

// ---------- 事業者レジストリ（追加はここに並べる） ----------
const REGISTRY = {
  jreast: {
    key: 'jreast',
    name: { ja: 'JR東日本', en: 'JR East', zh: 'JR东日本' },
    url: 'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
    fetch: fetchJREast
  },
  tokyometro: {
    key: 'tokyometro',
    name: { ja: '東京メトロ', en: 'Tokyo Metro', zh: '东京地铁' },
    url: 'https://www.tokyometro.jp/unkou/index.html',
    fetch: () => fetchGtfsRtAlerts('tokyometro_odpt_train_alert')
  },
  tobu: {
    key: 'tobu',
    name: { ja: '東武鉄道', en: 'Tobu Railway', zh: '东武铁道' },
    url: 'https://www.tobu.co.jp/service_status/',
    fetch: fetchTobu
  },
  toei: {
    key: 'toei',
    name: { ja: '都営交通', en: 'Toei', zh: '都营交通' },
    url: 'https://www.kotsu.metro.tokyo.jp/train/topics.html',
    fetch: () => fetchGtfsRtAlerts('toei_odpt_train_alert')
  },
  mir: {
    key: 'mir',
    name: { ja: 'つくばエクスプレス', en: 'Tsukuba Express', zh: '筑波快线' },
    url: 'https://www.mir.co.jp/route/unten/',
    fetch: () => fetchGtfsRtAlerts('mir_odpt_train_alert')
  },
  twr: {
    key: 'twr',
    name: { ja: 'りんかい線', en: 'TWR Rinkai Line', zh: '临海线' },
    url: 'https://www.twr.co.jp/unkou/',
    fetch: () => fetchGtfsRtAlerts('twr_odpt_train_alert')
  },
  yokohamamunicipal: {
    key: 'yokohamamunicipal',
    name: { ja: '横浜市営地下鉄', en: 'Yokohama Municipal Subway', zh: '横滨市营地铁' },
    url: 'https://www.city.yokohama.lg.jp/kotsu/subway/unkou/',
    fetch: () => fetchODPTStatus('YokohamaMunicipal')
  },
  tamamonorail: {
    key: 'tamamonorail',
    name: { ja: '多摩モノレール', en: 'Tama Toshi Monorail', zh: '多摩单轨' },
    url: 'https://www.tama-monorail.co.jp/unkou/',
    fetch: () => fetchGtfsRtAlerts('tamamonorail_odpt_train_alert')
  },
  seibu: {
    key: 'seibu',
    name: { ja: '西武鉄道', en: 'Seibu Railway', zh: '西武铁道' },
    url: 'https://www.seiburailway.jp/railway/info/',
    fetch: null
  },
  sotetsu: {
    key: 'sotetsu',
    name: { ja: '相模鉄道', en: 'Sotetsu', zh: '相模铁道' },
    url: 'https://www.sotetsu.co.jp/train/',
    fetch: null
  },
  keikyu: {
    key: 'keikyu',
    name: { ja: '京浜急行', en: 'Keikyu', zh: '京滨急行' },
    url: 'https://unkou.keikyu.co.jp/',
    fetch: fetchKeikyu
  },
  odakyu: {
    key: 'odakyu',
    name: { ja: '小田急', en: 'Odakyu', zh: '小田急' },
    url: 'https://www.odakyu.jp/train/',
    fetch: null
  },
  tokyu: {
    key: 'tokyu',
    name: { ja: '東急', en: 'Tokyu', zh: '东急' },
    url: 'https://www.tokyu.co.jp/railway/unkou/',
    fetch: null
  },
  keisei: {
    key: 'keisei',
    name: { ja: '京成電鉄', en: 'Keisei', zh: '京成电铁' },
    url: 'https://www.keisei.co.jp/keisei/tetudou/unkou/index.php',
    fetch: null
  }
};

const ORDER = ['jreast', 'tokyometro', 'tobu', 'toei', 'seibu', 'sotetsu', 'keikyu', 'odakyu', 'tokyu', 'keisei', 'mir', 'twr', 'yokohamamunicipal', 'tamamonorail'];

export function localizeStatusLine(line, userLang) {
  return {
    line: getDisplayLineName(line.line, userLang),
    status: STATUS_MAP[line.status]?.[userLang] || line.status,
    status_text: translateTrainInfoDetail(line.status_text, userLang),
    detail: translateTrainInfoDetail(line.detail, userLang)
  };
}

export async function getRunningStatus(args) {
  const userLang = resolveLang(args) || detectLanguage(args?.operator) || 'ja';
  const rawOp = String(args?.operator || 'all').trim().toLowerCase();
  const wanted = rawOp === 'all' || rawOp === '' ? ORDER : [rawOp];

  const result = { status: 'SUCCESS', detected_language: userLang, timestamp: new Date().toISOString(), operators: [] };
  const operatorResults = new Map();

  // 並行フェッチ（一部失敗しても全体は成功を返す）
  await Promise.all(wanted.map(async (key) => {
    const def = REGISTRY[key];
    if (!def) {
      operatorResults.set(key, { operator: key, name: key, available: false, error: 'unknown_operator', message: userLang === 'en' ? 'Unknown operator.' : userLang === 'zh' ? '未知的事业者。' : '不明な事業者です。' });
      return;
    }
    try {
      if (!def.fetch) throw new Error('NO_ADAPTER');
      const data = await def.fetch();
      const lines = (data.lines || []).map((l) => localizeStatusLine(l, userLang));
      operatorResults.set(key, {
        operator: def.key, name: def.name[userLang] || def.name.ja, available: true, updated: data.updated,
        url: def.url, lines
      });
    } catch (error) {
      // ボット保護・JS描画・未実装アダプタ等は未取得として公式リンクへ縮退
      operatorResults.set(key, {
        operator: def.key, name: def.name[userLang] || def.name.ja, available: false, url: def.url,
        message: userLang === 'en'
          ? 'Live status could not be retrieved from the operator. Please check the official page.'
          : userLang === 'zh' ? '无法从该事业者获取实时运行状况，请查看官网。' : 'この事業者のリアルタイム運行状況を直接取得できませんでした。公式ページをご確認ください。'
      });
    }
  }));
  result.operators = wanted.map((key) => operatorResults.get(key)).filter(Boolean);

  return jsonResponse(result);
}
