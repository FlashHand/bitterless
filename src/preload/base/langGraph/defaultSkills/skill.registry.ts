import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ProxyConfig } from '../model.adaptor';
import { getSettingSkill } from './getSetting.skill';
import { createFetchUrlSkill } from './fetchUrl.skill';
import { createSearchWebSkill, createFetchPageSkill } from './searchWeb.skill';
import { getDateSkill } from './getDate.skill';

export const createAllSkills = (proxy?: ProxyConfig): Record<string, StructuredToolInterface> => ({
  get_setting: getSettingSkill,
  fetch_url: createFetchUrlSkill(proxy),
  search_web: createSearchWebSkill(proxy),
  fetch_page: createFetchPageSkill(proxy),
  get_date: getDateSkill,
});

export const allSkillNames = ['get_setting', 'fetch_url', 'search_web', 'fetch_page', 'get_date'] as const;

export const SKILL_SELECTOR_PROMPT = `You are a skill selector. Given the user's message history, decide which skills are needed to answer the final user message.

Available skills:
- get_setting: Read local application configuration (connector keys, LLM settings, proxy, etc.)
- fetch_url: Fetch content from any HTTP/HTTPS URL
- search_web: Search Baidu and return a list of result URLs and snippets. Does NOT fetch page content.
- fetch_page: Fetch and extract main text content from a single URL. Use after search_web to read pages one by one.
- get_date: Convert relative date expressions (今天/today, 明天/tomorrow, 3天前/3 days ago, etc.) into actual calendar dates. MUST be called before search_web whenever the query involves any relative time reference.

Respond with ONLY a JSON array of skill names that are needed. If no skills are needed, respond with an empty array [].
Examples:
- "What is the DingTalk config?" → ["get_setting"]
- "Hello, how are you?" → []
- "上海天气怎么样?" → ["search_web", "fetch_page"]
- "明天上海天气怎么样?" → ["get_date", "search_web", "fetch_page"]
- "三天前是几号?" → ["get_date"]
- "今天纽约有什么新闻?" → ["get_date", "search_web", "fetch_page"]
- "What's the weather tomorrow in Beijing?" → ["get_date", "search_web", "fetch_page"]
- "Search for LangGraph docs" → ["search_web", "fetch_page"]`;
