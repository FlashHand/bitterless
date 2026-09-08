/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import ts from 'typescript';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const shell = 'src/renderer/onlypreview/shell/src/';
const main = 'src/main/miniapps/onlypreview/';
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let finish;
  const promise = new Promise((done) => { finish = done; });
  return { promise, finish };
};
const extract = (path, method) => {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (!method) return ast.statements.filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(ast)).join('\n');
  const owner = ast.statements.find(ts.isClassDeclaration);
  return owner.members.find((node) => node.name?.getText(ast) === method).getText(ast);
};
const evaluate = (source, bindings = {}) => {
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const module = { exports: {} };
  new Function('module', 'exports', ...Object.keys(bindings), code)(
    module, module.exports, ...Object.values(bindings)
  );
  return module.exports;
};
const unwrap = (result) => { if (!result.ok) throw new Error(result.error.message); return result.value; };
const file = (relativePath) => ({ relativePath, nodeKind: 'file' });
const folder = (relativePath) => ({ relativePath, nodeKind: 'directory' });
const selection = evaluate(extract('src/shared/onlypreview/onlyPreviewDeleteSelection.shared.ts'));
const shortcutHarness = () => {
  const result = deferred(), calls = [];
  class Element {
    isContentEditable = false;
    editableAncestor = false;
    closest() { return this.editableAncestor ? {} : null; }
  }
  const host = { workspace: { workspaceId: 'project-A' }, errorMessage: '' };
  const env = { hostToken: 'host', platform: 'darwin' };
  const document = { hasFocus: () => true };
  const state = { entries: [file('file.md')] };
  const { handleOnlyPreviewProjectDeleteShortcut: handle } = evaluate(
    extract(shell + 'onlyPreviewProjectDeleteShortcut.service.ts'), {
      HTMLElement: Element, document, onlyPreviewEnv: env, onlyPreviewShellStore: host,
      onlyPreviewTreeSelection: { entries: () => state.entries },
      unwrapOnlyPreviewResult: unwrap, describeOnlyPreviewError: (error) => error.message,
      onlyPreviewClient: { requestProjectDelete: (params) => { calls.push(params); return result.promise; } }
    }
  );
  const event = (changes = {}) => ({
    key: 'Backspace', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, repeat: false, isComposing: false, target: new Element(),
    preventDefault() { this.defaultPrevented = true; }, ...changes
  });
  return { handle, event, calls, result, Element, host, env, document, state };
};

test('Cmd+Delete sends the selected Project file once, consumes repeats and releases after cancellation', async () => {
  const h = shortcutHarness(), event = h.event();
  assert.equal(h.handle(event, true), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.calls, [{ hostToken: 'host', workspaceId: 'project-A', selection: [file('file.md')] }]);
  h.handle(h.event(), true); h.handle(h.event({ repeat: true }), true);
  assert.equal(h.calls.length, 1);
  h.result.finish({ ok: true, value: undefined }); await tick();
  h.handle(h.event({ key: 'Delete' }), true);
  assert.equal(h.calls.length, 2);
});

test('wrong platform/modifiers, inactive Project/Shell, input/rename and composition do not trigger deletion', () => {
  for (const changes of [
    { key: 'x' }, { metaKey: false }, { ctrlKey: true }, { altKey: true }, { shiftKey: true },
    { isComposing: true }, { defaultPrevented: true }, { target: null }
  ]) {
    const h = shortcutHarness(); assert.equal(h.handle(h.event(changes), true), false);
    assert.equal(h.calls.length, 0);
  }
  for (const mode of ['other-renderer', 'other-platform', 'input', 'rich-input', 'project-inactive']) {
    const h = shortcutHarness(), event = h.event();
    if (mode === 'other-renderer') h.document.hasFocus = () => false;
    if (mode === 'other-platform') h.env.platform = 'win32';
    if (mode === 'input') event.target.editableAncestor = true;
    if (mode === 'rich-input') event.target.isContentEditable = true;
    assert.equal(h.handle(event, mode !== 'project-inactive'), false);
    assert.equal(h.calls.length, 0);
  }
});

test('empty/root/no workspace selection is inert and a first repeat never opens a dialog', () => {
  for (const entries of [[], [folder('')], [folder(''), file('one.md')]]) {
    const h = shortcutHarness(); h.state.entries = entries;
    assert.equal(h.handle(h.event(), true), false); assert.equal(h.calls.length, 0);
  }
  const missing = shortcutHarness(); missing.host.workspace = null;
  assert.equal(missing.handle(missing.event(), true), false);
  const repeat = shortcutHarness(); repeat.handle(repeat.event({ repeat: true }), true);
  assert.equal(repeat.calls.length, 0);
});

test('errors stay in their originating Project and a rejected request can be retried', async () => {
  const h = shortcutHarness(); h.handle(h.event(), true);
  h.host.workspace = { workspaceId: 'project-B' };
  h.result.finish({ ok: false, error: { message: 'old failure' } }); await tick();
  assert.equal(h.host.errorMessage, '');
  h.handle(h.event(), true); await tick(); assert.equal(h.calls.length, 2);
  assert.equal(h.host.errorMessage, 'old failure');
});

const deleteHarness = () => {
  const confirm = deferred(), state = { confirms: 0, removed: [], errors: [], active: 'project-A', dialogCalls: 0 };
  const labels = new Proxy({}, { get: (_target, key) => String(key) });
  const { presentOnlyPreviewDeleteDialog } = evaluate(extract(main + 'onlyPreviewDeleteDialog.service.ts'), {
    ...selection, ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES: 10,
    onlyPreviewAlertWindowService: {
      requestConfirm: async () => { state.confirms++; return confirm.promise; },
      showError: async (_token, error) => state.errors.push(error),
      showProgress: () => '', updateProgress: () => {}, closeProgress: () => {}
    },
    i18nHelper: { getMessages: () => ({ app: { onlyPreviewFileMenu: labels } }) }
  });
  const Native = evaluate('export class Native { ' +
    extract(main + 'onlyPreviewProjectNativeAction.service.ts', 'deleteProjectSelectionFromMenu') + ' }', {
      presentOnlyPreviewDeleteDialog, process: { platform: 'darwin' }
    }).Native;
  const native = new Native();
  native.removeProjectEntry = async (_host, workspaceId, entry) => {
    assert.equal(workspaceId, state.active);
    state.removed.push(entry);
  };
  native.announceDeletedEntries = () => {};
  const Handler = evaluate('export class Handler { ' +
    extract('src/main/xpc/onlyPreview.handler.ts', 'requestProjectDelete') + ' }', {
      ...selection, OnlyPreviewContractError: Error,
      runOperation: async (_name, action) => action(),
      onlyPreviewWorkspaceRegistry: {
        getProjectAuthorityRootRef: (hostToken, workspaceId) => {
          assert.equal(hostToken, 'host'); assert.equal(workspaceId, state.active);
          return { host: { hostToken }, workspaceId };
        },
        getProjectAuthorityItemRef: () => ({})
      },
      onlyPreviewProjectNativeActionService: {
        deleteProjectSelectionFromMenu: (...args) => { state.dialogCalls++; return native.deleteProjectSelectionFromMenu(...args); }
      }
    }).Handler;
  const handler = new Handler();
  const request = (entries = [file('file.md')]) => handler.requestProjectDelete({
    hostToken: 'host', workspaceId: 'project-A', selection: entries
  });
  return { state, confirm, request };
};

test('shortcut IPC uses the existing dialog and cannot execute removal before confirmation or after Cancel', async () => {
  const h = deleteHarness(), pending = h.request();
  await tick(); assert.equal(h.state.confirms, 1); assert.deepEqual(h.state.removed, []);
  h.confirm.finish(false); await pending;
  assert.deepEqual(h.state.removed, []);
  const confirmed = deleteHarness();
  const done = confirmed.request([folder('docs'), file('docs/one.md'), file('other.md')]);
  confirmed.confirm.finish(true); await done;
  assert.deepEqual(confirmed.state.removed, [folder('docs'), file('other.md')]);
});

test('invalid/root/oversized requests never enter the dialog; obsolete Project cannot commit', async () => {
  for (const entries of [null, [], [folder('')], [file('../out.md')], [{ relativePath: 'link', nodeKind: 'symlink' }],
    Array.from({ length: 1001 }, (_, index) => file(index + '.md'))]) {
    const h = deleteHarness();
    await assert.rejects(h.request(entries)); assert.equal(h.state.dialogCalls, 0);
  }
  const stale = deleteHarness(), pending = stale.request();
  await tick(); stale.state.active = 'project-B'; stale.confirm.finish(true); await pending;
  assert.deepEqual(stale.state.removed, []);
});

test('Shell wires the guard in capture before other shortcuts and compiles without changing native preview handling', () => {
  const source = read(shell + 'App.vue');
  assert.match(source, /@keydown.capture="handleShellKeydown"/);
  assert.match(source, /handleOnlyPreviewProjectDeleteShortcut\([\s\S]*?activePanel === 'project' && !onlyPreviewProjectAuthoring.editing/);
  const filename = resolve(root, shell + 'App.vue'), { descriptor, errors } = parse(source, { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'delete-shortcut' });
  const template = compileTemplate({
    source: descriptor.template.content, filename, id: 'delete-shortcut',
    compilerOptions: { bindingMetadata: script.bindings }
  });
  assert.deepEqual(template.errors, []);
});

