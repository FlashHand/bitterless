/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import less from 'less';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((done) => { resolvePromise = done; });
  return { promise, resolve: resolvePromise };
};
const evaluate = (source, bindings) => {
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const module = { exports: {} };
  new Function('module', 'exports', ...Object.keys(bindings), code)(
    module, module.exports, ...Object.values(bindings)
  );
  return module.exports;
};
const methods = (path, names) => {
  const text = read(path);
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const owner = ast.statements.find((node) => ts.isClassDeclaration(node));
  const selected = owner.members.filter((node) => names.includes(node.name?.getText(ast)));
  assert.equal(selected.length, names.length);
  return selected.map((node) => node.getText(ast)).join('\n');
};
const success = (value) => ({ ok: true, value });
const unwrap = (value) => {
  if (!value.ok) throw new Error(value.error.message);
  return value.value;
};
const presentation = (revision = 1, workspaceId = 'project') => ({
  selectionRevision: revision,
  fileRef: { workspaceId, relativePath: 'document.pdf' }
});
const nativeHarness = () => {
  const window = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  const state = { window, template: null, popup: null, failure: null };
  const path = 'src/main/miniapps/onlypreview/onlyPreviewFileMenu.service.ts';
  const source = read(path).replace(/^import .*;\n/gmu, '');
  const api = evaluate(source, {
    Menu: {
      buildFromTemplate: (template) => {
        state.template = template;
        return { popup: (options) => {
          if (state.failure) throw state.failure;
          state.popup = options;
        } };
      }
    },
    i18nHelper: { getMessages: () => ({ app: { onlyPreviewFileMenu: {
      openExternally: 'Localized Open', revealInFolder: 'Localized Reveal'
    } } }) }
  });
  state.open = () => api.showOnlyPreviewFileMenu(window);
  return state;
};
const handlerHarness = () => {
  const state = { window: { isDestroyed: () => false }, current: presentation(), menus: 0 };
  state.result = deferred();
  const Handler = evaluate(`export class Handler {
    ${methods('src/main/xpc/onlyPreview.handler.ts', ['showPreviewFileMenu'])}
  }`, {
    runOperation: async (_name, operation) => success(await operation()),
    parseOnlyPreviewSelectionRevision: (revision) => {
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid revision');
      return revision;
    },
    onlyPreviewWindowHelper: { getStandaloneWindow: (token) => {
      assert.equal(token, 'host');
      return state.window;
    } },
    onlyPreviewPreviewRegionService: { snapshot: () => state.current },
    showOnlyPreviewFileMenu: async () => { state.menus++; return state.result.promise; }
  }).Handler;
  state.handler = new Handler();
  state.open = (selectionRevision = 1) => state.handler.showPreviewFileMenu({
    hostToken: 'host', selectionRevision
  });
  return state;
};
const storeHarness = () => {
  const state = { calls: [], menu: deferred(), action: null, host: { hostToken: 'host' } };
  const Store = evaluate(`export class Store {
    ${methods('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts',
      ['showPreviewFileMenu', 'runPreviewFileAction', 'previewFileRef'])}
  }`, {
    onlyPreviewEnv: state.host,
    unwrapOnlyPreviewResult: unwrap,
    describeOnlyPreviewError: (error) => error.message,
    onlyPreviewClient: {
      showPreviewFileMenu: async (request) => {
        state.calls.push(['menu', request]);
        return state.menu.promise;
      },
      openExternally: async (request) => {
        state.calls.push(['open', request]);
        return state.action?.promise ?? success(undefined);
      },
      revealInFolder: async (request) => {
        state.calls.push(['reveal', request]);
        return state.action?.promise ?? success(undefined);
      }
    }
  }).Store;
  state.store = new Store();
  state.store.previewPresentation = presentation();
  state.store.previewFileMenuOpen = false;
  state.store.previewActionError = '';
  return state;
};

test('native menu imports resolve against the app host configuration', () => {
  const configPath = resolve(root, 'tsconfig.node.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const path = resolve(root, 'src/main/miniapps/onlypreview/onlyPreviewFileMenu.service.ts');
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
    const specifier = statement.moduleSpecifier.text;
    const result = ts.resolveModuleName(specifier, path, options, ts.sys);
    assert.ok(result.resolvedModule, `Unresolved native-menu import: ${specifier}`);
  }
});

test('native menu has exactly two localized actions and is owned by the current window', async () => {
  for (const [index, action] of ['open', 'reveal'].entries()) {
    const state = nativeHarness();
    const pending = state.open();
    assert.deepEqual(state.template.map((item) => item.label), ['Localized Open', 'Localized Reveal']);
    assert.equal(state.popup.window, state.window);
    state.template[index].click();
    state.popup.callback();
    assert.equal(await pending, action);
    assert.equal(state.window.listenerCount('closed'), 0);
  }
});

test('native cancellation, owner close and popup failure settle without leaking listeners', async () => {
  const cancelled = nativeHarness();
  const pending = cancelled.open();
  cancelled.popup.callback();
  assert.equal(await pending, null);
  assert.equal(cancelled.window.listenerCount('closed'), 0);
  const closed = nativeHarness();
  const closing = closed.open();
  closed.window.destroyed = true;
  closed.window.emit('closed');
  assert.equal(await closing, null);
  assert.equal(closed.window.listenerCount('closed'), 0);
  assert.equal(await closed.open(), null);
  const failed = nativeHarness();
  failed.failure = new Error('Popup unavailable');
  await assert.rejects(failed.open(), /Popup unavailable/);
  assert.equal(failed.window.listenerCount('closed'), 0);
});

test('Main rejects invalid/stale/no-file requests and never exposes a path in the menu request', async () => {
  const state = handlerHarness();
  await assert.rejects(state.open(-1), /Invalid revision/);
  await assert.rejects(state.handler.showPreviewFileMenu({ hostToken: 'other', selectionRevision: 1 }));
  assert.equal(unwrap(await state.open(2)), null);
  state.current.fileRef = null;
  assert.equal(unwrap(await state.open()), null);
  assert.equal(state.menus, 0);
});

test('Main drops a choice when the presentation or owner changes while the menu is open', async () => {
  for (const change of ['revision', 'window', 'file']) {
    const state = handlerHarness();
    const pending = state.open();
    if (change === 'revision') state.current = presentation(2);
    if (change === 'window') state.window.isDestroyed = () => true;
    if (change === 'file') state.current.fileRef = null;
    state.result.resolve('open');
    assert.equal(unwrap(await pending), null);
  }
  const state = handlerHarness();
  const pending = state.open();
  state.result.resolve('reveal');
  assert.equal(unwrap(await pending), 'reveal');
});

test('Shell dispatches either choice through existing routes including external files', async () => {
  for (const action of ['open', 'reveal']) {
    const state = storeHarness();
    state.store.previewPresentation = presentation(1, 'external-workspace');
    const pending = state.store.showPreviewFileMenu();
    assert.equal(state.store.previewFileMenuOpen, true);
    await state.store.showPreviewFileMenu();
    assert.equal(state.calls.length, 1);
    assert.deepEqual(state.calls[0], ['menu', { hostToken: 'host', selectionRevision: 1 }]);
    state.menu.resolve(success(action));
    await pending;
    assert.deepEqual(state.calls[1], [action, {
      hostToken: 'host', workspaceId: 'external-workspace', relativePath: 'document.pdf'
    }]);
    assert.equal(state.store.previewFileMenuOpen, false);
  }
});

test('Shell ignores cancellation, stale results and absent previews without affecting another file', async () => {
  for (const change of ['cancel', 'revision', 'missing']) {
    const state = storeHarness();
    const pending = state.store.showPreviewFileMenu();
    if (change === 'revision') state.store.previewPresentation = presentation(2);
    if (change === 'missing') state.store.previewPresentation = null;
    state.menu.resolve(success(change === 'cancel' ? null : 'open'));
    await pending;
    assert.equal(state.calls.length, 1);
    assert.equal(state.store.previewFileMenuOpen, false);
  }
  const state = storeHarness();
  state.store.previewPresentation = null;
  await state.store.showPreviewFileMenu();
  assert.equal(state.calls.length, 0);
});

test('menu/action errors are visible only on the originating preview and pending state resets', async () => {
  const state = storeHarness();
  const pending = state.store.showPreviewFileMenu();
  state.menu.resolve({ ok: false, error: { message: 'Menu failed' } });
  await pending;
  assert.equal(state.store.previewActionError, 'Menu failed');
  assert.equal(state.store.previewFileMenuOpen, false);
  for (const stale of [false, true]) {
    const action = storeHarness();
    action.action = deferred();
    action.menu.resolve(success('open'));
    const opening = action.store.showPreviewFileMenu();
    await new Promise((done) => setImmediate(done));
    if (stale) action.store.previewPresentation = presentation(2);
    action.action.resolve({ ok: false, error: { message: 'Open failed' } });
    await opening;
    assert.equal(action.store.previewActionError, stale ? '' : 'Open failed');
    assert.equal(action.store.previewFileMenuOpen, false);
  }
});

test('header renders one keyboard-accessible IconBtn and retains the action error indicator', async () => {
  const filename = 'src/renderer/onlypreview/shell/src/components/FileActions/FileActions.vue';
  const { descriptor, errors } = parse(read(filename), { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'header-file-menu' });
  transformSync(script.content, { loader: 'ts' });
  const template = compileTemplate({
    source: descriptor.template.content, filename, id: 'header-file-menu',
    compilerOptions: { bindingMetadata: script.bindings }
  });
  assert.deepEqual(template.errors, []);
  assert.equal((descriptor.template.content.match(/<IconBtn\b/gu) ?? []).length, 1);
  assert.doesNotMatch(descriptor.template.content, /<a-button|onlypreview__openExternally|onlypreview__reveal/u);
  assert.match(descriptor.template.content, /aria-haspopup="menu"/u);
  assert.match(descriptor.template.content, /:aria-expanded="onlyPreviewShellStore.previewFileMenuOpen"/u);
  assert.match(descriptor.template.content, /:aria-label="onlyPreviewI18n.preview.fileActions"/u);
  assert.match(descriptor.template.content, /onlypreview__fileActionError/u);
  assert.match(descriptor.template.content, /showPreviewFileMenu\(\)/u);
  const css = await less.render(read(filename.replace('.vue', '.less')));
  assert.match(css.css, /width: 27px/u);
  assert.match(css.css, /:focus-visible/u);
  const i18n = read('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.match(i18n, /fileActions: 'File actions'/u);
  assert.match(i18n, /fileActions: '文件操作'/u);
});
