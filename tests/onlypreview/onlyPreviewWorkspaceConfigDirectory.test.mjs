import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import {
  WORKSPACE_CONFIG_DIRECTORIES,
  WORKSPACE_CONFIG_RELATIVE_PATH,
  isWorkspaceConfigWatchPath,
  loadOnlyPreviewWorkspaceConfig,
  readOnlyPreviewWorkspaceConfigSignature
} from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

/**
 * 预览配置目录的**候选列表**。
 *
 * `WORKSPACE_CONFIG_DIRECTORIES` 是本仓与 micromeet-cowork 之间唯一的差异(其余代码逐字节相同):
 * 本仓 `['.bitterless']`,那边 `['.micromeet', '.bitterless']`(Ral 2026-09-10:
 * 「cowork 的 OnlyPreview 应该叫做 .micromeet」)。回落是**只读**的,为的是不丢已有的 per-project
 * 配置 —— 那些文件是人手建在自己项目目录里的**数据**。
 *
 * 这些用例跑真实文件系统:候选解析的每一条分支(第一个存在、第一个不存在回落、都不存在、
 * 同名但不是目录)都有可见后果,而它们只有真 lstat 才分得开。
 */
const roots = [];
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'onlypreview-config-dir-'));
  roots.push(root);
  return root;
};
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const writeConfig = (root, directory, body = 'version: 1\nexclude:\n  - "vendor/**"\n') => {
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, 'preview-config.yml'), body);
};

describe('候选目录的形状', () => {
  test('至少一个候选，第一个是主名字，且都以点开头', () => {
    assert.ok(WORKSPACE_CONFIG_DIRECTORIES.length >= 1);
    for (const directory of WORKSPACE_CONFIG_DIRECTORIES) {
      assert.match(directory, /^\.[a-z][a-z0-9-]*$/, directory);
    }
    assert.equal(
      WORKSPACE_CONFIG_RELATIVE_PATH,
      `${WORKSPACE_CONFIG_DIRECTORIES[0]}/preview-config.yml`,
      '对外那一个相对路径必须指向主名字 —— 否则调用方看到的和实际读的不是同一个目录'
    );
  });

  test('本仓的主名字是 .bitterless', () => {
    // 这一条钉的是「re-vendor 没把 cowork 的值带过来」——
    // 两仓那一行是唯一的差异,而一次整体覆盖不会有任何别的信号。
    assert.equal(WORKSPACE_CONFIG_DIRECTORIES[0], '.bitterless');
  });
});

describe('监听路径认全部候选', () => {
  test('每个候选的目录本身与它下面那个文件都算', () => {
    for (const directory of WORKSPACE_CONFIG_DIRECTORIES) {
      assert.ok(isWorkspaceConfigWatchPath(directory), directory);
      assert.ok(isWorkspaceConfigWatchPath(`${directory}/preview-config.yml`), directory);
    }
  });

  test('不相干的路径不算', () => {
    for (const path of ['', 'src', '.git', '.bitterlessx', 'preview-config.yml', '.bitterless/other.yml']) {
      assert.equal(isWorkspaceConfigWatchPath(path), false, path);
    }
  });
});

describe('加载：候选解析的每一条分支', () => {
  test('主名字存在 → 读它', async () => {
    const root = makeRoot();
    writeConfig(root, WORKSPACE_CONFIG_DIRECTORIES[0]);
    const config = await loadOnlyPreviewWorkspaceConfig(root);
    assert.ok(
      JSON.stringify(config).includes('vendor'),
      '读到的应该是我们写进去那份（含 vendor 规则）'
    );
  });

  test('一个候选都没有 → 默认配置，不抛', async () => {
    const root = makeRoot();
    const config = await loadOnlyPreviewWorkspaceConfig(root);
    const empty = await loadOnlyPreviewWorkspaceConfig(makeRoot());
    assert.deepEqual(config, empty, '没配过的项目应该拿到和空项目一样的默认配置');
  });

  test('同名但是个普通文件 → 抛，而不是跳过它去读回落', async () => {
    const root = makeRoot();
    writeFileSync(join(root, WORKSPACE_CONFIG_DIRECTORIES[0]), 'not a directory');
    await assert.rejects(
      () => loadOnlyPreviewWorkspaceConfig(root),
      /symbolic link|directory/i,
      '跳过它会把「你那个目录是个文件」悄悄变成「读了另一个目录」'
    );
  });
});

describe('签名', () => {
  test('目录名并进签名 —— 换了源就要算一次变化', async () => {
    const root = makeRoot();
    writeConfig(root, WORKSPACE_CONFIG_DIRECTORIES[0]);
    const signature = await readOnlyPreviewWorkspaceConfigSignature(root);
    assert.ok(
      signature.startsWith(`${WORKSPACE_CONFIG_DIRECTORIES[0]}:`),
      `签名要带目录名，实际: ${signature}`
    );
  });

  test('没有配置目录时是一个稳定的 unavailable，而不是抛', async () => {
    const signature = await readOnlyPreviewWorkspaceConfigSignature(makeRoot());
    assert.match(signature, /^unavailable:/);
  });

  test('文件内容变了签名就变', async () => {
    const root = makeRoot();
    writeConfig(root, WORKSPACE_CONFIG_DIRECTORIES[0], 'version: 1\nexclude: []\n');
    const before = await readOnlyPreviewWorkspaceConfigSignature(root);
    writeConfig(root, WORKSPACE_CONFIG_DIRECTORIES[0], 'version: 1\nexclude:\n  - "a/**"\n');
    const after_ = await readOnlyPreviewWorkspaceConfigSignature(root);
    assert.notEqual(before, after_);
  });
});
