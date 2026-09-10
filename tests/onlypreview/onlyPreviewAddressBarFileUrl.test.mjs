import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import { runtime } from './onlyPreviewCoreTest.helper.mjs';

/**
 * 地址栏显示 `file://`,以及**那一行必须能被敲回去**
 * (Ral 2026-09-10:「我只是希望 url 上显示 file:// …只要看起来像真实浏览器就好」)。
 *
 * 往返是这条需求的承重部分:地址栏可编辑,显示成 `file:///…` 之后人按一下回车就该回到同一个文件。
 * 只改显示的话那次回车会落到 `normalizeUrl`,一个 `.csv` 在普通 tab 里变成原始文本。
 *
 * 这一组是真跑纯函数(vendored shared 面,两仓逐字节相同),不是源码守卫 —— 编码/解码的每一条分支
 * 都有可见后果,而它们不需要 Electron 也不碰文件系统。
 */
const { isAbsoluteFilePath, resolveAddressBarLocalPath, toLocalFileUrl } = runtime;

describe('出：绝对路径 → 地址栏那一行', () => {
  test('普通 POSIX 路径', () => {
    assert.equal(toLocalFileUrl('/Users/ral/notes.md'), 'file:///Users/ral/notes.md');
  });

  test('空格保留成 %20 —— 真实浏览器就是这么显示的', () => {
    assert.equal(
      toLocalFileUrl('/Users/ral/Documents/PIL 2/2.csv'),
      'file:///Users/ral/Documents/PIL%202/2.csv'
    );
  });

  test('和 node 的 pathToFileURL 对齐（同一批 POSIX 路径）', () => {
    // 拿 node 自己的实现当参照:手写编码的意义是不 import node-only 模块,不是换一种编法。
    for (const path of [
      '/Users/ral/notes.md',
      '/Users/ral/Documents/PIL 2/2.csv',
      '/tmp/a-b_c.1.txt',
      '/Users/ral/中文目录/文件.md',
      '/Users/ral/a+b/c&d.md'
    ]) {
      assert.equal(toLocalFileUrl(path), pathToFileURL(path).href, path);
    }
  });

  test('`#` 与 `?` 必须被编码 —— 否则那是一条指向别的文件的 URL', () => {
    assert.equal(toLocalFileUrl('/Users/ral/a#b.md'), 'file:///Users/ral/a%23b.md');
    assert.equal(toLocalFileUrl('/Users/ral/a?b.md'), 'file:///Users/ral/a%3Fb.md');
    // encodeURI 会放过这两个字符,那是这里逐段 encodeURIComponent 的理由
    assert.notEqual(toLocalFileUrl('/Users/ral/a#b.md'), `file://${encodeURI('/Users/ral/a#b.md')}`);
  });

  test('重复斜杠折叠，不留空段', () => {
    assert.equal(toLocalFileUrl('/Users//ral///notes.md'), 'file:///Users/ral/notes.md');
  });

  test('Windows 盘符与 UNC', () => {
    assert.equal(toLocalFileUrl('C:\\Users\\ral\\a b.md'), 'file:///C:/Users/ral/a%20b.md');
    assert.equal(toLocalFileUrl('C:/Users/ral/a.md'), 'file:///C:/Users/ral/a.md');
    assert.equal(toLocalFileUrl('C:\\'), 'file:///C:/');
    assert.equal(toLocalFileUrl('\\\\server\\share\\a b.md'), 'file://server/share/a%20b.md');
  });

  test('不是绝对路径 → 空串（调用方据此退回兜底那个静态 URL）', () => {
    for (const input of ['', '   ', 'notes.md', 'https://example.com', '//example.com', '/']) {
      assert.equal(toLocalFileUrl(input), '', JSON.stringify(input));
    }
  });
});

describe('入：地址栏那一串 → 绝对路径', () => {
  test('裸路径原样通过（既有行为不动）', () => {
    assert.equal(resolveAddressBarLocalPath('/Users/ral/notes.md'), '/Users/ral/notes.md');
    assert.equal(resolveAddressBarLocalPath('  /Users/ral/notes.md  '), '/Users/ral/notes.md');
    assert.equal(resolveAddressBarLocalPath('C:\\Users\\ral\\a.md'), 'C:\\Users\\ral\\a.md');
  });

  test('`file://` 写法被解回同一条路径', () => {
    assert.equal(
      resolveAddressBarLocalPath('file:///Users/ral/Documents/PIL%202/2.csv'),
      '/Users/ral/Documents/PIL 2/2.csv'
    );
    assert.equal(resolveAddressBarLocalPath('FILE:///Users/ral/notes.md'), '/Users/ral/notes.md');
    assert.equal(resolveAddressBarLocalPath('file://localhost/Users/ral/notes.md'), '/Users/ral/notes.md');
  });

  test('Windows 与 UNC 的 file:// 写法', () => {
    assert.equal(resolveAddressBarLocalPath('file:///C:/Users/ral/a%20b.md'), 'C:\\Users\\ral\\a b.md');
    assert.equal(resolveAddressBarLocalPath('file:///C:/'), 'C:\\');
    assert.equal(resolveAddressBarLocalPath('file://server/share/a%20b.md'), '\\\\server\\share\\a b.md');
    // authority 叫什么不影响这个判断 —— 带 authority 的 file:// 就是 UNC 的 URL 写法。
    // 这不是放宽面:裸的 `\\example.com\x` 本来就被 isAbsoluteFilePath 认,而"认"只是分类,
    // 接下来还要查存在性;在 mac 上它一定不存在 → missing → Chromium 自己的错误页。
    assert.equal(resolveAddressBarLocalPath('file://example.com/x'), '\\\\example.com\\x');
  });

  test('不是本机路径 → null', () => {
    for (const input of [
      '',
      '   ',
      'notes.md',
      'https://example.com',
      '//example.com',
      '/',
      'c:8080',
      'file:///Users/ral/%zz.md'
    ]) {
      assert.equal(resolveAddressBarLocalPath(input), null, JSON.stringify(input));
    }
  });

  test('坏的百分号序列不许被当成路径原样交出去', () => {
    // 交出去等于拿一条我们没读懂的东西去碰文件系统。
    assert.equal(resolveAddressBarLocalPath('file:///Users/ral/%zz.md'), null);
  });
});

describe('往返：显示成什么，就能被敲回去', () => {
  test('每一条路径 出→入 都回到自己', () => {
    for (const path of [
      '/Users/ral/notes.md',
      '/Users/ral/Documents/PIL 2/2.csv',
      '/Users/ral/中文目录/文件.md',
      '/Users/ral/a#b.md',
      '/Users/ral/a?b.md',
      '/Users/ral/a%b.md',
      '/Users/ral/a+b/c&d.md',
      '/Users/ral/Documents/PIL 2'
    ]) {
      const shown = toLocalFileUrl(path);
      assert.equal(resolveAddressBarLocalPath(shown), path, `${path} → ${shown}`);
    }
  });

  test('Windows 那两种形状也往返', () => {
    for (const path of ['C:\\Users\\ral\\a b.md', '\\\\server\\share\\a b.md']) {
      assert.equal(resolveAddressBarLocalPath(toLocalFileUrl(path)), path, path);
    }
  });

  test('isAbsoluteFilePath 没被改坏 —— 它是另一个问题（长得像不像）', () => {
    assert.equal(isAbsoluteFilePath('/Users/ral/notes.md'), true);
    assert.equal(isAbsoluteFilePath('file:///Users/ral/notes.md'), false, 'file:// 不是裸路径');
    assert.equal(isAbsoluteFilePath('c:8080'), false);
  });
});
