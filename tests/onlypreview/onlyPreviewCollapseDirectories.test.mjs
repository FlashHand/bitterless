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
const calls = [];
const responders = {};
const ok = (value) => ({ ok: true, value });
const env = {
  hostId: 'host-collapse-directories',
  hostToken: 'host-token-collapse-directories',
  host: 'cowork',
  platform: 'darwin'
};
const previousWindow = globalThis.window;
globalThis.window = { onlyPreviewEnv: env, innerWidth: 1280 };
globalThis.__onlyPreviewCollapseRuntime = new Proxy(responders, {
  get(target, method) {
    return async (request) => {
      calls.push({ method, request });
      assert.equal(typeof target[method], 'function', `Unexpected IPC: ${String(method)}`);
      return await target[method](request);
    };
  }
});
globalThis.__onlyPreviewCollapseSubscriptions = subscriptions;
after(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  delete globalThis.__onlyPreviewCollapseRuntime;
  delete globalThis.__onlyPreviewCollapseSubscriptions;
});

const bundled = await build({
  stdin: {
    contents: `
      export { OnlyPreviewShellStore } from './src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts';
      export { OnlyPreviewTreeSelectionController } from './src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.store.ts';
      export { onlyPreviewI18n } from './src/renderer/onlypreview/common/onlyPreviewI18n.ts';
      export { ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, ONLY_PREVIEW_SELECTION_CHANGED_EVENT } from './src/shared/onlypreview/onlyPreview.types.ts';
      export { ONLY_PREVIEW_BROWSE_LISTING_EVENT, ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT } from './src/shared/onlypreview/onlyPreviewSearch.type.ts';
      export { reactive } from 'vue';
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
      name: 'onlypreview-collapse-xpc',
      setup(context) {
        context.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'renderer',
          namespace: 'collapse-test'
        }));
        context.onLoad({ filter: /.*/, namespace: 'collapse-test' }, () => ({
          contents: `
          export const createXpcRendererEmitter = () => globalThis.__onlyPreviewCollapseRuntime;
          export const xpcRenderer = {
            subscribe(name, listener) {
              globalThis.__onlyPreviewCollapseSubscriptions.set(name, listener);
            }
          };
        `
        }));
      }
    }
  ]
});
const {
  OnlyPreviewShellStore,
  OnlyPreviewTreeSelectionController,
  onlyPreviewI18n,
  reactive,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT: workspaceEvent,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT: selectionEvent,
  ONLY_PREVIEW_BROWSE_LISTING_EVENT: listingEvent,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT: snapshotEvent
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((done) => {
    resolvePromise = done;
  });
  return { promise, resolve: resolvePromise };
};
const emit = (name, payload = {}) => {
  const listener = subscriptions.get(name);
  assert.equal(typeof listener, 'function', `Missing subscription: ${name}`);
  listener({ params: { hostId: env.hostId, ...payload } });
};
const entry = (relativePath, directory = false, suffix = '') => ({
  relativePath,
  parentRelativePath: relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/'))
    : '',
  name: relativePath.split('/').at(-1),
  nodeKind: directory ? 'directory' : 'file',
  size: directory ? 0 : 12,
  modifiedAt: 1,
  previewHint: directory ? 'unsupported' : 'text',
  mediaType: directory ? 'unknown' : 'text',
  isText: !directory,
  directoryToken: directory ? `token-${relativePath}${suffix}` : null,
  searchExcluded: false
});
const listing = (store, relativePath = '', suffix = '') => ({
  workspaceId: store.workspace.workspaceId,
  generation: store.getGlobalSearchContext().generation,
  directoryToken: `token-${relativePath}${suffix}`,
  relativePath,
  entries:
    relativePath === ''
      ? [entry('docs', true, suffix), entry('misc', true, suffix), entry('README.md')]
      : relativePath === 'docs'
        ? [entry('docs/deep', true, suffix), entry('docs/top.md')]
        : [entry('docs/deep/file.md')]
});
const publishListing = (value) => emit(listingEvent, { listing: value });
const snapshot = (store) => ({
  workspaceId: store.workspace.workspaceId,
  generation: store.getGlobalSearchContext().generation,
  state: 'ready',
  index: { workspaceId: store.workspace.workspaceId, entries: [], truncated: false, limit: 100 },
  memory: {
    measurementComplete: true,
    processRssBytes: 0,
    workerHeapUsedBytes: 0,
    workerExternalBytes: 0,
    treeMetadataEntryCount: 0,
    treeMetadataEstimatedBytes: 0,
    filenameTierEstimatedBytes: 0,
    diskIndexBytes: 0,
    runtimeOneGiBWarning: false,
    runtimeTwoGiBLimitExceeded: false
  }
});
const createStore = async ({ cached = true } = {}) => {
  subscriptions.clear();
  for (const key of Object.keys(responders)) delete responders[key];
  Object.assign(responders, {
    reportGlobalSearchContext: async () => ok(undefined),
    reportGlobalSearchDirectoryReveal: async () => ok(undefined),
    getHostToggleState: async () => ok({ canDock: true, pending: false }),
    getSettings: async () => ok({ openFilesWithSingleClick: true }),
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
  });
  const store = reactive(
    new OnlyPreviewShellStore({
      nextTag: () => 'collapse-test',
      now: () => 0,
      elapsed: () => 0,
      emit: () => true
    })
  );
  await store.initialize();
  store.workspace = {
    workspaceId: 'workspace-collapse-directories-0001',
    rootName: 'project-root',
    displayPath: '/test/project-root',
    selectedRelativePath: ''
  };
  responders.browseDirectory = async ({ directoryToken }) => {
    const relativePath = directoryToken.slice('token-'.length);
    return ok(listing(store, relativePath));
  };
  publishListing(listing(store));
  if (cached) {
    publishListing(listing(store, 'docs'));
    publishListing(listing(store, 'docs/deep'));
  }
  store.expandedPaths = new Set(['', 'docs', 'docs/deep', 'misc/hidden/deep']);
  await tick();
  calls.length = 0;
  assert.ok(store.index, 'the real listing subscription populated the projection');
  return store;
};
const selectPreview = (store) => {
  store.selectedRelativePath = 'docs/deep/file.md';
  store.treeSelectedRelativePath = 'docs/deep';
  store.focusedRelativePath = 'docs/deep';
  store.previewPresentation = {
    hostId: env.hostId,
    selectionRevision: 7,
    surface: 'vue',
    fileRef: { relativePath: store.selectedRelativePath },
    selectedTextAvailable: true
  };
  store.selectedCharacterCount = 42;
};
const expanded = (store) => [...store.expandedPaths];
const visible = (store) => store.visibleRows.map((row) => row.entry.relativePath);
const browsing = () => calls.filter((call) => call.method === 'browseDirectory');

test('collapse clears visible and hidden descendants without navigating, changing caches or issuing IPC', async () => {
  const store = await createStore();
  selectPreview(store);
  const selection = new OnlyPreviewTreeSelectionController(() => store);
  selection.paths = ['docs/deep/file.md', 'README.md'];
  selection.anchorPath = 'docs/deep/file.md';
  const before = {
    workspace: store.workspace,
    index: store.index,
    preview: store.previewPresentation,
    generation: store.getGlobalSearchContext().generation,
    directory: store.currentDirectoryRelativePath,
    center: store.centerProjectRevision
  };
  assert.ok(visible(store).includes('docs/deep/file.md'));
  store.treeExpansion.collapse(store);
  assert.deepEqual(expanded(store), ['']);
  assert.deepEqual(visible(store), ['', 'docs', 'misc', 'README.md']);
  assert.equal(store.workspace, before.workspace);
  assert.equal(store.index, before.index);
  assert.equal(store.previewPresentation, before.preview);
  assert.equal(store.getGlobalSearchContext().generation, before.generation);
  assert.equal(store.currentDirectoryRelativePath, before.directory);
  assert.equal(store.treeSelectedRelativePath, 'docs/deep');
  assert.equal(store.focusedRelativePath, 'docs/deep');
  assert.equal(store.selectedRelativePath, 'docs/deep/file.md');
  assert.equal(store.selectedCharacterCount, 42);
  assert.equal(store.centerProjectRevision, before.center);
  assert.equal(store.projectionReady, true);
  selection.retain();
  assert.deepEqual(selection.paths, ['README.md'], 'existing visible-row pruning remains intact');
  assert.deepEqual(selection.entries(), [{ relativePath: 'README.md', nodeKind: 'file' }]);
  await tick();
  assert.deepEqual(calls, [], 'collapse must not make any XPC call');
  store.toggleDirectory('docs');
  await tick();
  assert.deepEqual(expanded(store), ['', 'docs']);
  assert.ok(visible(store).includes('docs/deep'));
  assert.ok(!visible(store).includes('docs/deep/file.md'));
  assert.equal(browsing().length, 0, 'the first-level listing is reused from cache');
});

test('collapse is repeatable, restores a manually closed root, and accepts an empty root', async () => {
  const store = await createStore();
  store.expandedPaths.delete('');
  assert.deepEqual(visible(store), ['']);
  store.treeExpansion.collapse(store);
  store.treeExpansion.collapse(store);
  assert.deepEqual(expanded(store), ['']);
  assert.deepEqual(visible(store), ['', 'docs', 'misc', 'README.md']);
  publishListing({ ...listing(store), entries: [] });
  store.expandedPaths.add('removed/deep');
  store.treeExpansion.collapse(store);
  assert.deepEqual(expanded(store), ['']);
  assert.deepEqual(visible(store), ['']);
});

test('collapse is a no-op without workspace or index', async () => {
  const store = await createStore();
  for (const absent of ['workspace', 'index']) {
    const previous = store[absent];
    const revision = store.treeExpansion.revision;
    store[absent] = null;
    const paths = expanded(store);
    store.treeExpansion.collapse(store);
    assert.deepEqual(expanded(store), paths);
    assert.equal(store.treeExpansion.revision, revision);
    store[absent] = previous;
  }
  await tick();
  assert.deepEqual(calls, []);
});

test('late directory listings and completed search snapshots update data without reopening the tree', async () => {
  const store = await createStore();
  selectPreview(store);
  store.treeExpansion.collapse(store);
  const update = listing(store, 'docs/deep');
  update.entries.push(entry('docs/deep/arrived.md'));
  publishListing(update);
  assert.ok(store.index.entries.some((item) => item.relativePath === 'docs/deep/arrived.md'));
  assert.deepEqual(expanded(store), ['']);
  store.indexLoading = true;
  emit(snapshotEvent, { snapshot: snapshot(store) });
  await tick();
  assert.equal(
    store.indexLoading,
    false,
    'the actual snapshot validator/handler accepted the event'
  );
  assert.deepEqual(expanded(store), ['']);
  assert.equal(browsing().length, 0);
});

test('a replacement root listing refreshes cached descendants without undoing collapse', async () => {
  const store = await createStore();
  selectPreview(store);
  store.treeSelectedRelativePath = 'docs';
  store.treeExpansion.collapse(store);
  responders.browseDirectory = async ({ directoryToken }) =>
    ok(listing(store, directoryToken.slice('token-'.length, -'-new'.length), '-new'));
  publishListing(listing(store, '', '-new'));
  await tick();
  assert.equal(browsing().length, 2, 'the replacement generation still fills its browse cache');
  assert.ok(store.selectedEntry);
  assert.deepEqual(expanded(store), ['']);
  assert.equal(store.treeSelectedRelativePath, 'docs');
  assert.equal(store.selectedRelativePath, 'docs/deep/file.md');
});

test('a selection synchronization already awaiting Main cannot reopen the collapsed current file', async () => {
  const store = await createStore();
  selectPreview(store);
  const pending = deferred();
  responders.restoreWorkspace = () => pending.promise;
  emit(selectionEvent);
  assert.equal(calls.filter((call) => call.method === 'restoreWorkspace').length, 1);
  store.treeExpansion.collapse(store);
  pending.resolve(ok({ ...store.workspace, selectedRelativePath: store.selectedRelativePath }));
  await tick();
  assert.deepEqual(expanded(store), ['']);
  assert.equal(store.selectedRelativePath, 'docs/deep/file.md');
  assert.equal(browsing().length, 0);
});

test('collapse supersedes a pending Locate but explicit later Locate reuses the completed cache', async () => {
  const store = await createStore({ cached: false });
  selectPreview(store);
  const pending = deferred();
  responders.browseDirectory = ({ directoryToken }) =>
    directoryToken === 'token-docs'
      ? pending.promise
      : Promise.resolve(ok(listing(store, 'docs/deep')));
  const locating = store.locateSelectedFile();
  assert.equal(browsing().length, 1);
  store.treeExpansion.collapse(store);
  const focused = store.focusedRelativePath;
  pending.resolve(ok(listing(store, 'docs')));
  assert.equal(await locating, '');
  assert.deepEqual(expanded(store), ['']);
  assert.equal(store.focusedRelativePath, focused);
  assert.ok(store.selectedEntry, 'cancelled reveal still accepts the loaded file metadata');
  const reads = browsing().length;
  assert.equal(await store.locateSelectedFile(), 'docs/deep/file.md');
  assert.deepEqual(new Set(expanded(store)), new Set(['', 'docs', 'docs/deep']));
  assert.equal(store.focusedRelativePath, 'docs/deep/file.md');
  assert.ok(visible(store).includes(store.selectedRelativePath));
  assert.equal(browsing().length, reads, 'explicit Locate reuses the loaded parent listings');
});

test('collapse supersedes an older global-search reveal without discarding its cache or later reveals', async () => {
  const store = await createStore({ cached: false });
  const pending = deferred();
  responders.browseDirectory = ({ directoryToken }) =>
    directoryToken === 'token-docs'
      ? pending.promise
      : Promise.resolve(ok(listing(store, 'docs/deep')));
  const action = {
    hostId: env.hostId,
    actionId: 'reveal-collapse-action-0001',
    workspaceId: store.workspace.workspaceId,
    generation: store.getGlobalSearchContext().generation,
    relativePath: 'docs/deep'
  };
  const revealing = store.handleGlobalSearchDirectoryReveal(action);
  assert.equal(browsing().length, 1);
  store.treeExpansion.collapse(store);
  const center = store.centerProjectRevision;
  pending.resolve(ok(listing(store, 'docs')));
  await revealing;
  assert.deepEqual(expanded(store), ['']);
  assert.equal(store.centerProjectRevision, center);
  assert.equal(
    calls.find((call) => call.method === 'reportGlobalSearchDirectoryReveal').request.succeeded,
    false
  );
  assert.ok(store.index.entries.some((item) => item.relativePath === 'docs/deep/file.md'));
  const reads = browsing().length;
  await store.handleGlobalSearchDirectoryReveal({
    ...action,
    actionId: 'reveal-collapse-action-0002'
  });
  assert.deepEqual(expanded(store), ['', 'docs', 'docs/deep']);
  assert.equal(store.centerProjectRevision, center + 1);
  assert.equal(store.treeSelectedRelativePath, 'docs/deep');
  assert.equal(
    calls.filter((call) => call.method === 'reportGlobalSearchDirectoryReveal').at(-1).request
      .succeeded,
    true
  );
  assert.equal(browsing().length, reads);
});

test('workspace reset clears suppression for the same selected path on the next workspace', async () => {
  const store = await createStore();
  selectPreview(store);
  store.treeExpansion.collapse(store);
  const revision = store.treeExpansion.revision;
  responders.restoreWorkspace = async () => ok(null);
  emit(workspaceEvent);
  await tick();
  assert.equal(store.workspace, null);
  assert.equal(store.index, null);
  assert.ok(store.treeExpansion.revision > revision);
  const selectedRelativePath = 'docs/deep/file.md';
  responders.restoreWorkspace = async () =>
    ok({
      workspaceId: 'workspace-collapse-directories-0002',
      rootName: 'next-root',
      displayPath: '/test/next-root',
      selectedRelativePath
    });
  responders.initialize = async () => ok(snapshot(store));
  emit(workspaceEvent);
  await tick();
  assert.equal(store.selectedRelativePath, selectedRelativePath);
  assert.ok(store.expandedPaths.has('docs'));
  assert.ok(store.expandedPaths.has('docs/deep'));
});

test('compiled header action has the fold icon directly left of Locate, localized semantics and real disabled/click behavior', async () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const button = app.match(
    /<a-button\s+name="onlypreview__collapseDirectories"[\s\S]*?<\/a-button>/
  );
  assert.ok(button);
  assert.match(
    app.slice(button.index + button[0].length),
    /^\s*<a-button\s+name="onlypreview__locateCurrentFile"/
  );
  const render = new Function('Vue', compile(button[0], { mode: 'function' }).code)({
    ...Vue,
    resolveComponent: (name) => ({ name })
  });
  const store = await createStore();
  const renderButton = () => render({ onlyPreviewShellStore: store, onlyPreviewI18n });
  const vnode = renderButton();
  assert.equal(vnode.props.class, 'onlypreview-shell__project-action');
  assert.equal(vnode.props.type, 'text');
  assert.equal(vnode.props.size, 'mini');
  assert.equal(vnode.props.title, onlyPreviewI18n.project.collapseDirectories);
  assert.ok(vnode.props.title);
  assert.equal(vnode.props['aria-label'], vnode.props.title);
  assert.equal(vnode.props.disabled, false);
  const icon = vnode.children.icon()[0];
  assert.equal(icon.type.name, 'IconFold');
  assert.equal(icon.props.size, 15);
  assert.equal(icon.props['aria-hidden'], 'true');
  vnode.props.onClick();
  assert.deepEqual(expanded(store), ['']);
  for (const absent of ['workspace', 'index']) {
    const previous = store[absent];
    store[absent] = null;
    assert.equal(renderButton().props.disabled, true);
    store[absent] = previous;
  }
  const catalog = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.equal([...catalog.matchAll(/collapseDirectories:/g)].length, 2);
});
