// #84 検証: ODPT通信障害をSUCCESS/fare:nullに変換しないこと
import axios from 'axios';
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

// ---- シナリオA: 全駅解決がネットワーク失敗(ECONNRESET) ----
const realGet = axios.get;
axios.get = async () => { const e = new Error('connect ECONNRESET'); e.code = 'ECONNRESET'; throw e; };
let respA;
try { respA = parseResp(await mod.searchFare({ from: '赤坂', to: '渋谷', language: 'ja' })); } catch (e) { respA = { status: 'THREW', e }; }
console.log('シナリオA(駅解決失敗):', JSON.stringify({ status: respA.status, error_type: respA.error_type }));
if (respA.status === 'SUCCESS' && respA.fare === null) assert(false, 'A: 通信障害をSUCCESS/fare:nullにした');
else assert(true, `A: 通信障害をエラー応答にした (${respA.status}/${respA.error_type})`);
assert(['NETWORK_ERROR','API_TIMEOUT'].includes(respA.error_type) || respA.status==='THREW', 'A: エラータイプがNETWORK_ERROR/API_TIMEOUT');

// ---- シナリオB: 駅解決は成功するが運賃取得が失敗 ----
axios.get = async (url, opts) => {
  if (String(url).includes('odpt:Station')) return { data: [
    { 'owl:sameAs': 'odpt.Station:TokyoMetro.Akasaka', 'odpt:operator': 'odpt.Operator:TokyoMetro', 'dc:title': '赤坂' },
    { 'owl:sameAs': 'odpt.Station:TokyoMetro.Shibuya', 'odpt:operator': 'odpt.Operator:TokyoMetro', 'dc:title': '渋谷' }
  ]};
  const e = new Error('connect ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e;
};
let respB;
try { respB = parseResp(await mod.searchFare({ from: '赤坂', to: '渋谷', language: 'ja' })); } catch (e) { respB = { status: 'THREW', e }; }
console.log('シナリオB(運賃取得失敗):', JSON.stringify({ status: respB.status, error_type: respB.error_type }));
if (respB.status === 'SUCCESS') assert(false, 'B: 運賃取得障害をSUCCESSにした');
else assert(true, `B: 運賃取得障害をエラー応答にした (${respB.status}/${respB.error_type})`);

axios.get = realGet;

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);