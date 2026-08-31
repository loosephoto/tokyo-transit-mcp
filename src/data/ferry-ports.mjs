/**
 * フェリー・水上バス港データ（モノリス分割 Phase 2d-1）
 * FERRY_PORT_MAP / FERRY_PORT_NAMES / FERRY_PORT_TSUNAMI_AREAS は純データ。
 * FERRY_GTFS_SOURCES は東海汽船・東京クルーズの GTFS フォールバック定義。
 * 参照ロジック（fetchFerryData / searchFerry 等）は index.mjs 側。
 */
import { API_BASE_URL } from '../config.mjs';

export const FERRY_PORT_MAP = {
  // 日本語
  // 注: '東京' は東海汽船の竹芝発（大島・伊豆諸島航路）を指す。水上バスに「東京」港は存在しないため、
  // 曖昧さを避けるため東海汽船の '東京・竹芝' にマップする。
  '東京': '東京・竹芝', '東京・竹芝': '東京・竹芝', '竹芝': '東京・竹芝', '竹芝客船ターミナル': '東京・竹芝',
  '横浜': '横浜・大さん橋', '横浜・大さん橋': '横浜・大さん橋', '大さん橋': '横浜・大さん橋', '大桟橋': '横浜・大さん橋',
  '大島': '大島', '利島': '利島', '新島': '新島', '式根島': '式根島', '神津島': '神津島',
  '三宅島': '三宅島', '御蔵島': '御蔵島', '八丈島': '八丈島', '青ヶ島': '青ヶ島',
  '父島': '父島', '母島': '母島', '久里浜': '久里浜', '館山': '館山',
  '熱海': '熱海', '伊東': '伊東', '稲取': '稲取', '下田': '下田',
  // 水上バス（日本語）
  '浅草(水上)': '浅草', '浅草': '浅草', 'お台場海浜公園': 'お台場海浜公園', 'お台場': 'お台場海浜公園',
  '豊洲': '豊洲', '日の出桟橋': '日の出桟橋', '日の出': '日の出桟橋',
  '浜離宮': '浜離宮', '浜離宮庭園': '浜離宮',

  // 表記揺れ・旧名（中黒なし・suffix 付き等）
  '東京竹芝': '東京・竹芝', '竹芝桟橋': '東京・竹芝', '竹芝ピア': '東京・竹芝', '竹芝埠頭': '東京・竹芝',
  '横浜大さん橋': '横浜・大さん橋', '大サンブリッジ': '横浜・大さん橋',
  '台場': 'お台場海浜公園',
  '日の出码头': '日の出桟橋', '日の出埠頭': '日の出桟橋',
  '浜離宮 Gardens': '浜離宮',

  // English
  'Tokyo': '東京・竹芝', 'Takeshiba': '東京・竹芝', 'Takeshiba Pier': '東京・竹芝',
  'Yokohama': '横浜・大さん橋', 'Osanbashi': '横浜・大さん橋',
  'Oshima': '大島', 'Oshima Island': '大島', 'Toshima': '利島', 'Niijima': '新島',
  'Shikinejima': '式根島', 'Kouzushima': '神津島', 'Kozushima': '神津島',
  'Miyakejima': '三宅島', 'Mikurajima': '御蔵島', 'Hachijojima': '八丈島', 'Aogashima': '青ヶ島',
  'Chichijima': '父島', 'Hahajima': '母島', 'Kurihama': '久里浜', 'Tateyama': '館山',
  'Atami': '熱海', 'Ito': '伊東', 'Inatori': '稲取', 'Shimoda': '下田',
  'Asakusa': '浅草', 'Odaiba': 'お台場海浜公園', 'Odaiba Kaihin Koen': 'お台場海浜公園',
  'Toyosu': '豊洲', 'Hinode': '日の出桟橋', 'Hinode Pier': '日の出桟橋', 'Hamarikyu': '浜離宮',

  // 中文
  '东京': '東京・竹芝', '横滨': '横浜・大さん橋', '大山桥': '横浜・大さん橋',
  '大岛': '大島', '利岛': '利島', '新岛': '新島', '式根岛': '式根島', '神津岛': '神津島',
  '三宅岛': '三宅島', '御藏岛': '御蔵島', '八丈岛': '八丈島', '青岛': '青ヶ島', '青之岛': '青ヶ島',
  '父岛': '父島', '母岛': '母島', '台场': 'お台場海浜公園', '台场海滨公园': 'お台場海浜公園',
  '丰洲': '豊洲', '日出': '日の出桟橋', '日出码头': '日の出桟橋', '滨离宫': '浜離宮'
};

export const FERRY_PORT_NAMES = {
  '東京・竹芝': { en: 'Tokyo (Takeshiba Pier)', zh: '东京·竹芝码头' },
  '竹芝': { en: 'Tokyo (Takeshiba Pier)', zh: '东京·竹芝码头' },
  '横浜・大さん橋': { en: 'Yokohama (Osanbashi Pier)', zh: '横滨·大山桥码头' },
  '大島': { en: 'Oshima Island', zh: '大岛' },
  '利島': { en: 'Toshima Island', zh: '利岛' },
  '新島': { en: 'Niijima Island', zh: '新岛' },
  '式根島': { en: 'Shikinejima Island', zh: '式根岛' },
  '神津島': { en: 'Kozushima Island', zh: '神津岛' },
  '三宅島': { en: 'Miyakejima Island', zh: '三宅岛' },
  '御蔵島': { en: 'Mikurajima Island', zh: '御藏岛' },
  '八丈島': { en: 'Hachijojima Island', zh: '八丈岛' },
  '青ヶ島': { en: 'Aogashima Island', zh: '青之岛' },
  '父島': { en: 'Chichijima Island', zh: '父岛' },
  '母島': { en: 'Hahajima Island', zh: '母岛' },
  '久里浜': { en: 'Kurihama', zh: '久里滨' },
  '館山': { en: 'Tateyama', zh: '馆山' },
  '熱海': { en: 'Atami', zh: '热海' },
  '伊東': { en: 'Ito', zh: '伊东' },
  '稲取': { en: 'Inatori', zh: '稻取' },
  '下田': { en: 'Shimoda', zh: '下田' },
  '浅草': { en: 'Asakusa', zh: '浅草' },
  'お台場海浜公園': { en: 'Odaiba Seaside Park', zh: '台场海滨公园' },
  '豊洲': { en: 'Toyosu', zh: '丰洲' },
  '日の出桟橋': { en: 'Hinode Pier', zh: '日出码头' },
  '浜離宮': { en: 'Hamarikyu Gardens', zh: '滨离宫' }
};

export const FERRY_GTFS_SOURCES = [
  { name: '東海汽船', url: `${API_BASE_URL}/files/odpt/TokaiKisen/AllLines.zip`, date: () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '') }, // 🔴 v2.50.1: JST日付（JST 0:00-9:00のUTC日付1日ずれ修正。lib/time.mjs getJstDateCompact と同一ロジック）
  { name: '東京クルーズ（水上バス）', url: 'https://api-public.odpt.org/api/v4/files/odpt/TokyoCruiseShip/AllLines.zip', date: () => '20250402' },
  // 東海汽船 GTFS エンドポイント（files/odpt/...）が ODPT 側で 404/500 となる場合のフォールバック。
  // ハードコード港リストを stop として展開し、伊豆諸島航路等を検索可能にする。
  { name: '東海汽船（ハードコード）', hardCoded: true, stops: [
    '東京・竹芝', '竹芝', '大島', '利島', '新島', '式根島', '神津島',
    '三宅島', '御蔵島', '八丈島', '青ヶ島', '父島', '母島', '久里浜', '館山',
    '熱海', '伊東', '稲取', '下田'
  ] },
];

export const FERRY_PORT_TSUNAMI_AREAS = {
  '浅草': ['東京湾内湾'], '日の出桟橋': ['東京湾内湾'], '浜離宮': ['東京湾内湾'],
  'お台場海浜公園': ['東京湾内湾'], '豊洲': ['東京湾内湾'],
  '東京': ['東京湾内湾'], '竹芝': ['東京湾内湾'],
  // 🔴 v2.39.7: searchFerry が使う正規化港名の津波予報区が未登録だと、東京湾内湾の津波警報で
  // 東京発の航路が停止されない（過小停止・実測で isTsunamiRelevantToPorts=false）。主要港を追加。
  '東京・竹芝': ['東京湾内湾'], '横浜・大さん橋': ['東京湾内湾'], '久里浜': ['東京湾内湾'],
  '館山': ['内房'], '稲取': ['静岡県'],
  '大島': ['伊豆諸島'], '利島': ['伊豆諸島'], '新島': ['伊豆諸島'], '式根島': ['伊豆諸島'],
  '神津島': ['伊豆諸島'], '三宅島': ['伊豆諸島'], '御蔵島': ['伊豆諸島'], '八丈島': ['伊豆諸島'],
  '青ヶ島': ['伊豆諸島'], '父島': ['小笠原諸島'], '母島': ['小笠原諸島'],
  '熱海': ['静岡県'], '伊東': ['静岡県'], '下田': ['静岡県']
};
