// 公式駅数(sidearrow.net) vs 実装駅数 の突合スクリプト
// 実装: railway_lines_current.txt (路線名|駅1,駅2,...) — 事前に生成:
//   node -e "..." または dump から生成。検索パスは環境に合わせて変更。
import fs from 'node:fs';
import path from 'node:path';

// 1. 実装データを読む（リポジトリルートからの相対パス）
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const impl = {};
const implPath = path.join(REPO_ROOT, 'railway_lines_current.txt');
for (const line of fs.readFileSync(implPath, 'utf8').split('\n').filter(Boolean)) {
  const [name, stations] = line.split('|');
  impl[name] = stations.split(',');
}

// 2. 公式データ（sidearrow.net キャッシュ）から東京近郊路線の駅数を抽出
//    キャッシュ取得: web_extract https://railway.sidearrow.net/line/station-num の保存先
const CACHE_DIR = process.env.HERMES_CACHE || 'C:/Users/oresama/AppData/Local/hermes/cache/web';
const content = fs.readFileSync(path.join(CACHE_DIR, 'railway.sidearrow.net-1d88ca53c3.md'), 'utf8');
const official = {}; // 路線名 -> 駅数
const lines = content.split('\n').filter(l => l.includes('駅 |') && l.startsWith('|'));
for (const l of lines) {
  const cells = l.split('|').map(c => c.replace(/\[|\]|\(.*?\)/g, '').trim()).filter(Boolean);
  if (cells.length >= 3) {
    const [company, line, num] = cells;
    const n = parseInt(num);
    if (!isNaN(n)) {
      // 実装の路線名と対応付け
      const key = normalize(line);
      if (!official[key]) official[key] = [];
      official[key].push({ company, num: n });
    }
  }
}

function normalize(name) {
  return name
    .replace(/（.*?）|\(.*?\)/g, '')
    .replace(/東京地下鉄|東京都|東日本旅客鉄道|東急電鉄|京王電鉄|小田急電鉄|西武鉄道|東武鉄道|京成電鉄|京浜急行電鉄|相模鉄道|首都圏新都市鉄道/g, '')
    .replace(/^[（(]|[）)]$/g, '')
    .trim();
}

// 3. 突合: 実装路線それぞれについて公式駅数と比較
console.log('=== 駅数不一致の可能性がある路線 ===');
console.log('実装路線 | 実装駅数 | 公式駅数候補 | 差分');
const implNames = Object.keys(impl);
for (const name of implNames) {
  const implCount = impl[name].length;
  // 公式側で名前が一致するもの（正規化比較）
  let matches = [];
  for (const [key, entries] of Object.entries(official)) {
    if (key.includes(name.replace('JR', '').replace('東京メトロ', '')) || name.replace('JR', '').replace('東京メトロ', '').includes(key)) {
      matches.push(...entries);
    }
  }
  // 直接の名前一致を優先
  const exact = official[name] || official[name.replace('JR', '')] || official[name.replace('東京メトロ', '')];
  const pool = exact || matches;
  if (pool && pool.length) {
    const nums = [...new Set(pool.map(p => p.num))];
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (implCount < min - 1 || implCount > max + 1) {
      console.log(`${name} | ${implCount} | ${nums.join('/')} | 差分${implCount - min}`);
    }
  }
}

// 4. 公式にあるが実装にない東京近郊の主要路線（未実装路線の検出）
console.log('\n=== 公式にある主要路線で実装に無いもの（都内近郊）===');
const jpNear = ['青梅線', '五日市線', '八高線', '川越線', '高崎線', '宇都宮線', '鶴見線', '相模線', '江ノ島線', '多摩川線', '国分寺線', '豊島線', '拝島線', '野田線', '亀戸線', '宇都宮線', '千葉線', '千原線', '金町線', '東成田線', '大師線', '逗子線', '久里浜線', '池上線', '世田谷線', 'いずみ野線', '新横浜線', '湘南モノレール', '競馬場線', '秩父', '流山線', 'こどもの国', 'シーサイドライン', 'ニューシャトル', 'リゾートライン', '千葉都市モノレール', '有楽町線'];
const implJoined = implNames.join(',');
for (const key of Object.keys(official)) {
  if (jpNear.some(t => key.includes(t))) {
    const nums = [...new Set(official[key].map(p => p.num))];
    console.log(`${key} | 公式${nums.join('/')}駅 | ${implJoined.includes(key) ? '実装済み' : '★未実装'}`);
  }
}
