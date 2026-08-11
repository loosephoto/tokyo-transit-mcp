// 時刻・日付ユーティリティ（モノリス分割 Phase 3）— 依存ゼロの純関数
export function validateFlightDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function gtfsFetchDates(fixedDate) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
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
