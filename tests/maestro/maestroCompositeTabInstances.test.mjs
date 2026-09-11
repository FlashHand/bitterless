/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * Several tabs of ONE composite mini app, each with its own identity, restored onto their own state.
 *
 * The defect this pins: Zellij's session name is derived from the surface id, and the surface id is
 * the tab's `instanceId`. If two tabs shared an id — or if a restored tab were given a fresh one —
 * two terminals would silently drive the same pane tree, or a restored tab would attach to a
 * stranger's shell. See docs/features/zellij-multi-tab.md.
 */
const root = resolve(import.meta.dirname, '../..');
const mocks = {
  electron: `
    import { EventEmitter } from 'node:events';
    import { pathToFileURL } from 'node:url';
    class WebContents extends EventEmitter {
      url = '';
      destroyed = false;
      loads = [];
      navigationHistory = { canGoBack: () => false, canGoForward: () => false };
      isDestroyed() { return this.destroyed; }
      getURL() { return this.url; }
      setUserAgent() {}
      setWindowOpenHandler() {}
      async loadURL(url) { this.url = url; this.loads.push(url); this.emit('did-navigate', {}, url); }
      loadFile(path) { return this.loadURL(pathToFileURL(path).href); }
      close() { this.destroyed = true; }
    }
    export class WebContentsView {
      webContents = new WebContents();
      visible = true;
      bounds = { x: 0, y: 0, width: 0, height: 0 };
      setVisible(visible) { this.visible = visible; }
      setBounds(bounds) { this.bounds = { ...bounds }; }
      getBounds() { return { ...this.bounds }; }
      setBackgroundColor() {}
    }
    // Capture what the + menu would show instead of popping a real one.
    export const menus = [];
    export const Menu = {
      buildFromTemplate(template) {
        const built = { template, popped: null, popup(options) { built.popped = options } };
        menus.push(built);
        return built;
      }
    };
    export const clipboard = {};
  `,
  '@electron-toolkit/utils': 'export const is = { dev: false };',
  inversify: 'export const injectable = () => (target) => target; export class Container {}',
  'reflect-metadata': '',
  'electron-xpc/main': `
    export const messages = [];
    export const xpcMain = {
      broadcast(topic, payload) { messages.push({ topic, payload: structuredClone(payload) }); }
    };
    export const createXpcMainEmitter = () => ({});
  `,
  '@maestro-main/capture/debuggerCapture': `
    export class DebuggerCapture {
      attached = false;
      async setInterceptionRules() {}
      async attach() { this.attached = true; }
      isAttached() { return this.attached; }
      detach() { this.attached = false; }
    }
  `,
  '@maestro-main/capture/chromeIdentity':
    'export const chromeIdentity = () => ({ userAgent: "test" });',
  '@maestro-main/drive/replayEngine': 'export class ReplayEngine {}',
  '@maestro-main/settings/coachSettings.service': 'export const normalizeUrl = (url) => url;',
  '@maestro-main/data/maestroDataRoot': 'export const MAESTRO_PARTITION = "test:maestro";'
};

const bundled = await build({
  stdin: {
    contents: `
      export { MaestroBrowserViewService } from './src/main/maestro/windows/main/maestroBrowserView.service.ts';
      export { registerMaestroCompositeTab } from './src/main/maestro/windows/main/compositeTab.registry.ts';
      export { messages } from 'electron-xpc/main';
      export { menus } from 'electron';
    `,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json'),
  define: {
    __dirname: JSON.stringify('/test-bundle'),
    'import.meta.env.VITE_MODE': JSON.stringify('release')
  },
  plugins: [
    {
      name: 'maestro-composite-instances-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'instances-boundary' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'instances-boundary' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const { MaestroBrowserViewService, registerMaestroCompositeTab, messages, menus } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const fixture = async (context) => {
  const service = new MaestroBrowserViewService();
  const opened = [];
  const closed = [];
  const backgrounded = [];
  const state = {
    browserWindow: {
      contentView: { addChildView() {}, removeChildView() {} },
      getContentSize: () => [1360, 900]
    },
    operationView: null,
    capture: null,
    replayEngine: null,
    currentUrl: '',
    opBounds: { x: 0, y: 78, width: 1360, height: 822 },
    capturing: false,
    captureTargetTabId: null,
    tabsOpenedThisTurn: [],
    browserInterceptionRules: [],
    emitTrace: () => undefined,
    layout: () => undefined,
    newTab: async () => undefined,
    // Picking a mini-app row must send the Workbench back first — it is a foreground VIEW, not an
    // OperationTab, so a tab activated under it reads as "nothing happened".
    backgroundWorkbenchTab: async () => {
      backgrounded.push(Date.now());
    },
    switchCaptureTarget: async () => undefined
  };
  service.setState(state);
  // A mini app that can have several live tabs at once and wants them back next launch — Zellij's
  // shape. The container it attaches is per-host, which is what a second tab must not steal.
  registerMaestroCompositeTab({
    id: 'zellij',
    title: 'Zellij',
    favicon: '',
    displayUrl: 'bitterless://zellij',
    restorable: true,
    async open(host) {
      opened.push(host.instanceId);
      host.attach({ forInstance: host.instanceId });
    },
    close(host) {
      closed.push(host.instanceId);
    },
    setActive() {},
    refresh() {}
  });
  // ...and one that cannot, to prove the reuse is the SPEC's declaration, not a blanket rule.
  registerMaestroCompositeTab({
    id: 'onlypreview',
    title: 'OnlyPreview',
    favicon: '',
    displayUrl: 'bitterless://only-preview',
    singleton: true,
    async open(host) {
      opened.push(`onlypreview:${host.instanceId}`);
      host.attach({});
    },
    close() {},
    setActive() {},
    refresh() {}
  });
  service.createPinnedHomeTab();
  await service.loadPinnedHomeTab();
  context.after(() => service.reset());
  return { service, state, opened, closed, backgrounded };
};

const latestStrip = () =>
  messages.filter((m) => m.topic === 'coach/tabs').at(-1)?.payload ?? [];

test('a non-singleton mini app opens N tabs, each with its own identity', async (context) => {
  const f = await fixture(context);
  const first = await f.service.openCompositeTab({ id: 'zellij' });
  const second = await f.service.openCompositeTab({ id: 'zellij' });

  assert.notEqual(first.id, second.id, 'the second call must not return the first tab');
  assert.notEqual(first.instanceId, second.instanceId);
  // This is what a Zellij session name is derived from, capped at 48 chars behind a 22-char prefix
  // — a longer id would be truncated and could fold two terminals onto one session.
  for (const tab of [first, second]) assert.match(tab.instanceId, /^[0-9a-f]{12}$/);
  assert.deepEqual(f.opened, [first.instanceId, second.instanceId]);
  assert.equal(f.service.tabs.filter((t) => t.kind === 'zellij').length, 2);

  // A singleton spec still reuses its one tab — the opt-in is what differs, not the machinery.
  const preview = await f.service.openCompositeTab({ id: 'onlypreview' });
  assert.equal(await f.service.openCompositeTab({ id: 'onlypreview' }), preview);
});

test('reopening a KNOWN instance reuses its tab, so restore cannot double a session', async (context) => {
  const f = await fixture(context);
  const tab = await f.service.openCompositeTab({ id: 'zellij' });
  const again = await f.service.openCompositeTab({ id: 'zellij', instanceId: tab.instanceId })
  assert.equal(again, tab, 'the same instance is the same tab, singleton or not');
  assert.equal(f.opened.length, 1, 'the mini app was mounted exactly once');
});

test('a restored tab is rebuilt on its STORED instance id, and stays cold', async (context) => {
  const f = await fixture(context);
  messages.length = 0;
  await f.service.restoreTabs({
    tabs: [
      { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0001' },
      { url: '', title: 'Zellij', favicon: '', position: 1, kind: 'zellij', instanceId: 'deadbeef0002' },
      { url: 'https://example.invalid/docs', title: 'Docs', favicon: '', position: 2 }
    ]
  });
  // Verbatim: a fresh id would attach the restored tab to a stranger's shell, which is worse than
  // not restoring it at all.
  assert.deepEqual(f.opened, ['deadbeef0001', 'deadbeef0002']);
  const restored = f.service.tabs.filter((t) => t.kind === 'zellij');
  assert.deepEqual(
    restored.map((t) => t.instanceId),
    ['deadbeef0001', 'deadbeef0002']
  );
  assert.equal(f.service.tabs.filter((t) => t.kind === 'browser').length, 1, 'URL rows still restore')
  // Cold: the pinned Home tab keeps focus until the renderer's last-active restore runs.
  assert.equal(f.service.getActiveTab().kind, 'home');
  // The renderer persists from the broadcast strip, so both fields have to be on the wire.
  const zellijInfo = latestStrip().filter((t) => t.kind === 'zellij');
  assert.deepEqual(
    zellijInfo.map((t) => [t.instanceId, t.restorable]),
    [
      ['deadbeef0001', true],
      ['deadbeef0002', true]
    ]
  );
});

test('a mini app that refuses to open drops only its own row', async (context) => {
  const f = await fixture(context);
  // Zellij legitimately rejects while the Terminal switch is off; the rest of the strip must live.
  registerMaestroCompositeTab({
    id: 'zellij',
    title: 'Zellij',
    favicon: '',
    displayUrl: 'bitterless://zellij',
    restorable: true,
    open: async () => {
      throw new Error('terminal is disabled');
    },
    close() {},
    setActive() {},
    refresh() {}
  });
  await f.service.restoreTabs({
    tabs: [
      { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0003' },
      { url: 'https://example.invalid/docs', title: 'Docs', favicon: '', position: 1 }
    ]
  });
  assert.equal(f.service.tabs.filter((t) => t.kind === 'zellij').length, 0);
  assert.equal(f.service.tabs.filter((t) => t.kind === 'browser').length, 1, 'the rest of the strip survives');
});

test('the + menu lists every registered mini app, from the registry', async (context) => {
  const f = await fixture(context);
  menus.length = 0;
  await f.service.showNewTabMenu({ x: 120.4, y: 64.6 });
  const menu = menus.at(-1);
  assert.ok(menu, 'a native menu is built in main — an in-renderer one would be painted behind the view');
  assert.deepEqual(
    menu.template.map((item) => item.label ?? item.type),
    ['New tab', 'separator', 'Zellij', 'OnlyPreview']
  );
  assert.deepEqual(menu.popped, { window: f.state.browserWindow, x: 120, y: 65 });

  // Picking a mini-app row opens one — and picking it twice opens a second, which is the whole
  // reason the menu exists (Ral 2026-09-11:「好让我打开多个 zellij tab」).
  await menu.template.find((item) => item.label === 'Zellij').click()
  await menu.template.find((item) => item.label === 'Zellij').click()
  assert.equal(f.service.tabs.filter((t) => t.kind === 'zellij').length, 2);
  assert.equal(f.backgrounded.length, 2, 'each pick sends the Workbench back before opening');
});
