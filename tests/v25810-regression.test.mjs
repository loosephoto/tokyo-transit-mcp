// v2.58.10 監査修正（バッチ1）の回帰テスト
// 実行: node tests/v25810-regression.test.mjs
//
// 背景: 4層（共通ロジック・ハンドラ・データ・性能）の実測監査で確定した不具合の回帰防止。
//   L-1 GTFS-RT Alert のフィールド番号が公式 proto とずれ、header が空・routes が空・
//       effect と cause が入れ替わっていた（実フィード 247B/1alert で実測）
//   P-1 retryOnRateLimit に総予算が無く 1 呼び出しが 31,136ms ブロックした
//   P-2 CircuitBreaker の OPEN→HALF-OPEN 遷移で探査フラグを立てておらず、同時 2 件が通過した
//   S-1 get_station_info の operator enum に非鉄道 28 キーが無く zod で弾かれていた
//   S-2 list_transit_operators の type_filter に bus / ferry が無く 18 社に到達できなかった
//   D-1 「仙川」の en が Senkawa（千川と衝突）
//   D-2 JR埼京線に「さいたま新都心」が欠落（19 駅 / 実際 20 駅）
import { spawn } from 'node:child_process';
import { parseGtfsRtFeed } from '../src/lib/gtfs-realtime.mjs';
import { retryOnRateLimit, CircuitBreaker } from '../src/config.mjs';
import { RAILWAY_LINES } from '../src/data/railway-lines.mjs';
import { EXPECTED_RAILWAY_STATION_COUNTS } from '../src/data/expected-railway-counts.mjs';
import { STATION_DISPLAY_NAMES } from '../src/data/station-names.mjs';
import { OPERATOR_MAP, NON_RAIL_OPERATORS } from '../src/data/misc.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (actual, expected, label) =>
  actual === expected ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);

// ---------------- protobuf エンコーダ（テスト用の最小実装） ----------------
function varint(n) {
  const out = [];
  let v = n >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return out;
}
const tag = (field, wire) => varint((field << 3) | wire);
function pbBytes(field, buf) { return [...tag(field, 2), ...varint(buf.length), ...buf]; }
function pbString(field, s) { return pbBytes(field, [...Buffer.from(s, 'utf8')]); }
function pbVarint(field, n) { return [...tag(field, 0), ...varint(n)]; }
// TranslatedString { repeated Translation translation = 1; } / Translation { string text = 1; string language = 2; }
const translated = (entries) => entries.flatMap(([lang, text]) => pbBytes(1, [...pbString(1, text), ...pbString(2, lang)]));

// 公式 gtfs-realtime.proto の Alert 番号でフィードを組み立てる
function buildAlertFeed({ header, desc, routeId, cause, effect, url }) {
  const informedEntity = routeId ? pbString(2, routeId) : null; // EntitySelector.route_id = 2
  const alert = [
    ...(informedEntity ? pbBytes(5, informedEntity) : []), // informed_entity = 5
    ...pbVarint(6, cause),                                 // cause = 6
    ...pbVarint(7, effect),                                // effect = 7
    ...(url ? pbBytes(8, translated([['en', url]])) : []),  // url = 8
    ...pbBytes(10, translated([['en', header.en], ['ja', header.ja]])), // header_text = 10
    ...pbBytes(11, translated([['ja', desc.ja], ['en', desc.en]])),     // description_text = 11
  ];
  const entity = [...pbString(1, 'alert-1'), ...pbBytes(5, alert)]; // FeedEntity.alert = 5
  return new Uint8Array([...pbString(1, '2.0'), ...pbBytes(2, entity)]); // FeedMessage.entity = 2
}

console.log('-- GTFS-RT Alert のフィールド番号 (L-1) --');
{
  const feed = parseGtfsRtFeed(buildAlertFeed({
    header: { ja: '銀座線で遅延', en: 'Ginza Line delays' },
    desc: { ja: '銀座線は車両点検のため上下線で最大10分の遅延が発生しています。', en: 'Up to 10 min delays.' },
    routeId: 'odpt.Railway:TokyoMetro.Ginza',
    cause: 2, effect: 3, url: 'https://www.tokyometro.jp/unkou/',
  }));
  const a = feed.entities[0]?.alert || {};
  eq(a.header, '銀座線で遅延', 'header は field10(header_text) から読む（url ではない）');
  eq(a.description, '銀座線は車両点検のため上下線で最大10分の遅延が発生しています。', 'description は field11 から読む');
  eq((a.routes || []).join(','), 'odpt.Railway:TokyoMetro.Ginza', 'routes は informed_entity(field5) から読む');
  eq(a.effect, 3, 'effect は field7');
  eq(a.cause, 2, 'cause は field6');
  if (a.header === 'https://www.tokyometro.jp/unkou/') fail('header に url(field8) が混入している');
  else ok('url(field8) を header として読んでいない');
}
{
  // 実フィード（tokyometro 247B）と同じ形: url なし・英/韓/中 混在
  const feed = parseGtfsRtFeed(buildAlertFeed({
    header: { ja: '一部列車遅延', en: 'Some trains delayed' },
    desc: { ja: '一部の列車に遅れが出ています。', en: 'Some trains are delayed.' },
    routeId: '4', cause: 2, effect: 3,
  }));
  const a = feed.entities[0].alert;
  eq(a.header, '一部列車遅延', 'ja 翻訳を優先する（en が先頭でも）');
  eq(a.description, '一部の列車に遅れが出ています。', '詳細文が失われない');
  eq(a.routes.length, 1, 'route_id を 1 件返す');
}

console.log('-- 429 リトライの総予算 (P-1) --');
{
  const always429 = async () => {
    const err = new Error('HTTP 429');
    err.response = { status: 429, headers: { 'retry-after': '60' } };
    throw err;
  };
  const t0 = Date.now();
  let threw = null;
  try {
    await retryOnRateLimit(always429, { label: 'test-429', totalBudgetMs: 1500, maxWaitMs: 200, maxRetries: 20 });
  } catch (e) { threw = e; }
  const elapsed = Date.now() - t0;
  if (!threw) fail('総予算を超えても throw しなかった');
  else {
    eq(threw.code, 'RATE_LIMIT_BUDGET_EXCEEDED', '総予算超過は RATE_LIMIT_BUDGET_EXCEEDED で返る');
    if (elapsed <= 2200) ok(`31秒ブロックしない（実測 ${elapsed}ms / 予算 1500ms）`);
    else fail(`予算超過後も待ち続けた: ${elapsed}ms`);
  }
  // Retry-After が HTTP-date でも数値化される（NaN で無視されない）
  const dateStr = new Date(Date.now() + 1000).toUTCString();
  let calls = 0;
  const failOnce = async () => {
    calls++;
    if (calls === 1) { const e = new Error('429'); e.response = { status: 429, headers: { 'retry-after': dateStr } }; throw e; }
    return 'ok';
  };
  const res = await retryOnRateLimit(failOnce, { label: 'test-date', totalBudgetMs: 5000, maxWaitMs: 150 });
  eq(res, 'ok', 'HTTP-date 形式の Retry-After でもリトライが成立する');
}

console.log('-- CircuitBreaker の HALF-OPEN 探査 (P-2) --');
{
  // onFailure は段階的クールダウン（60/120/180秒）を固定値で入れるため、
  // テストでは状態だけを直接作り、クールダウン経過を模擬する。
  const openAndExpire = () => {
    const b = new CircuitBreaker('test-breaker', 1, 60000);
    b.state = 'OPEN';
    b.cooldownPeriod = 1000;
    b.lastStateChanged = Date.now() - 2000; // クールダウン経過済み
    return b;
  };
  const b = openAndExpire();
  const passed = [b.canExecute(), b.canExecute(), b.canExecute(), b.canExecute(), b.canExecute()].filter(Boolean).length;
  eq(passed, 1, 'クールダウン明けの同時リクエストは 1 件だけ通す');
  eq(b.state, 'HALF-OPEN', '遷移後は HALF-OPEN');

  // 報告漏れ（onSuccess/onFailure を呼ばない）でも探査が自動失効する
  const b2 = openAndExpire();
  eq(b2.canExecute(), true, '探査1件目は通る');
  eq(b2.canExecute(), false, '探査中は追加を止める');
  // 報告漏れのままクールダウン相当時間が経過した状況を作る
  b2.lastStateChanged = Date.now() - 2000;
  b2._probeStartedAt = Date.now() - 2000;
  eq(b2.canExecute(), true, '報告漏れでもクールダウン経過後に探査が復活する');
}

console.log('-- データ整合 (D-1 / D-2) --');
{
  eq(STATION_DISPLAY_NAMES['仙川']?.en, 'Sengawa', '仙川の英語名は Sengawa');
  const sengawa = STATION_DISPLAY_NAMES['仙川']?.en;
  const senkawa = STATION_DISPLAY_NAMES['千川']?.en;
  if (sengawa !== senkawa) ok('仙川と千川の英語名が衝突しない');
  else fail(`仙川と千川の英語名が衝突: ${sengawa}`);
  const saikyo = RAILWAY_LINES['JR埼京線'] || [];
  if (saikyo.includes('さいたま新都心')) ok('JR埼京線に「さいたま新都心」がある');
  else fail('JR埼京線に「さいたま新都心」が無い');
  const iKitayono = saikyo.indexOf('北与野');
  const iSaitama = saikyo.indexOf('さいたま新都心');
  const iOmiya = saikyo.indexOf('大宮');
  if (iKitayono >= 0 && iKitayono < iSaitama && iSaitama < iOmiya) ok('駅順は 北与野 → さいたま新都心 → 大宮');
  else fail(`駅順が不正: 北与野=${iKitayono} さいたま新都心=${iSaitama} 大宮=${iOmiya}`);
  eq(EXPECTED_RAILWAY_STATION_COUNTS['JR埼京線'], saikyo.length, '期待駅数が実データと一致する');
}

console.log('-- tools/list の enum と実装の一致 (S-1 / S-2) --');
{
  const tools = await requestToolsList();
  const stationInfo = tools.find((t) => t.name === 'get_station_info');
  const operators = stationInfo?.inputSchema?.properties?.operator?.enum || [];
  const missing = Object.keys(NON_RAIL_OPERATORS).filter((k) => !operators.includes(k));
  eq(missing.length, 0, `get_station_info.operator に非鉄道 ${Object.keys(NON_RAIL_OPERATORS).length} キーが揃う（欠落 ${missing.join(',') || 'なし'}）`);
  const railMissing = Object.keys(OPERATOR_MAP).filter((k) => !operators.includes(k));
  eq(railMissing.length, 0, 'get_station_info.operator に鉄道キーも揃う');

  const listTool = tools.find((t) => t.name === 'list_transit_operators');
  const tf = listTool?.inputSchema?.properties?.type_filter?.enum || [];
  for (const v of ['rail', 'agt', 'monorail', 'tram', 'bus', 'ferry', 'all']) {
    if (tf.includes(v)) ok(`type_filter に '${v}' がある`);
    else fail(`type_filter に '${v}' が無い`);
  }
  // 🔴 v2.58.30 (#121): find_nearby_stops 追加で 13 → 14
  eq(tools.length, 14, 'ツール数は 14');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}

// stdio で MCP サーバを起動し tools/list を 1 回だけ取得する（外部通信なし）
function requestToolsList() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('../src/index.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
      cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let inited = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('tools/list timeout')); }, 20000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result && !inited) {
          inited = true;
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        } else if (m.id === 2 && m.result) {
          clearTimeout(timer);
          child.kill();
          resolve(m.result.tools || []);
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'v25810-test', version: '1' } } }) + '\n');
  });
}
