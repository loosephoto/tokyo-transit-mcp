import assert from 'node:assert/strict';
import { classifyStatus, localizeStatusLine } from '../src/handlers/running-status.mjs';

const cases = [
  ['運転見合わせ', 'suspended'], ['運休', 'suspended'], ['運転取りやめ', 'suspended'],
  ['運行停止', 'suspended'], ['遅れが発生しています', 'partial'],
  ['ダイヤ乱れが発生しています', 'partial'], ['通常どおり運転しています', 'normal'],
  ['運転再開しました', 'normal'],
];
for (const [text, expected] of cases) assert.equal(classifyStatus(text), expected, text);

const en = localizeStatusLine({ line: '京急線', status: 'normal', status_text: '京急線は平常通り運転しています。', detail: '遅れはありません。' }, 'en');
assert.equal(en.line, 'Keikyu Line');
assert.equal(en.status, 'Normal operation');
assert.doesNotMatch(`${en.line} ${en.status} ${en.status_text} ${en.detail}`, /[぀-ヿ一-鿿]/);

const zh = localizeStatusLine({ line: '京急線', status: 'partial', status_text: '京急線で遅れが発生しています。', detail: '運転を見合わせています。' }, 'zh');
assert.equal(zh.line, '京急线');
assert.equal(zh.status, '部分停运/晚点');
assert.doesNotMatch(`${zh.line} ${zh.status} ${zh.status_text} ${zh.detail}`, /[぀-ヿ]/);

console.log('✅ running-status localization/classification tests: all passed');
