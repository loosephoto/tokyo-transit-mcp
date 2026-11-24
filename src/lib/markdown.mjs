/**
 * 汎用 JSON → Markdown レンダラ（v2.58.33）
 *
 * 目的:
 *   MCP ツールの content を「LLM・人間がそのまま読める Markdown」で返す。
 *   機械向けの完全な JSON は content の 2 番目ブロック（ai_transit_advice を除く）と
 *   structuredContent に残すため、既存の JSON パーサ（texts.find(t => t.startsWith('{'))) も動く。
 *
 * 設計方針:
 *   - ツールごとの専用整形は書かない（14 ツール分の二重管理になる）。戻り値の形から決める。
 *   - 平坦なオブジェクト配列 → 表、入れ子を含む配列 → 小見出し＋表、入れ子オブジェクト → 小見出し。
 *   - 値は改変しない（駅名・時刻・運賃・URL をそのまま出す）。欠損は「—」。
 *   - 表の行数だけは上限で切る（structuredContent に全件があるため）。切ったことは明示する。
 *   - Markdown の表はリスト内にインデントして置くとレンダリングされないので、必ず行頭に出す。
 */

const MAX_TABLE_ROWS = 100;
const MAX_LIST_ITEMS = 50;
// 項目見出しに使えるキー（上から優先）
const NAME_KEYS = ['name', 'label', 'title', 'station', 'port', 'busstop', 'line', 'railway', 'operator', 'airport', 'flight_number', 'route'];
// リンクとして描画するキー（値が http(s) のときだけ）
const LINK_KEYS = new Set(['url', 'website', 'link', 'official_url', 'href', 'map_url', 'maps_url']);
// 先頭のメタ行にまとめるキー（本文の見出しを消費しない）
const META_KEYS = new Set([
  'status', 'detected_language', 'language', 'timestamp', 'truncated', 'partial',
  'source', 'data_source', 'api', 'version', 'tool', 'generated_at', 'confidence'
]);
const KEY_LABELS = { detected_language: 'lang', data_source: 'source', official_url: 'url' };

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const isScalar = (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
const hasNested = (obj) => Object.values(obj).some(v => isPlainObject(v) || Array.isArray(v));

function fmtScalar(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}

const escapeCell = (v) => fmtScalar(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

function linkOrText(key, v) {
  if (isHttpUrl(v) && (LINK_KEYS.has(key) || /url$/i.test(key) || /^(link|website)$/i.test(key))) return `<${v}>`;
  return fmtScalar(v);
}

const headingFor = (level) => '#'.repeat(Math.min(Math.max(level, 2), 6));

/** 見出し用ラベル（name > label > title > index など） */
function itemLabel(item, index) {
  if (!isPlainObject(item)) return String(index + 1);
  for (const k of NAME_KEYS) {
    if (typeof item[k] === 'string' && item[k].trim()) return item[k].trim();
  }
  if (typeof item.id === 'string' && item.id.trim()) return item.id.trim();
  if (typeof item.index === 'number') return String(item.index);
  return `#${index + 1}`;
}

/** 表にできる配列か（全要素がオブジェクトで、平坦な列が 2〜8 個） */
function tableShape(arr) {
  if (!arr.length || !arr.every(isPlainObject)) return null;
  const keys = [];
  for (const item of arr) {
    for (const [k, v] of Object.entries(item)) {
      if (v === undefined) continue;
      if (isPlainObject(v) || Array.isArray(v)) continue; // 入れ子は列にしない
      if (!keys.includes(k)) keys.push(k);
    }
  }
  const nested = arr.some(hasNested);
  if (keys.length < 2 || keys.length > 8) return null;
  if (nested && keys.length < 3) return null; // 実質 1〜2 列なら箇条書きの方が読める
  return { keys, nested };
}

function renderTable(arr, keys, total) {
  const head = `| ${keys.map(k => KEY_LABELS[k] || k).join(' | ')} |`;
  const sep = `| ${keys.map(() => '---').join(' | ')} |`;
  const rows = arr.slice(0, MAX_TABLE_ROWS).map(item =>
    `| ${keys.map(k => (Array.isArray(item[k])
      ? item[k].map(fmtScalar).join(' / ')
      : isHttpUrl(item[k]) ? `<${item[k]}>` : escapeCell(item[k]))).join(' | ')} |`
  );
  const out = [head, sep, ...rows];
  if (total > MAX_TABLE_ROWS) {
    out.push(`\n_全 ${total} 件中 ${MAX_TABLE_ROWS} 件を表示（残りは structuredContent を参照）。_`);
  }
  return out.join('\n');
}

/**
 * 1 つの値（配列 or オブジェクト）を節として描画する。表は必ず行頭に出す。
 * @param {string} key
 * @param {any} value
 * @param {number} level 見出しレベル（2 = "##"）
 * @returns {string[]} Markdown ブロック（空行区切りで連結する前提）
 */
function renderSection(key, value, level) {
  const h = headingFor(level);
  const out = [];

  if (Array.isArray(value)) {
    if (!value.length) return out;
    if (value.every(isScalar)) {
      out.push(`- **${key}**: ${value.map(fmtScalar).join(' / ')}`);
      return out;
    }
    const shape = tableShape(value);
    out.push(`${h} ${key}（全 ${value.length} 件）`);
    if (shape) {
      out.push(renderTable(value, shape.keys, value.length));
      if (shape.nested) {
        // 表に載せられなかった入れ子だけを補う
        const keySet = new Set(shape.keys);
        value.slice(0, MAX_LIST_ITEMS).forEach((item, i) => {
          const extra = Object.entries(item).filter(([k, v]) => !keySet.has(k) && v !== undefined && (isPlainObject(v) || Array.isArray(v)));
          if (!extra.length) return;
          out.push(`${headingFor(level + 1)} ${itemLabel(item, i)}`);
          for (const [k, v] of extra) out.push(...renderSection(k, v, level + 2));
        });
        if (value.length > MAX_LIST_ITEMS) out.push(`_（他 ${value.length - MAX_LIST_ITEMS} 件は structuredContent を参照）_`);
      }
      return out;
    }
    // 表にできない配列（列が多すぎる・配列の配列など）→ 項目ごとの節
    value.slice(0, MAX_LIST_ITEMS).forEach((item, i) => {
      if (!isPlainObject(item)) { out.push(`- ${fmtScalar(item)}`); return; }
      out.push(`${headingFor(level + 1)} ${itemLabel(item, i)}`);
      for (const [k, v] of Object.entries(item)) {
        if (NAME_KEYS.includes(k) && isScalar(v)) continue; // 見出しに使った値は繰り返さない
        out.push(...renderSection(k, v, level + 2));
      }
    });
    if (value.length > MAX_LIST_ITEMS) out.push(`_（他 ${value.length - MAX_LIST_ITEMS} 件は structuredContent を参照）_`);
    return out;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return out;
    const folded = keys.map(k => `${k}=${linkOrText(k, value[k])}`).join(', ');
    if (!hasNested(value) && keys.length <= 3 && folded.length <= 120) {
      out.push(`- **${key}**: ${folded}`);
      return out;
    }
    out.push(`${h} ${key}`);
    for (const [k, v] of Object.entries(value)) out.push(...renderSection(k, v, level + 1));
    return out;
  }

  out.push(`- **${key}**: ${linkOrText(key, value)}`);
  return out;
}

/**
 * ツール戻り値の形から見出しを決める（title が無いツール用）。
 * 表示専用の派生値なので structuredContent には影響しない。
 */
function deriveHeading(data, fallback) {
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  if (typeof data.from === 'string' && typeof data.to === 'string' && data.from && data.to) return `${data.from} → ${data.to}`;
  if (typeof data.from_port === 'string' && typeof data.to_port === 'string') return `${data.from_port} → ${data.to_port}`;
  const st = data.station_name || data.station || data.busstop_name;
  if (typeof st === 'string' && st.trim()) return `📍 ${st.trim()}`;
  if (typeof data.operator_name === 'string' && data.operator_name.trim()) return data.operator_name.trim();
  if (typeof data.operator === 'string' && data.operator.trim()) return data.operator.trim();
  if (typeof data.airport === 'string' && data.airport.trim()) return data.airport.trim();
  return fallback || '';
}

/**
 * payload を Markdown に変換する。
 * @param {object} data ツールの戻り値（status/title/note/... を含むプレーンオブジェクト）
 * @param {{ heading?: string }} [opts] heading は title も形からも見出しが決まらないときの見出し
 * @returns {string}
 */
export function toMarkdown(data, opts = {}) {
  if (!isPlainObject(data)) return String(data ?? '');
  const out = [];
  const heading = deriveHeading(data, opts.heading);
  if (heading) out.push(`# ${heading}`);
  if (typeof data.note === 'string' && data.note.trim()) out.push(`_${data.note.trim()}_`);

  // 状態・メタ情報は 1 行にまとめる
  const meta = Object.entries(data)
    .filter(([k, v]) => META_KEYS.has(k) && isScalar(v) && v !== undefined && v !== '')
    .map(([k, v]) => `${KEY_LABELS[k] || k}: ${fmtScalar(v)}`);
  if (data.status === 'NO_DATA' && typeof data.message === 'string' && data.message.trim()) meta.push(data.message.trim());
  if (meta.length) out.push(`> ${meta.join(' · ')}`);

  // 🔴 AI アドバイスは原文のまま独立ブロックで先に出す（#94 / #122 の安全要件）
  const advice = typeof data.ai_transit_advice === 'string' && data.ai_transit_advice.trim() ? data.ai_transit_advice.trim() : '';
  if (advice) out.push(advice);

  if (data.status === 'ERROR' && typeof data.error_message === 'string' && data.error_message.trim()) {
    out.push(`**${data.error_type || 'ERROR'}**: ${data.error_message.trim()}`);
  }

  const skipped = new Set([...META_KEYS, 'title', 'note', 'ai_transit_advice', 'status', 'error_message', 'error_type']);
  const scalars = [];
  const sections = [];
  for (const [k, v] of Object.entries(data)) {
    if (skipped.has(k) || v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) { scalars.push([k, '—']); continue; }
      sections.push(...renderSection(k, v, 2));
    } else if (isPlainObject(v)) {
      const keys = Object.keys(v);
      if (!keys.length) { scalars.push([k, '—']); continue; }
      const folded = keys.map(k2 => `${k2}=${linkOrText(k2, v[k2])}`).join(', ');
      // 短い入れ子は 1 行に畳む（fare など）。長い注記つきの入れ子は節にして読めるようにする。
      if (keys.every(k2 => isScalar(v[k2])) && keys.length <= 3 && folded.length <= 120) {
        scalars.push([k, folded]);
      } else {
        sections.push(...renderSection(k, v, 2));
      }
    } else if (v !== '') {
      scalars.push([k, v]);
    }
  }
  if (scalars.length) out.push(scalars.map(([k, v]) => `- **${k}**: ${linkOrText(k, v)}`).join('\n'));
  if (sections.length) out.push(sections.join('\n\n'));

  return out.filter(s => s !== undefined && s !== null && String(s).trim() !== '').join('\n\n').trim() + '\n';
}
