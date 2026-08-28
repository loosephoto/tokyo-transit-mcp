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
  ['東京', true], ['渋谷', true], ['新宿', true], ['これは存在しない駅名XYZ', false],
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
