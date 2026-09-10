/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';
import less from 'less';
import ts from 'typescript';

const projectRoot = resolve(import.meta.dirname, '../..');
const source = (file) =>
  readFileSync(resolve(projectRoot, 'src/renderer/onlypreview/shell/src', file), 'utf8');
const app = source('App.vue');
const { css } = await less.render(source('App.less'));
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]+)\\}`));
  assert.ok(result, `Missing compiled rule: ${selector}`);
  return result[1];
};

test('compiled Project row marks only the synthetic root and retains selection/exclusion classes', () => {
  const row = app.match(
    /<button\s+v-for="row in onlyPreviewShellStore.visibleRows"[\s\S]*?<\/button>/
  );
  assert.ok(row);
  const code = ts.transpileModule(compile(row[0], { mode: 'function' }).code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const render = new Function('Vue', code)({
    ...Vue,
    resolveComponent: (name) => ({ name })
  });
  // 按类型换图标(Ral 2026-09-09)。用**真的**判定函数 ＋ 一张打标记的组件表,所以这一条顺带验了
  // 「`.md` 那一行拿到的是 markdown 图标」—— 只补一个空对象进作用域的话,渲染能过但什么都没验到。
  const iconModule = { exports: {} };
  new Function('exports', 'module', ts.transpileModule(
    readFileSync(
      resolve(projectRoot, 'src/renderer/onlypreview/common/onlyPreviewTreeIcon.service.ts'),
      'utf8'
    ),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText)(iconModule.exports, iconModule);
  const TREE_FILE_ICONS = {
    document: { name: 'icon-document' },
    spreadsheet: { name: 'icon-spreadsheet' },
    presentation: { name: 'icon-presentation' },
    markdown: { name: 'icon-markdown' },
    pdf: { name: 'icon-pdf' },
    archive: { name: 'icon-archive' },
    image: { name: 'icon-image' },
    file: { name: 'icon-file' }
  };
  const rows = [
    {
      entry: { relativePath: '', name: 'project', nodeKind: 'directory' },
      depth: 0,
      expanded: true
    },
    { entry: { relativePath: 'src', name: 'src', nodeKind: 'directory' }, depth: 1 },
    { entry: { relativePath: 'src/file.md', name: 'file.md', nodeKind: 'file' }, depth: 2 },
    {
      entry: { relativePath: 'vendor', name: 'vendor', nodeKind: 'directory' },
      depth: 1,
      searchExcluded: true
    }
  ];
  const noop = () => {};
  const fragment = render({
    onlyPreviewShellStore: { visibleRows: rows },
    onlyPreviewTreeSelection: { isSelected: (path) => path === 'src/file.md' },
    onlyPreviewProjectAuthoring: { editing: null },
    onlyPreviewI18n: { project: { symlink: 'Symbolic link' } },
    treeFocusRelativePath: '',
    handleTreeRowClick: noop,
    handleTreeRowDoubleClick: noop,
    showOnlyPreviewTreeContextMenu: noop,
    TREE_FILE_ICONS,
    resolveOnlyPreviewFileIconKey: iconModule.exports.resolveOnlyPreviewFileIconKey
  });
  const rendered = fragment.children;
  // `.md` 那一行必须拿到 markdown 图标 —— 这一条是「按类型换图标」在渲染层唯一的行为证据。
  // 目录行仍然是文件夹图标(不走这张表),所以顺带钉住"这张表只管文件那一支"。
  const iconNamesOf = (index) =>
    (rendered[index].children || [])
      .map((child) => child?.type?.name)
      .filter((name) => typeof name === 'string');
  console.log('DEBUG row2 keys', Object.keys(rendered[2]));
  console.log('DEBUG row2 children type', typeof rendered[2].children, Array.isArray(rendered[2].children));
  assert.ok(
    iconNamesOf(2).includes('icon-markdown'),
    `src/file.md 应该用 markdown 图标,实际: ${JSON.stringify(iconNamesOf(2))}`
  );
  assert.ok(
    !iconNamesOf(0).includes('icon-markdown'),
    '目录行不该走文件图标表'
  );
  assert.equal(rendered.length, 4);
  for (let index = 0; index < rendered.length; index += 1) {
    const props = rendered[index].props;
    assert.equal(props.name, 'onlypreview__treeRow');
    assert.equal(props.class.includes('onlypreview-shell__tree-row--root'), index === 0);
    assert.equal(props.style['--onlypreview-tree-depth'], rows[index].depth);
  }
  assert.match(rendered[2].props.class, /tree-row--selected/);
  assert.match(rendered[3].props.class, /tree-row--search-excluded/);
});

test('compiled CSS keeps every Project row 22px/14px, with root-only weight 600', () => {
  const base = rule('.onlypreview-shell__tree-row');
  assert.match(base, /height:\s*22px;/);
  assert.match(base, /font-size:\s*14px;/);
  assert.match(base, /font-weight:\s*500;/);
  assert.match(base, /align-items:\s*center;/);
  assert.match(rule('.onlypreview-shell__tree-row--root'), /font-weight:\s*600;/);
  assert.match(rule('.onlypreview-shell__tree-row--selected'), /background:\s*#d6e4ff;/);
  assert.match(rule('.onlypreview-shell__tree-row--search-excluded'), /background:\s*#fff4e8;/);
  assert.match(rule('.onlypreview-shell__tree-chevron-hit'), /height:\s*21px;/);
  assert.match(rule('.onlypreview-shell__project-action.arco-btn'), /height:\s*27px;/);
});

test('Locate remains DOM-based and row/arrow gestures plus Recents visibility are unchanged', () => {
  assert.match(app, /scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.doesNotMatch(app, /rowHeight|ROW_HEIGHT|itemHeight|itemSize|scrollTop\s*=/);
  assert.match(app, /@click="handleTreeRowClick\(row\.entry, \$event\)"/);
  assert.match(app, /@dblclick\.prevent="handleTreeRowDoubleClick\(row\.entry\)"/);
  assert.match(
    app,
    /@click\.stop="onlyPreviewShellStore\.handleTreeClick\(row\.entry, \$event\.detail, true\)"/
  );
  assert.match(app, /<RecentsPanel v-show=/);
});
