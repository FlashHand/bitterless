/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { readSingleWorkspaceFile } from '../../src/preload/onlypreview/search/core/traversal.mjs';
import { MAX_WATCH_CHANGE_PATHS } from '../../src/preload/onlypreview/search/core/constants.mjs';

const oldIdentity =
  'onlypreview-contentless-full-v8:short-nonascii:grouped-global-search:tolerant-extension-size';
const excludedPaths = [
  '__pycache__/policymarker.txt',
  '__pypackages__/policymarker.txt',
  'venv/policymarker.txt',
  'site-packages/policymarker.txt',
  'htmlcov/policymarker.txt',
  'vendor/policymarker.txt',
  'go-build/policymarker.txt',
  'distribution.egg-info/policymarker.txt',
  'distribution.dist-info/policymarker.txt',
  'pkg/mod/policymarker.txt',
  'nested/pkg/sumdb/policymarker.txt'
];
const sourcePaths = [
  'src/policymarker.txt',
  'pkg/local/policymarker.txt',
  'bin/policymarker.txt',
  'env/policymarker.txt',
  'mod/policymarker.txt',
  'sumdb/policymarker.txt',
  'vendorized/policymarker.txt',
  'pkg/local/mod/policymarker.txt'
];
const namedFiles = [
  'regular/vendor',
  'regular/pkg/mod',
  'regular/package.dist-info',
  'regular/package.egg-info'
];
const okPaths = [...sourcePaths, ...namedFiles];
const oldContent = 'policymarker original content';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};
const withWorkspace = async (callback) => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-exclusion-lifecycle-'));
  const rootPath = join(temp, 'workspace');
  const databasePath = join(temp, 'search.sqlite');
  try {
    await Promise.all(
      [...excludedPaths, ...okPaths].map((path) => write(join(rootPath, path), oldContent))
    );
    await callback({ rootPath: await realpath(rootPath), databasePath });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};
const request = (workspace) => ({ ...workspace, workspaceId: 'workspace', generation: 1 });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
const gatePromotion = (engine) => {
  const ready = deferred();
  const release = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    ready.resolve();
    await release.promise;
    return await promote(...args);
  };
  return { ready: ready.promise, release: release.resolve };
};
const search = (engine, requestId, query = 'policymarker', onResult) =>
  engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId,
    query,
    maxResults: 500,
    scope: { kind: 'project' },
    isCancelled: () => false,
    onResult
  });
const paths = (results) => results.map(({ relativePath }) => relativePath).sort();
const indexedPaths = (database) =>
  database
    .prepare('SELECT relative_path FROM files ORDER BY relative_path')
    .all()
    .map(({ relative_path: path }) => path);
const stopWatcher = async (engine) => {
  await engine.watchController?.close({ drain: false });
  engine.watchController = undefined;
  engine.watchRevision += 1;
};
const applyWatch = (engine, changedPaths) =>
  engine.enqueue(() =>
    engine.applyWatchChangesInternal({
      full: false,
      paths: changedPaths
    })
  );
const seedOldIndex = async (workspace) => {
  const config = await loadOnlyPreviewWorkspaceConfig(workspace.rootPath);
  const identity = {
    workspaceHash: hash(workspace.rootPath),
    configHash: config.hash,
    engineHash: hash(oldIdentity)
  };
  const entries = await Promise.all(
    [...excludedPaths, ...okPaths].map((relativePath) =>
      readSingleWorkspaceFile({ rootPath: workspace.rootPath, relativePath })
    )
  );
  assert.ok(entries.every((entry) => entry?.contentIndexed));
  const index = new OnlyPreviewSqliteIndex(workspace.databasePath);
  try {
    await index.rebuild(entries, identity);
    index.replaceTreeSnapshot(index.readTreeSnapshot().entries, false);
    assert.equal(index.isReusable(identity), true);
    assert.deepEqual(indexedPaths(index.database), [...excludedPaths, ...okPaths].sort());
    const oldSearch = await index.searchContents('policymarker', { scope: { kind: 'project' } });
    assert.ok(oldSearch.results.some(({ relativePath }) => excludedPaths.includes(relativePath)));
  } finally {
    index.close();
  }
};

test(
  'old hard-policy SQLite stays unavailable until atomic replacement, then the new identity reuses its warm snapshot',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      await seedOldIndex(workspace);
      const engine = createOnlyPreviewSearchEngine();
      const gate = gatePromotion(engine);
      let initializing;
      let searching;
      try {
        initializing = engine.initialize(request(workspace));
        await gate.ready;
        assert.notEqual(SEARCH_ENGINE_IDENTITY, oldIdentity);
        assert.equal(
          engine.index,
          undefined,
          'an old-policy database cannot be the active content index'
        );
        assert.deepEqual(engine.treeEntries, []);
        const persisted = new DatabaseSync(workspace.databasePath, { readOnly: true });
        try {
          assert.ok(
            indexedPaths(persisted).includes('vendor/policymarker.txt'),
            'the old DB stays intact until atomic promotion'
          );
        } finally {
          persisted.close();
        }
        const streamed = [];
        let settled = false;
        searching = search(engine, 'policy-upgrade', 'policymarker', (result) =>
          streamed.push(result)
        ).finally(() => {
          settled = true;
        });
        for (let turn = 0; turn < 5; turn += 1) await tick();
        assert.equal(settled, false);
        assert.deepEqual(
          streamed,
          [],
          'neither old rows nor the private candidate may stream before promotion'
        );
        gate.release();
        await initializing;
        const response = await searching;
        assert.deepEqual(paths(response.contents), [...okPaths].sort());
        assert.ok(
          [...response.files, ...response.contents, ...streamed].every(
            (result) => !excludedPaths.includes(result.relativePath)
          )
        );
        assert.deepEqual(indexedPaths(engine.index.database), [...okPaths].sort());
        assert.equal(engine.index.isReusable(engine.identity), true);
        assert.equal(engine.index.statistics().buildState.engineHash, hash(SEARCH_ENGINE_IDENTITY));
        await stopWatcher(engine);
        engine.index.database.exec(`
        CREATE TRIGGER stable_policy_file_insert BEFORE INSERT ON files
        WHEN NEW.relative_path = 'src/policymarker.txt'
        BEGIN SELECT RAISE(ABORT, 'stable content was reinserted'); END;
        CREATE TRIGGER stable_policy_file_update BEFORE UPDATE ON files
        WHEN OLD.relative_path = 'src/policymarker.txt'
        BEGIN SELECT RAISE(ABORT, 'stable content was reread'); END;
      `);
      } finally {
        gate.release();
        await Promise.allSettled([initializing, searching].filter(Boolean));
        await engine.shutdown();
      }

      const warm = createOnlyPreviewSearchEngine();
      const warmGate = gatePromotion(warm);
      let reopening;
      let warmSearch;
      try {
        reopening = warm.initialize(request(workspace));
        await warmGate.ready;
        assert.ok(warm.index);
        assert.equal(warm.index.isReusable(warm.identity), true);
        assert.equal(warm.treeMetadataReady, true);
        const firstFiles = deferred();
        const firstContents = deferred();
        const early = [];
        warmSearch = search(warm, 'warm-policy', 'policymarker', (result) => {
          early.push(result);
          if (result.section === 'files') firstFiles.resolve();
          if (result.section === 'contents') firstContents.resolve();
        });
        await Promise.all([firstFiles.promise, firstContents.promise]);
        assert.ok(early.every(({ relativePath }) => !excludedPaths.includes(relativePath)));
        warmGate.release();
        await reopening;
        assert.deepEqual(paths((await warmSearch).contents), [...okPaths].sort());
        assert.deepEqual(indexedPaths(warm.index.database), [...okPaths].sort());
      } finally {
        warmGate.release();
        await Promise.allSettled([reopening, warmSearch].filter(Boolean));
        await warm.shutdown();
      }
    });
  }
);

test(
  'new hard-exclusion watch bursts do not read bodies or trigger a full rebuild, while source paths still update',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const reads = [];
      const commits = [];
      const engine = createOnlyPreviewSearchEngine({
        readWorkspaceFile: async (params) => {
          reads.push(params.relativePath);
          return await readSingleWorkspaceFile(params);
        },
        onWatchCommit: (commit) => commits.push(commit)
      });
      try {
        await engine.initialize(request(workspace));
        await stopWatcher(engine);
        await Promise.all(
          [...excludedPaths, ...sourcePaths].map((path) =>
            write(join(workspace.rootPath, path), 'updated watchmarker content')
          )
        );
        const excludedBurst = Array.from(
          { length: MAX_WATCH_CHANGE_PATHS + 40 },
          (_, index) =>
            `${dirname(excludedPaths[index % excludedPaths.length])}/generated-${index}.txt`
        );
        await applyWatch(engine, [...excludedPaths, ...sourcePaths, ...excludedBurst]);
        assert.deepEqual(reads.sort(), [...sourcePaths].sort());
        assert.ok(commits.length > 0);
        assert.ok(commits.every(({ full }) => full === false));
        assert.deepEqual(
          paths((await search(engine, 'watch-updated', 'updated watchmarker')).contents),
          [...sourcePaths].sort()
        );
        assert.deepEqual(indexedPaths(engine.index.database), [...okPaths].sort());
        for (const path of excludedPaths) {
          assert.ok(
            !engine.treeEntries.some(
              ({ relativePath }) => relativePath === path || relativePath === dirname(path)
            )
          );
        }
      } finally {
        await engine.shutdown();
      }
    });
  }
);

test(
  'similarly named regular files remain indexed when watcher changes their contents',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const reads = [];
      const engine = createOnlyPreviewSearchEngine({
        readWorkspaceFile: async (params) => {
          reads.push(params.relativePath);
          return await readSingleWorkspaceFile(params);
        }
      });
      try {
        await engine.initialize(request(workspace));
        await stopWatcher(engine);
        await Promise.all(
          namedFiles.map((path) =>
            write(join(workspace.rootPath, path), 'namedfilemarker changed content')
          )
        );
        await applyWatch(engine, namedFiles);
        assert.deepEqual(
          reads.sort(),
          [...namedFiles].sort(),
          'directory-only rules must not discard identically named file events'
        );
        assert.deepEqual(
          paths((await search(engine, 'named-file-watch', 'namedfilemarker')).contents),
          [...namedFiles].sort()
        );
      } finally {
        await engine.shutdown();
      }
    });
  }
);

test(
  'search-result preview admits regular vendor, pkg/mod and package-metadata leaf files',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const engine = createOnlyPreviewSearchEngine();
      try {
        await engine.initialize(request(workspace));
        const response = await search(engine, 'named-file-preview');
        const failures = [];
        for (const relativePath of namedFiles) {
          const result = response.contents.find((entry) => entry.relativePath === relativePath);
          assert.ok(result);
          try {
            const preview = await engine.preview({
              workspaceId: 'workspace',
              generation: 1,
              requestId: 'named-file-preview',
              resultToken: result.resultToken,
              isCancelled: () => false
            });
            assert.equal(preview.kind, 'text');
            assert.ok(preview.text.includes(oldContent));
          } catch (error) {
            failures.push({ relativePath, message: error.message });
          }
        }
        assert.deepEqual(
          failures,
          [],
          'the actual result-authority preview must use the leaf node kind'
        );
      } finally {
        await engine.shutdown();
      }
    });
  }
);

test(
  'selected-file priority skips new exclusions before body reads but still admits an identically named regular file',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const reads = [];
      const engine = createOnlyPreviewSearchEngine({
        readWorkspaceFile: async (params) => {
          reads.push(params.relativePath);
          return await readSingleWorkspaceFile(params);
        }
      });
      const gate = gatePromotion(engine);
      let initializing;
      try {
        initializing = engine.initialize(request(workspace));
        await gate.ready;
        for (const relativePath of excludedPaths) {
          const priority = engine.supersedePriority({
            workspaceId: 'workspace',
            generation: 1,
            relativePath
          });
          if (priority) await engine.prioritizeFile(priority);
          assert.equal(engine.selectedFilePriority.lane, undefined, relativePath);
        }
        assert.deepEqual(reads, []);
        const relativePath = 'regular/vendor';
        const priority = engine.supersedePriority({
          workspaceId: 'workspace',
          generation: 1,
          relativePath
        });
        assert.ok(priority);
        await engine.prioritizeFile(priority);
        assert.deepEqual(reads, [relativePath]);
        assert.equal(engine.selectedFilePriority.lane.relativePath, relativePath);
        const direct = await readSingleWorkspaceFile({
          rootPath: workspace.rootPath,
          relativePath: 'vendor/policymarker.txt'
        });
        assert.equal(
          direct.originalContent,
          oldContent,
          'index exclusion does not prohibit explicit file reading'
        );
      } finally {
        gate.release();
        await Promise.allSettled([initializing].filter(Boolean));
        await engine.shutdown();
      }
    });
  }
);

test(
  'Project browsing preserves excluded directories and inherits orange markers through descendants and watch updates',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const listings = [];
      const engine = createOnlyPreviewSearchEngine({
        onBrowseListing: (listing) => listings.push(listing)
      });
      try {
        await engine.initialize(request(workspace));
        await stopWatcher(engine);
        const root = listings.find(({ relativePath }) => relativePath === '');
        assert.ok(root);
        const readDirectory = async (entry) =>
          engine.browseDirectory({
            workspaceId: 'workspace',
            generation: 1,
            directoryToken: entry.directoryToken
          });
        for (const relativePath of excludedPaths) {
          let current = root;
          let inherited = false;
          const parts = relativePath.split('/');
          for (let index = 0; index < parts.length; index += 1) {
            const entry = current.entries.find(({ name }) => name === parts[index]);
            assert.ok(entry, relativePath);
            if (inherited || index >= parts.length - 2)
              assert.equal(entry.searchExcluded, true, entry.relativePath);
            inherited ||= entry.searchExcluded;
            if (index < parts.length - 1) current = await readDirectory(entry);
          }
        }
        const regular = await readDirectory(root.entries.find(({ name }) => name === 'regular'));
        assert.ok(regular.entries.every(({ searchExcluded }) => searchExcluded === false));
        const regularPkg = await readDirectory(regular.entries.find(({ name }) => name === 'pkg'));
        assert.equal(regularPkg.entries.find(({ name }) => name === 'mod').searchExcluded, false);
        listings.length = 0;
        await write(join(workspace.rootPath, 'vendor/new.txt'), 'new browse only content');
        await applyWatch(engine, ['vendor/new.txt']);
        const updated = listings.find(({ relativePath }) => relativePath === 'vendor');
        assert.ok(
          updated?.entries.some(({ name, searchExcluded }) => name === 'new.txt' && searchExcluded)
        );
        assert.equal(engine.index.metadata('vendor/new.txt'), undefined);
      } finally {
        await engine.shutdown();
      }
    });
  }
);
