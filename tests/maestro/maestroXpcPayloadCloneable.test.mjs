import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 跨进程边界不许递响应式引用（Ral 2026-09-10：「发个消息都没回复,一直 Sent · waiting…」）。
 *
 * 根因：`session` 住在 `reactive()` 里，所以 `session.detail.workspace` 是一个 **Proxy**，
 * 而 Proxy **过不了 structured clone**。递过去的后果是整次调用在边界上抛
 * `An object could not be cloned.`（37 字符，正是日志里那条被脱敏成 `***` 的消息），
 * 消息**根本没离开渲染进程** —— 所以 main 侧一行日志都没有、耗时 0ms。
 *
 * 它坏在两处，症状完全不同、都很隐蔽：
 *  · `buildAgentContext` → `sendAgentMessage`：发消息永远没回复；
 *  · `toStoredSession` → `saveSession`：会话**静默存不进库**（`persistSession`
 *    的 catch 是「best effort」的空吞，把那个异常吃掉了）。
 *
 * 而且它只在**绑定了工作区之后**才发作 —— 没绑时 `workspace` 是 `undefined`，可克隆。
 * 所以它看起来像"突然坏了"，而不是一直坏。
 *
 * 这个测试对源码断言：那两处必须走 `cloneWorkspace()`。行为断言在这里做不到 ——
 * 触发它需要真的 Electron IPC。
 */

const root = resolve(import.meta.dirname, '../..');
const src = readFileSync(resolve(root, 'src/renderer/maestro/control/src/store/message.store.ts'), 'utf8');

/** 取一个方法的函数体（到下一个同缩进的 `}`）。 */
const bodyOf = (name) => {
  const at = src.indexOf(name);
  assert.ok(at > 0, `找不到 ${name} —— 断言失去作用域，先修断言`);
  const end = src.indexOf('\n  }', at);
  return src.slice(at, end);
};

test('buildAgentContext 递给 main 的 workspace 必须是 clone', () => {
  const body = bodyOf('buildAgentContext(session: MessageSession');
  assert.match(
    body,
    /workspace: this\.cloneWorkspace\(session\.detail\.workspace\)/,
    'workspace 必须 clone —— 直接递响应式 Proxy 会让 sendAgentMessage 在跨进程边界抛 An object could not be cloned.',
  );
  assert.doesNotMatch(
    body,
    /workspace: session\.detail\.workspace\b/,
    '不许按引用递',
  );
});

test('toStoredSession 落库的 workspace 必须是 clone', () => {
  const body = bodyOf('toStoredSession(session: MessageSession');
  assert.match(
    body,
    /workspace: this\.cloneWorkspace\(session\.detail\.workspace\)/,
    'saveSession 也是跨进程边界 —— 递 Proxy 会让持久化静默失败(persistSession 吞掉了那个异常)',
  );
});

test('cloneWorkspace 真的产出新对象（不是原样返回）', () => {
  const body = bodyOf('cloneWorkspace(workspace?: WorkspaceRef)');
  assert.match(body, /\{ \.\.\.workspace \}/, '必须浅拷贝出一个纯对象');
  assert.doesNotMatch(body, /return workspace\b(?!\s*\?)/, '不许把入参原样返回');
});

test('这条要求写在代码里，不只写在这个测试里', () => {
  assert.match(
    src,
    /structured clone/i,
    '成因必须留在代码注释里 —— 下一个人看到 `this.cloneWorkspace(...)` 会觉得它是多余的,顺手改回引用',
  );
});
