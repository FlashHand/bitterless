import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';

// JSON/XML/YAML 预览的折叠(docs/plan/tasks/onlypreview-structured-text-folding-172.md)。
//
// 三条会**静默失效**的接缝:
// ① `MonacoTextPreview.vue` 用的是 API-only 入口,folding contribution 要靠一行副作用 import 装进来;
//    那一行被「清理」掉的话,`folding: true` 什么都不做,没有报错。
// ② 「默认最多预览 5 层」= 跑 `editor.foldLevel6`;Monaco 只注册到 7,常量越界就变成 `getAction` 拿到
//    null,同样悄悄什么都不做。
// ③ 「折叠内容也要能复制」不是我们写的代码,是 Monaco 核心的 `textAreaHandler` 按**模型**选区取
//    文本。升级 Monaco 把它改掉时,这里要红。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);
const MONACO_ROOT = dirname(require.resolve('monaco-editor/package.json'));
const monacoSource = (relative) => readFileSync(join(MONACO_ROOT, relative), 'utf8');

const SERVICE = 'src/renderer/onlypreview/preview/src/onlyPreviewMonacoFolding.service.ts';
const MONACO_VIEW =
  'src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue';

const compiled = await transform(source(SERVICE), { loader: 'ts', format: 'esm' });
const folding = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64')
);

test('json/json5/xml/yaml fold and open with five levels expanded; other languages keep no gutter', () => {
  for (const language of ['json', 'json5', 'xml', 'yaml', 'JSON', ' Yaml ']) {
    assert.deepEqual(
      folding.resolveOnlyPreviewMonacoFolding(language),
      { folding: true, collapseActionId: 'editor.foldLevel6' },
      `${language} 应折叠并折起第 6 层`
    );
  }
  for (const language of ['typescript', 'markdown', 'plaintext', 'toml', '', null, undefined]) {
    assert.deepEqual(
      folding.resolveOnlyPreviewMonacoFolding(language),
      { folding: false, collapseActionId: null },
      `${String(language)} 不该多出折叠槽`
    );
  }
  assert.equal(folding.ONLY_PREVIEW_FOLDING_VISIBLE_LEVELS, 5);
});

test('the collapse level stays inside the fold-level actions Monaco actually registers', () => {
  const collapseLevel = folding.ONLY_PREVIEW_FOLDING_VISIBLE_LEVELS + 1;
  assert.ok(
    collapseLevel <= folding.ONLY_PREVIEW_FOLDING_MAX_ACTION_LEVEL,
    `第 ${collapseLevel} 层没有对应的 editor.foldLevel action`
  );
  const contribution = monacoSource('esm/vs/editor/contrib/folding/browser/folding.js');
  const loop = contribution.match(/for \(let i = 1; i <= (\d+); i\+\+\) \{\s*registerInstantiatedEditorAction\(new FoldLevelAction/);
  assert.ok(loop, 'Monaco 里注册 FoldLevelAction 的循环没找到 —— 升级后要重新核对');
  assert.equal(Number(loop[1]), folding.ONLY_PREVIEW_FOLDING_MAX_ACTION_LEVEL);
  assert.match(contribution, /this\.ID_PREFIX = 'editor\.foldLevel'/);
});

test('the SFC loads the folding contribution before creating the editor and applies the plan', () => {
  const view = source(MONACO_VIEW);
  // 锚到行首:注释掉的 import 不能算(ESM import 会被提升,写在哪一行都在 create 之前生效)。
  assert.match(
    view,
    /^import 'monaco-editor\/esm\/vs\/editor\/contrib\/folding\/browser\/folding';$/m,
    'folding contribution 的副作用 import 没了 —— API-only 入口不带它'
  );
  assert.ok(view.includes('monaco.editor.create('), 'monaco.editor.create( 调用没找到');
  // API-only 入口今天确实不带 folding;带了的话这条 import 只是多余,不是错。
  assert.doesNotMatch(monacoSource('esm/vs/editor/editor.api.js'), /contrib\/folding/);

  assert.match(view, /resolveOnlyPreviewMonacoFolding\(props\.language\)/);
  assert.match(view, /folding: foldingPlan\.folding/);
  assert.doesNotMatch(view, /^\s*folding: true,?$/m, '折叠开关必须来自 plan,不能写死给所有语言');
  assert.match(view, /foldingStrategy: 'indentation'/);
  assert.match(view, /showFoldingControls: 'always'/);
  assert.match(view, /void collapseDeepLevels\(editor, foldingPlan\.collapseActionId\)/);
  assert.match(view, /target\.getAction\(actionId\)\?\.run\(\)/);
  // 不导入没有类型的内部模块。
  assert.doesNotMatch(view, /contrib\/folding\/browser\/foldingModel/);
});

test('the codicon font is loaded, so fold chevrons are glyphs and not missing-glyph boxes', () => {
  // docs/issues/onlypreview-folding-icons-render-as-boxes.md:折叠图标是 codicon 字形,字体只在
  // codiconStyles.js 里声明,而 API-only 入口与 folding.js 都不导入它。
  const view = source(MONACO_VIEW);
  assert.match(
    view,
    /^import 'monaco-editor\/esm\/vs\/base\/browser\/ui\/codicons\/codiconStyles';$/m,
    'codiconStyles 的副作用 import 没了 —— 折叠箭头会变成方框'
  );

  // Monaco 这一侧的前提;任一变了,上面那行 import 的意义都要重新核对。
  const decorations = monacoSource('esm/vs/editor/contrib/folding/browser/foldingDecorations.js');
  assert.match(decorations, /registerIcon\('folding-expanded', Codicon\.chevronDown/);
  assert.match(decorations, /registerIcon\('folding-collapsed', Codicon\.chevronRight/);
  const codiconCss = monacoSource('esm/vs/base/browser/ui/codicons/codicon/codicon.css');
  assert.match(codiconCss, /@font-face\s*\{[^}]*font-family:\s*"codicon"/);
  assert.match(codiconCss, /url\(\.\/codicon\.ttf\)/);
  // 主题服务只注入 `content:`,把 font-family 挂到元素上的是这条基础规则 —— 它搬走了箭头也会变方框。
  assert.match(codiconCss, /\.codicon\[class\*=['"]codicon-['"]\]\s*\{[^}]*\bcodicon\b/);
  assert.match(monacoSource('esm/vs/base/browser/ui/codicons/codiconStyles.js'), /codicon\/codicon\.css/);
  for (const entry of ['esm/vs/editor/editor.api.js', 'esm/vs/editor/contrib/folding/browser/folding.js']) {
    assert.doesNotMatch(monacoSource(entry), /codiconStyles/, `${entry} 现在自己带字体了 —— import 变多余`);
  }
});

test('Monaco still copies from model selections, so folded lines land on the clipboard', () => {
  const handler = monacoSource('esm/vs/editor/browser/controller/textAreaHandler.js');
  assert.match(
    handler,
    /getPlainTextToCopy\(this\._modelSelections,/,
    'textAreaHandler 不再按模型选区取复制文本 —— 折叠内容能否复制要重新验证'
  );
  const viewModel = monacoSource('esm/vs/editor/common/viewModel/viewModelImpl.js');
  assert.match(viewModel, /getPlainTextToCopy\(modelRanges, emptySelectionClipboard, forceCRLF\)/);
});
