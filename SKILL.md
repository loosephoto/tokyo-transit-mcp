---
name: tokyo-transit-mcp
description: 公共交通オープンデータセンター（ODPT） API を利用した東京乗り換えMCPサーバー。東京メトロ、都営地下鉄、JR東日本、都営バス等をサポート。有料サービス（駅すぱあと、NAVITIME等）は除外。
category: transportation
version: 2.3.0
---

# Tokyo Transit MCP

## 目的

公共交通オープンデータセンター（ODPT）から提供される**無料APIのみ**を利用した、東京圏の公共交通情報をスマートに扱うMCPサーバーです。

## 対象サービス

### 利用可能（無料）
- 東京メトロ（9路線）
- 都営地下鉄・バス
- JR東日本（関東エリア在来線）
- ゆりかもめ
- 小田急・京王・西武・東武電鉄
- 都営・東武・西武バス

### 除外（有料）
- 駅すぱあとAPI
- NAVITIME乗換検索API
- Google Transit API

## ツール一覧

| ツール | 説明 |
|-------|------|
| `search_route` | 乗り換えルート検索（未収録駅自動Webフォールバック機能付き） |
| `get_station_info` | 指定駅の基本情報を取得 |
| `get_timetable` | 指定駅の時刻表情報を取得 |
| `get_weather` | 指定地域の天気予報＆運行影響アドバイスを取得 |

## 使い方

### 1. APIキーの準備

https://developer.odpt.org/signup で登録し、APIキーを取得してください。

### 2. 環境変数の設定

`.env`ファイルにAPIキーを設定：

```
ODPT_API_KEY=取得したAPIキー
```

### 3. 実行

```bash
npm start
```

## 使用例

### 駅情報の取得
```json
{
  "station_name": "新宿",
  "operator": "tokyometro"
}
```

### 乗り換え検索
```json
{
  "from": "秋葉原",
  "to": "梅島"
}
```

### 天気と運行影響アドバイス
```json
{
  "area_name": "東京"
}
```

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

1. **インテリジェント・フォールバック**: ODPTオープンデータ未収録の一般駅については、自動的にWebダイレクト検索URLリンクを生成し、ユーザーに確実な移動手段を保証します。
2. **運行影響アドバイス**: 気象庁JMA APIからリアルタイムに予報を抽出し、乗り換えに特化した（滑りやすさ、強風での徐行など）アドバイスを自動マージします。

## 参考リンク

- ODPT公式: https://www.odpt.org/
- CKANデータカタログ: https://ckan.odpt.org/
- APIドキュメント: https://developer.odpt.org/