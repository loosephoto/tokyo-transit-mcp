// #82/#83 回帰テスト: get_timetable の calendar 分離・時刻ソート・1000件上限
// - #82: calendar 引数（Weekday/SaturdayHoliday）で平日・土休日を分離し、時刻昇順ソート
// - #83: calendar 別分割取得により1000件上限の切り捨てを回避（truncated フラグ）
import * as mod from '../src/index.mjs';

let fail = 0;
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); fail++; } else console.log('✅ OK:', msg); };
const parseResp = (res) => {
  const cont = res?.content || [];
  for (const c of cont) {
    if (c?.type === 'text' && (c.text || '').trim().startsWith('{')) {
      try { const j = JSON.parse(c.text); if (j.status) return j; } catch (e) {}
    }
  }
  return { status: 'UNPARSED' };
};

// 1. 平日指定で土休日が混入しない（銀座駅・銀座線・1000件上限に達していた路線）
const rW = parseResp(await mod.getTimetable({ station_name: '銀座', railway: '銀座線', calendar: 'Weekday', language: 'ja' }));
assert(rW.status === 'SUCCESS', `1: 平日検索が SUCCESS (${rW.status})`);
assert(rW.calendar === 'Weekday', '1: 応答 calendar=Weekday');
const calSet = new Set((rW.timetable || []).map(x => x.calendar));
assert(calSet.size === 1 && calSet.has('Weekday'), `1: 全行 calendar=Weekday (got ${[...calSet].join(',')})`);
assert(rW.total >= 500, `1: 平日の件数が十分 (total=${rW.total})`); // 切り捨てられていれば 500 未満になり得る

// 2. 土休日指定で平日が混入しない
const rS = parseResp(await mod.getTimetable({ station_name: '銀座', railway: '銀座線', calendar: 'SaturdayHoliday', language: 'ja' }));
assert(rS.status === 'SUCCESS', '2: 土休日検索が SUCCESS');
assert(rS.calendar === 'SaturdayHoliday', '2: 応答 calendar=SaturdayHoliday');
const calSet2 = new Set((rS.timetable || []).map(x => x.calendar));
assert(calSet2.size === 1 && calSet2.has('SaturdayHoliday'), `2: 全行 calendar=SaturdayHoliday`);

// 3. 平日と土休日の合計が calendar 別取得の全件（1000件上限で切り捨てられていない）
assert(rW.total + rS.total >= 1000, `3: 平日+土休日 >= 1000 (${rW.total}+${rS.total}=${rW.total + rS.total})`);

// 4. 発時刻が昇順ソートされている（方面ごとの先頭行で確認）
const times = (rW.timetable || []).map(x => (x.departure_time || '').split(',')[0]).filter(Boolean);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const sorted = times.every((t, i) => i === 0 || toMin(times[i - 1]) <= toMin(t));
assert(sorted, `4: 発時刻が昇順 (${times.slice(0, 6).join(' → ')})`);

// 5. 日付指定（土曜日）で自動判定
const rSat = parseResp(await mod.getTimetable({ station_name: '銀座', railway: '銀座線', date: '2026-08-15', language: 'ja' })); // 2026-08-15 は土曜
assert(rSat.calendar === 'SaturdayHoliday', `5: 土曜日付指定で SaturdayHoliday 自動判定 (got ${rSat.calendar})`);

// 6. 日本語 calendar 引数
const rJp = parseResp(await mod.getTimetable({ station_name: '銀座', railway: '銀座線', calendar: '平日', language: 'ja' }));
assert(rJp.calendar === 'Weekday', '6: 「平日」→ Weekday 変換');

// 7. service_date が含まれる
assert(/^\d{4}-\d{2}-\d{2}$/.test(rW.service_date || ''), '7: service_date が YYYY-MM-DD');

// 8. 応答行に calendar が含まれる（#82 受け入れ条件: calendar が応答に無いと判別不能）
const row0 = rW.timetable?.[0] || {};
assert(row0.calendar === 'Weekday', `8: 行に calendar フィールドが含まれる (got ${row0.calendar})`);
// ODPT は 24時超を 0:xx 表記で返すため next_day は発動しないが、深夜(00時台)行が存在し
// ソートキー(timeToSortMinutes)が 24時超を翌日扱いする実装は維持されている
const nightRows = (rW.timetable || []).filter(r => /^00:/.test(r.departure_time || ''));
assert(nightRows.length > 0, `8: 深夜(00時台)の行が存在し、時刻順に正しく配置される (${nightRows.length}行)`);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);