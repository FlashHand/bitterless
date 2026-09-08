import createDOMPurify, { type WindowLike } from 'dompurify';
import { Marked, Renderer, type Tokens } from 'marked';
import { ONLY_PREVIEW_MAX_MARKDOWN_BYTES } from '@shared/onlypreview/onlyPreview.types';
import { highlightCodeToHtml } from '../../common/onlyPreviewHighlighter.service';

/** 一个 fenced 代码块的原文与它声明的语言 —— 交给 shiki 上色用。 */
export interface OnlyPreviewMarkdownCodeBlock {
  code: string;
  language: string;
}

export type OnlyPreviewMarkdownRenderResult =
  | { ok: true; html: string; links: string[]; codeBlocks: OnlyPreviewMarkdownCodeBlock[] }
  | { ok: false; reason: 'too-large' | 'render-failed' };

const ONLY_PREVIEW_MARKDOWN_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'span'
] as const;

export const stripOnlyPreviewFrontMatter = (source: string): string => {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return source;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] !== '---' && lines[index] !== '...') continue;
    return lines.slice(index + 1).join('\n');
  }
  return source;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

class OnlyPreviewMarkdownRenderer extends Renderer {
  readonly links: string[] = [];
  readonly codeBlocks: OnlyPreviewMarkdownCodeBlock[] = [];
  private readonly headings = new Map<string, number>();

  constructor(private readonly interactiveLinks: boolean) {
    super();
  }

  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  }

  /**
   * 代码块 —— 吐一个**本身就已经可用**的占位符,而不是一个空壳。
   *
   * 里面已经是转义后的原文,所以 `highlightOnlyPreviewMarkdownCode` 没被调用时看到的是
   * 今天的行为(纯代码块,正确,只是没颜色),而不是一个裸占位符。这一点是刻意的:
   * 一个「必须记得再调一步否则页面坏掉」的返回值是个陷阱,尤其这个函数有两个调用方,
   * 其中 `RichSearchPreview.vue` 只要摘要、并不需要上色。
   *
   * `data-onlypreview-code` 进 `ALLOWED_ATTR` 是安全的:值是我们自己发的序号,而文档里的
   * 原始 HTML 走 `html()` 被整段转义,永远变不成标记。
   */
  code({ text, lang }: Tokens.Code): string {
    const index = this.codeBlocks.push({ code: text, language: String(lang ?? '').trim() }) - 1;
    return `<pre data-onlypreview-code="${index}"><code>${escapeHtml(text)}</code></pre>`;
  }

  image({ text }: Tokens.Image): string {
    return `<em>[Image: ${escapeHtml(text.trim() || 'image')}]</em>`;
  }

  link({ tokens, href }: Tokens.Link): string {
    const content = this.parser.parseInline(tokens);
    if (!this.interactiveLinks || !isOnlyPreviewLocalMarkdownLink(href)) return `<a>${content}</a>`;
    const index = this.links.push(href) - 1;
    return `<a data-onlypreview-link="${index}" role="link" tabindex="0">${content}</a>`;
  }

  heading({ tokens, depth }: Tokens.Heading): string {
    const content = this.parser.parseInline(tokens);
    if (!this.interactiveLinks) return `<h${depth}>${content}</h${depth}>`;
    const base = content
      .replace(/<[^>]*>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const count = this.headings.get(base) ?? 0;
    this.headings.set(base, count + 1);
    const anchor = count === 0 ? base : `${base}-${count}`;
    return `<h${depth} data-onlypreview-anchor="${escapeHtml(anchor)}">${content}</h${depth}>`;
  }
}

export const isOnlyPreviewLocalMarkdownLink = (target: string): boolean => {
  if (!target || target.length > 8192) return false;
  for (let index = 0; index < target.length; index += 1) {
    const code = target.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  if (target.startsWith('//') || target.startsWith('\\\\')) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    if (!/^file:/i.test(target)) return false;
    try {
      const url = new URL(target);
      return !url.hostname || url.hostname === 'localhost';
    } catch {
      return false;
    }
  }
  return true;
};

const markdownParser = new Marked();

/**
 * 匹配我们自己发的占位符。
 *
 * 非贪婪到第一个 `</pre>` 是安全的:占位符的内容是**转义后**的原文,所以里面不可能出现
 * 另一个 `</pre>`。属性写法用 `[^>]*` 兜住 DOMPurify 可能做的规范化(属性顺序、引号)。
 */
const CODE_PLACEHOLDER = /<pre[^>]*\sdata-onlypreview-code="(\d+)"[^>]*>[\s\S]*?<\/pre>/g;

/**
 * 把占位符换成 shiki 上色后的 HTML。拿不到语法的块**原样留下**(已经是可用的纯代码块)。
 *
 * **在 sanitize 之后替换,而不是之前** —— 这是这条实现的关键,也是安全边界所在。
 * shiki 靠 inline `style` 上色,而 `ALLOWED_ATTR` 里没有 `style` 也没有 `class`
 * (那份白名单刻意收紧,因为它渲染的是不可信的本地 markdown),所以在 sanitize 之前塞进去
 * 会被逐个剥掉 —— **颜色全没,而且不报错**。
 *
 * 之后替换则不需要放宽白名单一个字符:换进去的 HTML 里,外层标记由我们提供,代码文本由
 * shiki 转义,两者都不来自文档,所以它本来就不属于「不可信文档」那道门要管的东西。
 */
export const highlightOnlyPreviewMarkdownCode = async (
  html: string,
  codeBlocks: readonly OnlyPreviewMarkdownCodeBlock[]
): Promise<string> => {
  if (codeBlocks.length === 0) return html;
  // 先把用到的语言一次并发备好,再同步替换:语法就位后 `codeToHtml` 是同步的,所以一份
  // 文档里出现 5 种语言是 5 次并发加载,不是 5 次串行。
  const rendered = await Promise.all(
    codeBlocks.map((block) => highlightCodeToHtml(block.code, block.language))
  );
  return html.replace(CODE_PLACEHOLDER, (match, rawIndex: string) => {
    const index = Number(rawIndex);
    if (!Number.isSafeInteger(index) || index < 0 || index >= rendered.length) return match;
    return rendered[index] ?? match;
  });
};

export const renderOnlyPreviewMarkdown = (
  source: string,
  sourceSize: number,
  windowLike: WindowLike,
  interactiveLinks = false
): OnlyPreviewMarkdownRenderResult => {
  if (!Number.isSafeInteger(sourceSize) || sourceSize < 0) {
    return { ok: false, reason: 'render-failed' };
  }

  if (sourceSize > ONLY_PREVIEW_MAX_MARKDOWN_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  try {
    const purifier = createDOMPurify(windowLike);
    if (!purifier.isSupported) return { ok: false, reason: 'render-failed' };
    const renderer = new OnlyPreviewMarkdownRenderer(interactiveLinks);
    const parsed = markdownParser.parse(stripOnlyPreviewFrontMatter(source), {
      async: false,
      breaks: false,
      gfm: true,
      renderer
    });
    const html = purifier.sanitize(parsed, {
      // `data-onlypreview-code` **只在交互分支**放行。
      //
      // 非交互分支(`RichSearchPreview.vue` 的搜索摘要)从不调上色步骤,所以那个序号在那条路上
      // 什么都不换来 —— 属性被剥掉之后剩下的正是它要的:一个纯 `<pre><code>`。
      // 那条路的白名单是空的,并且有一条守卫钉着「每个元素零属性」
      // (`onlyPreviewRendering.test.mjs` 的 strips every attribute)。为一个用不到的能力
      // 放宽它,是拿安全边界换零收益 —— 我第一版就是这么写的,那条守卫把它拦了下来。
      //
      // 后果说清:上色只在交互分支生效,也就是文件预览 —— 正是想要它的地方。
      ALLOWED_ATTR: interactiveLinks
        ? [
            'data-onlypreview-link',
            'data-onlypreview-anchor',
            'data-onlypreview-code',
            'role',
            'tabindex'
          ]
        : [],
      ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
      ALLOWED_TAGS: [...ONLY_PREVIEW_MARKDOWN_TAGS],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
      RETURN_TRUSTED_TYPE: false
    });
    return { ok: true, html, links: renderer.links, codeBlocks: renderer.codeBlocks };
  } catch {
    return { ok: false, reason: 'render-failed' };
  }
};
