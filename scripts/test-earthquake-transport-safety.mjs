// 地震時の交通モード別安全処理回帰テスト（API不要）
import * as mod from '../src/index.mjs';

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✅', message);
  }
}

function payload(response) {
  const text = (response?.content || []).map(x => x.text).find(x => x?.trim().startsWith('{')) || '{}';
  return JSON.parse(text);
}

async function checkGround(language) {
  const route = payload(await mod.searchRoute({ from: '東京', to: '新宿', '-test': language === 'zh' ? '地震' : 'earthquake', language }));
  assert(route.status === 'EMERGENCY_MODE_ACTIVE', `${language}: search_route emergency mode`);
  assert(route.transport_mode === 'ground', `${language}: search_route ground mode`);
  assert(route.route_guidance_suspended === true, `${language}: search_route stops normal route guidance`);
  assert(!route.routes, `${language}: search_route does not return routes`);
  assert(Array.isArray(route.transport_safety?.guidance) && route.transport_safety.guidance.length >= 3, `${language}: ground safety guidance present`);

  const bus = payload(await mod.searchBus({ from: '渋谷', to: '新宿', '-test': language === 'en' ? 'earthquake' : '地震', language }));
  assert(bus.status === 'EMERGENCY_MODE_ACTIVE', `${language}: search_bus emergency mode`);
  assert(bus.transport_mode === 'ground' && bus.route_guidance_suspended, `${language}: search_bus suppresses ground transfer`);
  assert(!bus.route, `${language}: search_bus does not return route`);
}

async function checkWater(language) {
  const ferry = payload(await mod.searchFerry({ from_port: '浅草', to_port: '浜離宮', '-test': language === 'en' ? 'earthquake' : '地震', language }));
  assert(ferry.status === 'EMERGENCY_MODE_ACTIVE', `${language}: search_ferry emergency mode`);
  assert(ferry.transport_mode === 'water', `${language}: search_ferry water mode`);
  assert(ferry.route_guidance_suspended === true, `${language}: search_ferry stops water route guidance`);
  assert(!ferry.routes, `${language}: search_ferry does not return routes`);
  assert(Array.isArray(ferry.transport_safety?.guidance) && ferry.transport_safety.guidance.length >= 3, `${language}: water safety guidance present`);
  const text = JSON.stringify(ferry.transport_safety);
  assert(language !== 'ja' || text.includes('高台') && text.includes('乗組員'), `${language}: water guidance includes higher ground and crew instruction`);
}

for (const language of ['ja', 'en', 'zh']) {
  await checkGround(language);
  await checkWater(language);
}

console.log('done');
