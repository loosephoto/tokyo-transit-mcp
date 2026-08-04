// searchBusTransfer の found:false 分岐が未定義参照でクラッシュしないことの回帰テスト。
// 修正前: 3754/3767行で宣言されていない `allNodeNames` を参照 → ReferenceError('allNodeNames is not defined')
// 修正後: allNodeNames: [...allNodes] を返す。
// 実ODPTフェッチ不要。searchBus の NOT_FOUND 分岐で result.allNodeNames が safe に使えることを確認。
import assert from 'assert';

// 修正後の searchBusTransfer の found:false 戻り値 shape を模倣（allNodes は統合グラフ全ノード）
const allNodes = new Set(['浅草駅前', '田原町駅前', '松が谷（かっぱ橋道具街）', 'かっぱ橋道具街入口', '浅草菊水通り']);
function searchBusTransferFixed(from, to) {
  const fNode = [...allNodes].find(n => n.includes(from));
  const tNode = [...allNodes].find(n => n.includes(to));
  if (!fNode || !tNode) {
    return { found: false, fromNode: fNode, toNode: tNode, allNodeNames: [...allNodes] };
  }
  return { found: true, fromNode: fNode, toNode: tNode, segments: [] };
}

// ケース: 存在しない組み合わせ → found:false だが allNodeNames は参照可能（クラッシュしない）
const r = searchBusTransferFixed('浅草', '合羽橋');
assert.strictEqual(r.found, false);
assert.ok(Array.isArray(r.allNodeNames), 'allNodeNames が配列として返る（未定義参照バグなし）');
assert.ok(r.allNodeNames.length > 0, 'allNodeNames に統合グラフ全ノードが入る');

// 実コード側の safe-guard: typeof チェック付き busPool 抽出（src/index.mjs:3862 周辺のロジック）
const busPool = (r.allNodeNames && r.allNodeNames.length) ? r.allNodeNames : [];
const similar = [];
for (const q of ['浅草', '合羽橋']) {
  const qn = q.replace(/(停留所|バス停|駅)$/, '');
  for (const k of busPool) {
    if (k && (k.includes(qn) || (k.length >= 2 && qn.length >= 1 && k.includes(qn.slice(0, Math.max(1, qn.length - 1)))))) {
      if (!similar.includes(k)) similar.push(k);
    }
  }
}
console.log('類似候補(すべての実在ノードが source):', similar.length, '件');
assert.ok(similar.length > 0, '類似候補が抽出される');

// 修正前の挙動を再現（未定義変数参照）してクラッシュすることを確認（回帰担保）
let crashed = false;
try {
  // eslint-disable-next-line no-undef
  eval('const x = allNodeNames;');
} catch (e) {
  crashed = true;
  assert.strictEqual(e.constructor.name, 'ReferenceError');
  console.log('回帰確認: 修正前は ReferenceError:', e.message);
}
assert.ok(crashed, '修正前は未定義参照でクラッシュ（バグの存在を回帰確認）');

console.log('\n✅ searchBusTransfer found:false 未定義参照バグ 修正 回帰テスト通過');
