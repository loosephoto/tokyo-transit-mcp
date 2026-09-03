// 代表ツールの正常系・入力エラー系・多言語系の決定的自動テスト（#109 対応方針6）
// 外部ネットワーク/APIに依存しない、内部ロジックのみで検証可能なケースを集める。
// 実行: node tests/handlers-basic.test.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { server, searchRoute, resolveStation, detectLanguage } from '../src/index.mjs';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---- 内部関数の検証（外部API不要）----
console.log('=== 正常系・エラー系・多言語系 代表テスト ===');

// 言語判定（detectLanguage）
console.log('-- 言語判定 --');
const langCases = [
  ['東京', 'ja'], ['Shinjuku', 'en'], ['涩谷', 'zh'], ['', 'ja'],
];
for (const [input, expected] of langCases) {
  const got = detectLanguage(input);
  if (got === expected) ok(`detectLanguage('${input}') = '${got}'`);
  else fail(`detectLanguage('${input}') = '${got}', expected '${expected}'`);
}

// 駅解決（resolveStation）
console.log('-- 駅名解決 --');
const stCases = [
  ['東京', true], ['渋谷', true], ['新宿', true], ['Asakusa', true], ['Tsukishima', true], ['これは存在しない駅名XYZ', false],
];
for (const [input, shouldResolve] of stCases) {
  try {
    const res = resolveStation(input);
    const resolved = !!(res && res.station && !res.ambiguous);
    if (resolved === shouldResolve) {
      ok(`resolveStation('${input}') -> ${resolved ? '解決' : '未解決'}`);
    } else {
      fail(`resolveStation('${input}') -> ${resolved ? '解決' : '未解決'}, expected ${shouldResolve ? '解決' : '未解決'}`);
    }
  } catch (e) {
    fail(`resolveStation('${input}') threw: ${e.message}`);
  }
}

// ---- MCP経由のエラー応答検証（isError / エラー種別）----
// 江ノ電の路線指定付き駅名（#江ノ電対応）
console.log('-- 江ノ電 路線指定 --');
for (const [from, to] of [['江ノ電 藤沢', '江ノ電 鎌倉'], ['藤沢 江ノ電', '鎌倉 江ノ電']]) {
  const result = (await searchRoute({ from, to, language: 'ja' }));
  const text = (result.content || []).map(c => c.text || '').join(' ');
  const payload = result.structuredContent || {};
  const route = payload.routes?.[0];
  if (route?.summary?.main_line === '江ノ島電鉄' && route.summary.transfers === 0) {
    ok(`江ノ電指定 ${from} → ${to}: 江ノ島電鉄直通`);
  } else {
    fail(`江ノ電指定 ${from} → ${to}: ${text.slice(0, 200)}`);
  }
}

// 山手線・京浜東北線の略称／表記ゆれ付き路線指定
console.log('-- 山手線・京浜東北線 路線指定 --');
for (const [from, to, expected, label] of [
  ['山の手 東京', '山の手 新宿', 'JR山手線', '山の手'],
  ['山手 東京', '山手 新宿', 'JR山手線', '山手'],
  ['京浜東北 大宮', '京浜東北 東京', '京浜東北線', '京浜東北']
]) {
  const result = await searchRoute({ from, to, language: 'ja' });
  const text = (result.content || []).map(c => c.text || '').join(' ');
  const payload = result.structuredContent || {};
  const route = payload.routes?.[0];
  if (route?.summary?.main_line === expected && route.summary.transfers === 0) {
    ok(`${label}指定 ${from} → ${to}: ${expected}直通`);
  } else {
    fail(`${label}指定 ${from} → ${to}: ${text.slice(0, 200)}`);
  }
}

// 片側のみ路線指定時の乗換経路探索（NO_ROUTE 回避）
console.log('-- 片側路線指定の乗換経路 --');
const enoToTokyo = await searchRoute({ from: '江ノ電 鎌倉', to: '東京', language: 'ja' });
const enoPayload = enoToTokyo.structuredContent || {};
if (enoPayload.routes && enoPayload.routes.length > 0 && enoPayload.routes[0].segments?.length > 0) {
  ok('江ノ電 鎌倉 → 東京: 乗換経路が正常に算出される');
} else {
  fail('江ノ電 鎌倉 → 東京: 経路が見つからない');
}

// JR根岸線「山手駅」単体解決（路線指定との誤認防止）
console.log('-- 山手駅 単体解決 --');
const yamateRes = resolveStation('山手');
if (yamateRes.station === '山手' && yamateRes.exact && !yamateRes.ambiguous) {
  ok('山手駅単体: 根岸線山手駅として一意解決される');
} else {
  fail(`山手駅単体: 誤解決 (${JSON.stringify(yamateRes)})`);
}
const yamateRoute = await searchRoute({ from: '山手', to: '東京', language: 'ja' });
const yamatePayload = yamateRoute.structuredContent || {};
if (yamatePayload.routes && yamatePayload.routes.length > 0) {
  ok('山手 → 東京: 経路が正常に算出される');
} else {
  fail('山手 → 東京: 経路が見つからない');
}

// フェリー代替案内の存在確認
console.log('-- フェリー代替案内 --');
const ferryRoute = await searchRoute({ from: '浅草', to: 'お台場', language: 'ja' });
const ferryPayload = ferryRoute.structuredContent || {};
const ferryText = (ferryRoute.content || []).map(c => c.text || '').join(' ');
if (ferryPayload.ferry_alternative && ferryText.includes('フェリー航路のご案内')) {
  ok('浅草 → お台場: ferry_alternative が正しく付与される');
} else {
  fail('浅草 → お台場: ferry_alternative が欠落している');
}

console.log('-- MCPエラー応答（未知ツール・必須引数欠落）--');
const client = new Client({ name: 'handlers-basic-test', version: '1.0.0' });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

// 未知ツール名の呼び出し（#101: isError:true が付与されること）
try {
  const res = await client.callTool({ name: 'no_such_tool', arguments: {} });
  const text = (res.content || []).map(c => c.text || '').join(' ');
  if (res.isError === true) {
    ok(`未知ツール呼び出し: isError=true でエラー応答`);
  } else {
    fail(`未知ツール呼び出しの isError が true でない: isError=${JSON.stringify(res.isError)} text=${text.slice(0, 80)}`);
  }
} catch (e) {
  ok(`未知ツール呼び出し: 例外/エラー応答 (${e.message || 'thrown'})`);
}

// 必須引数欠落（search_route に from/to なし）→ INVALID_INPUT が isError:true で返る（#101）
try {
  const res = await client.callTool({ name: 'search_route', arguments: {} });
  const text = (res.content || []).map(c => c.text || '').join(' ');
  if (res.isError === true) {
    ok(`search_route(引数欠落): isError=true でエラー応答`);
  } else {
    fail(`search_route(引数欠落)の isError が true でない: isError=${JSON.stringify(res.isError)} text=${text.slice(0, 80)}`);
  }
} catch (e) {
  ok(`search_route(引数欠落): 例外/エラー応答 (${e.message || 'thrown'})`);
}

// 正常応答には isError が付かない（undefined であること）
try {
  const res = await client.callTool({ name: 'list_transit_operators', arguments: { language: 'ja' } });
  if (res.isError === undefined || res.isError === false) {
    ok(`正常応答 list_transit_operators: isError なし（成功扱い）`);
  } else {
    fail(`正常応答に isError=true が付いてしまった: ${JSON.stringify(res.isError)}`);
  }
} catch (e) {
  fail(`正常応答 list_transit_operators が例外: ${e.message}`);
}

await client.close();
await server.close();

console.log('');
if (failures === 0) {
  console.log('✅ 代表ツールテスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ 代表ツールテスト: ${failures} 件の失敗`);
  process.exit(1);
}
