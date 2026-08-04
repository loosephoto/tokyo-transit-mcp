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

### 🛤️ 路線網とAPI突合

`odpt:Railway`、公開路線一覧、国土数値情報の鉄道データを突合し、v2.20.0で東京メトロ南北線、京王井の頭線、小田急多摩線、東急目黒線・大井町線、京急空港線、JR横須賀線・湘南新宿ライン・横浜線、富士急行線を追加しました。駅順・支線・接続駅を確認し、駅表示名（日本語/英語/中国語）と路線表示名も同期しています。APIは事業者・路線の存在確認に使用し、経路探索はキー不要の内蔵グラフで実行します。

### 🤖 AI インテリジェントアドバイス

天候や運行情報から、移動に役立つ具体的なアドバイスを自動生成します。

- **☀ 晴天時** — 快適な移動をサポート
- **☔ 雨天時** — 濡れた駅構内・階段の滑りやすさを注意喚起し、バス振替を推奨
- **🌡 高温時** — 熱中症警戒アラートと水分補給を推奨
- **🚨 緊急時** — 運転見合わせ・災害検知時は避難所リンクを自動表示

### 🛡 セーフティ＆フォールトトレランス

- **サーキットブレイカー** — 3回連続失敗で60秒クールダウン（段階的に延長）
- **統一キャッシュ管理** — API負荷を最大80%削減（最長24時間キャッシュ）
- **デグレードモード** — API障害時も部分稼働を継続
- **荒天時安全ロジック** — 台風・浸水時は自転車案内を自動非表示
- **LLMフレンドリーJSON** — 全エラーを構造化データで出力

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

入力言語を自動判定し、**応答全体をその言語でローカライズ**します。AIアドバイスだけでなく、経路の駅名・路線名、天気テキスト、エラーメッセージまでユーザーの言語で返します。

| 入力 | 応答言語 |
|:---|:---|
| `お台場→羽田空港` | 日本語 |
| `Odaiba -> Haneda` | 英語 |
| `台场到羽田机场` | 中国語 |

矢印・スラッシュ・括弧などの記号を含む英語入力や、簡体字・中国語の機能語（到・从・前往・出发 等）を含む入力も正しく判定します。

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

**ランドマーク自動変換（環境客・観光客向け）**:
入力が駅名でない主要施設・ランドマーク名の場合、自動的にもっとも近い駅へ変換して経路検索します。変換結果は landmark_info フィールドで案内されます（例: 「東京ディズニーランド」→「舞浜」、徒歩目安付き）。対応例: 東京ディズニーランド/ディズニーシー、東京スカイツリー、東京タワー、東京ドーム、日本武道館、東京ビッグサイト、浅草寺/雷門、横浜中華街、幕張メッセ など。

**有名神社仏閣・観光スポットも対応**:
明治神宮（原宿）、成田山新勝寺（成田空港）、東京大学・赤門（本郷三丁目）、六義園（駒込）、根津神社（後楽園）、護国寺（護国寺）、谷中霊園・谷中銀座（日暮里）、上野恩賜公園・上野動物園・寛永寺（上野）など。外国人観光客も「Meiji Shrine」「Naritasan」「University of Tokyo」「Rikugien」「Nezu Shrine」等の英語名で検索可能です。

**都心の主要観光スポットも対応**:
東京ドームシティ・後楽園（後楽園）、六本木ヒルズ（六本木）、麻布十番商店街（麻布十番）、表参道・青山（表参道）、増上寺（芝公園）、浜離宮恩賜庭園（水上バス「浜離宮」発着場が最寄り／陸路は竹芝）、築地場外市場（築地）、豊洲市場・teamLab（豊洲）、皇居・二重橋（東京）、国会議事堂（永田町）など。「Roppongi Hills」「Tokyo Dome City」「Omotesando」「Tsukiji Market」「Imperial Palace」等の英語名でも検索できます。

**主要公園・庭園も対応**:
舎人公園（舎人公園）、代々木公園（原宿）、小石川後楽園（後楽園）、清澄庭園（清澄白河）、水元公園（松戸）、昭和記念公園（立川）、砧公園（用賀）、駒沢公園（駒沢大学）、有栖川宮記念公園（広尾）、檜町公園（六本木）、目黒天空庭園（池尻大橋）、若洲海浜公園・夢の島公園（新木場）、大井ふ頭中央海浜公園（大井町）、和田倉噴水公園（大手町）、日比谷公園（日比谷）、小金井公園（花小金井）など。英語・中国語の公園名でも検索できます。

**美術館・博物館・文化施設も対応**:
森美術館（六本木）、国立新美術館（乃木坂）、チームラボプラネッツ（新豊洲）、チームラボボーダレス（神谷町）、神田明神（御茶ノ水）、築地本願寺（築地）、歌舞伎座（東銀座）、東京都庁展望室（都庁前）、サンシャインシティ（池袋）、日本科学未来館（東京テレポート）、東京駅丸の内駅舎（東京）など。「Mori Art Museum」「The National Art Center, Tokyo」「teamLab Planets」「Kanda Myojin」「Kabukiza Theatre」「Miraikan」等の英語名や中国語名にも対応しています。

**降車地域の文化・芸能・芸術施設**:
`search_route` の到着駅周辺には `destination_cultural_facilities` を表示します。美術館・博物館・劇場・伝統芸能・神社仏閣・科学館・水族館などを、施設名・カテゴリ・徒歩目安（分）付きで案内します。施設情報は現在、確定性を優先した厳選ローカルデータです。東京都オープンデータAPI（文化施設・美術館・博物館）、文化庁文化情報プラットフォーム、Wikidata SPARQL等の活用候補を調査済みで、将来のデータ同期拡張に備えた構造にしています。

レスポンス例:
```json
{
  "destination_cultural_facilities": [
    { "name": "森美術館", "category": "美術館", "walk_min": 5 },
    { "name": "東京ミッドタウン", "category": "複合文化施設", "walk_min": 5 }
  ]
}
```

**多言語・別名（訳名・略称）対応**:
施設名は日本語の正式名称だけでなく、英語・中国語の名称、および訳名・略称でも検索できます（例: 東京ディズニーランド = Disneyland / Disney / 迪士尼 / 东京迪士尼乐园）。案内文（note）は language パラメータに応じて ja/en/zh で出力されます。

```text
search_route(from: "東京", to: "東京ディズニーランド")    # 到着側を「舞浜」へ自動変換し、landmark_info で案内
search_route(from: "Tokyo", to: "Disney")               # 英語・略称でも「舞浜」へ変換（language: "en" 推奨）
search_route(from: "东京站", to: "迪士尼")                # 中国語でも変換（language: "zh" 推奨）
```
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

### 6. `search_bus` — バス路線・乗り継ぎ検索（都営・西武・横浜市営＋コミュニティバス）

ODPT の `odpt:Bus` から都営バス・西武バス・横浜市交通局（横浜市営バス）の3事業者を並列取得し、GTFS-JP 個別取得パスで JRバス関東・都内コミュニティバス（ちぃばす・ハチ公バス等）を追加します。コミュニティバスは東京バス協会「東京バス案内WEB」掲載の**41自治体ディレクトリ**に対応し、`busstop_name` に「ちぃばす」「ムーバス」「すぎ丸」等のバス名や自治体名を指定すると、名称・自治体・公式サイトURLを案内します（時刻表・路線の詳細は各自治体サイトで確認）。

- **バス停検索** — `busstop_name` でバス停・系統を検索
- **駅⇔コミュニティバス接続（バリアフリー対応）** — `search_route` / `search_bus` で駅を指定すると「この駅はどのコミュニティバスが使えるか」を表示（主要10件の駅接続データ: ちぃばす・ハチ公バス・ムーバス・はなバス・すぎ丸 等）。足の悪いユーザーの「駅までの足・駅からの足」を支援し、車椅子・低床バスの確認先（自治体公式サイトURL）を注意喚起として案内。コミュニティバス停同士の乗り継ぎは `mode: 'community_bus'` セグメントとして実経路を返します（例: 渋谷駅東口→恵比寿駅前 = ハチ公バス）
- **乗り継ぎ探索** — `from` + `to` で `odpt:BusroutePattern` の停留所順序から最短乗り継ぎ経路を探索（異系統・異事業者間の乗り継ぎ対応）
- **🚌 乗り物指定優先（`vehicle`）** — 乗り継ぎ探索モードで `vehicle` を指定すると、その乗り物を優先した経路を探索します。`bus`（バス優先）/`train`（電車優先）/`community_bus`（コミュニティバス優先）/`ferry`（水上バス優先）/`any`（自動＝最短・デフォルト）。指定した乗り物が極端に遠回りになる場合（乗換が2回以上多い、または所要目測が10分以上長い）、`better_alternative` フィールドでより良い経路（推奨乗り物・節約できる乗換回数・分数）を進言します。所要時間は駅数・停留所数を基にしたグラフ上の概算です。
- **ODPT障害時の縮退** — `search_bus` のバス停検索は、ODPT APIが利用できない場合でも hard-coded のコミュニティバス/JRバスデータへ縮退します。一方、ODPTの停留所順序を必要とする統合乗り継ぎ探索は、データ取得失敗時に経路を返せない場合があります。
- **横断乗り継ぎ** — バス停と駅を緯度経度で紐付け、`odpt:Station`（電車）グラフと統合。バス→電車→バスの横断ルートも探索（例: 渋谷駅前→（徒歩）→渋谷→（電車）→新橋駅前）
- **バリアフリー** — `odpt:BusTimetable.isNonStepBus`（ノンステップバス・段差なし）を系統ごとに表示

※ 乗り継ぎは都営・西武・横浜市営バス＋コミュニティバス駅接続ルートが対象です（JRバス関東は停留所順序データがないため乗り継ぎ対象外・バス停検索のみ）。運賃はODPT非対応のため検索できません。

```
search_bus(busstop_name: "渋谷駅前")                    # バス停検索
search_bus(from: "渋谷駅前", to: "新橋駅前")            # バス→電車→バス 横断乗り継ぎ
search_bus(from: "横浜駅前", to: "川崎駅前")            # 横浜→（電車）→川崎 横断乗り継ぎ
search_bus(from: "浅草", to: "上野", vehicle: "bus")       # バス優先（better_alternative で電車案内の可能性あり）
```

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

- **空港検索** — `airport`（羽田空港/成田空港/HND/NRT 等）で到着/出発フライトを検索
- **空港名の表記揺れ対応** — 「羽田」/「成田」/「Haneda」/「Narita」等、末尾の「空港/Airport/机场」の有無や日英中表記を自動正規化
- **便名検索** — `flight_number`（NH001/JL000 等）で特定便を検索
- **到着時の最適連携** — `destination`（例: 東京駅）を指定すると、到着ターミナルから目的地へのアクセス経路（電車）を自動提案。**海外からの来客・帰省時に最適**。`destination` 未指定でも、到着時は主要アクセス駅（羽田: 東京駅/品川/浜松町、成田: 東京駅/日暮里/新宿）へのルートを自動表示（`access_routes`）
- **表示項目** — 便名・航空会社・ステータス（予定/運航中/到着済/欠航）・ターミナル・ゲート・予定時刻・実際時刻・遅延（分）
- **Graceful degradation** — `FLIGHT_API_KEY` 未設定時はフライト時刻なしで、空港へのアクセス経路のみ表示

※ フライト時刻は [AviationStack](https://aviationstack.com/) API（`FLIGHT_API_KEY`）が必要です。無料プランでは当日分のみ取得可能で、日付指定（`flight_date`）は非対応です。未設定時は空港アクセス経路のみ表示します。

```
search_flight(airport: "羽田空港", direction: "arrival")              # 羽田着フライト一覧
search_flight(airport: "成田空港", direction: "arrival", destination: "東京駅")  # 成田着→東京駅へのアクセス経路付き
search_flight(flight_number: "NH001", direction: "arrival")          # 便名指定
```

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

### 🛤️ Route Network and API Cross-Check

Using `odpt:Railway`, public railway lists, and Japan’s National Land Numerical Information railway data, v2.20.0 adds the Tokyo Metro Namboku Line, Keio Inokashira Line, Odakyu Tama Line, Tokyu Meguro/Oimachi Lines, Keikyu Airport Line, JR Yokosuka/Shonan-Shinjuku/Yokohama Lines, and Fujikyu Line. Station order, branches, interchange points, and Japanese/English/Chinese display names were synchronized. APIs are used to verify operators and railway existence; route search runs on the built-in graph without requiring an API key.

Generates concrete, useful advice for your trip based on weather and operational status.

- **☀ Sunny** — supports comfortable travel
- **☔ Rainy** — warns about slippery station floors and stairs, recommends bus alternatives
- **🌡 High Temperature** — heatstroke alert and hydration reminder
- **🚨 Emergency** — automatically shows shelter/evacuation links during service suspensions or disasters

### 🛡 Safety & Fault Tolerance

- **Circuit Breaker** — 3 consecutive failures → 60s cooldown (gradually extended)
- **Unified Cache Management** — reduces API load by up to 80% (up to 24h caching)
- **Degraded Mode** — keeps partial operation during API disruptions
- **Severe Weather Logic** — automatically hides bike guidance during typhoons or flooding
- **LLM-Friendly JSON** — all errors output in structured JSON

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

The input language is auto-detected and the **entire response is localized to that language** — AI advice, route station/line names, weather text, and error messages all come back in the user's language.

| Input | Response language |
|:---|:---|
| `お台場→羽田空港` | Japanese |
| `Odaiba -> Haneda` | English |
| `台场到羽田机场` | Chinese |

English inputs containing symbols (arrows, slashes, parentheses) and inputs containing simplified Chinese characters or Chinese function words (到 / 从 / 前往 / 出发, etc.) are detected reliably.

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

### 6. `search_bus` — Bus Route & Transfer Search (Toei / Seibu / Yokohama City + Community Bus)

Merges Toei Bus, Seibu Bus, and Yokohama City Bus (Yokohama Municipal) from ODPT `odpt:Bus` in parallel, and adds JR Bus Kanto and Tokyo community buses (Chii-bus, Hachiko-bus, etc.) via individual GTFS-JP feeds. Community buses cover the **41-municipality directory** from the Tokyo Bus Association: passing a bus name or municipality to `busstop_name` (e.g. "Chii-bus", "Mu-Bus", "Sugimaru") returns the name, municipality, and official website URL (timetables/routes are on each municipal site).

- **Stop search** — `busstop_name` to find stops / routes
- **Station ⇔ community bus access (barrier-free)** — specifying a station in `search_route` / `search_bus` shows which community buses serve it (station-access data for 10 major buses: Chii-bus, Hachiko Bus, Mu-Bus, Hanabus, Sugimaru, etc.). Supports mobility-impaired users' first/last mile (home → station / station → destination), with a caution pointing to the municipal site for wheelchair / low-floor availability. Transfers between community bus stops return real routes as `mode: 'community_bus'` segments (e.g. Shibuya Stn East Exit → Ebisu Stn = Hachiko Bus)
- **Transfer search** — `from` + `to` builds shortest transfer routes from `odpt:BusroutePattern` stop order (cross-route / cross-operator transfers)
- **🚌 Vehicle preference (`vehicle`)** — In transfer-search mode, set `vehicle` to prefer that mode: `bus` (bus-first) / `train` (train-first) / `community_bus` (community bus-first) / `ferry` (water bus-first) / `any` (auto = shortest, default). If the requested mode makes the route much worse (2+ extra transfers, or 10+ min longer by estimate), a `better_alternative` field recommends a better route (recommended mode, transfers saved, minutes saved). The time estimate is graph-based, using station and stop counts rather than live timetables or traffic.
- **ODPT outage fallback** — Bus-stop search falls back to hard-coded community-bus/JR Bus data when the ODPT API is unavailable. Integrated transfer search still depends on ODPT stop-order data and may return no route when that data cannot be fetched.
- **Cross-modal transfer** — bus stops and stations are linked by geo-coordinates and merged with the `odpt:Station` (train) graph, enabling bus→train→bus routes (e.g. Shibuya Station →(walk)→ Shibuya →(train)→ Shimbashi Station)
- **Barrier-free** — `odpt:BusTimetable.isNonStepBus` (step-free / non-step buses) shown per route

Note: transfers cover Toei/Seibu/Yokohama City Bus plus community-bus station links (JR Bus Kanto lacks stop-order data, so it is excluded from transfers — stop search only). Fares are not available via ODPT.

```
search_bus(busstop_name: "Shibuya Station")
search_bus(from: "Shibuya Station", to: "Shimbashi Station")   # bus→train→bus cross-modal
search_bus(from: "Yokohama Station", to: "Kawasaki Station")    # Yokohama→(train)→Kawasaki cross-modal
```

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

- **Airport search** — `airport` (Haneda/Narita/HND/NRT etc.) lists arrival/departure flights
- **Airport name normalization** — "Haneda"/"Narita"/"羽田"/"成田" etc. auto-normalized (trailing "Airport/空港/机场" stripped, ja/en/zh supported)
- **Flight number search** — `flight_number` (NH001/JL000 etc.) for a specific flight
- **Best for inbound/return travel** — specify `destination` (e.g. Tokyo Station) to auto-suggest the access route (train) from the arrival terminal. Without `destination`, arrival searches auto-show routes to major access stations (Haneda: Tokyo Stn/Shinagawa/Hamamatsucho, Narita: Tokyo Stn/Nippori/Shinjuku) via `access_routes`
- **Fields** — flight no., airline, status (scheduled/active/landed/cancelled), terminal, gate, scheduled/actual time, delay (min)
- **Graceful degradation** — without `FLIGHT_API_KEY`, shows airport access routes only (no flight times)

Note: flight times require the [AviationStack](https://aviationstack.com/) API (`FLIGHT_API_KEY`). The free plan covers current-day data only and does not support the date parameter (`flight_date`). Without a key, only airport access routes are shown.

```
search_flight(airport: "Haneda Airport", direction: "arrival")                    # Haneda arrivals
search_flight(airport: "Narita Airport", direction: "arrival", destination: "Tokyo Station")  # Narita→Tokyo access route
search_flight(flight_number: "NH001", direction: "arrival")                       # by flight no.
```

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

### 🛤️ 路线网络与 API 交叉核对

基于 `odpt:Railway`、公开铁路路线列表和日本国土数值信息铁路数据，v2.20.0 新增东京地铁南北线、京王井之头线、小田急多摩线、东急目黑线/大井町线、京急机场线、JR横须贺线/湘南新宿线/横滨线以及富士急行线。已同步核对车站顺序、支线、换乘站和日英中显示名称。API用于确认运营商与路线存在性，实际路线搜索由无需API密钥的内置图执行。

根据天气与运行状况，自动生成具体实用的出行建议。

- **☀ 晴天** — 提供舒适的出行建议
- **☔ 雨天** — 提醒站内及楼梯湿滑，推荐公交替代出行
- **🌡 高温** — 中暑预警与补水提醒
- **🚨 紧急** — 停运或发生灾害时自动显示避难所链接

### 🛡 安全与容错机制

- **熔断器 (Circuit Breaker)** — 连续 3 次失败 → 60 秒冷却（逐步延长）
- **统一缓存管理** — 降低外部 API 负载高达 80%（最长 24 小时缓存）
- **降级模式** — 外部 API 发生故障时仍保持部分功能可用
- **恶劣天气安全逻辑** — 台风或积水时自动隐藏共享单车引导
- **LLM 友好型 JSON** — 所有错误均以结构化 JSON 格式输出

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

### 6. `search_bus` — 公交路线与换乘查询（都营/西武/横滨市营 + 社区公交）

从 ODPT 的 `odpt:Bus` 并行获取并合并都营公交、西武公交、横滨市交通局（横滨市营公交）3 家运营商的数据，并通过 **GTFS-JP 单独数据源** 追加 JR 巴士关东和东京社区公交（ちぃばす、ハチ公バス 等）。社区公交已覆盖东京巴士协会「东京巴士指南WEB」的 **41 自治体目录**：在 `busstop_name` 中指定巴士名称或自治体名（如「ムーバ斯」「すぎ丸」），即可返回名称、自治体与官方网址（时刻表与路线请在各自治体官网确认）。

- **公交站查询** — `busstop_name` 搜索公交站/线路
- **车站 ⇔ 社区公交接驳（无障碍支持）** — 在 `search_route` / `search_bus` 中指定车站时，会显示该站可用的社区公交（主要 10 条线路的接驳数据：ちぃばす、哈奇公巴士、ムーバ斯、はな巴士、すぎ丸 等），支持行动不便者的「到站前/离站后」出行，并以注意提示引导确认轮椅/低地板车辆信息（附各自治体官网链接）。社区公交站之间的换乘将以 `mode: 'community_bus'` 区段返回实际路线（例：涩谷站东口 → 惠比寿站前 = 哈奇公巴士）
- **换乘搜索** — `from` + `to` 基于 `odpt:BusroutePattern` 的站点顺序构建最短换乘路线（跨线路/跨运营商换乘）
- **🚌 乘车工具优先（`vehicle`）** — 在换乘搜索模式下指定 `vehicle` 可优先该交通方式：`bus`（公交优先）/`train`（电车优先）/`community_bus`（社区公交优先）/`ferry`（水上巴士优先）/`any`（自动＝最短・默认）。若指定方式导致路线明显绕远（换乘多 2 次以上，或预计多耗时 10 分钟以上），将通过 `better_alternative` 字段建议更优路线（推荐方式、可节省换乘次数、可节省分钟数）。预计时间是基于车站数与公交站数的图模型概算，不是实时班次或道路交通时间。
- **ODPT 故障时的降级** — 当 ODPT API 不可用时，公交站查询会降级使用内置的社区公交/JR 巴士数据。综合换乘查询仍依赖 ODPT 的站点顺序数据，数据无法获取时可能无法返回路线。
- **跨方式换乘** — 公交站与车站通过经纬度关联，并与 `odpt:Station`（铁路）图合并，支持公交→电车→公交路线（例：渋谷站前→(步行)→渋谷→(电车)→新桥站前）
- **无障碍** — `odpt:BusTimetable.isNonStepBus`（无障碍低地板/无台阶巴士）按线路显示

注：换乘覆盖都营/西武/横滨市营公交及社区公交接驳（JR 巴士关东缺少站点顺序数据，故不参与换乘、仅支持公交站查询）。ODPT 不提供公交票价数据。

```
search_bus(busstop_name: "渋谷駅前")                      # 公交站查询
search_bus(from: "渋谷駅前", to: "新橋駅前")            # 公交→电车→公交 跨方式换乘
search_bus(from: "横浜駅前", to: "川崎駅前")            # 横滨→(电车)→川崎 跨方式换乘
search_bus(from: "浅草", to: "上野", vehicle: "bus")       # 公交优先（可能通过 better_alternative 建议电车）
```

### 开发与回归验证

代码变更后，请运行语法检查和多语言回归探针。`npm test` 不仅检查主要结果，也会检查 `weather_text`、`nearby_suggestions`、车站名和线路名等辅助显示字段。

```bash
npm run build        # node --check src/index.mjs
npm test             # 26 个日文/英文/中文回归用例
npm run test:bus     # 公交换乘实时 API 探针，可能因 API 状况耗时较长
npm run test:vehicle # 乘车工具优先的确定性 mock 回归
```

可以使用 `npm test` 的退出码作为 CI 质量门槛。实时公交换乘探针超时，应与确定性 mock 回归分开判断。

### 7. `search_flight` — 机场航班时刻与到达时间显示

- **机场查询** — `airport`（羽田/成田/HND/NRT 等）列出到达/出发航班
- **机场名称规范化** — 「羽田」「成田」「Haneda」「Narita」等自动归一化（去除末尾「机场/Airport/空港」，支持日英中）
- **航班号查询** — `flight_number`（NH001/JL000 等）查询特定航班
- **海外来客/归国最佳** — 指定 `destination`（如：东京站）自动建议从到达航站楼到目的地的接驳路线（电车）。未指定时，到达搜索自动显示至主要接驳车站的路线（羽田：东京站/品川/浜松町，成田：东京站/日暮里/新宿），通过 `access_routes`
- **显示项** — 航班号、航空公司、状态（准点/飞行中/已到达/取消）、航站楼、登机口、计划时间、实际时间、延误（分钟）
- **优雅降级** — 未配置 `FLIGHT_API_KEY` 时仅显示机场接驳路线（无航班时刻）

注：航班时刻需要 [AviationStack](https://aviationstack.com/) API（`FLIGHT_API_KEY`）。免费套餐仅支持当日数据，不支持日期参数（`flight_date`）。未配置时仅显示机场接驳路线。

```
search_flight(airport: "羽田空港", direction: "arrival")                        # 羽田到达航班
search_flight(airport: "成田空港", direction: "arrival", destination: "東京駅")  # 成田→东京接驳路线
search_flight(flight_number: "NH001", direction: "arrival")                    # 按航班号查询
```

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
