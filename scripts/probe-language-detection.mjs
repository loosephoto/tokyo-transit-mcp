import * as mod from '../src/index.mjs';

const { detectLanguage, resolveLang, searchRoute, searchFare, getTimetable, searchFerry, listFerryPorts, getWeather } = mod;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name} ${detail}`); }
}

// --- resolveLang ---
check('resolveLang en', resolveLang({ language: 'en' }) === 'en');
check('resolveLang zh', resolveLang({ lang: 'zh' }) === 'zh');
check('resolveLang null (unset)', resolveLang({}) === null);
check('resolveLang null (invalid)', resolveLang({ language: 'fr' }) === null);
check('resolveLang precedence language>lang', resolveLang({ lang: 'en', language: 'ja' }) === 'ja');

// --- detectLanguage regression (bug V) ---
check('detect en "Asakusa -> Tsukishima"', detectLanguage('Asakusa -> Tsukishima') === 'en');
check('detect en "Odaiba to Haneda"', detectLanguage('Odaiba to Haneda') === 'en');
check('detect ja "浅草"', detectLanguage('浅草') === 'ja');
check('detect ja "東京湾"', detectLanguage('東京湾') === 'ja');

// --- searchRoute: English forced even with Japanese station names ---
const r1 = await searchRoute({ from: '浅草', to: '月島', language: 'en' });
const r1text = r1.content ? (r1.content[0]?.text || '') + (r1.content[1]?.text || '') : JSON.stringify(r1);
const r1json = r1.content?.[1] ? JSON.parse(r1.content[1].text) : (r1.status ? r1 : JSON.parse(r1.content[0].text));
check('route en: advice block in English', /AI Intelligent Transit Advice/.test(r1.content?.[0]?.text || ''), r1.content?.[0]?.text?.slice(0, 120));
check('route en: detected_language=en', r1json.detected_language === 'en', `got ${r1json.detected_language}`);
check('route en: segments localized', Array.isArray(r1json.routes?.[0]?.segments) && /[A-Za-z]/.test(r1json.routes?.[0]?.segments?.[0]?.line || ''), JSON.stringify(r1json.routes?.[0]?.segments?.[0]));

// --- searchRoute: Japanese default unchanged (regression) ---
const r2 = await searchRoute({ from: '浅草', to: '月島' });
const r2json = r2.content?.[1] ? JSON.parse(r2.content[1].text) : (r2.status ? r2 : JSON.parse(r2.content[0].text));
check('route ja (default): detected_language=ja', r2json.detected_language === 'ja', `got ${r2json.detected_language}`);
check('route ja (default): advice in Japanese', /AIからのインテリジェントアドバイス/.test(r2.content?.[0]?.text || ''), r2.content?.[0]?.text?.slice(0, 80));

// --- searchRoute: zh forced ---
const r3 = await searchRoute({ from: '浅草', to: '月島', language: 'zh' });
const r3json = r3.content?.[1] ? JSON.parse(r3.content[1].text) : (r3.status ? r3 : JSON.parse(r3.content[0].text));
check('route zh: detected_language=zh', r3json.detected_language === 'zh', `got ${r3json.detected_language}`);
check('route zh: advice block in Chinese', /AI智能出行建议/.test(r3.content?.[0]?.text || ''), r3.content?.[0]?.text?.slice(0, 80));

// --- English station names still work (bug V regression) ---
const r4 = await searchRoute({ from: 'Asakusa', to: 'Tsukishima' });
const r4text = JSON.stringify(r4);
check('route en station names: STATION_NOT_FOUND in English', /Station not found/.test(r4text), r4text.slice(0, 200));

// --- other tools honor language ---
const f1 = await searchFare({ from: '赤坂', to: '渋谷', language: 'en' });
const f1text = JSON.stringify(f1);
check('fare en: English message', /station|fare|No/i.test(f1text) || !/駅/.test(f1text), f1text.slice(0, 150));

const t1 = await getTimetable({ station_name: '渋谷', language: 'en' });
const t1text = JSON.stringify(t1);
check('timetable en: English message', /station|timetable|No data/i.test(t1text) || !/駅/.test(t1text), t1text.slice(0, 150));

const w1 = await getWeather({ area_name: '東京', language: 'en' });
const w1json = w1.content?.[1] ? JSON.parse(w1.content[1].text) : (w1.status ? w1 : JSON.parse(w1.content[0].text));
check('weather en: detected_language=en', w1json.detected_language === 'en', JSON.stringify(w1json).slice(0, 150));
check('weather en: advice block in English', /AI Intelligent Transit Advice/.test(w1.content?.[0]?.text || ''), w1.content?.[0]?.text?.slice(0, 80));

const lp1 = await listFerryPorts({ language: 'zh' });
const lp1text = JSON.stringify(lp1);
check('ferry ports zh: Chinese title', /轮渡及水上巴士/.test(lp1text), lp1text.slice(0, 150));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
