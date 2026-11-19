---
name: tokyo-transit-mcp
description: 公共交通オープンデータセンター（ODPT）API・気象庁JMA API・GBFS を利用した東京圏総合交通情報MCPサーバー。鉄道・バス・水上バス・フェリー・空港フライト・コミュニティバスを横断検索し、日英中3言語のAIアドバイスを提供。
category: transportation
---

# Tokyo Transit MCP Server

## 目的

公共交通オープンデータセンター（ODPT）・気象庁（JMA）・GBFS などの**無料APIのみ**を利用した、東京圏の公共交通情報をスマートに扱うMCPサーバーです。天候・運行情報を加味したAIインテリジェントアドバイスを日本語・英語・中国語で自動生成します。

## 前提条件

- **Node.js 18+**（ESM・`import` 構文。`"type": "module"`）
- リポジトリ直下で `npm install` 済み（依存: `@modelcontextprotocol/sdk`・`axios`・`adm-zip`・`dotenv`）
- APIキーはリポジトリルートの `.env` **のみ**に保存（MCPクライアントの env には入れない）。`src/config.mjs` が `src/` を基準に `.env` を解決するため、起動時カレントディレクトリに依存しない。

## 対象サービス

### 利用可能（無料）
- 鉄道: 東京メトロ・都営地下鉄・JR東日本（関東在来線）・小田急・京王・西武・東武・京急・京成・相鉄・東急・横浜市営・つくばエクスプレス(MIR)・りんかい線(TWR)・みなとみらい線・箱根登山線・北総・埼玉高速・東葉高速・芝山鉄道・JR東海・関東鉄道
- AGT・モノレール・路面電車: ゆりかもめ・日暮里舎人ライナー・東京モノレール・多摩モノレール・都電荒川線
- バス: 都営・西武・横浜市営（ODPT）＋ JRバス関東・都内コミュニティバス41自治体・千葉/埼玉/神奈川ローカルバス8社（ちばフラワー・さいたま市営・東武・西武観光・江ノ電・千葉中央・丸建つばさ・川越観光）（GTFS-JP個別取得）
- フェリー・水上バス: 東海汽船（伊豆諸島・小笠原航路）・東京クルーズ
- シェアサイクル: ドコモ・バイクシェア + ハローサイクリング（GBFS・2ネットワーク約16,500ポート）
- フライト: 羽田(HND)・成田(NRT) 到着/出発（AviationStack・任意）

### 除外（有料）
- 駅すぱあとAPI
- NAVITIME乗換検索API
- Google Transit API

## ツール一覧（14種）

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
| `get_running_status` | 交通事業者別のリアルタイム運行状況 |
| `find_nearby_stops` | 緯度経度から最寄りの駅・バス停・シェアサイクル・水上バス/フェリー港を距離順（徒歩換算・Maps リンクつき）で検索。0件時は 1km→2km→5km に自動拡大 |

## 使い方

### 1. APIキーの準備

- ODPT: https://developer.odpt.org/signup で登録し、APIキーを取得（必須）
- AviationStack: https://aviationstack.com/ で取得（任意・フライト時刻用。無料プランは当日分のみ）

### 2. 環境変数の設定

`.env`ファイルにAPIキーを設定（**コミット禁止・`.gitignore` 除外済み**）:

```
ODPT_API_KEY=取得したAPIキー
FLIGHT_API_KEY=取得したAPIキー（任意）
```

### 3. 実行

```bash
npm start
```

### 4. MCPクライアント設定

`mcp.json` に `node src/index.mjs` を登録します。APIキーはMCPクライアントの設定には記載せず、リポジトリルートの `.env` のみに保存します（`src/config.mjs` の位置基準で解決）。

```json
{
  "mcpServers": {
    "tokyo-transit": {
      "command": "node",
      "args": ["/path/to/tokyo-transit-mcp/src/index.mjs"]
    }
  }
}
```

- **Claude Code** から利用する場合は、リポジトリ直下で `claude mcp add -s project tokyo-transit -- node src/index.mjs` と登録。詳細は `CLAUDE.md` を参照。
- Hermes / Claude Desktop では上記 `mcp.json` 形式を設定に追加。

## 使用例

### 乗り換え検索（多言語）
```
search_route(from: "渋谷", to: "新宿")
search_route(from: "Shibuya", to: "Odaiba")   # 英語入力→英語で応答
search_route(from: "涩谷", to: "台场")         # 中国語入力→中国語で応答
search_route(from: "スカイツリー", to: "浅草") # 略称・ランドマーク名も解決
search_route(from: "Haneda Airport", to: "Narita Airport", language: "en") # 空港アクセス
```
ユーザーが英語（中国語）で質問した場合は `language: "en"`（`"zh"`）を**明示指定**すること。省略時は駅名から自動判定されるが、駅名が日本語のままの英語質問では判定がズレるため、クエリ言語に合わせて渡すと確実。

### 障害シミュレーション（-test モード）
`search_route` に `-test <障害種別>` を付けると、実際の外部APIを呼ばずに20種類以上の障害をシミュレーション（日英中キーワード対応）。開発・動作検証に利用。
```
search_route(from: "東京 -test 人身事故", to: "新宿")
search_route(from: "新宿 -test 台風", to: "渋谷")
search_route(from: "Tokyo -test typhoon", to: "Shinjuku")
search_route(from: "东京 -test 台风", to: "新宿")
```
津波など災害系の `-test` では安全のため自転車案内（シェアサイクル）が抑止される（`isDisasterRisk`）。

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

## 開発ワークフロー（検証コマンド）

コード変更後は必ず以下を実行して検証:

```bash
npm run build          # 構文チェック（node --check を src 配下全 .mjs に）
npm test               # 多言語回帰プローブ（26ケース・日英中）
npm run test:walk      # 徒歩連絡・同名別駅・路線データ整合性の回帰
npm run test:bus       # バス乗り継ぎ実APIプローブ（API状況により長時間化）
npm run test:issue     # イシュー回帰テスト群（#79/#80/#82/83/#84/#88-90/#91-92/#94-95）
npm run test:vehicle   # vehicle優先の決定的モック回帰
```

**重要**: MCPツール経由の確認にはサーバー再起動が必要（ホットリロードなし）。`src/` 変更後は必ず `node --check` 全モジュール → 検証プローブ（全ツール×3言語）→ `npm run build` の順で確認（詳細は mcp-transit-server スキル参照）。

## 並行作業（複数LLM）ガイド

複数のLLM/エージェントが同時に開発するための分離規約が `.claude/` 配下にあります。

- `.claude/agents/` — ドメイン別サブエージェント（`station-data` / `bus-data` / `landmark-data` / `ferry-flight-data` / `test-runner` / `code-reviewer`）。各エージェントが所有ファイルを明示し、並行編集の衝突を回避。
- `.claude/rules/file-ownership.md` — ドメイン→所有ファイルのマップ。共有ファイル（`config.mjs` / `index.mjs` / `search-route.mjs`）は単独編集＋全回帰。
- **駅名エイリアスはドメイン別セクションに分割済み**: `STATION_NAME_MAP` は `src/data/station-names-*.mjs`（core / zh-old / private-main / extra-lines / expansion237 / yokohama-chiba / disney）に分割し、`station-names.mjs` はスプレッドマージで再エクスポート。新規エイリアスは追加内容に最も近いセクションファイルへ（後勝ち）。
- `.claude/rules/parallel-work.md` — 機能ブランチ＋git worktree（`claude -w <name>`）で物理分離。`main` 直push禁止。
- `.claude/rules/testing.md` — データ追加時の同期チェックリスト（`expected-railway-counts.mjs` の期待値更新等）。実APIテスト（`test:bus`）はflakyなため決定的モック優先。
- `.claude/rules/coding-conventions.md` — stdio保護・依存方向・安全応答・多言語・曖昧性の扱い。

**要旨**: 駅・路線の駅数を変えたら `src/data/expected-railway-counts.mjs` を必ず同期更新し、`check-railway-integrity` を PASS させてからマージ。並行検証では決定的モックを優先し、実APIプローブは最終確認で個別実行。

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
3. **荒天時安全ロジック**: 台風・浸水・降雪・凍結時は自転車案内を自動非表示にし、必要に応じて避難所リンクを表示します。荒天以外は、到着地点の座標を解決でき、GBFSリアルタイム情報を取得できた場合に限り、到着地点周辺のドコモ・バイクシェア＋ハローサイクリングを案内します。利用可能台数・返却可否は変動するため公式アプリで確認してください。
4. **コミュニティバス**: 41自治体ディレクトリ＋主要10件の駅接続データ（バリアフリー案内）。時刻表・路線の詳細は各自治体公式サイトで確認してください。
5. **search_fare の `fare: null`**: JR・私鉄等 ODPT運賃対象外の**正常動作**。対応7事業者（東京メトロ・都営・横浜市営・TX・りんかい・ゆりかもめ・多摩モノレール）で検証してから「異常」と判断してください。
6. **公的機関案内（gov_facility_search_support）**: ラベル文字だけでなく実リンク（markdown）を必ず表示（リンク消失の指摘あり）。
7. **MCP stdio 保護**: `console.log` は stderr へリダイレクト済み（`src/config.mjs`）。stdout に勝手に書き込まないこと。モジュール依存方向は `handlers → advice/data/lib → config` の一方向。

## 参考リンク

- ODPT公式: https://www.odpt.org/
- CKANデータカタログ: https://ckan.odpt.org/
- APIドキュメント: https://developer.odpt.org/
- AviationStack: https://aviationstack.com/

## 品質監査・Issue追跡

- ✅ 全13ツールの `annotations`（`readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`）は `src/index.mjs` の `DEFAULT_TOOL_ANNOTATIONS` で一括注入済み（#103/#109 対応完了）。全ツール読み取り専用・副作用なし・外部データ参照のため `true/false/true/true` で統一。個別ツールに `annotations` を明示すれば上書き可能。
- ✅ MIT `LICENSE` 追加・依存関係のOSV再監査・`tests/` 配下のMCPツール自動テスト（`tests/tools-list.test.mjs`・`tests/handlers-basic.test.mjs`）は #109 で対応完了。`npm test` に統合済み。
- 現行の依存関係は `@modelcontextprotocol/sdk` 1.30.0、`axios` 1.19.0、`adm-zip` 0.6.1、`dotenv` 17.4.2。`npm audit` の結果だけでOSV判定を代替せず、package.json / package-lock.json の実バージョンを対象に再監査する（OSV querybatch API で検証、現行は0脆弱性）。
- ✅ `capabilities` に `logging: {}` を宣言し、ツール呼び出しの開始・完了・失敗を `sendLoggingMessage` で通知（#104 対応完了）。未接続・未対応クライアントでは無視される。`tests/tools-list.test.mjs` で `server.server.getCapabilities().logging` を検証。
- ✅ サーバーは McpServer + registerTool 方式（#102 対応完了）。低レベル Server + 手動 ListTools/CallTool ハンドラ + switch は廃止。各ツールの inputSchema は zod スキーマ（zod 3.25.x を直接依存に追加）。SDK が tools/list の JSON Schema を自動生成し、additionalProperties:false と required を自動付与する。`applyInputSchemaConstraints` は廃止（#106 対応完了）。
- ⚠️ この SDK バージョンでは registerTool は入力パラメータの zod 検証を**自動実行しない**（count:99 が通った）。制約は tools/list の JSON Schema に反映されクライアントに提示されるが、サーバー側での強制はハンドラ内で行う（従来の低レベル Server と同じ挙動）。
- ✅ ツール description は簡潔（最大~150文字・合計~1,200文字）に保つ（#105 対応完了）。search_flight/search_bus/get_running_status を簡潔化済み。詳細ガイダンスは description に詰め込まず、必要なら annotations/_meta/resources へ。
- ✅ エラー応答の `isError: true` は `src/lib/common.mjs` の `jsonResponse` で `data.status === 'ERROR'` を検知して自動付与（#101 対応完了）。`handleApiError` も isError 付きを返す。`jsonResponse(handleApiError(...))` のような二重ラップは isError が失われるため禁止（flight.mjs 修正済み）。正常応答には isError を付けない。
- `scripts/` の実データプローブと、`tests/` に置く決定的な自動テストを区別する。外部スキャナーが認識する通常テストは `tests/` に置く。
- Issue本文を修正しただけではクローズせず、実装と受け入れ条件が検証済みの課題だけをクローズする。

## 更新履歴

### v2.58.32（2026-11-19）— 曖昧駅の候補表示ラベルをそのまま再入力可能に修正

- 路線健全性チェック（126路線×隣接1区間）で発見: search_route が同名別駅（両国・小川町・霞ヶ関ほか7駅）で
  表示する候補ラベル「両国（JR総武線）」はグラフの実キーでなく、再入力すると STATION_NOT_FOUND、
  基本名を再入力すると再び候補提示に戻る袋小路だった（15候補ラベル中7ラベルが再入力不能・実測）。
- resolveStation が「駅名（路線名）」括弧形式（全角・半角括弧両方）を路線ヒントとして解決するようにした。
  実キー（両国（大江戸線）など括弧付き正式キー）は従来どおり完全一致が優先され、挙動不変。
- ついでに発見した潜在バグを修正: 路線ヒント「東京メトロ」は normalizeLineHint で空文字列になり、
  `X.includes('')` が常に真となるため全候補に誤マッチしていた（実測: 霞ヶ関 東京メトロ）。
  正規化後が空の比較を行わないガードをスペース形式・括弧形式の両方に入れた。
- 霞ケ関/霞ヶ関（ケ/ヶ U+30B1/U+30F6）の表記揺れにも対応（括弧形式の基本名で入れ替えを試す）。
- 検証: tests/v25832-regression.test.mjs（19アサーション）— 7曖昧駅15候補ラベル全件の再入力可能性、
  従来挙動の不変性（基本名は候補提示・実キーは直接解決）、search_route のエンドツーエンド
  （案内ラベルをそのまま再入力 → 1区間の経路が見つかる）を検証。

### v2.58.31（2026-11-19）— find_nearby_stops にシェアサイクル・水上バス/フェリー港を追加

- `type` を5値に拡張: `station` / `busstop` / **`bike`** / **`ferry`** / `all`（既定 all は全種別を同時返す）。
- シェアサイクル: GBFS（docomo-cycle-tokyo + HELLOCYCLING・CC BY 4.0）から貸出可能（is_renting かつ台数>0）なポートだけを距離順で返す。貸出可能台数・返却空枠つき。fetchBikeShareData の既存キャッシュを再利用。
- 水上バス・フェリー: フェリーGTFS の stop 座標から最寄り乗り場を計算。水上バス（東京クルーズ6港）とフェリー（東海汽船ほか）を kind で分離し、節を分けて表示。座標なしのハードコード代替港は対象外。fetchFerryData の既存キャッシュを再利用。
- 障害時の縮退: 駅は内蔵座標で縮退応答（従来どおり）。シェアサイクル/港が取得不能のときは単一 type 指定なら `DATA_UNAVAILABLE`（ERROR）、type=all なら他種別を返しつつ ⚠️ 注記で明示（副次データソースの失敗で全体を失敗させない）。
- 要約行を一般化: 全種別が同半径なら一行形式、異なれば種別ごとに実効半径を併記（例: 「駅2件（半径1km内）・水上バス1件（半径5km内）」）。
- 検証: tests/nearby-stops.test.mjs を87アサーションに拡張（bike の貸出可否フィルタ・拡大ラダー・kind 分離・3種別の縮退を決定的に検証）。probe-all-lang に実データ2ケース追加（渋谷で最寄り docomo ポート、浅草で水上バス浅草乗り場を確認）。

### v2.58.30（2026-11-19）— 位置情報から最寄りの駅・バス停を検索する `find_nearby_stops` を追加（#121）

- 新ツール `find_nearby_stops`（14個目）: 緯度経度から半径内の駅・バス停を距離順で返す。要約行（件数）・距離・徒歩換算（80m/分）・乗り入れ路線（駅）・事業者と系統数（バス停）・Google Maps リンクを各項目に付ける。
- 0件時は 1km→2km→5km に段階的に自動拡大し、拡大した旨を応答に明示する（海上・対応エリア外は NO_DATA）。
- ODPT 障害時: 駅は内蔵座標辞書（STATION_COORDS + EXTRA・1,487駅）で縮退応答し `station_source: internal` で明示。バス停は `DATA_UNAVAILABLE`（type=busstop）または注記付き（type=all）で「現在取得できません」を明示。
- `fetchBusStopGeo` に停留所ごとのポール数・系統数（odpt:busroutePattern のユニーク数）・公式英語名（title.en）・読み（odpt:kana）を追加（既存消費者は lat/lon/operator のみ読むため後方互換）。英語名の長音記号は NFD で ASCII へ折りたたみ、title.en が無い停留所は読みを自前ローマ字化（kana-romaji）。
- プライバシー: 入力座標はリクエスト処理以外に使わない。キャッシュ書き込み・ログ出力なし（回帰テストでキャッシュキー不変を検証）。
- 検証: `tests/nearby-stops.test.mjs`（58アサーション・注入 fixture で完全決定的）+ `scripts/probe-all-lang.mjs` に4ケース追加（白鬚橋付近 35.731,139.8148 の実データで最寄りバス停が水神前になることを確認）。

### v2.58.29（2026-11-14）— 残りを人手キュレーション用 CSV に切り出し（404 → 408 件 / 81.9%）

- 路線名つき駅名の停留所（大江戸線蔵前駅→Kuramae Station、京成町屋駅→Machiya Station、上野駅入谷口→Ueno Station Iriya Exit、北赤羽駅浮間口→Kita-Akabane Station Ukima Exit）を駅辞書から生成（+4 件）。
- 残り 90 件は **`docs/bus-en-todo.csv`（ja,en,zh,municipality,bus,official_url）** に書き出し、`npm run bus:en:import` で取り込む方式にした。自治体の公式サイトを見て en/zh を記入するだけで反映される（空欄行は無視、ASCII 以外は拒否）。
- 自治体サイトは日本語のみ（台東区めぐりんのページを実測確認）、ODPT・Wikipedia にも当該停留所が無いため、機械で埋めると誤りになる。

### v2.58.28（2026-11-14）— ODPT の公式英語名でバス停を補完（388 → 404 件 / 81.1%）

- **ODPT `odpt:BusstopPole` に公式の英語名と読みがある**ことを発見（`title.en`＝"Nitemmon (Nitemmon Gate)"、`odpt:kana`＝にてんもん）。Wikipedia に記事が無い停留所の正解はここにあった。`scripts/fill-bus-en-odpt.mjs`（`npm run bus:en:odpt`）を追加し +16 件。
- 事業者は BUS_OPERATORS + KeioBus / NishiTokyoBus / OdakyuBus / TokyuBus / SotetsuBus の計 6,696 停留所を索引化。
- ODPT の英語名は長音記号付き（Ōmon / Kōkō）なので **NFD で ASCII に正規化**。
- `odpt:kana` からのローマ字は語間が崩れるため、第四小学校前→Daiyon Elementary School-mae、市立病院入口→Shiritsu Hospital Entrance、キヤノン本社通用門前→Canon HQ Main Gate は手修正。
- 残り 94 件はコミュニティバス独自の停留所（台東区めぐりん・荒川区・あきる野・国立・小金井など）で ODPT にも Wikipedia にも存在しない。

### v2.58.27（2026-11-14）— バス停の英語表記 376 → 388 件（77.9%）

- 「地名 (自治体)」の形で町名記事を引く方式（`fill-bus-en-search.mjs`、`--no-search` で検索 API を回避）を実装し +12 件。清川一丁目→Kiyokawa 1-chome、竜泉三丁目→Ryusen 3-chome、堀ノ内三丁目→Horinouchi 3-chome など。
- 2 つの取りこぼしを修正: (1) `extracts`（explaintext）は太字マークアップが落ちるので `'''` を任意扱いにする (2) 前方一致は「記事名が地名で始まる」方向のみ許可（逆方向を許すと「橋場老人福祉館西」に「橋場」の読みを当てて字が落ちる）。
- 語中の `ou` は形態素境界を壊す（ほりのうち→horinochi）ため、`simplify(s, {ouAtEndOnly:true})` を追加して語末だけ縮約。
- 機械生成で語間が崩れる 2 件（一葉記念館入口・鳥越神社前）は OVERRIDE で手修正。
- 残り 110 件は町名記事自体がない／施設名で読みの出典がないもの。日本語のまま。

### v2.58.26（2026-11-14）— バス停名の検索ベース解決ツール（データは据え置き）

- `scripts/fill-bus-en-search.mjs`（`npm run bus:en:search`）を追加。Wikipedia の**検索**で地名記事の候補を出し、記事タイトルが地名と前方一致し、かつ冒頭の振り仮名が取れたものだけ採用する。記事タイトル推定方式（`fill-bus-en-wiki.mjs`）が「清川→姓の記事」「堀ノ内→堀之内（中世）」のような誤読を拾う問題への対処。
- **このセッションでは実行できず**（Wikimedia が同一 IP に 429 を返し続けた。検索 API も同様）。データは 376/498（75.5%）のまま。
- 使い方: 時間をおいて `npm run bus:en:search -- --dry` で結果を確認 → `--` 無しで適用。冪等。

### v2.58.25（2026-11-14）— バス停の自治体名＋役所を辞書から生成（366 → 376 件）

- 「港区役所前」「立川市役所」のような停留所は `MUNICIPALITY_DISPLAY_NAMES`（港区→Minato City 等）から決定論的に作れるため、`fill-bus-en.mjs` に自治体ルールを追加（+10 件、75.5%）。
- **残り 122 件は自動化できないと結論**。実測で内訳は (a) 記事が存在しない（港区役所・二天門・吉原大門・立川市役所） (b) 同名の別記事に飛ぶ（清川→姓の記事、堀ノ内→堀之内=中世武士の館）で、**読みを拾うと誤りになる**。人手のキュレーションか ODPT の英語データが必要。
- `fill-bus-en-wiki.mjs` に `--limit=N` / `--slow` を追加（Wikimedia のバースト制限対策）。

### v2.58.24（2026-11-14）— search_route の CANCELLED 統一・シェアサイクルの signal 対応

- `searchRoute` の本体を `searchRouteInner` に分離し、外側で**キャンセルを統一**。内部の取得は `Promise.allSettled` のため中断が例外にならず「縮退した SUCCESS」を返していた（bus / running-status と挙動が不揃い）。signal 中断時は必ず `CANCELLED`。
- `findNearestBikeStations(..., signal)` を追加し、GBFS 取得（`fetchBikeShareData`）まで渡す。中断時は即座に空で返る。
- 実測: 事前 abort 0ms / 実行中 abort 335ms / signal 無しは SUCCESS のまま。

### v2.58.23（2026-11-14）— バス停読み取りの取りこぼし修正（リダイレクト追従・冒頭 4,000 字）

- `fill-bus-en-wiki.mjs` の 2 つの取りこぼしを修正:
  (1) `redirects=1` で返るページのキーは**転送先**タイトルなので、転送元→転送先の対応表を持って引く（無いと「清川→清川 (台東区)」のような記事が全部空振り。実測 0 件の原因）。
  (2) 記事冒頭の読み取り窓を 300 → 4,000 字に拡大（Infobox テンプレートが長い記事で読みに届かない）。
- データ自体は据え置き（366/498 = 73.5%）。残り 131 件は **Wikimedia のレート制限**でこのセッション中に取り切れず。`npm run bus:en:wiki` は冪等なので、時間をおいて数回実行すれば埋まる。

### v2.58.22（2026-11-14）— 駅読み 100% 被覆（1,476/1,476）

- 自動抽出で残っていた 27 駅を、**根拠つきの人手表** `scripts/fill-station-readings-curated.mjs`（`npm run readings:curated`）で固定。表には各読みの典拠（Wikipedia 記事名／Infobox のよみがな／記事内の記述）を併記。
- 自動で取れなかった理由は 3 系統: (1) 曖昧さ回避ページ（日本橋・平井・市ケ谷など） (2) 駅名と記事タイトルが違う（阿佐ヶ谷→阿佐ケ谷駅、麴町→麹町駅、佐貫→龍ケ崎市駅） (3) 複数駅の共同記事（永山駅・多摩センター駅・勝田台駅）。
- 停留場の読みは**接尾辞を閉じ括弧の直前でのみ採用**しないと「おおつかえきまえ→おおつか」になり JR 大塚と衝突する（実測）。表では おおつかえきまえ / おうじえきまえ / まちやえきまえ を明示。
- 結果: 欠落 27 → 0（カバレッジ 98.2% → **100%**）。かな入力の往復は 1,441 件が駅名一致・35 件が同名別駅の候補提示・破綻 0。

### v2.58.21（2026-11-14）— キャンセルの HTTP 貫通（bus / running-status / search-route）

- v2.58.16 で `get_timetable` / `search_flight` は対応済みだったが、`search_bus` / `get_running_status` / `search_route` は「CANCELLED を返すだけで通信は完走」だった。
- bus は内部タイムアウト用の AbortController しか持っていなかったため、**`AbortSignal.any([内部, 外部])` で合成**して 4 本の取得（BusroutePattern / BusTimetable / BusstopStationLinks / StationGeo）に渡す。外部キャンセル時は「タイムアウト→空データで継続」にせず外へ投げ、`CANCELLED` を返す。
- running-status は 6 本の取得（JR東日本・東武・京急のスクレイピング、odpt:Railway、odpt:TrainStatus、GTFS-RT）に signal を通し、キャンセルは「未取得」に縮退させず `CANCELLED`。
- search-route も 3 本（odpt:Station / GBFS / odpt:TrainInformation）に signal を追加。
- 実測: 事前 abort で search_bus 223ms / running-status 1〜3ms、実行中 abort で search_bus 277ms（従来は 30 秒ブロックで通信継続）。

### v2.58.20（2026-11-14）— プローブのレート制限リトライ（テストの flake 解消）

- `npm test` の live probe が ODPT のレート制限で `search_fare` / `get_timetable` の en/zh を 4 件 FAIL にすることがあった（同じコードで 3 分後に 29/29）。**コードの退行とインフラの揺らぎを混同しない**ため、`src/lib/probe-retry.mjs` を追加。
- リトライ対象は `API_TIMEOUT`（429/timeout）/ `NETWORK_ERROR` / `API_SERVER_ERROR` / `CIRCUIT_BREAKER_OPEN` と、メッセージに 429・timeout・breaker を含むものだけ。`INVALID_INPUT` や `NO_ROUTE` は再試行しない（隠蔽を防ぐ）。
- 待機は 5s → 15s、初回 + 2 回まで。probe は `↻` 行でリトライを可視化する。

### v2.58.19（2026-11-14）— バス停の英語表記 295 → 366 件（73.5%）

- 残っていた「読みの推定が要る 203 件」を、**Wikipedia の記事冒頭の振り仮名から読みだけ取り、ローマ字化は自前実装**で行う方式で 71 件補完（366/498 = 73.5%）。
- `src/lib/kana-romaji.mjs` を新設（ヘボン式・促音・ん・長音簡略化）。駅読み 1,449 件 × 駅名英字表記で **94.1% 一致**することを自己検証に組み込み、テストで下限 93% を固定。
- `scripts/fill-bus-en-wiki.mjs`（`npm run bus:en:wiki`、`--dry`）を追加。接尾辞は**かなの末尾で切り分ける**ので「隅田公園→Sumida Park」「浅草警察署前→Asakusa Police Station-mae」「府中競馬正門前駅→Fuchu Keiba Seimon-mae Station」のように出る。読みが取れない 132 件は日本語のまま（推測で埋めない）。
- 実測の改善例: 三ノ輪二丁目→Minowa 2-chome（pykakasi は San no wa）、芝浦四丁目→Shibaura 4-chome、台東病院→Taito Hospital。

### v2.58.18（2026-11-14）— コミュニティバス停留所の英語表記 12 → 295 件

- 41 社・停留所 498 件のうち en 表記は 12 件（2.4%）だけだった。停留所名の大半は「◯◯駅前」「◯◯駅北口」＝駅名＋接尾辞なので、駅名辞書 `STATION_DISPLAY_NAMES` から**決定論的に**生成する `scripts/fill-bus-en.mjs`（`npm run bus:en`、`--dry` あり、冪等）を追加し **283 件を補完**（295/498 = 59.2%）。
- **読みの推定が要る 203 件は機械翻訳しない**と決めた。実測で pykakasi は「堀ノ内→Hori no Nai」「三ノ輪→San no wa」「イオンモール→Ionmooru」「芝中団地中央→Shiba Chuudan Chichuu Ou」、LLM は「柴崎町→Kibazaki」「町田→Matsuda」と外した。誤った英語より日本語のままの方がまし。
- 既存 221 件の手修正は保持（マージして kana 順に再生成）。辞書は 504 件・en/zh 全件あり。

### v2.58.17（2026-11-14）— 駅読みの欠落 74 → 27 駅（カバレッジ 98.2%）

- 曖昧さ回避ステージを作り直した。**wikitext を `prop=revisions` で 40 タイトルずつ一括取得**し、行「[[◯◯駅 (東京都)|◯◯駅]] … 路線名」から路線名一致で候補を選び、**選んだ候補だけ** `prop=extracts` でまとめ取り（20 件/リクエスト）する 3 段構成。
- 読みの接尾辞に **`ていりゅうじょう`（停留場）** を追加。都電荒川線の停留場 21 駅が一度に解決した（`あらかわいっちゅうまえ` 等）。
- 記事が曖昧さ回避でない場合は `'''◯◯駅'''（よみえき）` を冒頭から拾う経路を追加（市ヶ谷→市ケ谷駅のような表記差も variants で吸収）。
- 実測: 読み 1,249 → **1,449 件**（欠落 220 → **27 駅**、カバレッジ 84.9% → **98.2%**）。全 1,449 件が `resolveStation(reading)` で駅に解決することをテストで固定（しきい値 97% / 1,440 件に引き上げ）。
- 残り 27 駅は「永山駅」「多摩センター駅」のような共同駅記事・廃駅・ディズニーリゾートラインの長い駅名など、記事タイトルが駅名と一致しない系統。`npm run readings:fill` を時間をおいて回すか、個別に辞書へ追記する。

### v2.58.16（2026-11-14）— キャンセルを HTTP まで貫通させる（AbortSignal の横断）

- MCP の `notifications/cancelled` で `runTool` が早期に `CANCELLED` を返しても、**handler 内の HTTP は完走していた**（31 秒ブロックの実測）。→ `runTool` が `handler(args, { signal })` を渡し、`get_timetable` / `search_flight` が `axios` と 429 バックオフ待ちを中断する。
- `abortableSleep(ms, signal)` を追加し、`retryOnRateLimit` が待機中でも中断に応答するようにした（従来は最大 30 秒のバックオフを待ち切った）。
- handler はキャンセル時に API エラーではなく `status: 'CANCELLED'` を返す（`isError: true`）。
- 実測: 事前 abort で `get_timetable` 3ms / `search_flight` 即時、実行中 abort で 173〜309ms に短縮（従来は 15〜31 秒）。

### v2.58.15（2026-11-14）— 駅名の読み（かな）の欠落 220 駅を 74 駅まで補完

**背景**: `STATION_READINGS` が 220/1,476 駅（14.9%）欠落していた（監査で実測）。かな入力（「うえの」「アサカ」）は読み辞書を優先するため、欠落駅はローマ字索引へのフォールバックになり精度が落ちる。

**やったこと**
- `scripts/build-station-readings.mjs` を丸ごと再生成したところ、Wikipedia のレート制限と曖昧さ回避ページの増加で **1,249 → 1,109 件に退行**した（実測・5分13秒）。
- そこで**欠落分だけを足す** `scripts/fill-station-readings.mjs` を追加（既存は保持してマージ）。取得は (1)「◯◯駅」記事冒頭 → (2) 識別子を外した基本名 → (3) 曖昧さ回避ページの候補から路線名一致で選択 → (4) かなだけの駅名はそのまま、の順。
- 記事タイトル直後の括弧を最優先するよう読み抽出を修正（従来は「候補が 1 つだけ」が条件で、本文に別の読みが混ざる記事＝大塚駅などが拾えなかった）。曖昧さ回避記事は本文が基本名で始まるため、識別子を外した前方一致も見る。
- `build-station-readings.mjs` に**件数ガード**を追加（生成結果が既存より少なければ書き込まず exit 1、`--force` で上書き）。

**結果**
- 読み 1,249 → **1,402 件**、欠落 220 → **74 駅**、カバレッジ **84.9% → 95.0%**。
- 全 1,402 件が `resolveStation(reading)` で駅名に解決できることをテストで固定（かな入力の往復）。
- 残り 74 駅は同名別駅（三田・大塚・日本橋など）が中心で、Wikimedia のレート制限で連続実行できないため次回に持ち越し。`npm run readings:fill` で再開できる。

### v2.58.13（2026-11-14）— CI の初回実行で見つかったテストの誤判定を修正

- `tests/v25811-regression.test.mjs` の「ODPT に到達できるか」の判定が `structuredContent` の有無だけで、**ERROR 応答でも到達可能と誤判定**していた。GitHub Actions（キー未設定・外部ネットワーク無し）ではこれが原因で NO_DATA 系のアサーションが ERROR で落ち、CI が赤くなった（実測: v2.58.12 の初回 CI 実行が failure）。
- 判定を `status === 'SUCCESS'` かつ `ODPT_API_KEY` が設定されている場合に限定し、未到達時は通信系の検証を SKIP する。CI では SKIP して緑、ローカル（キーあり）では従来どおり全項目を検証する。
- 機能変更なし（テストのみ）。

### v2.58.12（2026-11-14）— 監査バッチ3: 言語判定の誤判定・ゲートの骨格・CI・outputSchema

**言語判定**
- zh の語彙リストから日本語の常用語（時間・最近・問題・銀行・種類・多少・資料）を削除し、字形リストからも日本語と共通の `号`・`選`・`種` を除外。「新宿 時間」「池袋 問題」「浅草 種類」が zh 判定されていた（実測 16 ケース中 6 件 FAIL）。判定は簡体字専用字と中国語にしか無い語に限定し、全 1,468 駅名が ja 判定のままであることをテストで固定。

**ゲート（CI の土台）**
- `check-railway-integrity`: `process.exit` が 1 箇所も無く、期待駅数と実データが食い違っても常に exit 0 だった → 不整合があれば exit 1（負のテストで検証）。
- `check-line-geometry`: 常時 exit 1 でゲートとして機能していなかった → `scripts/geometry-baseline.json` にカテゴリ別の既知件数（gap 19 / cv 18 / side 13 / mono 33 / cross 0 / coord 0）を持たせ、**増えた分だけ fail**。`--update-baseline` で更新、`GEOMETRY_STRICT=1` で従来の厳格動作。
- `.github/workflows/ci.yml` を追加（build + オフライン回帰 12 本 + データゲート 5 本。外部 API 不要）。CI に載せられることを確かめるため、プロキシを死んだアドレスに向けて全テストを実行し、通信なしで通るものだけを採用。

**MCP 仕様**
- 13 ツールすべてに `outputSchema` を追加（`status` 必須・`additionalProperties: true`）。従来は 13/13 未定義で、クライアントが `structuredContent` を検証できなかった。SDK 1.30 は Zod（または生の shape）を要求するため `.passthrough()` を使う。MCP 経由の実呼び出しで SUCCESS / NO_DATA の両方が検証を通ることを確認。

### v2.58.11（2026-11-14）— 監査バッチ2: 座標衝突・時刻表の取得範囲・ferry 誘導・NO_DATA 統一

**データ**
- 座標キー「大島」の衝突を解消。伊豆大島港と都営新宿線「大島」駅が同じキーで 107.8km 離れた別地点を指し、`weather.mjs`（EXTRA 優先＝駅）と `search-route.mjs`（本辞書優先＝港）で解決先が反転していた。港側を `大島（伊豆大島）` に改名して名前空間を分離（駅は `STATION_COORDS_EXTRA` の `大島`）。

**時刻表（性能・正確性）**
- `railway` フィルタを「取得」にも適用。従来は全 21 路線 × 2 calendar = 42 本を無条件取得し（実測 45req / 57.8MB / 2.5s）、JR 指定でも 55MB 捨てて NO_DATA を返していた。ODPT 対象外の路線名は取得せず即 NO_DATA（実測 56〜137ms）、対象路線は 2 本だけ取得（銀座線フィルタ実測 472ms）。
- 取得を `retryOnRateLimit` 配下（同時 3・最小間隔 120ms・総予算 20 秒）に置き、無制限並列をやめた。
- **部分失敗（429 等で一部の路線だけ落ちた）スナップショットをキャッシュしない**。従来は全滅時のみ捨てていたため、25% 欠けたデータが 1 時間「正常」として返り続けた。応答に `partial` / `missing_sources` を明示。

**乗り物選択の整合**
- `search_bus` の `vehicle:'ferry'` は乗り継ぎグラフに ferry 辺が 0 本で絶対に達成不能だった（黙って鉄道経路へ差し替え）。港名がバス停名と衝突する（江東区の「大島」等）ため辺は張らず、`status: NO_DATA` + `redirect_tool: search_ferry` で明示的に誘導する。

**空結果の語彙統一**
- 「データ無し」が `NO_DATA` / `NOT_FOUND` / `SUCCESS + null` / `SUCCESS + available:false` の 4 語彙に分裂していた。`search_fare`（該当運賃なし）・`search_ferry`（航路なし）・`search_bus`（経路なし）を `NO_DATA` に統一（`isError` は付けない＝失敗ではなく「該当なし」）。

### v2.58.10（2026-11-14）— 監査バッチ1: 運行情報パーサのフィールド誤りと 429 無防備の修正

**運行情報（最重要）**
- GTFS-RT Alert のフィールド番号が公式 proto と全てずれていた（header=8/desc=10/informed_entity=4/effect=6/cause=5）。実フィード（東京メトロ 247B/1alert）では存在するフィールドが 5,6,7,10,11 のみで、header 空・routes 空・effect と cause が入れ替わっていた。→ header_text=10 / description_text=11 / informed_entity=5 / cause=6 / effect=7 に修正。運行情報の詳細文と路線別情報が復活した。
- route_id が路線名に解決できない場合（ODPT は "4" のような数値 ID を返す）は「全線」へフォールバック（"4・5・9" のような意味不明な表示を防ぐ）。

**レート制限・障害時の挙動**
- `get_operator_routes` が素の axios.get で 429 をリトライしなかった（`npm test` の FAIL 2 件の原因）→ `retryOnRateLimit` 配下に置き、失敗時は内蔵 RAILWAY_LINES から路線一覧を組み立てて `degraded: true` で返す。
- `retryOnRateLimit` に総予算（既定 20 秒）と 1 回の待機上限（5 秒）・ジッタを導入。実測 31,136ms ブロックしていた 429 退避が上限付きになる。Retry-After は数値と HTTP-date の両方を解釈。
- CircuitBreaker の OPEN→HALF-OPEN 遷移で探査フラグを立てておらず、同時 2 件が通過していた（実測 5 回中 2 件）→ 遷移時に 1 件だけ通す。報告漏れがあってもクールダウン経過後に探査が復活する（恒久停止の解消）。

**スキーマとデータ**
- `get_station_info.operator` の enum に非鉄道 28 事業者（ゆりかもめ・都電・各バス・フェリー2社）を追加。`list_transit_operators.type_filter` に bus / ferry を追加（18 社に到達できなかった）。
- 「仙川」の英語名 Senkawa（千川と衝突）→ Sengawa。
- JR埼京線に「さいたま新都心」を追加（19→20駅、期待駅数も同期）。

### v2.58.9（2026-11-10）— かな入力対応とデータ不整合の修正（駅列切断・表記分裂・英語名の誤字）

**かな入力の対応**
- ひらがな・カタカナの駅名入力（例: 「うえの」「アサカ」）が一切解決できなかった不具合を修正。駅名の読み辞書（1,249駅）とローマ字表示名からの索引の2段構えで解決し、同音異字（仙川=せんがわ／千川=せんかわ）も区別する。候補が複数ある場合は従来通り曖昧提示。

**データ修正**
- JR総武線各停が「千葉」で途切れていた（東千葉・都賀・四街道・物井・佐倉 がグラフに無い）→ 追加し 22→27 駅に。千葉→佐倉 が直通（5駅・13分）で解決
- 同一駅「茅ケ崎」が 茅ヶ崎／茅ケ崎 の2ノードに分裂 → 公式表記「茅ケ崎」に統一（5路線の単一ノードに）
- 南阿佐ヶ谷 の座標欠落（座標辞書が大文字表記）を修正
- 英語名の誤字 35 件修正（仏子=Buko→Bushi、反町=Torimachi→Tammachi、和田町=Wadacho→Wadamachi、国府台=Kofudai→Kounodai 等）
- 実在しない駅「川和中央」「東新田」を辞書から削除
- コミュニティバスの駅エントリ3件を実ルートに整合、小田急バスの停留所一覧に「二子玉川駅」追加

**コード修正**
- 同一駅・同一港・空白入力なのに SUCCESS を返していた search_route / search_fare / search_ferry / search_bus に INVALID_INPUT ガード
- get_weather で「大阪」「京都」「名古屋」等の地名が東京(130000)の天気を返す不具合を修正（全国の府県名・主要都市を予報区マップに追加）
- get_running_status で operator キー（all / jreast）により英語応答になっていたのを修正
- getJstDateStr(new Date(NaN)) が例外を投げるのを修正、GTFS 生時刻（11:00:00 / 34:59:00）を正規化
- getDisplayLineName('線') が都営新宿線に誤ヒットするのを修正、半角カナ・句読点のみの入力の言語判定を修正
- CircuitBreaker の HALF-OPEN が全並列を許可していたのを探査1件に制限
- バスの community_bus 区間が後続の bus 区間を飲み込む表示バグを修正

**検証**: `npm test` 29/29 PASS（新規回帰 tests/v2589-regression.test.mjs 込み）、`check-railway-integrity` 全126路線 OK、`check-ghost-transfer` 未分離0件、`audit-same-name-stations` 欠落0件、`test-walk-transfer-stations` ALL PASS

### v2.58.8（2026-10-29）— 監査で発見した不都合の修正（GTFSキャッシュTTL・多言語判定・駅座標・幽霊乗換防止など）

- GTFS zip メモリキャッシュに TTL 判定を追加（期限切れでディスク/ネットワークへフォールバック）
- GTFS-RT `translatedText` で language='ja' を優先選択
- `reverseStationName` を import 時に O(1) Map 構築へ変更
- `detectLanguage` の中国語語彙から日英と共通の語（地震/人身事故/信号故障/降雪/` bus`）を除去
- gtfs-bus-worker の停名用と系統用の `seen` Set を分離
- 座標欠落35駅を STATION_COORDS_EXTRA に追加（Wikipedia 座標）
- 阿佐ヶ谷の表記揺れ（南阿佐ケ谷→南阿佐ヶ谷）を統一、STATION_COORDS の重複キー4件を削除
- landmarks `railway_museum` の駅名を `鉄道博物館` に訂正
- station-info の ODPT 応答に Array.isArray ガードと optional chaining を追加
- bus: transfer NOT_FOUND の `buses` 参照を除去、`fetchBusstopPoleTimetables` を retry/breaker 対応に
- running-status: JR East パース0件を throw（公式ページ縮退）
- ferry: 全ライブソース失敗時に短TTL（5分）で再試行
- timetable: truncated スナップショットをキャッシュしない
- index: `resolveErrLang` を busstop_name/operator/airport 等まで拡張
- csv: RFC4180 準拠の引用符開始判定

**検証**: `npm test` 29/29 PASS、`check-railway-integrity` 全126路線 OK、`check-ghost-transfer` 未分離0件、`test-walk-transfer-stations` ALL PASS、`audit-same-name-stations` 3/3 OK

### v2.58.7（2026-10-20）— バス経路探索の性能改善（57.4秒→93ms）と ODPT レート制限対策

`probe-all-lang` の実行時間が 2分42秒 → 14秒（12倍）になり、タイムアウトによる不安定な失敗（29件中4〜10件 FAIL）が解消しました。

**最大の原因: `normalizeStationName` の線形走査（`src/handlers/search-route.mjs`）**

`STATION_DISPLAY_NAMES`（約2,000駅）の全エントリを毎回走査していたため、バス経路探索では停留所名の正規化が約76,000回発生し（=1.5億回の文字列比較）、`buildTransferGraph` だけで **57.4秒**を要していました。逆引き Map を構築し O(1) で引くようにした。

```
buildTransferGraph: 57,411ms → 93ms   （ノード数7,618・結果は同一）
search_bus 1回      : 58秒 → 0.4秒
probe-all-lang 全体 : 2分42秒 → 14秒
```

**その他の改善**

| 内容 | 詳細 |
|---|---|
| GTFS zip のディスクキャッシュ | `.cache/gtfs` に zip を保存し、プロセス再起動をまたいで再ダウンロードを回避（9事業者・27MB） |
| GTFS ソースの並列化 | 9事業者の zip 取得・ワーカーパースを逐次から並列へ（`Promise.all`、マージ順は operatorId ソートで安定化） |
| ODPT レート制限対策 | 同時接続数3・最小リクエスト間隔120ms のセマフォと、429時の指数バックオフリトライ（最大5回・1s→2s→4s→8s→16s）を追加 |
| ブレーカーの429除外 | 429（レート制限）は回復可能な一時障害のため失敗カウントに含めない（404/410 と同様の扱い） |
| キャッシュTTL延長 | バス時刻表（ノンステップ情報、1社7.5MB）を10分→1時間へ |

**検証**: `npm test` 3回連続 29/29 PASS、probe-all-lang 10回連続 29/29 PASS、`check-railway-integrity` 全126路線 OK、`check-ghost-transfer` 未分離0件、`test-walk-transfer-stations` ALL PASS、`audit-same-name-stations` 3件中全てOK、`test-bus-routes-expansion` ALL PASS

### v2.58.6（2026-10-20）— 大宮駅の誤座標を訂正し、路線幾何検査の乖離系を全件解消

`check-line-geometry.mjs --wikipedia --all-stations`（Wikipedia/Wikidata 参照のフル走査）で|大宮|の座標が実位置から約3kmずれていたことを検出しました。

- **大宮駅の座標を訂正**: `35.908095, 139.656606` → `35.906278, 139.623833`（Wikipedia infobox、埼玉県さいたま市大宮区錦町）

**検査結果（Wikipedia 有効時の最終状態）**

```
                              修正前   修正後
[4] 共通路線との駅順矛盾        1件     0件
[5] ローカル座標 vs Wikidata乖離  1件     0件
[6] Wikipedia 記事なし          3件     0件
検出合計                       101件    83件
```

残る83件はすべて「隣接駅間乖離」「路線連続性低下」「弦不整合」「単調性違反」であり、快速/複線路線における正当な駅スキップと、路線方位が方位不变の曲線であることに起因する検出です（例: JR総武線各停の津田沼→幕張本郷は南東方向の屈曲、JR京葉線の二俣新町→南船橋は東南方向）。

**検証**: 回帰テスト `tests/line-geometry-regression.test.mjs` に大宮座標の照合を追加

### v2.58.5（2026-10-20）— 実在しない駅名と路線駅順の誤りを修正

`scripts/check-line-geometry.mjs`（座標に基づく路線幾何検査）が出力した検出を Wikipedia 日本語版と突合し、**実在しない駅名を含む路線データ**を修正しました。

| 路線 | 内容 |
|---|---|
| 横浜市営地下鉄グリーンライン | 実在しない「**川和中央**」「**東新田**」を含み、駅順も逆だった（センター南/センター北・北山田/東山田の前後が Wikipedia と逆）→ Wikipedia の正順10駅（G01 中山〜G10 日吉）へ修正。ブルーラインとの共通5駅の前後関係も矛盾（乖離4.87km）していた |
| 京王高尾線 | 「**目白台**」は Wikipedia 記事が存在しない表記 → 正しくは「**めじろ台**」（KO50、八王子市めじろ台一丁目）。座標と英中表示名も追加 |
| 東武宇都宮線 | 実在しない「**栃木**」駅が混入し、野州大塚→栃木→壬生 で弦が折り返していた → Wikipedia の正順11駅（TN-12 新栃木〜TN-40 東武宇都宮）へ修正。※「栃木」自体は東武日光線には実在するため、日光線側の「栃木」站は保持 |

**検査結果の改善**（`check-line-geometry.mjs`）

```
検出合計          101件 → 85件
共通路線との駅順矛盾   1件 →  0件
座標乖離               1件 →  0件
```

残る検出は JR湘南新宿ライン・JR東海道線・JR横須賀線などの快速/複線路線における正当な駅スキップ（各路線の停車駅集合が異なるため）。

**検証**: 回帰テスト `tests/line-geometry-regression.test.mjs` を追加し `npm test` に組み込み

### v2.58.4（2026-10-20）— 共通ロジック層とハンドラ層の実測不具合を修正

共通ロジック層（12件）とハンドラ層（20件）のコード監査で実測確認した重大度の高い不具合を修正しました。

**共通ロジック層**

- [重大] `getDisplayLineName` の部分一致による無関係な路線への誤答（「東京」→"Tokyo Metro Ginza Line"、「JR」→"JR Yamanote Line"、「池袋」→"Seibu Ikebukuro Line"、「上野」→"JR Ueno-Tokyo Line"）→ 末尾一致に限定し、最も限定的な路線名を優先するよう修正
- [重大] 台風予報（`weather="台風"`）で `isSevere=false` となり「晴れ」アドバイスへ分岐していた → 台風・雷・強風（予報文内）・大雨/霧などを荒天として検出
- [重大] 英語・中国語駅名が全て東京都(130000)へフォールバックしていた（Shibuya/Yokohama/Chiba 等）→ `toJapaneseStationName` で逆引きし日本語駅名へ正規化してから解決
- [重大] 4xx（400/404/422）が「ネットワーク障害(502)」に誤分類されていた → `INVALID_INPUT` / `NO_ROUTE` / `PARSE_ERROR` へ正しく分類
- 気象庁 API 障害時に「晴れ」を返していた → 「情報を取得できない」ことを明示する `unavailable` メッセージを追加

**ハンドラ層**

- [重大] `normalizeFerryPortName('')` が空文字を実在港「横浜・大さん橋」に変換していた → 空文字の早期リターンを追加
- [重大] 実GTFSの `route_short_name` が空文字で「航路名：」が空欄になっていた → `route_long_name` → 「出発港 → 到着港」の順でフォールバック
- [重大] `list_community_buses` の en/zh で全41件が日本語のまま返されていた → バス名・自治体名を多言語化（自治体名の辞書 `src/data/municipality-names.mjs` を新規追加、辞書の表記揺れは `COMMUNITY_BUS_NAME_ALIASES` で吸収）

**検証**: 回帰テスト `tests/common-logic-regression.test.mjs` を追加し `npm test` に組み込み（`npm test` 29/29 PASS、共通ロジック層回帰 44件全 PASS）

### v2.58.3（2026-10-20）— コード監査に基づく多言語判定・GTFS 404・路線駅列の修正

3名のサブエージェントによる実測ベース監査（共通ロジック層12件・データ層20件・ハンドラ20件）で確認した問題のうち、重大度の高いものを修正しました。

**多言語判定（`src/lib/lang.mjs`）**

- [重大] 日本語のランドマーク名（浅草寺・雷門・晴空塔）が中国語語彙リストに登録されており、漢字のみの日本語入力が `zh` と判定されていた（日本語ユーザーが中国語で応答される）→ 語彙リストから削除
- [重大] 繁体字の中国語入力（深圳・車站・問題・時間・銀行など）がすべて `ja` にフォールバックしていた → 繁体字シグナルと語彙リストを追加
- 繁体字シグナルに「場・機・机」を含めると「十日市場」「小机」が日本語の駅名なのに `zh` になる二次的誤判定が生じるため、該当字形を除外
- 回帰テスト `tests/language-detection.test.mjs` を追加し `npm test` に組み込み（全1,468駅が `ja` と判定されることを確認）

**GTFS 404 が ODPT サーキットブレーカーを汚染（`src/config.mjs`）**

- [重大] GTFS ファイル（旧 `date` の期限切れなど）の 404 が `odptBreaker.onFailure` に計数され、3件でブレーカーが OPEN になり、鉄道の時刻表・運賃検索（JSON API）まで全面停止していた → 404/410 は恒久不在として失敗カウントから除外
- 段階クールダウンが `OPEN` 中の追加失敗でも進む問題を修正

**路線駅列の欠落・逆順（`src/data/railway-lines.mjs`）**

| 路線 | 内容 |
|---|---|
| JR横須賀線 | 「新橋・東逗子・田浦・横須賀・衣笠」の5駅が欠落（19駅→14駅だった）→ 補完 |
| JR総武線快速 | 駅順が逆順（津田沼→千葉→東千葉→都賀…）。快速の停車駅は稲毛までで千葉が終点 → 修正 |
| JR東海道線 | 「鶴見・新子安・東神奈川」が欠落 → 補完（v2.58.2） |
| 京成成田空港線 | 「東松戸」が欠落 → 補完（v2.58.2） |

**期待駅数ファイルの検証範囲を拡大（`src/data/expected-railway-counts.mjs`）**

- 検証対象が 12 路線（1,200駅中 9.5%）で、114 路線・約1,800駅が未検証だった → 全 126 路線に拡大

**その他**

- フェリーの `trip_headsign` 多言語化（v2.58.1）で「東京・竹芝」と「竹芝」の入れ子構造による二重置換を修正
- 検証: `npm test` 29/29 PASS（新規回帰2件込み）、`check-railway-integrity` 全126路線 OK、`check-ghost-transfer` 未分離0件

### v2.58.2（2026-10-20）— 路線駅列の欠落（東松戸・鶴見・新子安・東神奈川）を補完

- `JR東海道線` の駅列から「鶴見・新子安・東神奈川」が欠落していた（Wikipedia 線路名称上の東海道本線は24駅・ローカルは21駅）。補完により「川崎」「横浜」が同一駅であるにもかかわらず同名別駅と誤検出される問題を解消
- `京成成田空港線`（成田スカイアクセス線）の駅列から「東松戸」が欠落していた（Wikipedia infobox「駅数 8駅」・ローカルは7駅）。補完により「京成高砂」「新鎌ヶ谷」の誤検出を解消
- 監査スクリプト `scripts/audit-same-name-stations.mjs` を追加（Wikipedia で確認済みの同名別駅3件の分離状態と、路線駅列の欠落をオフライン照合）
- 検証: `npm test` 29/29 PASS、`check-railway-integrity` PASS、`audit-same-name-stations` 欠落0件

### v2.58.1（2026-10-20）— ODPT GTFS の固定日指定を廃止し date=current へ移行

- **重大**: 各 GTFS ソースの「有効期間内の固定日付」ハードコードが陳腐化し、バス7社・フェリー2社で**恒久的に404**になっていた。ODPT の GTFS 固定 URL は `date=current` で現在の有効リソースを返すため、全ソースを `date=current` に変更
  - 実測: 京王バス(1724停名)・関東バス(870)・西東京バス(1086)・川崎市バス(527)・川崎鶴見臨港バス(433)・京成バス千葉ウエスト(128) が実 GTFS から取得可能に
  - フェリーは東海汽船の実GTFSが回復し、**37本の航路で発着時刻**が取得可能に（従来はハードコード代替のみで時刻表なし）
- `gtfsFetchDates()` が 'current' / 'next' キーワードを扱えるよう変更
- フェリーの `trip_headsign` を多言語化（en → "Chichijima Island"、zh → "父岛"）。実GTFS取得で生じた en/zh 応答での日本語残存を解消

### v2.58.0（2026-10-20）— 同名別駅の統合による「幽霊乗換」の解消

- **重大**: 地理的に離れている同名駅がグラフ上で1ノードに統合されていたため、実在しない乗換（幽霊乗換）が出力されていた。3件を識別子付き駅名に分離:
  - `赤坂（富士急行線）`（山梨県都留市 FJ05, 35.5662/138.9162）⇔ `赤坂`（東京メトロ千代田線, 東京都港区, 35.6724/139.7365）— 約75km離隔
  - `十日市場（富士急行線）`（山梨県都留市 FJ09, 35.5389/138.8875）⇔ `十日市場`（JR横浜線, 横浜市, 35.5263/139.5166）— 約57km離隔
  - `栄町（千葉モノレール）`（千葉市中央区 CM16, 35.6130/140.1186）⇔ `栄町`（都電荒川線, 東京都北区, 35.7509/139.7422）— 約37km離隔
- 実挙動: `富士山→代々木上原` は「富士急行線赤坂→メトロ赤坂」の幽霊乗換で 47分・乗換1回のルートを返していたが、修正後は実在しない経路として `NO_ROUTE` を返し、駅名指定時は候補提示（disambiguation）を行う
- `AMBIGUOUS_STATION_NAMES` / `AMBIGUOUS_STATION_LINES` に3件を登録し、`「赤坂 富士急行線」`等の路線名ヒントで一意解決できるようにした
- `STATION_DISPLAY_NAMES` に識別子付き駅名の英中表示名を追加
- `STATION_COORDS_EXTRA` に識別子付き駅名の権威座標を追加（Wikipedia infobox 座標・2026-10 確認）
- 回帰テスト `tests/samename-transfer.test.mjs` を追加し `npm test` に組み込み（分離・候補提示・路線名ヒント・幽霊乗換なし・主要経路の回帰を検証）
- 検証スクリプト `scripts/check-ghost-transfer.mjs` を追加（同名別駅の未分離を自動検出。Wikipedia で確認済みの3件の分離状態を検証し、未分離があれば exit 1）
- 検証: `npm test`（29/29 + 新規回帰 PASS）、`check-railway-integrity`、`test-walk-transfer-stations` PASS

### v2.57.1（2026-10-03）— 新橋周辺バス標柱時刻表の英中表示漏れ修正と安全監査テスト改善

- `search_bus(busstop)` の `stop_timetable.entries` に含まれる「新橋五丁目」「新橋六丁目」「新橋駅北口」の英中表示名を追加し、日本語のまま残る不具合を修正
- 上記3停留所について英中の決定的回帰テストを追加
- `scripts/test-safety-audit.mjs` が MCP の `structuredContent` を優先して使うよう修正し、`content` にJSONテキストがない応答を空データと誤判定する問題を解消
- 依存関係監査で検出された Axios / `ip-address` の既知脆弱性もsemver範囲内の更新で解消し、`npm audit` 0件を確認
- 検証: `npm test`（29/29 PASS）、安全監査、徒歩連絡・路線整合性チェック PASS