# Tokyo Transit MCP Server — Claude Code 用プロジェクトガイド

東京圏の公共交通情報（鉄道・バス・水上バス・フェリー・空港フライト・コミュニティバス・シェアサイクル）を1つのMCPサーバーで横断検索できるサーバーです。ODPT・気象庁(JMA)・GBFS・GTFS を統合し、天候・運行情報を加味したAIインテリジェントアドバイスを日本語・英語・中国語で自動生成します。

本ファイルは、Claude Code がこのMCPを**正しくインストール・利用・開発**するためのコンテキストです。セットアップ時の詳細は `README.md` の「セットアップ」セクションも参照してください。

---

## 前提条件

- **Node.js 18+**（ESM・`import` 構文を使用。`"type": "module"`）
- リポジトリ直下で `npm install` 済みであること（依存: `@modelcontextprotocol/sdk`・`axios`・`adm-zip`・`dotenv`）

---

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

リポジトリ直下で以下を実行します（プロジェクトスコープ推奨。チーム共有にする場合は `-s project`、個人全体で使う場合は `-s user`）。

```bash
# リポジトリ直下（CLAUDE.md がある階層）から実行
claude mcp add -s project tokyo-transit -- node src/index.mjs

# 確認
claude mcp list
```

- `src/index.mjs` の相対パスは、Claude Code がMCPサーバーを起動する際のカレントディレクトリ（通常はリポジトリ直下）に依存します。起動先カレントディレクトリが不明な場合は絶対パス（例: `node /path/to/tokyo-transit-mcp/src/index.mjs`）を使用してください。
- **`.env` の読み込みはカレントディレクトリ非依存**なので、パスが通ればAPIキーは自動で読み込まれます。
- 別ディレクトリからクローンした場合は、`claude mcp add` のパスをそのクローン先に合わせてください。

### 3. 動作確認

Claude Code の会話内で利用可能なツールは `mcp__tokyo-transit__<tool>` 形式で呼べます。最初の確認には次を使うと良いです。

```
東京の今日の天気と運行影響アドバイスを教えて
```
（→ `mcp__tokyo-transit__get_weather` が呼ばれる）

---

## 利用可能なツール（12種）

| ツール | 機能 | 主な引数 |
|:--|:--|:--|
| `search_route` | 乗換ルート検索（天気・AIアドバイス・多言語対応・コミュニティバス駅接続・到着地周辺レンタサイクル案内） | `from`, `to`, `language` |
| `get_station_info` | 駅の基本情報（乗り入れ路線・事業者） | `station_name`, `language` |
| `get_weather` | 天気・気温・運行影響AIアドバイス（高温時は熱中症注意） | `area_name`, `language` |
| `search_fare` | 2駅間の運賃検索（東京メトロ・都営・横浜市営・TX・りんかい・ゆりかもめ・多摩モノレールのみ） | `from`, `to` |
| `get_timetable` | 指定駅の時刻表検索 | `station_name`, `railway`, `language` |
| `search_bus` | バス停/系統検索・乗り継ぎ・バス⇔電車⇔バス横断乗り継ぎ・コミュニティバス駅接続 | `busstop_name` / `from`+`to` |
| `search_flight` | 空港フライト時刻・到着時刻・空港アクセス経路（AviationStack・キー未設定時は空港アクセス経路のみ） | `airport`, `direction`, `destination`, `language` |
| `list_transit_operators` | 交通事業者一覧（種別フィルタ付き） | `language`, `type_filter` |
| `get_operator_routes` | 事業者別の路線・駅一覧 | `operator_name`, `language` |
| `list_ferry_ports` | フェリー/水上バス港一覧（19港・東海汽船＋東京クルーズ） | `language` |
| `search_ferry` | 港間の航路・時刻表検索 | `from_port`, `to_port`, `language` |
| `list_community_buses` | 東京都コミュニティバス一覧（41自治体） | `language` |

---

## 利用パターン

### 多言語（i18n）

入力言語（日/英/中）を自動判定し、応答全体（駅名・路線名・天気・エラー・AIアドバイス）をローカライズします。**ユーザーが英語（中国語）で質問した場合は `language: "en"`（`"zh"`）を明示的に渡してください**。省略時は駅名から自動判定されますが、駅名が日本語のままの英語質問では判定がズレるため、クエリ言語に合わせて指定すると確実です。

```
search_route(from: "Shibuya", to: "Shinjuku", language: "en")
search_route(from: "涩谷", to: "新宿", language: "zh")
```

- ランドマーク・施設名（「スカイツリー」「羽田空港」など）も最寄り駅に解決されます。
- 駅名が曖昧（複数候補）な場合は、サイレントに推測せず**検索を中断して候補を提示（disambiguation）**します。

### 障害シミュレーション（-test モード）

`search_route` に `-test <障害種別>` を付けると、実際の外部APIを呼ばずに20種類以上の障害をシミュレーションできます（日英中のキーワード対応）。開発・動作検証に利用します。

```
search_route(from: "東京 -test 人身事故", to: "新宿")
search_route(from: "新宿 -test 台風", to: "渋谷")
search_route(from: "Tokyo -test typhoon", to: "Shinjuku")
search_route(from: "东京 -test 台风", to: "新宿")
```

津波など災害系の `-test` では、安全のため自転車案内（シェアサイクル）が抑止されます（`isDisasterRisk`）。

---

## 開発ワークフロー

コード変更後は必ず以下を実行して検証してください。

```bash
# 構文チェック（src 配下の全 .mjs に node --check を実行）
npm run build

# 多言語回帰プローブ（26ケース・日英中）
npm test

# 徒歩連絡・同名別駅・路線データ整合性の回帰
npm run test:walk

# バス乗り継ぎ実APIプローブ（API状況により長時間化）
npm run test:bus

# イシュー回帰テスト群
npm run test:issue
```

### 注意

- **このMCPサーバーはホットリロードなし**。`src/` を変更したら、MCPサーバー（`claude mcp` の再起動 or Claude Code の再起動）で変更を反映してください。
- 出力規約: MCP stdio プロトコル保護のため `console.log` は stderr へリダイレクト済み（`src/config.mjs`）。`stdout` に勝手に書き込まないこと。
- モジュール依存方向は `handlers → advice/data/lib → config` の一方向（モノリス分割済み）。
- `search_fare` で `fare: null` が返るのは JR・私鉄等 ODPT運賃対象外の**正常動作**です。対応7事業者で検証してから「異常」と判断してください。
- サーキットブレイカー: ODPT 3回連続失敗で60秒クールダウン。障害時も内蔵データで部分稼働を継続します。

---

## ライセンス・参考

- MIT License
- ODPT公式: https://www.odpt.org/ ／ APIドキュメント: https://developer.odpt.org/
- 気象庁API / Docomo Bike Share GBFS
