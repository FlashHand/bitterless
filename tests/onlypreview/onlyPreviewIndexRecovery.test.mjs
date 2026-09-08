/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const subscriptions = new Map();
globalThis.__indexRecoverySubscriptions = subscriptions;
after(() => { delete globalThis.__indexRecoverySubscriptions; });
const bundle = await build({
  stdin: {
    contents: `
      export { OnlyPreviewContractError } from './src/shared/onlypreview/onlyPreview.contract';
      export * as progress from './src/renderer/onlypreview/shell/src/onlyPreviewSearchProgress.service';
      export { subscribeOnlyPreviewShellEvents } from './src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service';
    `,
    resolveDir: root, loader: 'ts'
  },
  write: false, bundle: true, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [{
    name: 'index-recovery-xpc-boundary',
    setup(context) {
      context.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
        path: 'renderer', namespace: 'index-recovery'
      }));
      context.onLoad({ filter: /.*/, namespace: 'index-recovery' }, () => ({
        contents: 'export const xpcRenderer = { subscribe: (name, fn) => globalThis.__indexRecoverySubscriptions.set(name, fn) };'
      }));
    }
  }]
});
const { OnlyPreviewContractError, progress, subscribeOnlyPreviewShellEvents } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const read = (name) => readFileSync(join(root, 'src/renderer/onlypreview/shell/src', name), 'utf8');
const compileClass = (file, name, context) => {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === name);
  const compiled = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return runInNewContext(`${compiled}\n${name};`, { exports: {}, ...context });
};
const env = { hostToken: 'host-token-0000000000000001', hostId: 'host-000000000000000001' };
const workspaceId = 'workspace-000000000000001';
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const unwrapOnlyPreviewResult = (value) => {
  if (!value.ok) throw new OnlyPreviewContractError(value.error.code, value.error.message);
  return value.value;
};
const diagnostic = { nextTag: () => 'x1', now: () => 0, emit: () => undefined, elapsed: () => 0 };
const shellFixture = () => {
  const reported = [], contexts = [];
  const detail = { detail: null, clear() { this.detail = null; } };
  const describeOnlyPreviewError = (error) => {
    detail.detail = { code: error.code, message: error.message };
    return error.code;
  };
  const client = {};
  const Store = compileClass('onlyPreviewShell.store.ts', 'OnlyPreviewShellStore', {
    ...progress, OnlyPreviewContractError, unwrapOnlyPreviewResult,
    createOnlyPreviewSearchDiagnostics: () => diagnostic,
    OnlyPreviewDeferredIndexService: class {}, OnlyPreviewHostToggleStore: class {},
    OnlyPreviewTreeExpansionStore: class { expandSelectedParents() { return undefined; } },
    OnlyPreviewBrowseProjectionService: class { ready = true; },
    OnlyPreviewCharacterCountHostGate: class {},
    projectWidthPersistence: { restore: () => 200 }, window: { innerWidth: 1000 },
    onlyPreviewEnv: env, onlyPreviewErrorDetail: detail, describeOnlyPreviewError,
    onlyPreviewSearchClient: client,
    onlyPreviewClient: { reportProjectIndexFailed: async (value) => { reported.push(value); } },
    onlyPreviewGlobalSearchShellClient: { report: (value) => contexts.push(value) },
    resolveOnlyPreviewCurrentDirectory: () => ''
  });
  const store = new Store();
  store.workspace = { workspaceId, rootName: 'project' };
  store.searchWorkspaceGeneration = 2;
  store.loadSelectedParentListings = async () => undefined;
  return { store, detail, reported, contexts, client, describeOnlyPreviewError };
};
const snapshot = (state = 'ready', generation = 2) => ({
  workspaceId, generation, state,
  index: { workspaceId, entries: [], truncated: false, limit: 0 }
});
const failure = (generation = 2) => ({
  workspaceId, generation, error: { code: 'INDEX_FAILED', message: 'Index build failed.' }
});

test('a current background failure settles progress, preserves browsing and clears its own banner on recovery', async () => {
  const f = shellFixture();
  f.store.indexLoading = true;
  f.store.index = { workspaceId, entries: [{ relativePath: 'keep.txt' }] };
  f.store.applySearchFailure(failure());
  assert.equal(f.store.errorMessage, 'INDEX_FAILED');
  assert.equal(f.store.indexLoading, false);
  assert.equal(f.store.projectionReady, true);
  assert.equal(f.store.index.entries[0].relativePath, 'keep.txt');
  assert.equal(f.reported.length, 1);
  await f.store.applySearchSnapshot(snapshot('building'));
  assert.equal(f.store.indexLoading, true);
  assert.equal(f.store.errorMessage, 'INDEX_FAILED', 'building does not claim recovery');
  await f.store.applySearchSnapshot(snapshot());
  assert.equal(f.store.errorMessage, '');
  assert.equal(f.detail.detail, null);
  assert.equal(f.store.indexLoading, false);
});

test('recovery never erases a later unrelated error, even if its localized message is identical', async () => {
  const f = shellFixture();
  f.store.applySearchFailure(failure());
  const oldDetail = f.detail.detail;
  f.store.errorMessage = f.describeOnlyPreviewError(new OnlyPreviewContractError('INDEX_FAILED', 'A different operation failed.'));
  assert.notEqual(f.detail.detail, oldDetail);
  await f.store.applySearchSnapshot(snapshot());
  assert.equal(f.store.errorMessage, 'INDEX_FAILED');
  assert.equal(f.detail.detail.message, 'A different operation failed.');
});

test('stale workspace/generation failures and snapshots cannot overwrite current state', async () => {
  const f = shellFixture();
  f.store.indexLoading = true;
  f.store.applySearchFailure(failure(1));
  f.store.applySearchFailure({ ...failure(), workspaceId: 'another-workspace' });
  await f.store.applySearchSnapshot(snapshot('ready', 1));
  assert.equal(f.store.errorMessage, '');
  assert.equal(f.store.indexLoading, true);
  assert.equal(f.reported.length, 0);
});

test('delayed initialization and refresh acknowledgements cannot regress a newer ready broadcast', async () => {
  for (const method of ['initializeIndex', 'refreshIndex']) {
    const f = shellFixture();
    const response = deferred();
    f.client.initialize = f.client.refresh = () => response.promise;
    const operation = f.store[method]();
    await f.store.applySearchSnapshot(snapshot());
    response.resolve({ ok: true, value: snapshot('building') });
    await operation;
    assert.equal(f.store.indexLoading, false, method);
    assert.equal(f.store.errorMessage, '');
  }
});

test('first building acknowledgement keeps the progress state without manufacturing a finished index', async () => {
  const f = shellFixture();
  f.client.initialize = async () => ({ ok: true, value: snapshot('building') });
  await f.store.initializeIndex();
  assert.equal(f.store.indexLoading, true);
  assert.equal(f.store.errorMessage, '');
});

test('the real shell subscription accepts only validated failures from its own host', () => {
  subscriptions.clear();
  const failures = [];
  subscribeOnlyPreviewShellEvents(env.hostId, { searchFailure: (value) => failures.push(value) });
  const emit = subscriptions.get('onlypreview/search-failure');
  emit({ params: { hostId: 'another-host', failure: failure() } });
  emit({ params: { hostId: env.hostId, failure: { ...failure(), extra: true } } });
  emit({ params: { hostId: env.hostId, failure: failure() } });
  assert.equal(failures.length, 1);
});
