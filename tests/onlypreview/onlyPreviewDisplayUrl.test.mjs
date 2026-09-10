/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import {
  createRegistries,
  registerWorkspace,
  source,
  withTempDirectory,
  write
} from './onlyPreviewCoreTest.helper.mjs';

/**
 * 地址栏显示当前预览目标的 `file://`
 * (Ral 2026-09-10:「我只是希望 url 上显示 file:// …只要看起来像真实浏览器就好」,
 * `docs/features/onlypreview-address-bar-shows-file-url.md`)。
 *
 * 算 URL 那一半**真跑注册表**;把它推到地址栏那一半是源码守卫 —— 那条链要 Electron
 * (composite tab、BaseWindow),而钉住接线正好对应真实的失败模式:环都在,优先级或分支挂错一个,
 * 地址栏就静默停在上一个值。
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const projectAt = (root, name) => {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  write(join(directory, 'notes.md'), '# notes');
  mkdirSync(join(directory, 'sub'), { recursive: true });
  write(join(directory, 'sub', 'deep file.md'), 'x');
  return realpathSync(directory);
};

const outsideAt = (root) => {
  const directory = join(root, 'PIL 2');
  mkdirSync(directory, { recursive: true });
  write(join(directory, '2.csv'), 'a,b');
  return realpathSync(directory);
};

describe('describeDisplayUrl：当前预览目标 → 地址栏那一行', () => {
  test('没有任何工作区 → 空串（调用方据此退回静态兜底）', async () => {
    await withTempDirectory('onlypreview-display-url-empty-', async () => {
      const { hosts, workspaces } = createRegistries();
      const host = hosts.issue('standalone', 'content');
      assert.equal(workspaces.describeDisplayUrl(host.hostToken), '');
    });
  });

  test('只有项目、没有选中文件 → 目录本身的 file://', async () => {
    await withTempDirectory('onlypreview-display-url-directory-', async (root) => {
      const { hosts, workspaces } = createRegistries();
      const host = hosts.issue('standalone', 'content');
      const projectRoot = projectAt(root, 'project');
      registerWorkspace(workspaces, host.hostToken, projectRoot);
      const shown = workspaces.describeDisplayUrl(host.hostToken);
      // 真实浏览器对目录也是显示目录的 file://。用 node 自己的实现当参照 —— 不拿被测函数
      // (`toLocalFileUrl`)去验证被测函数,那样两边一起错也测不出来。
      assert.equal(shown, pathToFileURL(projectRoot).href.replace(/\/$/, ''), shown);
      assert.ok(shown.endsWith('/project'), shown);
    });
  });

  test('项目里选了一个文件 → 那个文件的 file://（带空格的段要编码）', async () => {
    await withTempDirectory('onlypreview-display-url-file-', async (root) => {
      const { hosts, workspaces } = createRegistries();
      const host = hosts.issue('standalone', 'content');
      const projectRoot = projectAt(root, 'project');
      const project = registerWorkspace(workspaces, host.hostToken, projectRoot);
      workspaces.select(host.hostToken, {
        workspaceId: project.workspaceId,
        relativePath: 'sub/deep file.md'
      });
      const shown = workspaces.describeDisplayUrl(host.hostToken);
      assert.ok(shown.startsWith('file:///'), shown);
      assert.ok(shown.endsWith('/sub/deep%20file.md'), shown);
    });
  });

  test('外部预览活着时**优先** —— 它才是此刻屏幕上那个文件', async () => {
    await withTempDirectory('onlypreview-display-url-external-', async (root) => {
      const { hosts, workspaces } = createRegistries();
      const host = hosts.issue('standalone', 'content');
      const projectRoot = projectAt(root, 'project');
      const project = registerWorkspace(workspaces, host.hostToken, projectRoot);
      workspaces.select(host.hostToken, {
        workspaceId: project.workspaceId,
        relativePath: 'notes.md'
      });
      const outside = outsideAt(root);
      workspaces.registerExternalPreview(host.hostToken, {
        rootRealPath: outside,
        rootName: 'PIL 2',
        displayPath: outside,
        selectedRelativePath: '2.csv'
      });
      const shown = workspaces.describeDisplayUrl(host.hostToken);
      assert.ok(shown.endsWith('/PIL%202/2.csv'), shown);
      assert.ok(
        !shown.endsWith('notes.md'),
        '项目那一条的 selectedRelativePath 是上一次树里选中的,不该盖过外部预览'
      );
    });
  });

  test('外部预览被撤销后回落到项目那一条', async () => {
    await withTempDirectory('onlypreview-display-url-fallback-', async (root) => {
      const { hosts, workspaces } = createRegistries();
      const host = hosts.issue('standalone', 'content');
      const projectRoot = projectAt(root, 'project');
      const project = registerWorkspace(workspaces, host.hostToken, projectRoot);
      workspaces.select(host.hostToken, {
        workspaceId: project.workspaceId,
        relativePath: 'notes.md'
      });
      const outside = outsideAt(root);
      workspaces.registerExternalPreview(host.hostToken, {
        rootRealPath: outside,
        rootName: 'PIL 2',
        displayPath: outside,
        selectedRelativePath: '2.csv'
      });
      workspaces.revokeExternalPreview(host.hostToken);
      assert.ok(workspaces.describeDisplayUrl(host.hostToken).endsWith('/notes.md'));
    });
  });
});

describe('推送链的接线', () => {
  test('预览区在每次 publishPresentation 上通知那一格', () => {
    const region = stripComments(
      source('src/main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service.ts')
    );
    const publish = region.slice(region.indexOf('private publishPresentation(): void {'));
    const body = publish.slice(0, publish.indexOf('\n  }'));
    assert.match(
      body,
      /notifyOnlyPreviewDisplayUrl\(this\.runtime\.host\.hostToken\)/,
      '这里是每一种「预览变了」的汇合点 —— 逐个调用方各推一次必然漏掉某一条'
    );
  });

  test('那一格吞掉异常 —— 地址栏是装饰性的，不该让一次预览失败', () => {
    const registry = source('src/main/miniapps/onlypreview/onlyPreviewDisplayUrl.registry.ts');
    assert.match(registry, /try \{\s*sink\(hostToken\);\s*\} catch \{/);
  });

  test('宿主把那一格接到注册表与 helper 上', () => {
    const opener = stripComments(source('src/main/windows/onlyPreviewMaestroOpener.ts'));
    assert.match(
      opener,
      /registerOnlyPreviewDisplayUrlSink\(\(hostToken\) => \{[\s\S]{0,220}reportDisplayUrl\([\s\S]{0,120}describeDisplayUrl\(hostToken\)/
    );
  });

  test('helper 只对当前那个 host 生效 —— 过期的 hostToken 丢掉', () => {
    const helper = stripComments(source('src/main/windows/onlyPreviewWindow.helper.ts'));
    const method = helper.slice(helper.indexOf('reportDisplayUrl(hostToken: string, url: string)'));
    const body = method.slice(0, method.indexOf('\n  }'));
    assert.match(body, /this\.standaloneHost\?\.hostToken !== hostToken\) return/);
    assert.match(body, /!this\.standaloneMount\?\.isAlive\(\)\) return/);
  });

  test('独立窗口那一种是**有解释的空操作** —— 它没有地址栏', () => {
    const mount = source('src/main/windows/onlyPreviewStandaloneMount.ts');
    assert.match(mount, /reportDisplayUrl\(\): void \{/);
    const method = mount.slice(mount.indexOf('reportDisplayUrl(): void {'));
    const body = method.slice(0, method.indexOf('\n  }'));
    assert.ok(!/setTitle|deps\.|this\.baseWindow/.test(body), '不该真去推什么');
    assert.match(body, /故意空操作/, '空实现必须带理由，否则读起来像漏了一段');
  });

  test('Cowork tab 那一种转给 deps.setDisplayUrl', () => {
    const mount = stripComments(source('src/main/windows/onlyPreviewCoworkMount.ts'));
    assert.match(mount, /reportDisplayUrl\(url: string\): void \{\s*this\.deps\.setDisplayUrl\(url\);\s*\}/);
  });
});

describe('maestro 侧：live 值优先，静态串兜底', () => {
  const view = stripComments(
    source('src/main/maestro/windows/main/maestroBrowserView.service.ts')
  );

  test('displayUrl 先读 live 值', () => {
    const method = view.slice(view.indexOf('private displayUrl(tab: OperationTab): string {'));
    const body = method.slice(0, method.indexOf('\n  }'));
    const live = body.indexOf('tab.compositeDisplayUrl');
    const staticUrl = body.indexOf('compositeTabs.get(tab.id)?.displayUrl');
    assert.ok(live > -1, '少了 live 值 = 地址栏永远是那个静态串');
    assert.ok(staticUrl > -1, '静态串不该消失 —— 没有项目/没有选中文件时靠它兜底');
    assert.ok(live < staticUrl, '次序反过来 live 值永远到不了地址栏');
  });

  test('setDisplayUrl 只在这个 tab 是活动 tab 时推地址栏', () => {
    const method = view.slice(view.indexOf('setDisplayUrl: (url) => {'));
    const body = method.slice(0, method.indexOf('\n        }'));
    assert.match(
      body,
      /if \(this\.activeTabId === tab\.id\) this\.sendTabNav\(tab\)/,
      '后台 tab 改地址会把前台那一行覆盖掉'
    );
    assert.match(body, /this\.broadcastTabs\(\)/, 'tab 条上也显示这个串');
    assert.match(body, /if \(tab\.compositeDisplayUrl === next\) return/, '同值不该触发广播');
  });
});
