# 空港フライト時刻・到着時刻表示 — 設計案

> 状態: 設計提出。実装前にユーザー承認と API キー方針を確認。
> 更新: 2026-08-02

## 1. 背景・目的

- 海外からの来客・帰省時に「フライトの到着時刻」と「そこからのアクセス経路」を
  ワンストップで知りたいニーズがある。
- 本サーバーは既に「成田空港」「羽田空港第1/2/3ターミナル」への電車・バスアクセス
  経路（search_route / search_bus 横断乗り継ぎ）を提供済み。
- 足りないのは **フライトの実際の到着時刻・遅延・ターミナル・ゲート** のデータ。

## 2. データソース選定

| 候補 | リアルタイム | 無料ティア | 備考 |
|:---|:---|:---|:---|
| **AviationStack** | ○ (30-60秒遅れ) | ○ (月100回/キー必要) | シンプル、IATA/便名/空港でフィルタ可。採用推奨 |
| Airlabs | ○ | △ | キー必要 |
| FlightAware AeroAPI | ○ | 試用のみ | クレカ必要 |
| AviationEdge | ○ | 試用のみ | クレカ必要 |

→ **AviationStack を採用**。環境変数 `FLIGHT_API_KEY` でキーを注入。
エンドポイント: `http://api.aviationstack.com/v1/flights`
パラメータ例: `?access_key=KEY&arr_iata=HND&flight_status=landed,scheduled&limit=20`

## 3. 新ツール `search_flight` の設計

### 入力
- `airport`: 空港指定（"羽田空港" / "成田空港" / "HND" / "NRT"）
- `flight_number`: 便名指定（"NH001" / "JL000"）— airport と排他または併用
- `direction`: "arrival"（到着・Default） / "departure"（出発）
- `flight_date`: "YYYY-MM-DD"（省略時は当日）
- `airline`: 任意（航空会社絞り込み）

### 出力（各フライト）
- 便名 (flight.iata)、航空会社名 (airline.name)
- 出発地/到着地 (departure.airport / arrival.airport)
- **予定時刻** (scheduled) と **実際時刻** (actual) — 到着なら arrival、出発なら departure
- 遅延 (delay: 分)
- ターミナル (terminal)・ゲート (gate)・荷物受取 (baggage)
- ステータス (scheduled/active/landed/cancelled/diverted)
- 推定到着/出発（遅延込み）

### 言語
- 既存 `detectLanguage` で ja/en/zh 自動判定、ラベル多言語化

## 4. 海外来客・帰省に最適な「連携」設計（核心価値）

到着フライトを検索した際、自動で **「空港 → 目的地」のアクセス経路** を提案：

1. ユーザーが `destination`（任意、例: "東京駅"）を指定
2. `search_flight` で到着フライト一覧を取得
3. 各フライトの到着ターミナル（例: 成田空港第1ターミナル）から `destination` への
   経路を既存 `search_route` または `search_bus`(横断乗り継ぎ) で算出
4. 出力:
   ```
   [フライト] NH000 成田空港着 14:30（第1ターミナル）
   [アクセス] 成田空港第1ターミナル → 東京駅
              成田エクスプレス / 約60分 / 乗換0回
   [注意] 到着が遅延した場合は〇〇分押し（リアルタイム遅延反映）
   ```

帰省（出発）の場合は逆に「自宅最寄り → 空港」の経路を事前提案。

## 5. Graceful Degradation（キー未設定時）

- `FLIGHT_API_KEY` 未設定時:
  - `search_flight` は「フライト時刻は設定されていません（APIキー未設定）」と案内
  - 代わりに「空港へのアクセス経路」のみを search_route で表示（既存機能）
- キー設定時: フライト時刻＋アクセス経路の統合表示

## 6. 実装ステップ（承認後）

1. `cache` に `flightData` 追加（TTL 60s: リアルタイム性重視）
2. `fetchFlights(params)` — AviationStack 呼び出し（CircuitBreaker 対応）
3. `normalizeFlight()` — レスポンスを共通フォーマットに
4. `searchFlight(args)` — ツール実装（言語判定・連携・graceful degradation）
5. `search_flight` を tools リスト・export に追加
6. README (ja/en/zh) 更新

## 7. 未解決・確認事項

- **Q1**: フライトAPIは AviationStack でよいか？（他候補も可）
- **Q2**: `FLIGHT_API_KEY` を提供いただけるか？
  - 提供 → 実API検証可能
  - 未提供 → graceful degradation のみ実装（フライト時刻はモック/案内のみ）
- **Q3**: 到着時の「目的地」連携は search_route（電車優先）と search_bus（横断）の
  どちらを使うか？（両方対応も可）
