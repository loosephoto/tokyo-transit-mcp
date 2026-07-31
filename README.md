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
| 🚡 AGT | ゆりかもめ・日暮里・舎人ライナー |
| 🚝 モノレール | 東京モノレール・多摩モノレール |
| 🚋 路面電車 | 都電荒川線（東京さくらトラム） |
| 🚢 フェリー | 東海汽船（伊豆諸島・小笠原航路） |
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

### 🌐 マルチランゲージ
日本語・英語・中国語を自動判定。ユーザーの入力言語に合わせてアドバイスを切り替え。

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
```

### MCP クライアント設定例（Claude Desktop / Hermes 等）

```json
{
  "mcpServers": {
    "tokyo-transit": {
      "command": "node",
      "args": ["/path/to/tokyo-transit-mcp/src/index.mjs"],
      "env": {
        "ODPT_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## 🛠 使用可能ツール

本MCPサーバーでは、ルート検索、時刻表・運賃情報の取得、運行状況・気象・フェリー航路の検索など、多角的な交通リクエストに対応する全10種類のツールを提供しています。

### 1. `search_route` — 乗り換えルート検索（メイン機能）

**機能**: 出発駅→到着駅のルートを検索。天気・運行情報を自動取得しAIアドバイスを付加。

```
search_route(from: "渋谷", to: "新宿")
```

**パラメータ**:
- `from` (string) — 出発駅名
- `to` (string) — 到着駅名

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
search_route(from: "浅草 -test 浸水", to: "渋谷")
search_route(from: "東京 -test 猛暑", to: "新宿")
search_route(from: "東京 -test 降雪", to: "新宿")
search_route(from: "東京 -test 豪雨", to: "新宿")
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

### 6. `search_bus` — バス路線検索（都営バス）

```
search_bus(busstop_name: "渋谷駅")
```

### 7. `list_transit_operators` — 交通事業者一覧

```
list_transit_operators(language: "ja", type_filter: "all")
```

### 8. `get_operator_routes` — 事業者別路線一覧

```
get_operator_routes(operator_name: "yurikamome")
```

### 9. `list_ferry_ports` — フェリー/水上バス港一覧

```
list_ferry_ports(language: "ja")
```

### 10. `search_ferry` — フェリー/水上バス航路検索

```
search_ferry(from_port: "東京", to_port: "大島")
```

---

## 🚨 障害シミュレーション（-testモード）

開発時や動作検証時に実際の悪天候や交通障害を想定したテストが行えるよう、擬似的な障害を発生させるテストモードを用意しています。`search_route` に `-test` フラグを付けると実際の外部APIを呼ばずにシミュレーションできます。

**例**:
```
浅草から渋谷までの経路を調べて -test 地震
```

| キーワード | シミュレーション内容 |
|:---|---|
| `台風` | 台風接近・特別警報・運転見合わせ |
| `地震` | 地震による一時運行停止 |
| `浸水` | 駅周辺浸水・運転見合わせ |
| `人身事故` | 人身事故による運転見合わせ |
| `火災` | 火災による運行停止 |
| `停電` | 停電による列車停止 |
| `信号故障` | 信号故障による運行停止 |
| `猛暑` | 熱中症注意 |
| `熱中症` | 熱中症警戒アラート |
| `降雪` | 積雪による運行遅延・駅構内滑り注意 |
| `豪雨` | 大雨による視界不良・浸水注意報 |

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
| フェリーGTFS | 1時間 | 静的データ |

---

## 🔐 必要な環境変数

本サーバーの主要機能であるODPT（公共交通オープンデータセンター）連携を行うには、以下の環境変数の設定が必要です。

| 変数 | 必須 | 説明 |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | https://developer.odpt.org/ から取得 |

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
| 🚢 Ferries | Tokai Kisen (Izu Islands & Ogasawara routes) |
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

### 🌐 Multi-Language Support
Automatically detects Japanese, English, and Chinese to switch advice output accordingly.

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
```

### MCP Client Configuration Example (Claude Desktop / Hermes, etc.)

```json
{
  "mcpServers": {
    "tokyo-transit": {
      "command": "node",
      "args": ["/path/to/tokyo-transit-mcp/src/index.mjs"],
      "env": {
        "ODPT_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## 🛠 Available Tools

This MCP server provides 10 tools to handle route searches, timetables, fares, weather, and ferry route requests.

### 1. `search_route` — Route Search (Main Feature)
**Function**: Search route from departure to arrival station. Automatically fetches weather and transit status with AI advice.

```
search_route(from: "Shibuya", to: "Shinjuku")
```

**Parameters**:
- `from` (string) — Departure station name
- `to` (string) — Arrival station name

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
search_route(from: "Tokyo -test 人身事故", to: "Shinjuku")
search_route(from: "Shinjuku -test 台風", to: "Shibuya")
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

### 6. `search_bus` — Bus Route Search (Toei Bus)
```
search_bus(busstop_name: "Shibuya Station")
```

### 7. `list_transit_operators` — Transit Operators List
```
list_transit_operators(language: "en", type_filter: "all")
```

### 8. `get_operator_routes` — Routes by Operator
```
get_operator_routes(operator_name: "yurikamome")
```

### 9. `list_ferry_ports` — Ferry / Water Bus Ports List
```
list_ferry_ports(language: "en")
```

### 10. `search_ferry` — Ferry / Water Bus Route Search
```
search_ferry(from_port: "Tokyo", to_port: "Oshima")
```

---

## 🚨 Disruption Simulation (-test mode)

To test system behavior under severe weather or transit disruptions during development, you can use simulated test mode. Appending `-test` flags in `search_route` triggers mock responses without calling real APIs.

**Example**:
```
Check route from Asakusa to Shibuya -test 地震
```

| Keyword | Simulation Details |
|:---|---|
| `台風` | Typhoon approaching, emergency warning, service suspended |
| `地震` | Earthquake service suspension |
| `浸水` | Station area flooding, service suspended |
| `人身事故` | Personal accident delay / service suspended |
| `火災` | Fire incident service suspended |
| `停電` | Power outage train stoppage |
| `信号故障` | Signal failure service suspended |
| `猛暑` | Extreme heat / heatstroke warning |
| `熱中症` | Heatstroke alert |
| `降雪` | Snowfall delays & slippery platform warnings |
| `豪雨` | Heavy rain / flood advisory |

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
| Ferry GTFS | 1 hour | Static schedule data |

---

## 🔐 Required Environment Variables

Setting the following environment variable is required to integrate with ODPT (Open Data Center for Public Transportation).

| Variable | Required | Description |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | Obtained from https://developer.odpt.org/ |

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
| 🚢 轮渡 | 东海汽船（伊豆群岛、小笠原航线） |
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

### 🌐 多语言支持
自动识别日语、英语和中文，根据用户的输入语言切换输出建议。

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
```

### MCP 客户端配置示例（Claude Desktop / Hermes 等）

```json
{
  "mcpServers": {
    "tokyo-transit": {
      "command": "node",
      "args": ["/path/to/tokyo-transit-mcp/src/index.mjs"],
      "env": {
        "ODPT_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## 🛠 可用工具

本 MCP 服务器共提供 10 个工具，涵盖路线搜索、时刻表、票价、天气及轮渡航线查询。

### 1. `search_route` — 换乘路线搜索（核心功能）
**功能**: 查询出发站至到达站的路线，自动获取天气与运行状态并附带 AI 出行建议。

```
search_route(from: "渋谷", to: "新宿")
```

**参数**:
- `from` (string) — 出发车站名称
- `to` (string) — 到达车站名称

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
search_route(from: "東京 -test 人身事故", to: "新宿")
search_route(from: "新宿 -test 台風", to: "渋谷")
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

### 6. `search_bus` — 公交路线查询（都营公交）
```
search_bus(busstop_name: "渋谷駅")
```

### 7. `list_transit_operators` — 交通运营商列表
```
list_transit_operators(language: "zh", type_filter: "all")
```

### 8. `get_operator_routes` — 按运营商列出路线
```
get_operator_routes(operator_name: "yurikamome")
```

### 9. `list_ferry_ports` — 轮渡/水上巴士港口列表
```
list_ferry_ports(language: "zh")
```

### 10. `search_ferry` — 轮渡/水上巴士航线搜索
```
search_ferry(from_port: "東京", to_port: "大島")
```

---

## 🚨 故障模拟（-test 模式）

为了在开发和验证过程中模拟恶劣天气或交通中断，可使用测试模式。在 `search_route` 中指定 `-test` 标记即可触发模拟响应，无需调用实际 API。

**示例**:
```
查询从浅草到涩谷的路线 -test 地震
```

| 关键字 | 模拟内容 |
|:---|---|
| `台風` | 台风接近、特别警报、暂停运营 |
| `地震` | 地震导致临时暂停运营 |
| `浸水` | 车站周边积水、暂停运营 |
| `人身事故` | 人身事故导致暂停运营 |
| `火災` | 火灾导致暂停运营 |
| `停電` | 停电导致列车停运 |
| `信号故障` | 信号故障导致暂停运营 |
| `猛暑` | 酷暑预警 |
| `熱中症` | 防暑警报 |
| `降雪` | 积雪导致晚点及车站防滑提醒 |
| `豪雨` | 大雨导致视线不良及积水预警 |

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
| 轮渡 GTFS | 1小时 | 静态运行计划 |

---

## 🔐 必需的环境变量

进行 ODPT（公共交通开放数据中心）集成需要设置以下环境变量。

| 变量 | 必需 | 说明 |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | 可从 https://developer.odpt.org/ 获取 |

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
