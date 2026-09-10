import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import test, { describe } from 'node:test';
import { build } from 'esbuild';

const root = resolvePath(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolvePath(root, path), 'utf8');

/**
 * Project 树行按文件类型换图标(Ral 2026-09-09:「先将常见的 docx pptx md xlsx 配置上 用 tabler 先,
 * 风格要统一」)。
 *
 * 判定只看扩展名,所以**只有跑真输入才算验过** —— 源码 grep 型守卫能证明表还在,不能证明表是对的。
 * 判错的代价不大(图标不对而已),但两侧都要满:漏一种 = 那种文件在树里看起来还是"未知文件";
 * 多认一种 = 一个不相干的扩展名顶着 Word 图标。
 */
const compiled = await build({
  stdin: {
    contents:
      "export { resolveOnlyPreviewFileIconKey } from './src/renderer/onlypreview/common/onlyPreviewTreeIcon.service.ts';",
    resolveDir: root
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolvePath(root, 'tsconfig.node.json')
});
const { resolveOnlyPreviewFileIconKey } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

describe('resolveOnlyPreviewFileIconKey', () => {
  test('Ral 点名的那四种各自有图标', () => {
    assert.equal(resolveOnlyPreviewFileIconKey('a/b/report.docx'), 'document');
    assert.equal(resolveOnlyPreviewFileIconKey('a/b/budget.xlsx'), 'spreadsheet');
    assert.equal(resolveOnlyPreviewFileIconKey('a/b/deck.pptx'), 'presentation');
    assert.equal(resolveOnlyPreviewFileIconKey('a/b/README.md'), 'markdown');
    // Ral 2026-09-09 追加
    assert.equal(resolveOnlyPreviewFileIconKey('a/b/spec.pdf'), 'pdf');
    assert.equal(resolveOnlyPreviewFileIconKey('X.PDF'), 'pdf');
  });

  test('旧扩展名和新的同一种 —— 否则树里会出现「docx 有图标、doc 没有」', () => {
    assert.equal(resolveOnlyPreviewFileIconKey('x.doc'), 'document');
    assert.equal(resolveOnlyPreviewFileIconKey('x.xls'), 'spreadsheet');
    assert.equal(resolveOnlyPreviewFileIconKey('x.ppt'), 'presentation');
  });

  test('大小写不敏感 —— Windows 上来的文件名常是大写扩展名', () => {
    for (const [path, key] of [
      ['X.DOCX', 'document'],
      ['X.Xlsx', 'spreadsheet'],
      ['X.PPTX', 'presentation'],
      ['X.MD', 'markdown']
    ]) {
      assert.equal(resolveOnlyPreviewFileIconKey(path), key, path);
    }
  });

  test('压缩包与图片(Ral 2026-09-09 点名 file-type-zip / photo-alt)', () => {
    assert.equal(resolveOnlyPreviewFileIconKey('a/b/bundle.zip'), 'archive');
    for (const path of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.HEIC', 'a.tiff']) {
      assert.equal(resolveOnlyPreviewFileIconKey(path), 'image', path);
    }
  });

  test('`.rar` / `.7z` **不**用 zip 图标 —— 纸面上写着 ZIP,贴到别的格式上是标错', () => {
    for (const path of ['a.rar', 'a.7z', 'a.gz', 'a.tar']) {
      assert.equal(resolveOnlyPreviewFileIconKey(path), 'file', path);
    }
  });

  test('其余一律兜底成 file —— 它现在落 file-text,不再是空白的 IconFile', () => {
    for (const path of ['x.ts', 'x.json', 'x.log', 'x.unknown']) {
      assert.equal(resolveOnlyPreviewFileIconKey(path), 'file', path);
    }
  });

  test('只认最后一段扩展名,不被路径里的目录名骗到', () => {
    // 目录名带 `.docx` 而文件本身没有扩展名 —— 必须落 `file`
    assert.equal(resolveOnlyPreviewFileIconKey('some.docx/inner'), 'file');
    // 双扩展名取最后一个
    assert.equal(resolveOnlyPreviewFileIconKey('a.md.bak'), 'file');
    assert.equal(resolveOnlyPreviewFileIconKey('a.bak.md'), 'markdown');
  });

  test('点在开头不是扩展名 —— `.gitignore` 不是一种「gitignore 文件」', () => {
    assert.equal(resolveOnlyPreviewFileIconKey('.gitignore'), 'file');
    assert.equal(resolveOnlyPreviewFileIconKey('.md'), 'file');
  });

  test('没有扩展名、空串、null 都不抛', () => {
    for (const path of ['Makefile', '', '   ', undefined, null]) {
      assert.equal(resolveOnlyPreviewFileIconKey(path), 'file', JSON.stringify(path));
    }
  });
});

describe('树行的接线', () => {
  const app = read('src/renderer/onlypreview/shell/src/App.vue');

  test('文件那一支走映射表,不再是无条件的单一图标', () => {
    assert.match(
      app,
      /:is="TREE_FILE_ICONS\[resolveOnlyPreviewFileIconKey\(row\.entry\.relativePath\)\]"/
    );
    assert.doesNotMatch(
      app,
      /<Icon\w+ v-else class="onlypreview-shell__tree-icon"/,
      '还留着一个无条件的图标 = 没有按类型分'
    );
    // Ral 2026-09-09 点名的那一套必须真的在表里(名字写错不会报错,只会渲染出一个空组件)
    for (const icon of [
      'IconFileText',
      'IconFileTypeDoc',
      'IconFileTypeXls',
      'IconFileTypePpt',
      'IconFileTypePdf',
      'IconFileTypeZip',
      'IconPhotoAlt'
    ]) {
      assert.match(app, new RegExp(`\\b${icon}\\b`), icon);
    }
  });

  test('每个 key 都在映射表里 —— 少一个是运行时的空组件,不是 TS 错', () => {
    const table = app.slice(app.indexOf('const TREE_FILE_ICONS'), app.indexOf('const previewHostRef'));
    for (const key of [
      'document',
      'spreadsheet',
      'presentation',
      'markdown',
      'pdf',
      'archive',
      'image',
      'file'
    ]) {
      assert.match(table, new RegExp(`\\b${key}:`), key);
    }
  });

  test('风格一致:同一个尺寸与同一个类', () => {
    const usage = app.slice(app.indexOf(':is="TREE_FILE_ICONS'), app.indexOf(':is="TREE_FILE_ICONS') + 260);
    assert.match(usage, /class="onlypreview-shell__tree-icon"/);
    assert.match(usage, /:size="14"/);
    assert.match(usage, /aria-hidden="true"/);
  });
});
