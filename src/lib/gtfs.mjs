/**
 * GTFS 共通ユーティリティ（モノリス分割 Phase 4b-2 リファクタ）
 * ODPT 静的 GTFS ZIP（files/odpt/...・{ url, date } 方式）の取得を担当。
 * 交通モード非依存のため ferry / bus 双方から利用する（依存方向: handlers → lib）。
 * 依存: config.mjs（API_KEY）/ lib/time.mjs（gtfsFetchDates）のみ。
 */
import { API_KEY } from '../config.mjs';
import { gtfsFetchDates } from './time.mjs';
import axios from 'axios';

export async function fetchGtfsZipBuffer(src, timeoutMs = 20000) {
  let lastError = null;
  // #93: src.date が関数でない不正なオブジェクトでもクラッシュしないよう関数チェックを追加。
  // 関数でなければ gtfsFetchDates(undefined) により「今日」の日付で取得する。
  // 🔴 v2.45.0: 固定URL（dateパラメータ不要）のソース（例: 都営バス ToeiBus-GTFS.zip）は
  // src.noDate:true で date を付けずに取得する（date を付けると 404 になる）。
  const fixedDate = (src && typeof src.date === 'function') ? src.date() : undefined;
  const dates = src && src.noDate ? [null] : gtfsFetchDates(fixedDate);
  for (const d of dates) {
    try {
      const params = { 'acl:consumerKey': API_KEY };
      if (d) params.date = d;
      const res = await axios.get(src.url, { params, responseType: 'arraybuffer', timeout: timeoutMs });
      return res.data;
    } catch (e) { lastError = e; }
  }
  throw lastError;
}
