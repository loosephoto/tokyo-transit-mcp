// LANDMARK_LOOKUP の内容を直接ダンプ（src/data/landmarks.mjs から直接 import）
// ※ v2.39.0 モノリス分割: ソーステキストからの再構築を廃止しモジュールを直接参照
import { LANDMARK_LOOKUP } from '../src/data/landmarks.mjs';

console.log('total lookup keys:', Object.keys(LANDMARK_LOOKUP).length);
const probe = ['成田山新勝寺','成田山','成田山公園','naritasan shinshoji','naritasan','narita temple','成田山新胜寺','成田山'];
for (const p of probe) {
  console.log(p, '=>', JSON.stringify(LANDMARK_LOOKUP[p.toLowerCase()] || null));
}
