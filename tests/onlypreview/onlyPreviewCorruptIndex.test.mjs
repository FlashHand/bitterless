/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { OnlyPreviewSqliteIndex } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

const sampleFiles = {
  'network/network.md': '# network\nA small searchable recovery fixture.\n',
  'unchanged.txt': 'Keep this project file unchanged.\n'
};
const header = Buffer.from('SQLite format 3\0');

const withFixture = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), 'onlypreview-corrupt-index-'));
  const rootPath = join(directory, 'workspace');
  const databasePath = join(directory, 'cache', 'search.sqlite');
  const engines = [];
  try {
    for (const [relativePath, content] of Object.entries(sampleFiles)) {
      const path = join(rootPath, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    await mkdir(dirname(databasePath), { recursive: true });
    const create = () => {
      const logs = [];
      const snapshots = [];
      const engine = createOnlyPreviewSearchEngine({
        watchFactory: () => ({ on: () => undefined, close: () => undefined }),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        diagnostics: createOnlyPreviewSearchDiagnostics({ write: (line) => logs.push(line) })
      });
      engines.push(engine);
      const identity = { workspaceId: 'fixture-project', generation: engines.length };
      return {
        engine,
        logs,
        snapshots,
        initialize: () => engine.initialize({ ...identity, rootPath, databasePath }),
        search: (requestId = 'recovered-search') =>
          engine.search({
            ...identity,
            requestId,
            query: 'network',
            maxResults: 20,
            scope: { kind: 'project' }
          })
      };
    };
    const quarantinePaths = async () =>
      (await readdir(dirname(databasePath)))
        .filter((name) => name.startsWith(`${basename(databasePath)}.quarantine-`))
        .map((name) => join(dirname(databasePath), name))
        .sort();
    await run({ create, databasePath, quarantinePaths });
    for (const [relativePath, content] of Object.entries(sampleFiles)) {
      assert.equal(await readFile(join(rootPath, relativePath), 'utf8'), content);
    }
  } finally {
    for (const engine of engines) await engine.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
};

const assertSearchable = async (runtime) => {
  assert.equal(runtime.engine.state, 'ready');
  assert.equal(runtime.snapshots.at(-1).state, 'ready');
  const result = await runtime.search();
  assert.deepEqual(
    result.files.map(({ relativePath, nodeKind }) => [relativePath, nodeKind]),
    [
      ['network', 'directory'],
      ['network/network.md', 'file']
    ]
  );
  assert.deepEqual(
    result.contents.map(({ relativePath }) => relativePath),
    ['network/network.md']
  );
  assert.ok(
    runtime.logs.some(
      (line) => line.includes('event=initialize-terminal') && line.includes('outcome=success')
    )
  );
  assert.equal(
    runtime.logs.some((line) => line.includes('event=initialize-failure')),
    false
  );
};

const assertQuarantined = async (fixture, original) => {
  const quarantines = await fixture.quarantinePaths();
  assert.equal(quarantines.length, 1, 'a corrupt open is quarantined exactly once');
  assert.deepEqual(
    await readFile(join(quarantines[0], basename(fixture.databasePath))),
    original,
    'the original damaged database remains recoverable, byte for byte'
  );
  const replacement = await readFile(fixture.databasePath);
  assert.deepEqual(replacement.subarray(0, header.length), header);
  return quarantines;
};

test('a real malformed database header is quarantined once and initialization rebuilds searchable data', async () => {
  await withFixture(async (fixture) => {
    const malformed = Buffer.alloc(4096, 0x5a);
    await writeFile(fixture.databasePath, malformed);
    assert.throws(
      () => new OnlyPreviewSqliteIndex(fixture.databasePath),
      (error) => (error.errcode & 0xff) === 26
    );
    const runtime = fixture.create();
    await runtime.initialize();
    await assertSearchable(runtime);
    assert.equal(
      runtime.logs.filter(
        (line) => line.includes('event=sqlite-recovery') && line.includes('sqliteCode=26')
      ).length,
      1
    );
    const quarantines = await assertQuarantined(fixture, malformed);
    await runtime.engine.shutdown();

    const warm = fixture.create();
    await warm.initialize();
    await assertSearchable(warm);
    assert.deepEqual(
      await fixture.quarantinePaths(),
      quarantines,
      'healthy reopen does not add another quarantine'
    );
    assert.ok(
      warm.logs.some((line) => line.includes('event=sqlite-open') && line.includes('reusable=true'))
    );
    assert.equal(
      warm.logs.some((line) => line.includes('event=sqlite-recovery')),
      false
    );
  });
});

test('a valid-header database with a damaged search_tree page recovers after warm metadata restoration fails', async () => {
  await withFixture(async (fixture) => {
    const seeded = fixture.create();
    await seeded.initialize();
    const identity = { ...seeded.engine.identity };
    await seeded.engine.shutdown();
    const database = new DatabaseSync(fixture.databasePath);
    let rootPage;
    let pageSize;
    try {
      rootPage = Number(
        database.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'search_tree'").get()
          .rootpage
      );
      pageSize = Number(database.prepare('PRAGMA page_size').get().page_size);
    } finally {
      database.close();
    }
    assert.ok(rootPage > 1 && pageSize >= 512);
    const file = await open(fixture.databasePath, 'r+');
    try {
      await file.write(Buffer.from([0xff]), 0, 1, (rootPage - 1) * pageSize);
    } finally {
      await file.close();
    }
    const damaged = await readFile(fixture.databasePath);
    assert.deepEqual(
      damaged.subarray(0, header.length),
      header,
      'the SQLite file header remains valid'
    );
    const readable = new OnlyPreviewSqliteIndex(fixture.databasePath);
    try {
      assert.equal(
        readable.isReusable(identity),
        true,
        'identity and content tables are still reusable'
      );
      assert.equal(readable.database.prepare('SELECT COUNT(*) AS count FROM files').get().count, 2);
      assert.throws(
        () => readable.readTreeSnapshot(),
        (error) => (error.errcode & 0xff) === 11
      );
    } finally {
      readable.close();
    }

    const runtime = fixture.create();
    await runtime.initialize();
    await assertSearchable(runtime);
    const opens = runtime.logs.filter((line) => line.includes('event=sqlite-open'));
    assert.equal(opens.length, 2);
    assert.match(opens[0], /reusable=true/);
    assert.match(opens[1], /reusable=false/);
    assert.equal(
      runtime.logs.filter(
        (line) => line.includes('event=sqlite-recovery') && line.includes('sqliteCode=11')
      ).length,
      1
    );
    await assertQuarantined(fixture, damaged);
  });
});

test('a healthy persisted index retains its warm reconcile path with no quarantine', async () => {
  await withFixture(async (fixture) => {
    const seeded = fixture.create();
    await seeded.initialize();
    await assertSearchable(seeded);
    await seeded.engine.shutdown();
    const warm = fixture.create();
    await warm.initialize();
    await assertSearchable(warm);
    assert.deepEqual(await fixture.quarantinePaths(), []);
    const opens = warm.logs.filter((line) => line.includes('event=sqlite-open'));
    assert.equal(opens.length, 1);
    assert.match(opens[0], /reusable=true reconcile=true/);
    assert.ok(
      warm.logs.some(
        (line) => line.includes('event=candidate-backup') && line.includes('mode=backup')
      )
    );
    assert.ok(
      warm.logs.some(
        (line) => line.includes('event=traversal-index') && line.includes('mode=reconcile')
      )
    );
    assert.equal(
      warm.logs.some((line) => line.includes('event=sqlite-recovery')),
      false
    );
  });
});
