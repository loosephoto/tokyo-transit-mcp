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

## ツール一覧（13種）

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