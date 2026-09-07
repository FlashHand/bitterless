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
    showOnlyPreviewTreeContextMenu: noop
  });
  const rendered = fragment.children;
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
