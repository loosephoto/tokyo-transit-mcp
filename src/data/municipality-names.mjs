// 東京都の自治体名（23区 + 多摩地域）の多言語表示名。
// コミュニティバス一覧（list_community_buses）等で使用する。
//
// 🔴 v2.58.3: 従来は community_buses の municipality が常に日本語のまま返され、
//   en / zh の利用者に全41件が日本語で応答されていたため追加。
export const MUNICIPALITY_DISPLAY_NAMES = {
  // 23区
  '千代田区': { en: 'Chiyoda City', zh: '千代田区' },
  '中央区': { en: 'Chuo City', zh: '中央区' },
  '港区': { en: 'Minato City', zh: '港区' },
  '新宿区': { en: 'Shinjuku City', zh: '新宿区' },
  '文京区': { en: 'Bunkyo City', zh: '文京区' },
  '台東区': { en: 'Taito City', zh: '台东区' },
  '墨田区': { en: 'Sumida City', zh: '墨田区' },
  '江東区': { en: 'Koto City', zh: '江东区' },
  '品川区': { en: 'Shinagawa City', zh: '品川区' },
  '目黒区': { en: 'Meguro City', zh: '目黑区' },
  '大田区': { en: 'Ota City', zh: '大田区' },
  '世田谷区': { en: 'Setagaya City', zh: '世田谷区' },
  '渋谷区': { en: 'Shibuya City', zh: '涩谷区' },
  '中野区': { en: 'Nakano City', zh: '中野区' },
  '杉並区': { en: 'Suginami City', zh: '杉并区' },
  '豊島区': { en: 'Toshima City', zh: '丰岛区' },
  '北区': { en: 'Kita City', zh: '北区' },
  '荒川区': { en: 'Arakawa City', zh: '荒川区' },
  '板橋区': { en: 'Itabashi City', zh: '板桥区' },
  '練馬区': { en: 'Nerima City', zh: '练马区' },
  '足立区': { en: 'Adachi City', zh: '足立区' },
  '葛飾区': { en: 'Katsushika City', zh: '葛饰区' },
  '江戸川区': { en: 'Edogawa City', zh: '江户川区' },
  // 多摩地域
  '八王子市': { en: 'Hachioji City', zh: '八王子市' },
  '立川市': { en: 'Tachikawa City', zh: '立川市' },
  '武蔵野市': { en: 'Musashino City', zh: '武藏野市' },
  '三鷹市': { en: 'Mitaka City', zh: '三鹰市' },
  '青梅市': { en: 'Ome City', zh: '青梅市' },
  '府中市': { en: 'Fuchu City', zh: '府中市' },
  '昭島市': { en: 'Akishima City', zh: '昭岛市' },
  '調布市': { en: 'Chofu City', zh: '调布市' },
  '小金井市': { en: 'Koganei City', zh: '小金井市' },
  '日野市': { en: 'Hino City', zh: '日野市' },
  '東村山市': { en: 'Higashimurayama City', zh: '东村山市' },
  '国分寺市': { en: 'Kokubunji City', zh: '国分寺市' },
  '小平市': { en: 'Kodaira City', zh: '小平市' },
  '東大和市': { en: 'Higashiyamato City', zh: '东大和市' },
  '清瀬市': { en: 'Kiyose City', zh: '清濑市' },
  '東久留米市': { en: 'Higashikurume City', zh: '东久留米市' },
  '武蔵村山市': { en: 'Musashimurayama City', zh: '武藏村山市' },
  '多摩市': { en: 'Tama City', zh: '多摩市' },
  '稲城市': { en: 'Inagi City', zh: '稻城市' },
  '羽村市': { en: 'Hamura City', zh: '羽村市' },
  'あきる野市': { en: 'Akiruno City', zh: '秋川市' },
  '西東京市': { en: 'Nishitokyo City', zh: '西东京市' },
  '狛江市': { en: 'Komae City', zh: '狛江市' },
  '町田市': { en: 'Machida City', zh: '町田市' },
  '国立市': { en: 'Kunitachi City', zh: '国立市' },
  '檜原村': { en: 'Hinohara Village', zh: '桧原村' },
};

// 自治体名を言語に合わせて返す。未知の自治体名は日本語（原文）を返す。
export function getMunicipalityDisplayName(municipality, userLang) {
  if (!municipality) return '';
  if (userLang === 'ja') return municipality;
  const tr = MUNICIPALITY_DISPLAY_NAMES[municipality];
  if (!tr) return municipality;
  return tr[userLang] || tr.ja || municipality;
}
