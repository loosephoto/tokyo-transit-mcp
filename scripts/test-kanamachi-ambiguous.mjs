// 金町→黄金町 誤認バグ + 曖昧時選択促進の決定的回帰テスト
// 実際の resolveStation / computeRoutes をインポートして検証（API不要）
import * as mod from '../src/index.mjs';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const { resolveStation, computeRoutes } = mod;

// 1. 金町入力は黄金町へ誤認しない
const kanamachi = resolveStation('金町');
assert(kanamachi.station !== '黄金町', '金町 は 黄金町 へ誤認しない');
// データセットに「金町」が無ければ STATION_NOT_FOUND（ambiguous=false, station=null）
console.log('   金町 resolve:', JSON.stringify(kanamachi));
assert(kanamachi.ambiguous === false, '金町 は曖昧フラグ false');

// 2. 完全一致は exact=true で確定
const shinjuk = resolveStation('新宿');
assert(shinjuk.exact === true && shinjuk.station === '新宿', '新宿 は完全一致で確定 (exact=true)');
console.log('   新宿 resolve:', JSON.stringify(shinjuk));

// 3. 前方一致（入力が接頭辞）: 複数候補なら ambiguous=true で選択促進
//    「京」で始まる駅が複数あるはず
const kyo = resolveStation('京');
console.log('   京 resolve:', JSON.stringify(kyo).slice(0, 200));
assert(kyo.ambiguous === true, '「京」は複数候補→曖昧(選択促進)');

// 4. computeRoutes が曖昧時に検索を中断し AMBIGUOUS_STATION を返す
const amb = computeRoutes('京', '新宿');
console.log('   computeRoutes(京,新宿):', JSON.stringify(amb).slice(0, 200));
assert(amb.error === 'AMBIGUOUS_STATION' && amb.side === 'from', '曖昧時は検索中断し AMBIGUOUS_STATION(from) を返す');

// 5. 金町→新宿 は経路が引ける（#14で常磐線に金町追加。黄金町誤認ではない）
const kn = computeRoutes('金町', '新宿');
console.log('   computeRoutes(金町,新宿):', JSON.stringify(kn).slice(0, 200));
assert(kn.routes && kn.routes.length > 0, '金町は常磐線で検索可能（#14追加・黄金町誤認なし）');

console.log('done');
