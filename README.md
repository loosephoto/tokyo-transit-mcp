🌐 **Language / 言語 / 语言**: [日本語](#japanese) | [English](#english) | [中文](#chinese)

---

<a id="japanese"></a>
# 🚃 Tokyo Transit MCP Server (日本語)

**ODPT API + 気象庁 API を統合した東京圏総合交通情報MCPサーバー**

鉄道・モノレール・AGT・路面電車・水上バス・フェリー・バス・シェアサイクルまで、**東京圏の移動手段を1つのMCPサーバーで横断検索**できます。天候や運行情報を加味した AI インテリジェントアドバイスを、日本語・英語・中国語で自動生成します。

---

## ✨ 特徴

路線検索に加えて、気象データや交通オープンデータ（ODPT / GBFS / GTFS）を統合し、リアルタイムの移動アドバイスを提供する高度なMCPサーバーです。主な特徴は次のとおりです。

### 🚉 全交通機関を統合

| 種別 | 対応事業者 |
|:---|:---|
| 🚃 鉄道 | JR東日本・東京メトロ・都営地下鉄・小田急・京王・西武・東武・京急・京成・相鉄・東急・横浜市営・**つくばエクスプレス(MIR)**・**りんかい線(TWR)**・**みなとみらい線**・**箱根登山線**・北総・埼玉高速・東葉高速・芝山鉄道・JR東海 |
| 🚌 バス | 都営バス・西武バス・横浜市営バス（ODPT 並列取得）＋ JRバス関東・都内コミュニティバス41自治体（GTFS-JP個別取得）。バス停検索・乗り継ぎ探索・**バス⇔電車⇔バス横断乗り継ぎ**・ノンステップバス表示に対応 |
| 🚡 AGT | ゆりかもめ・日暮里舎人ライナー |
| 🚝 モノレール | 東京モノレール・多摩モノレール |
| 🚋 路面電車 | 都電荒川線（東京さくらトラム） |
| 🚢 フェリー | 東海汽船（伊豆諸島・小笠原航路）。ODPT GTFS が利用できない場合は内蔵ポートリスト（19港）で検索 |
| 🚤 水上バス | 東京クルーズ（浅草〜お台場〜豊洲） |
| ✈️ フライト | 羽田(HND)・成田(NRT) の到着/出発フライト（AviationStack）。キー未設定時は空港アクセス経路のみ表示（graceful degradation） |
| 🚲 シェアサイクル | ドコモ・バイクシェア（GBFS API・1,878ポート） |

### 🛤️ 路線網の網羅性とデータ確認

公開交通データと公式・公開の路線一覧を参考に、対応路線を継続的に拡張しています。v2.20.0では東京メトロ南北線、京王井の頭線、小田急多摩線、東急目黒線・大井町線、京急空港線、JR横須賀線・湘南新宿ライン・横浜線、富士急行線を追加しました。駅順・支線・接続駅を確認し、駅名・路線名の日本語/英語/中国語表示もあわせて整備しています。経路探索はAPIキー不要の内蔵グラフで動作します。

### 🤖 AI インテリジェントアドバイス

天候や運行情報から、移動に役立つ具体的なアドバイスを自動生成します。

- **☀ 晴天時** — 快適な移動をサポート
- **☔ 雨天時** — 濡れた駅構内・階段の滑りやすさを注意喚起し、バス振替を推奨
- **🌡 高温時** — 熱中症警戒アラートと水分補給を推奨
- **❄ 降雪時** — 足元の凍結・遅延・運休の可能性を案内し、時間に余裕を持つ移動を推奨
- **🚨 緊急時** — 運転見合わせ・災害検知時は避難所リンクを自動表示

### 🛡 セーフティ＆フォールトトレランス

- **サーキットブレイカー** — 3回連続失敗で60秒クールダウン（段階的に延長）
- **統一キャッシュ管理** — API負荷を最大80%削減（最長24時間キャッシュ）
- **デグレードモード** — API障害時も部分稼働を継続
- **荒天時安全ロジック** — 台風・浸水時は自転車案内を自動非表示
- **LLMフレンドリーJSON** — 全エラーを、AIが状況・再試行可否・次の選択肢を解釈しやすい構造化データで出力

### 💬 自然言語で簡単検索

駅名・バス停・港名は**部分一致・表記揺れ・旧名でも自動解決**します。「スカイツリーからテレコムセンターまで」「Odaiba から Toyosu」「東京ビッグサイトまでバス」のように、日本語・英語・中国語の自然な表現をそのまま渡すだけで検索できます。

**検索例**:
```
スカイツリーからテレコムセンターまでの経路を調べて
Shibuya to Odaiba route
查询从浅草到台场的路线
東京ビッグサイト までのバス停
Oshima ferry from Tokyo
```

> ⚠️ **ご注意**: 本サーバーは MCP クライアント（Claude Desktop / Hermes 等）上の LLM モデルを介して応答を表示します。モデルにより、AIインテリジェントアドバイスや検索結果の**表示揺れ（表現の違い・省略の有無等）が若干発生する場合があります**。検索エンジン自体のJSON出力はモデルに依存せず一定ですが、最終的な文章化はモデルに左右されます。

### 🌐 マルチランゲージ

利用者の質問言語に合わせて、**応答全体を日本語・英語・中国語でローカライズ**します。AIアドバイスだけでなく、経路の駅名・路線名、天気テキスト、エラーメッセージも同じ言語で返します。

| 質問の言語 | 推奨する `language` 指定 | 応答言語 |
|:---|:---|:---|
| 日本語 | `ja` または省略 | 日本語 |
| 英語 | `en` | 英語 |
| 中国語 | `zh` | 中国語 |

通常は質問文から自動判定します。駅名が日本語表記でも、英語・中国語で質問された場合は `language: "en"` / `language: "zh"` を指定すると、確実に希望言語で応答します。

### 🔧 テストモード（-test）

`search_route` に `-test <障害種別>` を付けると、20種類以上の障害シミュレーションが可能です。詳細は「[障害シミュレーション](#ja-test)」セクションを参照してください。

---

## 📦 セットアップ

リポジトリのクローン、依存関係のインストール、MCPクライアント（Claude Desktop / Hermes 等）への設定追加の順に進めます。

```bash
# リポジトリをクローン
git clone https://github.com/loosephoto/tokyo-transit-mcp.git
cd tokyo-transit-mcp

# 依存関係インストール
npm install

# ODPT API キーを設定（https://developer.odpt.org/ から取得）
echo 'ODPT_API_KEY=your_api_key_here' > .env
# フライト時刻を利用する場合のみ設定（AviationStack APIキー・任意: https://aviationstack.com/）
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

本MCPサーバーは**12種類のツール**を提供します。概要は早見表、詳細は各セクションを参照してください。

| # | ツール | 機能 | 主な引数 |
|:--|:--|:--|:--|
| 1 | `search_route` | 乗換ルート検索（天気・AIアドバイス付き） | `from`, `to` |
| 2 | `get_station_info` | 駅の基本情報（乗り入れ路線・事業者） | `station_name` |
| 3 | `get_weather` | 天気・気温（高温時は熱中症注意） | `area_name` |
| 4 | `search_fare` | 2駅間の運賃検索 | `from`, `to` |
| 5 | `get_timetable` | 駅の時刻表検索 | `station_name`, `railway` |
| 6 | `search_bus` | バス停/系統検索・乗り継ぎ・横断乗り継ぎ | `busstop_name` / `from`+`to` |
| 7 | `search_flight` | 空港フライト時刻・空港アクセス経路 | `airport`, `destination` |
| 8 | `list_transit_operators` | 交通事業者一覧（種別フィルタ付き） | `language`, `type_filter` |
| 9 | `get_operator_routes` | 事業者別の路線・駅一覧 | `operator_name` |
| 10 | `list_ferry_ports` | フェリー/水上バス港一覧 | `language` |
| 11 | `search_ferry` | 港間の航路・時刻表検索 | `from_port`, `to_port` |
| 12 | `list_community_buses` | 東京都コミュニティバス一覧（41自治体） | `language` |

### 1. `search_route` — 乗換ルート検索（メイン機能）

**機能**: 出発駅→到着駅のルートを検索し、天気・運行情報を自動取得して AI アドバイスを付加します。入力言語（日/英/中）に応じて応答全体（駅名・路線名・天気・エラー）を自動ローカライズします。

```
search_route(from: "渋谷", to: "新宿")
```

**パラメータ**:
- `from` (string) — 出発駅名（または最寄り駅に変換可能な施設名・ランドマーク名）
- `to` (string) — 到着駅名（または最寄り駅に変換可能な施設名・ランドマーク名）
- `language` (string, 任意) — 応答言語の強制指定 ja / en / zh。省略時は駅名から自動判定しますが、ユーザーのクエリ言語に合わせて指定すると確実にその言語で応答します（例: 英語で質問したのに駅名が日本語の場合に language: "en" を渡すと英語で返答）

> [!TIP]
> **施設名・ランドマークからも検索できます**
>
> 駅名ではなく、観光地・テーマパーク・神社仏閣・公園・美術館の名称を `from` / `to` に指定すると、最寄り駅へ自動変換して経路を検索します。英語・中国語の施設名・公園名・略称にも対応します。

| 分類 | 代表例 |
|:---|:---|
| テーマパーク・観光 | 東京ディズニーランド、サンリオピューロランド、六本木ヒルズ、皇居、浜離宮 |
| 神社仏閣・歴史 | 明治神宮、浅草寺、神田明神、成田山新勝寺、歌舞伎座 |
| 公園・庭園 | 舎人公園、代々木公園、小石川後楽園、清澄庭園、昭和記念公園 |
| 美術館・文化施設 | 森美術館、国立新美術館、teamLab、東京国立博物館、日本科学未来館 |

**入力例**:
```text
search_route(from: "東京", to: "サンリオピューロランド")
search_route(from: "Tokyo", to: "Mori Art Museum", language: "en")
search_route(from: "东京", to: "三丽鸥彩虹乐园", language: "zh")
search_route(from: "Shibuya", to: "Yoyogi Park", language: "en")
search_route(from: "涩谷", to: "代代木公园", language: "zh")
```

> [!NOTE]
> 到着駅周辺に文化・芸術施設がある場合、`destination_cultural_facilities` に施設名・カテゴリ・徒歩目安を表示します。美術館、博物館、劇場、伝統芸能、神社仏閣、科学館、水族館などを案内します。
- `user_location` (object, 任意) — 利用者の現在位置 `{ lat: number, lon: number }`。指定時は運転見合わせ時のシェアサイクル案内を現在地基準で表示（未指定時は出発駅基準）

**レスポンス例**:
```json
{
  "status": "SUCCESS",
  "from": "渋谷",
  "to": "新宿",
  "weather_text": "東京地方: 晴れ",
  "direct_search_url": "https://transit.yahoo.co.jp/...",
  "ai_transit_advice": "🤖 【AIからのインテリジェントアドバイス】\n晴れの良好なお天気です！...",
  "community_bus_access": [{ "station": "渋谷", "buses": [{ "bus": "ハチ公バス", "stop": "渋谷駅東口" }] }],
  "gov_facility_search_support": { "...": "..." },
  "station_bus_stops": { "...": "..." },
  "fare_available": true
}
```

**テストモード**（障害シミュレーションの詳細は下記セクション参照）:
```
search_route(from: "東京 -test 人身事故", to: "新宿")
search_route(from: "新宿 -test 台風", to: "渋谷")
search_route(from: "Tokyo -test typhoon", to: "Shinjuku")
search_route(from: "东京 -test 台风", to: "新宿")
```

### 2. `get_station_info` — 駅情報取得

指定した駅の基本情報（乗り入れ路線・事業者等）を取得します。

```
get_station_info(station_name: "渋谷", operator: "tokyometro")
```

### 3. `get_weather` — 天気情報

気象庁APIから天気・気温を取得します。高温時は熱中症注意を表示します。

```
get_weather(area_name: "東京")
```

### 4. `search_fare` — 運賃検索

2駅間の運賃をODPTデータから検索します（東京メトロ・都営対応）。

```
search_fare(from: "渋谷", to: "新宿")
```
```json
{
  "fares": [{ "operator": "TokyoMetro", "ticket": 200, "ic": 198 }]
}
```

### 5. `get_timetable` — 時刻表検索

指定駅の時刻表をODPTデータから検索します。

```
get_timetable(station_name: "渋谷", railway: "山手線")
```

### 6. `search_bus` — バス路線・乗り継ぎ検索

> [!TIP]
> 都営・西武・横浜市営バスに加え、都内41自治体のコミュニティバスを検索できます。ODPTのバス停順序データを使い、バス⇔電車⇔バスの横断経路にも対応します。

| できること | 指定方法 | 補足 |
|:---|:---|:---|
| バス停・系統を探す | `busstop_name` | バス名・自治体名でも検索可 |
| 乗り継ぎを探す | `from` + `to` | 異なる系統・事業者間にも対応 |
| 乗り物を優先する | `vehicle` | `bus` / `train` / `community_bus` / `ferry` / `any` |
| バリアフリー情報 | 自動表示 | ノンステップバス情報と自治体サイトを案内 |

```text
search_bus(busstop_name: "渋谷駅前")
search_bus(from: "渋谷駅前", to: "新橋駅前")
search_bus(from: "浅草", to: "上野", vehicle: "bus")
```

> [!NOTE]
> バス停検索はODPT障害時も内蔵のコミュニティバス/JRバス情報へ縮退します。統合乗り継ぎは停留所順序データが必要なため、ODPT障害時には経路を返せない場合があります。JRバス関東はバス停検索のみ対象です。

### 開発・回帰検証

コード変更後は、構文チェックと多言語回帰プローブを実行します。`npm test` は検索結果だけでなく、`weather_text`、`nearby_suggestions`、駅名・路線名などの補助表示も検査します。

```bash
npm run build       # node --check src/index.mjs
npm test            # 全26ケースの日本語・英語・中国語回帰
npm run test:bus    # バス乗り継ぎ実APIプローブ（API状況により長時間化）
npm run test:vehicle # vehicle優先の決定的モック回帰
```

`npm test` の終了コードをCIの品質ゲートに使用できます。実APIを使うバス乗り継ぎプローブがタイムアウトしても、決定的なモック回帰とは別に評価してください。

### 7. `search_flight` — 空港フライト時刻・到着時刻表示

> [!TIP]
> 羽田・成田の到着/出発便と、空港から目的地への鉄道アクセスをまとめて確認できます。空港名は日本語・英語・中国語・IATAコードで指定できます。

| できること | 指定方法 | 補足 |
|:---|:---|:---|
| 空港の発着便を調べる | `airport` + `direction` | 羽田 / 成田 / HND / NRT 等 |
| 特定便を調べる | `flight_number` | 例: `NH001` |
| 到着後のアクセスを調べる | `destination` | 到着ターミナルから鉄道経路を提案 |
| 主要駅へのアクセスを見る | `destination` を省略 | 到着便では `access_routes` を自動表示 |

```text
search_flight(airport: "羽田空港", direction: "arrival")
search_flight(airport: "成田空港", direction: "arrival", destination: "東京駅")
search_flight(flight_number: "NH001", direction: "arrival")
```

> [!NOTE]
> フライト時刻の取得には [AviationStack](https://aviationstack.com/) API（`FLIGHT_API_KEY`）が必要です。無料プランは当日分のみ対応し、`flight_date` は利用できません。キー未設定時も、空港アクセス経路は表示します。

### 8. `list_transit_operators` — 交通事業者一覧

全事業者（鉄道・AGT・モノレール・路面電車・フェリー）を種別フィルタ付きで表示します。

```
list_transit_operators(language: "ja", type_filter: "all")
```

### 9. `get_operator_routes` — 事業者別路線一覧

指定した事業者の全路線と駅を表示します。

```
get_operator_routes(operator_name: "yurikamome")
```

### 10. `list_ferry_ports` — フェリー/水上バス港一覧

東海汽船（伊豆諸島航路）と東京クルーズ（水上バス）の全港を表示します。

```
list_ferry_ports(language: "ja")
```

### 11. `search_ferry` — フェリー/水上バス航路検索

港間の航路と時刻表を検索します。

```
search_ferry(from_port: "東京", to_port: "大島")
```

### 12. `list_community_buses` — 東京都コミュニティバス一覧

東京バス協会「東京バス案内WEB」掲載の**41自治体のコミュニティバス**を自治体別に一覧表示します（ちぃばす・ハチ公バス・ムーバス・すぎ丸・はなバス 等）。各バスの公式サイトURL付きで、時刻表・路線の詳細はリンク先で確認できます。日本語・英語・中国語の3言語対応です。

```
list_community_buses(language: "ja")   # ja / en / zh
```

---

<a id="ja-test"></a>
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

ネットワーク障害や外部APIのタイムアウトが発生した場合でも、LLMが迅速・適切にフォールバック処理や理由説明を行えるよう、全エラーは構造化された統一JSON形式で出力されます。

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
│  list_community_buses                  │
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

主要機能であるODPT（公共交通オープンデータセンター）連携には、以下の環境変数の設定が必要です。

| 変数 | 必須 | 説明 |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | 必須（[ODPT](https://developer.odpt.org/) から取得） |
| `FLIGHT_API_KEY` | ⚪ | フライト時刻取得用（[AviationStack](https://aviationstack.com/)）。未設定時は空港アクセス経路のみ（graceful degradation） |

---

## 🏗 プロジェクト構成

本プロジェクトのディレクトリ構造と主要ファイルの構成です。

```
tokyo-transit-mcp/
├── src/
│   └── index.mjs       # メインサーバー（全ロジック）
├── scripts/            # 回帰検証プローブ（多言語・バス乗り継ぎ・言語検出）
│   ├── probe-all-lang.mjs
│   ├── probe-bus-transfer-lang.mjs
│   └── probe-language-detection.mjs
├── package.json
├── package-lock.json
├── README.md
├── SKILL.md             # プロジェクトスキル定義（v2.20.0）
├── mcp.json             # MCPクライアント設定例
├── .env.example         # 環境変数サンプル
└── .env                 # APIキー（gitignore推奨）
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

Search across every mode of transport in the Tokyo area — trains, monorails, AGT, trams, water buses, ferries, buses, and bike-sharing — through a single MCP server. AI Intelligent Advice based on weather and operational status is generated automatically in Japanese, English, and Chinese.

---

## ✨ Features

Beyond simple route search, this server integrates weather data and public transit open data (ODPT / GBFS / GTFS) to deliver real-time transit advice. Key features:

### 🚉 Integrated Transit Agencies

| Type | Supported Operators |
|:---|:---|
| 🚃 Railways | JR East, Tokyo Metro, Toei Subway, Odakyu, Keio, Seibu, Tobu, Keikyu, Keisei, Sotetsu, Tokyu, Yokohama Municipal, **Tsukuba Express (MIR)**, **Rinkai Line (TWR)**, **Minatomirai Line**, **Hakone Tozan Railway**, Hokuso, Saitama Railway, Toyo Rapid, Shibayama Railway, JR Central |
| 🚌 Buses | Toei / Seibu / Yokohama City Bus (parallel ODPT merge) + JR Bus Kanto & 41 Tokyo community buses (individual GTFS-JP feeds). Stop search, transfer search, **bus⇔train⇔bus cross-modal transfers**, and non-step bus display supported |
| 🚡 AGT | Yurikamome, Nippori-Toneri Liner |
| 🚝 Monorails | Tokyo Monorail, Tama Monorail |
| 🚋 Trams | Toden Arakawa Line (Tokyo Sakura Tram) |
| 🚢 Ferries | Tokai Kisen (Izu Islands & Ogasawara routes). Falls back to the built-in port list (19 ports) when ODPT GTFS is unavailable |
| 🚤 Water Buses | Tokyo Cruise (Asakusa - Odaiba - Toyosu) |
| ✈️ Flights | Haneda (HND) / Narita (NRT) arrivals & departures (AviationStack). Without a key, airport access routes are shown only (graceful degradation) |
| 🚲 Bike Sharing | Docomo Bike Share (GBFS API, 1,878 ports) |

### 🛤️ Route Coverage and Data Validation

The supported network is expanded continuously using public transit data and official/public railway lists. In v2.20.0, the Tokyo Metro Namboku Line, Keio Inokashira Line, Odakyu Tama Line, Tokyu Meguro/Oimachi Lines, Keikyu Airport Line, JR Yokosuka/Shonan-Shinjuku/Yokohama Lines, and Fujikyu Line were added. Station order, branches, interchange points, and Japanese/English/Chinese names are maintained together. Route search runs on the built-in graph without an API key.

### 🤖 AI Intelligent Advice

Generates concrete, useful advice for your trip based on weather and operational status.

- **☀ Sunny** — supports comfortable travel
- **☔ Rainy** — warns about slippery station floors and stairs, recommends bus alternatives
- **🌡 High Temperature** — heatstroke alert and hydration reminder
- **❄ Snow** — warns of icy surfaces, delays, and possible suspensions; recommends allowing extra time
- **🚨 Emergency** — automatically shows shelter/evacuation links during service suspensions or disasters

### 🛡 Safety & Fault Tolerance

- **Circuit Breaker** — 3 consecutive failures → 60s cooldown (gradually extended)
- **Unified Cache Management** — reduces API load by up to 80% (up to 24h caching)
- **Degraded Mode** — keeps partial operation during API disruptions
- **Severe Weather Logic** — automatically hides bike guidance during typhoons or flooding
- **LLM-Friendly JSON** — errors are emitted as structured data so AI can interpret context, retryability, and next options

### 💬 Easy Search in Natural Language

Station, bus stop, and port names are **automatically resolved by partial match, notation variance, and legacy names**, so exact input is not required. Simply pass natural expressions in Japanese, English, or Chinese — e.g. "route from Skytree to Telecom Center", "Odaiba to Toyosu", or "bus to Tokyo Big Sight".

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

The full response — AI advice, station and line names, weather text, and errors — is localized in Japanese, English, or Chinese to match the user's question.

| User's language | Recommended `language` value | Response language |
|:---|:---|:---|
| Japanese | `ja` or omit | Japanese |
| English | `en` | English |
| Chinese | `zh` | Chinese |

The language is normally inferred from the question. When Japanese station names are used in an English or Chinese request, pass `language: "en"` or `language: "zh"` to ensure the intended response language.

### 🔧 Test Mode (-test)

Adding `-test <disruption_type>` to `search_route` simulates 20+ types of transport disruptions. See the "[Disruption Simulation](#en-test)" section for details.

---

## 📦 Setup

Clone the repository, install dependencies, then add the configuration to your MCP client (Claude Desktop / Hermes, etc.).

```bash
# Clone the repository
git clone https://github.com/loosephoto/tokyo-transit-mcp.git
cd tokyo-transit-mcp

# Install dependencies
npm install

# Set your ODPT API key (Get one from https://developer.odpt.org/)
echo 'ODPT_API_KEY=your_api_key_here' > .env
# Only if using flight times: set AviationStack API key (optional: https://aviationstack.com/)
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

This MCP server provides **12 tools**. See the quick-reference table for an overview and the sections below for details.

| # | Tool | Function | Main params |
|:--|:--|:--|:--|
| 1 | `search_route` | Route search (with weather & AI advice) | `from`, `to` |
| 2 | `get_station_info` | Station info (lines & operators) | `station_name` |
| 3 | `get_weather` | Weather & temperature (heatstroke alert when hot) | `area_name` |
| 4 | `search_fare` | Fare between two stations | `from`, `to` |
| 5 | `get_timetable` | Timetable for a station | `station_name`, `railway` |
| 6 | `search_bus` | Bus stop/route search, transfers, cross-modal | `busstop_name` / `from`+`to` |
| 7 | `search_flight` | Flight times & airport access routes | `airport`, `destination` |
| 8 | `list_transit_operators` | Operator list (with type filter) | `language`, `type_filter` |
| 9 | `get_operator_routes` | Routes & stations by operator | `operator_name` |
| 10 | `list_ferry_ports` | Ferry / water bus ports list | `language` |
| 11 | `search_ferry` | Ferry / water bus route search | `from_port`, `to_port` |
| 12 | `list_community_buses` | Tokyo community buses (41 municipalities) | `language` |

### 1. `search_route` — Route Search (Main Feature)

**Function**: Searches a route from departure to arrival station, automatically fetches weather and transit status, and adds AI advice. The entire response (station/line names, weather, errors) is auto-localized to the input language (ja/en/zh).

```
search_route(from: "Shibuya", to: "Shinjuku")
```

**Parameters**:
- `from` (string) — Departure station name
- `to` (string) — Arrival station name
- `language` (string, optional) — Force response language `ja` / `en` / `zh`. When omitted, the language is auto-detected from the station names; pass the user's query language to guarantee the response language (e.g. pass `language: "en"` when the user asked in English even if the station names are Japanese)
- `user_location` (object, optional) — User's current location `{ lat: number, lon: number }`. When provided, bike-share guidance during service suspensions is based on the current location (otherwise on the departure station)

> [!TIP]
> **Search with attraction and landmark names**
>
> Use attraction, theme park, shrine, temple, park, or museum names in `from` / `to`; they are converted to the nearest station before route search. English and Chinese facility names, park names, and common aliases are supported.

| Category | Examples |
|:---|:---|
| Theme parks & attractions | Tokyo Disneyland, Sanrio Puroland, Roppongi Hills, Imperial Palace, Hama-rikyu |
| Shrines, temples & history | Meiji Shrine, Sensoji, Kanda Myojin, Naritasan Shinshoji, Kabukiza |
| Parks & gardens | Toneri Park, Yoyogi Park, Koishikawa Korakuen, Kiyosumi Gardens, Showa Kinen Park |
| Museums & cultural venues | Mori Art Museum, The National Art Center, teamLab, Tokyo National Museum, Miraikan |

**Examples**:
```text
search_route(from: "Tokyo", to: "Sanrio Puroland", language: "en")
search_route(from: "Tokyo", to: "Mori Art Museum", language: "en")
search_route(from: "东京", to: "三丽鸥彩虹乐园", language: "zh")
search_route(from: "Shibuya", to: "Yoyogi Park", language: "en")
search_route(from: "涩谷", to: "代代木公园", language: "zh")
```

> [!NOTE]
> When cultural or arts facilities are available around the arrival station, `destination_cultural_facilities` contains their names, categories, and walking estimates. It may include museums, theatres, traditional performing arts, shrines/temples, science museums, and aquariums.

**Response Example**:
```json
{
  "status": "SUCCESS",
  "from": "Shibuya",
  "to": "Shinjuku",
  "weather_text": "Tokyo Area: Sunny",
  "direct_search_url": "https://transit.yahoo.co.jp/...",
  "ai_transit_advice": "🤖 【AI Intelligent Advice】\nIt's nice and sunny!...",
  "community_bus_access": [{ "station": "Shibuya", "buses": [{ "bus": "Hachiko Bus", "stop": "Shibuya Stn East Exit" }] }],
  "gov_facility_search_support": { "...": "..." },
  "station_bus_stops": { "...": "..." },
  "fare_available": true
}
```

**Test Mode** (see the Disruption Simulation section below for details):
```
search_route(from: "Tokyo -test typhoon", to: "Shinjuku")
search_route(from: "Shinjuku -test earthquake", to: "Shibuya")
search_route(from: "东京 -test 台风", to: "新宿")
```

### 2. `get_station_info` — Station Info

Gets basic station information (serving lines, operators, etc.).

```
get_station_info(station_name: "Shibuya", operator: "tokyometro")
```

### 3. `get_weather` — Weather Info

Fetches weather and temperature from the JMA API. Displays a heatstroke caution when hot.

```
get_weather(area_name: "Tokyo")
```

### 4. `search_fare` — Fare Search

Searches fares between two stations from ODPT data (Tokyo Metro / Toei).

```
search_fare(from: "Shibuya", to: "Shinjuku")
```
```json
{
  "fares": [{ "operator": "TokyoMetro", "ticket": 200, "ic": 198 }]
}
```

### 5. `get_timetable` — Timetable Search

Searches the timetable of a station from ODPT data.

```
get_timetable(station_name: "Shibuya", railway: "Yamanote Line")
```

### 6. `search_bus` — Bus Route & Transfer Search

> [!TIP]
> Search Toei, Seibu, Yokohama City, and community buses across 41 Tokyo municipalities. ODPT stop-order data also enables bus⇔train⇔bus cross-modal routes.

| What you can do | Parameter | Notes |
|:---|:---|:---|
| Find stops and routes | `busstop_name` | Bus and municipality names are accepted |
| Find transfers | `from` + `to` | Supports transfers across routes and operators |
| Prefer a mode | `vehicle` | `bus` / `train` / `community_bus` / `ferry` / `any` |
| Check accessibility | Automatic | Shows non-step bus information and municipal guidance |

```text
search_bus(busstop_name: "Shibuya Station")
search_bus(from: "Shibuya Station", to: "Shimbashi Station")
search_bus(from: "Asakusa", to: "Ueno", vehicle: "bus")
```

> [!NOTE]
> Stop search falls back to built-in community-bus/JR Bus data during ODPT outages. Integrated transfer search needs stop-order data and may not return a route during an ODPT outage. JR Bus Kanto supports stop search only.

### Development & regression checks

After code changes, run the syntax check and multilingual regression probes. `npm test` checks not only the main results but also auxiliary fields such as `weather_text`, `nearby_suggestions`, station names, and line names.

```bash
npm run build        # node --check src/index.mjs
npm test             # 26 Japanese / English / Chinese regression cases
npm run test:bus     # live bus-transfer probe; may take a long time depending on the API
npm run test:vehicle # deterministic vehicle-preference mock regression
```

Use the exit code of `npm test` as the CI quality gate. A timeout in the live bus-transfer probe should be evaluated separately from the deterministic mock regressions.

### 7. `search_flight` — Airport Flight Times & Arrival Display

> [!TIP]
> Check Haneda/Narita arrivals or departures together with rail access to a destination. Airport names can be given in Japanese, English, Chinese, or as IATA codes.

| What you can do | Parameter | Notes |
|:---|:---|:---|
| Look up arrivals/departures | `airport` + `direction` | Haneda / Narita / HND / NRT, etc. |
| Look up a specific flight | `flight_number` | Example: `NH001` |
| Find post-arrival access | `destination` | Suggests rail access from the arrival terminal |
| See major-station access | Omit `destination` | Arrival searches auto-return `access_routes` |

```text
search_flight(airport: "Haneda Airport", direction: "arrival")
search_flight(airport: "Narita Airport", direction: "arrival", destination: "Tokyo Station")
search_flight(flight_number: "NH001", direction: "arrival")
```

> [!NOTE]
> Flight times require the [AviationStack](https://aviationstack.com/) API (`FLIGHT_API_KEY`). The free plan supports current-day data only and does not support `flight_date`. Airport access routes remain available without a key.

### 8. `list_transit_operators` — Transit Operators List

Lists all operators (rail, AGT, monorail, tram, ferry) with a type filter.

```
list_transit_operators(language: "en", type_filter: "all")
```

### 9. `get_operator_routes` — Routes by Operator

Lists all routes and stations of a given operator.

```
get_operator_routes(operator_name: "yurikamome")
```

### 10. `list_ferry_ports` — Ferry / Water Bus Ports List

Lists all ports of Tokai Kisen (Izu Islands routes) and Tokyo Cruise (water buses).

```
list_ferry_ports(language: "en")
```

### 11. `search_ferry` — Ferry / Water Bus Route Search

Searches routes and timetables between ports.

```
search_ferry(from_port: "Tokyo", to_port: "Oshima")
```

### 12. `list_community_buses` — Tokyo Community Buses

Lists **41 community buses across Tokyo wards/cities** published by the Tokyo Bus Association, including Chii-bus, Hachiko Bus, Mu-Bus, Sugimaru, and Hanabus. Each entry comes with the official municipal website URL for timetables and routes. Available in Japanese, English, and Chinese.

```
list_community_buses(language: "ja")   # ja / en / zh
```

---

<a id="en-test"></a>
## 🚨 Disruption Simulation (-test mode)

To test system behavior under severe weather or transit disruptions during development, a test mode is provided. Appending `-test <disruption_type>` to `search_route` triggers simulated responses without calling real APIs. Supports multilingual keywords (English, Japanese, Chinese).

**Example**:
```
Check route from Asakusa to Shibuya -test typhoon
Check route from Asakusa to Shibuya -test earthquake
查询从浅草到涩谷的路线 -test 台风
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

All errors are returned in a unified JSON format so that LLMs can quickly and appropriately fall back or explain the reason.

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

Architecture overview showing context requests from MCP clients routed to open APIs (ODPT/JMA/GBFS/GTFS) safely and efficiently.

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
│  list_community_buses                  │
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
| Ferry GTFS | 1 hour | Static schedule data (falls back to the built-in port list when ODPT GTFS is unavailable) |

---

## 🔐 Required Environment Variables

Integrating with ODPT (Open Data Center for Public Transportation) requires the following environment variables.

| Variable | Required | Description |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | Required (obtained from [ODPT](https://developer.odpt.org/)) |
| `FLIGHT_API_KEY` | ⚪ | For flight times ([AviationStack](https://aviationstack.com/)). Without it, only airport access routes are shown (graceful degradation) |

---

## 🏗 Project Structure

Directory layout and key files of this project.

```
tokyo-transit-mcp/
├── src/
│   └── index.mjs       # Main server script
├── scripts/            # Regression probes (multilingual / bus transfer / language detection)
│   ├── probe-all-lang.mjs
│   ├── probe-bus-transfer-lang.mjs
│   └── probe-language-detection.mjs
├── package.json
├── package-lock.json
├── README.md
├── SKILL.md             # Project skill definition (v2.20.0)
├── mcp.json             # MCP client configuration example
├── .env.example         # Environment variables sample
└── .env                 # API Keys
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

铁路、单轨铁路、AGT、有轨电车、水上巴士、轮渡、公交与共享单车——**东京圈的全部出行方式可通过一个 MCP 服务器跨方式查询**。结合天气与运行状况，自动生成日语、英语、中文的 AI 智能出行建议。

---

## ✨ 特性

本服务器不仅提供简单的路线搜索，更整合了气象数据与各类公共交通开放数据（ODPT / GBFS / GTFS），提供实时的出行建议。主要特性如下：

### 🚉 整合所有公共交通工具

| 类别 | 支持的运营商 |
|:---|:---|
| 🚃 铁路 | JR东日本、东京地下铁（Tokyo Metro）、都营地下铁、小田急、京王、西武、东武、京急、京成、相铁、东急、横滨市营、**筑波快线 (MIR)**、**临海线 (TWR)**、**港区未来线**、**箱根登山电车**、北总、埼玉高速、东叶高速、芝山铁道、JR东海 |
| 🚌 公交 | 都营/西武/横滨市营公交（ODPT 并行获取）+ JR巴士关东及东京 41 个自治体的社区公交（GTFS-JP 单独数据源）。支持公交站查询、换乘搜索、**公交⇔电车⇔公交跨方式换乘**及无障碍公交显示 |
| 🚡 AGT | 百合海鸥号（Yurikamome）、日暮里-舍人线 |
| 🚝 单轨铁路 | 东京单轨电车、多摩单轨电车 |
| 🚋 有轨电车 | 都电荒川线（东京樱花路面电车） |
| 🚢 轮渡 | 东海汽船（伊豆群岛、小笠原航线）。ODPT GTFS 不可用时回退至内置港口列表（19 港） |
| 🚤 水上巴士 | 东京观光汽船（浅草〜台场〜丰洲） |
| ✈️ 航班 | 羽田 (HND) / 成田 (NRT) 的到达/出发航班（AviationStack）。未配置密钥时仅显示机场接驳路线（优雅降级） |
| 🚲 共享单车 | Docomo Bike Share（GBFS API，1,878 个站点） |

### 🛤️ 路线覆盖与数据确认

项目参考公开交通数据、官方及公开线路列表，持续扩展支持的路线。v2.20.0 新增东京地铁南北线、京王井之头线、小田急多摩线、东急目黑线/大井町线、京急机场线、JR横须贺线/湘南新宿线/横滨线及富士急行线。车站顺序、支线、换乘站以及日英中名称会一并维护。路线搜索由无需 API 密钥的内置图执行。

### 🤖 AI 智能建议

根据天气与运行状况，自动生成具体实用的出行建议。

- **☀ 晴天** — 提供舒适的出行建议
- **☔ 雨天** — 提醒站内及楼梯湿滑，推荐公交替代出行
- **🌡 高温** — 提供中暑警报和补水提醒
- **❄ 降雪** — 提醒路面结冰、延误和可能停运，并建议预留充足时间
- **🚨 紧急情况** — 线路停运或检测到灾害时自动显示避难所/疏散链接

### 🛡 安全性与容错

- **断路器** — 连续 3 次失败后冷却 60 秒（逐步延长）
- **统一缓存管理** — 最多降低 80% API 负载（最长缓存 24 小时）
- **降级模式** — API 故障时保持部分功能运行
- **恶劣天气安全逻辑** — 台风或洪水时自动隐藏自行车指引
- **LLM 友好 JSON** — 以便 AI 理解当前状况、是否可重试和下一步选择的结构化数据输出所有错误

### 💬 自然语言轻松搜索

车站名、公交站名、港口名均支持**部分匹配、表记差异及旧名自动解析**，无需精确输入即可直观搜索。只需直接传入日语、英语或中文的自然表达，例如「从晴空塔到电信中心」「Odaiba 到 Toyosu」「到东京国际展览中心的巴士」即可。

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

自动识别输入语言，并**将整个响应本地化为该语言**——不仅是 AI 建议，路线中的站名、线路名、天气文本和错误消息也会以用户的语言返回。

| 输入 | 响应语言 |
|:---|:---|
| `お台場→羽田空港` | 日语 |
| `Odaiba -> Haneda` | 英语 |
| `台场到羽田机场` | 中文 |

包含符号（箭头、斜杠、括号）的英语输入，以及包含简体字或中文功能词（到・从・前往・出发 等）的输入均可准确识别。

### 🔧 测试模式 (-test)

在 `search_route` 中加入 `-test <故障类型>` 即可模拟 20 多种交通中断或灾害场景。详见「[故障模拟](#zh-test)」一节。

---

## 📦 安装与设置

请依次完成克隆代码库、安装依赖项，并将配置添加到您的 MCP 客户端（如 Claude Desktop 或 Hermes）。

```bash
# 克隆代码库
git clone https://github.com/loosephoto/tokyo-transit-mcp.git
cd tokyo-transit-mcp

# 安装依赖
npm install

# 设置 ODPT API 密钥（可从 https://developer.odpt.org/ 获取）
echo 'ODPT_API_KEY=your_api_key_here' > .env
# 仅在需要航班时刻时设置（AviationStack API 密钥・可选: https://aviationstack.com/）
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

本 MCP 服务器共提供 **12 个工具**。概览请参考速查表，详细说明请参考各小节。

| # | 工具 | 功能 | 主要参数 |
|:--|:--|:--|:--|
| 1 | `search_route` | 换乘路线搜索（含天气与 AI 建议） | `from`, `to` |
| 2 | `get_station_info` | 车站信息（线路与运营商） | `station_name` |
| 3 | `get_weather` | 天气与气温（高温时提示中暑注意） | `area_name` |
| 4 | `search_fare` | 两站之间的票价查询 | `from`, `to` |
| 5 | `get_timetable` | 车站时刻表查询 | `station_name`, `railway` |
| 6 | `search_bus` | 公交站/线路查询、换乘、跨方式换乘 | `busstop_name` / `from`+`to` |
| 7 | `search_flight` | 航班时刻与机场接驳路线 | `airport`, `destination` |
| 8 | `list_transit_operators` | 交通运营商列表（支持类型筛选） | `language`, `type_filter` |
| 9 | `get_operator_routes` | 按运营商列出路线与车站 | `operator_name` |
| 10 | `list_ferry_ports` | 轮渡/水上巴士港口列表 | `language` |
| 11 | `search_ferry` | 港口间航线与时刻表查询 | `from_port`, `to_port` |
| 12 | `list_community_buses` | 东京都社区公交一览（41 个自治体） | `language` |

### 1. `search_route` — 换乘路线搜索（核心功能）

**功能**: 查询出发站至到达站的路线，自动获取天气与运行状态并附带 AI 出行建议。整个响应（站名、线路名、天气、错误消息）将按输入语言（日/英/中）自动本地化。

```
search_route(from: "渋谷", to: "新宿")
```

**参数**:
- `from` (string) — 出发车站名称
- `to` (string) — 到达车站名称
- `language` (string, 可选) — 强制指定响应语言 `ja` / `en` / `zh`。省略时根据站名自动判定；若按用户的查询语言指定，可确保以该语言响应（例：用户用英语提问但站名为日语时，传入 `language: "en"` 即可获得英语回复）
- `user_location` (object, 可选) — 用户当前位置 `{ lat: number, lon: number }`。指定时，运行中断期间的共享自行车指引以当前位置为基准（未指定时以出发站为基准）

> [!TIP]
> **也可用设施和地标名称搜索**
>
> 在 `from` / `to` 中填写景点、主题乐园、神社寺院、公园或美术馆名称，系统会先转换为最近车站再搜索路线。支持英语、中文的设施名、公园名和常用别名。

| 分类 | 示例 |
|:---|:---|
| 主题乐园与景点 | 东京迪士尼乐园、三丽鸥彩虹乐园、六本木之丘、皇居、滨离宫 |
| 神社寺院与历史 | 明治神宫、浅草寺、神田明神、成田山新胜寺、歌舞伎座 |
| 公园与庭园 | 舍人公园、代代木公园、小石川后乐园、清澄庭园、昭和纪念公园 |
| 美术馆与文化设施 | 森美术馆、国立新美术馆、teamLab、东京国立博物馆、日本科学未来馆 |

**输入示例**:
```text
search_route(from: "东京", to: "三丽鸥彩虹乐园", language: "zh")
search_route(from: "Tokyo", to: "Mori Art Museum", language: "en")
search_route(from: "涩谷", to: "代代木公园", language: "zh")
search_route(from: "Shibuya", to: "Yoyogi Park", language: "en")
```

> [!NOTE]
> 若到达站周边有文化或艺术设施，`destination_cultural_facilities` 会显示其名称、分类和步行参考时间。可能包括美术馆、博物馆、剧场、传统艺能、神社寺院、科学馆和水族馆。

**响应示例**:
```json
{
  "status": "SUCCESS",
  "from": "渋谷",
  "to": "新宿",
  "weather_text": "东京地区: 晴",
  "direct_search_url": "https://transit.yahoo.co.jp/...",
  "ai_transit_advice": "🤖 【AI智能出行建议】\n天气晴朗！...",
  "community_bus_access": [{ "station": "涩谷", "buses": [{ "bus": "哈奇公巴士", "stop": "涩谷站东口" }] }],
  "gov_facility_search_support": { "...": "..." },
  "station_bus_stops": { "...": "..." },
  "fare_available": true
}
```

**测试模式**（故障模拟详见下文）:
```
search_route(from: "东京 -test 人身事故", to: "新宿")
search_route(from: "新宿 -test 台风", to: "涩谷")
search_route(from: "Tokyo -test typhoon", to: "Shinjuku")
```

### 2. `get_station_info` — 获取车站信息

获取指定车站的基本信息（途经线路、运营商等）。

```
get_station_info(station_name: "渋谷", operator: "tokyometro")
```

### 3. `get_weather` — 获取天气信息

从气象厅 API 获取天气与气温。高温时显示中暑注意。

```
get_weather(area_name: "東京")
```

### 4. `search_fare` — 票价查询

从 ODPT 数据查询两站之间的票价（东京地下铁 / 都营）。

```
search_fare(from: "渋谷", to: "新宿")
```
```json
{
  "fares": [{ "operator": "TokyoMetro", "ticket": 200, "ic": 198 }]
}
```

### 5. `get_timetable` — 时刻表查询

从 ODPT 数据查询指定车站的时刻表。

```
get_timetable(station_name: "渋谷", railway: "山手線")
```

### 6. `search_bus` — 公交路线与换乘查询

> [!TIP]
> 可搜索都营、西武、横滨市营公交以及东京 41 个自治体的社区公交。利用 ODPT 的站点顺序数据，也支持公交⇔电车⇔公交的跨方式路线。

| 可进行的操作 | 参数 | 说明 |
|:---|:---|:---|
| 查找公交站和线路 | `busstop_name` | 也可输入巴士名称或自治体名称 |
| 查找换乘 | `from` + `to` | 支持跨线路、跨运营商换乘 |
| 优先某种交通方式 | `vehicle` | `bus` / `train` / `community_bus` / `ferry` / `any` |
| 查看无障碍信息 | 自动显示 | 显示无台阶巴士信息及自治体指引 |

```text
search_bus(busstop_name: "涩谷站前")
search_bus(from: "涩谷站前", to: "新桥站前")
search_bus(from: "浅草", to: "上野", vehicle: "bus")
```

> [!NOTE]
> ODPT 发生故障时，公交站搜索会降级使用内置的社区公交/JR 巴士数据。综合换乘需要站点顺序数据，故障时可能无法返回路线。JR 巴士关东仅支持公交站搜索。

### 开发与回归验证

代码变更后，请运行语法检查和多语言回归探针。`npm test` 不仅检查主要结果，也会检查 `weather_text`、`nearby_suggestions`、车站名和线路名等辅助显示字段。

```bash
npm run build        # node --check src/index.mjs
npm test             # 26 个日文/英文/中文回归用例
npm run test:bus     # 公交换乘实时 API 探针，可能因 API 状况耗时较长
npm run test:vehicle # 乘车工具优先的确定性 mock 回归
```

可以使用 `npm test` 的退出码作为 CI 质量门槛。实时公交换乘探针超时，应与确定性 mock 回归分开判断。

### 7. `search_flight` — 机场航班时刻与到达信息

> [!TIP]
> 可同时查看羽田/成田的到达或出发航班，以及前往目的地的铁路接驳。机场名称可使用日语、英语、中文或 IATA 代码。

| 可进行的操作 | 参数 | 说明 |
|:---|:---|:---|
| 查询到达/出发航班 | `airport` + `direction` | 羽田 / 成田 / HND / NRT 等 |
| 查询特定航班 | `flight_number` | 例如：`NH001` |
| 查询到达后的接驳 | `destination` | 推荐从到达航站楼出发的铁路路线 |
| 查看主要车站接驳 | 省略 `destination` | 到达查询自动返回 `access_routes` |

```text
search_flight(airport: "羽田机场", direction: "arrival")
search_flight(airport: "成田机场", direction: "arrival", destination: "东京站")
search_flight(flight_number: "NH001", direction: "arrival")
```

> [!NOTE]
> 航班时刻需要 [AviationStack](https://aviationstack.com/) API（`FLIGHT_API_KEY`）。免费套餐仅支持当日数据，且不支持 `flight_date`。未配置密钥时仍可显示机场接驳路线。

### 8. `list_transit_operators` — 交通运营商列表

列出全部运营商（铁路、AGT、单轨、有轨电车、轮渡），支持类型筛选。

```
list_transit_operators(language: "zh", type_filter: "all")
```

### 9. `get_operator_routes` — 按运营商列出路线

列出指定运营商的全线路与车站。

```
get_operator_routes(operator_name: "yurikamome")
```

### 10. `list_ferry_ports` — 轮渡/水上巴士港口列表

列出东海汽船（伊豆群岛航线）与东京观光汽船（水上巴士）的全部港口。

```
list_ferry_ports(language: "zh")
```

### 11. `search_ferry` — 轮渡/水上巴士航线搜索

查询港口之间的航线与时刻表。

```
search_ferry(from_port: "東京", to_port: "大島")
```

### 12. `list_community_buses` — 东京都社区公交一览

按自治体列出东京巴士协会「东京巴士指南WEB」收录的 **41 条社区公交**（ちぃばす、哈奇公巴士、ムーバ斯、すぎ丸、はな巴士 等）。每条均附带官方网址，时刻表与路线详情请在链接中确认。支持日语、英语、中文。

```
list_community_buses(language: "ja")   # ja / en / zh
```

---

<a id="zh-test"></a>
## 🚨 故障模拟（-test 模式）

为了在开发和验证过程中模拟恶劣天气或交通中断，可使用测试模式。在 `search_route` 中指定 `-test <故障类型>` 即可触发模拟响应，无需调用实际 API。支持中文、英文、日文多语言关键字。

**示例**:
```
查询从浅草到涩谷的路线 -test 台风
查询从浅草到涩谷的路线 -test 地震
Check route from Asakusa to Shibuya -test typhoon
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

网络故障或外部 API 超时时，所有错误均统一输出为结构化 JSON 格式，方便 LLM 快速进行降级处理或说明原因。

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
│  list_community_buses                  │
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

根据数据更新频率设置合理的 TTL（生存时间），以减少不必要的 API 请求，提高响应速度。

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

与 ODPT（公共交通开放数据中心）集成需要设置以下环境变量。

| 变量 | 必需 | 说明 |
|:---|---:|:---|
| `ODPT_API_KEY` | ✅ | 必需（可从 [ODPT](https://developer.odpt.org/) 获取） |
| `FLIGHT_API_KEY` | ⚪ | 航班时刻获取用（[AviationStack](https://aviationstack.com/)）。未配置时仅显示机场接驳路线（优雅降级） |

---

## 🏗 项目结构

本项目的目录结构及主要文件：

```
tokyo-transit-mcp/
├── src/
│   └── index.mjs       # 主服务器文件
├── scripts/            # 回归验证探针（多语言 / 公交换乘 / 语言检测）
│   ├── probe-all-lang.mjs
│   ├── probe-bus-transfer-lang.mjs
│   └── probe-language-detection.mjs
├── package.json
├── package-lock.json
├── README.md
├── SKILL.md             # 项目技能定义（v2.20.0）
├── mcp.json             # MCP 客户端配置示例
├── .env.example         # 环境变量示例
└── .env                 # API 密钥
```

---

## ⚠️ 许可证

MIT License

---

## 🙏 致谢

- [公共交通开放数据中心 (ODPT)](https://www.odpt.org/)
- [日本气象厅 API](https://www.jma.go.jp/jma/index.html)
- [Docomo Bike Share GBFS](https://docomo-cycle.jp/)
