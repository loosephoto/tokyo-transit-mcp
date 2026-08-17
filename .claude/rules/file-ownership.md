# ファイル所有権（並行作業の衝突回避）

**複数LLM/エージェントが同時に作業するための所有権マップ**。各ドメインは単一の担当が所有し、並行編集は原則として互いに重ならないファイルを触る。

| ドメイン | 所有ファイル | 担当エージェント |
|:--|:--|:--|
| 駅名・路線 | `src/data/station-names-*.mjs`（7セクション）, `src/data/station-names.mjs`（マージ再エクスポート＋RAILWAY/STATION_DISPLAY/LINE_DISPLAY）, `src/data/railway-lines.mjs`, `src/data/expected-railway-counts.mjs` | `station-data` |
| バス | `src/data/bus-routes.mjs`, `src/handlers/bus.mjs` | `bus-data` |
| ランドマーク | `src/data/landmarks.mjs`, `src/data/misc.mjs` | `landmark-data` |
| フェリー・フライト | `src/data/ferry-ports.mjs`, `src/handlers/ferry.mjs`, `src/handlers/flight.mjs` | `ferry-flight-data` |
| 共通ロジック | `src/handlers/search-route.mjs`, `src/handlers/*.mjs`（他）, `src/lib/*.mjs`, `src/advice/*.mjs`, `src/config.mjs`, `src/index.mjs` | 複数関与 → 変更時に所有ドメインと相談 |
| 検証 | `scripts/*.mjs`, `package.json` | `test-runner` |

## 共有ファイルの扱い（衝突ホットスポット）
- `src/config.mjs` / `src/index.mjs` / `src/handlers/search-route.mjs` は複数ドメインが参照する**共有ファイル**。単独エージェントで変更し、変更後は必ず全回帰を実行。
- データ追加（駅・路線・バス停・ランドマーク）は**必ずドメイン所有ファイルを経由**し、共有ファイルを直接触らない。

## データ追加時の整合性
- 駅・路線の駅数を変更したら `src/data/expected-railway-counts.mjs` の期待値を**必ず同期更新**（`check-railway-integrity` が壊れるため）。
