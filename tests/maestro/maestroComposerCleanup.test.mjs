/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const greeting = 'Hi — how can I help you today?';
const mocks = {
  inversify: `
    export const injectable = () => (target) => target;
    export const inject = () => () => undefined;
  `,
  'gpt-tokenizer': 'export const countTokens = (text) => Math.ceil(text.length / 4);',
  '@maestro-shared/iocHelper/ioc.helper': `
    export const iocHelper = {
      bind: ({ controller, services }) => new controller(new services[0]())
    };
  `,
  './turn.service': `
    export class TurnService {
      setState(state) { this.state = state; }
      async send(...args) {
        globalThis.__maestroComposerFixture.sent.push(args);
        return globalThis.__maestroComposerFixture.reply;
      }
      async stop(sessionId) { globalThis.__maestroComposerFixture.stopped.push(sessionId); }
    }
  `,
  'electron-xpc/renderer': `
    export const createXpcRendererEmitter = (handler) => new Proxy({}, {
      get: (_target, method) => async (params) => {
        const fixture = globalThis.__maestroComposerFixture;
        fixture.calls.push({ handler, method, params });
        const route = fixture.routes[handler]?.[method];
        if (!route) throw new Error('Unexpected mock boundary: ' + handler + '.' + String(method));
        return await route(params);
      }
    });
    export const xpcRenderer = {
      subscribe: (channel, listener) => globalThis.__maestroComposerFixture.subscriptions.set(channel, listener)
    };
  `
};
const bundled = await build({
  stdin: {
    contents: `
      export { MessageStoreState } from './src/renderer/maestro/control/src/store/message.store.ts';
      export { TurnService } from './turn.service';
      export { reactive } from 'vue';
    `,
    resolveDir: root
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'maestro-composer-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'composer-mock' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'composer-mock' }, ({ path }) => ({
          contents: mocks[path]
        }));
      }
    }
  ]
});
const { MessageStoreState, TurnService, reactive } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
after(() => {
  delete globalThis.__maestroComposerFixture;
});

const createHarness = () => {
  const fixture = {
    calls: [],
    saved: [],
    deleted: [],
    sent: [],
    stopped: [],
    subscriptions: new Map(),
    persisted: new Map(),
    recovery: null,
    defaultWorkspace: undefined,
    workspaceResult: { ok: false, missing: true },
    reply: { text: 'test turn reply' },
    routes: {}
  };
  fixture.routes = {
    CoachXpcHandler: {
      getActiveAgentTurn: async () => fixture.recovery,
      getWorkspaceDirectory: async () => ({ ok: true, workspace: fixture.defaultWorkspace }),
      setWorkspaceDirectory: async () => fixture.workspaceResult
    },
    MaestroChatDao: {
      getSession: async ({ id }) => fixture.persisted.get(id) ?? null,
      listSessions: async () => [],
      saveSession: async ({ session }) => {
        fixture.saved.push(structuredClone(session));
        return { ok: true };
      },
      deleteSession: async ({ id }) => {
        fixture.deleted.push(id);
        return { ok: true };
      }
    }
  };
  globalThis.__maestroComposerFixture = fixture;
  const turnService = new TurnService();
  const store = reactive(new MessageStoreState(turnService));
  return { store, fixture, turnService };
};
const options = { title: 'Maestro', intent: 'chat', operationTabId: 'operation-tab' };
const message = (id, role, content = greeting, ts = 1000) => ({
  id,
  source: 'cowork',
  role,
  type: 'text',
  content,
  streaming: false,
  ts
});
const storedSession = (id, messages) => ({
  id,
  title: 'Retained conversation',
  operationTabId: options.operationTabId,
  createdAt: 900,
  updatedAt: 2000,
  detail: { compressedContext: '' },
  messages
});
const turnSnapshot = (state = 'reserved') => ({
  sessionId: `recovered-${state}`,
  operationTabId: options.operationTabId,
  turnId: `turn-${state}`,
  generation: 7,
  rootText: state === 'reserved' ? '' : 'Continue the real request',
  startedAt: 1000,
  state
});

test('new chat is genuinely empty, retaining context defaults, attachments and inherited workspace', () => {
  const { store, fixture } = createHarness();
  const workspace = {
    path: '/test/full-workspace',
    name: 'Full workspace name',
    exists: true,
    updatedAt: 1
  };
  store.defaultWorkspace = workspace;
  const session = store.createSession(options);
  assert.deepEqual(session.messages, []);
  assert.equal(Object.hasOwn(session, 'welcome'), false);
  assert.equal(session.contextUsage.usedTokens, 0);
  assert.equal(session.contextUsage.percent, 0);
  assert.equal(session.allowFiles, true);
  assert.equal(session.placeholder, 'Start a Maestro conversation…');
  assert.equal(session.operationTabId, options.operationTabId);
  assert.deepEqual(session.detail.workspace, workspace);
  assert.notEqual(
    session.detail.workspace,
    store.defaultWorkspace,
    'new sessions clone the default workspace'
  );
  assert.equal(store.getSession(session.id).id, session.id);
  assert.deepEqual(fixture.calls, [], 'creating an empty local draft does not write history');
});

test('reserved recovery injects no greeting, retains turn ownership and is not discarded while active', async () => {
  const { store, fixture } = createHarness();
  const snapshot = turnSnapshot();
  fixture.recovery = { revision: 1, turn: snapshot, finished: [] };
  const session = await store.latestActiveSessionForOperationTab(options.operationTabId);
  assert.ok(session);
  assert.deepEqual(session.messages, []);
  assert.equal(session.id, snapshot.sessionId);
  assert.equal(session.turn.id, snapshot.turnId);
  assert.equal(session.turn.generation, snapshot.generation);
  assert.equal(session.turn.rootText, '');
  assert.equal(session.turn.rootHumanMessageId, undefined);
  assert.equal(session.turn.phase, 'accepted');
  await store.discardIfEmpty(session.id);
  assert.equal(store.getSession(session.id).id, session.id);
  assert.deepEqual(fixture.deleted, []);
  assert.equal(
    await store.latestActiveSessionForOperationTab(options.operationTabId),
    store.getSession(session.id)
  );
});

test('running and aborting recovery keep the real root and turn state without prepending a greeting', async () => {
  for (const state of ['running', 'aborting']) {
    const { store, fixture } = createHarness();
    const snapshot = turnSnapshot(state);
    fixture.recovery = { revision: 2, turn: snapshot, finished: [] };
    const session = await store.latestActiveSessionForOperationTab(options.operationTabId);
    assert.equal(session.messages.length, 1);
    const rootMessage = session.messages[0];
    assert.equal(rootMessage.role, 'human');
    assert.equal(rootMessage.content, snapshot.rootText);
    assert.equal(rootMessage.ts, snapshot.startedAt);
    assert.ok(!rootMessage.id.startsWith('welcome-'));
    assert.equal(session.turn.rootHumanMessageId, rootMessage.id);
    assert.equal(session.turn.id, snapshot.turnId);
    assert.equal(session.turn.generation, 7);
    assert.equal(session.turn.aborting, state === 'aborting');
    await store.persistSession(session);
    assert.equal(fixture.saved.length, 1, 'a single recovered human root is persistent content');
    assert.equal(fixture.saved[0].messages[0].content, snapshot.rootText);
    assert.deepEqual(fixture.deleted, []);
  }
});

test('loading history preserves message IDs, order and text, including genuine messages equal to the former greeting', async () => {
  const { store, fixture } = createHarness();
  const originals = [
    message('welcome-historical', 'ai'),
    message('real-human', 'human', greeting, 1100),
    message('real-assistant', 'ai', greeting, 1200),
    message('real-body', 'human', '  Keep this content exactly.\n第二行  ', 1300)
  ];
  const stored = storedSession('history-with-greeting-text', originals);
  fixture.persisted.set(stored.id, stored);
  const before = structuredClone(stored);
  const session = await store.loadPersistedSession(stored.id);
  const identityAndText = (messages) =>
    messages.map(({ id, role, content, ts }) => ({ id, role, content, ts }));
  assert.deepEqual(identityAndText(session.messages), identityAndText(originals));
  assert.deepEqual(stored, before, 'loading does not rewrite persisted input');
  assert.equal(Object.hasOwn(session, 'welcome'), false);
  await store.discardIfEmpty(session.id);
  await store.persistSession(session);
  assert.deepEqual(fixture.deleted, []);
  assert.equal(fixture.saved.length, 1);
  assert.deepEqual(identityAndText(fixture.saved[0].messages), identityAndText(originals));
});

test('persisted active turns retain their actual root and assistant segment on recovery', async () => {
  const { store, fixture } = createHarness();
  const snapshot = turnSnapshot('running');
  fixture.recovery = { revision: 3, turn: snapshot, finished: [] };
  const originals = [
    message('persisted-root', 'human', snapshot.rootText, snapshot.startedAt),
    message('persisted-answer', 'ai', 'Real partial response', snapshot.startedAt + 10)
  ];
  fixture.persisted.set(snapshot.sessionId, storedSession(snapshot.sessionId, originals));
  const session = await store.latestActiveSessionForOperationTab(options.operationTabId);
  assert.deepEqual(
    session.messages.map(({ id }) => id),
    ['persisted-root', 'persisted-answer']
  );
  assert.equal(session.turn.rootHumanMessageId, 'persisted-root');
  assert.equal(session.turn.lastAssistantMessageId, 'persisted-answer');
  assert.equal(session.turn.phase, 'streaming');
  assert.equal(session.turn.hasStreamedText, true);
  assert.equal(session.turn.sealedAssistantSegments, 1);
  assert.equal(session.turn.streamCoverageComplete, false);
});

test('discard removes only unused empty or legacy welcome-only drafts; one real message remains persistable', async () => {
  const { store, fixture } = createHarness();
  const empty = store.createSession(options);
  await store.discardIfEmpty(empty.id);
  assert.equal(store.getSession(empty.id), undefined);
  const legacy = storedSession('legacy-unused', [message('welcome-legacy', 'ai')]);
  fixture.persisted.set(legacy.id, legacy);
  await store.loadPersistedSession(legacy.id);
  await store.discardIfEmpty(legacy.id);
  assert.equal(store.getSession(legacy.id), undefined);
  assert.deepEqual(fixture.deleted, [empty.id, legacy.id]);
  for (const role of ['human', 'ai']) {
    const real = store.createSession(options);
    real.messages.push(message(`single-${role}`, role));
    await store.discardIfEmpty(real.id);
    assert.ok(store.getSession(real.id));
    await store.persistSession(real);
    assert.equal(fixture.saved.at(-1).messages.length, 1);
    assert.equal(fixture.saved.at(-1).messages[0].content, greeting);
    assert.equal(fixture.saved.at(-1).messages[0].role, role);
  }
  assert.deepEqual(fixture.deleted, [empty.id, legacy.id]);
});

test('workspace refresh still validates the current path and send/stop preserve the existing TurnService boundary', async () => {
  const { store, fixture } = createHarness();
  const session = store.createSession(options);
  const workspace = {
    path: '/test/project',
    name: 'Complete project name',
    exists: true,
    updatedAt: 2
  };
  session.detail.workspace = { ...workspace, updatedAt: 1 };
  fixture.workspaceResult = { ok: true, workspace };
  assert.equal(typeof store.refreshWorkspace, 'function');
  await store.refreshWorkspace(session.id);
  assert.deepEqual(fixture.calls.find(({ method }) => method === 'setWorkspaceDirectory').params, {
    sessionId: session.id,
    path: workspace.path
  });
  assert.deepEqual(session.detail.workspace, workspace);
  assert.deepEqual(store.defaultWorkspace, workspace);
  const files = [{ name: 'report.txt', path: '/test/project/report.txt' }];
  assert.equal(await store.send(session.id, 'real message', files), fixture.reply);
  assert.deepEqual(fixture.sent, [[session.id, 'real message', files]]);
  await store.stop(session.id);
  assert.deepEqual(fixture.stopped, [session.id]);
  assert.deepEqual(
    session.messages,
    [],
    'message store does not add an unrelated opening message on send'
  );
});
