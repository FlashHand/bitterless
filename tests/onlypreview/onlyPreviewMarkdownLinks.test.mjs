/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(import.meta.dirname, '../..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-markdown-links-'));
const modulePath = join(buildRoot, 'markdown.mjs');
await build({
  stdin: {
    contents: `export * from './src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service';
      export * from './src/renderer/onlypreview/preview/src/onlyPreviewMarkdownLink.service';`,
    resolveDir: projectRoot,
    loader: 'ts'
  },
  outfile: modulePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});
const { renderOnlyPreviewMarkdown, findOnlyPreviewMarkdownLink, scrollOnlyPreviewMarkdownAnchor } =
  await import(pathToFileURL(modulePath).href);
after(() => rmSync(buildRoot, { recursive: true, force: true }));

const render = (source, interactive = true) => {
  const dom = new JSDOM('<main></main>');
  const result = renderOnlyPreviewMarkdown(
    source,
    Buffer.byteLength(source),
    dom.window,
    interactive
  );
  assert.equal(result.ok, true);
  const root = dom.window.document.querySelector('main');
  root.innerHTML = result.html;
  return { dom, result, root };
};

test('main Markdown exposes only opaque local link metadata, never a navigable URL', () => {
  const targets = [
    'notes.md',
    '../sibling/费用.md#标题',
    '/tmp/a%20b.md',
    'file:///tmp/a.md',
    '#local'
  ];
  const { root, result } = render(targets.map((target) => `[Open](${target})`).join('\n\n'));
  assert.deepEqual(result.links, targets);
  assert.equal(root.querySelectorAll('[role="link"]').length, targets.length);
  assert.equal(root.querySelector('[href], [src], [onclick]'), null);
  assert.equal(root.querySelector('a').getAttribute('data-onlypreview-link'), '0');
  assert.equal(
    findOnlyPreviewMarkdownLink(root, root.querySelector('a'), result.links),
    targets[0]
  );
});

test('unsafe protocols, remote file hosts and raw HTML never get an active link', () => {
  const { root, result } = render(`[js](javascript:alert(1)) [data](data:text/html,hello)
[remote](file://example.com/tmp/a.md) [network](//example.com/file.md) [web](https://example.com)

<a data-onlypreview-link="0" href="file:///private" onclick="attack()">raw</a>
<img src="file:///private"><script>attack()</script>`);
  assert.deepEqual(result.links, []);
  assert.equal(
    root.querySelector('[role="link"], [data-onlypreview-link], [href], [src], script, img'),
    null
  );
  assert.match(root.textContent, /raw/);
});

test('search/default Markdown keeps every attribute inert and never offers false clickable links', () => {
  const { root, result } = render('# Title\n\n[File](../other.md)', false);
  assert.deepEqual(result.links, []);
  for (const element of root.querySelectorAll('*')) assert.equal(element.attributes.length, 0);
});

test('Unicode and duplicate heading anchors stay document-local and missing anchors are harmless', () => {
  const { root } = render('# 费用 标题\n\n## Repeat\n\n## Repeat');
  const headings = [...root.querySelectorAll('[data-onlypreview-anchor]')];
  assert.deepEqual(
    headings.map((node) => node.dataset.onlypreviewAnchor),
    ['费用-标题', 'repeat', 'repeat-1']
  );
  const scrolled = [];
  for (const heading of headings)
    heading.scrollIntoView = () => scrolled.push(heading.dataset.onlypreviewAnchor);
  assert.equal(
    scrollOnlyPreviewMarkdownAnchor(root, '#%E8%B4%B9%E7%94%A8-%E6%A0%87%E9%A2%98'),
    true
  );
  assert.equal(scrollOnlyPreviewMarkdownAnchor(root, 'repeat-1'), true);
  assert.equal(scrollOnlyPreviewMarkdownAnchor(root, 'missing'), false);
  assert.equal(scrollOnlyPreviewMarkdownAnchor(root, '%invalid'), false);
  assert.deepEqual(scrolled, ['费用-标题', 'repeat-1']);
});

test('delegated link lookup accepts nested labels but rejects foreign or invalid metadata', () => {
  const { dom, root, result } = render('[**File**](a.md)');
  assert.equal(
    findOnlyPreviewMarkdownLink(root, root.querySelector('strong'), result.links),
    'a.md'
  );
  const outside = dom.window.document.createElement('a');
  outside.dataset.onlypreviewLink = '0';
  dom.window.document.body.append(outside);
  assert.equal(findOnlyPreviewMarkdownLink(root, outside, result.links), null);
  for (const value of ['01', '-1', '999', 'NaN']) {
    root.querySelector('a').dataset.onlypreviewLink = value;
    assert.equal(findOnlyPreviewMarkdownLink(root, root.querySelector('a'), result.links), null);
  }
});
