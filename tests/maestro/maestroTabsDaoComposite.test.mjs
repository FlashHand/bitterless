/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * Composite mini-app tabs survive a restart — against the REAL schema, not a paraphrase of it.
 *
 * The bug this pins is a quiet one. `replaceAll` drops any row whose URL is empty, one line before
 * the insert, and a composite tab is born with `url: ''`. So relaxing the renderer's filter and
 * widening the columns is not enough: without the DAO's own gate opening too, every Zellij tab is
 * discarded inside the transaction and the strip comes back short with nothing logged.
 *
 * It also pins the lockstep the release gate cares about: `CREATE_TABS` covers a fresh install and
 * the registered migration covers an upgrade, and a schema that has only one of the two is broken
 * for exactly half of the installs.
 */
const root = resolve(import.meta.dirname, '../..');
const directory = mkdtempSync(join(tmpdir(), 'maestro-tabs-dao-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

/**
 * `node:sqlite` has no `db.transaction(fn)`; better-sqlite3 does, and the DAO uses it. Wrap rather
 * than rewrite the DAO for testability — the point is to exercise the shipping code path.
 */
const adapt = (db) => ({
  prepare: (sql) => db.prepare(sql),
  exec: (sql) => db.exec(sql),
  transaction: (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
});

let current = null;
const mocks = {
  'electron-xpc/preload': 'export class XpcPreloadHandler {}',
  './sqliteManager': 'export const sqliteManager = { get db() { return globalThis.__tabsDb } };'
};

const bundled = await build({
  stdin: {
    contents: `
      export { TabsDao } from './src/preload/maestro/sqlite/tabs.dao.ts';
      export { createMaestroSqliteSchema, maestroSqliteMigrations }
        from './src/preload/maestro/sqlite/maestroSqlite.release.ts';
    `,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'tabs-dao-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'tabs-dao' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'tabs-dao' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const { TabsDao, createMaestroSqliteSchema, maestroSqliteMigrations } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

let dbSeq = 0;
const freshSchema = () => {
  const db = new DatabaseSync(join(directory, `fresh-${++dbSeq}.db`));
  createMaestroSqliteSchema(adapt(db));
  current = adapt(db);
  globalThis.__tabsDb = current;
  return new TabsDao();
};

const zellijRow = (instanceId, position) => ({
  url: '',
  title: 'Zellij',
  favicon: '',
  position,
  kind: 'zellij',
  instanceId
});

test('a composite tab round-trips through the real schema, empty URL and all', async () => {
  const dao = freshSchema();
  await dao.replaceAll({
    tabs: [
      zellijRow('deadbeef0001', 0),
      { url: 'https://example.invalid/docs', title: 'Docs', favicon: 'f', position: 1 },
      zellijRow('deadbeef0002', 2)
    ]
  });
  const saved = await dao.listAll();
  assert.deepEqual(saved, [
    { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0001' },
    { url: 'https://example.invalid/docs', title: 'Docs', favicon: 'f', position: 1 },
    { url: '', title: 'Zellij', favicon: '', position: 2, kind: 'zellij', instanceId: 'deadbeef0002' }
  ]);
});

test('a row with neither URL nor kind is still dropped — the gate narrowed, it did not open', async () => {
  const dao = freshSchema();
  await dao.replaceAll({
    tabs: [
      { url: '   ', title: 'blank new tab', favicon: '', position: 0 },
      zellijRow('deadbeef0003', 1)
    ]
  });
  const saved = await dao.listAll();
  assert.deepEqual(
    saved.map((t) => t.instanceId ?? t.url),
    ['deadbeef0003'],
    'a blank New Tab must not be resurrected on the next launch'
  );
});

test('an EXISTING database reaches the same shape through the registered migration', async () => {
  // The half that fresh installs can never catch: an upgrader arrives with the pre-composite table.
  const db = new DatabaseSync(join(directory, 'legacy.db'));
  db.exec(`
    CREATE TABLE tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favicon TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(
    "INSERT INTO tabs (url, title, favicon, position, updated_at) VALUES ('https://example.invalid/a','A','',0,1)"
  );
  current = adapt(db);
  globalThis.__tabsDb = current;

  const migration = maestroSqliteMigrations.at(-1);
  assert.equal(migration.versionCode, '260911140000', 'the composite-tab migration is the newest');
  migration.runner(current);
  // Idempotent, because an older release used incompatible width and corrected entries replay.
  migration.runner(current);

  const dao = new TabsDao();
  assert.deepEqual(await dao.listAll(), [
    { url: 'https://example.invalid/a', title: 'A', favicon: '', position: 0 }
  ]);
  await dao.replaceAll({ tabs: [zellijRow('deadbeef0004', 0)] });
  assert.deepEqual(await dao.listAll(), [
    { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0004' }
  ]);
});
