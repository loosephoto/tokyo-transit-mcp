// 検証プローブ: searchBus 乗り継ぎモードの from/to/stops 多言語ローカライズ
// 実行: プロジェクトルートで `node scripts/probe-bus-transfer-lang.mjs`
// exit 0 = 全PASS / exit 1 = FAIL
import { searchBus } from '../src/index.mjs';

// jsonResponse の MCP 形式 {content:[{type:'text',text:JSON}]} をアンラップ
const unwrap = (r) => {
  const blocks = (r && Array.isArray(r.content)) ? r.content : [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const t = blocks[i]?.text;
    if (typeof t === 'string' && t.trim().startsWith('{')) {
      try { return JSON.parse(t); } catch { /* next */ }
    }
  }
  return r || {};
};

const results = [];
const check = (name, cond, detail) => {
  results.push({ name, ok: !!cond, detail: cond ? 'OK' : detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`);
};

// 1) 英語
const en = unwrap(await searchBus({ from: '桜橋', to: '月島', language: 'en' }));
console.log('--- EN ---');
console.log(JSON.stringify({ status: en.status, detected_language: en.detected_language, from: en.from, to: en.to, route: en.route }, null, 1));
check('en detected_language', en.detected_language === 'en', `got ${en.detected_language}`);
const r0 = en.route?.[0], r1 = en.route?.[1];
check('en route[0] from=Sakurabashi', r0 && r0.from === 'Sakurabashi', `got ${r0?.from}`);
check('en route[0] to=Shintomicho', r0 && r0.to === 'Shintomicho', `got ${r0?.to}`);
check('en route[1] from=Shintomicho', r1 && r1.from === 'Shintomicho', `got ${r1?.from}`);
check('en route[1] to=Tsukishima', r1 && r1.to === 'Tsukishima', `got ${r1?.to}`);
check('en route[0] stops localized', r0 && r0.stops && r0.stops.every(s => !/[\u3040-\u30ff\u4e00-\u9fff]/.test(s)), `got ${JSON.stringify(r0?.stops)}`);
check('en train operator=Bus/Train labels', r1 && (r1.mode_label === 'Train'), `got ${r1?.mode_label}`);
const noJa = JSON.stringify(en).replace(/\s+/g, ' ');
const jaFields = ['徒歩乗り継ぎ', '鉄道'];
const jaLeft = jaFields.filter(f => noJa.includes(f));
check('en no Japanese leftover in route (徒歩乗り継ぎ/鉄道)', jaLeft.length === 0, `left: ${jaLeft.join(',')}`);

// 2) 中国語
const zh = unwrap(await searchBus({ from: '桜橋', to: '月島', language: 'zh' }));
console.log('--- ZH ---');
console.log(JSON.stringify({ status: zh.status, detected_language: zh.detected_language, from: zh.from, to: zh.to, route: zh.route }, null, 1));
check('zh detected_language', zh.detected_language === 'zh', `got ${zh.detected_language}`);
const z0 = zh.route?.[0], z1 = zh.route?.[1];
check('zh route[0] from=樱桥', z0 && z0.from === '樱桥', `got ${z0?.from}`);
check('zh route[0] to=新富町', z0 && z0.to === '新富町', `got ${z0?.to}`);
check('zh route[1] from=新富町', z1 && z1.from === '新富町', `got ${z1?.from}`);
check('zh route[1] to=月岛', z1 && z1.to === '月岛', `got ${z1?.to}`);
check('zh train mode_label=电车', z1 && z1.mode_label === '电车', `got ${z1?.mode_label}`);

// 3) 日本語回帰（従来どおり日本語のまま）
const ja = unwrap(await searchBus({ from: '桜橋', to: '月島', language: 'ja' }));
console.log('--- JA ---');
console.log(JSON.stringify({ status: ja.status, detected_language: ja.detected_language, from: ja.from, to: ja.to, route: ja.route }, null, 1));
check('ja detected_language', ja.detected_language === 'ja', `got ${ja.detected_language}`);
check('ja route[0] from=桜橋 (regression)', ja.route?.[0]?.from === '桜橋', `got ${ja.route?.[0]?.from}`);
check('ja route[1] to=月島 (regression)', ja.route?.[1]?.to === '月島', `got ${ja.route?.[1]?.to}`);

const failed = results.filter(r => !r.ok);
console.log(failed.length === 0 ? '\n🎉 ALL PASS' : `\n💥 ${failed.length} FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
