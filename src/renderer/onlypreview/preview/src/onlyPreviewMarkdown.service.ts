import createDOMPurify, { type WindowLike } from 'dompurify';
import { Marked, Renderer, type Tokens } from 'marked';
import { ONLY_PREVIEW_MAX_MARKDOWN_BYTES } from '@shared/onlypreview/onlyPreview.types';

export type OnlyPreviewMarkdownRenderResult =
  | { ok: true; html: string; links: string[] }
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
  private readonly headings = new Map<string, number>();

  constructor(private readonly interactiveLinks: boolean) {
    super();
  }

  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
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
      ALLOWED_ATTR: interactiveLinks
        ? ['data-onlypreview-link', 'data-onlypreview-anchor', 'role', 'tabindex']
        : [],
      ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
      ALLOWED_TAGS: [...ONLY_PREVIEW_MARKDOWN_TAGS],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
      RETURN_TRUSTED_TYPE: false
    });
    return { ok: true, html, links: renderer.links };
  } catch {
    return { ok: false, reason: 'render-failed' };
  }
};
