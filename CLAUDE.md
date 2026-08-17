# Tokyo Transit MCP Server — Claude Code 用プロジェクトガイド

東京圏の公共交通情報（鉄道・バス・水上バス・フェリー・空港フライト・コミュニティバス・シェアサイクル）を1つのMCPサーバーで横断検索するサーバーです。ODPT・気象庁(JMA)・GBFS・GTFS を統合し、天候・運行情報を加味したAIインテリジェントアドバイスを日本語・英語・中国語で自動生成します。

**並行作業・開発規約は分割ルールにあります**: `.claude/rules/`（所有権・並行worktree・検証ゲート・コーディング規約）と `.claude/agents/`（ドメイン別サブエージェント）を参照してください。

---

## 前提条件

- **Node.js 18+**（ESM・`import` 構文。`"type": "module"`）
- リポジトリ直下で `npm install` 済み（依存: `@modelcontextprotocol/sdk`・`axios`・`adm-zip`・`dotenv`）

## セットアップ（Claude Code から利用する場合）

### 1. APIキーは `.env` にのみ保存

**重要**: このサーバーのAPIキーは **MCPクライアントの env や設定ファイルには一切入れません**。リポジトリルートの `.env` **のみ**から読み込みます。`src/config.mjs` が `src/` を基準に `.env` を解決するため、MCPサーバーの起動時カレントディレクトリには**依存しません**。

```bash
# ODPT APIキー（必須: https://developer.odpt.org/ で取得）
echo 'ODPT_API_KEY=your_api_key_here' > .env

# AviationStack APIキー（任意・フライト時刻用: https://aviationstack.com/）
echo 'FLIGHT_API_KEY=your_flight_api_key_here' >> .env
```

`.env` は秘密情報を含むため**絶対にコミット・共有しない**でください（`.gitignore` で除外済み）。

### 2. Claude Code に MCP サーバーを登録

リポジトリ直下で以下を実行します（プロジェクトスコープ推奨）。

```bash
claude mcp add -s project tokyo-transit -- node src/index.mjs
claude mcp list   # 確認
```

- `src/index.mjs` の相対パスは Claude Code が MCP を起動する際の cwd に依存。cwd が不明な場合は絶対パス（`node /path/to/tokyo-transit-mcp/src/index.mjs`）を使用。
- **`.env` の読み込みはカレントディレクトリ非依存**なので、パスが通ればAPIキーは自動で読み込まれます。
- 別ディレクトリにクローンした場合はパスをクローン先に合わせてください。

### 3. 動作確認

```
東京の今日の天気と運行影響アドバイスを教えて
```
（→ `mcp__tokyo-transit__get_weather` が呼ばれる）

---

## 利用可能なツール（12種）

| ツール | 機能 |
|:--|:--|
| `search_route` | 乗換ルート検索（天気・AIアドバイス・多言語・コミュニティバス駅接続・到着地周辺レンタサイクル案内） |
| `get_station_info` | 駅の基本情報（乗り入れ路線・事業者） |
| `get_weather` | 天気・気温・運行影響AIアドバイス |
| `search_fare` | 2駅間の運賃検索（東京メトロ・都営・横浜市営・TX・りんかい・ゆりかもめ・多摩モノレールのみ） |
| `get_timetable` | 指定駅の時刻表検索 |
| `search_bus` | バス停/系統検索・乗り継ぎ・横断乗り継ぎ |
| `search_flight` | 空港フライト時刻・空港アクセス経路（AviationStack・任意） |
| `list_transit_operators` | 交通事業者一覧（種別フィルタ付き） |
| `get_operator_routes` | 事業者別の路線・駅一覧 |
| `list_ferry_ports` | フェリー/水上バス港一覧 |
| `search_ferry` | 港間の航路・時刻表検索 |
| `list_community_buses` | 東京都コミュニティバス一覧（41自治体） |

## 利用パターン

- **多言語**: 入力言語（日/英/中）を自動判定。ユーザーが英語（中国語）質問なら `language: "en"`（`"zh"`）を**明示指定**（駅名が日本語のままの英語質問では自動判定がズレる）。
- **ランドマーク**: 「スカイツリー」「羽田空港」等も最寄り駅に解決。
- **曖昧駅名**: 複数候補ならサイレント推測せず**候補提示（disambiguation）**。
- **障害シミュレーション**: `search_route` に `-test <障害種別>`（例: `"東京 -test 台風"`）。津波等の災害系では安全のため自転車案内が抑止される。

## 開発ワークフロー

コード変更後は必ず検証（詳細は `.claude/rules/testing.md`）:

```bash
npm run build && npm test
node scripts/test-walk-transfer-stations.mjs
node scripts/check-railway-integrity.mjs
```

**並行作業**: `.claude/rules/parallel-work.md` に従い、機能ブランチ＋git worktree（`claude -w <name>`）で分離。所有ファイルは `.claude/rules/file-ownership.md` を参照。

---

## ライセンス・参考

- MIT License
- ODPT公式: https://www.odpt.org/ ／ APIドキュメント: https://developer.odpt.org/
- 気象庁API / Docomo Bike Share GBFS
