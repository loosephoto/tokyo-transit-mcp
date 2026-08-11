// CSV パース（モノリス分割 Phase 3）— 依存ゼロの純関数
export function parseCsvRecords(content) {
  const records = [];
  let row = [], field = '', quoted = false;
  const text = String(content || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ',') {
      row.push(field.trim()); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(v => v !== '')) records.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some(v => v !== '')) records.push(row);
  }
  return records;
}

export function parseCsvLine(line) { return parseCsvRecords(`${line}\n`)[0] || []; }
