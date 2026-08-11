// #80 検証: search_bus 部分一致のサイレント1件選択をAMBIGUOUS_BUS_STOPに変更
// - 完全一致は従来どおり解決
// - 複数候補（前方一致）は AMBIGUOUS_BUS_STOP + disambiguation を返す
// - 候補に系統名:IDノイズ（「桜町病院:60008:...」）が混入しない
import * as mod from '../src/index.mjs';

let fail = 0;
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); fail++; } else console.log('✅ OK:', msg); };
const parseResp = (res) => {
  const cont = res?.content || [];
  for (const c of cont) {
    if (c?.type === 'text' && (c.text || '').trim().startsWith('{')) {
      try { const j = JSON.parse(c.text); if (j.status) return j; } catch (e) {}
    }
  }
  return { status: 'UNPARSED' };
};

// 1. 完全一致（英名・日本語とも）は従来どおり SUCCESS
const r1 = parseResp(await mod.searchBus({ from: 'Sakurabashi', to: 'Shintomicho', language: 'en' }));
assert(r1.status === 'SUCCESS', `1: 完全一致(英名)は SUCCESS を維持 (${r1.status})`);
const r2 = parseResp(await mod.searchBus({ from: '桜橋', to: '新富町', language: 'ja' }));
assert(r2.status === 'SUCCESS', `2: 完全一致(日本語)は SUCCESS を維持 (${r2.status})`);

// 2. 主要駅（完全一致 or 一意前方一致）は SUCCESS のまま
const majorStations = ['新橋', '渋谷', '新宿', '大門', '田町', '五反田', '品川', '池袋', '上野', '浅草', '銀座', '日本橋'];
let majorOk = true;
const majorResults = [];
for (const q of majorStations) {
  const r = parseResp(await mod.searchBus({ from: q, to: '渋谷', language: 'ja' }));
  if (r.status !== 'SUCCESS') { majorOk = false; majorResults.push(`${q}=${r.status}/${r.error_type || ''}`); }
}
assert(majorOk, `2: 主要駅が全て SUCCESS (${majorResults.join(', ') || 'all ok'})`);

// 3. 複数候補（前方一致で複数ヒット）は AMBIGUOUS_BUS_STOP + disambiguation
const ambProbes = ['高輪', '芝浦', '桜', '本郷'];
let ambDetected = false;
for (const q of ambProbes) {
  const r = parseResp(await mod.searchBus({ from: q, to: '渋谷', language: 'ja' }));
  if (r.error_type === 'AMBIGUOUS_BUS_STOP') {
    ambDetected = true;
    // 候補にノイズ（「:」「：」含み）が混入しない
    const noisy = (r.disambiguation?.candidates_raw || []).some(c => /[：:〜→|]/.test(String(c)));
    assert(!noisy, `3: "${q}" の候補に系統名:IDノイズが無い`);
    assert(Array.isArray(r.disambiguation?.candidates_raw) && r.disambiguation.candidates_raw.length > 1,
      `3: "${q}" の disambiguation.candidates_raw が複数候補`);
    assert(r.disambiguation?.input === q, `3: "${q}" の disambiguation.input が入力値`);
  } else if (r.status === 'SUCCESS') {
    console.log(`   (skip) "${q}" は一意解決: ${r.from}`);
  } else {
    console.log(`   (skip) "${q}" は ${r.status}/${r.error_type || ''}`);
  }
}
assert(ambDetected, '3: 曖昧クエリのうち少なくとも1つが AMBIGUOUS_BUS_STOP を返す');

// 4. 曖昧応答の言語対応（ja は日本語メッセージ、en は英語メッセージ）
const rEn = parseResp(await mod.searchBus({ from: '高輪', to: '渋谷', language: 'en' }));
if (rEn.error_type === 'AMBIGUOUS_BUS_STOP') {
  assert(/[A-Za-z]/.test(rEn.error_message) && !/[\u3040-\u30ff]/.test(rEn.error_message),
    `4: en の曖昧メッセージが英語 (${rEn.error_message?.slice(0, 60)})`);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);