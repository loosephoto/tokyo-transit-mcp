// かな → ローマ字（ヘボン式）変換。駅読み辞書（1,449 件）と駅名英字表記（504 件）で
// 自己検証するための単体実装。外部ライブラリに依存しない。
const TABLE = [
  ['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo'], ['しゃ', 'sha'], ['しゅ', 'shu'], ['しょ', 'sho'],
  ['ちゃ', 'cha'], ['ちゅ', 'chu'], ['ちょ', 'cho'], ['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo'],
  ['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo'], ['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo'],
  ['りゃ', 'rya'], ['りゅ', 'ryu'], ['りょ', 'ryo'], ['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo'],
  ['じゃ', 'ja'], ['じゅ', 'ju'], ['じょ', 'jo'], ['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo'],
  ['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo'], ['ぢゃ', 'ja'], ['ぢゅ', 'ju'], ['ぢょ', 'jo'],
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['ゐ', 'i'], ['ゑ', 'e'], ['を', 'o'], ['ん', 'n'],
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji'], ['づ', 'zu'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
  ['ぁ', 'a'], ['ぃ', 'i'], ['ぅ', 'u'], ['ぇ', 'e'], ['ぉ', 'o'],
  ['ゃ', 'ya'], ['ゅ', 'yu'], ['ょ', 'yo'], ['ゎ', 'wa'],
  ['ー', ''], ['・', ' '],
];

const katakanaToHiragana = (s) =>
  s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function kanaToRomaji(input) {
  let s = katakanaToHiragana(String(input)).trim();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    const pair = TABLE.find(([k]) => k === two);
    if (pair) { out += pair[1]; i++; continue; }
    const c = s[i];
    if (c === 'っ') {
      // 促音: 次の子音を重ねる
      const nextTwo = s.slice(i + 1, i + 3);
      const nextPair = TABLE.find(([k]) => k === nextTwo);
      const next = nextPair ? nextPair[1] : (TABLE.find(([k]) => k === s[i + 1])?.[1] || '');
      if (next && /^[a-z]/.test(next)) out += next[0] !== 'c' ? next[0] : 't';
      continue;
    }
    if (c === 'ん') {
      const nextTwo = s.slice(i + 1, i + 3);
      const nextPair = TABLE.find(([k]) => k === nextTwo);
      const next = nextPair ? nextPair[1] : (TABLE.find(([k]) => k === s[i + 1])?.[1] || '');
      out += /^[aiueo]/.test(next) || next === 'y' ? "n'" : 'n';
      continue;
    }
    const hit = TABLE.find(([k]) => k === c);
    if (hit) { out += hit[1]; continue; }
    out += c;
  }
  return out;
}

// 長音の簡略化（おう→o / おお→o / うう→u / ああ→a）。
//   駅名辞書の英字表記（Tokyo, Otsuka, Osaka）に合わせるための後処理。
export function simplify(s) {
  return String(s)
    .replace(/ou/g, 'o')
    .replace(/oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/aa/g, 'a');
}

export function titleCase(s) {
  return String(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[0-9]/.test(w) || w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

// 自己検証: 駅読み（かな）→ ローマ字 が駅名英字表記と一致するか
export async function selfCheck() {
  const { STATION_READINGS } = await import('../data/station-readings.mjs');
  const { STATION_DISPLAY_NAMES } = await import('../data/station-names.mjs');
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/oo/g, 'o');
  let ok = 0;
  const bad = [];
  for (const [ja, kana] of Object.entries(STATION_READINGS)) {
    const en = STATION_DISPLAY_NAMES[ja]?.en;
    if (!en) continue;
    const mine = simplify(kanaToRomaji(kana));
    if (norm(mine) === norm(en)) ok++;
    else bad.push(`${ja}: ${kana}→${mine} vs ${en}`);
  }
  return { ok, bad, total: ok + bad.length };
}

if (process.argv[1] && process.argv[1].endsWith('kana-romaji.mjs')) {
  const r = await selfCheck();
  console.log(`一致 ${r.ok}/${r.total}（${((r.ok / r.total) * 100).toFixed(1)}%）`);
  for (const b of r.bad.slice(0, 15)) console.log('  ', b);
}
