# 空港フライト時刻・到着時刻表示 — 設計と実装記録

> 状態: **実装済み**（v2.17.0 / 2026-08-03）
> 本ドキュメントは設計案（2026-08-02）を実装完了後の状況に合わせて更新したものです。実装中に判明した API の制約（2026-08-03 実測）も記録します。

## 1. 背景・目的

- 海外からの来客・帰省時に「フライトの到着時刻」と「そこからのアクセス経路」をワンストップで知りたいニーズがある。
- 本サーバーは既に「成田空港」「羽田空港第1/2/3ターミナル」への電車・バスアクセス経路（search_route / search_bus 横断乗り継ぎ）を提供済み。
- 足りないのは **フライトの実際の到着時刻・遅延・ターミナル・ゲート** のデータ。

## 2. データソース選定（確定: AviationStack）

| 候補 | リアルタイム | 無料ティア | 備考 |
|:---|:---|:---|:---|
| **AviationStack** | ○ (30-60秒遅れ) | ○ (月100回/キー必要) | シンプル、IATA/便名/空港でフィルタ可。**採用** |
| Airlabs | ○ | △ | キー必要 |
| FlightAware AeroAPI | ○ | 試用のみ | クレカ必要 |
| AviationEdge | ○ | 試用のみ | クレカ必要 |

→ **AviationStack を採用**（確定）。環境変数 `FLIGHT_API_KEY` でキーを注入。
エンドポイント: `https://api.aviationstack.com/v1/flights`（HTTPS）

### ⚠️ 実装中に判明した API 制約（2026-08-03 実測・コミット b82ee3c で対処）

1. **`flight_status` は単一値のみ受付**。`landed,scheduled,active` のようなカンマ区切り複数値は `validation_error` で拒否される。
   → 実装では `flight_status` を送らず、当日分をステータス問わず取得して各便のステータスをそのまま表示（フィルタ代わりにしない）。
2. **無料プランは `flight_date` パラメータ非対応**（HTTP 403 `function_access_restricted`）。
   → `fetchFlights` はエラー時（エラーボディ・HTTP 403 の両方）に**必須パラメータ（空港/便名/limit）のみで再試行**する構造。日付指定をしても当日分を返す（無料プランは当日分のみ取得可能）。
3. **便名検索**（`flight_iata`）は無料プランでも利用可（該当便が当日データに無ければ 0 件）。

## 3. `search_flight` の実装

### 入力
- `airport`: 空港指定（"羽田空港" / "成田空港" / "HND" / "NRT"）
- `flight_number`: 便名指定（"NH001" / "JL000"）— airport と排他または併用
- `direction`: "arrival"（到着・Default） / "departure"（出発）
- `flight_date`: "YYYY-MM-DD"（省略時は当日。※無料プランは非対応→自動フォールバック）
- `airline`: 任意（航空会社絞り込み）
- `destination`: 任意（到着時の連携先。例: "東京駅"）

### 出力（各フライト・実装フィールド）
- `flight_iata`（便名）、`airline`（航空会社名）
- `status` / `status_text`（scheduled/active/landed/cancelled/diverted を ja/en/zh に翻訳）
- `terminal` / `gate` / `baggage`
- `scheduled_time` / `actual_time` / `estimated_time`（日本時間表示）
- `delay_minutes`（遅延・分）
- `airport_name` / `airport_iata`（着目側）と `other_airport_name` / `other_airport_iata`（相手側）

### 言語
- 既存 `detectLanguage` で ja/en/zh 自動判定、ラベル・ステータスを多言語化

## 4. 海外来客・帰省に最適な「連携」設計（実装済み）

到着フライトを検索した際、自動で **「空港 → 目的地」のアクセス経路** を提案：

1. ユーザーが `destination`（任意、例: "東京駅"）を指定
2. `search_flight` で到着フライト一覧を取得
3. 各フライトの到着ターミナルから `destination` への経路を既存の経路エンジンで算出（`access_route`）
4. `destination` 未指定時も、到着時は主要アクセス駅へのルートを自動表示（`access_routes`）:
   - 羽田: 東京駅 / 品川 / 浜松町
   - 成田: 東京駅 / 日暮里 / 新宿

## 5. Graceful Degradation（実装済み・検証済み）

- `FLIGHT_API_KEY` 未設定時: 「フライト時刻は設定されていません（APIキー未設定）」＋空港アクセス経路のみ表示
- API エラー・0件時: 「フライトが見つかりませんでした」＋空港アクセス経路のみ表示
- 便名のみ指定（空港不明）時: キー有無で文言を分岐（キーあり=「該当便が当日データに見つかりません（無料プランは当日分のみ）」/ キーなし=「設定が必要」）

## 6. 実装ステップ（完了）

1. `cache` に `flightData` 追加（TTL: 60000ms = 60秒・リアルタイム性重視）
2. `fetchFlights(params)` — AviationStack 呼び出し（**エラー時リトライ付き**・キャッシュ対応）
3. `normalizeFlight()` — レスポンスを共通フォーマットに
4. `searchFlight(args)` — ツール実装（言語判定・連携・graceful degradation）
5. `search_flight` を tools リスト・export に追加
6. README (ja/en/zh) 更新（無料プラン制限も記載）

## 7. 解決済み事項（旧: 未解決・確認事項）

| 旧項目 | 結論 |
|:---|:---|
| Q1: フライトAPIは AviationStack でよいか | **採用**（2026-08-03 実API検証済み） |
| Q2: `FLIGHT_API_KEY` を提供いただけるか | **提供済み**。`.env` と Hermes `config.yaml` に設定（アプリ再起動で MCP サーバーに反映） |
| Q3: 到着時の「目的地」連携は search_route か search_bus か | **経路エンジン共通化**で実装（`destination` 指定で `access_route`、未指定で主要駅 `access_routes`） |
