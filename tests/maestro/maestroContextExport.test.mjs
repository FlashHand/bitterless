/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const require = createRequire(import.meta.url);
const load = (path, dependencies, extra = '') => {
  const result = ts.transpileModule(read(path) + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: path, reportDiagnostics: true
  });
  assert.equal(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), module, module.exports
  );
  return module.exports;
};
const output = await build({
  stdin: {
    contents: `
      export * from './src/main/agent/contextExport.service';
      export * from './src/main/agent/runtime/contextSnapshot.service';
      export { buildAgentTurnPrompt } from './src/main/agent/runtime/agentPrompt';
      export { MAESTRO_SYSTEM_PROMPT } from './src/main/agent/prompt/maestroSysPrompt';
    `,
    resolveDir: root, loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: resolve(root, 'tsconfig.node.json')
});
const real = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { BaseAgent, prependAgentPreamble } = load('src/main/agent/BaseAgent.ts', {
  './runtime/coachRuntimeAdapter': { CoachRuntimeAdapter: class {} }
});
const { PiRuntimeSession } = load('src/main/agent/runtime/piRuntimeAdapter.ts', {
  './contextSnapshot.service': real,
  './errorSanitizer': { sanitizeRuntimeError: value => value },
  '../steering/steeringPolicy': { decideStreamingBehavior: () => { throw new Error('Must not prompt'); } }
});
const { AiCrmsRuntimeSession } = load('src/main/agent/runtime/aiCrmsRuntimeAdapter.ts', {
  './contextSnapshot.service': real,
  'electron-xpc/main': { createXpcMainEmitter: () => ({}) },
  '@maestro-shared/networking/coachRegion': {},
  '@maestro-main/networking/clients/relay.client': {},
  './errorSanitizer': {}, './mediaRefResolver': {}
}, '\nexport { AiCrmsRuntimeSession };');

const method = (path, name, bindings = {}) => {
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let member;
  for (const node of ast.statements) {
    if (ts.isClassDeclaration(node)) member ??= node.members.find(item => item.name?.getText(ast) === name);
  }
  assert.ok(member, name);
  const code = ts.transpileModule(`class Actual { ${member.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return Actual.prototype.${name}`)(...Object.values(bindings));
};

const mainHarness = () => {
  const clipboardWrites = [];
  const registry = { listSkillsForDomain: () => [], readRecipe: () => { throw new Error('No fixture recipe'); } };
  const owner = {
    pi: null, maestroAgents: new Map(), hydratedMaestroAgentSessions: new Set(),
    activeLlmProvider: 'openai-codex', activeLlmModel: 'test-model',
    assertAgentRuntimeActive: () => undefined,
    agentSessionKey: value => value.trim() || 'default',
    _state: {
      currentUrl: 'https://example.com', existingSkillRegistry: () => registry,
      ensureServices: () => { throw new Error('Export must not initialize services'); },
      replaySkill: () => { throw new Error('Export must not replay'); },
      syncWorkspaceFromContext: () => { throw new Error('Export must not mutate workspace'); }
    }
  };
  const servicePath = 'src/main/agent/maestroAgent.service.ts';
  owner.agentSkillBriefs = method(servicePath, 'agentSkillBriefs');
  owner.copyNextTurnContext = method(servicePath, 'copyNextTurnContext', {
    ...real, prependAgentPreamble, clipboard: { writeText: text => clipboardWrites.push(text) }
  });
  const controller = { agentService: owner };
  controller.copyNextTurnContext = method('src/main/maestro/windows/main/maestroWindow.controller.ts', 'copyNextTurnContext');
  const handler = method('src/main/maestro/xpc/coach.handler.ts', 'copyNextTurnContext', { maestroWindowHelper: controller });
  return { owner, clipboardWrites, copy: params => handler(params) };
};

test('pi snapshots real native system/messages including tools without invoking prompt or mutating them', () => {
  const native = {
    systemPrompt: 'effective runtime system',
    messages: [
      { role: 'assistant', content: [{ type: 'toolCall', name: 'read_file', arguments: { path: '/test.txt' } }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'tool result in full' }] }
    ],
    prompt: () => { throw new Error('Must not prompt'); },
    abort: () => { throw new Error('Must not abort'); }
  };
  const snapshot = new PiRuntimeSession(native).readContext();
  assert.deepEqual(snapshot, { systemPrompt: native.systemPrompt, messages: native.messages });
  snapshot.messages[0].role = 'changed';
  assert.equal(native.messages[0].role, 'assistant');
  assert.throws(() => new PiRuntimeSession({ messages: [] }).readContext(), /does not expose/);
});

test('AI-CRMS exposes its actual tool-loop messages with no request', () => {
  const session = new AiCrmsRuntimeSession({});
  session.messages.push({ role: 'tool', tool_call_id: '1', content: 'tool result' });
  assert.deepEqual(session.readContext(), { systemPrompt: '', messages: session.messages });
});

test('no model session is created by export; preamble stays pending until an actual send primes it', async () => {
  let creations = 0;
  class Agent extends BaseAgent { systemPrompt() { return ' APP SYSTEM '; } }
  const agent = new Agent({ runtime: { createSession: async () => { creations++; } }, buildTools: () => { throw new Error('No tools'); } });
  assert.deepEqual(await agent.readContext(), { runtime: null, preamblePending: true });
  const preview = agent.previewSystemPreamble('draft');
  assert.equal(preview, 'APP SYSTEM\n\ndraft');
  assert.equal(agent.previewSystemPreamble('draft'), preview);
  assert.equal(creations, 0);
  assert.equal(agent.withSystemPreamble({ text: 'draft' }).text, preview);
  assert.equal(agent.previewSystemPreamble('next'), 'next');
  agent.sessionPromise = Promise.resolve({});
  await assert.rejects(agent.readContext(), /does not support/);
});

test('session replacement while awaiting existing context fails instead of exporting stale history', async () => {
  const agent = new BaseAgent({ buildTools: () => [] });
  let finish;
  agent.sessionPromise = new Promise(resolve => { finish = resolve; });
  const pending = agent.readContext();
  agent.sessionPromise = null;
  finish({ readContext: () => ({ systemPrompt: '', messages: [] }) });
  await assert.rejects(pending, /session changed/);
});

test('typed handler/controller/service export truthful first-turn pending context without side effects', async () => {
  const h = mainHarness();
  const result = await h.copy({
    sessionId: 'chat-1', draft: ' draft ',
    context: { workspace: { path: '/workspace' }, attachedPaths: ['/unread/attachment.png'], recentMessages: [{ role: 'human', content: 'restored memory', ts: 1 }] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.entries, 0);
  assert.equal(h.owner.maestroAgents.size, 0);
  assert.equal(h.owner.hydratedMaestroAgentSessions.size, 0);
  const text = h.clipboardWrites[0];
  assert.equal(result.chars, text.length);
  assert.match(text, /no model-side history yet/);
  assert.match(text, /runtime system prompt is not available yet/);
  assert.match(text, /includes first-turn Bitterless preamble/);
  assert.ok(text.includes(real.MAESTRO_SYSTEM_PROMPT.trim()));
  assert.match(text, /Selected workspace: \/workspace/);
  assert.match(text, /restored memory/);
  assert.match(text, /not read, validated or uploaded/);
  assert.match(text, /\/unread\/attachment.png/);
  assert.doesNotMatch(JSON.stringify(result), /restored memory|attachment\.png/);
});

test('live context uses runtime tool history, existing memory hydration and the same send builder', async () => {
  const h = mainHarness();
  const snapshot = { systemPrompt: 'native system', messages: [{ role: 'toolResult', content: 'full result' }] };
  h.owner.maestroAgents.set('chat-1', {
    readContext: async () => ({ runtime: snapshot, preamblePending: false }),
    previewSystemPreamble: text => text
  });
  h.owner.hydratedMaestroAgentSessions.add('chat-1');
  const result = await h.copy({ sessionId: 'chat-1', draft: 'next', context: { recentMessages: [{ role: 'human', content: 'must not replay', ts: 1 }] } });
  assert.equal(result.entries, 1);
  assert.match(h.clipboardWrites[0], /native system/);
  assert.match(h.clipboardWrites[0], /full result/);
  assert.doesNotMatch(h.clipboardWrites[0], /must not replay/);
  assert.match(h.clipboardWrites[0], /preamble already sent/);
  const serviceSource = read('src/main/agent/maestroAgent.service.ts');
  assert.equal((serviceSource.match(/buildAgentTurnPrompt\(\{/g) || []).length, 2);
});

test('unsupported live context and missing catalog fail visibly without a clipboard write', async () => {
  const h = mainHarness();
  h.owner.maestroAgents.set('bad', { readContext: async () => { throw new Error('unsupported live context'); } });
  assert.deepEqual(await h.copy({ sessionId: 'bad', draft: '' }), { ok: false, error: 'unsupported live context' });
  h.owner._state.existingSkillRegistry = () => null;
  const missing = await h.copy({ sessionId: 'new', draft: '' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not ready/);
  assert.equal(h.clipboardWrites.length, 0);
});

test('inline media is marked without copying bytes; oversized model/tool text is a clear failure', () => {
  const binary = 'a'.repeat(real.MAX_CONTEXT_EXPORT_CHARS + 10);
  const snapshot = real.snapshotRuntimeContext('system', [{ role: 'user', content: [
    { type: 'image', data: binary, mimeType: 'image/png' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${binary}` } },
    { type: 'text', text: 'data:text/plain; full tool text must survive' }
  ] }]);
  const exported = JSON.stringify(snapshot);
  assert.ok(exported.length < 1000);
  assert.match(exported, /inline media omitted/);
  assert.match(exported, /full tool text must survive/);
  assert.throws(() => real.snapshotRuntimeContext('', [{ role: 'toolResult', content: binary }]), /8 MiB.*nothing was copied/);
});
