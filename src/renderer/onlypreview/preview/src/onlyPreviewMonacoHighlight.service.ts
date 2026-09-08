// 把 shiki 的 TextMate 分词器装进 Monaco —— 换掉 monarch 上色,Monaco 本身留着。
//
// Monaco 留着是因为 OnlyPreview 依赖它的三件事换不掉:find adapter
// (`onlyPreviewMonacoFind.service.ts`)、选区字符计数、以及大文件的虚拟滚动。所以这里只换
// **上色那一层**,不换编辑器。诊断与实测见 `docs/features/code-highlighting-shiki.md`。
import type * as monacoNs from 'monaco-editor';
import { shikiToMonaco } from '@shikijs/monaco';
import {
  ONLY_PREVIEW_HIGHLIGHT_THEME,
  normalizeHighlightLanguage,
  prepareHighlighter
} from '../../common/onlyPreviewHighlighter.service';

/**
 * shiki 没备好时退回的主题。
 *
 * **名字里没有 monarch 是刻意的**:组件用的是 API-only 入口,所以 monarch 语法根本没打包 ——
 * 这条退路给出的是**纯文本 ＋ `vs` 配色**,不是「粗一点的高亮」。以前叫
 * `MONACO_MONARCH_FALLBACK_THEME` 是准确的,砍掉语言贡献之后就不准了。
 *
 * 仍然值得有这条退路:纯文本读得出内容,白屏读不出。而且它只在**首次**打开某语言且语法加载
 * 超时时出现 —— 语法有缓存,同一语言的下一次是即时的。
 */
export const MONACO_PLAIN_FALLBACK_THEME = 'vs';

/**
 * 语法加载的等待上限。
 *
 * 超时就退回 monarch ＋ `vs`,**而不是继续等**:一次语法加载卡住不该把整个预览卡住,而
 * monarch 虽然粗,但它不是空白。加载会在后台继续并被缓存,所以同一语言的下一次打开是即时的
 * —— 也就是说超时最多影响首次,不会变成常态降级。
 */
const GRAMMAR_TIMEOUT_MS = 1200;

/**
 * 已经把哪些语言的分词器装进 Monaco 了。
 *
 * `shikiToMonaco` 一次性为**当前已加载的全部语法**装分词器,所以每加载一个新语法都要重调一次。
 * 这个集合只是用来跳过重复调用 —— 重调不会出错,但会重复注册主题数据。
 */
const installed = new Set<string>();

const registerLanguageId = (monaco: typeof monacoNs, id: string): void => {
  // `tsx` / `jsx` / `vue` / `toml` **不是** Monaco 的内置语言 id,不先注册的话 Monaco 会拒绝
  // 用它建 model(退回 plaintext)。`typescript` 这些内置的重复注册是无害的,所以统一先查再注册。
  if (monaco.languages.getLanguages().some((language) => language.id === id)) return;
  monaco.languages.register({ id });
};

/**
 * 备好一个语言在 Monaco 里的 shiki 高亮。返回要传给 `monaco.editor.create` 的
 * `{ language, theme }`,拿不到就 `null`(调用方用 monarch ＋ `vs`)。
 *
 * `null` 是正常结果:纯文本、没打包语法的语言、以及超时都走这条。高亮是配色,不是内容 ——
 * 拿不到配色要照旧把文件显示出来。
 */
export const prepareMonacoHighlighting = async (
  monaco: typeof monacoNs,
  language: string | null | undefined,
  timeoutMs: number = GRAMMAR_TIMEOUT_MS
): Promise<{ language: string; theme: string } | null> => {
  const normalized = normalizeHighlightLanguage(language);
  if (!normalized) return null;
  registerLanguageId(monaco, normalized);

  const ready = await Promise.race([
    prepareHighlighter(normalized, ONLY_PREVIEW_HIGHLIGHT_THEME),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    })
  ]);
  if (!ready) return null;

  const signature = `${ready.language}::${ready.theme}`;
  if (!installed.has(signature)) {
    try {
      // `shikiToMonaco` 的类型标的是 `monaco-editor-core`,而这里传的是 `monaco-editor` ——
      // 后者是前者的超集,运行时完全兼容;这个 cast 是为了那个类型标注,不是为了绕过检查。
      shikiToMonaco(ready.core, monaco as unknown as Parameters<typeof shikiToMonaco>[1], {
        // 与组件里 `maxTokenizationLineLength` / `stopRenderingLineAfter` 的 20_000 对齐:
        // 三个上限不一致的话,一行超长的最小化产物会在不同层各截断一次,表现成"部分有色"。
        tokenizeMaxLineLength: 20_000,
        tokenizeTimeLimit: 500
      });
      installed.add(signature);
    } catch {
      return null;
    }
  }
  return { language: ready.language, theme: ready.theme };
};
