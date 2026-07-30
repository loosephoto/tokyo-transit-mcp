# 🚃 Tokyo Transit MCP Server

**ODPT API + 気象庁 API を統合した東京圏総合交通情報MCPサーバー**

鉄道・モノレール・AGT（ゆりかもめ等）・路面電車・水上バス・フェリー・シェアサイクルを横断検索し、天候・運行情報を加味した AI インテリジェントアドバイスを多言語（日本語/英語/中国語）で提供します。

---

## ✨ 特徴

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

```bash
# リポジトリをクローン
git clone https://github.com/YOUR_USER/tokyo-transit-mcp.git
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
      "args": ["C:\\Users\\your_username\\tokyo-transit-mcp\\src\\index.mjs"],
      "env": {
        "ODPT_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## 🛠 使用可能ツール

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

### 4. `search_fare` — 運賃検索（Yahoo非依存）

```
search_fare(from: "渋谷", to: "新宿")
```
```json
{
  "fares": [{ "operator": "TokyoMetro", "ticket": 200, "ic": 198 }]
}
```

### 5. `get_timetable` — 時刻表検索（Yahoo非依存）

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

`search_route` に `-test` フラグを付けると実際のAPIを呼ばずにシミュレーションできます。

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

全エラーはLLMが解析可能な統一JSON形式で出力されます：

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

| 変数 | 必須 | 説明 |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | https://developer.odpt.org/ から取得 |

---

## 🏗 プロジェクト構成

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
