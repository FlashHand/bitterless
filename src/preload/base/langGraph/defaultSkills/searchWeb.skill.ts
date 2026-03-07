import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { chromium } from 'playwright';
import { pathHelper } from '@shared/pathHelper/preload/pathPreload.helper';
import * as path from 'path';
import type { ProxyConfig } from '../model.adaptor';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  pageContent?: string;
}

const searchBaidu = async (query: string, maxResults: number): Promise<SearchResult[]> => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${maxResults}&ie=utf-8`;
  console.log('[skill] search_web, baidu url:', searchUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        ...BROWSER_HEADERS,
        'Referer': 'https://www.baidu.com/',
        'Host': 'www.baidu.com',
      },
      signal: controller.signal,
    } as any);
    clearTimeout(timeout);

    console.log('[skill] search_web, baidu status:', response.status);
    const html = await response.text();
    console.log('[skill] search_web, baidu html sample:', html.slice(0, 2000));
    const $ = cheerio.load(html);

    const results: SearchResult[] = [];

    $('[class*="result"]').each((i, el) => {
      if (results.length >= maxResults) return false;
      const titleEl = $(el).find('h3 a').first();
      const title = titleEl.text().trim();
      let href = titleEl.attr('href') ?? '';

      console.log(`[skill] search_web, result[${i}] title="${title}" href="${href}"`);

      if (!title || !href) return;

      if (href.startsWith('/')) {
        href = `https://www.baidu.com${href}`;
      }

      const snippet = $(el).find('[class*="abstract"], [class*="content"], [class*="desc"]').first().text().trim();

      results.push({ title, url: href, snippet });
    });

    console.log('[skill] search_web, baidu results count:', results.length);
    return results;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.warn('[skill] search_web, baidu search timeout');
      return [];
    }
    throw err;
  }
};

const cleanText = (text: string): string => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .trim();
};

const extractContentFromHtml = (html: string): string => {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();

  if (article?.textContent) {
    const cleaned = cleanText(article.textContent);
    return cleaned;
  }

  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, aside, iframe, noscript, [class*="ad"], [id*="ad"], [class*="banner"], [class*="sidebar"]').remove();
  return cleanText($('body').text());
};

const fetchPageContent = async (url: string): Promise<string> => {
  console.log('[skill] fetch_page, using Playwright:', url);
  let browser;
  try {
    const appPath = await pathHelper.getAppPath();
    const chromiumPath = path.join(appPath, 'external_resources', 'chromium', 'mac_arm', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    console.log('[skill] fetch_page, chromium path:', chromiumPath);
    
    browser = await chromium.launch({ 
      headless: false,
      executablePath: chromiumPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    
    const context = await browser.newContext({
      userAgent: BROWSER_HEADERS['User-Agent'],
      viewport: { width: 1280, height: 720 },
    });
    
    const page = await context.newPage();
    
    console.log('[skill] fetch_page, navigating to:', url);
    await page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: 20000,
    });
    
    console.log('[skill] fetch_page, page loaded, extracting content...');
    const html = await page.content();
    await browser.close();
    
    const content = extractContentFromHtml(html);
    console.log('[skill] fetch_page, playwright extracted, length:', content.length);
    return content.slice(0, 3000);
  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
    console.warn('[skill] fetch_page, playwright failed:', url, err?.message);
    return '';
  }
};

export const createSearchWebSkill = (proxy?: ProxyConfig) => tool(
  async ({ query, maxResults = 5 }: {
    query: string;
    maxResults?: number;
  }) => {
    console.log('[skill] search_web, query:', query);
    try {
      const results = await searchBaidu(query, maxResults);
      if (results.length === 0) {
        return JSON.stringify({ message: 'No results found', query });
      }
      return JSON.stringify({ query, results }, null, 2);
    } catch (err: any) {
      console.error('[skill] search_web error:', err?.code, err?.message);
      return JSON.stringify({ error: err.message, code: err?.code });
    }
  },
  {
    name: 'search_web',
    description:
      'Search Baidu and return a list of result URLs and snippets. This tool does NOT fetch page content — it only returns titles, URLs, and brief snippets. ' +
      'WORKFLOW AFTER calling search_web: You MUST call fetch_page on each result URL one by one (starting from the first). ' +
      'If fetch_page returns status=ok with useful content, STOP immediately and answer the user — do NOT call more tools. ' +
      'If fetch_page returns status=no_useful_content, try the next URL. Maximum 20 fetch_page attempts total. ' +
      'If no useful content is found after all attempts, tell the user and provide your best suggestion. ' +
      'Do NOT call search_web more than once. ' +
      'IMPORTANT: If the query involves a relative date (tomorrow, yesterday, 明天, etc.), you MUST first call get_date to get the actual date, ' +
      'then use the returned "date" field (YYYY-MM-DD) directly in the query string. Never guess or compute the date yourself.',
    schema: z.object({
      query: z.string().describe('The search query. For time-sensitive queries include exact date from get_date, e.g. "上海天气 2026-03-08". Never use relative terms like "明天".'),
      maxResults: z.number().optional().describe('Max number of search results to return, default 5'),
    }),
  },
);

export const createFetchPageSkill = (proxy?: ProxyConfig) => tool(
  async ({ url }: { url: string }) => {
    console.log('[skill] fetch_page, url:', url);
    const content = await fetchPageContent(url);
    if (!content || content.length < 100) {
      return JSON.stringify({ url, status: 'no_useful_content', content: '' });
    }
    return JSON.stringify({ url, status: 'ok', content });
  },
  {
    name: 'fetch_page',
    description:
      'Fetch and extract the main readable text from a single web page URL. Supports both static HTML and JavaScript-rendered pages (uses headless browser fallback automatically). ' +
      'Returns { url, status, content } where status is "ok" (has useful content) or "no_useful_content" (page empty/blocked). ' +
      'RULES: (1) Only call this after search_web. (2) Call one URL at a time. (3) If status=ok and content answers the question, STOP — do not call fetch_page again. ' +
      '(4) If status=no_useful_content, call fetch_page with the NEXT URL from search_web results. (5) Maximum 20 calls total.',
    schema: z.object({
      url: z.string().describe('The full URL of the page to fetch. Use URLs from search_web results only.'),
    }),
  },
);
