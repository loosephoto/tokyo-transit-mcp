// MCP tools/list 応答の決定的な自動テスト（#109 受け入れ条件5）
// 全ツールの列挙・annotations の存在・4項目すべての boolean を検証する。
// 実行: node tests/tools-list.test.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { server } from '../src/index.mjs';

// 期待する全13ツール（#103 で列挙）
const EXPECTED_TOOLS = [
  'search_route',
  'get_station_info',
  'get_weather',
  'list_ferry_ports',
  'search_ferry',
  'list_transit_operators',
  'list_community_buses',
  'get_operator_routes',
  'search_flight',
  'search_fare',
  'get_timetable',
  'search_bus',
  'get_running_status',
];

const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

async function main() {
  console.log('=== MCP tools/list 検証テスト ===');

  const client = new Client({ name: 'tools-list-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  // 🔴 #104: capabilities.logging が宣言されているか（sendLoggingMessage で通知可能）
  const caps = server.getCapabilities ? server.getCapabilities() : null;
  const loggingDeclared = !!(caps && caps.logging);
  if (loggingDeclared) {
    ok('capabilities.logging が宣言されている');
  } else {
    fail('capabilities.logging が宣言されていない');
  }

  const { tools } = await client.listTools();
  console.log(`listTools() が返したツール数: ${tools.length}`);

  // 1) 全13ツールが列挙される
  const listedNames = tools.map(t => t.name);
  const missing = EXPECTED_TOOLS.filter(n => !listedNames.includes(n));
  const extra = listedNames.filter(n => !EXPECTED_TOOLS.includes(n));
  if (missing.length === 0 && extra.length === 0) {
    ok(`全13ツールが列挙されている（重複・欠落なし）`);
  } else {
    if (missing.length) fail(`列挙されていないツール: ${missing.join(', ')}`);
    if (extra.length) fail(`想定外のツール: ${extra.join(', ')}`);
  }

  // 2) 各ツールに annotations が存在し、4項目すべて boolean
  let annotationsPresent = 0;
  for (const tool of tools) {
    const ann = tool.annotations;
    if (!ann || typeof ann !== 'object') {
      fail(`${tool.name}: annotations が存在しない`);
      continue;
    }
    let valid = true;
    for (const key of ANNOTATION_KEYS) {
      const v = ann[key];
      if (typeof v !== 'boolean') {
        fail(`${tool.name}.annotations.${key} が boolean でない: ${JSON.stringify(v)}`);
        valid = false;
      }
    }
    if (valid) annotationsPresent++;
  }
  if (annotationsPresent === EXPECTED_TOOLS.length) {
    ok(`全${annotationsPresent}ツールに annotations が存在し、4項目すべて boolean`);
  } else {
    fail(`annotations 正常: ${annotationsPresent}/${EXPECTED_TOOLS.length}`);
  }

  // 3) 読み取り専用ツールの期待値: readOnlyHint=true / destructiveHint=false / idempotentHint=true / openWorldHint=true
  //    （#109 本文の期待値。このサーバーの全ツールは検索・取得系で副作用なし）
  let readonlyOk = 0;
  for (const tool of tools) {
    const a = tool.annotations || {};
    const expected = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    const actual = {
      readOnlyHint: a.readOnlyHint,
      destructiveHint: a.destructiveHint,
      idempotentHint: a.idempotentHint,
      openWorldHint: a.openWorldHint,
    };
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      readonlyOk++;
    } else {
      fail(`${tool.name}: annotations 期待値と不一致 ${JSON.stringify(actual)}`);
    }
  }
  if (readonlyOk === EXPECTED_TOOLS.length) {
    ok(`全${readonlyOk}ツールの annotations が期待値（true/false/true/true）と一致`);
  } else {
    fail(`annotations 期待値一致: ${readonlyOk}/${EXPECTED_TOOLS.length}`);
  }

  // 4) 各ツールに inputSchema が存在し、name が非空
  let schemaOk = 0;
  for (const tool of tools) {
    if (tool.name && tool.inputSchema && typeof tool.inputSchema === 'object' && tool.inputSchema.type === 'object') {
      schemaOk++;
    } else {
      fail(`${tool.name || '(name無し)'}: inputSchema が不正`);
    }
  }
  ok(`全${schemaOk}ツールに有効な inputSchema（type=object）`);

  await client.close();
  await server.close();

  console.log('');
  if (failures === 0) {
    console.log('✅ tools/list 検証テスト: すべて成功');
    process.exit(0);
  } else {
    console.log(`❌ tools/list 検証テスト: ${failures} 件の失敗`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('テスト実行中に例外:', e);
  process.exit(1);
});
