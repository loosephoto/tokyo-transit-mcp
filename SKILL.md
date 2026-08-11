---
name: tokyo-transit-mcp
description: 公共交通オープンデータセンター（ODPT）API・気象庁JMA API・GBFS を利用した東京圏総合交通情報MCPサーバー。鉄道・バス・水上バス・フェリー・空港フライト・コミュニティバスを横断検索し、日英中3言語のAIアドバイスを提供。
category: transportation
---

# Tokyo Transit MCP Server

## 目的

公共交通オープンデータセンター（ODPT）・気象庁（JMA）・GBFS などの**無料APIのみ**を利用した、東京圏の公共交通情報をスマートに扱うMCPサーバーです。天候・運行情報を加味したAIインテリジェントアドバイスを日本語・英語・中国語で自動生成します。

## 対象サービス

### 利用可能（無料）
- 鉄道: 東京メトロ・都営地下鉄・JR東日本（関東在来線）・小田急・京王・西武・東武・京急・京成・相鉄・東急・横浜市営・つくばエクスプレス(MIR)・りんかい線(TWR)・みなとみらい線・箱根登山線・北総・埼玉高速・東葉高速・芝山鉄道・JR東海・関東鉄道
- AGT・モノレール・路面電車: ゆりかもめ・日暮里舎人ライナー・東京モノレール・多摩モノレール・都電荒川線
- バス: 都営・西武・横浜市営（ODPT）＋ JRバス関東・都内コミュニティバス41自治体・千葉/埼玉/神奈川ローカルバス8社（ちばフラワー・さいたま市営・東武・西武観光・江ノ電・千葉中央・丸建つばさ・川越観光）（GTFS-JP個別取得）
- フェリー・水上バス: 東海汽船（伊豆諸島・小笠原航路）・東京クルーズ
- シェアサイクル: ドコモ・バイクシェア（GBFS・1,878ポート）
- フライト: 羽田(HND)・成田(NRT) 到着/出発（AviationStack・任意）

### 除外（有料）
- 駅すぱあとAPI
- NAVITIME乗換検索API
- Google Transit API

## ツール一覧

| ツール | 説明 |
|-------|------|
| `search_route` | 乗り換えルート検索（天気・AIアドバイス・多言語対応・コミュニティバス駅接続・通常時の到着地点周辺レンタサイクル案内付き） |
| `get_station_info` | 指定駅の基本情報を取得 |
| `get_weather` | 指定地域の天気予報＆運行影響アドバイスを取得 |
| `search_fare` | 2駅間の運賃を検索（東京メトロ・都営・横浜市営地下鉄・つくばエクスプレス・りんかい線・ゆりかもめ・多摩モノレール。JR・私鉄・東京モノレールは対象外） |
| `get_timetable` | 指定駅の時刻表情報を取得 |
| `search_bus` | バス停/系統検索・乗り継ぎ・バス⇔電車⇔バス横断乗り継ぎ・コミュニティバス駅接続 |
| `search_flight` | 空港フライト時刻・到着時刻表示（空港アクセス経路連携） |
| `list_transit_operators` | 交通事業者一覧（種別フィルタ付き） |
| `get_operator_routes` | 事業者別の路線・駅一覧 |
| `list_ferry_ports` | フェリー/水上バス港一覧 |
| `search_ferry` | 港間の航路・時刻表検索 |
| `list_community_buses` | 東京都コミュニティバス一覧（41自治体） |

## 使い方

### 1. APIキーの準備

- ODPT: https://developer.odpt.org/signup で登録し、APIキーを取得（必須）
- AviationStack: https://aviationstack.com/ で取得（任意・フライト時刻用。無料プランは当日分のみ）

### 2. 環境変数の設定

`.env`ファイルにAPIキーを設定：

```
ODPT_API_KEY=取得したAPIキー
FLIGHT_API_KEY=取得したAPIキー（任意）
```

### 3. 実行

```bash
npm start
```

### 4. MCPクライアント設定

`mcp.json`（または Claude Desktop / Hermes の設定）に `node src/index.mjs` を登録し、`ODPT_API_KEY`（必須）と `FLIGHT_API_KEY`（任意）を env に指定します。

## 使用例

### 乗り換え検索（多言語）
```
search_route(from: "渋谷", to: "新宿")
search_route(from: "Shibuya", to: "Odaiba")   # 英語入力→英語で応答
search_route(from: "涩谷", to: "台场")         # 中国語入力→中国語で応答
search_route(from: "スカイツリー", to: "浅草") # 略称・ランドマーク名も解決
search_route(from: "Haneda Airport", to: "Narita Airport", language: "en") # 空港アクセス
```

### バス横断乗り継ぎ
```
search_bus(from: "渋谷駅前", to: "新橋駅前")   # バス→電車→バス
search_bus(from: "渋谷駅東口", to: "恵比寿駅前") # コミュニティバス（ハチ公バス）
```

### フェリー・水上バス
```
search_ferry(from_port: "東京", to_port: "大島")
search_ferry(from_port: "浅草", to_port: "お台場海浜公園")
```

**東海汽船 GTFS 復旧監視（issue #76）**: ODPT 静的 GTFS（`files/odpt/TokaiKisen/AllLines.zip`）は 404 継続中で、ハードコード 19 港フォールバックで稼働。復旧の確認手順:
1. 起動ログの `[Ferry] 東海汽船: real GTFS ...` 行を確認 — `unavailable — hardcoded 19-port fallback in use` ならフォールバック中、`real GTFS OK` なら実データ復旧
2. 自動復帰の仕組み: フェリーGTFS キャッシュは TTL 1時間のため、実GTFSが復旧すれば次回ロード（1時間以内）で実データに自動切替（stop_name でハードコードと重複排除）
3. フォールバック中でも search_ferry・list_ferry_ports は 19 港で利用可能

### 空港フライト
```
search_flight(airport: "羽田空港", direction: "arrival", destination: "東京駅")
```

### 天気と運行影響アドバイス
```
get_weather(area_name: "東京")
```

## データ構造

### 駅ID形式
```
odpt:Station:TokyoMetro.{路線名}.{駅名}
例: odpt:Station:TokyoMetro.Ginza.Shibuya
```

### 路線ID形式
```
odpt:Railway:TokyoMetro.{路線名}
例: odpt:Railway:TokyoMetro.Ginza
```

## 注意事項

1. **多言語自動判定（i18n）**: 入力言語（日/英/中）を自動判定し、応答全体（駅名・路線名・天気・エラー・AIアドバイス）をローカライズします。
2. **サーキットブレイカー**: ODPT 3回連続失敗で60秒クールダウン。障害時もハードコードデータ（コミュニティバス等）で部分稼働を継続します。
3. **荒天時安全ロジック**: 台風・浸水・降雪・凍結時は自転車案内を自動非表示にし、必要に応じて避難所リンクを表示します。荒天以外は、到着地点の座標を解決でき、GBFSリアルタイム情報を取得できた場合に限り、到着地点周辺のドコモ・バイクシェアを案内します。利用可能台数・返却可否は変動するため公式アプリで確認してください。
4. **コミュニティバス**: 41自治体ディレクトリ＋主要10件の駅接続データ（バリアフリー案内）。時刻表・路線の詳細は各自治体公式サイトで確認してください。
5. **コード変更後の検証**: `node --check src/index.mjs` → 検証プローブ（全ツール×3言語）→ `npm run build` の順で確認してください。MCPツール経由の確認にはサーバー再起動が必要です（詳細は mcp-transit-server スキル参照）。

## 参考リンク

- ODPT公式: https://www.odpt.org/
- CKANデータカタログ: https://ckan.odpt.org/
- APIドキュメント: https://developer.odpt.org/
- AviationStack: https://aviationstack.com/

## 更新履歴

### v2.38.8（2026-08-11）— get_timetable の時刻表正確性改善（issues #82 #83）

- **#82 平日・土休日の分離**: `calendar` 引数（Weekday / SaturdayHoliday / 平日 / 土休日）と `date` 引数（YYYY-MM-DD）を追加。`resolveTimetableCalendar()` が引数最優先 → 検索日/当日の曜日で自動判定（土日=SaturdayHoliday）。マージ後のフィルタで `odpt:calendar`（`odpt.Calendar:Weekday` 形式・`/[.:]/` で区切り）を照合し、平日検索に土休日列車を混入させない
- **#82 時刻の昇順ソート**: `timeToSortMinutes()`（24時超 → `{ minutes, nextDay }` 化）を新設。方面（odpt:railDirection）ごとにグループ化し、指定駅での最初の departure 時刻（`firstDepartureMinutes()`）で昇順ソートしてから `slice(0, 20)`。行単位に `departure_next_day` / `arrival_next_day` フラグを付与
- **#83 1000件上限の切り捨て回避**: 路線単位 × calendar 別（Weekday / SaturdayHoliday）に分割取得。銀座線は無フィルタ1000件 → 平日658 + 土休日560 = 1,218件を全件取得できることを実データで確認。レスポンスが1000件ちょうど/超過の場合は `truncated: true` を付与（完全な SUCCESS 扱いを回避）。キャッシュキーは `train_timetable:merged`（{ merged, truncated } を保持）に変更
- 応答に `calendar`・`service_date`・`truncated` を追加し、クライアント側で運行日・切り捨てを判別可能に
- inputSchema: calendar / date を追加
- **検証**: `npm run build` 成功・`probe-all-lang` 26/26 PASS・`check-railway-integrity` PASS・`test:issue`（test-issue-82-83.mjs 追加・計4本）全PASS
