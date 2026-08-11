// 全12ツール × ja/en/zh 一括検証プローブ（最終確認版）
// 各ツールのレスポンスに「検索言語と不一致の文字」が残っていないか機械チェック
// en: 漢字・かなが残ると NG / zh: かな（ひらがな・カタカナ）が残ると NG
import fs from 'fs';

const loadEnv = () => {
  const env = fs.readFileSync('.env', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
};
loadEnv();

const { searchRoute, searchFare, getWeather, getTimetable, searchBus, getStationInfo,
  listTransitOperators, listCommunityBuses, getOperatorRoutes, listFerryPorts, searchFerry, searchFlight } =
  await import('../src/index.mjs');

const KANA = /[\u3040-\u30ff]/;
const KANJI = /[\u4e00-\u9fff]/;

function findLangMismatch(obj, lang, path = '', out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    if (lang === 'en' && (KANA.test(obj) || KANJI.test(obj))) out.push(`${path}: ${obj.slice(0, 60)}`);
    else if (lang === 'zh' && KANA.test(obj)) out.push(`${path}: ${obj.slice(0, 60)}`);
    return out;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => findLangMismatch(v, lang, `${path}[${i}]`, out)); return out; }
  if (typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) findLangMismatch(v, lang, path ? `${path}.${k}` : k, out); }
  return out;
}

const IGNORE_PATHS = [/error/i, /message$/, /note$/, /data_source/, /official_website/, /fallback_url/,
  /airport$/, /route_id/, /trip_id/, /stop_id/, /id$/, /_source/, /operator$/, /municipality/, /website/,
  /route$/, /flight_iata/, /airport_iata/, /other_airport/, /status$/, /status_text/,
  /^name$/, /\.name$/, /resolved_busstop/, /^busstop$/, /\.number$/, /\.frequency$/, /\.ships_id$/,
  /\.terminal$/, /\.gate$/, /\.baggage$/];

const isIgnored = (p) => {
  const path = p.split(':')[0].trim();
  if (IGNORE_PATHS.some(re => re.test(path))) return true;
  if (/name_zh$|name_en$/.test(path)) return true;
  return false;
};

const results = [];
const run = async (name, lang, args, fn) => {
  const t0 = Date.now();
  try {
    const res = await fn(args);
    const data = res.structuredContent || (() => {
      const texts = (res.content || []).filter(c => c.type === 'text').map(c => c.text);
      const jsonText = texts.find(t => t.trim().startsWith('{')) || texts[0];
      return JSON.parse(jsonText);
    })();
    const expectedStatuses = args.__expectedStatuses || ['SUCCESS', 'NO_DATA'];
    if (!expectedStatuses.includes(data.status)) {
      throw new Error(`unexpected status: ${data.status || 'missing'}`);
    }
    const mismatches = findLangMismatch(data, lang, '').filter(p => !isIgnored(p));
    const ok = mismatches.length === 0;
    results.push({ name, lang, ok, ms: Date.now() - t0, detail: mismatches.slice(0, 5) });
    console.log(`${ok ? '✅' : '❌'} [${lang}] ${name} (${((Date.now()-t0)/1000).toFixed(1)}s)${ok ? '' : ' | ' + mismatches.slice(0,3).join(' ;; ')}`);
  } catch (e) {
    results.push({ name, lang, ok: false, ms: Date.now() - t0, detail: [e.message?.slice(0, 80) || String(e)] });
    console.log(`⚠️  [${lang}] ${name} ERROR: ${e.message?.slice(0, 80)}`);
  }
};

await run('search_route', 'en', { from: 'Shinjuku', to: 'Odawara', language: 'en' }, searchRoute);
await run('search_route', 'zh', { from: '新宿', to: '小田原', language: 'zh' }, searchRoute);
await run('search_fare', 'en', { from: 'Shinjuku', to: 'Shibuya', language: 'en' }, searchFare);
await run('search_fare', 'zh', { from: '新宿', to: '涩谷', language: 'zh' }, searchFare);
await run('get_weather', 'en', { area_name: 'Tokyo', language: 'en' }, getWeather);
await run('get_weather', 'zh', { area_name: '东京', language: 'zh' }, getWeather);
await run('get_timetable', 'en', { station_name: 'Shinjuku', railway: 'JR山手線', language: 'en' }, getTimetable);
await run('get_timetable', 'zh', { station_name: '新宿', railway: 'JR山手線', language: 'zh' }, getTimetable);
await run('search_bus(transfer)', 'en', { from: 'Sakurabashi', to: 'Shintomicho', language: 'en' }, searchBus);
await run('search_bus(transfer)', 'zh', { from: '樱桥', to: '新富町', language: 'zh' }, searchBus);
await run('search_bus(busstop)', 'en', { busstop_name: 'Shimbashi', language: 'en' }, searchBus);
await run('search_bus(busstop)', 'zh', { busstop_name: '新桥', language: 'zh' }, searchBus);
await run('get_station_info', 'en', { station_name: 'Shinjuku', language: 'en' }, getStationInfo);
await run('get_station_info', 'zh', { station_name: '新宿', language: 'zh' }, getStationInfo);
await run('list_transit_operators', 'en', { language: 'en' }, listTransitOperators);
await run('list_transit_operators', 'zh', { language: 'zh' }, listTransitOperators);
await run('list_community_buses', 'en', { language: 'en' }, listCommunityBuses);
await run('list_community_buses', 'zh', { language: 'zh' }, listCommunityBuses);
await run('get_operator_routes', 'en', { operator_name: 'tokyometro', language: 'en' }, getOperatorRoutes);
await run('get_operator_routes', 'zh', { operator_name: 'tokyometro', language: 'zh' }, getOperatorRoutes);
await run('list_ferry_ports', 'en', { language: 'en' }, listFerryPorts);
await run('list_ferry_ports', 'zh', { language: 'zh' }, listFerryPorts);
await run('search_ferry', 'en', { from_port: 'Tokyo', to_port: 'Oshima', language: 'en', __expectedStatuses: ['SUCCESS', 'NO_DATA', 'SEVERE_WEATHER_ADVISORY'] }, searchFerry);
await run('search_ferry', 'zh', { from_port: '东京', to_port: '大岛', language: 'zh', __expectedStatuses: ['SUCCESS', 'NO_DATA', 'SEVERE_WEATHER_ADVISORY'] }, searchFerry);
await run('search_flight', 'en', { airport: 'Haneda', direction: 'arrival', language: 'en' }, searchFlight);
await run('search_flight', 'zh', { airport: '羽田机场', direction: 'arrival', language: 'zh' }, searchFlight);

console.log('\n===== サマリー =====');
const fails = results.filter(r => !r.ok);
console.log(`総ケース: ${results.length} / PASS: ${results.length - fails.length} / FAIL: ${fails.length}`);
process.exit(fails.length ? 1 : 0);
