/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const compiled = await build({
  stdin: { contents: "export { OnlyPreviewBookmarkStorageService } from './src/preload/onlypreview/onlyPreviewBookmarkStorage.service.ts'", resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: join(root, 'tsconfig.node.json')
});
const { OnlyPreviewBookmarkStorageService: Store } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const temp = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'onlypreview-bookmarks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};
const rootA = '/project/A', rootB = '/project/B';
const databasePath = (directory, project = rootA) => join(directory, 'onlypreview', 'project-state', createHash('sha256').update(project).digest('hex') + '.sqlite');
const entry = (relativePath) => ({ relativePath, nodeKind: 'file' });
const add = (store, path, project = rootA) => store.execute({ rootRealPath: project, action: 'add', entry: entry(path) });
const remove = (store, relativePath) => store.execute({ rootRealPath: rootA, action: 'remove', relativePath });
const snapshot = (store, project = rootA) => store.execute({ rootRealPath: project, action: 'snapshot' });

test('real plaintext SQLite separates A/B from search and survives process-style service restart', async (t) => {
  const directory = await temp(t);
  const store = new Store(directory, async () => null);
  const a = await add(store, 'one.md');
  await add(store, 'two.md', rootB);
  await mkdir(join(directory, 'search'), { recursive: true });
  await writeFile(join(directory, 'search', 'index.sqlite'), 'disposable search cache');
  await rm(join(directory, 'search'), { recursive: true });
  const reopened = new Store(directory, async () => { throw Error('Must not remigrate'); });
  assert.deepEqual(await snapshot(reopened), a);
  assert.deepEqual((await snapshot(reopened, rootB)).entries, [entry('two.md')]);
  assert.equal((await readFile(databasePath(directory))).subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.notEqual(databasePath(directory), databasePath(directory, rootB));
});

test('legacy order migrates once in a transaction and removal never resurrects on restart', async (t) => {
  const directory = await temp(t);
  let reads = 0;
  const old = { version: 1, entries: [entry('z.md'), { relativePath: 'folder', nodeKind: 'directory' }, entry('z.md')] };
  const legacy = async () => { reads++; return old; };
  const store = new Store(directory, legacy);
  assert.deepEqual((await snapshot(store)).entries, old.entries.slice(0, 2));
  await remove(store, 'z.md');
  await remove(store, 'folder');
  assert.deepEqual((await snapshot(new Store(directory, legacy))).entries, []);
  assert.equal(reads, 1);
  assert.equal(old.entries.length, 3);
});

test('overlapping commits are serialized, duplicate additions preserve order/revision, and missing targets are removable', async (t) => {
  const store = new Store(await temp(t), async () => null);
  const results = await Promise.all([add(store, 'one.md'), add(store, 'two.md'), remove(store, 'one.md'), add(store, 'three.md')]);
  assert.deepEqual(results.map(r => r.revision), [1, 2, 3, 4]);
  const duplicate = await add(store, 'two.md');
  assert.equal(duplicate.revision, 4);
  assert.deepEqual(duplicate.entries, [entry('two.md'), entry('three.md')]);
  assert.deepEqual(await remove(store, 'already-gone.md'), duplicate);
});

test('failed SQLite write rolls back and keeps the last committed snapshot; queue can recover', async (t) => {
  const directory = await temp(t), store = new Store(directory, async () => null);
  const before = await add(store, 'keep.md');
  const db = new DatabaseSync(databasePath(directory));
  db.exec("CREATE TRIGGER fail_bookmark BEFORE UPDATE ON bookmarks BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END");
  await assert.rejects(remove(store, 'keep.md'), /simulated disk failure/);
  assert.deepEqual(await snapshot(store), before);
  db.exec('DROP TRIGGER fail_bookmark'); db.close();
  assert.deepEqual((await remove(store, 'keep.md')).entries, []);
});

test('bad migration, invalid entries and the 1000-entry bound fail without an empty successful migration', async (t) => {
  const directory = await temp(t);
  await assert.rejects(snapshot(new Store(directory, async () => ({ version: 9, entries: [] }))));
  const full = Array.from({ length: 1000 }, (_, i) => entry(`file-${i}.md`));
  const store = new Store(directory, async () => ({ version: 1, entries: full }));
  assert.equal((await snapshot(store)).entries.length, 1000);
  await assert.rejects(add(store, 'over-limit.md'), /limit/);
  assert.equal((await snapshot(store)).entries.length, 1000);
  for (const path of ['', '../outside', '/outside']) await assert.rejects(add(store, path));
});

test('bounded local sample includes reopen/commit/close for each small bookmark mutation', async (t) => {
  const store = new Store(await temp(t), async () => null);
  const start = performance.now();
  for (let i = 0; i < 20; i++) await add(store, `sample-${i}.md`);
  const elapsed = performance.now() - start;
  assert.equal((await snapshot(store)).entries.length, 20);
  t.diagnostic(`20 temporary SQLite open/commit/close operations: ${elapsed.toFixed(1)} ms total (${(elapsed / 20).toFixed(2)} ms/op), not a live-app benchmark.`);
});

test('actual private XPC adapter and trusted preload return committed snapshots without a public storage endpoint', async (t) => {
  const directory = await temp(t), handlers = new Map(), channels = [];
  globalThis.__bookmarkXpcTest = {
    handle: (name, handler) => handlers.set(name, handler),
    send: async (name, params) => { channels.push(name); const handler = handlers.get(name); if (!handler) throw Error('No private capability'); return handler({ params }); }
  };
  t.after(() => { delete globalThis.__bookmarkXpcTest; });
  const bundled = await build({
    stdin: { contents: "export * from './src/main/miniapps/onlypreview/onlyPreviewBookmarkStorage.runtime.ts'; export { registerOnlyPreviewBookmarkStorage } from './src/preload/onlypreview/onlyPreviewBookmarkStorage.handler.ts'", resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: join(root, 'tsconfig.node.json'),
    plugins: [{ name: 'native-xpc-boundary', setup(context) {
      context.onResolve({ filter: /^electron-xpc\// }, () => ({ path: 'xpc', namespace: 'native' }));
      context.onLoad({ filter: /.*/, namespace: 'native' }, () => ({ contents: 'export const xpcMain = globalThis.__bookmarkXpcTest; export const xpcRenderer = globalThis.__bookmarkXpcTest;' }));
    } }]
  });
  const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  assert.throws(() => api.registerOnlyPreviewBookmarkStorage(async () => directory, async () => null), /capability/);
  process.argv.push(api.onlyPreviewBookmarkStorageArgument);
  t.after(() => { process.argv.splice(process.argv.indexOf(api.onlyPreviewBookmarkStorageArgument), 1); });
  let legacyReads = 0;
  api.registerOnlyPreviewBookmarkStorage(async () => directory, async () => { legacyReads++; return null; });
  const snapshot = await api.onlyPreviewBookmarkStorage.execute({ rootRealPath: rootA, action: 'add', entry: entry('via-xpc.md') });
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(snapshot.entries, [entry('via-xpc.md')]);
  await api.onlyPreviewBookmarkStorage.execute({ rootRealPath: rootA, action: 'remove', relativePath: 'via-xpc.md' });
  assert.equal(legacyReads, 1);
  assert.equal(new Set(channels).size, 1);
  assert.match(channels[0], /^onlypreview:bookmarks:[a-f0-9-]{36}$/);
  await assert.rejects(globalThis.__bookmarkXpcTest.send('onlypreview:bookmarks', { rootRealPath: '/unauthorized' }), /capability/);
});
