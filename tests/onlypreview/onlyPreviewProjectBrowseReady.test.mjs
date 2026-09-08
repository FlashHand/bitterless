/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';

const projectRoot = resolve(import.meta.dirname, '../..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-project-browse-ready-'));
const bundlePath = join(buildRoot, 'browse-state.mjs');
const broadcasts = [];
globalThis.__onlyPreviewBrowseBroadcasts = broadcasts;
await build({
  entryPoints: [join(projectRoot, 'src/main/miniapps/onlypreview/onlyPreviewProjectIndexState.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'main-authority-stubs',
      setup(context) {
        context.onResolve(
          {
            filter: /electron-xpc\/main|onlyPreviewHost\.registry$|onlyPreviewWorkspace\.registry$/
          },
          ({ path }) => ({ path, namespace: 'stub' })
        );
        context.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
          loader: 'js',
          contents:
            path === 'electron-xpc/main'
              ? 'export const xpcMain={broadcast:(eventName,params)=>globalThis.__onlyPreviewBrowseBroadcasts.push({eventName,params})};'
              : path.endsWith('onlyPreviewHost.registry')
                ? 'export const onlyPreviewHostRegistry={};'
                : 'export const onlyPreviewWorkspaceRegistry={onRevoke:()=>{}};'
        }));
      }
    }
  ]
});
const { OnlyPreviewProjectIndexStateService } = await import(pathToFileURL(bundlePath).href);
const projectionPath = join(buildRoot, 'projection.mjs');
await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service.ts')
  ],
  outfile: projectionPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'search-client-stub',
      setup(context) {
        context.onResolve({ filter: /onlyPreviewSearch\.client$/ }, ({ path }) => ({
          path,
          namespace: 'stub'
        }));
        context.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const onlyPreviewSearchClient={};'
        }));
      }
    }
  ]
});
const { OnlyPreviewBrowseProjectionService } = await import(pathToFileURL(projectionPath).href);
const read = (path) => readFileSync(join(projectRoot, path), 'utf8');
// Compile the real store class, without constructing content adapters; exercise its actual getter.
const storeSource = ts.createSourceFile(
  'preview.ts',
  read('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts'),
  ts.ScriptTarget.Latest,
  true
);
const storeClass = storeSource.statements.find((node) => ts.isClassDeclaration(node));
const compiled = ts.transpileModule(storeClass.getText(storeSource), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Store = runInNewContext(`${compiled}\nOnlyPreviewPreviewStore;`);
const loading = Object.getOwnPropertyDescriptor(Store.prototype, 'projectIndexing').get;
const isLoading = (state, workspaceId = 'workspace-a', browsedWorkspaceId = null) =>
  loading.call({
    presentation: {
      workspaceId,
      projectIndexState: state.get(workspaceId),
      projectBrowseState: state.getBrowseState(workspaceId)
    },
    browsedWorkspaceId
  });
after(() => {
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__onlyPreviewBrowseBroadcasts;
});

test('pending root listing loads even if a search snapshot says ready', () => {
  const state = new OnlyPreviewProjectIndexStateService();
  assert.equal(state.getBrowseState(null), null);
  assert.equal(isLoading(state), false);
  state.markBound('host', 'workspace-a');
  assert.equal(state.getBrowseState('workspace-a'), 'pending');
  assert.equal(isLoading(state), true);
  state.markObserved('host', 'workspace-a', 'ready');
  assert.equal(isLoading(state), true, 'index ready is not listing ready');
});

test('successful empty and populated root listings both make Project browsable; stale listings do not', () => {
  for (const entries of [
    [],
    [{ relativePath: 'note.md', parentRelativePath: '', name: 'note.md', nodeKind: 'file' }]
  ]) {
    const projection = new OnlyPreviewBrowseProjectionService();
    const state = new OnlyPreviewProjectIndexStateService();
    const context = { hostToken: 'token', workspaceId: 'workspace-a', generation: 2 };
    const listing = {
      workspaceId: 'workspace-a',
      generation: 2,
      relativePath: '',
      directoryToken: 'root',
      entries
    };
    const expanded = new Set();
    state.markBound('host', 'workspace-a');
    assert.equal(
      projection.applyListing({ ...listing, generation: 1 }, context, expanded).loaded,
      false
    );
    assert.equal(projection.ready, false);
    assert.equal(projection.applyListing(listing, context, expanded).loaded, true);
    assert.equal(projection.ready, true);
    state.markBrowseReady('host', listing.workspaceId);
    assert.equal(isLoading(state), false);
    assert.equal(state.get('workspace-a'), 'building');
  }
});

test('root listing readiness ends loading while indexing continues and survives reconciliation', () => {
  const state = new OnlyPreviewProjectIndexStateService();
  state.markBound('host', 'workspace-a');
  const before = broadcasts.length;
  state.markBrowseReady('host', 'workspace-a');
  assert.equal(state.get('workspace-a'), 'building');
  assert.equal(isLoading(state), false, 'late preview pull sees the stored readiness');
  assert.equal(broadcasts.length, before + 1);
  state.markBrowseReady('host', 'workspace-a');
  assert.equal(broadcasts.length, before + 1, 'duplicate root event does not republish');
  state.markObserved('host', 'workspace-a', 'reconciling');
  assert.equal(isLoading(state), false);
  state.markFailed('host', 'workspace-a');
  assert.equal(
    state.getBrowseState('workspace-a'),
    'ready',
    'index failure cannot erase available files'
  );
});

test('listing failure is terminal without manufacturing readiness and a successful retry can recover', () => {
  const state = new OnlyPreviewProjectIndexStateService();
  state.markBound('host', 'workspace-a');
  state.markFailed('host', 'workspace-a');
  assert.equal(state.getBrowseState('workspace-a'), 'failed');
  assert.equal(isLoading(state), false);
  state.markBrowseReady('host', 'workspace-a');
  assert.equal(state.getBrowseState('workspace-a'), 'ready');
  assert.equal(state.get('workspace-a'), 'failed', 'listing does not change the search state');
});

test('switching or rebinding resets listing readiness; stale workspace and host reports do nothing', () => {
  const state = new OnlyPreviewProjectIndexStateService();
  state.markBound('host', 'workspace-a');
  state.markBrowseReady('host', 'workspace-a');
  state.markBound('host', 'workspace-b');
  state.markBrowseReady('host', 'workspace-a');
  state.markBrowseReady('old-host', 'workspace-b');
  state.markFailed('host', 'workspace-a');
  assert.equal(state.getBrowseState('workspace-b'), 'pending');
  assert.equal(state.getBrowseState('workspace-a'), null);
  state.markBound('host', 'workspace-a');
  assert.equal(isLoading(state), true);
  assert.equal(
    isLoading(state, 'workspace-a', 'workspace-a'),
    false,
    'resolved-file deletion guard stays'
  );
  state.clear('workspace-a');
  assert.equal(state.getBrowseState('workspace-a'), null);
});

test('root readiness uses validated generation-fenced events, without counting children or scanning again', () => {
  const window = read('src/main/windows/onlyPreviewWindow.helper.ts');
  const callback = window.slice(
    window.indexOf('broadcast: (eventName, params) => {'),
    window.indexOf('onUnexpectedExit:')
  );
  assert.match(callback, /eventName === ONLY_PREVIEW_BROWSE_LISTING_EVENT/);
  assert.match(callback, /event\.hostId === host\.hostId && event\.listing\.relativePath === ''/);
  assert.match(callback, /markBrowseReady\(host\.hostId, event\.listing\.workspaceId\)/);
  assert.doesNotMatch(callback, /entries\.length|readdir|stat\(/);
  const relay = read('src/main/fileSearch/fileSearchRuntimeRelay.service.ts');
  assert.match(
    relay,
    /value\.workspaceId !== active\.workspaceId \|\| value\.generation !== active\.generation\) return/
  );
  assert.match(relay, /property === 'listing' &&\s*this\._isBrowseListing/);
  const projection = read(
    'src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service.ts'
  );
  assert.match(projection, /get ready\(\): boolean \{\s*return this\.entriesByPath\.has\(''\)/);
  assert.match(
    projection,
    /this\.entriesByPath\.set\(listing\.relativePath, \[\.\.\.listing\.entries\]\)/
  );
});
