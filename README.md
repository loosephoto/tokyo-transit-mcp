🌐 **Language / 言語 / 语言**: [日本語](#japanese) | [English](#english) | [中文](#chinese)

---

<a id="japanese"></a>
# 🚃 Tokyo Transit MCP Server (日本語)

**ODPT API + 気象庁 API を統合した東京圏総合交通情報MCPサーバー**

鉄道・モノレール・AGT（ゆりかもめ等）・路面電車・水上バス・フェリー・シェアサイクルを横断検索し、天候・運行情報を加味した AI インテリジェントアドバイスを多言語（日本語/英語/中国語）で提供します。

---

## ✨ 特徴

本サーバーは、単なる路線検索にとどまらず、気象データや各種交通オープンデータ（ODPT/GBFS/GTFS）を統合し、AIがリアルタイムに移動アドバイスを提供する高度なMCPサーバーです。主な特徴は以下の通りです。

### 🚉 全交通機関を統合
| 種別 | 対応事業者 |
|:---|:---|
| 🚃 鉄道 | JR東日本・東京メトロ・都営地下鉄・小田急・京王・西武・東武・京急・京成・相鉄・東急・横浜市営・**つくばエクスプレス(MIR)**・**りんかい線(TWR)**・**みなとみらい線**・**箱根登山線**・北総・埼玉高速・東葉高速・芝山鉄道・JR東海 |
| 🚌 バス | 都営バス・西武バス・横浜市営バス（ODPT `odpt:Bus` から3事業者を並列マージ）＋ JRバス関東・都内コミュニティバス（GTFS-JP個別取得パス）／バス停検索＋乗り継ぎ探索（`odpt:BusroutePattern`）＋**バス電車バス横断乗り継ぎ**（駅・バス停を緯度経度で紐付け）＋ノンステップバス表示（`isNonStepBus`）｜
| ✈️ フライト | 羽田(HND)・成田(NRT)等の到着/出発フライト時刻（AviationStack `FLIGHT_API_KEY`）＋到着時の空港→目的地アクセス経路連携（既存 search_route）／キー未設定時は空港アクセス経路のみ（graceful degradation）｜
| 🚡 AGT | ゆりかもめ・日暮里・舎人ライナー |
| 🚝 モノレール | 東京モノレール・多摩モノレール |
| 🚋 路面電車 | 都電荒川線（東京さくらトラム） |
| 🚢 フェリー | 東海汽船（伊豆諸島・小笠原航路）※ODPT GTFS取得不可時は内蔵ポートリスト（19港）で検索 |
| 🚤 水上バス | 東京クルーズ（浅草〜お台場〜豊洲） |
| 🚲 シェアサイクル | ドコモ・バイクシェア（GBFS API、1,878ポート） |

### 🤖 AI インテリジェントアドバイス
- **☀ 晴天時**: 快適な移動をサポート
- **☔ 雨天時**: 滑りやすい駅構内注意喚起、バス振替推奨
- **🌡 高温時**: 熱中症警戒アラート、水分補給推奨
- **🚨 緊急時**: 運転見合わせ・災害検知時は自動的に避難所リンクを表示

### 🛡 セーフティ＆フォールトトレランス
- **サーキットブレイカー**: 3回連続失敗 → 60秒クールダウン（段階的に延長）
- **統一キャッシュ管理**: API負荷を最大80%削減（24時間キャッシュ対応）
- **デグレードモード**: API障害時も部分稼働を継続
- **荒天時安全ロジック**: 台風・浸水時は自転車案内を自動非表示
- **LLMフレンドリーJSON**: 全エラーを構造化データで出力

### 💬 自然言語で簡単検索
駅名・バス停・港名は**部分一致・表記揺れ・旧名でも自動解決**するため、厳密な入力不要で直感的に検索できます。「スカイツリーからテレコムセンターまで」「Odaiba から Toyosu」「東京ビッグサイトまでバス」のように、**日本語・英語・中国語の自然な表現をそのまま渡す**だけで経路・バス・フェリーを検索できます。

**検索例**:
```
スカイツリーからテレコムセンターまでの経路を調べて
Shibuya to Odaiba route
查询从浅草到台场的路线
東京ビッグサイト までのバス停
Oshima ferry from Tokyo
```

> ⚠️ **ご注意**: 本サーバーは MCP クライアント（Claude Desktop / Hermes 等）上の LLM モデルを介して応答を表示します。モデルの違いにより、AIインテリジェントアドバイスや検索結果の**表示揺れ（表現の違い・省略の有無等）が若干発生する場合があります**。検索エンジン自体の出力（JSON）はモデルに依存せず一定ですが、最終的な文章化は利用するモデルに左右されます。

### 🌐 マルチランゲージ
日本語・英語・中国語を自動判定し、**入力言語に合わせて応答全体をローカライズ**。AIアドバイスはもちろん、経路の駅名・路線名、天気テキスト、エラーメッセージまでユーザーの言語で返します（例: `Odaiba -> Haneda` は英語、`台场到羽田机场` は中国語、`お台場→羽田空港` は日本語）。矢印・スラッシュ・括弧などの記号を含む英語入力や、簡体字・中国語の機能語（到・从・前往・出发 等）を含む入力も正しく判定します。

### 🔧 テストモード（-test）
`search_route` に `-test <障害種別>` を付けると20種類以上の障害シミュレーションが可能。

---

## 📦 セットアップ

以下の手順に従ってリポジトリのクローンと必要な依存関係のインストールを行い、MCPクライアント（Claude DesktopやHermes等）に設定を追加してください。

```bash
# リポジトリをクローン
git clone https://github.com/loosephoto/tokyo-transit-mcp.git
cd tokyo-transit-mcp

# 依存関係インストール
npm install

# ODPT API キーを設定（https://developer.odpt.org/ から取得）
echo 'ODPT_API_KEY=your_api_key_here' > .env
# フライト時刻を利用する場合のみ設定（AviationStack APIキー・任意）
echo 'FLIGHT_API_KEY=your_flight_api_key_here' >> .env
```

### MCP クライアント設定例（Claude Desktop / Hermes 等）

```json
{
  "mcpServers": {
    "tokyo-transit": {
      "command": "node",
      "args": ["/path/to/tokyo-transit-mcp/src/index.mjs"],
      "env": {
        "ODPT_API_KEY": "your_api_key_here",
        "FLIGHT_API_KEY": "your_flight_api_key_here"
      }
    }
  }
}
```

---

## 🛠 使用可能ツール

本MCPサーバーでは、ルート検索、時刻表・運賃情報の取得、運行状況・気象・フェリー航路の検索など、多角的な交通リクエストに対応する全10種類のツールを提供しています。

### 1. `search_route` — 乗り換えルート検索（メイン機能）

**機能**: 出発駅→到着駅のルートを検索。天気・運行情報を自動取得しAIアドバイスを付加。入力言語（日/英/中）に応じて応答全体（駅名・路線名・天気・エラー）を自動ローカライズ。

```
search_route(from: "渋谷", to: "新宿")
```

**パラメータ**:
- `from` (string) — 出発駅名
- `to` (string) — 到着駅名
- `user_location` (object, 任意) — 利用者の現在位置 `{ lat: number, lon: number }`。指定時は運転見合わせ時のシェアサイクル案内を現在地基準で表示（未指定時は出発駅基準）

**レスポンス例**:
```json
{
  "status": "SUCCESS",
  "from": "渋谷",
  "to": "新宿",
  "weather_text": "東京地方: 晴れ",
  "direct_search_url": "https://transit.yahoo.co.jp/...",
  "ai_transit_advice": "☀ 【AIからのインテリジェントアドバイス】\n晴れの良好なお天気です！...",
  "gov_facility_search_support": { "...": "..." },
  "station_bus_stops": { "...": "..." },
  "fare_available": true,
  "non_rail_transit_support": { "...": "..." }
}
```

**テストモード**:
```
search_route(from: "東京 -test 人身事故", to: "新宿")
search_route(from: "新宿 -test 台風", to: "渋谷")
search_route(from: "Tokyo -test typhoon", to: "Shinjuku")
search_route(from: "东京 -test 台风", to: "新宿")
```

### 2. `get_station_info` — 駅情報取得

```
get_station_info(station_name: "渋谷", operator: "tokyometro")
```

### 3. `get_weather` — 天気情報

```
get_weather(area_name: "東京")
```

### 4. `search_fare` — 運賃検索

```
search_fare(from: "渋谷", to: "新宿")
```
```json
{
  "fares": [{ "operator": "TokyoMetro", "ticket": 200, "ic": 198 }]
}
```

### 5. `get_timetable` — 時刻表検索

```
get_timetable(station_name: "渋谷", railway: "山手線")
```

### 6. `search_bus` — バス路線・乗り継ぎ検索（都営・西武・横浜市営＋JRバス関東・コミュニティバス）

ODPT の `odpt:Bus` から都営バス・西武バス・横浜市交通局（横浜市営バス）の3事業者を並列取得し、GTFS-JP 個別取得パスで JRバス関東・都内コミュニティバス（ちぃばす・ハチ公バス等）を追加します。

- **バス停検索**: `busstop_name` でバス停・系統を検索
- **乗り継ぎ探索**: `from` + `to` で `odpt:BusroutePattern` の停留所順序から最短乗り継ぎ経路を探索（案B: 異系統・異事業者間の乗り継ぎ対応）
- **横断乗り継ぎ**: バス停と駅を緯度経度で紐付け、`odpt:Station`（電車）グラフと統合。バス→電車→バスの横断ルートも探索（例: 渋谷駅前→（徒歩）→渋谷→（電車）→新橋駅前）
- **バリアフリー**: `odpt:BusTimetable.isNonStepBus`（ノンステップバス・段差なし）を系統ごとに表示

※ 乗り継ぎは都営・西武・横浜市営バスのみ対象（JRバス関東・コミュニティバスは停留所順序データがないため対象外）。運賃はODPT非対応のため検索不可。

```
search_bus(busstop_name: "渋谷駅前")                    # バス停検索
search_bus(from: "渋谷駅前", to: "新橋駅前")            # バス→電車→バス 横断乗り継ぎ
search_bus(from: "横浜駅前", to: "川崎駅前")            # 横浜→（電車）→川崎 横断乗り継ぎ
```



### 7. `search_flight` — 空港フライト時刻・到着時刻表示 ✈️

- **空港検索**: `airport`（羽田空港/成田空港/HND/NRT 等）で到着/出発フライトを検索
- **空港名の表記揺れ対応**: "羽田"/"成田"/"Haneda"/"Narita" 等、末尾の「空港/Airport/机场」の有無や日英中表記を自動正規化（3か国語対応）。
- **便名検索**: `flight_number`（NH001/JL000 等）で特定便を検索
- **到着時の最適連携**: `destination`（例: 東京駅）を指定すると、到着ターミナルから目的地へのアクセス経路（電車）を自動提案。**海外からの来客・帰省時に最適**
  - `destination` 未指定でも、到着時は主要アクセス駅（羽田: 東京駅/品川/浜松町、成田: 東京駅/日暮里/新宿）へのルートを自動表示（`access_routes`）。
- **表示項目**: 便名・航空会社・ステータス（予定/運航中/到着済/欠航）・ターミナル・ゲート・予定時刻・実際時刻・遅延（分）
- **Graceful degradation**: `FLIGHT_API_KEY` 未設定時はフライト時刻なしで、空港へのアクセス経路のみ表示

※ フライト時刻は AviationStack API（`FLIGHT_API_KEY`）が必要。未設定時は空港アクセス経路のみ。

```
search_flight(airport: "羽田空港", direction: "arrival")              # 羽田着フライト一覧
search_flight(airport: "成田空港", direction: "arrival", destination: "東京駅")  # 成田着→東京駅へのアクセス経路付き
search_flight(flight_number: "NH001", direction: "arrival")          # 便名指定
```
### 8. `list_transit_operators` — 交通事業者一覧

```
list_transit_operators(language: "ja", type_filter: "all")
```

### 9. `get_operator_routes` — 事業者別路線一覧

```
get_operator_routes(operator_name: "yurikamome")
```

### 10. `list_ferry_ports` — フェリー/水上バス港一覧

```
list_ferry_ports(language: "ja")
```

### 10. `search_ferry` — フェリー/水上バス航路検索

```
search_ferry(from_port: "東京", to_port: "大島")
```

---

## 🚨 障害シミュレーション（-testモード）

開発時や動作検証時に実際の悪天候や交通障害を想定したテストが行えるよう、擬似的な障害を発生させるテストモードを用意しています。`search_route` に `-test` フラグを付けると実際の外部APIを呼ばずにシミュレーションできます。日本語・英語・中国語のキーワード入力に対応しています。

**例**:
```
浅草から渋谷までの経路を調べて -test 地震
Check route from Asakusa to Shibuya -test typhoon
查询从浅草到涩谷的路线 -test 台风
```

| 日本語 | English | 中文 | シミュレーション内容 |
|:---|:---|:---|---|
| `台風` | `typhoon` | `台风` / `颱風` | 台風接近・特別警報・運転見合わせ |
| `地震` | `earthquake` | `地震` | 地震による一時運行停止 |
| `浸水` | `flood` | `积水` / `淹水` / `浸水` | 駅周辺浸水・運転見合わせ |
| `人身事故` | `accident` | `人身事故` / `人员伤亡` | 人身事故による運転見合わせ |
| `火災` | `fire` | `火灾` / `火災` | 火災による運行停止 |
| `車両故障` | `vehicle_failure` | `车辆故障` / `車輛故障` | 車両故障による運転見合わせ |
| `停電` | `blackout` / `power_outage` | `停电` / `停電` | 停電による列車停止 |
| `信号故障` | `signal_failure` | `信号故障` / `信號故障` | 信号故障による運行停止 |
| `猛暑` | `heatwave` / `extreme_heat` | `酷暑` / `高温` | 熱中症注意 |
| `熱中症` | `heatstroke` | `中暑` | 熱中症警戒アラート |
| `降雪` | `snow` / `snowfall` | `降雪` / `积雪` | 積雪による運行遅延・駅構内滑り注意 |
| `豪雨` | `heavy_rain` | `暴雨` / `豪雨` | 大雨による視界不良・浸水注意報 |

---

## 🛡 エラーハンドリング

ネットワーク障害や外部APIのタイムアウトが発生した場合でも、LLMが迅速・適切にフォールバック処理や理由説明を行えるよう、全エラーは構造化された統一JSON形式で出力されます：

```json
{
  "status": "ERROR",
  "error_type": "NETWORK_ERROR",
  "error_code": 502,
  "retryable": false,
  "suggestions": ["Yahoo!路線情報の直接検索をご利用ください。"],
  "fallback_url": "https://transit.yahoo.co.jp/..."
}
```

| エラー種別 | HTTP相当 | リトライ可能 |
|:---|---|:---:|
| `API_TIMEOUT` | 408 | ✅ |
| `CIRCUIT_BREAKER_OPEN` | 503 | ✅ |
| `NETWORK_ERROR` | 502 | ❌ |
| `PARSE_ERROR` | 422 | ❌ |
| `INVALID_INPUT` | 400 | ❌ |

---

## 🔄 システム構成

MCPクライアントからのコンテキストリクエストを受け取り、各種オープンデータ・API（ODPT/気象庁/GBFS/GTFS）へ安全かつ高速にアクセスするアーキテクチャの概要です。

```
┌─────────────────────────────────────────┐
│           MCP Client                    │
│  (Claude Desktop / Hermes / etc.)      │
└──────────────────┬──────────────────────┘
                   │ stdio
┌──────────────────▼──────────────────────┐
│       Tokyo Transit MCP Server         │
│────────────────────────────────────────┤
│  search_route   get_weather            │
│  search_fare    get_timetable          │
│  search_bus     list_transit_operators  │
│  get_operator_routes                   │
│  list_ferry_ports  search_ferry        │
│────────────────────────────────────────┤
│  🛡 Circuit Breaker  📦 Cache Layer   │
│  🌐 Multilingual       🚲 GBFS Client │
└───┬────────┬────────┬────────┬─────────┘
    │        │        │        │
    ▼        ▼        ▼        ▼
 ODPT      JMA     GBFS     GTFS
  API      API     API     (Ferry)
```

---

## 📊 キャッシュ戦略

外部APIへの不要なリクエストを削減し、応答速度の向上とアクセス制限の回避を実現するため、データ特性に応じた適切なTTL（有効期限）を設定しています。

| データ | TTL | 理由 |
|:---|---:|:---|
| 天気情報 | 10分 | JMA更新頻度に準拠 |
| バス情報 | 10分 | 実データは静的 |
| シェアサイクル | 30秒 | リアルタイム情報 |
| 時刻表 | 1時間 | 静的データ |
| 運賃 | 24時間 | 変更レア |
| フェリーGTFS | 1時間 | 静的データ（ODPT GTFS取得不可時は内蔵ポートリストでフォールバック） |

---

## 🔐 必要な環境変数

本サーバーの主要機能であるODPT（公共交通オープンデータセンター）連携を行うには、以下の環境変数の設定が必要です。

| 変数 | 必須 | 説明 |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | https://developer.odpt.org/ から取得 |
| `FLIGHT_API_KEY` | ⚪ | フライト時刻取得用（AviationStack）。未設定時は空港アクセス経路のみ（graceful degradation） |

---

## 🏗 プロジェクト構成

本プロジェクトのディレクトリ構造および主要なファイルの構成です。

```
tokyo-transit-mcp/
├── src/
│   └── index.mjs       # メインサーバー（全ロジック）
├── package.json
├── README.md
└── .env                # APIキー（gitignore推奨）
```

---

## ⚠️ ライセンス

MIT License

---

## 🙏 謝辞

- [公共交通オープンデータセンター（ODPT）](https://www.odpt.org/)
- [気象庁 API](https://www.jma.go.jp/jma/index.html)
- [ドコモ・バイクシェア GBFS](https://docomo-cycle.jp/)

---

<a id="english"></a>
# 🚃 Tokyo Transit MCP Server (English)

**Integrated Tokyo Metropolitan Area Public Transit Information MCP Server powered by ODPT API + Japan Meteorological Agency API**

Cross-searches trains, monorails, AGT (Yurikamome, etc.), trams, water buses, ferries, and bike-sharing services. Provides AI Intelligent Advice in multiple languages (Japanese, English, Chinese) considering weather and operational status.

---

## ✨ Features

This server goes beyond simple route searching by integrating weather data and various public transit open data (ODPT/GBFS/GTFS) to deliver real-time AI transit advice. Key features include:

### 🚉 Integrated Transit Agencies
| Type | Supported Operators |
|:---|:---|
| 🚃 Railways | JR East, Tokyo Metro, Toei Subway, Odakyu, Keio, Seibu, Tobu, Keikyu, Keisei, Sotetsu, Tokyu, Yokohama Municipal, **Tsukuba Express (MIR)**, **Rinkai Line (TWR)**, **Minatomirai Line**, **Hakone Tozan Railway**, Hokuso, Saitama Railway, Toyo Rapid, Shibayama Railway, JR Central |
| 🚡 AGT | Yurikamome, Nippori-Toneri Liner |
| 🚝 Monorails | Tokyo Monorail, Tama Monorail |
| 🚋 Trams | Toden Arakawa Line (Tokyo Sakura Tram) |
| 🚢 Ferries | Tokai Kisen (Izu Islands & Ogasawara routes) — falls back to built-in port list (19 ports) when ODPT GTFS is unavailable |
| 🚤 Water Buses | Tokyo Cruise (Asakusa - Odaiba - Toyosu) |
| 🚲 Bike Sharing | Docomo Bike Share (GBFS API, 1,878 ports) |

### 🤖 AI Intelligent Advice
- **☀ Sunny**: Supports comfortable transit & walking.
- **☔ Rainy**: Alerts for slippery station platforms and recommends bus alternatives.
- **🌡 High Temperature**: Heatstroke warnings and hydration reminders.
- **🚨 Emergency**: Automatically displays shelter/evacuation links during service suspensions or disasters.

### 🛡 Safety & Fault Tolerance
- **Circuit Breaker**: 3 consecutive failures → 60s cooldown (exponential backoff).
- **Unified Cache Management**: Reduces API load by up to 80% (up to 24h caching).
- **Degraded Mode**: Continues partial operation even during API disruptions.
- **Severe Weather Logic**: Automatically hides bike guidance during typhoons or flooding.
- **LLM-Friendly JSON**: Outputs all errors in structured JSON.

### 💬 Easy Search in Natural Language
Station, bus stop, and port names are **automatically resolved by partial match, notation variance, and legacy names**, so exact input is not required. You can simply pass natural expressions in Japanese, English, or Chinese — such as "route from Skytree to Telecom Center", "Odaiba to Toyosu", or "bus to Tokyo Big Sight" — and the server will search routes, buses, and ferries directly.

**Search examples**:
```
route from Skytree to Telecom Center
Shibuya to Odaiba route
查询从浅草到台场的路线
bus stop near Tokyo Big Sight
ferry to Oshima from Tokyo
```

> ⚠️ **Note**: This server displays responses through an LLM model on the MCP client (Claude Desktop / Hermes, etc.). Depending on the model, **minor display variance (differences in wording, whether advice is omitted, etc.) may occur** for the AI Intelligent Advice and search results. The search engine's own JSON output is model-independent and consistent, but the final phrasing depends on the model in use.

### 🌐 Multi-Language Support
Automatically detects Japanese, English, and Chinese and **localizes the entire response to match the input language** — not only AI advice, but also route station/line names, weather text, and error messages (e.g. `Odaiba -> Haneda` returns English, `台场到羽田机场` returns Chinese, `お台場→羽田空港` returns Japanese). English inputs containing symbols (arrows, slashes, parentheses) and inputs containing simplified Chinese characters or Chinese function words (到 / 从 / 前往 / 出发, etc.) are detected reliably.

### 🔧 Test Mode (-test)
Add `-test <disruption_type>` to `search_route` to simulate over 20 types of transport disruptions.

---

## 📦 Setup

Follow the steps below to clone the repository, install dependencies, and add the configuration to your MCP client (such as Claude Desktop or Hermes).

```bash
# Clone the repository
git clone https://github.com/loosephoto/tokyo-transit-mcp.git
cd tokyo-transit-mcp

# Install dependencies
npm install

# Set your ODPT API key (Get one from https://developer.odpt.org/)
echo 'ODPT_API_KEY=your_api_key_here' > .env
# Only if using flight times: set AviationStack API key (optional)
echo 'FLIGHT_API_KEY=your_flight_api_key_here' >> .env
```

### MCP Client Configuration Example (Claude Desktop / Hermes, etc.)

```json
{
  "mcpServers": {
    "tokyo-transit": {
      "command": "node",
      "args": ["/path/to/tokyo-transit-mcp/src/index.mjs"],
      "env": {
        "ODPT_API_KEY": "your_api_key_here",
        "FLIGHT_API_KEY": "your_flight_api_key_here"
      }
    }
  }
}
```

---

## 🛠 Available Tools

This MCP server provides 10 tools to handle route searches, timetables, fares, weather, and ferry route requests.

### 1. `search_route` — Route Search (Main Feature)
**Function**: Search route from departure to arrival station. Automatically fetches weather and transit status with AI advice. The entire response (station/line names, weather, errors) is auto-localized to the input language (ja/en/zh).

```
search_route(from: "Shibuya", to: "Shinjuku")
```

**Parameters**:
- `from` (string) — Departure station name
- `to` (string) — Arrival station name
- `user_location` (object, optional) — User's current location `{ lat: number, lon: number }`. When provided, bike-share guidance during service suspensions is based on the current location (otherwise based on the departure station)

**Response Example**:
```json
{
  "status": "SUCCESS",
  "from": "Shibuya",
  "to": "Shinjuku",
  "weather_text": "Tokyo Area: Sunny",
  "direct_search_url": "https://transit.yahoo.co.jp/...",
  "ai_transit_advice": "☀ 【AI Intelligent Advice】\nIt's nice and sunny!...",
  "gov_facility_search_support": { "...": "..." },
  "station_bus_stops": { "...": "..." },
  "fare_available": true,
  "non_rail_transit_support": { "...": "..." }
}
```

**Test Mode**:
```
search_route(from: "Tokyo -test typhoon", to: "Shinjuku")
search_route(from: "Shinjuku -test earthquake", to: "Shibuya")
```

### 2. `get_station_info` — Station Info
```
get_station_info(station_name: "Shibuya", operator: "tokyometro")
```

### 3. `get_weather` — Weather Info
```
get_weather(area_name: "Tokyo")
```

### 4. `search_fare` — Fare Search
```
search_fare(from: "Shibuya", to: "Shinjuku")
```

### 5. `get_timetable` — Timetable Search
```
get_timetable(station_name: "Shibuya", railway: "Yamanote Line")
```

### 6. `search_bus` — Bus Route & Transfer Search (Toei / Seibu / Yokohama City + JR Bus Kanto / Community Bus)

Searches Toei Bus, Seibu Bus, and Yokohama City Bus (Yokohama Municipal) merged in parallel from ODPT `odpt:Bus`, plus a **GTFS-JP individual-feed path** that adds JR Bus Kanto and Tokyo community buses (Chii-bus, Hachiko-bus, etc.).

- **Stop search**: `busstop_name` to find stops / routes
- **Transfer search**: `from` + `to` builds shortest transfer routes from `odpt:BusroutePattern` stop order (Plan B: cross-route / cross-operator transfers)
- **Cross-modal transfer**: bus stops and stations are linked by geo-coordinates and merged with the `odpt:Station` (train) graph, enabling bus→train→bus routes (e.g. Shibuya Station →(walk)→ Shibuya →(train)→ Shimbashi Station)
- **Barrier-free**: `odpt:BusTimetable.isNonStepBus` (step-free / non-step buses) shown per route

Note: transfers cover Toei/Seibu/Yokohama City Bus only (JR Bus Kanto & community buses lack stop-order data, so excluded). Fares are not available via ODPT.

```
search_bus(busstop_name: "Shibuya Station")
search_bus(from: "Shibuya Station", to: "Shimbashi Station")   # bus→train→bus cross-modal
search_bus(from: "Yokohama Station", to: "Kawasaki Station")    # Yokohama→(train)→Kawasaki cross-modal
```


### 7. `search_flight` — Airport Flight Times & Arrival Display ✈️

- **Airport search**: `airport` (Haneda/Narita/HND/NRT etc.) lists arrival/departure flights
- **Airport name normalization**: "Haneda"/"Narita"/"羽田"/"成田" etc. auto-normalized (trailing "Airport/空港/机场" stripped, ja/en/zh supported).
- **Flight number search**: `flight_number` (NH001/JL000 etc.) for a specific flight
- **Best for inbound/return travel**: specify `destination` (e.g. Tokyo Station) to auto-suggest the access route (train) from the arrival terminal. **Ideal for overseas guests & homecoming**
  - Without `destination`, arrival searches auto-show routes to major access stations (Haneda: Tokyo Stn/品川/Hamamatsucho, Narita: Tokyo Stn/Nippori/Shinjuku) via `access_routes`.
- **Fields**: flight no., airline, status (scheduled/active/landed/cancelled), terminal, gate, scheduled/actual time, delay (min)
- **Graceful degradation**: without `FLIGHT_API_KEY`, shows airport access route only (no flight times)

Note: flight times require AviationStack API (`FLIGHT_API_KEY`). Without it, only airport access routes are shown.

```
search_flight(airport: "Haneda Airport", direction: "arrival")                    # Haneda arrivals
search_flight(airport: "Narita Airport", direction: "arrival", destination: "Tokyo Station")  # Narita→Tokyo access route
search_flight(flight_number: "NH001", direction: "arrival")                       # by flight no.
```
### 8. `list_transit_operators` — Transit Operators List
```
list_transit_operators(language: "en", type_filter: "all")
```

### 9. `get_operator_routes` — Routes by Operator
```
get_operator_routes(operator_name: "yurikamome")
```

### 10. `list_ferry_ports` — Ferry / Water Bus Ports List
```
list_ferry_ports(language: "en")
```

### 10. `search_ferry` — Ferry / Water Bus Route Search
```
search_ferry(from_port: "Tokyo", to_port: "Oshima")
```

---

## 🚨 Disruption Simulation (-test mode)

To test system behavior under severe weather or transit disruptions during development, you can use simulated test mode. Appending `-test` flags in `search_route` triggers mock responses without calling real APIs. Supports multilingual keywords (English, Japanese, Chinese).

**Example**:
```
Check route from Asakusa to Shibuya -test typhoon
Check route from Asakusa to Shibuya -test earthquake
```

| English | Japanese | Chinese | Simulation Details |
|:---|:---|:---|---|
| `typhoon` | `台風` | `台风` / `颱風` | Typhoon approaching, emergency warning, service suspended |
| `earthquake` | `地震` | `地震` | Earthquake service suspension |
| `flood` | `浸水` | `积水` / `淹水` / `浸水` | Station area flooding, service suspended |
| `accident` | `人身事故` | `人身事故` / `人员伤亡` | Personal accident delay / service suspended |
| `fire` | `火災` | `火灾` / `火災` | Fire incident service suspended |
| `vehicle_failure` | `車両故障` | `车辆故障` / `車輛故障` | Train vehicle failure, service suspended |
| `blackout` / `power_outage` | `停電` | `停电` / `停電` | Power outage train stoppage |
| `signal_failure` | `信号故障` | `信号故障` / `信號故障` | Signal failure service suspended |
| `heatwave` / `extreme_heat` | `猛暑` | `酷暑` / `高温` | Extreme heat / heatstroke warning |
| `heatstroke` | `熱中症` | `中暑` | Heatstroke alert |
| `snow` / `snowfall` | `降雪` | `降雪` / `积雪` | Snowfall delays & slippery platform warnings |
| `heavy_rain` | `豪雨` | `暴雨` / `豪雨` | Heavy rain / flood advisory |

---

## 🛡 Error Handling

All errors are returned in a unified JSON format for LLM parsing and graceful fallback processing:

```json
{
  "status": "ERROR",
  "error_type": "NETWORK_ERROR",
  "error_code": 502,
  "retryable": false,
  "suggestions": ["Please search directly on Yahoo! Transit."],
  "fallback_url": "https://transit.yahoo.co.jp/..."
}
```

| Error Type | Equivalent HTTP | Retryable |
|:---|---|:---:|
| `API_TIMEOUT` | 408 | ✅ |
| `CIRCUIT_BREAKER_OPEN` | 503 | ✅ |
| `NETWORK_ERROR` | 502 | ❌ |
| `PARSE_ERROR` | 422 | ❌ |
| `INVALID_INPUT` | 400 | ❌ |

---

## 🔄 System Architecture

Architecture overview showing context requests from MCP Clients routed to open APIs (ODPT/JMA/GBFS/GTFS) safely and efficiently.

```
┌─────────────────────────────────────────┐
│           MCP Client                    │
│  (Claude Desktop / Hermes / etc.)      │
└──────────────────┬──────────────────────┘
                   │ stdio
┌──────────────────▼──────────────────────┐
│       Tokyo Transit MCP Server         │
│────────────────────────────────────────┤
│  search_route   get_weather            │
│  search_fare    get_timetable          │
│  search_bus     list_transit_operators  │
│  get_operator_routes                   │
│  list_ferry_ports  search_ferry        │
│────────────────────────────────────────┤
│  🛡 Circuit Breaker  📦 Cache Layer   │
│  🌐 Multilingual       🚲 GBFS Client │
└───┬────────┬────────┬────────┬─────────┘
    │        │        │        │
    ▼        ▼        ▼        ▼
 ODPT      JMA     GBFS     GTFS
  API      API     API     (Ferry)
```

---

## 📊 Caching Strategy

Appropriate TTLs (Time To Live) are configured according to data update frequencies to reduce unnecessary API calls and ensure high performance.

| Data | TTL | Reason |
|:---|---:|:---|
| Weather Info | 10 mins | Based on JMA update frequency |
| Bus Info | 10 mins | Static real data |
| Bike Share | 30 secs | Real-time availability |
| Timetables | 1 hour | Static schedule data |
| Fares | 24 hours | Rarely changes |
| Ferry GTFS | 1 hour | Static schedule data (falls back to built-in port list when ODPT GTFS is unavailable) |

---

## 🔐 Required Environment Variables

Setting the following environment variable is required to integrate with ODPT (Open Data Center for Public Transportation).

| Variable | Required | Description |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | Obtained from https://developer.odpt.org/ |
| `FLIGHT_API_KEY` | ⚪ | For flight times (AviationStack). Without it, only airport access routes are shown (graceful degradation) |

---

## 🏗 Project Structure

Directory layout and key files of this project.

```
tokyo-transit-mcp/
├── src/
│   └── index.mjs       # Main server script
├── package.json
├── README.md
└── .env                # API Keys
```

---

## ⚠️ License

MIT License

---

## 🙏 Acknowledgments

- [Open Data Center for Public Transportation (ODPT)](https://www.odpt.org/)
- [Japan Meteorological Agency (JMA) API](https://www.jma.go.jp/jma/index.html)
- [Docomo Bike Share GBFS](https://docomo-cycle.jp/)

---

<a id="chinese"></a>
# 🚃 Tokyo Transit MCP Server (中文)

**整合 ODPT API + 日本气象厅 API 的东京圈综合交通信息 MCP 服务器**

支持跨交通工具查询铁路、单轨铁路、AGT（百合海鸥号等）、有轨电车、水上巴士、轮渡及共享单车。结合天气与运行状况，提供多语言（日语/英语/中文）的 AI 智能出行建议。

---

## ✨ 特性

本服务器不仅提供简单的路线搜索，更整合了气象数据与各类公共交通开放数据（ODPT/GBFS/GTFS），由 AI 提供精细的实时出行建议。主要特性如下：

### 🚉 整合所有公共交通工具
| 类别 | 支持的运营商 |
|:---|:---|
| 🚃 铁路 | JR东日本、东京地下铁（Tokyo Metro）、都营地下铁、小田急、京王、西武、东武、京急、京成、相铁、东急、横滨市营、**筑波快线 (MIR)**、**临海线 (TWR)**、**港区未来线**、**箱根登山电车**、北总、埼玉高速、东叶高速、芝山铁道、JR东海 |
| 🚡 AGT | 百合海鸥号（Yurikamome）、日暮里-舍人线 |
| 🚝 单轨铁路 | 东京单轨电车、多摩单轨电车 |
| 🚋 有轨电车 | 都电荒川线（东京樱花路面电车） |
| 🚢 轮渡 | 东海汽船（伊豆群岛、小笠原航线）※ODPT GTFS 不可用时回退至内置港口列表（19港） |
| 🚤 水上巴士 | 东京观光汽船（浅草〜台场〜丰洲） |
| 🚲 共享单车 | Docomo Bike Share（GBFS API，1,878个站点） |

### 🤖 AI 智能建议
- **☀ 晴天**: 提供舒适出行与步行建议。
- **☔ 雨天**: 提醒车站内防滑，推荐公交车替代出行。
- **🌡 高温**: 高温预警及补充水分提醒。
- **🚨 紧急**: 停运或发生灾害时自动显示避难所链接。

### 🛡 安全与容错机制
- **熔断器 (Circuit Breaker)**: 连续 3 次失败 → 60 秒冷却（指数退避）。
- **统一缓存管理**: 降低外部 API 负载高达 80%（最长 24 小时缓存）。
- **降级模式**: 外部 API 发生故障时仍保持部分功能可用。
- **恶劣天气安全逻辑**: 台风或积水时自动隐藏共享单车引导。
- **LLM 友好型 JSON**: 所有错误均以结构化 JSON 格式输出。

### 💬 自然语言轻松搜索
车站名、公交站名、港口名均支持**部分匹配、表记差异及旧名自动解析**，无需精确输入即可直观搜索。只需直接传入日语、英语或中文的自然表达，例如「从晴空塔到电信中心」「Odaiba 到 Toyosu」「到东京国际展览中心的巴士」，服务器即可直接检索路线、公交与轮渡。

**搜索示例**:
```
从晴空塔到电信中心的路线
Shibuya to Odaiba route
查询从浅草到台场的路线
东京国际展览中心附近的巴士站
从东京前往大岛的渡轮
```

> ⚠️ **注意**: 本服务器通过 MCP 客户端（Claude Desktop / Hermes 等）上的 LLM 模型显示回答。因模型不同，AI 智能建议与搜索结果的**显示可能存在细微差异（措辞不同、是否省略建议等）**。搜索引擎自身的 JSON 输出与模型无关且保持一致，但最终表述取决于所使用的模型。

### 🌐 多语言支持
自动识别日语、英语和中文，**并按照输入语言本地化整个响应**——不仅是 AI 建议，路线中的站名、线路名、天气文本和错误消息也会以用户的语言返回（例如：`Odaiba -> Haneda` 返回英语，`台场到羽田机场` 返回中文，`お台場→羽田空港` 返回日语）。包含符号（箭头、斜杠、括号）的英语输入，以及包含简体字或中文功能词（到・从・前往・出发 等）的输入均可准确识别。

### 🔧 测试模式 (-test)
在 `search_route` 中加入 `-test <故障类型>` 即可模拟 20 多种交通中断或灾害场景。

---

## 📦 安装与设置

请按照以下步骤克隆代码库、安装依赖项，并将配置添加到您的 MCP 客户端（如 Claude Desktop 或 Hermes）。

```bash
# 克隆代码库
git clone https://github.com/loosephoto/tokyo-transit-mcp.git
cd tokyo-transit-mcp

# 安装依赖
npm install

# 设置 ODPT API 密钥（可从 https://developer.odpt.org/ 获取）
echo 'ODPT_API_KEY=your_api_key_here' > .env
# 仅在需要航班时刻时设置（AviationStack API 密钥・可选）
echo 'FLIGHT_API_KEY=your_flight_api_key_here' >> .env
```

### MCP 客户端配置示例（Claude Desktop / Hermes 等）

```json
{
  "mcpServers": {
    "tokyo-transit": {
      "command": "node",
      "args": ["/path/to/tokyo-transit-mcp/src/index.mjs"],
      "env": {
        "ODPT_API_KEY": "your_api_key_here",
        "FLIGHT_API_KEY": "your_flight_api_key_here"
      }
    }
  }
}
```

---

## 🛠 可用工具

本 MCP 服务器共提供 10 个工具，涵盖路线搜索、时刻表、票价、天气及轮渡航线查询。

### 1. `search_route` — 换乘路线搜索（核心功能）
**功能**: 查询出发站至到达站的路线，自动获取天气与运行状态并附带 AI 出行建议。整个响应（站名、线路名、天气、错误消息）将按输入语言（日/英/中）自动本地化。

```
search_route(from: "渋谷", to: "新宿")
```

**参数**:
- `from` (string) — 出发车站名称
- `to` (string) — 到达车站名称
- `user_location` (object, 可选) — 用户当前位置 `{ lat: number, lon: number }`。指定时，运行中断期间的共享自行车指引以当前位置为基准（未指定时以出发站为基准）

**响应示例**:
```json
{
  "status": "SUCCESS",
  "from": "渋谷",
  "to": "新宿",
  "weather_text": "东京地区: 晴",
  "direct_search_url": "https://transit.yahoo.co.jp/...",
  "ai_transit_advice": "☀ 【AI 智能建议】\n天气晴朗！...",
  "gov_facility_search_support": { "...": "..." },
  "station_bus_stops": { "...": "..." },
  "fare_available": true,
  "non_rail_transit_support": { "...": "..." }
}
```

**测试模式**:
```
search_route(from: "东京 -test 人身事故", to: "新宿")
search_route(from: "新宿 -test 台风", to: "涩谷")
search_route(from: "浅草 -test 积水", to: "涩谷")
```

### 2. `get_station_info` — 获取车站信息
```
get_station_info(station_name: "渋谷", operator: "tokyometro")
```

### 3. `get_weather` — 获取天气信息
```
get_weather(area_name: "東京")
```

### 4. `search_fare` — 票价查询
```
search_fare(from: "渋谷", to: "新宿")
```

### 5. `get_timetable` — 时刻表查询
```
get_timetable(station_name: "渋谷", railway: "山手線")
```

### 6. `search_bus` — 公交路线与换乘查询（都营/西武/横滨市营 + JR巴士关东/社区公交）

从 ODPT 的 `odpt:Bus` 并行获取并合并都营公交、西武公交、横滨市交通局（横滨市营公交）3 家运营商的数据，并通过 **GTFS-JP 单独数据源路径** 追加 JR 巴士关东和东京社区公交（ちぃばす、ハチ公バス等）。

- **公交站查询**: `busstop_name` 搜索公交站/线路
- **换乘搜索**: `from` + `to` 基于 `odpt:BusroutePattern` 的站点顺序构建最短换乘路线（方案B: 跨线路/跨运营商换乘）
- **跨方式换乘**: 公交站与车站通过经纬度关联，并与 `odpt:Station`（铁路）图合并，支持公交→电车→公交路线（例: 渋谷站前→(步行)→渋谷→(电车)→新桥站前）
- **无障碍**: `odpt:BusTimetable.isNonStepBus`（无障碍低地板/无台阶巴士）按线路显示

注: 换乘仅覆盖都营/西武/横滨市营公交（JR巴士关东与社区公交无站点顺序数据，故不包含）。ODPT 不提供公交票价数据。

```
search_bus(busstop_name: "渋谷駅前")                      # 公交站查询
search_bus(from: "渋谷駅前", to: "新橋駅前")            # 公交→电车→公交 跨方式换乘
search_bus(from: "横浜駅前", to: "川崎駅前")            # 横滨→(电车)→川崎 跨方式换乘
```


### 7. `search_flight` — 机场航班时刻与到达时间显示 ✈️

- **机场查询**: `airport`（羽田/成田/HND/NRT 等）列出到达/出发航班
- **机场名称规范化**: "羽田"/"成田"/"Haneda"/"Narita" 等自动归一化（去除末尾"机场/Airport/空港"，支持日英中）。
- **航班号查询**: `flight_number`（NH001/JL000 等）查询特定航班
- **海外来客/归国最佳**: 指定 `destination`（如：东京站）自动建议从到达航站楼到目的地的接驳路线（电车）。**最适合海外来宾与归乡**
  - 未指定 `destination` 时，到达搜索自动显示至主要接驳车站的路线（羽田: 东京站/品川/浜松町，成田: 东京站/日暮里/新宿），通过 `access_routes`。
- **显示项**: 航班号、航空公司、状态（准点/飞行中/已到达/取消）、航站楼、登机口、计划时间、实际时间、延误（分钟）
- **优雅降级**: 未配置 `FLIGHT_API_KEY` 时仅显示机场接驳路线（无航班时刻）

注: 航班时刻需要 AviationStack API（`FLIGHT_API_KEY`）。未配置时仅显示机场接驳路线。

```
search_flight(airport: "羽田空港", direction: "arrival")                        # 羽田到达航班
search_flight(airport: "成田空港", direction: "arrival", destination: "東京駅")  # 成田→东京接驳路线
search_flight(flight_number: "NH001", direction: "arrival")                    # 按航班号查询
```
### 8. `list_transit_operators` — 交通运营商列表
```
list_transit_operators(language: "zh", type_filter: "all")
```

### 9. `get_operator_routes` — 按运营商列出路线
```
get_operator_routes(operator_name: "yurikamome")
```

### 10. `list_ferry_ports` — 轮渡/水上巴士港口列表
```
list_ferry_ports(language: "zh")
```

### 10. `search_ferry` — 轮渡/水上巴士航线搜索
```
search_ferry(from_port: "東京", to_port: "大島")
```

---

## 🚨 故障模拟（-test 模式）

为了在开发和验证过程中模拟恶劣天气或交通中断，可使用测试模式。在 `search_route` 中指定 `-test` 标记即可触发模拟响应，无需调用实际 API。支持中文、英文、日文多语言关键字。

**示例**:
```
查询从浅草到涩谷的路线 -test 台风
查询从浅草到涩谷的路线 -test 地震
```

| 中文 | English | 日文 | 模拟内容 |
|:---|:---|:---|---|
| `台风` / `颱風` | `typhoon` | `台風` | 台风接近、特别警报、暂停运营 |
| `地震` | `earthquake` | `地震` | 地震导致临时暂停运营 |
| `积水` / `淹水` / `浸水` | `flood` | `浸水` | 车站周边积水、暂停运营 |
| `人身事故` / `人员伤亡` | `accident` | `人身事故` | 人身事故导致暂停运营 |
| `火灾` / `火災` | `fire` | `火災` | 火灾导致暂停运营 |
| `车辆故障` / `車輛故障` | `vehicle_failure` | `車両故障` | 车辆故障导致暂停运营 |
| `停电` / `停電` | `power_outage` / `blackout` | `停電` | 停电导致列车停运 |
| `信号故障` / `信號故障` | `signal_failure` | `信号故障` | 信号故障导致暂停运营 |
| `酷暑` / `高温` | `heatwave` | `猛暑` | 酷暑预警 |
| `中暑` | `heatstroke` | `熱中症` | 防暑降温预警 |
| `降雪` / `积雪` | `snow` | `降雪` | 积雪导致晚点及车站防滑提醒 |
| `暴雨` / `豪雨` | `heavy_rain` | `豪雨` | 大雨导致视线不良及积水预警 |

---

## 🛡 错误处理

所有错误均统一输出为结构化 JSON 格式，方便 LLM 进行解析与降级处理：

```json
{
  "status": "ERROR",
  "error_type": "NETWORK_ERROR",
  "error_code": 502,
  "retryable": false,
  "suggestions": ["请直接访问 Yahoo! 路线情报进行搜索。"],
  "fallback_url": "https://transit.yahoo.co.jp/..."
}
```

| 错误类型 | 对应 HTTP 状态 | 可重试 |
|:---|---|:---:|
| `API_TIMEOUT` | 408 | ✅ |
| `CIRCUIT_BREAKER_OPEN` | 503 | ✅ |
| `NETWORK_ERROR` | 502 | ❌ |
| `PARSE_ERROR` | 422 | ❌ |
| `INVALID_INPUT` | 400 | ❌ |

---

## 🔄 系统架构

MCP 客户端的请求通过 stdio 传递给服务器，服务器安全高效地整合 ODPT、气象厅、GBFS 及 GTFS 等接口。

```
┌─────────────────────────────────────────┐
│           MCP Client                    │
│  (Claude Desktop / Hermes / etc.)      │
└──────────────────┬──────────────────────┘
                   │ stdio
┌──────────────────▼──────────────────────┐
│       Tokyo Transit MCP Server         │
│────────────────────────────────────────┤
│  search_route   get_weather            │
│  search_fare    get_timetable          │
│  search_bus     list_transit_operators  │
│  get_operator_routes                   │
│  list_ferry_ports  search_ferry        │
│────────────────────────────────────────┤
│  🛡 Circuit Breaker  📦 Cache Layer   │
│  🌐 Multilingual       🚲 GBFS Client │
└───┬────────┬────────┬────────┬─────────┘
    │        │        │        │
    ▼        ▼        ▼        ▼
 ODPT      JMA     GBFS     GTFS
  API      API     API     (Ferry)
```

---

## 📊 缓存策略

根据数据更新频率设置合理的 TTL（生存时间），以减少不必要的 API 请求，提高响应速度：

| 数据 | TTL | 原因 |
|:---|---:|:---|
| 天气信息 | 10分钟 | 匹配日本气象厅更新频率 |
| 公交信息 | 10分钟 | 实际数据相对静态 |
| 共享单车 | 30秒 | 实时车辆可用性 |
| 时刻表 | 1小时 | 静态运行计划 |
| 票价 | 24小时 | 极少变动 |
| 轮渡 GTFS | 1小时 | 静态运行计划（ODPT GTFS 不可用时回退至内置港口列表） |

---

## 🔐 必需的环境变量

进行 ODPT（公共交通开放数据中心）集成需要设置以下环境变量。

| 变量 | 必需 | 说明 |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | 可从 https://developer.odpt.org/ 获取 |
| `FLIGHT_API_KEY` | ⚪ | 航班时刻获取用（AviationStack）。未配置时仅显示机场接驳路线（优雅降级） |

---

## 🏗 项目结构

本项目的目录结构及主要文件：

```
tokyo-transit-mcp/
├── src/
│   └── index.mjs       # 主服务器文件
├── package.json
├── README.md
└── .env                # API 密钥
```

---

## ⚠️ 许可证

MIT License

---

## 🙏 致谢

- [公共交通开放数据中心 (ODPT)](https://www.odpt.org/)
- [日本气象厅 API](https://www.jma.go.jp/jma/index.html)
- [Docomo Bike Share GBFS](https://docomo-cycle.jp/)
