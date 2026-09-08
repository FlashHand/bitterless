/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { test } from 'node:test';
import { build, transformSync } from 'esbuild';
import ts from 'typescript';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import less from 'less';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const base = 'src/main/miniapps/onlypreview/';
const shell = 'src/renderer/onlypreview/shell/src/';
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let release;
  const promise = new Promise((done) => { release = done; });
  return { promise, release };
};
const compiled = await build({
  stdin: { contents: [
    "export { OnlyPreviewBookmarksService } from './" + base + "onlyPreviewBookmarks.service.ts';",
    "export { OnlyPreviewHostRegistry } from './" + base + "onlyPreviewHost.registry.ts';",
    "export { OnlyPreviewWorkspaceRegistry } from './" + base + "onlyPreviewWorkspace.registry.ts';"
  ].join('\n'), resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [{
    name: 'no-main-content-io',
    setup(context) {
      context.onResolve({ filter: /^(?:node:)?fs(?:\/promises)?$/ }, () => {
        throw new Error('Bookmarks may not read files in Main.');
      });
    }
  }]
});
const { OnlyPreviewBookmarksService, OnlyPreviewHostRegistry, OnlyPreviewWorkspaceRegistry } =
  await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

class Storage {
  rows = new Map();
  writes = 0;
  readGate = null;
  conflict = null;
  key(params) { return JSON.stringify([params.key, params.sub_key]); }
  async getStored(params) {
    const gate = this.readGate;
    this.readGate = null;
    if (gate) await gate.promise;
    const serializedValue = this.rows.get(this.key(params));
    if (serializedValue === undefined) return { exists: false, valid: false, value: null, serializedValue: null };
    try { return { exists: true, valid: true, value: JSON.parse(serializedValue), serializedValue }; }
    catch { return { exists: true, valid: false, value: null, serializedValue }; }
  }
  async insertIfAbsent(params) {
    const key = this.key(params);
    if (this.conflict) { const conflict = this.conflict; this.conflict = null; conflict(params); return false; }
    if (this.rows.has(key)) return false;
    this.rows.set(key, JSON.stringify(params.value)); this.writes++; return true;
  }
  async compareAndSet(params) {
    const key = this.key(params);
    if (this.rows.get(key) !== params.expectedSerializedValue) return false;
    this.rows.set(key, JSON.stringify(params.value)); this.writes++; return true;
  }
}
const harness = (storage = new Storage(), ready = true) => {
  const hosts = new OnlyPreviewHostRegistry();
  const workspaces = new OnlyPreviewWorkspaceRegistry(hosts);
  const events = [];
  let rejectAuthorization = false;
  let gate = null;
  const service = new OnlyPreviewBookmarksService(workspaces, async (authority) => {
    if (gate) await gate.promise;
    if (rejectAuthorization) throw new Error('Missing file');
    return { nodeKind: authority.relativePath === 'link' ? 'symlink' :
      authority.relativePath.endsWith('.md') ? 'file' : 'directory' };
  }, (...args) => events.push(args));
  service.configureStorage(storage);
  if (ready) service.markStorageReady();
  const host = hosts.issue('standalone', 'content');
  const bind = (path = '/bookmarks/A', owner = host) => {
    const workspace = workspaces.registerValidatedTarget(owner.hostToken, {
      rootRealPath: path, rootName: basename(path), displayPath: path
    });
    workspaces.bindProjectAuthority(owner.hostToken, workspace.workspaceId, 1);
    return { hostToken: owner.hostToken, workspaceId: workspace.workspaceId };
  };
  return { service, storage, hosts, workspaces, host, bind, events,
    missing: () => { rejectAuthorization = true; },
    gate: (value) => { gate = value; } };
};

test('Project-scoped bookmarks survive A/B/A, new host and service restart without duplicate reorder', async () => {
  const h = harness();
  const a = h.bind();
  await h.service.add({ ...a, relativePath: 'notes.md' });
  await h.service.add({ ...a, relativePath: 'docs' });
  await h.service.add({ ...a, relativePath: 'notes.md' });
  assert.equal(h.storage.writes, 2);
  assert.deepEqual((await h.service.snapshot(a)).entries.map((e) => e.nodeKind), ['file', 'directory']);
  assert.deepEqual((await h.service.snapshot(h.bind('/bookmarks/B'))).entries, []);
  const back = await h.service.snapshot(h.bind());
  assert.deepEqual(back.entries.map((e) => e.relativePath), ['notes.md', 'docs']);
  const restarted = harness(h.storage);
  const request = restarted.bind('/bookmarks/A', restarted.hosts.issue('standalone', 'content'));
  assert.deepEqual((await restarted.service.snapshot(request)).entries, back.entries);
  assert.equal(h.events.length, 2);
  assert.equal(h.workspaces.restore(h.host.hostToken).selectedRelativePath, undefined);
});

test('root, traversal, external capabilities and symlinks cannot be added', async () => {
  const h = harness(), request = h.bind();
  for (const path of ['', '..', '../outside.md', '/absolute.md', 'link']) {
    await assert.rejects(h.service.add({ ...request, relativePath: path }));
  }
  const external = h.workspaces.registerExternalPreview(h.host.hostToken, {
    rootRealPath: '/outside', rootName: 'outside', displayPath: '/outside', selectedRelativePath: 'item.md'
  });
  await assert.rejects(h.service.add({ hostToken: h.host.hostToken, ...external }));
  assert.equal(h.storage.writes, 0);
});

test('missing targets remain removable and removal only changes bookmarks', async () => {
  const h = harness(), request = h.bind();
  await h.service.add({ ...request, relativePath: 'notes.md' });
  h.missing();
  await h.service.remove({ ...request, relativePath: 'notes.md' });
  assert.deepEqual((await h.service.snapshot(request)).entries, []);
  assert.equal(h.workspaces.restore(h.host.hostToken).workspaceId, request.workspaceId);
});

test('stale authorization and slow storage reads cannot mutate a replacement Project', async () => {
  const h = harness(), request = h.bind(), gate = deferred();
  h.gate(gate);
  const add = h.service.add({ ...request, relativePath: 'notes.md' });
  const rejected = assert.rejects(add);
  h.bind('/bookmarks/B');
  gate.release(); await rejected;
  assert.equal(h.storage.writes, 0);
  h.gate(null);
  const b = h.bind('/bookmarks/B'), readGate = deferred();
  h.storage.readGate = readGate;
  const removal = assert.rejects(h.service.remove({ ...b, relativePath: 'notes.md' }));
  await tick();
  h.bind('/bookmarks/C'); readGate.release(); await removal;
  assert.equal(h.storage.writes, 0);
});

test('serial writes retain concurrent additions and CAS retries merge an external writer', async () => {
  const h = harness(), request = h.bind();
  h.storage.conflict = (params) => h.storage.rows.set(h.storage.key(params),
    JSON.stringify({ version: 1, entries: [{ relativePath: 'other.md', nodeKind: 'file' }] }));
  await Promise.all(['one.md', 'two.md', 'folder'].map((relativePath) => h.service.add({ ...request, relativePath })));
  assert.deepEqual((await h.service.snapshot(request)).entries.map((e) => e.relativePath),
    ['other.md', 'one.md', 'two.md', 'folder']);
});

test('readiness waits, failed/corrupt storage fails explicitly and failed writes do not poison the queue', async () => {
  const h = harness(new Storage(), false), request = h.bind();
  let completed = false;
  const snapshot = h.service.snapshot(request).then(() => { completed = true; });
  await tick(); assert.equal(completed, false);
  h.service.markStorageReady(); await snapshot;
  await h.service.add({ ...request, relativePath: 'one.md' });
  const key = [...h.storage.rows.keys()][0];
  h.storage.rows.set(key, '{bad');
  await assert.rejects(h.service.add({ ...request, relativePath: 'two.md' }));
  h.storage.rows.delete(key);
  await h.service.add({ ...request, relativePath: 'two.md' });
  assert.equal((await h.service.snapshot(request)).entries[0].name, 'two.md');
  const failed = harness(new Storage(), false);
  failed.service.markStorageFailed();
  await assert.rejects(failed.service.snapshot(failed.bind()), (e) => e.code === 'OPERATION_FAILED');
});

const evaluate = (source, bindings) => {
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const module = { exports: {} };
  new Function('module', 'exports', ...Object.keys(bindings), code)(module, module.exports, ...Object.values(bindings));
  return module.exports;
};
const classText = (path, names) => {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find(ts.isClassDeclaration);
  return names ? owner.members.filter((node) => names.includes(node.name?.getText(ast))).map((node) => node.getText(ast)).join('\n')
    : owner.getText(ast);
};
const success = (value) => ({ ok: true, value });
const unwrap = (value) => { if (!value.ok) throw new Error(value.error.message); return value.value; };
test('renderer ignores old Project responses/events and preserves full bookmark names', async () => {
  const first = deferred();
  let project = 'A', loads = 0, additions = 0;
  const Store = evaluate(classText(shell + 'onlyPreviewBookmarks.store.ts'), {
    unwrapOnlyPreviewResult: unwrap, describeOnlyPreviewError: (e) => e.message,
    xpcRenderer: { subscribe: () => {} }, ONLY_PREVIEW_BOOKMARK_ADD_EVENT: 'add', ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT: 'change'
  }).OnlyPreviewBookmarksStore;
  const store = new Store({
    getBookmarks: async ({ workspaceId }) => {
      loads++;
      return workspaceId === 'A' ? first.promise : success({ workspaceId, entries: [{ name: '完整名称.md', relativePath: '完整名称.md', nodeKind: 'file' }] });
    },
    addBookmark: async () => { additions++; return success(); },
    showBookmarkContextMenu: async () => success()
  }, { hostToken: 'token', hostId: 'host', workspaceId: () => project });
  store.initialize(); await tick();
  project = 'B'; store.resetWorkspace(); await tick();
  first.release(success({ workspaceId: 'A', entries: [{ name: 'old' }] })); await tick();
  assert.equal(store.entries[0].name, '完整名称.md');
  store.receive({ hostId: 'host', workspaceId: 'A', relativePath: 'old' }, true);
  store.receive({ hostId: 'other', workspaceId: 'B', relativePath: 'old' }, true);
  assert.equal(additions, 0);
  await store.add(''); assert.equal(additions, 0);
  store.dispose(); const before = loads;
  store.receive({ hostId: 'host', workspaceId: 'B' }); await tick();
  assert.equal(loads, before);
});

test('bookmark files use explicit preview; rapid folders/Project changes fence late reveals', async () => {
  const requests = [], centered = [], selected = [], pending = [];
  const Shell = evaluate('export class Shell { ' + classText(shell + 'onlyPreviewShell.store.ts', ['openBookmark']) + ' }', {
    revealOnlyPreviewGlobalSearchDirectory: async (request) => {
      requests.push(request); const gate = deferred(); pending.push(gate); await gate.promise;
      request.applyResult('projection'); return true;
    },
    describeOnlyPreviewError: (e) => e.message,
    onlyPreviewI18n: { bookmarks: { unavailable: 'missing' } }
  }).Shell;
  const host = new Shell();
  Object.assign(host, {
    bookmarkGeneration: 0, workspace: { workspaceId: 'A' }, treeExpansion: { revision: 1 },
    browseProjection: {}, expandedPaths: new Set(), browseProjectionContext: () => ({}),
    collapseTreeSelection: () => {}, selectFile: async (path) => selected.push(path),
    commitBrowseProjectionResult: (result) => centered.push(result),
    centerTreeRow: (path) => centered.push(path)
  });
  await host.openBookmark({ relativePath: 'one.md', nodeKind: 'file' });
  assert.deepEqual(selected, ['one.md']);
  const first = host.openBookmark({ relativePath: 'first', nodeKind: 'directory' });
  const second = host.openBookmark({ relativePath: 'second', nodeKind: 'directory' });
  pending[1].release(); await second; pending[0].release(); await first;
  assert.deepEqual(centered, ['projection', 'second']);
  const late = host.openBookmark({ relativePath: 'late', nodeKind: 'directory' });
  host.workspace = { workspaceId: 'B' }; pending[2].release(); await late;
  assert.deepEqual(centered, ['projection', 'second']);
  assert.equal(requests[0].isCurrent(), false);
});

test('native bookmark menu removes only on command and settles on dismiss or host close', async () => {
  const window = new EventEmitter(); window.isDestroyed = () => false;
  let template, popup;
  const api = evaluate(read(base + 'onlyPreviewBookmarkMenu.service.ts').replace(/^import .*;\n/gmu, ''), {
    Menu: { buildFromTemplate: (items) => { template = items; return { popup: (options) => { popup = options; } }; } },
    i18nHelper: { getMessages: () => ({ app: { onlyPreviewFileMenu: { removeBookmark: '移除书签' } } }) }
  });
  const clicked = api.showOnlyPreviewBookmarkMenu(window);
  assert.equal(template.length, 1); assert.equal(template[0].label, '移除书签');
  template[0].click(); popup.callback(); assert.equal(await clicked, true);
  const dismissed = api.showOnlyPreviewBookmarkMenu(window); popup.callback(); assert.equal(await dismissed, false);
  const closed = api.showOnlyPreviewBookmarkMenu(window); window.emit('closed'); assert.equal(await closed, false);
  assert.equal(window.listenerCount('closed'), 0);
});

test('Shell focus follows document focus, not selected path or an inner control', () => {
  const source = read(shell + 'App.vue');
  const match = source.match(/const syncShellFocus = ([\s\S]*?);\n/);
  assert.ok(match);
  const focus = { value: false }, document = { hasFocus: () => true };
  const { sync } = evaluate('export const sync = ' + match[1], { shellFocused: focus, document });
  sync(); assert.equal(focus.value, true);
  document.hasFocus = () => false; sync(); assert.equal(focus.value, false);
  for (const event of ['focus', 'blur']) {
    assert.ok(source.includes("window.addEventListener('" + event + "', syncShellFocus)"));
    assert.ok(source.includes("window.removeEventListener('" + event + "', syncShellFocus)"));
  }
});

test('bar/Shell compile, native bounds remain measured, scoped highlights and native menu wiring are shared', async () => {
  for (const file of ['App.vue', 'components/Bookmarks/BookmarkBar.vue']) {
    const filename = resolve(root, shell + file);
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(errors, []);
    const script = compileScript(descriptor, { id: file });
    const template = compileTemplate({
      source: descriptor.template.content, filename, id: file,
      compilerOptions: { bindingMetadata: script.bindings }
    });
    assert.deepEqual(template.errors, []);
    transformSync(script.content, { loader: 'ts' });
  }
  const app = read(shell + 'App.vue');
  assert.ok(app.indexOf('<BookmarkBar />') < app.indexOf('<main name="onlypreview__workspace"'));
  assert.match(app, /getBoundingClientRect/);
  assert.match(app, /resizeObserver.observe\(host\)/);
  const css = (await less.render(read(shell + 'App.less'))).css;
  assert.match(css, /onlypreview-shell--focused \.onlypreview-shell__tree-row--selected\s*\{\s*background: #a9c9ff/);
  assert.match(css, /onlypreview-shell__tree-row--selected\s*\{\s*background: #d6e4ff/);
  const bookmarksCss = (await less.render(read(shell + 'components/Bookmarks/BookmarkBar.less'))).css;
  assert.match(bookmarksCss, /flex: 0 0 30px/);
  assert.match(bookmarksCss, /overflow-x: auto/);
  const native = read(base + 'onlyPreviewProjectNativeAction.service.ts');
  assert.match(native.slice(0, native.indexOf('async showProjectRootContextMenu')), /onlypreview-add-bookmark/);
  assert.doesNotMatch(native.slice(native.indexOf('async showProjectRootContextMenu'), native.indexOf('async copyProjectItemFromUi')), /onlypreview-add-bookmark/);
  assert.match(read('src/main/xpc/onlyPreview.handler.ts'), /onlyPreviewBookmarksService.configureStorage/);
  const startup = read('src/main/app.main.ts') + read('src/main/xpc/onlyPreview.handler.ts');
  assert.match(startup, /onlyPreviewBookmarksService.markStorageReady/);
});

