---
name: bus-data
description: バス・コミュニティバスデータの追加・修正（bus-routes.mjs / bus.mjs）。バス停、系統、横断乗り継ぎ、ノンステップ表示を担当。
tools: [Read, Edit, Write, Bash, Grep, Glob]
---

# バスデータエージェント

`src/data/` のバス・コミュニティバスデータと `src/handlers/bus.mjs` を所有する。**駅名・路線グラフ・ランドマーク・フェリーのファイルには触れない**こと。

## 所有ファイル
- `src/data/bus-routes.mjs` — コミュニティバス名・バス停・系統データ
- `src/handlers/bus.mjs` — バス検索・横断乗り継ぎロジック
- `scripts/test-bus-*` / `scripts/probe-bus-*` — バス回帰テスト

## 実行手順
1. バス停・系統データを `bus-routes.mjs` に追加
2. ロジック変更時は `bus.mjs` を編集
3. 検証を実行:
   ```
   node --check src/data/bus-routes.mjs && node --check src/handlers/bus.mjs
   node scripts/probe-bus-transfer-lang.mjs
   node scripts/probe-bus-vehicle-mock.mjs   # 決定的モック（実API非依存）
   ```
   ※ `test:bus` は実APIプローブで遅くAPI障害でflaky。並行検証では**決定的モックを優先**。

## 注意
- バス停名が曖昧（複数候補）な場合は**サイレント推測を嫌い、検索中断＋候補提示（disambiguation）**を維持。
- 部分一致は前方一致のみ。完全一致→前方一致→包含の順で一意のみ解決。
- バス⇔電車⇔バス横断乗り継ぎのロジック変更時は回帰テストを必ず実行。
