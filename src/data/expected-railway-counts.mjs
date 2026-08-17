// 路線別の公式期待駅数（check-railway-integrity.mjs が参照する目視チェック用データ）
//
// ⚠️ 駅・路線の駅数を変更したら、このファイルの期待値を必ず同期更新すること。
//    同期しないと check-railway-integrity が「期待 vs 実際」の不一致を報告する。
//    並行作業時は station-data エージェントが本ファイルを所有する（.claude/rules/file-ownership.md）。
export const EXPECTED_RAILWAY_STATION_COUNTS = {
  'JR山手線': 30,
  'JR中央線快速': 17,
  'JR総武線各停': 22,
  'JR中央総武線各停': 39,
  'JR常磐線快速': 27,
  'JR常磐線各停': 14,
  'JR埼京線': 19,
  'JR横須賀線': 14,
  '東京メトロ銀座線': 19,
  '東京メトロ丸ノ内線': 25,
  '都営大江戸線': 38,
  '都営浅草線': 20,
};
