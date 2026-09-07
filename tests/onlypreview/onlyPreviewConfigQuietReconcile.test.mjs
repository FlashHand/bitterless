/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  loadOnlyPreviewWorkspaceConfig,
  WORKSPACE_CONFIG_RELATIVE_PATH
} from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const quietMs = 60_000;
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const configSource = (name) => `version: 1\nexclude:\n  - ${name}/**\n`;
const write = async (path, text) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
};
const createClock = () => {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    advance(milliseconds) {
      const target = time + milliseconds;
      let fired = 0;
      while (true) {
        const due = [...timers]
          .filter(([, timer]) => timer.due <= target)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!due) break;
        assert.ok(++fired < 100, 'config timers must not spin without another edit');
        timers.delete(due[0]);
        time = due[1].due;
        due[1].callback();
      }
      time = target;
    },
    pending: () => timers.size
  };
};
const withWorkspace = async (callback) => {
  const temporary = await mkdtemp(join(tmpdir(), 'onlypreview-quiet-config-'));
  const rootPath = join(temporary, 'workspace');
  const databasePath = join(temporary, 'search.sqlite');
  try {
    for (const name of ['a', 'b', 'c', 'd', 'vendor']) {
      await write(join(rootPath, name, 'needle.txt'), `configneedle ${name} original`);
    }
    await write(join(rootPath, WORKSPACE_CONFIG_RELATIVE_PATH), configSource('a'));
    await callback({ rootPath: await realpath(rootPath), databasePath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};
const createHarness = (workspace, { captureConfigError = true } = {}) => {
  const clock = createClock();
  const errors = [];
  const diagnostics = [];
  const reads = [];
  const adjustments = [];
  const watchers = [];
  let readOverride;
  let activeAdjustments = 0;
  let maxActiveAdjustments = 0;
  let diagnosticId = 0;
  const engine = createOnlyPreviewSearchEngine({
    configClock: clock,
    readWorkspaceConfig: async (rootPath) => {
      reads.push(rootPath);
      return await (readOverride ?? loadOnlyPreviewWorkspaceConfig)(rootPath);
    },
    onConfigError: captureConfigError ? (error) => errors.push(error) : undefined,
    diagnostics: {
      now: clock.now,
      elapsed: (started) => clock.now() - started,
      nextTag: (prefix) => `${prefix}${++diagnosticId}`,
      emit: (event, fields) => {
        diagnostics.push({ event, ...fields });
        return true;
      }
    },
    watchFactory: (_root, _options, listener) => {
      const watcher = new EventEmitter();
      watcher.listener = listener;
      watcher.closed = false;
      watcher.close = () => {
        watcher.closed = true;
      };
      watchers.push(watcher);
      return watcher;
    }
  });
  const refresh = engine.refreshInternal.bind(engine);
  engine.refreshInternal = async (...args) => {
    activeAdjustments += 1;
    maxActiveAdjustments = Math.max(maxActiveAdjustments, activeAdjustments);
    const nextConfig = args[0] ?? engine.config;
    adjustments.push([...nextConfig.exclude]);
    try {
      return await refresh(...args);
    } finally {
      activeAdjustments -= 1;
    }
  };
  const drain = async () => {
    await tick();
    await engine.operationTail;
    await tick();
    await engine.operationTail;
  };
  const raw = (...args) => {
    const filename = args.length ? args[0] : WORKSPACE_CONFIG_RELATIVE_PATH;
    const event = args[1] ?? 'change';
    const watcher = watchers.at(-1);
    assert.ok(watcher && !watcher.closed, 'a live raw watch subscription is required');
    watcher.listener(event, filename);
  };
  const edit = async (name, { filename = WORKSPACE_CONFIG_RELATIVE_PATH, atomic = false } = {}) => {
    const path = join(workspace.rootPath, WORKSPACE_CONFIG_RELATIVE_PATH);
    if (atomic) {
      await write(`${path}.save`, configSource(name));
      await rename(`${path}.save`, path);
    } else {
      await write(path, configSource(name));
    }
    raw(filename, atomic ? 'rename' : 'change');
  };
  return {
    engine,
    clock,
    errors,
    diagnostics,
    reads,
    adjustments,
    watchers,
    drain,
    raw,
    edit,
    setReader: (reader) => {
      readOverride = reader;
    },
    maxActive: () => maxActiveAdjustments,
    initialize: () => engine.initialize({ ...workspace, workspaceId: 'workspace', generation: 1 }),
    advance: async (milliseconds) => {
      clock.advance(milliseconds);
      await drain();
    }
  };
};
const indexed = (engine) =>
  engine.index.database
    .prepare('SELECT relative_path FROM files ORDER BY relative_path')
    .all()
    .map(({ relative_path: path }) => path);
const expectPolicy = (engine, excluded) => {
  assert.deepEqual([...engine.config.exclude], excluded ? [`${excluded}/**`] : []);
  assert.deepEqual(
    indexed(engine),
    ['a', 'b', 'c', 'd'].filter((name) => name !== excluded).map((name) => `${name}/needle.txt`)
  );
  assert.equal(
    engine.index.metadata('vendor/needle.txt'),
    undefined,
    '147 hard exclusions remain applied'
  );
};
const blockNextPromotion = (engine) => {
  const entered = deferred();
  const released = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  let gated = false;
  engine.promoteCandidate = async (...args) => {
    if (!gated) {
      gated = true;
      entered.resolve();
      await released.promise;
    }
    return await promote(...args);
  };
  return { entered: entered.promise, release: released.resolve };
};

test(
  'raw config edits use a resetting 60-second edge while ordinary refresh and full watch retain applied policy',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const h = createHarness(workspace);
      try {
        await h.initialize();
        expectPolicy(h.engine, 'a');
        const initialReads = h.reads.length;
        await h.edit('b');
        await h.advance(59_999);
        expectPolicy(h.engine, 'a');
        assert.equal(h.reads.length, initialReads, 'no config parse before quiet deadline');
        await h.edit('c', { filename: '.bitterless', atomic: true });
        await h.advance(59_999);
        expectPolicy(h.engine, 'a');
        await write(join(workspace.rootPath, 'd/needle.txt'), 'updated ordinary content');
        h.raw('d/needle.txt');
        await h.engine.watchController.flushNow();
        assert.equal(
          h.engine.index.metadata('d/needle.txt').size,
          Buffer.byteLength('updated ordinary content')
        );
        expectPolicy(h.engine, 'a');
        await h.engine.refresh({ workspaceId: 'workspace', generation: 1 });
        await h.engine.enqueue(() => h.engine.applyWatchChangesInternal({ full: true, paths: [] }));
        expectPolicy(h.engine, 'a');
        assert.equal(
          h.reads.length,
          initialReads,
          'ordinary refresh and fallback must not read unsettled config'
        );
        const beforeApply = h.adjustments.length;
        await h.advance(1);
        expectPolicy(h.engine, 'c');
        assert.equal(h.adjustments.length, beforeApply + 1);
        await h.advance(quietMs * 2);
        assert.equal(
          h.adjustments.length,
          beforeApply + 1,
          'one settled edit causes one adjustment'
        );
      } finally {
        await h.engine.shutdown();
      }
    });
  }
);

test(
  'an expired config timer queued behind work rechecks revision and the newest quiet deadline before reading',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const h = createHarness(workspace);
      const blocker = deferred();
      let held;
      try {
        await h.initialize();
        const reads = h.reads.length;
        held = h.engine.enqueue(() => blocker.promise);
        await h.edit('b');
        h.clock.advance(quietMs);
        await tick();
        h.clock.advance(1000);
        await h.edit('c');
        blocker.resolve();
        await held;
        await h.drain();
        expectPolicy(h.engine, 'a');
        assert.equal(h.reads.length, reads);
        assert.equal(h.adjustments.length, 0);
        await h.advance(quietMs - 1);
        expectPolicy(h.engine, 'a');
        await h.advance(1);
        expectPolicy(h.engine, 'c');
        assert.deepEqual(h.adjustments, [['c/**']]);
      } finally {
        blocker.resolve();
        await held;
        await h.engine.shutdown();
      }
    });
  }
);

test(
  'an edit during asynchronous config loading invalidates the loaded older policy',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const h = createHarness(workspace);
      const entered = deferred();
      const release = deferred();
      try {
        await h.initialize();
        h.setReader(async (rootPath) => {
          const loaded = await loadOnlyPreviewWorkspaceConfig(rootPath);
          entered.resolve();
          await release.promise;
          return loaded;
        });
        await h.edit('b');
        h.clock.advance(quietMs);
        await entered.promise;
        h.clock.advance(1000);
        await h.edit('c');
        h.setReader(undefined);
        release.resolve();
        await h.drain();
        expectPolicy(h.engine, 'a');
        assert.equal(h.adjustments.length, 0);
        await h.advance(quietMs - 1);
        expectPolicy(h.engine, 'a');
        await h.advance(1);
        expectPolicy(h.engine, 'c');
        assert.deepEqual(h.adjustments, [['c/**']]);
      } finally {
        release.resolve();
        await h.engine.shutdown();
      }
    });
  }
);

test(
  'edits during an active candidate preserve its safe commit and coalesce only the latest next adjustment',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const h = createHarness(workspace);
      let gate;
      try {
        await h.initialize();
        gate = blockNextPromotion(h.engine);
        await h.edit('b');
        h.clock.advance(quietMs);
        await gate.entered;
        const oldCommittedPaths = indexed(h.engine);
        assert.ok(oldCommittedPaths.includes('b/needle.txt'));
        h.clock.advance(1000);
        await h.edit('c');
        h.clock.advance(1000);
        await h.edit('d');
        h.clock.advance(quietMs);
        await tick();
        assert.deepEqual(
          h.adjustments,
          [['b/**']],
          'no second writer while first promotion is gated'
        );
        assert.equal(h.maxActive(), 1);
        gate.release();
        await h.drain();
        await h.advance(0);
        expectPolicy(h.engine, 'd');
        assert.deepEqual(h.adjustments, [['b/**'], ['d/**']]);
        assert.equal(h.maxActive(), 1);
        assert.equal(h.errors.length, 0);
      } finally {
        gate?.release();
        await h.engine.shutdown();
      }
    });
  }
);

test(
  'semantic no-op skips reconciliation, invalid edits preserve the live index once, and valid edits or deletion recover',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const h = createHarness(workspace);
      const path = join(workspace.rootPath, WORKSPACE_CONFIG_RELATIVE_PATH);
      try {
        await h.initialize();
        const identity = h.engine.activeIdentity;
        const originalIndex = h.engine.index;
        await write(path, '# comment only\nexclude: ["a/**"]\nversion: 1\n');
        h.raw();
        await h.advance(quietMs);
        expectPolicy(h.engine, 'a');
        assert.equal(h.engine.index, originalIndex);
        assert.equal(h.engine.activeIdentity, identity);
        assert.equal(h.adjustments.length, 0);
        await write(path, 'version: 1\nexclude: [123]\n');
        h.raw();
        await h.advance(quietMs);
        expectPolicy(h.engine, 'a');
        assert.equal(h.engine.index, originalIndex);
        assert.equal(h.errors.length, 1);
        assert.ok(h.errors[0] instanceof TypeError);
        await h.advance(quietMs * 3);
        assert.equal(h.errors.length, 1, 'invalid config cannot start a retry loop');
        assert.equal(h.adjustments.length, 0);
        await h.edit('b');
        await h.advance(quietMs);
        expectPolicy(h.engine, 'b');
        await unlink(path);
        h.raw('.bitterless', 'rename');
        await h.advance(quietMs - 1);
        expectPolicy(h.engine, 'b');
        await h.advance(1);
        expectPolicy(h.engine, undefined);
        assert.deepEqual(h.adjustments, [['b/**'], []]);
      } finally {
        await h.engine.shutdown();
      }
    });
  }
);

test(
  'the default invalid-config handler emits one fixed warning without the rejected payload or workspace path',
  { timeout: 15000 },
  async (context) => {
    const warning = context.mock.method(console, 'warn', () => undefined);
    await withWorkspace(async (workspace) => {
      const h = createHarness(workspace, { captureConfigError: false });
      try {
        await h.initialize();
        await write(
          join(workspace.rootPath, WORKSPACE_CONFIG_RELATIVE_PATH),
          'version: 1\nexclude: [invalidPayloadMarker: bad]\n'
        );
        h.raw();
        await h.advance(quietMs);
        expectPolicy(h.engine, 'a');
        assert.equal(warning.mock.callCount(), 1);
        const args = warning.mock.calls[0].arguments;
        assert.deepEqual(args, [
          '[onlypreview-search] Workspace configuration could not be applied; keeping the previous policy.'
        ]);
        assert.ok(!args[0].includes('invalidPayloadMarker'));
        assert.ok(!args[0].includes(workspace.rootPath));
        await h.advance(quietMs * 2);
        assert.equal(warning.mock.callCount(), 1);
      } finally {
        await h.engine.shutdown();
      }
    });
  }
);

test(
  'unknown watch names probe actual config changes without postponing an unchanged pending signature',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const h = createHarness(workspace);
      const path = join(workspace.rootPath, WORKSPACE_CONFIG_RELATIVE_PATH);
      try {
        await h.initialize();
        h.raw(null);
        h.raw(undefined);
        await h.engine.configReconciler.probe();
        await h.drain();
        assert.equal(h.clock.pending(), 0, 'unrelated fallback events do not invent config work');
        await write(path, configSource('b'));
        h.raw(null, 'rename');
        await h.engine.configReconciler.probe();
        await h.drain();
        assert.ok(h.clock.pending() > 0);
        await h.advance(quietMs - 1);
        expectPolicy(h.engine, 'a');
        h.raw(null);
        h.raw(undefined);
        await h.engine.configReconciler.probe();
        await h.drain();
        await h.advance(1);
        expectPolicy(h.engine, 'b');
        assert.deepEqual(
          h.adjustments,
          [['b/**']],
          'same-signature unknown events cannot extend the quiet period'
        );
      } finally {
        await h.engine.shutdown();
      }
    });
  }
);

test(
  'closing before the quiet edge disposes timers and reopening adopts disk config immediately, then reuses it warm',
  { timeout: 15000 },
  async () => {
    await withWorkspace(async (workspace) => {
      const first = createHarness(workspace);
      try {
        await first.initialize();
        await first.edit('b');
        assert.ok(first.clock.pending() > 0);
        await first.engine.shutdown();
        assert.equal(first.clock.pending(), 0);
        assert.ok(first.watchers.every(({ closed }) => closed));
        first.clock.advance(quietMs * 2);
        await first.drain();
        assert.equal(first.adjustments.length, 0);
        assert.equal(first.engine.index, undefined);
      } finally {
        await first.engine.shutdown();
      }
      const reopened = createHarness(workspace);
      try {
        await reopened.initialize();
        expectPolicy(reopened.engine, 'b');
        assert.equal(reopened.clock.now(), 0, 'startup does not wait another minute');
        assert.ok(
          reopened.diagnostics.some(
            ({ event, reusable }) => event === 'sqlite-open' && reusable === false
          )
        );
        assert.ok(reopened.reads.length > 0);
      } finally {
        await reopened.engine.shutdown();
      }
      const warm = createHarness(workspace);
      try {
        await warm.initialize();
        expectPolicy(warm.engine, 'b');
        assert.ok(
          warm.diagnostics.some(
            ({ event, reusable }) => event === 'sqlite-open' && reusable === true
          )
        );
        assert.ok(
          warm.diagnostics.some(
            ({ event, mode }) => event === 'traversal-index' && mode === 'reconcile'
          )
        );
        assert.equal(warm.clock.pending(), 0);
      } finally {
        await warm.engine.shutdown();
      }
    });
  }
);
