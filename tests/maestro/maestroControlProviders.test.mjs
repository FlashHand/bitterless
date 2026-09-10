/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { after, test } from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { build } from 'esbuild';
import * as vue from 'vue';

const root = resolve(import.meta.dirname, '../..');
const filename = resolve(root, 'src/renderer/maestro/control/src/ControlApp.vue');
const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename });
const script = compileScript(descriptor, { id: 'control-providers', genDefaultAs: 'component' });
const template = compileTemplate({
  source: descriptor.template.content,
  filename,
  id: 'control-providers',
  compilerOptions: { bindingMetadata: script.bindings }
});
const unavailable = 'Localized provider-unavailable notice';
const activeTurn = vue.ref(null);
const fixture = {
  mounts: [],
  unmounts: [],
  listeners: new Map(),
  subscriptions: new Map(),
  calls: [],
  warnings: [],
  config: null,
  switchGate: null
};
const clone = (value) => JSON.parse(JSON.stringify(value));
fixture.coach = {
  getTabs: async () => [],
  getLlmConfig: async () => {
    fixture.calls.push(['get-config']);
    return clone(fixture.config);
  },
  setLlmConfig: async (target) => {
    fixture.calls.push(['set-config', clone(target)]);
    await fixture.switchGate;
    fixture.config = { ...fixture.config, ...target, ready: true };
    return clone(fixture.config);
  },
  loginLlm: async (request) => {
    fixture.calls.push(['login', request]);
    return clone(fixture.config);
  },
  setWorkbenchVisible: async (request) => fixture.calls.push(['workbench', request])
};
fixture.channelStore = vue.reactive({
  activeSource: 'cowork',
  activeSession: null,
  init: async (tabs) => fixture.calls.push(['init', tabs]),
  syncOperationTabs: async (tabs) => fixture.calls.push(['tabs', tabs]),
  selectSource(source) {
    fixture.calls.push(['select-source', source]);
    this.activeSource = source;
  },
  startFreshMaestroSession: async () => {
    fixture.calls.push(['new-session']);
    return { id: 'new-session' };
  }
});
fixture.messageStore = vue.reactive({
  activeAgentTurnSnapshot: null,
  turnService: {
    activeTurn: () => activeTurn.value,
    send: async (id, message) => {
      fixture.calls.push(['send', id, message]);
      return { ok: true, text: 'done' };
    }
  },
  setContextWindow: (...args) => fixture.calls.push(['context', ...args]),
  compactAllIfNeeded: async () => fixture.calls.push(['compact']),
  pushActivity: () => undefined,
  pushStream: () => undefined,
  pushThinking: () => undefined
});
globalThis.__controlProviderFixture = fixture;
globalThis.__controlProviderVue = vue;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    addEventListener: (name, callback) => fixture.listeners.set(name, callback),
    removeEventListener: (name) => fixture.listeners.delete(name)
  }
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { hasFocus: () => true }
});
after(() => {
  for (const [key, original] of [
    ['window', originalWindow],
    ['document', originalDocument]
  ]) {
    if (original) Object.defineProperty(globalThis, key, original);
    else delete globalThis[key];
  }
  delete globalThis.__controlProviderFixture;
  delete globalThis.__controlProviderVue;
});
const lifecycle = new Set(['onMounted', 'onBeforeUnmount']);
const vueExports = Object.keys(vue).filter(
  (key) => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default' && !lifecycle.has(key)
);
const stubs = {
  vue: `const v = globalThis.__controlProviderVue;
    export const ${vueExports.map((key) => `${key} = v.${key}`).join(', ')};
    export const onMounted = (callback) => globalThis.__controlProviderFixture.mounts.push(callback);
    export const onBeforeUnmount = (callback) => globalThis.__controlProviderFixture.unmounts.push(callback);`,
  '@arco-design/web-vue': `export const Button = { name: 'Button' }, Spin = { name: 'Spin' }, Trigger = { name: 'Trigger' };
    export const Message = {
      warning: (message) => globalThis.__controlProviderFixture.warnings.push(message),
      success: (message) => globalThis.__controlProviderFixture.calls.push(['success', message])
    };
    export const Notification = { info: () => undefined, remove: () => undefined };`,
  '@tabler/icons-vue': 'export const IconLogin2 = {}, IconSparkle2 = {}, IconX = {};',
  'electron-xpc/renderer': `export const createXpcRendererEmitter = () => globalThis.__controlProviderFixture.coach;
    export const xpcRenderer = {
      subscribe: (topic, callback) => globalThis.__controlProviderFixture.subscriptions.set(topic, callback),
      broadcast: (topic, value) => globalThis.__controlProviderFixture.calls.push(['broadcast', topic, value])
    };`,
  '@renderer/common/i18n/i18n.helper': `export const i18nHelper = { menuBar: { maestro: {
    resizePanel: 'Resize', hidePanel: 'Hide', providerUnavailable: ${JSON.stringify(unavailable)}
  } } };`,
  './store/channel.store':
    'export const channelStore = globalThis.__controlProviderFixture.channelStore;',
  './store/message.store':
    'export const messageStore = globalThis.__controlProviderFixture.messageStore;',
  './store/turn.service': 'export const isRejection = (reply) => reply?.rejected === true;',
  './store/task.store':
    "export const taskStore = { init: async () => globalThis.__controlProviderFixture.calls.push(['task-init']) };"
};
const bundled = await build({
  stdin: {
    contents: `${script.content}\n${template.code}\nexport default component;`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'control-provider-boundaries',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(stubs, path) || /\.(vue|less)$/.test(path)
            ? { path, namespace: 'control-provider-test' }
            : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'control-provider-test' }, ({ path }) => ({
          contents:
            stubs[path] ?? `export default { name: ${JSON.stringify(basename(path, '.vue'))} };`
        }));
      }
    }
  ]
});
const { default: component, render } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const makeConfig = (provider = 'codex', ready = true) => ({
  provider,
  model: `${provider}-model`,
  effort: 'low',
  ready,
  providers: [
    { provider: 'codex', label: 'Codex provider', ready: true },
    { provider: 'local', label: 'Saved Local provider', ready }
  ],
  presets: ['codex', 'local', 'claude'].map((id) => ({
    provider: id,
    providerLabel: `${id} preset provider`,
    model: `${id}-model`,
    label: `${id} full model`,
    shortLabel: `${id} saved model`,
    effort: 'low',
    efforts: [
      { id: 'low', label: 'Low' },
      { id: 'high', label: 'High' }
    ],
    contextLengthK: 128,
    contextLengthLabel: '128K',
    compressionRemainingPercent: 15
  }))
});
const tick = () => new Promise((done) => setImmediate(done));
const mutations = () =>
  fixture.calls.filter(([method]) =>
    ['set-config', 'login', 'send', 'select-source', 'new-session', 'workbench'].includes(method)
  );
const harness = async (t, config = makeConfig()) => {
  fixture.mounts.length = 0;
  fixture.unmounts.length = 0;
  fixture.calls.length = 0;
  fixture.warnings.length = 0;
  fixture.listeners.clear();
  fixture.subscriptions.clear();
  fixture.config = clone(config);
  fixture.switchGate = null;
  fixture.channelStore.activeSource = 'cowork';
  fixture.channelStore.activeSession = { id: 'session', turn: null, archivedAt: null };
  fixture.messageStore.activeAgentTurnSnapshot = null;
  activeTurn.value = null;
  const scope = vue.effectScope();
  const ui = scope.run(() => component.setup({}, { expose: () => undefined }));
  t.after(() => {
    for (const unmount of fixture.unmounts) unmount();
    scope.stop();
  });
  for (const mount of fixture.mounts) await mount();
  return ui;
};
const tree = (ui) => {
  const nodes = [];
  const walk = (value, parent) => {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, parent);
      return;
    }
    if (!value || typeof value !== 'object' || !vue.isVNode(value)) return;
    nodes.push({ node: value, parent });
    if (Array.isArray(value.children)) walk(value.children, value);
    else if (value.children && typeof value.children === 'object') {
      for (const slot of Object.values(value.children)) {
        if (typeof slot === 'function') walk(slot(), value);
      }
    }
  };
  walk(render({}, [], {}, vue.proxyRefs(ui), {}, {}));
  return nodes;
};
const named = (nodes, name) => nodes.find(({ node }) => node.props?.name === name)?.node;
const chat = (nodes) => nodes.find(({ node }) => node.type?.name === 'ChatPanel').node;
const text = (node) =>
  typeof node?.children === 'string'
    ? node.children
    : Array.isArray(node?.children)
      ? node.children.map(text).join('')
      : '';
const enclosingTrigger = (nodes, name) => {
  let parent = nodes.find(({ node }) => node.props?.name === name)?.parent;
  while (parent && parent.type?.name !== 'Trigger')
    parent = nodes.find(({ node }) => node === parent)?.parent;
  return parent;
};
const trigger = { message: '  run the skill  ', skillTitle: 'Example skill' };

test('Control SFC compiles; both provider sources exclude removed keys without changing presets-only valid groups', async (t) => {
  assert.deepEqual(errors, []);
  assert.deepEqual(template.errors, []);
  const ui = await harness(t);
  const original = clone(fixture.config);
  const groups = ui.getLlmProviderGroups(fixture.config);
  assert.deepEqual(
    groups.map(({ provider }) => provider),
    ['codex', 'claude']
  );
  assert.equal(groups[1].label, 'claude preset provider');
  assert.equal(groups[1].ready, false);
  assert.equal(groups[1].models[0].model, 'claude-model');
  assert.deepEqual(fixture.config, original);
  assert.deepEqual(ui.getLlmProviderGroups(null), []);
  for (const locale of ['en', 'zh']) {
    assert.match(
      readFileSync(resolve(root, `src/renderer/common/i18n/${locale}.ts`), 'utf8'),
      /providerUnavailable:\s*'[^']+'/
    );
  }
});

for (const provider of ['local']) {
  test(`restored ${provider} remains truthfully labelled and inert through startup and config broadcasts`, async (t) => {
    const config = makeConfig(provider);
    const ui = await harness(t, config);
    assert.deepEqual(clone(ui.llmConfig.value), config);
    assert.equal(ui.activeLlmGroup.value, undefined, 'must not fall back to the first Codex group');
    assert.equal(
      ui.activeProviderLabel.value,
      config.providers.find((item) => item.provider === provider).label
    );
    assert.equal(ui.activeModelLabel.value, `${provider} saved model`);
    assert.equal(ui.llmAvailable.value, false);
    assert.equal(ui.needsLlmLogin.value, false);
    assert.deepEqual(ui.activeLlmEfforts.value, []);
    const nodes = tree(ui);
    assert.equal(chat(nodes).props['send-disabled'], true);
    assert.equal(named(nodes, 'control__llm__provider_button').props.disabled, false);
    assert.equal(enclosingTrigger(nodes, 'control__llm__provider_button').props.disabled, false);
    for (const control of ['model', 'effort']) {
      assert.equal(named(nodes, `control__llm__${control}_button`).props.disabled, true);
      assert.equal(enclosingTrigger(nodes, `control__llm__${control}_button`).props.disabled, true);
    }
    assert.equal(
      text(named(nodes, 'control__llm__provider_button')).trim(),
      ui.activeProviderLabel.value
    );
    assert.equal(
      text(named(nodes, 'control__llm__model_button')).trim(),
      `${provider} saved model`
    );
    assert.equal(text(named(nodes, 'control__llm__unavailable')).trim(), unavailable);
    assert.equal(named(nodes, 'control__llm__login_card'), undefined);
    assert.deepEqual(
      nodes
        .filter(({ node }) => node.props?.name === 'control__llm__provider_option')
        .map(({ node }) => text(node).trim()),
      ['Codex provider', 'claude preset provider']
    );
    assert.equal(
      nodes.some(({ node }) => node.props?.name === 'control__llm__model_option'),
      false
    );
    const incoming = makeConfig(provider, false);
    fixture.subscriptions.get('coach/llm-config')({ params: incoming });
    await tick();
    assert.deepEqual(clone(ui.llmConfig.value), incoming);
    assert.equal(ui.needsLlmLogin.value, false);
    assert.deepEqual(
      mutations(),
      [],
      'neither restoring nor broadcasting rewrites saved configuration'
    );
  });
}

test('forbidden direct model, provider, effort, login and injected-skill handlers cannot escape the disabled UI', async (t) => {
  const ui = await harness(t, makeConfig('local'));
  for (const provider of ['local']) {
    await ui.onSwitchLlmProvider(provider);
    await ui.onSwitchLlmTarget({ provider, model: `${provider}-model`, effort: 'high' });
    await ui.onSwitchLlmModel(fixture.config.presets.find((item) => item.provider === provider));
  }
  await ui.onSwitchLlmEffort('high');
  await ui.loginActiveProvider();
  await ui.triggerInjectedSkill(trigger);
  fixture.subscriptions.get('coach/injected-skill-trigger')({ params: trigger });
  await tick();
  assert.deepEqual(mutations(), []);
  assert.deepEqual(fixture.warnings, [unavailable, unavailable]);
  assert.equal(ui.llmConfig.value.provider, 'local');
});

test('an explicit Codex provider choice restores model, effort and send availability without changing normal skill behavior', async (t) => {
  const ui = await harness(t, makeConfig('local'));
  ui.providerPickerVisible.value = true;
  const codexOption = tree(ui).find(
    ({ node }) =>
      node.props?.name === 'control__llm__provider_option' && text(node).trim() === 'Codex provider'
  ).node;
  await codexOption.props.onClick();
  assert.deepEqual(mutations(), [
    ['set-config', { provider: 'codex', model: 'codex-model', effort: 'low' }]
  ]);
  assert.equal(ui.providerPickerVisible.value, false);
  assert.equal(ui.llmAvailable.value, true);
  assert.equal(ui.activeLlmGroup.value.provider, 'codex');
  let nodes = tree(ui);
  assert.equal(chat(nodes).props['send-disabled'], false);
  assert.equal(named(nodes, 'control__llm__unavailable'), undefined);
  assert.equal(named(nodes, 'control__llm__model_button').props.disabled, false);
  assert.equal(named(nodes, 'control__llm__effort_button').props.disabled, false);
  await ui.onSwitchLlmEffort('high');
  assert.equal(ui.llmConfig.value.effort, 'high');
  await ui.triggerInjectedSkill(trigger);
  assert.deepEqual(mutations().slice(-2), [
    ['select-source', 'cowork'],
    ['send', 'session', 'run the skill']
  ]);
  fixture.subscriptions.get('coach/llm-login-state')({
    params: { provider: 'codex', loading: true }
  });
  nodes = tree(ui);
  assert.equal(chat(nodes).props['send-disabled'], true);
  fixture.subscriptions.get('coach/llm-login-state')({
    params: { provider: 'codex', loading: false }
  });
  assert.equal(chat(tree(ui)).props['send-disabled'], false);
});

test('allowed login, active-turn locks, switching locks and default-only effort retain their existing behavior', async (t) => {
  const config = makeConfig('codex', false);
  config.providers[0].ready = false;
  const ui = await harness(t, config);
  assert.equal(ui.needsLlmLogin.value, true);
  assert.ok(named(tree(ui), 'control__llm__login_card'));
  await ui.loginActiveProvider();
  assert.deepEqual(mutations(), [['login', { provider: 'codex', method: 'browser' }]]);
  fixture.calls.length = 0;
  for (const lock of ['turn', 'snapshot']) {
    activeTurn.value = lock === 'turn' ? { id: 'turn' } : null;
    fixture.messageStore.activeAgentTurnSnapshot = lock === 'snapshot' ? { turnId: 'turn' } : null;
    assert.equal(ui.llmLocked.value, true);
    assert.equal(named(tree(ui), 'control__llm__provider_button').props.disabled, true);
    await ui.onSwitchLlmProvider('codex');
    await ui.onSwitchLlmEffort('high');
    assert.deepEqual(mutations(), []);
  }
  activeTurn.value = null;
  fixture.messageStore.activeAgentTurnSnapshot = null;
  let release;
  fixture.switchGate = new Promise((done) => {
    release = done;
  });
  const switching = ui.onSwitchLlmProvider('codex');
  try {
    assert.equal(ui.llmLocked.value, true);
    await ui.onSwitchLlmEffort('high');
    assert.equal(mutations().length, 1);
  } finally {
    release();
    await switching;
    fixture.switchGate = null;
  }
  assert.equal(ui.llmLocked.value, false);
  const defaults = makeConfig();
  defaults.effort = 'default';
  defaults.presets[0].effort = 'default';
  defaults.presets[0].efforts = [{ id: 'default', label: 'Default' }];
  await ui.applyLlmConfig(defaults);
  assert.equal(ui.llmAvailable.value, true);
  assert.equal(ui.llmEffortDisabled.value, true);
  assert.equal(named(tree(ui), 'control__llm__effort_button').props.disabled, true);
  fixture.channelStore.activeSession.turn = { id: 'active' };
  const sends = fixture.calls.filter(([method]) => method === 'send').length;
  await ui.triggerInjectedSkill(trigger);
  assert.equal(fixture.calls.filter(([method]) => method === 'send').length, sends);
  assert.match(fixture.warnings.at(-1), /busy/);
});
