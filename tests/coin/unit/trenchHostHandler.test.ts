import assert from 'node:assert/strict';
import test from 'node:test';
import { coinWindowHandler as handler } from '../../../src/main/xpc/coinWindow.handler';
import { coinWindowManager as manager } from '../../../src/main/coin/coinWindow.manager';
import { registerTrenchCoworkTab } from '../../../src/main/windows/trenchCoworkTab';
import { maestroRuntime, maestroWindowHelper } from '../fixtures/trenchHostMaestro';
import { runtime } from '../fixtures/trenchHostElectron';

registerTrenchCoworkTab();

test('launches reuse one ordinary renderer; coalesced toggle preserves it and rejects foreign tokens', async () => {
  await assert.rejects(handler.openCoinTab(), /not authenticated/);
  await handler.prepareForAuthenticatedSession();
  const before = runtime.views.length;
  await Promise.all([handler.openCoinWindow(), handler.openCoinWindow(), handler.openCoinTab()]);
  const surface = manager.surface!;
  assert.equal(runtime.views.length, before + 1);
  assert.equal(manager.hostKind, 'tab');
  assert.equal((await maestroWindowHelper.getTabs()).length, 1);
  const input = { token: surface.token };
  await assert.rejects(handler.toggleHost({ token: 'omni-or-stale' }), /Invalid or expired/);
  await Promise.all([handler.toggleHost(input), handler.toggleHost(input)]);
  assert.equal(manager.hostKind, 'standalone');
  assert.equal((await maestroWindowHelper.getTabs()).length, 0);
  assert.equal(manager.surface, surface);
  assert.equal((await handler.getHostState(input)).pending, false);
  await Promise.all([handler.openCoinTab(), handler.openCoinTab()]);
  await handler.openCoinWindow();
  assert.equal(manager.hostKind, 'tab', 'ordinary Open focuses the current host');
  await handler._destroyForAuth();
  assert.equal(manager.surface, null);
  assert.equal((await maestroWindowHelper.getTabs()).length, 0);
});

test('missing dock window leaves standalone untouched; a later dock can succeed', async () => {
  await handler.prepareForAuthenticatedSession();
  await handler.openCoinWindow();
  const surface = manager.surface!;
  const window = maestroWindowHelper.browserWindow;
  maestroWindowHelper.browserWindow = null;
  assert.equal((await handler.getHostState({ token: surface.token })).canDock, false);
  await assert.rejects(handler.toggleHost({ token: surface.token }), /Open Maestro/);
  assert.equal(manager.surface, surface);
  assert.equal(surface.isDestroyed(), false);
  maestroWindowHelper.browserWindow = window;
  await handler.toggleHost({ token: surface.token });
  assert.equal(manager.hostKind, 'tab');
  await handler._destroyForAuth();
});

test('logout while waiting for Maestro prevents late renderer creation', async () => {
  await handler.prepareForAuthenticatedSession();
  let ready!: () => void;
  maestroRuntime.ready = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const before = runtime.views.length;
  const opening = handler.openCoinTab();
  await Promise.resolve();
  await Promise.resolve();
  await handler._destroyForAuth();
  const rejected = assert.rejects(opening, /not authenticated/);
  ready();
  await rejected;
  maestroRuntime.ready = null;
  assert.equal(runtime.views.length, before);
  assert.equal(manager.surface, null);
});

test('a late tab request from a previous login cannot move the next session surface', async () => {
  await handler.prepareForAuthenticatedSession();
  let ready!: () => void;
  maestroRuntime.ready = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const opening = handler.openCoinTab();
  await Promise.resolve();
  await Promise.resolve();
  await handler._destroyForAuth();
  await handler.prepareForAuthenticatedSession();
  await handler.openCoinWindow();
  const current = manager.surface;
  const rejected = assert.rejects(opening, /Session changed/);
  ready();
  await rejected;
  maestroRuntime.ready = null;
  assert.equal(manager.surface, current);
  assert.equal(manager.hostKind, 'standalone');
  await handler._destroyForAuth();
});
