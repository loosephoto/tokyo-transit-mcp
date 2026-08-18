/**
 * GTFS-RT (protobuf) 軽量ワイヤーデコーダ
 * 依存なしで GTFS-RT フィード（特に Alert / 列車運行情報）をパースする。
 * 汎用の protobuf wire フォーマットデコーダ + GTFS-RT スキーマの抽出ヘルパー。
 *
 * 依存を増やさず（protobufjs 等を追加せず）当MCPで必要なフィールドのみ読み取る方針。
 * スキーマは gtfs-realtime.proto に準拠（フィールド番号は公式定義と一致）。
 */

// ---------- 汎用 protobuf wire デコーダ ----------
function readVarint(buf, offset) {
  let result = 0n, shift = 0n;
  while (true) {
    const b = buf[offset++];
    if (b === undefined) throw new Error('protobuf: unexpected end reading varint');
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, offset };
}

// メッセージをデコードし、fieldNumber -> [{wireType, value}] の生フィールド表を返す
function decodeMessage(buf, start = 0, end = buf.length) {
  const fields = {};
  let offset = start;
  while (offset < end) {
    const key = readVarint(buf, offset);
    offset = key.offset;
    const fieldNum = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    let value;
    if (wireType === 0) {
      const v = readVarint(buf, offset); value = v.value; offset = v.offset;
    } else if (wireType === 1) {
      value = buf.subarray(offset, offset + 8); offset += 8;
    } else if (wireType === 2) {
      const len = readVarint(buf, offset); offset = len.offset;
      value = buf.subarray(offset, offset + Number(len.value)); offset += Number(len.value);
    } else if (wireType === 5) {
      value = buf.subarray(offset, offset + 4); offset += 4;
    } else {
      throw new Error(`protobuf: unsupported wire type ${wireType}`);
    }
    (fields[fieldNum] = fields[fieldNum] || []).push({ wireType, value });
  }
  return fields;
}

// length-delimited フィールドの先頭バイト列（subarray）を返す。無ければ null
function fieldBytes(fields, fieldNum) {
  const list = fields[fieldNum];
  if (!list || !list.length) return null;
  for (const f of list) if (f.wireType === 2) return f.value;
  return null;
}
function firstField(fields, fieldNum) {
  const list = fields[fieldNum];
  return list && list.length ? list[0].value : undefined;
}

// 文字列フィールド（UTF-8）を復号
function decodeUtf8(bytes) {
  if (!bytes) return '';
  try { return new TextDecoder('utf-8').decode(bytes); } catch (_) { return ''; }
}

// ---------- GTFS-RT スキーマ（gtfs-realtime.proto のフィールド番号） ----------
// FeedMessage: 1=header, 2=entity(repeated)
// FeedEntity : 1=id(string), 5=alert
// Alert      : 1=active_period, 4=informed_entity, 5=cause, 6=effect,
//              7=url, 8=header_text(TranslatedString), 10=description_text
// EntitySelector: 2=route_id(string)
// TranslatedString: 1=translation(repeated)
// Translation: 1=text(string), 2=language

// TranslatedString の本文（ja優先で text を抽出）
function translatedText(fields) {
  const trans = fieldBytes(fields, 1); // translation (repeated) — 先頭のみで代表
  if (!trans) return '';
  const t = decodeMessage(trans);
  const text = firstField(t, 1); // text (string, wire2)
  return decodeUtf8(typeof text === 'object' && text ? text : null);
}

// Alert メッセージを人間可読な運行情報へ変換
function parseAlert(alertBytes) {
  const a = decodeMessage(alertBytes);
  const header = translatedText(fieldBytes(a, 8) ? decodeMessage(fieldBytes(a, 8)) : {});
  const desc = translatedText(fieldBytes(a, 10) ? decodeMessage(fieldBytes(a, 10)) : {});
  // informed_entity (repeated, field4) の route_id を収集
  const routes = [];
  for (const ent of a[4] || []) {
    const es = decodeMessage(ent.value);
    const rid = firstField(es, 2); // route_id
    const routeId = decodeUtf8(typeof rid === 'object' && rid ? rid : null);
    if (routeId) routes.push(routeId);
  }
  const effect = firstField(a, 6); // enum (varint)
  const cause = firstField(a, 5);  // enum (varint)
  return { header: header.trim(), description: desc.trim(), routes: [...new Set(routes)], effect: typeof effect === 'bigint' ? Number(effect) : undefined, cause: typeof cause === 'bigint' ? Number(cause) : undefined };
}

/**
 * GTFS-RT フィード全体（FeedMessage）をパースし、Alert エンティティを返す。
 * @param {Uint8Array|Buffer} data
 * @returns {{ entities: Array<{id:string, alert:Object|null}> }}
 */
export function parseGtfsRtFeed(data) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const feed = decodeMessage(buf);
  const entities = [];
  for (const ent of feed[2] || []) { // entity (repeated, field2)
    const e = decodeMessage(ent.value);
    const id = decodeUtf8(typeof firstField(e, 1) === 'object' ? firstField(e, 1) : null);
    const alertBytes = fieldBytes(e, 5);
    entities.push({ id, alert: alertBytes ? parseAlert(alertBytes) : null });
  }
  return { entities };
}

// 列車 alert を運行状況の路線別ステータスへ正規化するヘルパー
export function alertsToRunningLines(entities) {
  const lines = [];
  for (const { alert } of entities) {
    if (!alert) continue;
    const text = alert.header || alert.description;
    lines.push({
      routeIds: alert.routes,
      text,
      status: /見合わせ|運休/.test(text) ? 'suspended'
        : /遅延|遅れ/.test(text) ? 'delay'
        : /平常/.test(text) ? 'normal' : 'unknown'
    });
  }
  return lines;
}
