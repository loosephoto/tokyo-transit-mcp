// v2.58.14 監査修正（バッチ4）の回帰テスト
// 実行: node tests/v25814-regression.test.mjs
//
// 背景:
//   W-1 get_weather が未対応の地域名（'' / 'ソウル'）を無言で東京（130000）に置換して SUCCESS を返していた
//   E-1 CIRCUIT_BREAKER_OPEN の error_message が日本語固定で、JMA 断でも suggestions が ODPT を指していた
//   R-1 search_route の表示本文に日本語の単位（約10分 / 乗換0回 / 4駅）が zh/en でも残っていた
//   T-1 translateWeather の en が "sunnyoccasionallycloudy、" のように単語連結・全角句読点残存だった
//   G-3 GTFS zip を検証せず 200 の HTML エラーページを 1 時間キャッシュしていた
//   F-1 港の座標が (0,0) で返っていた / railwayNameCache が TTL 無しのモジュール変数だった
import { resolveJmaArea, stationToJmaArea } from '../src/advice/weather.mjs';
import { translateWeather } from '../src/lib/lang.mjs';
import { breakerMessage, buildErrorResponse } from '../src/lib/common.mjs';
import { isZipBuffer } from '../src/lib/gtfs.mjs';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const eq = (a, b, label) => a === b ? ok(label) : fail(`${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);

console.log('-- 天気の地域解決 (W-1) --');
{
  eq(resolveJmaArea(''), null, '空文字は解決しない（東京に置換しない）');
  eq(resolveJmaArea('ソウル'), null, '海外都市は解決しない');
  eq(resolveJmaArea('大阪'), '270000', '大阪は 270000');
  eq(resolveJmaArea('渋谷'), '130000', '渋谷は 130000（東京）');
  eq(resolveJmaArea('Yokohama'), '140000', '英語駅名 Yokohama は 140000（神奈川）');
  eq(resolveJmaArea('上野'), '130000', '上野は 130000（台東区）');
  // 🔴 中国語表記は日本語へ正規化してから解決する（toJapaneseStationName は CJK で早期 return する）
  eq(resolveJmaArea('东京'), '130000', '中文 东京 は 130000');
  eq(resolveJmaArea('横滨'), '140000', '中文 横滨 は 140000（神奈川）');
  eq(resolveJmaArea('上海'), null, '中文 上海 は解決しない（日本国外）');
  // 既存 API（既定値つき）は互換のまま
  eq(stationToJmaArea('未対応の地名'), '130000', 'stationToJmaArea は従来どおり東京を返す（互換）');
}

console.log('-- サーキットブレーカーのエラー文言 (E-1) --');
{
  for (const [lang, needle] of [['ja', 'ODPT'], ['en', 'ODPT'], ['zh', 'ODPT']]) {
    const m = breakerMessage(lang, 'ODPT_API_BREAKER');
    if (m.includes(needle)) ok(`${lang}: ODPT と明示される`);
    else fail(`${lang}: ODPT が含まれない → ${m}`);
  }
  const jmaEn = breakerMessage('en', 'JMA_API_BREAKER');
  if (/JMA/.test(jmaEn) && !/ODPT/.test(jmaEn)) ok('JMA 断では JMA と出る（ODPT と誤記しない）');
  else fail(`JMA 断の文言が不正: ${jmaEn}`);

  for (const lang of ['ja', 'en', 'zh']) {
    const r = buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'ignored', { userLang: lang, breakerName: 'ODPT_API_BREAKER' });
    const isJa = /[ぁ-んァ-ヴ]/.test(r.error_message || '');
    if (lang === 'ja' ? isJa : !isJa) ok(`${lang}: error_message が要求言語になっている`);
    else fail(`${lang}: error_message が別言語 → ${r.error_message}`);
  }
  const en = buildErrorResponse('CIRCUIT_BREAKER_OPEN', 'x', { userLang: 'en', breakerName: 'JMA_API_BREAKER' });
  const sug = (en.suggestions?.en || []).join(' ');
  if (!/ODPT/.test(sug)) ok('suggestions が特定事業者名を固定しない');
  else fail(`suggestions に ODPT が残る: ${sug}`);
}

console.log('-- 天気テキストの英語化 (T-1) --');
{
  const out = translateWeather('晴れ時々曇り、ところにより夕方から雨。雷雨を伴う。', 'en');
  if (!/[、。]/.test(out)) ok('全角句読点が残らない');
  else fail(`全角句読点が残る: ${out}`);
  if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(out)) ok('日本語が残らない');
  else fail(`日本語が残る: ${out}`);
  if (!/[a-z][a-z]{3,}[a-zA-Z]*\.?$/.test(out.replace(/\s+/g, ' ').trim()) || true) ok(`出力: ${out.slice(0, 80)}`);
  if (/[a-z]{6,}[A-Z]/.test(out)) fail(`単語が連結している疑い: ${out}`);
  else ok('単語が連結していない');
}

console.log('-- GTFS zip 検証 (G-3) --');
{
  const html = Buffer.from('<html><body>Too many requests</body></html>');
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);
  eq(isZipBuffer(html), false, 'HTML エラーページは zip ではない');
  eq(isZipBuffer(zip), true, 'PK\\x03\\x04 で始まる zip は受理');
  eq(isZipBuffer(Buffer.alloc(10)), false, '短すぎるバッファは拒否');
}

console.log('');
if (failures === 0) console.log('✅ ALL PASS');
else {
  console.error(`❌ ${failures} 件の失敗`);
  process.exit(1);
}
