/**
 * GTFS 共通ユーティリティ（モノリス分割 Phase 4b-2 リファクタ）
 * ODPT 静的 GTFS ZIP（files/odpt/...・{ url, date } 方式）の取得を担当。
 * 交通モード非依存のため ferry / bus 双方から利用する（依存方向: handlers → lib）。
 * 依存: config.mjs（API_KEY）/ lib/time.mjs（gtfsFetchDates）のみ。
 */
import { API_KEY, retryOnRateLimit } from '../config.mjs';
import { gtfsFetchDates } from './time.mjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import axios from 'axios';

// 🔴 v2.58.7: GTFS zip バッファのディスクキャッシュ。
//   GTFS zip は1事業者あたり数MB〜10MB超（川崎市バスは7.4MB）で、
//   `date=current` のたびに再ダウンロード・再解凍・再パースしていた。
//   search_bus 1回の呼出で 7事業者ぶんの zip を落とすため、
//   初回起動の probe-all-lang では search_bus だけで 156秒（最悪80秒）を要していた（実測）。
//   → メモリ＋ディスク（.cache/gtfs）の二重キャッシュで、プロセス再起動をまたいでも
//     再ダウンロードを回避する。ディスクキャッシュの TTL はファイル mtime で判定する。
const DISK_CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'gtfs');
const DISK_CACHE_MAX_AGE_MS = 3600000; // 1時間（config.cache.gtfsZip.ttl と同一）

// メモリキャッシュは専用の Map に保持する（cache は LRU なので巨大な zip を入れると他を押し出す）
const _memZipCache = new Map();
const _MEM_MAX_ENTRIES = 12;

function diskCachePath(src, d) {
  const key = `${src.url}|${d || 'nodate'}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  return path.join(DISK_CACHE_DIR, `${hash}.zip`);
}

function readDiskCache(src, d) {
  try {
    const p = diskCachePath(src, d);
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > DISK_CACHE_MAX_AGE_MS) {
      try { fs.unlinkSync(p); } catch { /* 削除失敗は無視 */ }
      return null;
    }
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

function writeDiskCache(src, d, buf) {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    const p = diskCachePath(src, d);
    // 一時ファイルへ書いてから rename（中途半端なファイルを残さない）
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, p);
  } catch { /* キャッシュ書き込み失敗は無視（性能改善であって必須ではない） */ }
}

export async function fetchGtfsZipBuffer(src, timeoutMs = 20000) {
  let lastError = null;
  // #93: src.date が関数でない不正なオブジェクトでもクラッシュしないよう関数チェックを追加。
  // 関数でなければ gtfsFetchDates(undefined) により「今日」の日付で取得する。
  // 🔴 v2.45.0: 固定URL（dateパラメータ不要）のソース（例: 都営バス ToeiBus-GTFS.zip）は
  // src.noDate:true で date を付けずに取得する（date を付けると 404 になる）。
  //
  // 🔴 v2.58.1: ODPT の GTFS 固定 URL は `date=current` で「現在の有効リソース」を取得できる。
  // 従来は各ソースに「有効期間内の固定日付」（例: date: () => '20260815'）をハードコードし、
  // その日付の有効期間が切れると 404 になっていた（実測: 2026-10 時点で
  // 京王バス・関東バス・西東京バス・川崎市バス・京成バス千葉ウェストが全て 404、
  // 都営バスのみ取得できた）。事業者はダイヤ改正のたびに日付が変わるため、
  // 固定日は数ヶ月で必ず陳腐化する。`date=current` ならダイヤ改正に追随して
  // 常に最新が取れる（実測で 7 事業者すべて 200）。
  const fixedDate = (src && typeof src.date === 'function') ? src.date() : undefined;
  const dates = src && src.noDate ? [null] : gtfsFetchDates(fixedDate);
  for (const d of dates) {
    // 🔴 v2.58.7: メモリキャッシュ → ディスクキャッシュ → ネットワーク の順に確認する。
    const memKey = `${src.url}|${d || 'nodate'}`;
    const memHit = _memZipCache.get(memKey);
    if (memHit) {
      _memZipCache.delete(memKey);   // アクセス順を更新（LRU 相当）
      _memZipCache.set(memKey, memHit);
      return memHit;
    }
    const diskHit = readDiskCache(src, d);
    if (diskHit) {
      _memZipCache.set(memKey, diskHit);
      while (_memZipCache.size > _MEM_MAX_ENTRIES) {
        _memZipCache.delete(_memZipCache.keys().next().value);
      }
      return diskHit;
    }
    try {
      const params = { 'acl:consumerKey': API_KEY };
      if (d) params.date = d;
      // 🔴 v2.58.7: 429（レート制限）は指数バックオフでリトライする。
      //   GTFS zip は数MB〜10MBと大きいため、ODPT 側の制限に引っかかりやすい。
      //   429 のまま失敗すると odptBreaker が OPEN になり検索系が全滅する（実測）。
      const res = await retryOnRateLimit(
        () => axios.get(src.url, { params, responseType: 'arraybuffer', timeout: timeoutMs }),
        { label: 'GTFS-zip' }
      );
      const buf = Buffer.from(res.data);
      _memZipCache.set(memKey, buf);
      while (_memZipCache.size > _MEM_MAX_ENTRIES) {
        _memZipCache.delete(_memZipCache.keys().next().value);
      }
      writeDiskCache(src, d, buf);
      return buf;
    } catch (e) { lastError = e; }
  }
  throw lastError;
}
