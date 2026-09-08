/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as Vue from 'vue';
import { renderToString } from '@vue/server-renderer';
import { Button } from '@arco-design/web-vue';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { buildSync, transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import less from 'less';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const pagePath = 'src/renderer/home/src/views/miniApp/MiniApp.vue';
const { descriptor, errors } = parse(read(pagePath), { filename: pagePath });
const script = compileScript(descriptor, { id: 'home-app-list' });
const load = (source, imports = {}) => {
  const module = { exports: {} };
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  const require = (id) => {
    if (id.includes('/assets/icons/')) return id;
    assert.ok(id in imports, `Unexpected dependency: ${id}`);
    return imports[id];
  };
  new Function('require', 'module', 'exports', 'console', compiled)(require, module, module.exports, { error() { return undefined; } });
  return module.exports;
};
const { en } = load(buildSync({
  entryPoints: [resolve(root, 'src/renderer/common/i18n/en.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs'
}).outputFiles[0].text);
const factory = load(read('src/renderer/home/src/views/miniApp/miniApps.constant.ts'));
const fixture = (host = 'cowork') => {
  const calls = [];
  const errors = [];
  const imports = {
    vue: Vue,
    '@arco-design/web-vue': { Message: { success() { return undefined; }, error: (message) => errors.push(message) } },
    '@renderer/common/i18n/i18n.helper': { i18nHelper: en },
    '@renderer/common/homeShellBridge.client': { homeShellBridge: { openTodo: async () => calls.push('todo') } },
    './miniApps.constant': factory,
    '@shared/onlypreview/onlyPreview.contract': { unwrapOnlyPreviewResult: (result) => result }
  };
  for (const [emitter, method, result] of [
    ['omniWindowEmitter', 'openOmniWindow', { opened: true }],
    ['maestroWindowEmitter', 'openMaestroWindow'],
    ['coinWindowEmitter', 'openCoinWindow'],
    ['eyesOnAgentsWindowEmitter', 'openEyesOnAgentsWindow'],
    ['submodulesWindowEmitter', 'openSubmodulesWindow'],
    ['onlyPreviewEmitter', 'openOnlyPreviewWindow'],
    ['coworkTabEmitter', 'openCompositeTab']
  ]) {
    imports[`@/emitter/${emitter.replace('Emitter', '')}.emitter`] = {
      [emitter]: { [method]: async (params) => { calls.push([method, params]); return result; } }
    };
  }
  const component = load(script.content, imports).default;
  return { state: component.setup({ host }, { expose() { return undefined; } }), calls, errors };
};
const stylesheet = (await less.render(read('src/renderer/home/src/views/miniApp/MiniApp.less'))).css;
const cascade = read('node_modules/@arco-design/web-vue/es/button/style/index.css') + stylesheet;
const render = async (state) => {
  const app = Vue.createSSRApp({
    components: { AButton: Button },
    setup: () => ({ ...state }),
    render: Vue.compile(descriptor.template.content)
  });
  return new JSDOM(`<style>${cascade}</style>${await renderToString(app)}`);
};

test('Home list and rail-free shell compile without changing authentication gates', async () => {
  assert.deepEqual(errors, []);
  for (const path of [pagePath, 'src/renderer/maestro/localHome/src/LocalHomeApp.vue']) {
    const sfc = parse(read(path), { filename: path }).descriptor;
    const compiled = compileScript(sfc, { id: path });
    assert.deepEqual(compileTemplate({ source: sfc.template.content, filename: path, id: path,
      compilerOptions: { bindingMetadata: compiled.bindings } }).errors, []);
    transformSync(compiled.content, { loader: 'ts' });
  }
  await less.render(read('src/renderer/maestro/localHome/src/localHome.less'));
});

test('all seven real app names are uppercase, with one icon and whole-row button, no cards or descriptions', async () => {
  const { state } = fixture();
  assert.deepEqual(state.miniApps.value.map((app) => app.name),
    ['TODO', 'MAESTRO', 'TRENCH', 'EYESONAGENTS', 'SUBMODULES', 'ONLYPREVIEW', 'OMNI BROWSER']);
  const dom = await render(state);
  try {
    const page = dom.window.document;
    const rows = page.querySelectorAll('[name="miniApp__item"]');
    assert.equal(rows.length, 7);
    assert.equal(page.querySelector('.arco-card, p, [name="miniApp__grid"]'), null);
    for (const [index, row] of [...rows].entries()) {
      assert.equal(row.tagName, 'LI');
      assert.equal(row.querySelectorAll('button').length, 1);
      assert.equal(row.querySelectorAll('img').length, 1);
      assert.equal(row.textContent.trim(), state.miniApps.value[index].name);
      assert.equal(row.querySelector('img').alt, '');
      assert.equal(row.querySelector('button').type, 'button');
    }
  } finally { dom.window.close(); }
});

test('real Arco buttons form one left-aligned equal-width column with fixed icon geometry', async () => {
  const dom = await render(fixture().state);
  try {
    const style = (selector) => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
    assert.equal(style('.mini-app-page__list').flexDirection, 'column');
    assert.equal(style('.mini-app-page__list').width, '320px');
    assert.equal(style('.mini-app-page__list').maxWidth, '100%');
    assert.equal(style('.mini-app-page__item').width, '100%');
    assert.equal(style('.mini-app-page__open').width, '100%');
    assert.equal(style('.mini-app-page__open').height, '44px');
    assert.equal(style('.mini-app-page__open').justifyContent, 'flex-start');
    assert.equal(style('.mini-app-page__open').gap, '12px');
    assert.equal(style('.arco-btn-icon').width, '24px');
    assert.equal(style('.arco-btn-icon').marginRight, '0px');
    assert.match(stylesheet, /:focus-visible\s*\{[\s\S]*outline: 2px solid/u);
  } finally { dom.window.close(); }
});

test('opening state occupies the existing icon slot and disables the complete row', async () => {
  const { state } = fixture();
  state.openingAppIds.value.add('onlypreview');
  const dom = await render(state);
  try {
    const row = dom.window.document.querySelector('[data-mini-app-id="onlypreview"]');
    assert.equal(row.querySelector('button').disabled, true);
    assert.equal(row.querySelector('button').getAttribute('aria-busy'), 'true');
    assert.equal(row.querySelectorAll('.arco-btn-icon').length, 1);
    assert.equal(row.querySelectorAll('img').length, 0);
    assert.equal(row.textContent.trim(), 'ONLYPREVIEW');
  } finally { dom.window.close(); }
});

test('row activation preserves duplicate-open fencing, failure feedback and retry', async () => {
  const { state, errors } = fixture();
  let resolveOpen;
  let calls = 0;
  const pending = new Promise((resolve) => { resolveOpen = resolve; });
  const app = { ...state.miniApps.value[0], action: async () => { calls += 1; await pending; } };
  const opening = state.openApp(app);
  await state.openApp(app);
  assert.equal(calls, 1);
  assert.equal(state.openingAppIds.value.has(app.id), true);
  resolveOpen();
  await opening;
  assert.equal(state.openingAppIds.value.has(app.id), false);
  await state.openApp({ ...app, action: async () => { throw new Error('fixture failure'); } });
  assert.equal(errors.length, 1);
  assert.equal(state.openingAppIds.value.has(app.id), false);
  await state.openApp(app);
  assert.equal(calls, 2);
});

test('OnlyPreview opens through the existing host-specific tab/window entry', async () => {
  for (const host of ['cowork', 'window']) {
    const { state, calls } = fixture(host);
    await state.openApp(state.miniApps.value.find((app) => app.id === 'onlypreview'));
    assert.deepEqual(calls, host === 'cowork'
      ? [['openCompositeTab', { id: 'onlypreview' }]] : [['openOnlyPreviewWindow', undefined]]);
  }
});
