import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runtime, source } from './onlyPreviewCoreTest.helper.mjs';

/**
 * 两个复制快捷键
 * (`docs/issues/onlypreview-copy-name-shortcut-never-matches.md`,Ral 2026-09-10)。
 *
 * - `Cmd+Opt+C`(复制文件名)在 macOS 上**从来没有匹配过**:Option 是组字修饰键,按住它敲 C
 *   产生的 `key` 是 `'ç'`,而判据只看 `key`。
 * - plain `Cmd+C`(复制文件)要求焦点正好落在树行那个 `<button>` 上,所以行选中了但焦点在别处时
 *   什么都不做。
 *
 * 两条都是"静默不发生"型的失败 —— 没有报错、没有日志,只有"按了没反应"。所以判据都被提成纯函数
 * 真跑,而不是靠读代码。
 */
const { resolveOnlyPreviewCopyShortcut } = runtime;

const keyEvent = (overrides = {}) => ({
  key: 'c',
  code: 'KeyC',
  metaKey: true,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...overrides
});

const context = (overrides = {}) => ({
  isMac: true,
  editing: false,
  targetIsEditable: false,
  hasTextSelection: false,
  treeSelectedRelativePath: 'sub/notes.md',
  ...overrides
});

describe('main 侧：Cmd+Opt+C 的判据必须看 code', () => {
  // 这一条是源码守卫:那个谓词是 `onlyPreviewWindow.helper.ts` 里的模块私有函数,而整个文件
  // 依赖 Electron,没法在这里 import。钉的是"有没有按 code 判" —— 那正是这次的缺陷。
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const predicate = helper.slice(
    helper.indexOf('const isProjectItemCopyShortcut = (input: Input): boolean => {')
  );
  const body = predicate.slice(0, predicate.indexOf('\n};'));

  test('按 code 判，key 只是兜底', () => {
    assert.match(
      body,
      /input\.code !== 'KeyC' && input\.key\.toLowerCase\(\) !== 'c'/,
      'macOS 上 Option+C 的 key 是 ç —— 只看 key 就永远匹配不上'
    );
  });

  test('两个修饰键同时按不是复制（既有结论不变）', () => {
    assert.match(body, /input\.shift === input\.alt/);
  });

  test('和同一个文件里 Digit1 那条写法一致 —— 这个坑本仓踩过', () => {
    assert.match(helper, /\(input\.code === 'Digit1' \|\| key === '1'\)/);
  });
});

describe('渲染层：plain Cmd+C 复制文件', () => {
  test('普通情形 → 复制树选中项', () => {
    assert.deepEqual(resolveOnlyPreviewCopyShortcut(keyEvent(), context()), {
      kind: 'copy-item',
      relativePath: 'sub/notes.md'
    });
  });

  test('项目根（空相对路径）是合法目标 —— 判 null 不判真值', () => {
    assert.deepEqual(
      resolveOnlyPreviewCopyShortcut(keyEvent(), context({ treeSelectedRelativePath: '' })),
      { kind: 'copy-item', relativePath: '' }
    );
  });

  test('没有任何选中 → 不接管', () => {
    assert.deepEqual(
      resolveOnlyPreviewCopyShortcut(keyEvent(), context({ treeSelectedRelativePath: null })),
      { kind: 'ignore' }
    );
  });

  test('不再要求焦点落在树行上 —— 这正是这次修的那条', () => {
    // 调用方不再传任何"目标是哪个元素"的信息,只传"目标是不是可编辑控件"。
    // 也就是说点了一行、焦点随后落到面包屑上时,这一下照样复制那一行。
    const decision = resolveOnlyPreviewCopyShortcut(keyEvent(), context());
    assert.equal(decision.kind, 'copy-item');
  });

  describe('别人占用这个键的三种情形，一律让给浏览器', () => {
    for (const [name, overrides] of [
      ['正在内联重命名', { editing: true }],
      ['目标是可编辑控件', { targetIsEditable: true }],
      ['存在非空文本选区', { hasTextSelection: true }]
    ]) {
      test(name, () => {
        assert.deepEqual(
          resolveOnlyPreviewCopyShortcut(keyEvent(), context(overrides)),
          { kind: 'ignore' },
          `${name} 时接管等于把文本复制吞掉`
        );
      });
    }
  });

  describe('不是这个快捷键的情形', () => {
    for (const [name, overrides] of [
      ['Shift（那是 main 的 Copy Path）', { shiftKey: true }],
      ['Alt（那是 main 的 Copy Name）', { altKey: true }],
      ['没有主修饰键', { metaKey: false }],
      ['mac 上同时按了 Ctrl', { ctrlKey: true }],
      ['另一个键', { key: 'v', code: 'KeyV' }],
      ['长按重复', { repeat: true }],
      ['输入法组字中', { isComposing: true }],
      ['已经被别人处理过', { defaultPrevented: true }]
    ]) {
      test(name, () => {
        assert.deepEqual(resolveOnlyPreviewCopyShortcut(keyEvent(overrides), context()), {
          kind: 'ignore'
        });
      });
    }
  });

  test('code 与 key 任一命中即可（非标准布局的兜底）', () => {
    // `code` 对但 `key` 被改写
    assert.equal(
      resolveOnlyPreviewCopyShortcut(keyEvent({ key: 'ç' }), context()).kind,
      'copy-item'
    );
    // `key` 对但 `code` 不是 KeyC
    assert.equal(
      resolveOnlyPreviewCopyShortcut(keyEvent({ code: 'KeyJ' }), context()).kind,
      'copy-item'
    );
  });

  test('非 mac：Ctrl 是主修饰键，Meta 不是', () => {
    assert.equal(
      resolveOnlyPreviewCopyShortcut(
        keyEvent({ metaKey: false, ctrlKey: true }),
        context({ isMac: false })
      ).kind,
      'copy-item'
    );
    assert.equal(
      resolveOnlyPreviewCopyShortcut(keyEvent(), context({ isMac: false })).kind,
      'ignore',
      'Windows 上 Cmd 键不该触发'
    );
  });
});

describe('复制失败时留下原因', () => {
  test('不再是裸 catch —— 原来任何异常都折成同一句「复制失败」', () => {
    const service = source(
      'src/main/miniapps/onlypreview/onlyPreviewProjectNativeAction.service.ts'
    );
    const copy = service.slice(service.indexOf('async copyProjectItemFromUi('));
    const body = copy.slice(0, copy.indexOf('\n  private async authorizeCopyItem'));
    assert.ok(!/\} catch \{\s*await this\.showCopyFailure/.test(body), '裸 catch 又回来了');
    assert.match(body, /catch \(error\)/);
    assert.match(body, /event=copy-failed kind=/, '日志要带 copyKind —— 否则分不清是哪个快捷键');
    assert.match(body, /await this\.showCopyFailure\(window\)/, '对话框照旧,那是给人看的');
  });
});
