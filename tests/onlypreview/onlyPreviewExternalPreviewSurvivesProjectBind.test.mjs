/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createRegistries,
  expectOnlyPreviewError,
  registerWorkspace,
  withTempDirectory,
  write
} from './onlyPreviewCoreTest.helper.mjs';

/**
 * 绑定一个项目**不许**撤掉这个 host 正在显示的外部预览。
 *
 * `docs/issues/onlypreview-first-external-open-is-replaced-by-the-restored-project.md` 的**第二条**
 * 替换路径 —— 也是真正让「第一次打开工作区外的文件没反应」这个症状留下来的那一条。第一条是
 * `presentSelection`(已修);这一条走撤销:`registerValidatedTarget` 原来调的是跨 kind 的
 * `revokeHost`,撤销监听 → `handleWorkspaceRevoked` → 预览区被**清空**。
 *
 * 所以那次修复只是把症状从「被项目记住的文件换掉」变成「被清空」。两者对人来说没有区别。
 *
 * 这里必须是**行为**测试而不是源码守卫:那次漏掉它,正是因为落地的测试只数了 `presentSelection`
 * 的调用次数(它确实是 0),而撤销这条路径一个断言都没有碰到。
 */
const externalRoot = (root) => {
  const outside = join(root, 'outside');
  mkdirSync(outside, { recursive: true });
  write(join(outside, 'external.txt'), 'external');
  return realpathSync(outside);
};

const projectRootAt = (root, name) => {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  write(join(directory, 'notes.md'), '# notes');
  return realpathSync(directory);
};

const registerExternal = (workspaces, hostToken, rootRealPath) =>
  workspaces.registerExternalPreview(hostToken, {
    rootRealPath,
    rootName: 'outside',
    displayPath: rootRealPath,
    selectedRelativePath: 'external.txt'
  });

test('binding a Project keeps the live external Preview alive and fires no revocation for it', async () => {
  await withTempDirectory('onlypreview-external-survives-bind-', async (root) => {
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const revoked = [];
    workspaces.onRevoke((workspace) => revoked.push(workspace.kind));

    const externalRef = registerExternal(workspaces, host.hostToken, externalRoot(root));
    const project = registerWorkspace(workspaces, host.hostToken, projectRootAt(root, 'project'));

    // 这一条就是 bug:原来这里会记到 'external-preview'。
    assert.deepEqual(
      revoked,
      [],
      '绑定项目时撤掉了外部预览 —— 撤销监听会把正在显示那个文件的预览区清空'
    );
    assert.equal(
      workspaces.requireWorkspace(host.hostToken, externalRef.workspaceId).workspaceId,
      externalRef.workspaceId,
      '外部预览记录必须还活着,否则它的 asset token 立刻全部失效'
    );
    assert.equal(
      workspaces.restore(host.hostToken)?.workspaceId,
      project.workspaceId,
      '项目照样绑上了 —— 「No project open」那个修复不能被这次收窄弄回去'
    );
  });
});

test('binding a Project still revokes the previous Project', async () => {
  await withTempDirectory('onlypreview-project-replaces-project-', async (root) => {
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const revoked = [];
    workspaces.onRevoke((workspace) => revoked.push(workspace.kind));

    const first = registerWorkspace(workspaces, host.hostToken, projectRootAt(root, 'first'));
    const second = registerWorkspace(workspaces, host.hostToken, projectRootAt(root, 'second'));

    assert.deepEqual(revoked, ['project'], '换项目时旧项目的能力必须作废');
    assert.throws(
      () => workspaces.requireWorkspace(host.hostToken, first.workspaceId),
      expectOnlyPreviewError('WORKSPACE_NOT_FOUND')
    );
    assert.equal(workspaces.restore(host.hostToken)?.workspaceId, second.workspaceId);
  });
});

test('a Project and an external Preview coexist on one host, and revokeHost takes down both', async () => {
  await withTempDirectory('onlypreview-host-revoke-both-', async (root) => {
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const externalRef = registerExternal(workspaces, host.hostToken, externalRoot(root));
    const project = registerWorkspace(workspaces, host.hostToken, projectRootAt(root, 'project'));

    const revoked = [];
    workspaces.onRevoke((workspace) => revoked.push(workspace.kind));
    // host 整个没了是**另一回事** —— 那里的跨 kind 撤销是对的,不能照着上面收窄。
    workspaces.revokeHost(host.hostToken);

    assert.deepEqual(
      [...revoked].sort(),
      ['external-preview', 'project'],
      'host 被撤销时两种记录都得死'
    );
    // host capability 本身还在(这里撤的是 workspace 注册表),所以抛的是 WORKSPACE_NOT_FOUND。
    for (const workspaceId of [externalRef.workspaceId, project.workspaceId]) {
      assert.throws(
        () => workspaces.requireWorkspace(host.hostToken, workspaceId),
        expectOnlyPreviewError('WORKSPACE_NOT_FOUND')
      );
    }
  });
});

test('revokeProject is narrow — it leaves the external Preview alone', async () => {
  await withTempDirectory('onlypreview-revoke-project-narrow-', async (root) => {
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const externalRef = registerExternal(workspaces, host.hostToken, externalRoot(root));
    registerWorkspace(workspaces, host.hostToken, projectRootAt(root, 'project'));

    assert.equal(workspaces.revokeProject(host.hostToken), true);
    assert.equal(workspaces.restore(host.hostToken), null, '项目该没了');
    assert.equal(
      workspaces.requireWorkspace(host.hostToken, externalRef.workspaceId).workspaceId,
      externalRef.workspaceId,
      '外部预览该还在'
    );
    // 没有项目时再调一次是 false,而不是抛
    assert.equal(workspaces.revokeProject(host.hostToken), false);
  });
});
