import assert from 'node:assert/strict';
import test from 'node:test';
import { CoinWindowManager } from '../../../src/main/coin/coinWindow.manager';
import { CoinWindowLifecycle } from '../../../src/main/coin/coinWindow.lifecycle';
import type { MaestroCompositeTabHostApi } from '../../../src/shared/maestro/compositeTab.api';
import { BaseWindow, View, WebContentsView, runtime } from '../fixtures/trenchHostElectron';

const createHost = (manager: CoinWindowManager) => {
  const window = new BaseWindow();
  const container = window.contentView;
  let open = true;
  let active = false;
  const host = {
    window: () => window,
    contentRect: () => ({ x: 220.4, y: 80.2, width: 801.2, height: 501.7 }),
    attach: (view: View) => container.addChildView(view),
    detach: (view: View) => container.removeChildView(view),
    activate: () => {
      active = true;
    },
    close: () => {
      open = false;
      manager.closeTab(api);
    },
    isOpen: () => open,
    setTitle: () => undefined
  };
  const api = host as unknown as MaestroCompositeTabHostApi;
  return {
    api,
    window,
    container,
    get active() {
      return active;
    },
    close: host.close
  };
};

test('one WebContents moves window -> tab -> window without reloading or affecting Omni', async () => {
  const manager = new CoinWindowManager();
  const omniA = new WebContentsView({ mode: 'omni' });
  const omniB = new WebContentsView({ mode: 'omni' });
  const before = runtime.views.length;
  const surface = await manager.create(new AbortController().signal);
  manager.showAndFocus(surface);
  const oldWindow = runtime.windows.at(-1)!;
  const host = createHost(manager);
  manager.mountTab(surface, host.api);
  assert.equal(oldWindow.isDestroyed(), true);
  assert.equal(manager.hostKind, 'tab');
  assert.equal(host.container.children.size, 1);
  assert.equal(surface.isDestroyed(), false);
  manager.showAndFocus(surface);
  assert.equal(host.active, true);
  assert.deepEqual((surface.view as unknown as View).bounds, {
    x: 220,
    y: 80,
    width: 801,
    height: 502
  });
  manager.setTabActive(host.api, false);
  assert.equal((surface.view as unknown as View).visible, false);
  manager.setTabActive(host.api, true);
  assert.equal((surface.view as unknown as View).visible, true);

  manager.mountStandalone(surface);
  manager.showAndFocus(surface);
  assert.equal(manager.hostKind, 'standalone');
  assert.equal(host.api.isOpen(), false);
  host.close();
  assert.equal(surface.isDestroyed(), false, 'late tab close cannot destroy the new host');
  assert.equal(runtime.views.length, before + 1);
  assert.equal((surface.view as unknown as WebContentsView).webContents.loads, 1);
  const window = runtime.windows.at(-1)!;
  window.width = 1200;
  window.height = 800;
  window.emit('resize');
  assert.deepEqual((surface.view as unknown as View).bounds, {
    x: 0,
    y: 0,
    width: 1200,
    height: 800
  });
  window.destroy();
  assert.equal(surface.isDestroyed(), true);
  assert.equal(manager.surface, null);
  assert.equal(omniA.webContents.isDestroyed(), false);
  assert.equal(omniB.webContents.isDestroyed(), false);
  omniA.webContents.close();
  omniB.webContents.close();
});

test('closing a tab destroys its renderer but never the Maestro window', async () => {
  const manager = new CoinWindowManager();
  const surface = await manager.create(new AbortController().signal);
  const host = createHost(manager);
  manager.mountTab(surface, host.api);
  let prevented = false;
  surface.webContents.emit(
    'before-input-event',
    {
      preventDefault: () => {
        prevented = true;
      }
    },
    {
      type: 'keyDown',
      key: 'w',
      meta: true,
      control: true,
      alt: false,
      shift: false
    }
  );
  assert.equal(prevented, true);
  assert.equal(surface.isDestroyed(), true);
  assert.equal(host.window.isDestroyed(), false);
  assert.equal(manager.surface, null);
});

test('failed or already-closed target preserves the original renderer and host', async () => {
  const manager = new CoinWindowManager();
  const surface = await manager.create(new AbortController().signal);
  manager.showAndFocus(surface);
  const sourceWindow = runtime.windows.at(-1)!;
  const failed = createHost(manager);
  failed.container.failAttach = true;
  assert.throws(() => manager.mountTab(surface, failed.api), /attach failed/);
  assert.equal(sourceWindow.contentView.children.has(surface.view as unknown as View), true);
  assert.equal(sourceWindow.isDestroyed(), false);
  failed.close();
  assert.throws(() => manager.mountTab(surface, failed.api), /no longer available/);
  assert.equal(manager.hostKind, 'standalone');
  await manager.destroy(surface);
});

test('concurrent ensure calls create only one unattached renderer; logout cancels loading', async () => {
  const manager = new CoinWindowManager();
  const lifecycle = new CoinWindowLifecycle({
    getCurrent: () => manager.surface,
    isDestroyed: (surface) => surface.isDestroyed(),
    create: (signal) => manager.create(signal),
    showAndFocus: (surface) => manager.showAndFocus(surface),
    destroy: (surface) => manager.destroy(surface)
  });
  await lifecycle.prepareForAuthenticatedSession();
  runtime.loadGate = new Promise(() => undefined);
  const before = runtime.views.length;
  const first = lifecycle.ensure();
  const second = lifecycle.ensure();
  await Promise.resolve();
  assert.equal(runtime.views.length, before + 1);
  assert.equal(manager.hasHost, false);
  const failures = Promise.all([
    assert.rejects(first, /aborted/),
    assert.rejects(second, /aborted/)
  ]);
  await lifecycle.destroyForAuth();
  await failures;
  runtime.loadGate = null;
  assert.equal(manager.surface, null);
  await assert.rejects(lifecycle.ensure(), /not authenticated/);
});

test('managed display keeps sandbox, popup and navigation restrictions', async () => {
  const manager = new CoinWindowManager();
  const surface = await manager.create(new AbortController().signal);
  const view = surface.view as unknown as WebContentsView;
  const options = view.options as { webPreferences: Record<string, unknown> };
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.webviewTag, false);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.deepEqual(view.webContents.openHandler?.(), { action: 'deny' });
  let prevented = false;
  surface.webContents.emit(
    'will-navigate',
    {
      preventDefault: () => {
        prevented = true;
      }
    },
    'https://x.com'
  );
  assert.equal(prevented, true);
  await manager.destroy(surface);
});
