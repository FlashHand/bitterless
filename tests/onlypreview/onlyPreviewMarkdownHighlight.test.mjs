import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { markdown } from './onlyPreviewRenderingTest.helper.mjs';

// markdown 代码块的高亮(hl-003,docs/features/code-highlighting-shiki.md)。
//
// 这条实现有一个**安全边界**:上色后的 HTML 是在 DOMPurify **之后**替换进去的,因为 shiki 靠
// inline `style` 上色而白名单里没有 `style`/`class`(那份白名单刻意收紧,它渲染的是不可信的
// 本地 markdown)。在 sanitize 之前替换会被剥成无色 —— 无声地。
//
// 之后替换的代价是那段 HTML **不过白名单**。它成立的前提是两条:外层标记由我们生成,
// 代码文本由 shiki 转义。第二条是**假设,必须实测** —— 下面第一条用例就是干这个的,
// 因为它错了就是一个注入,而不是一个配色问题。

const codeBlock = (language, code) => `\`\`\`${language}\n${code}\n\`\`\`\n`;

/**
 * 走 **interactiveLinks 的那条路** —— 上色只在这条路上生效,所以测试必须用它。
 *
 * 共享 helper 的 `render()` 走的是非交互路径(搜索摘要),那条路的 `ALLOWED_ATTR` 是空的,
 * 占位符序号会被剥掉 —— 那是**刻意的**:那条路从不调上色,给它放行一个用不到的属性等于
 * 拿安全边界换零收益(`onlyPreviewRendering.test.mjs` 的 strips every attribute 钉着这一条)。
 */
const render = (source) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  return {
    dom,
    result: markdown.renderOnlyPreviewMarkdown(source, Buffer.byteLength(source), dom.window, true)
  };
};

test('shiki escapes the code text — the assumption that lets substitution skip the sanitizer', async () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const { result } = render(codeBlock('ts', `const a = ${JSON.stringify(hostile)}`));
  assert.ok(result.ok);
  const html = await markdown.highlightOnlyPreviewMarkdownCode(result.html, result.codeBlocks);

  // 先确认上色真的发生了,否则下面的断言会因为「压根没替换」而空过。
  assert.match(html, /class="shiki github-light"/, '没有替换成 shiki 输出,这条断言就没在测东西');

  // 断言的是**性质,不是字符串**。
  //
  // 2026-09-08 实测:shiki 把 `<` 转成 `&#x3C;`,但 `>` 保持字面,所以输出里确实存在
  // `onerror=alert(2)>` 这样的字符序列。那是**惰性文本** —— 本该开标签的 `<img` 已经是
  // `&#x3C;img`,没有开标签的 `>` 和属性名只是字符。所以「输出里有没有 onerror=」不是判据,
  // 「有没有多出一个真实标签」才是。这条曾把我自己的断言写错过一次。
  const tags = new Set([...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]));
  assert.deepEqual(
    [...tags].sort(),
    ['code', 'pre', 'span'],
    '替换进去的 HTML 里只允许出现 shiki 自己的标签;多一个就是代码文本变成了标记'
  );
  // `<` 必须被转义 —— 上面那条已经覆盖,这里再钉一次直接原因,因为它是唯一能开标签的字符。
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&#x3C;script/, '原文里的 < 应当以转义形式出现');
});

test('the placeholder is already usable, so skipping the async step degrades to plain code', async () => {
  const { result } = render(codeBlock('ts', 'const a: number = 1'));
  assert.ok(result.ok);
  // 不调替换步骤时看到的就是今天的行为:纯代码块,内容正确、已转义。
  assert.match(result.html, /<pre data-onlypreview-code="0"><code>/);
  assert.match(result.html, /const a: number = 1/);
  assert.doesNotMatch(result.html, /__PLACEHOLDER__|undefined/);
  // 这一点是刻意的:`RichSearchPreview.vue` 只要摘要,并不调上色。
  assert.equal(result.codeBlocks.length, 1);
  assert.deepEqual(result.codeBlocks[0], { code: 'const a: number = 1', language: 'ts' });
});

test('a language with no grammar keeps its plain block instead of losing the code', async () => {
  const { result } = render(codeBlock('brainfuck', '++++[>++++<-]'));
  assert.ok(result.ok);
  const html = await markdown.highlightOnlyPreviewMarkdownCode(result.html, result.codeBlocks);
  assert.match(html, /\+\+\+\+\[&gt;\+\+\+\+&lt;-\]/, '代码必须还在');
  assert.doesNotMatch(html, /class="shiki/, '没有语法时不该硬凑一个上色结果');
});

test('a fence with no language stays plain, and prose around it is untouched', async () => {
  const { result } = render(`# Title\n\ntext\n\n\`\`\`\nplain\n\`\`\`\n`);
  assert.ok(result.ok);
  const html = await markdown.highlightOnlyPreviewMarkdownCode(result.html, result.codeBlocks);
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /plain/);
  assert.doesNotMatch(html, /class="shiki/);
});

test('several languages in one document are each highlighted', async () => {
  const source =
    codeBlock('ts', 'const a: number = 1') +
    '\ntext\n\n' +
    codeBlock('python', 'def f(x): return x') +
    '\n' +
    codeBlock('json', '{"a": 1}');
  const { result } = render(source);
  assert.ok(result.ok);
  assert.equal(result.codeBlocks.length, 3);
  const html = await markdown.highlightOnlyPreviewMarkdownCode(result.html, result.codeBlocks);
  assert.equal(
    (html.match(/class="shiki github-light"/g) ?? []).length,
    3,
    '三个块都该上色 —— 少一个说明并发加载或替换掉了一个'
  );
  assert.doesNotMatch(html, /data-onlypreview-code/, '替换完不该还留着占位符属性');
});

test('a document cannot forge a placeholder to inject markup', async () => {
  // 文档里写原始 HTML 走 `html()` 覆写被整段转义,所以它永远变不成标记 —— 这也是
  // `data-onlypreview-code` 能进 ALLOWED_ATTR 的前提。
  const { result } = render(
    '<pre data-onlypreview-code="0"><code>x</code></pre>\n\n' + codeBlock('ts', 'const real = 1')
  );
  assert.ok(result.ok);
  // 文档写的那个只以转义文本存在;真正的占位符只有一个,序号 0 属于那个 ts 块。
  assert.equal(result.codeBlocks.length, 1);
  assert.equal(result.codeBlocks[0].code, 'const real = 1');
  const html = await markdown.highlightOnlyPreviewMarkdownCode(result.html, result.codeBlocks);
  assert.equal(
    (html.match(/class="shiki github-light"/g) ?? []).length,
    1,
    '文档伪造的占位符不该也被替换'
  );
});

test('an out-of-range placeholder index is left alone rather than resolving to undefined', async () => {
  const { result } = render(codeBlock('ts', 'const a = 1'));
  assert.ok(result.ok);
  const tampered = result.html.replace('data-onlypreview-code="0"', 'data-onlypreview-code="99"');
  const html = await markdown.highlightOnlyPreviewMarkdownCode(tampered, result.codeBlocks);
  assert.match(html, /const a = 1/, '越界序号不该把代码换成 undefined');
  assert.match(html, /data-onlypreview-code="99"/, '不认识的序号原样留下');
});

test('no code blocks means no highlighter work at all', async () => {
  const { result } = render('# Title\n\njust prose, `inline code` only.\n');
  assert.ok(result.ok);
  assert.equal(result.codeBlocks.length, 0);
  const html = await markdown.highlightOnlyPreviewMarkdownCode(result.html, result.codeBlocks);
  assert.equal(html, result.html, '没有代码块时应当原样返回同一个字符串');
});
