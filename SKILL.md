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
- 現行の依存関係は `@modelcontextprotocol/sdk` 1.30.0、`axios` 1.19.0、`adm-zip` 0.6.0、`dotenv` 17.4.2。`npm audit` の結果だけでOSV判定を代替せず、package.json / package-lock.json の実バージョンを対象に再監査する（OSV querybatch API で検証、現行は0脆弱性）。
- ✅ `capabilities` に `logging: {}` を宣言し、ツール呼び出しの開始・完了・失敗を `sendLoggingMessage` で通知（#104 対応完了）。未接続・未対応クライアントでは無視される。`tests/tools-list.test.mjs` で `server.server.getCapabilities().logging` を検証。
- ✅ サーバーは McpServer + registerTool 方式（#102 対応完了）。低レベル Server + 手動 ListTools/CallTool ハンドラ + switch は廃止。各ツールの inputSchema は zod スキーマ（zod 3.25.x を直接依存に追加）。SDK が tools/list の JSON Schema を自動生成し、additionalProperties:false と required を自動付与する。`applyInputSchemaConstraints` は廃止（#106 対応完了）。
- ⚠️ この SDK バージョンでは registerTool は入力パラメータの zod 検証を**自動実行しない**（count:99 が通った）。制約は tools/list の JSON Schema に反映されクライアントに提示されるが、サーバー側での強制はハンドラ内で行う（従来の低レベル Server と同じ挙動）。
- ✅ ツール description は簡潔（最大~150文字・合計~1,200文字）に保つ（#105 対応完了）。search_flight/search_bus/get_running_status を簡潔化済み。詳細ガイダンスは description に詰め込まず、必要なら annotations/_meta/resources へ。
- ✅ エラー応答の `isError: true` は `src/lib/common.mjs` の `jsonResponse` で `data.status === 'ERROR'` を検知して自動付与（#101 対応完了）。`handleApiError` も isError 付きを返す。`jsonResponse(handleApiError(...))` のような二重ラップは isError が失われるため禁止（flight.mjs 修正済み）。正常応答には isError を付けない。
- `scripts/` の実データプローブと、`tests/` に置く決定的な自動テストを区別する。外部スキャナーが認識する通常テストは `tests/` に置く。
- Issue本文を修正しただけではクローズせず、実装と受け入れ条件が検証済みの課題だけをクローズする。

## 更新履歴

### v2.56.0（2026-09-05）— 千葉・埼玉の路線データを公式情報と突合して修正

- 千葉都市モノレールを公式2路線に分離（1号線: 千葉みなと⇔県庁前 6駅 / 2号線: 千葉⇔千城台 13駅）。従来は18駅を1号線に合体しており、県庁前〜千葉公園間の実在しない直通エッジがあった。千葉駅が両線の乗換駅。事業者説明の「跨座式」も「懸垂式」に修正
- 「新京成線」→「京成松戸線」に改称（2025-04-01 京成電鉄へ吸収合併・京成電鉄公式リリースで確認）。終点を「津田沼」（JRの駅・誤り）から「京成津田沼」に修正し公式24駅の駅順（京成津田沼起点）に統一。旧名は検索エイリアスとして維持。JR津田沼⇔新津田沼（徒歩3分）の乗換を追加
- JR八高線の越生〜寄居間を公式駅順に修正（Wikipedia駅一覧で確定）。東武越生線の駅（東毛呂・武州唐沢・川角・西大家）を除去し、明覚・小川町・竹沢・折原を追加。小川町は同名異駅のため「小川町（JR八高線）」として分離し、東武東上線の「小川町（東武東上線）」と徒歩3分で接続（AMBIGUOUS候補を3件に更新）
- 埼玉新都市交通（ニューシャトル）「鉄道博物館（大成）」→「鉄道博物館」に改称（公式NS02・鉄道博物館公式アクセス案内で確認）。旧名「大成」「鉄道博物館（大成）」は検索エイリアスとして維持
- テスト修正: #16 永田町→国会議事堂前は東京メトロ公式の乗換駅（#68でWALK_TRANSFERS追加済み・0乗換徒歩が正しい）のため期待値を「1乗換・丸ノ内線」から「0乗換」に更新（Yahoo!乗換案内実測でも0乗換を確認）。test-walkの小川町候補数を2→3に更新
- 🔴 落とし穴: 路線データを更新した際は、同名異駅の曖昧化テスト（test-walk-transfer-stations の候補数）と駅順テスト（test-hachiko-extension 等）の期待値を必ず同期する。JRと私鉄で同じ駅名（小川町・両国・霞ヶ関・入谷）は識別子付き駅名（駅名（路線名））で分離する規約を踏襲
- 検証: test-chiba-lines（千葉モノレール2線+京成松戸線+京葉線・孤立0）・test-hachiko-extension（八高線16駅の公式駅順）・test-walk-transfer-stations（ALL PASS）・test-issues-10-19 ほか回帰全PASS。check-railway-integrity・probe-all-lang 29/29・ユニット5本 すべて成功。計126路線・1,472駅