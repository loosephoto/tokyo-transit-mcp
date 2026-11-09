/**
 * かな（ひらがな・カタカナ）駅名入力の解決
 *
 * 背景: 従来の駅名解決は「日本語表記」「英語/中国語表示名」「ローマ字ID」のみで、
 * ひらがな・カタカナの入力（例: 「うえの」「アサカ」）は一切解決できなかった。
 *
 * 仕組み: ODPT の駅名表記（漢字）と STATION_DISPLAY_NAMES の en（ローマ字）から、
 * ローマ字を正規化（長音・ん表記・同音異表記を吸収）した索引を構築し、
 * かな入力をローマ字に変換して引く。複数の駅に当たる場合は呼び出し側で曖昧提示にする。
 *
 * ⚠️ 正規化は「異なる読みを意図的に同一視する」ため、索引が返す候補は必ず
 *    呼び出し側で RAILWAY_LINES（STATION_TO_LINES）に実在するか照合する。
 */

import { STATION_READINGS } from '../data/station-readings.mjs';

// ひらがな/カタカナ → ローマ字（ヘボン式）
const K2R = {
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo', 'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho', 'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
  'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo', 'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo', 'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo', 'ぢゃ': 'ja', 'ぢゅ': 'ju', 'ぢょ': 'jo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo', 'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
  'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo', 'うぃ': 'wi', 'うぇ': 'we',
  'つぁ': 'tsa', 'つぇ': 'tse', 'つぉ': 'tso', 'でぃ': 'di', 'でゅ': 'du', 'てぃ': 'ti', 'てゅ': 'tu',
  'うぉ': 'wo', 'ゔぁ': 'va', 'ゔぃ': 'vi', 'ゔ': 'vu', 'ゔぇ': 've', 'ゔぉ': 'vo',
  'しぇ': 'she', 'ちぇ': 'che', 'じぇ': 'je',
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
  'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'o',
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'di', 'づ': 'du', 'で': 'de', 'ど': 'do',
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
  'ん': 'n'
};

const KATA_TO_HIRA = {};
for (let c = 0x30a1; c <= 0x30f6; c++) {
  const k = String.fromCharCode(c);
  const h = String.fromCharCode(c - 0x60);
  if (/[ぁ-ん]/.test(h)) KATA_TO_HIRA[k] = h;
}

// カタカナ外来語 → 英語（ローマ字では復元できないため）。
// ひらがな表記も受け付ける（例: 「せんたーみなみ」）。
const LOAN_WORDS = {
  'ゲートウェイ': 'gateway', 'げーとうぇい': 'gateway',
  'ヒルズ': 'hills', 'ひるず': 'hills',
  'センター': 'center', 'せんたー': 'center',
  'タワー': 'tower', 'たわー': 'tower',
  'シティ': 'city', 'してぃ': 'city',
  'パーク': 'park', 'ぱーく': 'park',
  'スクエア': 'square', 'すくえあ': 'square',
  'プラザ': 'plaza', 'ぷらざ': 'plaza',
  'ステーション': 'station', 'すてーしょん': 'station',
  'ホテル': 'hotel', 'ほてる': 'hotel',
  'アリーナ': 'arena', 'ありーな': 'arena',
  'ミュージアム': 'museum', 'みゅーじあむ': 'museum',
  'モール': 'mall', 'もーる': 'mall',
  'ライナー': 'liner', 'らいなー': 'liner',
  'エクスプレス': 'express', 'えくすぷれす': 'express',
  'スカイ': 'sky', 'すかい': 'sky',
  'キャピタル': 'capital', 'きゃぴたる': 'capital',
  'ガーデン': 'garden', 'がーでん': 'garden',
  'コロシアム': 'colosseum', 'ころしあむ': 'colosseum',
  'フォーラム': 'forum', 'ふぉーらむ': 'forum',
  'ヘリポート': 'heliport', 'へりぽーと': 'heliport',
  'ビッグサイト': 'bigsite', 'びっぐさいと': 'bigsite',
  'インターナショナル': 'international', 'いんたーなしょなる': 'international',
  'スカイツリー': 'skytree', 'すかいつりー': 'skytree',
  'ツインビル': 'twinbuilding', 'ついんびる': 'twinbuilding',
  'アパート': 'apartment', 'あぱーと': 'apartment',
  'クリニック': 'clinic', 'くりにくっく': 'clinic',
  'ギャザリア': 'galleria', 'ぎゃざりあ': 'galleria',
  'トリトン': 'triton', 'とりとん': 'triton',
  'マリナーズ': 'mariners', 'まりなーず': 'mariners',
  'フェリー': 'ferry', 'ふぇりー': 'ferry',
  '埠頭': 'futou', 'ふとう': 'futou',
  'リバーシティ': 'rivercity', 'りばしてぃ': 'rivercity',
  'ディズニーランド': 'disneyland', 'でぃずにーらんど': 'disneyland',
  'ディズニーシー': 'disneysea', 'でぃずにーしー': 'disneysea',
  'ベイサイド': 'bayside', 'べいさいど': 'bayside',
  'リゾート': 'resort', 'りぞーと': 'resort'
};

export function katakanaToHiragana(s) {
  return String(s).replace(/[ァ-ヶ]/g, (m) => KATA_TO_HIRA[m] || m);
}

export function kanaToRomei(input) {
  const raw = String(input).normalize('NFKC');
  // 外来語を先に英語へ（カタカナ表記・ひらがな表記の両方）
  let s = raw;
  for (const [k, en] of Object.entries(LOAN_WORDS)) {
    if (s.includes(k)) s = s.split(k).join(' ' + en + ' ');
  }
  s = katakanaToHiragana(s);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const three = s.slice(i, i + 3);
    const two = s.slice(i, i + 2);
    const one = s[i];
    if (K2R[three]) { out += K2R[three]; i += 3; continue; }
    if (K2R[two]) { out += K2R[two]; i += 2; continue; }
    if (one === 'っ') {
      const rest = s.slice(i + 1);
      let nx = '';
      for (let k = 3; k >= 1; k--) {
        const cand = rest.slice(0, k);
        if (K2R[cand]) { nx = K2R[cand]; break; }
      }
      // っち → tch（Japanese の標準表記）、その他は頭子音を重ねる
      out += nx.startsWith('ch') ? 't' : (nx ? nx[0] : '');
      i += 1;
      continue;
    }
    if (one === 'ー') { i += 1; continue; }          // 長音記号は読みの一部として無視
    if (/[、・\s。]/.test(one)) { i += 1; continue; }
    if (/[a-zA-Z]/.test(one)) { out += one.toLowerCase(); i += 1; continue; }
    out += K2R[one] !== undefined ? K2R[one] : '';
    i += 1;
  }
  return out;
}

/**
 * ローマ字の正規化（長音・ん表記・同音異表記を吸収）。
 * 例: ootemachi → otemachi（おおてまち ⇔ Otemachi）
 *     nihombashi → nihonbashi（にほんばし）
 *     shimbashi → shinbashi（しんばし）
 */
export function canonRomei(r) {
  // 長音符号（ō/ū/ā/ē/ī）を先に素の母音へ戻す（Rokuchō → rokucho のように
  // 非ASCIIを単純に捨てると "rokuch" になって読みと一致しなくなる）
  let s = String(r || '')
    .replace(/[ōŌ]/g, 'o').replace(/[ūŪ]/g, 'u').replace(/[āĀ]/g, 'a')
    .replace(/[ēĒ]/g, 'e').replace(/[īĪ]/g, 'i')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  s = s.replace(/tsu/g, 'tu').replace(/ti/g, 'chi').replace(/du/g, 'zu')
    .replace(/di/g, 'ji').replace(/(?<![cs])hu/g, 'fu').replace(/si/g, 'shi').replace(/zi/g, 'ji');
  s = s.replace(/mb/g, 'n').replace(/mm/g, 'n').replace(/mp/g, 'n')
    .replace(/nb/g, 'n').replace(/nm/g, 'n').replace(/np/g, 'n');
  s = s.replace(/ou+/g, 'o').replace(/oo+/g, 'o').replace(/uu+/g, 'u')
    .replace(/aa+/g, 'a').replace(/ii+/g, 'i').replace(/ee+/g, 'e');
  return s;
}

let _index = null; // Map<canonRomei, Set<stationName>>

let _readingIndex = null; // Map<canonRomei, Set<stationName>>（権威読みベース）

/**
 * 権威読み（Wikipedia 抽出）からの索引。ローマ字索引より優先する。
 * これにより「せんがわ→仙川」「せんかわ→千川」のようにローマ字が同一表記になる
 * 駅でも、読みの違いで正しく区別できる。
 */
export function getReadingIndex() {
  if (_readingIndex) return _readingIndex;
  const idx = new Map();
  for (const [ja, reading] of Object.entries(STATION_READINGS || {})) {
    if (!reading) continue;
    const key = canonRomei(kanaToRomei(reading));
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key).add(ja);
  }
  _readingIndex = idx;
  return idx;
}

/** 索引に駅名辞書を流し込む（search-route.mjs の初期化時に1回だけ呼ぶ） */
export function buildKanaIndex(stationDisplayNames) {
  const idx = new Map();
  for (const [ja, tr] of Object.entries(stationDisplayNames || {})) {
    if (!tr || !tr.en) continue;
    if (/\d/.test(tr.en)) continue; // 数字を含む一部店名（羽田空港第1ターミナル等）は除外
    const key = canonRomei(tr.en);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key).add(ja);
  }
  _index = idx;
  return idx;
}

const KANA_ONLY_RE = /^[ぁ-んァ-ヶー・、\s]+$/;
const KANA_SUFFIX_RE = /(?:えき|えきまえ|えきえき|駅|駅前|駅北|駅南|駅東|駅西)$/;

/**
 * かな入力から駅名候補を返す。
 * - かなのみ（漢字・英字を含まない）の入力で、索引が命中したときだけ候補を返す
 * - 複数の駅に当たる場合は全候補を返す（呼び出し側で曖昧提示）
 * - かな入力でない／命中しない場合は null（従来の解決処理にフォールバック）
 */
export function kanaToStationCandidates(input) {
  const raw = String(input || '').trim();
  if (!raw || !KANA_ONLY_RE.test(raw)) return null;
  const idx = _index;
  const ridx = getReadingIndex();
  if (!idx || !ridx) return null;
  const variants = [raw];
  const stripped = raw.replace(KANA_SUFFIX_RE, '');
  if (stripped && stripped !== raw) variants.push(stripped);
  const seen = new Set();
  const out = [];
  for (const v of variants) {
    const key = canonRomei(kanaToRomei(v));
    if (!key) continue;
    // 権威読みの索引を優先し、無ければローマ字索引にフォールバックする
    const hit = ridx.get(key) || idx.get(key);
    if (!hit) continue;
    for (const name of hit) {
      if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
  }
  return out.length ? out : null;
}
