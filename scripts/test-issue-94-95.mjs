// Issue #94/#95 regression tests: official community-bus URLs and maritime fail-safe states.
import { TOKYO_COMMUNITY_BUSES, COMMUNITY_BUS_ROUTES } from '../src/data/bus-routes.mjs';
import {
  isTsunamiRelevantToPorts,
  buildTsunamiWaterSafetyResponse,
  buildSevereWeatherWaterSafetyResponse
} from '../src/handlers/ferry.mjs';

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    process.exitCode = 1;
  } else console.log('✅', message);
}
function payload(response) {
  const text = (response?.content || []).map(x => x.text || '').find(t => t.trim().startsWith('{'));
  return JSON.parse(text || '{}');
}

const expectedUrls = new Map([
  ['荒川区', 'https://www.city.arakawa.tokyo.jp/a040/koutsuu-bus/komyuniteibasu/sakura.html'],
  ['昭島市', 'https://www.city.akishima.lg.jp/kurashi/bus/1002242/index.html'],
  ['稲城市', 'https://www.city.inagi.tokyo.jp/kurashi/koutsuu/1002846/1002848/index.html'],
  ['国立市', 'https://www.city.kunitachi.tokyo.jp/kurashi/kotsu/3/1/index.html'],
  ['新宿区', 'https://www.city.shinjuku.lg.jp/seikatsu/kotsu01_000001_00022.html'],
  ['東大和市', 'https://www.city.higashiyamato.lg.jp/kurashi/dorokotsu/1002085/index.html'],
  ['文京区', 'https://www.city.bunkyo.lg.jp/b011/p001057/index.html'],
  ['調布市', 'https://www.city.chofu.lg.jp/080070/p050018.html']
]);
for (const [municipality, url] of expectedUrls) {
  const record = TOKYO_COMMUNITY_BUSES.find(x => x.municipality === municipality);
  assert(record?.url === url, `#94 ${municipality}: 現行自治体公式URL`);
}
for (const municipality of ['文京区', '新宿区']) {
  const route = COMMUNITY_BUS_ROUTES.find(x => x.municipality === municipality);
  assert(route?.url === expectedUrls.get(municipality), `#94 ${municipality}: 検索ルートURLも同期`);
}

assert(isTsunamiRelevantToPorts({ available: false, active: false }, '東京・竹芝', '大島'), '#95 津波API障害は航路停止');
assert(!isTsunamiRelevantToPorts({ available: true, active: false }, '東京・竹芝', '大島'), '#95 正常取得・警報なしは停止しない');
const tsunamiUnknown = payload(await buildTsunamiWaterSafetyResponse('ja', { available: false, active: false, source: 'test' }));
assert(tsunamiUnknown.status === 'MARITIME_SAFETY_UNKNOWN', '#95 津波判定不能ステータス');
assert(tsunamiUnknown.maritime_safety_status?.tsunami_warning_active === null, '#95 津波activeはnull');
assert(tsunamiUnknown.route_guidance_suspended === true && !tsunamiUnknown.routes, '#95 判定不能時は航路を返さない');
const weatherUnknown = payload(await buildSevereWeatherWaterSafetyResponse('ja', '', '', { weather_check_available: false }));
assert(weatherUnknown.status === 'MARITIME_SAFETY_UNKNOWN', '#95 港の気象判定不能ステータス');
assert(weatherUnknown.maritime_safety_status?.wind_wave_warning_active === null, '#95 気象警報activeはnull');
assert(weatherUnknown.route_guidance_suspended === true && !weatherUnknown.routes, '#95 気象判定不能時は航路を返さない');
console.log('done');
