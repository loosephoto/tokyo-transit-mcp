// #79 検証: 天気キャッシュの地域非依存・失敗時SUCCESS/null問題
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

// ---- シナリオ1: 地域別キャッシュ（東京→横浜で混ざらない） ----
const realGet = axios.get;
let calls = [];
axios.get = async (url) => {
  calls.push(url);
  const code = url.match(/forecast\/(\d+)\.json/)?.[1] || '130000';
  return { data: [{
    timeSeries: [{
      areas: [{ weathers: [`${code === '140000' ? '横浜' : '東京'}の天気 晴れ`] }],
    }],
  }] };
};
const rTokyo = parseResp(await mod.getWeather({ area_name: '東京', language: 'ja' }));
const rYoko = parseResp(await mod.getWeather({ area_name: '横浜', language: 'ja' }));
console.log('東京:', JSON.stringify({ status: rTokyo.status, area: rTokyo.area, weather: rTokyo.weather }));
console.log('横浜:', JSON.stringify({ status: rYoko.status, area: rYoko.area, weather: rYoko.weather }));
assert(rTokyo.area === '東京', '1: 東京の地域表示が東京');
assert(rYoko.area === '横浜', '1: 横浜の地域表示が横浜');
assert(rTokyo.weather !== rYoko.weather, '1: 東京と横浜の天気が混ざらない');
assert(calls.filter(u => u.includes('140000')).length >= 1, '1: 横浜のAPI(140000)が呼ばれた');
assert(calls.filter(u => u.includes('130000')).length >= 1, '1: 東京のAPI(130000)が呼ばれた');

// ---- シナリオ2: 通信失敗時はエラー応答（未キャッシュの茨城エリアで検証） ----
axios.get = async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; };
const rFail = parseResp(await mod.getWeather({ area_name: '茨城', language: 'ja' }));
console.log('失敗時:', JSON.stringify({ status: rFail.status, error_type: rFail.error_type }));
assert(rFail.status !== 'SUCCESS', '2: 通信失敗時 SUCCESS を返さない');
assert(['NETWORK_ERROR','API_TIMEOUT','CIRCUIT_BREAKER_OPEN'].includes(rFail.error_type), '2: エラータイプが通信障害系');

// ---- シナリオ3: 横浜指定の en/zh が Tokyo/东京固定にならない ----
axios.get = async (url) => {
  const code = url.match(/forecast\/(\d+)\.json/)?.[1] || '130000';
  return { data: [{
    timeSeries: [{ areas: [{ weathers: ['晴れ'] }] }],
  }] };
};
const rEn = parseResp(await mod.getWeather({ area_name: '横浜', language: 'en' }));
const rZh = parseResp(await mod.getWeather({ area_name: '横浜', language: 'zh' }));
console.log('en:', JSON.stringify({ area: rEn.area, status: rEn.status }));
console.log('zh:', JSON.stringify({ area: rZh.area, status: rZh.status }));
assert(rEn.area === 'Yokohama', '3: en 表示が Yokohama (got ' + rEn.area + ')');
assert(rZh.area === '横滨', '3: zh 表示が 横滨 (got ' + rZh.area + ')');
// 東京も固定表示が正しいラベルになる
const rEnT = parseResp(await mod.getWeather({ area_name: '東京', language: 'en' }));
assert(rEnT.area === 'Tokyo', '3: en 東京表示が Tokyo (got ' + rEnT.area + ')');

// ---- シナリオ4: 既知エリアコードがラベル無しでも area_name が残る ----
const rUnknown = parseResp(await mod.getWeather({ area_name: '札幌', language: 'en' }));
assert(rUnknown.area === '札幌' || rUnknown.status === 'SUCCESS', '4: 未知エリアも東京固定にならない (got ' + rUnknown.area + '/' + rUnknown.status + ')');

axios.get = realGet;
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);