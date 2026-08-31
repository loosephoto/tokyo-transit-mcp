// 時刻・日付ユーティリティ（モノリス分割 Phase 3）— 依存ゼロの純関数
export function validateFlightDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// 🔴 v2.50.1: 日本標準時（JST = UTC+9）ベースの「今日の日付」を返す。
// 従来は new Date().toISOString().slice(0,10)（UTC日付）を使っていたため、
// JST 0:00〜9:00 の時間帯は「昨日」の日付になり、GTFS取得日・サービス日付表示が1日ずれていた。
// このサーバーのユーザーは日本国内の交通機関を使うため、基準時区は常に JST。
export function getJstDateStr(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// JST日付の YYYYMMDD 形式（GTFS date パラメータ・フェリーGTFS取得日）
export function getJstDateCompact(now = new Date()) {
  return getJstDateStr(now).replace(/-/g, '');
}

// JST の曜日（0=日 6=土）。時刻表の平日/土休日判定は日本基準である必要がある。
export function getJstDay(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCDay();
}

export function gtfsFetchDates(fixedDate) {
  const today = getJstDateCompact();
  const dates = [String(fixedDate || today)];
  if (!dates.includes(today)) dates.push(today);
  return dates;
}

export function normalizeOvernightTime(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(timeStr);
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (h >= 24) {
    h -= 24;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  return String(timeStr);
}

export function timeToSortMinutes(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return { minutes: h * 60 + min, nextDay: h >= 24 };
}
