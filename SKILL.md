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

## ツール一覧（12種）

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

## 更新履歴

### v2.47.0（2026-08-21）— 実データ突合で発見した5件の不具合修正

- **無関係路線の「振替輸送」案内を抑止**（search-route.mjs）: 復旧済み（再開済み）運行情報が経路無関係の振替案内として表示される問題を修正。`transferCandidates` を収集し、現在停止中の路線（suspendedLineNames）に紐づくもののみ採用
- **運行状況の重複行排除**（running-status.mjs）: JR東など公式ページ区間別重複（同一路線×複数行）を line+status+detail でユニーク化。障害側を平常の重複より優先
- **search_fare のヶ/ケ表記ゆれ対応**（fare.mjs）: ODPT は事業者ごとに表記が異なる（都営「市ヶ谷」/ メトロ「市ケ谷」）。ヶ⇔ケ バリアントクエリを追加し全クエリ実行・マージ（早期break廃止）
- **STATION_NOT_FOUND の未収録側明示**（search-route.mjs）: 出発/到着どちらが経路グラフ未収録かを ja/en/zh で返す（routeResult.from/to の欠落で判定）
- **英語天気文の自然化**（weather.mjs + data/misc.mjs）: JMA原文の全角スペースで分断される複合句（雨　で　雷を伴い　激しく　降る）を結合してから翻訳。辞書に「雨で雷を伴い激しく降る」→"rain, heavy at times, with thunderstorms" 等を追加
- **検証**: `npm test`（26/26）、`probe-all-lang`（26/26）、check-railway-integrity、test-ai-transit-advice-presence PASS
