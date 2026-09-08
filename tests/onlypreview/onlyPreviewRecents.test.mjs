/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { basename, dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const bundled = await build({
  stdin: {
    contents: `
      export { OnlyPreviewRecentsService } from './src/main/miniapps/onlypreview/onlyPreviewRecents.service.ts';
      export { OnlyPreviewHostRegistry } from './src/main/miniapps/onlypreview/onlyPreviewHost.registry.ts';
      export { OnlyPreviewWorkspaceRegistry } from './src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry.ts';
    `,
    resolveDir: root
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'recents-no-main-file-io',
      setup(context) {
        context.onResolve({ filter: /^(?:node:)?fs(?:\/promises)?$/ }, () => {
          throw new Error('Recents and its registries must not enumerate or read files in Main');
        });
      }
    }
  ]
});
const { OnlyPreviewRecentsService, OnlyPreviewHostRegistry, OnlyPreviewWorkspaceRegistry } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

class MemorySettingStorage {
  rows = new Map();
  calls = [];
  nextReadGate;
  beforeInsert;
  beforeCompareAndSet;

  key(params) {
    return JSON.stringify([params.key, params.sub_key]);
  }

  async getStored(params) {
    this.calls.push({ method: 'getStored', ...params });
    const gate = this.nextReadGate;
    this.nextReadGate = undefined;
    if (gate) {
      gate.entered.resolve();
      await gate.release.promise;
    }
    const serializedValue = this.rows.get(this.key(params));
    if (serializedValue === undefined) {
      return { exists: false, valid: false, value: null, serializedValue: null };
    }
    try {
      return { exists: true, valid: true, value: JSON.parse(serializedValue), serializedValue };
    } catch {
      return { exists: true, valid: false, value: null, serializedValue };
    }
  }

  async insertIfAbsent(params) {
    this.calls.push({ method: 'insertIfAbsent', ...params });
    if (this.beforeInsert) {
      const callback = this.beforeInsert;
      this.beforeInsert = undefined;
      callback(params);
    }
    const key = this.key(params);
    if (this.rows.has(key)) return false;
    this.rows.set(key, JSON.stringify(params.value));
    return true;
  }

  async compareAndSet(params) {
    this.calls.push({ method: 'compareAndSet', ...params });
    if (this.beforeCompareAndSet) {
      const callback = this.beforeCompareAndSet;
      this.beforeCompareAndSet = undefined;
      callback(params);
    }
    const key = this.key(params);
    if (this.rows.get(key) !== params.expectedSerializedValue) return false;
    this.rows.set(key, JSON.stringify(params.value));
    return true;
  }

  blockNextRead() {
    const gate = { entered: deferred(), release: deferred() };
    this.nextReadGate = gate;
    return gate;
  }

  writes() {
    return this.calls.filter(({ method }) => method !== 'getStored');
  }
}

const createHarness = (storage = new MemorySettingStorage(), ready = true) => {
  const hosts = new OnlyPreviewHostRegistry();
  const workspaces = new OnlyPreviewWorkspaceRegistry(hosts);
  const presentations = new Map();
  const changed = [];
  const presentation = (token) =>
    presentations.get(token) ?? {
      hostId: hosts.require(token).hostId,
      selectionRevision: 0,
      surface: 'none',
      fileRef: null,
      selectedTextAvailable: false
    };
  const service = new OnlyPreviewRecentsService(hosts, workspaces, presentation, (id) =>
    changed.push(id)
  );
  service.configureStorage(storage);
  if (ready) service.markStorageReady();
  const host = () => hosts.issue('standalone', 'content');
  const bindProject = (owner, path) => {
    const workspace = workspaces.registerValidatedTarget(owner.hostToken, {
      rootRealPath: path,
      rootName: basename(path),
      displayPath: path
    });
    workspaces.bindProjectAuthority(owner.hostToken, workspace.workspaceId, 1);
    presentations.delete(owner.hostToken);
    return workspace;
  };
  const show = (owner, path) => {
    const project = workspaces.restore(owner.hostToken);
    const rootPath = project
      ? workspaces.requireWorkspace(owner.hostToken, project.workspaceId).rootRealPath
      : null;
    let fileRef;
    if (rootPath && path.startsWith(`${rootPath}/`)) {
      fileRef = { workspaceId: project.workspaceId, relativePath: path.slice(rootPath.length + 1) };
      workspaces.select(owner.hostToken, fileRef);
    } else {
      fileRef = workspaces.registerExternalPreview(owner.hostToken, {
        rootRealPath: dirname(path),
        rootName: basename(dirname(path)),
        displayPath: dirname(path),
        selectedRelativePath: basename(path)
      });
    }
    const previous = presentation(owner.hostToken);
    presentations.set(owner.hostToken, {
      hostId: owner.hostId,
      selectionRevision: previous.selectionRevision + 1,
      surface: 'vue',
      fileRef,
      selectedTextAvailable: true
    });
    return fileRef;
  };
  const open = async (owner, path) => {
    show(owner, path);
    await service.record(owner.hostToken, path);
  };
  return {
    hosts,
    workspaces,
    presentations,
    presentation,
    changed,
    service,
    storage,
    host,
    bindProject,
    show,
    open
  };
};
const names = (snapshot) => snapshot.entries.map(({ name }) => name);
const invalidInput = (error) => error.code === 'INVALID_INPUT';

test('explicit opens deduplicate, promote and cap MRU at 100 while persistence contains only canonical paths', async () => {
  const h = createHarness();
  const host = h.host();
  h.bindProject(host, '/recents-fixture/project');
  for (let index = 0; index < 105; index += 1) {
    await h.open(host, `/recents-fixture/project/file-${index}.md`);
  }
  let snapshot = await h.service.snapshot(host.hostToken);
  assert.equal(snapshot.entries.length, 100);
  assert.equal(snapshot.entries[0].name, 'file-104.md');
  assert.equal(snapshot.entries.at(-1).name, 'file-5.md');
  assert.equal(new Set(snapshot.entries.map(({ id }) => id)).size, 100);
  await h.open(host, '/recents-fixture/project/file-20.md');
  snapshot = await h.service.snapshot(host.hostToken);
  assert.equal(snapshot.entries.length, 100);
  assert.equal(snapshot.entries[0].name, 'file-20.md');
  assert.equal(snapshot.entries[1].name, 'file-104.md');
  assert.equal(names(snapshot).filter((name) => name === 'file-20.md').length, 1);
  await h.open(host, '/recents-fixture/project/file-20.md');
  assert.deepEqual(
    await h.service.snapshot(host.hostToken),
    snapshot,
    'same-path repeat does not duplicate or change navigation revision'
  );
  await h.service.flushPendingWrites();
  assert.equal(h.storage.rows.size, 1);
  const persisted = JSON.parse([...h.storage.rows.values()][0]);
  assert.deepEqual(Object.keys(persisted).sort(), ['paths', 'version']);
  assert.equal(persisted.version, 1);
  assert.equal(persisted.paths.length, 100);
  assert.equal(persisted.paths[0], '/recents-fixture/project/file-20.md');
  assert.ok(!JSON.stringify(persisted).includes(host.hostToken));
  assert.equal(h.changed.length, 107);
});

test('Back and Forward move the presentation cursor through the same MRU list without changing order or storage', async () => {
  const h = createHarness();
  const host = h.host();
  h.bindProject(host, '/recents-fixture/navigation');
  for (const name of ['a', 'b', 'c']) await h.open(host, `/recents-fixture/navigation/${name}.md`);
  const writeCount = h.storage.writes().length;
  let snapshot = await h.service.snapshot(host.hostToken);
  assert.deepEqual(names(snapshot), ['c.md', 'b.md', 'a.md']);
  assert.equal(snapshot.canBack, true);
  assert.equal(snapshot.canForward, false);
  assert.equal(await h.service.navigate(host.hostToken, 'forward', snapshot.revision), null);
  const middle = await h.service.navigate(host.hostToken, 'back', snapshot.revision);
  assert.equal(middle, '/recents-fixture/navigation/b.md');
  assert.equal(
    h.service.currentPath(host.hostToken),
    '/recents-fixture/navigation/c.md',
    'resolving navigation does not itself mutate the presentation'
  );
  h.show(host, middle);
  snapshot = await h.service.snapshot(host.hostToken);
  assert.equal(snapshot.activeEntryId, snapshot.entries[1].id);
  assert.equal(snapshot.canBack, true);
  assert.equal(snapshot.canForward, true);
  h.show(host, await h.service.navigate(host.hostToken, 'back', snapshot.revision));
  snapshot = await h.service.snapshot(host.hostToken);
  assert.equal(snapshot.canBack, false);
  assert.equal(await h.service.navigate(host.hostToken, 'back', snapshot.revision), null);
  h.show(host, await h.service.navigate(host.hostToken, 'forward', snapshot.revision));
  snapshot = await h.service.snapshot(host.hostToken);
  assert.deepEqual(names(snapshot), ['c.md', 'b.md', 'a.md']);
  assert.equal(h.storage.writes().length, writeCount);
  assert.equal(snapshot.canReload, true);
  assert.equal(snapshot.canLocate, true);
  await h.open(host, '/recents-fixture/navigation/a.md');
  assert.deepEqual(names(await h.service.snapshot(host.hostToken)), ['a.md', 'c.md', 'b.md']);
});

test('external opens retain Project selection and belong only to that Project, with a separate unbound list', async () => {
  const h = createHarness();
  const host = h.host();
  const projectA = h.bindProject(host, '/recents-fixture/project-a');
  await h.open(host, '/recents-fixture/project-a/inside.md');
  const selectedA = h.workspaces.restore(host.hostToken);
  const external = '/recents-fixture/sibling/external.md';
  await h.open(host, external);
  assert.deepEqual(h.workspaces.restore(host.hostToken), selectedA);
  assert.equal(h.workspaces.restore(host.hostToken).workspaceId, projectA.workspaceId);
  const snapshotA = await h.service.snapshot(host.hostToken);
  assert.equal(snapshotA.entries[0].relativePath, '../sibling/external.md');
  assert.equal(snapshotA.canLocate, false);
  assert.equal(snapshotA.canReload, true);
  h.bindProject(host, '/recents-fixture/project-b');
  assert.deepEqual((await h.service.snapshot(host.hostToken)).entries, []);
  await h.open(host, external);
  const snapshotB = await h.service.snapshot(host.hostToken);
  assert.equal(snapshotB.entries.length, 1);
  assert.notEqual(
    snapshotB.entries[0].id,
    snapshotA.entries[0].id,
    'IDs are scoped even for the same external path'
  );
  const unbound = h.host();
  await h.open(unbound, '/recents-fixture/unbound/only.md');
  const unboundSnapshot = await h.service.snapshot(unbound.hostToken);
  assert.equal(unboundSnapshot.entries[0].relativePath, '/recents-fixture/unbound/only.md');
  assert.equal(unboundSnapshot.canLocate, false);
  h.bindProject(unbound, '/recents-fixture/project-a');
  assert.deepEqual(names(await h.service.snapshot(unbound.hostToken)), [
    'external.md',
    'inside.md'
  ]);
  assert.equal(h.storage.rows.size, 3);
});

test('a reopened service restores serialized records by canonical Project rather than old workspace or host IDs', async () => {
  const h = createHarness();
  const first = h.host();
  const previousProject = h.bindProject(first, '/recents-fixture/reopen');
  await h.open(first, '/recents-fixture/reopen/remember.md');
  await h.open(first, '/recents-fixture/outside/stale-file.md');
  await h.service.flushPendingWrites();
  const persisted = [...h.storage.rows.values()][0];
  assert.ok(!persisted.includes(previousProject.workspaceId));
  h.hosts.revoke(first.hostToken);
  const reopened = createHarness(h.storage);
  const current = reopened.host();
  const nextProject = reopened.bindProject(current, '/recents-fixture/reopen');
  assert.notEqual(nextProject.workspaceId, previousProject.workspaceId);
  const snapshot = await reopened.service.snapshot(current.hostToken);
  assert.deepEqual(names(snapshot), ['stale-file.md', 'remember.md']);
  assert.equal(snapshot.activeEntryId, null);
  assert.equal(snapshot.canBack, false);
  assert.equal(snapshot.canForward, false);
  assert.equal(snapshot.canReload, false);
  assert.equal(
    await reopened.service.resolveEntry(
      current.hostToken,
      snapshot.entries[0].id,
      snapshot.revision
    ),
    '/recents-fixture/outside/stale-file.md'
  );
});

test('opaque selections reject paths, forged IDs, obsolete revisions and another Project IDs', async () => {
  const h = createHarness();
  const host = h.host();
  h.bindProject(host, '/recents-fixture/authority-a');
  await h.open(host, '/recents-fixture/authority-a/a.md');
  const before = await h.service.snapshot(host.hostToken);
  const entry = before.entries[0];
  assert.match(entry.id, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(entry).sort(), ['id', 'name', 'relativePath']);
  await h.open(host, '/recents-fixture/authority-a/b.md');
  const current = await h.service.snapshot(host.hostToken);
  await assert.rejects(
    h.service.resolveEntry(host.hostToken, entry.id, before.revision),
    invalidInput
  );
  await assert.rejects(
    h.service.resolveEntry(host.hostToken, '/recents-fixture/authority-a/a.md', current.revision),
    invalidInput
  );
  await assert.rejects(
    h.service.resolveEntry(host.hostToken, '0'.repeat(64), current.revision),
    invalidInput
  );
  await assert.rejects(
    h.service.resolveEntry(host.hostToken, entry.id, String(current.revision)),
    invalidInput
  );
  await assert.rejects(h.service.navigate(host.hostToken, 'back', before.revision), invalidInput);
  await assert.rejects(
    h.service.navigate(host.hostToken, 'sideways', current.revision),
    invalidInput
  );
  h.bindProject(host, '/recents-fixture/authority-b');
  const other = await h.service.snapshot(host.hostToken);
  await assert.rejects(
    h.service.resolveEntry(host.hostToken, entry.id, other.revision),
    invalidInput
  );
});

test('snapshots preserve nonexistent entries without eager I/O and cap stored overflow on read', async () => {
  const h = createHarness();
  const host = h.host();
  h.bindProject(host, '/recents-fixture/not-created');
  await h.service.snapshot(host.hostToken);
  const read = h.storage.calls.find(({ method }) => method === 'getStored');
  const paths = Array.from(
    { length: 125 },
    (_, index) => `/recents-fixture/not-created/missing-${index}.md`
  );
  h.storage.rows.set(h.storage.key(read), JSON.stringify({ version: 1, paths }));
  const reopened = createHarness(h.storage);
  const current = reopened.host();
  reopened.bindProject(current, '/recents-fixture/not-created');
  const snapshot = await reopened.service.snapshot(current.hostToken);
  assert.equal(snapshot.entries.length, 100);
  assert.equal(snapshot.entries[0].name, 'missing-0.md');
  assert.equal(snapshot.entries.at(-1).name, 'missing-99.md');
  assert.equal(h.storage.writes().length, 0, 'snapshot does not rewrite or remove stale entries');
  const readCount = h.storage.calls.length;
  assert.deepEqual(await reopened.service.snapshot(current.hostToken), snapshot);
  assert.equal(
    h.storage.calls.length,
    readCount,
    'unchanged snapshot uses its bounded in-memory bucket'
  );
});

test('CAS and insertion conflicts merge the other writer newest path instead of losing it', async () => {
  for (const existing of [false, true]) {
    const h = createHarness();
    const host = h.host();
    h.bindProject(host, '/recents-fixture/conflict');
    if (existing) await h.open(host, '/recents-fixture/conflict/old.md');
    const concurrent = '/recents-fixture/conflict/concurrent.md';
    const injectConflict = (params) => {
      h.storage.rows.set(
        h.storage.key(params),
        JSON.stringify({
          version: 1,
          paths: [concurrent, ...(existing ? ['/recents-fixture/conflict/old.md'] : [])]
        })
      );
    };
    if (existing) h.storage.beforeCompareAndSet = injectConflict;
    else h.storage.beforeInsert = injectConflict;
    await h.open(host, '/recents-fixture/conflict/target.md');
    const snapshot = await h.service.snapshot(host.hostToken);
    assert.deepEqual(names(snapshot), [
      'target.md',
      'concurrent.md',
      ...(existing ? ['old.md'] : [])
    ]);
    const attempts = h.storage.calls.filter(({ method }) => method === 'compareAndSet');
    assert.equal(attempts.length, existing ? 2 : 1);
    assert.ok(
      attempts.every(({ expectedSerializedValue }) => typeof expectedSerializedValue === 'string')
    );
  }
});

test('host revocation while storage is loading cancels recording without writing or notifying', async () => {
  const h = createHarness();
  const host = h.host();
  h.bindProject(host, '/recents-fixture/revoked');
  const path = '/recents-fixture/revoked/late.md';
  h.show(host, path);
  const gate = h.storage.blockNextRead();
  const recording = h.service.record(host.hostToken, path);
  await gate.entered.promise;
  h.hosts.revoke(host.hostToken);
  gate.release.resolve();
  await recording;
  await h.service.flushPendingWrites();
  assert.equal(h.storage.writes().length, 0);
  assert.deepEqual(h.changed, []);
  await assert.rejects(
    h.service.snapshot(host.hostToken),
    (error) => error.code === 'HOST_NOT_FOUND'
  );
});

test('late storage reads cannot record an obsolete Project or superseded presentation', async () => {
  for (const changeScope of [false, true]) {
    const h = createHarness();
    const host = h.host();
    h.bindProject(host, '/recents-fixture/pending-a');
    const path = '/recents-fixture/pending-a/old.md';
    h.show(host, path);
    await h.service.snapshot(host.hostToken);
    const gate = h.storage.blockNextRead();
    const recording = h.service.record(host.hostToken, path);
    await gate.entered.promise;
    if (changeScope) h.bindProject(host, '/recents-fixture/pending-b');
    h.show(
      host,
      changeScope ? '/recents-fixture/pending-b/new.md' : '/recents-fixture/pending-a/new.md'
    );
    gate.release.resolve();
    await recording;
    assert.equal(h.storage.writes().length, 0);
    assert.deepEqual((await h.service.snapshot(host.hostToken)).entries, []);
    assert.deepEqual(h.changed, []);
  }
});

test('storage readiness gates snapshots and unavailable or malformed settings fail explicitly', async () => {
  const h = createHarness(undefined, false);
  const host = h.host();
  let settled = false;
  const pending = h.service.snapshot(host.hostToken).finally(() => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false);
  assert.deepEqual(h.storage.calls, []);
  h.service.markStorageFailed();
  await assert.rejects(pending, (error) => error.code === 'OPERATION_FAILED');
  const invalid = createHarness();
  const invalidHost = invalid.host();
  await invalid.service.snapshot(invalidHost.hostToken);
  const read = invalid.storage.calls[0];
  invalid.storage.rows.set(
    invalid.storage.key(read),
    JSON.stringify({ version: 1, paths: ['relative.md'] })
  );
  const reopened = createHarness(invalid.storage);
  await assert.rejects(
    reopened.service.snapshot(reopened.host().hostToken),
    (error) => error.code === 'PROTOCOL_ERROR'
  );
  assert.equal(invalid.storage.writes().length, 0);
});
