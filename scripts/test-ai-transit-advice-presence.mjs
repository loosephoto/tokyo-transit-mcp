// 全交通検索の通常成功レスポンスで AI アドバイスが先頭テキストとして返ることを検証する回帰テスト。
import * as mod from '../src/index.mjs';

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✅', message);
  }
}

const ADVICE_MARKER = {
  ja: 'AIからのインテリジェントアドバイス',
  en: 'AI Intelligent Transit Advice',
  zh: 'AI智能出行建议'
};

async function assertAdvice(toolName, language, invoke) {
  const response = await invoke();
  const texts = (response?.content || []).map(item => item.text || '');
  const jsonText = texts.find(text => text.trim().startsWith('{')) || '{}';
  const data = JSON.parse(jsonText);

  assert(
    texts.length >= 2 && texts[0].includes(ADVICE_MARKER[language]),
    `${toolName} [${language}]: AIアドバイスを先頭の独立テキストブロックで返す`
  );
  assert(
    !Object.hasOwn(data, 'ai_transit_advice'),
    `${toolName} [${language}]: JSON本体からAIアドバイスを分離する`
  );
}

for (const language of ['ja', 'en', 'zh']) {
  await assertAdvice('search_ferry（通常成功）', language, () =>
    mod.searchFerry({ from_port: '浅草', to_port: 'お台場', language })
  );
  await assertAdvice('search_bus（通常成功）', language, () =>
    mod.searchBus({ busstop_name: '新橋', language })
  );
}

console.log('done');
process.exit(process.exitCode || 0);
