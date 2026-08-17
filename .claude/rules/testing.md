# 検証ゲート（並行編集チェックリスト）

**コード変更後は必ず実行する検証手順と、データ追加時に同期更新すべき場所**。

## 検証コマンド
```bash
npm run build          # 構文チェック（node --check を src 配下全 .mjs に）
npm test               # 多言語回帰プローブ（26ケース・日英中）
node scripts/test-walk-transfer-stations.mjs   # 徒歩連絡・同名別駅・整合性
node scripts/check-railway-integrity.mjs       # 路線整合性（期待駅数）
```
ドメイン別に該当するもの:
```bash
node scripts/probe-bus-transfer-lang.mjs       # バス乗り継ぎ
node scripts/probe-bus-vehicle-mock.mjs        # 決定的モック（実API非依存・推奨）
node scripts/probe-landmark-all-lang.mjs       # ランドマーク多言語
node scripts/test-contextual-display-routines.mjs
node scripts/test-issue-88-89-90.mjs
```

## データ追加時の同期チェックリスト
データを追加・変更したら、以下を**同時に更新**すること（これが抜けると並行作業の整合性が壊れる）:

- [ ] **駅・路線の駅数を変えた** → `src/data/expected-railway-counts.mjs` の期待値を更新（`check-railway-integrity` が壊れる）
- [ ] **駅名エイリアスを追加** → `STATION_NAME_MAP`（ja/en/zh）に追加。`probe-all-lang` で新規駅が解決できるか確認
- [ ] **ランドマーク追加** → ja/en/zh 別名を付与。`search_route` 経由で最寄り駅が引けるか確認
- [ ] **事業者・路線を追加** → `misc.mjs` の事業者マップ、README の総数表記（計N路線・M駅）を3言語で更新
- [ ] **MCPクライアント設定を変更** → `mcp.json` / CLAUDE.md のツール一覧を実装と一致させる

## 並行作業時の検証方針
- **実API依存テスト（`test:bus`）は遅く flaky**。並行検証では決定的モック（`probe-bus-vehicle-mock`）を優先し、実APIプローブは最終確認で個別実行。
- 実APIテストのタイムアウトは決定的モック回帰と**別に評価**する（実API障害をテスト失敗と誤診断しない）。
- 検証が PASS するまでコミット・プッシュしない。
