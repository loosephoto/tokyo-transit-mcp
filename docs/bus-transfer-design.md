# バス乗り継ぎ（Transfer）機能 — 設計と実装記録

> 状態: **実装済み**（v2.17.0 / 2026-08-03）
> 本ドキュメントは設計案（2026-08-02）を実装完了後の状況に合わせて更新したものです。設計時の検討経緯と実装済み機能の両方を記録します。

## 1. 背景・前提

- `search_bus` はバス停・系統の検索に加え、**乗り継ぎ探索**・**横断乗り継ぎ（バス⇔電車⇔バス）**・**コミュニティバス駅接続**を提供します。運賃はODPT非対応のため検索不可（確定）。
- 乗り継ぎ（A停留所→B停留所）は **ODPT の `odpt:BusroutePattern.busstopPoleOrder` に停留所順序データが存在するため実装可能**。
- 足の悪いユーザー向けに `odpt:BusTimetable.busTimetableObject[].odpt:isNonStepBus` でノンステップバス情報も取得（都営バスは1000/1000件に含有）。

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

## 3. 設計方針（実装済み）

### 案A: 同一事業者内 A→B 直達検索 ✅ 実装済み

入力: `from`（出発停留所）, `to`（到着停留所）
処理:
1. `busstopPoleOrder` から全路線の停留所リストを構築（事業者ごと）
2. `from` と `to` の両方を含む路線パターンを検索
3. `from` の index < `to` の index ならその系統で直達可能
4. 系統名・頻度・所要目安（停留所数差）・事業者を返す

### 案B: 乗り継ぎ（transfer）対応 — 異系統・異事業者間 ✅ 実装済み

グラフ構築:
- ノード: 各バス停（`odpt:busstopPole` の正規化名）＋ 電車駅（`RAILWAY_LINES`）＋ コミュニティバス停（`COMMUNITY_BUS_ROUTES`）
- エッジ:
  - 同一路線で隣接する停留所ペア（バス・コミュニティバス）
  - 電車路線の隣接駅ペア（電車）
  - バス停↔駅 の geo-link（500m 以内を緯度経度で紐付け）
  - コミュニティバス停↔駅 の直接リンク（自治体公式データ）
- 共有バス停（複数路線が停まる）を乗り継ぎ点とする

探索: BFS で `from`→`to` の最短経路（乗り継ぎ回数最小）
出力: 乗車系統→乗り継ぎ停留所→乗車系統…の順次案内

> **2026-08-03 追記（旧制約の解消）**: 当初「hardCodedソース（JRバス関東・コミュニティバス）は `busstopPoleOrder` を持たないため案Bのノードに含められない」としていたが、**コミュニティバスは `COMMUNITY_BUS_ROUTES`（主要10件の駅接続データ）を統合グラフに組み込むことで乗り継ぎ対象に拡張済み**（`mode: 'community_bus'` セグメント）。JRバス関東は停留所順序データがないため乗り継ぎ対象外のまま（バス停検索のみ）。

## 4. 実装済み機能一覧

### 4.1 バス→電車→バス 横断乗り継ぎ
`odpt:Station`（電車）グラフとバス停 geo-link を統合し、バス→電車→バスの横断ルートを探索。
例: `search_bus(from: "渋谷駅前", to: "新橋駅前")` → 徒歩→電車→バスの横断経路（`cross_modal: true`）。

### 4.2 コミュニティバス駅接続（バリアフリー・ファースト/ラストマイル）
- **Phase 1（案内モード）**: `search_route` / `search_bus` で駅を指定すると「この駅はどのコミュニティバスが使えるか」を `community_bus_access` として表示（ちぃばす・ハチ公バス・ムーバス・はなバス・すぎ丸 等、主要10件の駅接続データ）。車椅子・低床バスの確認先（自治体公式サイトURL）を注意喚起として案内。
- **Phase 2（統合グラフ）**: コミュニティバス停間の乗り継ぎを `mode: 'community_bus'` セグメントとして実経路で返却。例: `search_bus(from: "渋谷駅東口", to: "恵比寿駅前")` → ハチ公バス。

### 4.3 多言語対応（en/zh 駅名解決）
`normalizeBusStop` に駅名正規化（`STATION_NAME_MAP`: romaji/zh→日本語、`駅/Station/站` サフィックス除去）を適用し、`search_bus(from: "Shibuya Station", to: "Shimbashi Station")` や `涩谷站→新桥站` のような英中入力でも横断乗り継ぎが解決可能（コミット 61ef6e3）。

### 4.4 サーキットブレイカー時フォールバック
ODPT サーキットブレイカー OPEN 時でも、`fetchAllBuses` がハードコードソース（JRバス関東・コミュニティバス）のみで検索を継続（コミット 3a64569）。乗り継ぎモードは ODPT グラフ必須のため対象外。

## 5. バリアフリー統合（実装済み）

- `odpt:BusTimetable.isNonStepBus`（ノンステップバス・段差なし）を系統ごとに表示
- コミュニティバスは `non_step_bus: null`＋「小型バス・ノンステップ/ワンステップ混在。車椅子対応は自治体サイトで確認」を3言語で注意喚起

## 6. ツールインターフェース（実装版）

`search_bus` を拡張（後方互換を保つ）:
```
search_bus(busstop_name: "渋谷駅前")                    # 従来のバス停検索（維持）
search_bus(from: "渋谷駅前", to: "新橋駅前")            # 乗り継ぎ探索（バス→電車→バス横断対応）
search_bus(from: "渋谷駅東口", to: "恵比寿駅前")        # コミュニティバス（mode: community_bus）
```

言語: `detectLanguage` で ja/en/zh 自動判定。`barrier_free_note` / `data_source` / `operators` / `community_bus_access` を付与。

## 7. キャッシュ設計

- `cache.busData` に `busstopPoleOrder` マージ（TTL: 600000ms）
- BusTimetable（`isNonStepBus`）は別キャッシュキー `cache.busTimetable` で管理（乗り継ぎ時のみ参照）
- サーキットブレイカー `odptBreaker` は全ODPT呼び出しで共有

## 8. 解決済み事項（旧: 未解決・要判断事項）

| 旧項目 | 結論 |
|:---|:---|
| 案Aのみ / 案Bまで実装するか | **両方実装**（＋横断乗り継ぎ・コミュニティバス駅接続） |
| `isNonStepBus` バリアフリー強化を同時実装するか | **実装済み**（系統ごと表示） |
| hardCodedソースの乗り継ぎ対象外扱いでよいか | **コミュニティバスは駅接続データで統合**。JRバス関東のみ対象外 |
| 検索対象事業者の範囲 | 都営/西武/横浜（ODPT実データ）＋コミュニティバス主要10件（駅接続） |
