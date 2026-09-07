/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';

const root = resolve(import.meta.dirname, '../..');
const source = (path) => readFileSync(resolve(root, path), 'utf8');
const subscriptions = new Map();
const stateCalls = [];
const toggleCalls = [];
const env = {
  hostId: 'host-toggle-ui',
  hostToken: 'host-token-toggle-ui-000000',
  host: 'cowork',
  platform: 'darwin'
};
let stateResponse;
let toggleResponse;
const ok = (value) => ({ ok: true, value });
const runtime = {
  async getHostToggleState(request) {
    stateCalls.push(request);
    return await stateResponse(request);
  },
  async toggleHost(request) {
    toggleCalls.push(request);
    return await toggleResponse(request);
  },
  reportGlobalSearchContext: async () => ok(undefined),
  getSettings: async () => ok({}),
  restoreWorkspace: async () => ok(null),
  getPreviewPresentation: async () =>
    ok({
      hostId: env.hostId,
      selectionRevision: 0,
      surface: 'none',
      fileRef: null,
      selectedTextAvailable: false
    }),
  getPreviewFindSnapshot: async () =>
    ok({
      open: false,
      state: { hostId: env.hostId },
      query: '',
      caseSensitive: false
    })
};

const previousWindow = globalThis.window;
globalThis.window = { onlyPreviewEnv: env, innerWidth: 1280 };
globalThis.__onlyPreviewHostToggleTestRuntime = runtime;
globalThis.__onlyPreviewHostToggleTestSubscriptions = subscriptions;
after(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  delete globalThis.__onlyPreviewHostToggleTestRuntime;
  delete globalThis.__onlyPreviewHostToggleTestSubscriptions;
});

const bundled = await build({
  stdin: {
    contents: `
      export { OnlyPreviewShellStore } from './src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts';
      export { onlyPreviewI18n } from './src/renderer/onlypreview/common/onlyPreviewI18n.ts';
      export { computed, reactive } from 'vue';
    `,
    resolveDir: root
  },
  write: false,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'onlypreview-host-toggle-xpc',
      setup(context) {
        context.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'renderer',
          namespace: 'host-toggle-ui'
        }));
        context.onLoad({ filter: /.*/, namespace: 'host-toggle-ui' }, () => ({
          contents: `
          export const createXpcRendererEmitter = () => globalThis.__onlyPreviewHostToggleTestRuntime;
          export const xpcRenderer = {
            subscribe(name, listener) {
              globalThis.__onlyPreviewHostToggleTestSubscriptions.set(name, listener);
            }
          };
        `
        }));
      }
    }
  ]
});
const { OnlyPreviewShellStore, onlyPreviewI18n, computed, reactive } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const createStore = (host = 'cowork') => {
  env.host = host;
  stateCalls.length = 0;
  toggleCalls.length = 0;
  subscriptions.clear();
  stateResponse = async () => ok({ canDock: true, pending: false });
  toggleResponse = async () => ok(undefined);
  return reactive(
    new OnlyPreviewShellStore({
      nextTag: () => 'host-toggle-test',
      now: () => 0,
      elapsed: () => 0,
      emit: () => true
    })
  );
};
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
};
const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

test('initialization fetches host capability and a matching completion event unlocks a new host', async () => {
  const store = createStore('window');
  assert.equal(store.hostToggle.state.canDock, false);
  assert.equal(store.hostToggle.disabled, true);
  stateResponse = async () => ok({ canDock: true, pending: true });
  await store.initialize();
  assert.equal(stateCalls.length, 1);
  assert.deepEqual(stateCalls[0], { hostToken: env.hostToken });
  assert.equal(store.hostToggle.disabled, true);
  const changed = subscriptions.get('onlypreview:host-toggle-changed');
  assert.equal(typeof changed, 'function');
  stateResponse = async () => ok({ canDock: true, pending: false });
  changed({ params: { hostId: 'another-host' } });
  changed({ params: null });
  await tick();
  assert.equal(stateCalls.length, 1);
  changed({ params: { hostId: env.hostId } });
  await tick();
  assert.equal(stateCalls.length, 2);
  assert.equal(store.hostToggle.disabled, false);
});

test('window docking is disabled without a browser, while a tab can still detach', async () => {
  for (const host of ['window', 'unrecognized']) {
    const store = createStore(host);
    stateResponse = async () => ok({ canDock: false, pending: false });
    await store.refreshHostToggleState();
    await store.hostToggle.toggle(store);
    assert.equal(store.hostToggle.disabled, true);
    assert.equal(toggleCalls.length, 0);
  }
  const tab = createStore('cowork');
  assert.equal(tab.hostToggle.disabled, false);
  await tab.hostToggle.toggle(tab);
  assert.deepEqual(toggleCalls, [{ hostToken: env.hostToken }]);
});

test('a local in-flight toggle stays disabled through refreshes and rejects double clicks', async () => {
  const store = createStore();
  const disabled = computed(() => store.hostToggle.disabled);
  assert.equal(disabled.value, false);
  const relocation = deferred();
  toggleResponse = () => relocation.promise;
  const first = store.hostToggle.toggle(store);
  assert.equal(disabled.value, true, 'the nested store invalidates the rendered disabled state');
  assert.equal(store.hostToggle.disabled, true, 'the first click synchronously locks the button');
  await store.refreshHostToggleState();
  assert.equal(
    store.hostToggle.disabled,
    true,
    'an availability response cannot release a local call'
  );
  await store.hostToggle.toggle(store);
  assert.equal(toggleCalls.length, 1);
  relocation.resolve(ok(undefined));
  await first;
  assert.equal(store.hostToggle.disabled, false);
  assert.equal(disabled.value, false);
});

test('a newer state refresh wins over an older delayed capability response', async () => {
  const store = createStore('window');
  const older = deferred();
  stateResponse = () => older.promise;
  const oldRefresh = store.refreshHostToggleState();
  stateResponse = async () => ok({ canDock: false, pending: false });
  await store.refreshHostToggleState();
  older.resolve(ok({ canDock: true, pending: true }));
  await oldRefresh;
  assert.deepEqual(store.hostToggle.state, { canDock: false, pending: false });
  assert.equal(store.hostToggle.disabled, true);
});

test('transition and state failures use the existing error banner and permit retry', async () => {
  const store = createStore();
  const errorBanner = computed(() => store.errorMessage);
  assert.equal(errorBanner.value, '');
  toggleResponse = async () => ({
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'Destination creation failed' }
  });
  await store.hostToggle.toggle(store);
  assert.equal(store.errorMessage, onlyPreviewI18n.errors.OPERATION_FAILED);
  assert.equal(errorBanner.value, onlyPreviewI18n.errors.OPERATION_FAILED);
  assert.equal(store.hostToggle.disabled, false);
  store.dismissError();
  stateResponse = async () =>
    ok({
      canDock: true,
      pending: false,
      error: { code: 'HOST_NOT_FOUND', message: 'The destination is no longer available' }
    });
  await store.refreshHostToggleState();
  assert.equal(store.errorMessage, onlyPreviewI18n.errors.HOST_NOT_FOUND);
  stateResponse = async () => {
    throw new Error('State request failed');
  };
  await store.refreshHostToggleState();
  assert.equal(store.errorMessage, onlyPreviewI18n.errors.OPERATION_FAILED);
  assert.deepEqual(store.hostToggle.state, { canDock: false, pending: false });
});

test('compiled button follows the host, sits right of Settings and invokes the store with its receiver', async () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const button = app.match(/<a-button\s+name="onlypreview__host-toggle"[\s\S]*?<\/a-button>/);
  const label = app.match(/const hostToggleLabel = computed\(\(\) => \{[\s\S]*?\n\}\);/);
  assert.ok(button);
  assert.ok(label);
  assert.ok(app.indexOf('name="onlypreview__settings"') < button.index);
  assert.ok(button.index < app.indexOf('<template v-if="isWindows && ownsWindow">'));
  const render = new Function('Vue', compile(button[0], { mode: 'function' }).code)({
    ...Vue,
    resolveComponent: (name) => ({ name })
  });
  const makeLabel = new Function(
    'computed',
    'ownsWindow',
    'onlyPreviewShellStore',
    'onlyPreviewI18n',
    `${label[0]} return hostToggleLabel;`
  );
  for (const [host, canDock, expectedIcon, expectedLabel] of [
    ['cowork', false, 'IconExternalLink', 'openInWindow'],
    ['window', true, 'IconBrowser', 'moveToTab'],
    ['window', false, 'IconBrowser', 'dockUnavailable'],
    ['unrecognized', true, 'IconBrowser', 'moveToTab']
  ]) {
    const store = createStore(host);
    store.hostToggle.state = { canDock, pending: false };
    const ownsWindow = host !== 'cowork';
    const vnode = render({
      ownsWindow,
      hostToggleLabel: makeLabel(computed, ownsWindow, store, onlyPreviewI18n).value,
      onlyPreviewShellStore: store
    });
    assert.equal(vnode.props.title, onlyPreviewI18n.topbar[expectedLabel]);
    assert.equal(vnode.props['aria-label'], vnode.props.title);
    assert.equal(vnode.props['aria-pressed'], ownsWindow);
    assert.equal(vnode.props.class.includes('onlypreview-shell__icon-command--window'), ownsWindow);
    assert.equal(vnode.props.disabled, ownsWindow && !canDock);
    assert.equal(vnode.children.icon()[0].type.name, expectedIcon);
    if (!vnode.props.disabled) {
      await vnode.props.onClick();
      assert.deepEqual(toggleCalls, [{ hostToken: env.hostToken }]);
    }
  }
});

test('focus refresh is receiver-safe and cleaned up, and both catalogs describe the toggle', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const styles = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.match(
    app,
    /const refreshHostToggleState = \(\): void => \{\s*void onlyPreviewShellStore\.refreshHostToggleState\(\);\s*\};/
  );
  assert.match(app, /window\.addEventListener\('focus', refreshHostToggleState\)/);
  assert.match(app, /window\.removeEventListener\('focus', refreshHostToggleState\)/);
  assert.match(
    styles,
    /\.onlypreview-shell__menu-actions \.onlypreview-shell__icon-command--window \{\s*background:\s*rgb\(255 255 255 \/ 12%\);/
  );
  for (const key of ['openInWindow', 'moveToTab', 'dockUnavailable']) {
    assert.equal((i18n.match(new RegExp(`${key}: '([^']+)'`, 'g')) ?? []).length, 2);
  }
});
