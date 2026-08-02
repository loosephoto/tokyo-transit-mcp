# バス乗り継ぎ（Transfer）機能 — 設計案

> 状態: 設計中（コード未実装）。合意形成用ドキュメント。
> 更新: 2026-08-02

## 1. 背景・前提

- `search_bus` は現在「バス停・系統の検索」のみ。運賃はODPT非対応のため**断念**（確定）。
- 乗り継ぎ（A停留所→B停留所）は **ODPTの `odpt:BusroutePattern.busstopPoleOrder` に停留所順序データが存在するため実装可能**。
- 足の悪いユーザー向けに `odpt:BusTimetable.busTimetableObject[].odpt:isNonStepBus` でノンステップバス情報も取れる（都営バスは1000/1000件に含有）。

## 2. 利用可能なODPTデータ

| エンドポイント | フィールド | 用途 |
|:---|:---|:---|
| `odpt:BusroutePattern` | `odpt:busstopPoleOrder[]`（`odpt:index`, `odpt:busstopPole`, `odpt:note`） | 路線ごとの停留所順序リスト（日本語名込み） |
| `odpt:BusTimetable` | `odpt:busTimetableObject[].odpt:isNonStepBus` | ノンステップバス（バリアフリー）判定 |
| `odpt:Bus` | `odpt:note`, `odpt:frequency`, `odpt:busroute` | 系統の表示・頻度 |

取得実績（2026-08-02）:
- 都営: BusroutePattern 774 / BusTimetable 1000
- 西武: BusroutePattern 755
- 横浜市営: BusroutePattern 1000
- **横浜市営も `busstopPoleOrder.odpt:note` は日本語**（「横浜駅前」「港南台駅前」等）— `odpt:Bus.note=null` 問題は発生せず。

## 3. 設計方針（2案）

### 案A: 同一事業者内 A→B 直達検索（基本）

入力: `from`（出発停留所）, `to`（到着停留所）
処理:
1. `busstopPoleOrder` から全路線の停留所リストを構築（事業者ごと）
2. `from` と `to` の両方を含む路線パターンを検索
3. `from` の index < `to` の index ならその系統で直達可能
4. 系統名・頻度・所要目安（停留所数差）・事業者を返す

出力例:
```
from: 渋谷駅前 → to: 新橋駅前
[都営バス] 都０１（Ｔ０１） 渋谷駅前→新橋駅前 | 頻度30分 | 約12停留所
```

実装量: 中。`searchBus` に `from`/`to` を追加、既存キャッシュ基盤を流用。

### 案B: 乗り継ぎ（transfer）対応 — 異系統・異事業者間（拡張）

グラフ構築:
- ノード: 各バス停（`odpt:busstopPole` の正規化名）
- エッジ: 同一路線で隣接する停留所ペア（重み=1停留所）
- 共有バス停（複数路線が停まる）を乗り継ぎ点とする

探索: BFS/Dijkstra で `from`→`to` の最短経路（乗り継ぎ回数最小）
出力: 乗車系統→乗り継ぎ停留所→乗車系統…の順次案内

制約: hardCodedソース（JRバス関東・コミュニティバス）は `busstopPoleOrder` を持たないため、案Bでは経路探索のノードに含められない（案Aの直達のみ対応）。

実装量: 大。グラフ構築＋経路探索＋hardCoded除外ロジック。

## 4. バリアフリー統合案（追記可能）

現状 `searchBus` は `barrier_free_note`（「ODPTにバリアフリー情報なし、各社へ問合せ」の注意喚起）のみ。

`isNonStepBus` 実データを使い、以下へ強化:
- **系統ごとに「ノンステップバス運行あり（段差なし）」を表示**
  → 足の悪いユーザーに「このバスなら段差なく乗車可能」を実データで答えられる
- 乗り継ぎ案内（案B）では、各乗車系統の `isNonStepBus` を乗り継ぎ全体で評価
  → 「全乗り継ぎ系統でノンステップ対応」等を提示

※ `isNonStepBus` は BusTimetable に紐づくため、案A/Bの路線特定後に該当時刻表を引く必要あり（キャッシュ設計で対応）。

## 5. ツールインターフェース（案）

`search_bus` を拡張（後方互換を保つ）:
```
search_bus(from: "渋谷駅前", to: "新橋駅前")   # 乗り継ぎ探索（案A/B）
search_bus(busstop_name: "桜木町")             # 従来のバス停検索（維持）
search_bus(from: "渋谷駅前", to: "横浜駅", transfer: true)  # 案B明示
```

言語: `detectLanguage(from)` で ja/en/zh 自動判定（既存パターン準拠）。
`barrier_free_note` / `data_source` / `operators` は従来通り付与。

## 6. キャッシュ設計

- `cache.busData` に `busstopPoleOrder` マージ（TTL継承: 600000ms）
- BusTimetable（`isNonStepBus`）は別キャッシュキー `cache.busTimetable` で管理
  → 乗り継ぎ時のみ参照、通常バス停検索はオーバーヘッドなし
- サーキットブレイカー `odptBreaker` は既存のまま流用

## 7. 未解決・要判断事項

- [ ] 案Aのみ / 案Bまで実装するか
- [ ] `isNonStepBus` バリアフリー強化を同時実装するか（別途か）
- [ ] hardCodedソース（JRバス・コミュニティ）の乗り継ぎ対象外扱いでよいか
- [ ] 検索対象事業者を都営/西武/横浜のみ（ODPT実データ）に限定するか、hardCodedも直達対象に含めるか
