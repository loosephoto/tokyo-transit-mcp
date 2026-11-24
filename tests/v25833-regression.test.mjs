// v2.58.33 回帰テスト — content の Markdown 化（JSON は 2 ブロック目・structuredContent に維持）
// 実行: node tests/v25833-regression.test.mjs
//
// 背景:
//   14 ツール中 12 ツールが content に整形なしの JSON 文字列だけを返していた。
//   LLM・人間が読みやすい Markdown を 1 ブロック目に置き、機械向け JSON は
//   2 ブロック目と structuredContent に残す（後方互換）。
//   このテストは「表が壊れない・値が変わらない・JSON が消えない」ことを固定する。
import { toMarkdown } from '../src/lib/markdown.mjs';
import { jsonResponse } from '../src/lib/common.mjs';
import { listTransitOperators, searchRoute } from '../src/index.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (cond, m, extra) => { if (cond) ok(m); else fail(extra ? `${m} — ${extra}` : m); };

console.log('=== v2.58.33: content Markdown 化（回帰） ===');

// --- 1. 表の妥当性（平坦なオブジェクト配列） ---
{
  const md = toMarkdown({
    status: 'SUCCESS',
    title: '🚢 港一覧',
    ports: [
      { id: 'A', name: '竹芝', name_en: 'Takeshiba', url: 'https://example.com/a' },
      { id: 'B', name: '大島', name_en: 'Oshima', url: 'https://example.com/b' }
    ]
  });
  eq(md.startsWith('# 🚢 港一覧'), 'title が # 見出しになる');
  eq(/\n\| id \| name \| name_en \| url \|/.test(md), 'ヘッダー行を持つ表になる');
  eq(md.includes('| A | 竹芝 | Takeshiba | <https://example.com/a> |'), 'URL は <url> でリンク化・値は保持');
  eq(md.split('\n').every(l => !/^\s+\|/.test(l)), '表の行がインデントされない（Markdown としてレンダリングされる）');
}

// --- 2. 入れ子の配列（表＋小見出し） ---
{
  const md = toMarkdown({
    status: 'SUCCESS',
    operator_name: 'yurikamome',
    routes: [{ railway: 'ゆりかもめ', station_count: 2, stations: [{ index: 0, name: '新橋' }, { index: 1, name: '汐留' }] }]
  });
  eq(md.startsWith('# yurikamome'), 'operator_name から見出しを導く');
  eq(md.includes('### ゆりかもめ') && md.includes('stations（全 2 件）'), '入れ子を含む配列は項目見出し＋入れ子の節で出す');
  eq(md.includes('#### stations（全 2 件）') && md.includes('| 0 | 新橋 |'), '入れ子配列は行頭の小見出し＋表で出す');
  eq(md.split('\n').every(l => !/^\s{2,}\|/.test(l)), '入れ子の表も行頭から始まる');
}

// --- 3. AI アドバイスは原文のまま先頭側に残る（#94 / #122） ---
{
  const advice = '⚠️ AIからのインテリジェントアドバイス: 山手線は平常運転です。';
  const md = toMarkdown({ status: 'SUCCESS', ai_transit_advice: advice, routes: [{ line: 'JR山手線', stops: 3 }] });
  eq(md.includes(advice), 'AI アドバイスを原文のまま含む');
  const r = jsonResponse({ status: 'SUCCESS', ai_transit_advice: advice, from: 'a', to: 'b' });
  eq(r.content.length === 2, 'content は Markdown と JSON の 2 ブロック');
  eq(r.content[0].text.includes(advice), 'content[0] はアドバイスを含む Markdown');
  let parsed = null;
  try { parsed = JSON.parse(r.content[1].text); } catch { /* noop */ }
  eq(parsed !== null, 'content[1] は JSON としてパースできる（後方互換ブロック）');
  eq(parsed && !Object.hasOwn(parsed, 'ai_transit_advice'), 'JSON ブロックからは ai_transit_advice を除く（従来仕様）');
  eq(r.structuredContent && r.structuredContent.ai_transit_advice === advice, 'structuredContent にはアドバイスを含める');
}

// --- 4. 値の完全性: JSON ブロックは payload と一致（キー欠落なし） ---
{
  const payload = { status: 'SUCCESS', detected_language: 'ja', station: '新宿', results: [{ id: 'x', name: '新宿', code: 'E-27' }], total: 1 };
  const r = jsonResponse(payload);
  const parsed = JSON.parse(r.content[1].text);
  eq(JSON.stringify(parsed) === JSON.stringify(payload), 'JSON ブロックは payload と完全一致');
  eq(JSON.stringify(r.structuredContent) === JSON.stringify(payload), 'structuredContent は payload と完全一致');
}

// --- 5. エラー応答（isError / Markdown のエラー文） ---
{
  const err = { status: 'ERROR', error_type: 'STATION_NOT_FOUND', error_message: '駅が見つかりません。', error_code: 404, retryable: false, suggestions: ['別の駅名を試してください。'] };
  const r = jsonResponse(err);
  eq(r.isError === true, 'status=ERROR で isError=true を維持');
  eq(r.content[0].text.includes('**STATION_NOT_FOUND**: 駅が見つかりません。'), 'エラーは Markdown でも種別＋文言を出す');
  eq(r.content[0].text.includes('別の駅名を試してください。'), 'suggestions も落とさない');
}

// --- 6. NO_DATA は「該当なし」を Markdown でも示す ---
{
  const md = toMarkdown({ status: 'NO_DATA', message: '該当するデータはありません。', items: [] });
  eq(md.includes('status: NO_DATA') && md.includes('該当するデータはありません。'), 'NO_DATA の理由をメタ行に出す');
  eq(md.includes('- **items**: —'), '空配列は「—」で明示する（黙って消さない）');
}

// --- 7. 大きな配列は行数上限つきで切る（structuredContent 側は全件） ---
{
  const rows = Array.from({ length: 150 }, (_, i) => ({ index: i, name: `駅${i}` }));
  const md = toMarkdown({ status: 'SUCCESS', stations: rows });
  eq((md.match(/^\| \d+ \|/gm) || []).length === 100, '表は 100 行で打ち切る');
  eq(md.includes('全 150 件中 100 件を表示'), '打ち切ったことを明示する');
  const r = jsonResponse({ status: 'SUCCESS', stations: rows });
  eq(r.structuredContent.stations.length === 150, 'structuredContent は全 150 件を保持');
}

// --- 8. TOKYO_TRANSIT_TEXT_FORMAT でブロックを絞れる ---
{
  const payload = { status: 'SUCCESS', note: 'test', items: [{ a: 1, b: 2 }] };
  process.env.TOKYO_TRANSIT_TEXT_FORMAT = 'json';
  const onlyJson = jsonResponse(payload);
  eq(onlyJson.content.length === 1 && onlyJson.content[0].text.trim().startsWith('{'), 'json 指定では JSON のみ');
  process.env.TOKYO_TRANSIT_TEXT_FORMAT = 'markdown';
  const onlyMd = jsonResponse(payload);
  eq(onlyMd.content.length === 1 && !onlyMd.content[0].text.trim().startsWith('{'), 'markdown 指定では Markdown のみ');
  delete process.env.TOKYO_TRANSIT_TEXT_FORMAT;
}

// --- 9. 実ツール（オフライン）で Markdown＋JSON が返る ---
{
  const res = await listTransitOperators({ type_filter: 'ferry', language: 'ja' });
  eq(res.content.length === 2, 'list_transit_operators: content は 2 ブロック');
  eq(typeof res.content[0].text === 'string' && res.content[0].text.includes('| 東海汽船 |'), 'content[0] に事業者名が表で入る');
  const json = JSON.parse(res.content[1].text);
  eq(json.operators.length === res.structuredContent.operators.length, 'JSON ブロックと structuredContent の件数が一致');
}

// --- 10. displayText 指定ツール（search_route のエラー等）は従来どおりの形 ---
{
  const r = await searchRoute({ from: 'これは存在しない駅XYZ', to: '新宿', language: 'ja' });
  eq(r.isError === true && r.structuredContent.error_type === 'STATION_NOT_FOUND', 'エラー種別は structuredContent で不変');
  const texts = (r.content || []).map(c => c.text);
  eq(texts.some(t => t.trim().startsWith('{')), 'JSON テキストブロックが残る（既存プローブ互換）');
}

console.log('');
if (failures === 0) {
  console.log('✅ v2.58.33 回帰テスト: すべて成功');
  process.exit(0);
} else {
  console.log(`❌ v2.58.33 回帰テスト: ${failures} 件の失敗`);
  process.exit(1);
}
