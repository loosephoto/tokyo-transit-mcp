// フェリーの津波安全情報・公式避難場所レイヤー回帰テスト
import * as mod from '../src/index.mjs';

function assert(condition, message) {
  if (!condition) { console.error('❌ FAIL:', message); process.exitCode = 1; }
  else console.log('✅', message);
}
function payload(response) {
  const texts = (response?.content || []).map(x => x.text || '');
  return { data: JSON.parse(texts.find(t => t.trim().startsWith('{')) || '{}'), advice: texts.find(t => t.includes('AI')) || '' };
}

// 公式JMA APIを利用する通常検索: 警報が無い場合は安全状態を返す。
const normal = payload(await mod.searchFerry({ from_port: '浅草', to_port: '浜離宮', language: 'ja' }));
assert(normal.data.status === 'SUCCESS', '通常時: フェリー検索成功');
assert(normal.data.maritime_safety_status?.source === 'JMA Tsunami Information', '通常時: JMA津波情報ソースを返す');
assert(normal.data.maritime_safety_status?.tsunami_warning_active === false, '通常時: 有効な津波警報なしを返す');
assert(normal.data.maritime_safety_status?.official_tsunami_info_url?.includes('jma.go.jp'), '通常時: JMA公式津波情報リンクを返す');

for (const [language, token, marker] of [
  ['ja', '津波', '水上交通'],
  ['en', 'tsunami', 'Water-Transport'],
  ['zh', '海啸', '水上交通安全']
]) {
  const simulated = payload(await mod.searchFerry({ from_port: '浅草', to_port: '浜離宮', '-test': token, language }));
  assert(simulated.data.status === 'EMERGENCY_MODE_ACTIVE', `${language}: 津波時は緊急モード`);
  assert(simulated.data.emergency_type === 'tsunami', `${language}: 津波種別を返す`);
  assert(simulated.data.route_guidance_suspended === true, `${language}: 航路案内を停止する`);
  assert(!simulated.data.routes, `${language}: 航路を返さない`);
  assert(simulated.data.tsunami_emergency_shelter?.source, `${language}: 国土地理院の津波対応避難場所データソースを返す`);
  assert(simulated.data.tsunami_emergency_shelter?.hazard_field === '津波', `${language}: 津波対応施設だけを絞り込む`);
  assert(JSON.stringify(simulated.data.transport_safety).includes(marker), `${language}: 水上避難の安全助言を返す`);
}
console.log('done');
