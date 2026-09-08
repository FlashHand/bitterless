/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-host-toggle-'));
const stubs = {
  'onlyPreviewWindow.helper': 'export const onlyPreviewWindowHelper = globalThis.__toggle.window;',
  onlyPreviewCoworkTab: "export const ONLY_PREVIEW_COWORK_TAB_ID = 'onlypreview';",
  'maestroWindow.controller': 'export const maestroWindowHelper = globalThis.__toggle.maestro;',
  'compositeTab.registry':
    'export const getMaestroCompositeTab = () => globalThis.__toggle.registered ? {} : null;',
  'onlyPreviewPreviewRegion.service':
    'export const onlyPreviewPreviewRegionService = globalThis.__toggle.preview;',
  'fileSearchWindow.service': 'export const fileSearchWindowService = globalThis.__toggle.files;',
  'onlyPreviewLog.runtime':
    'export const onlyPreviewLogService = { writeOperationFailure: failure => globalThis.__toggle.logs.push(failure) };',
  'onlyPreviewOpenDiagnostics.runtime':
    'export const onlyPreviewOpenDiagnostics = { trace: () => ({mark(){},end(){}}) };'
};
const env = {
  registered: true,
  logs: [],
  events: [],
  calls: [],
  live: null,
  fileRef: null,
  tabs: []
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
const inspect = (path) => {
  if (env.deleted?.has(path))
    throw Object.assign(new Error('File no longer exists'), { code: 'ENOENT' });
  const file = path.includes('.');
  const directory = file ? dirname(path) : path;
  return {
    rootRealPath: directory,
    displayPath: directory,
    rootName: basename(directory),
    ...(file ? { selectedRelativePath: basename(path) } : {})
  };
};
let runtime;
const requireLive = (token) => {
  runtime.onlyPreviewHostRegistry.require(token, ['content']);
  if (env.live?.host.hostToken !== token || env.live.window.isDestroyed())
    throw new Error('stale host');
  return env.live;
};
const createHost = async (kind) => {
  env.calls.push(`build:${kind}`);
  if (env.failBuild === kind) {
    env.failBuild = null;
    throw new Error(`failed build ${kind}`);
  }
  assert.equal(env.live, null, 'no second live surface during rebuild');
  const host = runtime.onlyPreviewHostRegistry.issue('standalone', 'content');
  const window = kind === 'cowork' ? env.browser : { isDestroyed: () => false };
  env.live = { host, kind, window };
  env.fileRef = null;
  // Shell first-restore is suppressed until Main has rebound the transition target.
  env.initialRestores.push(
    await runtime.onlyPreviewRecentDirectoryService.restoreWorkspace(host.hostToken)
  );
  return host;
};
env.window = {
  beginHostTransition: () => {},
  endHostTransition: () => {},
  getMountKind: (token) => requireLive(token).kind,
  getStandaloneWindow: (token) => requireLive(token).window,
  getStandaloneHost: () => env.live?.host ?? null,
  ensureStandalone: () => createHost('standalone'),
  destroyStandalone: () => {
    if (!env.live) return;
    env.calls.push(`destroy:${env.live.kind}`);
    runtime.onlyPreviewHostRegistry.revoke(env.live.host.hostToken);
    if (env.live.kind === 'cowork') env.tabs = env.tabs.filter((tab) => tab.kind !== 'onlypreview');
    env.live = null;
    env.fileRef = null;
  },
  show: () => env.calls.push('show')
};
env.maestro = {
  get browserWindow() {
    return env.browser;
  },
  whenReady: async () => {
    if (env.readyGate) await env.readyGate.promise;
  },
  getTabs: async () => env.tabs.slice(),
  closeTab: async ({ id }) => {
    env.calls.push(`close:${id}`);
    env.tabs = env.tabs.filter((tab) => tab.id !== id);
  },
  openCompositeTab: async () => {
    await createHost('cowork');
    env.tabs.push({ id: 'preview-tab', kind: 'onlypreview' });
  }
};
env.preview = {
  snapshot: () => ({ fileRef: env.fileRef }),
  present: async (token, ref) => {
    requireLive(token);
    env.fileRef = ref;
    env.calls.push(`present:${ref.relativePath}`);
  },
  clearWorkspace: () => {
    env.fileRef = null;
  }
};
env.files = {
  inspectTarget: async (path) => {
    env.calls.push(`inspect:${path}`);
    return inspect(path);
  },
  authorizeProjectItem: async (ref) => {
    env.calls.push(`authorize:${ref.relativePath}`);
    return { ...ref, nodeKind: 'file' };
  }
};
globalThis.__toggle = env;
await build({
  stdin: {
    contents: `
    export { onlyPreviewHostToggleService } from './src/main/windows/onlyPreviewHostToggle.service';
    export { chooseOnlyPreviewFolder } from './src/main/windows/onlyPreviewChooseFolder.service';
    export { onlyPreviewHostRegistry } from './src/main/miniapps/onlypreview/onlyPreviewHost.registry';
    export { onlyPreviewWorkspaceRegistry } from './src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
    export { onlyPreviewRecentDirectoryService } from './src/main/miniapps/onlypreview/onlyPreviewRecentDirectory.service';
    export { onlyPreviewTargetMutations, presentOnlyPreviewExplicitFile } from './src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
  `,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: join(buildRoot, 'runtime.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'native-boundaries',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) => {
          const key = Object.keys(stubs).find((name) => path.endsWith(name));
          if (key) return { path: key, namespace: 'toggle-test' };
          if (path === 'electron' || path === 'electron-xpc/main')
            return { path, namespace: 'toggle-test' };
        });
        context.onLoad({ filter: /.*/, namespace: 'toggle-test' }, ({ path }) => ({
          contents:
            stubs[path] ??
            (path === 'electron'
              ? 'export const dialog = { showOpenDialog: async () => await globalThis.__toggle.dialog.promise };'
              : 'export const xpcMain = { broadcast: (event, payload) => globalThis.__toggle.events.push({event, payload}) };')
        }));
      }
    }
  ]
});
runtime = await import(pathToFileURL(join(buildRoot, 'runtime.mjs')).href);
after(() => rmSync(buildRoot, { recursive: true, force: true }));
const recent = runtime.onlyPreviewRecentDirectoryService;
const stored = new Map();
recent.configureStorage({
  getStored: async ({ sub_key: subKey }) => {
    if (env.storageGate) await env.storageGate.promise;
    const value = stored.get(subKey);
    return {
      exists: value !== undefined,
      valid: value !== undefined,
      value,
      serializedValue: JSON.stringify(value) ?? null
    };
  },
  insertIfAbsent: async ({ sub_key: subKey, value }) => {
    stored.set(subKey, value);
    return true;
  },
  compareAndSet: async ({ sub_key: subKey, value }) => {
    stored.set(subKey, value);
    return true;
  }
});
recent.configureTargetRuntime({
  inspectTarget: async (path) => inspect(path),
  bindWorkspace: async (token, workspace) =>
    runtime.onlyPreviewWorkspaceRegistry.bindProjectAuthority(token, workspace.workspaceId, 1)
});
recent.markStorageReady();
const reset = async (kind = 'cowork', project = '/project', file = '/project/a.md') => {
  await recent.flushPendingWrites();
  env.window.destroyStandalone();
  recent.clearTransientState();
  Object.assign(env, {
    calls: [],
    logs: [],
    events: [],
    deleted: new Set(),
    readyGate: null,
    storageGate: null,
    registered: true,
    failBuild: null,
    tabs: [],
    initialRestores: [],
    browser: { isDestroyed: () => false },
    dialog: deferred()
  });
  const generation = recent.beginExplicitTarget();
  const host = await createHost(kind);
  if (kind === 'cowork') env.tabs.push({ id: 'preview-tab', kind: 'onlypreview' });
  recent.bindExplicitTarget(host.hostToken, generation);
  if (project) await recent.openExplicitTarget(host.hostToken, project, generation);
  if (file) await runtime.presentOnlyPreviewExplicitFile(host, inspect(file));
  recent.finishExplicitTarget(generation);
  await recent.flushPendingWrites();
  env.calls = [];
  return host;
};

test('bidirectional relocation creates fresh capabilities and retains Project and selected file', async () => {
  const old = await reset();
  const oldRef = env.fileRef;
  await runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  assert.equal(env.live.kind, 'standalone');
  assert.notEqual(env.live.host.hostToken, old.hostToken);
  assert.notEqual(env.fileRef.workspaceId, oldRef.workspaceId);
  assert.equal(env.fileRef.relativePath, 'a.md');
  assert.equal(
    runtime.onlyPreviewWorkspaceRegistry.restore(env.live.host.hostToken).displayPath,
    '/project'
  );
  assert.equal(runtime.onlyPreviewHostRegistry.isLive(old.hostToken), false);
  await runtime.onlyPreviewHostToggleService.toggle(env.live.host.hostToken);
  assert.equal(env.live.kind, 'cowork');
  assert.equal(env.fileRef.relativePath, 'a.md');
  assert.equal(
    env.initialRestores.every((value) => value === null),
    true
  );
  await recent.flushPendingWrites();
  assert.deepEqual(stored.get('last_file'), {
    version: 1,
    directoryPath: '/project',
    relativePath: 'a.md'
  });
});

test('external file survives with or without a Project without becoming its directory', async () => {
  for (const project of ['/project', null]) {
    const old = await reset('cowork', project, '/outside/report.pdf');
    await runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
    assert.equal(
      runtime.onlyPreviewWorkspaceRegistry.restore(env.live.host.hostToken)?.displayPath ?? null,
      project
    );
    assert.equal(
      runtime.onlyPreviewWorkspaceRegistry.getExternalPreviewNativePath(
        env.live.host.hostToken,
        env.fileRef
      ),
      '/outside/report.pdf'
    );
  }
});

test('duplicate requests share one queued relocation and pending resets on the new host', async () => {
  const old = await reset();
  const gate = deferred();
  const blocker = runtime.onlyPreviewTargetMutations.run(() => gate.promise);
  const first = runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  const duplicate = runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  assert.equal(first, duplicate);
  assert.equal(runtime.onlyPreviewHostToggleService.getState(old.hostToken).pending, true);
  gate.resolve();
  await Promise.all([blocker, first, duplicate]);
  assert.equal(env.calls.filter((call) => call === 'build:standalone').length, 1);
  assert.equal(
    runtime.onlyPreviewHostToggleService.getState(env.live.host.hostToken).pending,
    false
  );
  assert.equal(env.events.at(-1).payload.hostId, env.live.host.hostId);
});

test('absent, unregistered or closing Maestro preserves the source window', async () => {
  for (const mode of ['absent', 'unregistered', 'closing']) {
    const old = await reset('standalone');
    if (mode === 'absent') env.browser = null;
    if (mode === 'unregistered') env.registered = false;
    if (mode === 'closing') env.readyGate = deferred();
    const operation = runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
    if (mode === 'closing') {
      await tick();
      env.browser = null;
      env.readyGate.resolve();
    }
    await assert.rejects(operation, /not available/);
    assert.equal(env.live.host, old);
    assert.equal(
      env.calls.some((call) => call.startsWith('destroy:')),
      false
    );
  }
});

test('queued persistence completes before teardown and newest accepted selection is captured', async () => {
  const old = await reset();
  env.storageGate = deferred();
  await runtime.presentOnlyPreviewExplicitFile(old, inspect('/project/new.md'));
  const operation = runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  await tick();
  assert.equal(env.live.host, old);
  assert.equal(
    env.calls.some((call) => call.startsWith('destroy:')),
    false
  );
  env.storageGate.resolve();
  env.storageGate = null;
  await operation;
  assert.equal(env.fileRef.relativePath, 'new.md');
});

test('invalid and revoked source capabilities never tear down another host', async () => {
  const old = await reset();
  assert.throws(() => runtime.onlyPreviewHostToggleService.toggle('bad'), /invalid/i);
  const gate = deferred();
  const blocker = runtime.onlyPreviewTargetMutations.run(() => gate.promise);
  const operation = runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  env.window.destroyStandalone();
  const replacement = await createHost('standalone');
  gate.resolve();
  await blocker;
  await assert.rejects(operation, /no longer available|stale host/);
  assert.equal(env.live.host, replacement);
});

test('destination build failure restores source kind and target then reports failure', async () => {
  for (const kind of ['cowork', 'standalone']) {
    const old = await reset(kind);
    env.failBuild = kind === 'cowork' ? 'standalone' : 'cowork';
    await assert.rejects(
      runtime.onlyPreviewHostToggleService.toggle(old.hostToken),
      /failed build/
    );
    assert.equal(env.live.kind, kind);
    assert.equal(env.fileRef.relativePath, 'a.md');
    assert.ok(runtime.onlyPreviewHostToggleService.getState(env.live.host.hostToken).error);
    assert.equal(env.logs.length > 0, true);
  }
});

test('a removed file leaves the new Project visible with an honest error and no stale document', async () => {
  const old = await reset();
  env.deleted.add('/project/a.md');
  await runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  assert.equal(env.live.kind, 'standalone');
  assert.equal(env.fileRef, null);
  assert.equal(
    runtime.onlyPreviewWorkspaceRegistry.restore(env.live.host.hostToken).displayPath,
    '/project'
  );
  assert.ok(runtime.onlyPreviewHostToggleService.getState(env.live.host.hostToken).error);
});

test('explicit docking removes only the stale OnlyPreview placeholder tab', async () => {
  const old = await reset('standalone');
  env.tabs = [
    { id: 'stale-preview', kind: 'onlypreview' },
    { id: 'web-tab', kind: 'browser' }
  ];
  await runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  assert.deepEqual(
    env.calls.filter((call) => call.startsWith('close:')),
    ['close:stale-preview']
  );
  assert.ok(env.tabs.some((tab) => tab.id === 'web-tab'));
});

test('a stale folder dialog cannot advance mutations after its source relocated', async () => {
  const old = await reset();
  const dialog = runtime.chooseOnlyPreviewFolder(old.hostToken);
  await runtime.onlyPreviewHostToggleService.toggle(old.hostToken);
  const newHost = env.live.host;
  const before = runtime.onlyPreviewWorkspaceRegistry.restore(newHost.hostToken);
  const generation = recent.beginExplicitTarget(newHost.hostToken);
  env.dialog.resolve({ canceled: false, filePaths: ['/obsolete'] });
  await assert.rejects(dialog, /no longer available|stale host/);
  const accepted = await recent.openExplicitTarget(newHost.hostToken, '/still-current', generation);
  recent.finishExplicitTarget(generation);
  assert.ok(accepted, 'stale dialog did not supersede the active generation');
  assert.equal(before.displayPath, '/project');
  assert.equal(accepted.displayPath, '/still-current');
});
