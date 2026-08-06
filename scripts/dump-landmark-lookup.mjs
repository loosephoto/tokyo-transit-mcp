// LANDMARK_LOOKUP の内容を直接ダンプ（src から再構築）
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf-8');
const start = src.indexOf('const LANDMARK_DEFS = {');
const endMarker = src.indexOf('// 全ての検索可能文字列', start);
const objSrc = src.slice(start + 'const LANDMARK_DEFS = '.length, endMarker).trim();
const LANDMARK_DEFS = eval('(' + objSrc.replace(/;\s*$/, '') + ')');
const LANDMARK_LOOKUP = {};
for (const [defKey, def] of Object.entries(LANDMARK_DEFS)) {
  for (const lang of ['ja', 'en', 'zh']) {
    for (const n of (def.names[lang] || [])) {
      LANDMARK_LOOKUP[n.toLowerCase()] = { defKey, lang, original: n };
    }
  }
}
console.log('total lookup keys:', Object.keys(LANDMARK_LOOKUP).length);
const probe = ['成田山新勝寺','成田山','成田山公園','naritasan shinshoji','naritasan','narita temple','成田山新胜寺','成田山'];
for (const p of probe) {
  console.log(p, '=>', JSON.stringify(LANDMARK_LOOKUP[p.toLowerCase()] || null));
}
