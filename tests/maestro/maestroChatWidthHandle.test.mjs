/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as Vue from 'vue';
import { computed, reactive, ref } from 'vue';
import { compile, parse as parseTemplate } from '@vue/compiler-dom';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { transform } from 'esbuild';
import less from 'less';
import ts from 'typescript';
import { createPreviewFocusHarness } from '../onlypreview/onlyPreviewPreviewFocusTest.helper.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const controlPath = 'src/renderer/maestro/control/src/ControlApp.vue';
const layoutPath = 'src/renderer/maestro/home/src/views/layout/Layout.vue';
const control = parse(read(controlPath), { filename: controlPath }).descriptor;
const layoutSource = read('src/renderer/maestro/home/src/store/layout.store.ts');
const execute = (source, bindings, exports) => {
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getText(ast).replace(/^export /u, ''))
    .join('\n');
  const code = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return runInNewContext(`${code}\n({${exports.join(',')}});`, bindings);
};

const layoutHarness = (saved = {}) => {
  const storage = new Map(Object.entries(saved));
  const writes = [];
  const subscriptions = new Map();
  const { layoutStore, DEFAULT_SIDEBAR_W, MIN_SIDEBAR_W, MAX_SIDEBAR_W } = execute(
    layoutSource,
    {
      reactive,
      xpcRenderer: { subscribe: (name, callback) => subscriptions.set(name, callback) },
      localStorage: {
        getItem: (name) => storage.get(name) ?? null,
        setItem: (name, value) => {
          storage.set(name, value);
          writes.push([name, value]);
        }
      }
    },
    ['layoutStore', 'DEFAULT_SIDEBAR_W', 'MIN_SIDEBAR_W', 'MAX_SIDEBAR_W']
  );
  return {
    store: layoutStore,
    writes,
    subscriptions,
    limits: [DEFAULT_SIDEBAR_W, MIN_SIDEBAR_W, MAX_SIDEBAR_W]
  };
};

const controlHarness = (focused = false, onBroadcast = () => undefined) => {
  const calls = [];
  const mounted = [];
  const unmount = [];
  const listeners = new Map();
  const window = {
    innerWidth: 440,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  const handlers = execute(
    control.scriptSetup.content,
    {
      computed,
      ref,
      onMounted: (callback) => mounted.push(callback),
      onBeforeUnmount: (callback) => unmount.push(callback),
      createXpcRendererEmitter: () => ({
        getTabs: async () => [],
        getLlmConfig: async () => ({ presets: [], ready: true })
      }),
      xpcRenderer: {
        subscribe: () => {},
        broadcast: (name, params) => {
          calls.push({ name, ...params });
          onBroadcast(name, params);
        }
      },
      channelStore: { init: async () => {}, activeSession: null },
      messageStore: { setContextWindow: () => {}, compactAllIfNeeded: async () => {} },
      AUTH_BROADCAST: 'auth',
      window,
      document: { hasFocus: () => focused }
    },
    [
      'onResizeDown',
      'onResizeMove',
      'onResizeEnd',
      'onPanelFocus',
      'onPanelBlur',
      'closePanel',
      'resizing',
      'panelFocused'
    ]
  );
  const captured = [];
  const event = (overrides = {}) => ({
    button: 0,
    pointerId: 4,
    screenX: 1000,
    clientX: 4,
    currentTarget: { setPointerCapture: (id) => captured.push(id) },
    preventDefault: () => {},
    ...overrides
  });
  return { ...handlers, calls, mounted, unmount, listeners, window, event, captured };
};

const resizeEvents = (h) => {
  const root = parseTemplate(control.template.content).children.find((node) => node.type === 1);
  const handle = root.children.find((node) => node.type === 1 && node.props.some(
    (prop) => prop.type === 6 && prop.name === 'name' && prop.value?.content === 'maestroControl__resizeHandle'
  ));
  assert.ok(handle);
  const { code } = compile(handle.loc.source, { mode: 'function' });
  return new Function('Vue', code)(Vue)({
    ...h,
    resizing: h.resizing.value,
    i18nHelper: { menuBar: { maestro: { resizePanel: 'Resize chat' } } }
  }).props;
};

test('Maestro retains default480 and uses Cowork380–480 limits, clamping saved values', () => {
  assert.deepEqual(layoutHarness().limits, [480, 380, 480]);
  for (const [saved, expected] of [
    ['440.7', 441],
    ['1000', 480],
    ['10', 380],
    ['NaN', 480],
    ['Infinity', 480]
  ]) {
    assert.equal(layoutHarness({ 'coach.sidebarWidth': saved }).store.sidebarWidth, expected);
  }
  const main = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
  assert.match(main, /const SIDEBAR_W = 480/u);
});

test('width events update live geometry but persist only at gesture end; hide/reopen retains width', () => {
  const { store, writes, subscriptions } = layoutHarness();
  store.init();
  store.init();
  assert.equal(subscriptions.size, 2);
  const send = (params) => subscriptions.get('coach/sidebar-width')({ params });
  send({ resizing: true });
  send({ width: 20, resizing: true });
  assert.equal(store.sidebarWidth, 380);
  send({ width: 432.4, resizing: true });
  assert.equal(store.sidebarWidth, 432);
  assert.deepEqual(writes, []);
  send({ resizing: false });
  assert.deepEqual(writes, [['coach.sidebarWidth', '432']]);
  store.closeSidebar();
  store.toggleSidebar();
  assert.equal(store.sidebarOpen, true);
  assert.equal(store.sidebarWidth, 432);
  assert.equal(store.sidebarResizing, false);
});

test('capture stays in Chat and screenX deltas survive movement of the native view origin', () => {
  const h = controlHarness();
  h.onResizeDown(h.event());
  assert.deepEqual(h.captured, [4]);
  h.onResizeMove(h.event({ screenX: 1020, clientX: 24, buttons: 0 }));
  h.window.innerWidth = 420;
  h.onResizeMove(h.event({ screenX: 1010, clientX: -4, buttons: 0 }));
  h.onResizeMove(h.event({ pointerId: 9, screenX: 500 }));
  assert.deepEqual(
    h.calls.map(({ width }) => width),
    [undefined, 420, 430]
  );
  assert.ok(h.calls.every(({ name }) => name === 'coach/sidebar-width'));
  h.onResizeEnd(h.event());
  h.onResizeEnd(h.event());
  assert.equal(h.calls.filter(({ resizing }) => resizing === false).length, 1);
});

test('non-primary presses cannot resize; each terminal pointer event ends exactly once', () => {
  const ignored = controlHarness();
  ignored.onResizeDown(ignored.event({ button: 2 }));
  assert.equal(ignored.calls.length, 0);
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    const h = controlHarness();
    const events = resizeEvents(h);
    const terminal = events[`on${eventName[0].toUpperCase()}${eventName.slice(1)}`];
    events.onPointerdown(h.event());
    terminal(h.event({ pointerId: 9 }));
    assert.equal(h.resizing.value, true);
    terminal(h.event({ type: eventName }));
    terminal(h.event({ type: eventName }));
    assert.equal(h.resizing.value, false);
    assert.equal(h.calls.at(-1).resizing, false);
    assert.equal(h.calls.filter(({ resizing }) => resizing === false).length, 1);
  }
});

test('Chat focus uses document/window truth, removes the glow on blur, and cleans up on unmount', async () => {
  const h = controlHarness(true);
  await h.mounted[0]();
  assert.equal(h.panelFocused.value, true);
  h.listeners.get('blur')();
  assert.equal(h.panelFocused.value, false);
  h.listeners.get('focus')();
  assert.equal(h.panelFocused.value, true);
  assert.equal(h.calls.length, 0, 'focus feedback has no IPC');
  h.onResizeDown(h.event());
  h.unmount[0]();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.resizing.value, false);
  assert.equal(h.calls.at(-1).resizing, false);
});

test('closing settles once before hiding Chat; blur only removes the focus shadow', () => {
  const closing = controlHarness();
  closing.onResizeDown(closing.event());
  closing.closePanel();
  assert.deepEqual(
    closing.calls.slice(-2).map(({ name }) => name),
    ['coach/sidebar-width', 'coach/sidebar-close']
  );
  assert.equal(closing.calls.at(-2).resizing, false);
  closing.onResizeEnd(closing.event());
  closing.unmount[0]();
  assert.equal(closing.calls.filter(({ resizing }) => resizing === false).length, 1);
  const blurring = controlHarness();
  blurring.onPanelFocus();
  blurring.onResizeDown(blurring.event());
  blurring.onPanelBlur();
  assert.equal(blurring.panelFocused.value, false);
  assert.equal(blurring.resizing.value, true);
  blurring.onResizeMove(blurring.event({ screenX: 1040 }));
  assert.equal(blurring.calls.at(-1).width, 400);
  assert.equal(blurring.calls.some(({ resizing }) => resizing === false), false);
});

test('Chat drag drives real Home width and preview bounds continuously without stealing focus', async () => {
  const preview = createPreviewFocusHarness();
  const chatContents = preview.newContents();
  preview.state.focused = chatContents;
  preview.updateWidth(700);
  const home = layoutHarness({ 'coach.sidebarWidth': '440' });
  home.store.init();
  const h = controlHarness(true, (name, params) => {
    home.subscriptions.get(name)?.({ params });
    preview.updateWidth(1140 - home.store.sidebarWidth);
  });
  await h.mounted[0]();
  preview.state.onFocus = (_next, previous) => {
    if (previous === chatContents) h.listeners.get('blur')();
  };
  const events = resizeEvents(h);
  events.onPointerdown(h.event());
  for (const screenX of [1010, 1040, 1020]) {
    events.onPointermove(h.event({ screenX }));
    assert.equal(preview.state.focused, chatContents);
    assert.equal(h.resizing.value, true);
  }
  assert.deepEqual(h.calls.map(({ width }) => width), [undefined, 430, 400, 420]);
  assert.deepEqual(preview.state.focusClaims, []);
  assert.equal(preview.service.getVuePreviewView().bounds.width, 720);
  assert.deepEqual(home.writes, []);
  // A separate window blur changes only the glow; pointer capture still owns the gesture.
  h.listeners.get('blur')();
  events.onPointermove(h.event({ screenX: 1060 }));
  assert.equal(home.store.sidebarWidth, 380);
  assert.equal(preview.service.getVuePreviewView().bounds.width, 760);
  events.onPointerup(h.event());
  events.onLostpointercapture(h.event());
  h.unmount[0]();
  assert.deepEqual(home.writes, [['coach.sidebarWidth', '380']]);
  assert.equal(h.calls.filter(({ resizing }) => resizing === false).length, 1);
  preview.service.destroy();
});

test('changed Vue/TypeScript and Less compile; handle, focus and dynamic placeholder preserve the layout channel', async () => {
  for (const file of [controlPath, layoutPath]) {
    const parsed = parse(read(file), { filename: file });
    assert.deepEqual(parsed.errors, []);
    const script = compileScript(parsed.descriptor, { id: file });
    const template = compileTemplate({
      source: parsed.descriptor.template.content,
      filename: file,
      id: file,
      compilerOptions: { bindingMetadata: script.bindings }
    });
    assert.deepEqual(template.errors, []);
    await transform(script.content, { loader: 'ts', target: 'es2022' });
  }
  const controlCss = (await less.render(read(controlPath.replace('.vue', '.less')))).css;
  const layoutCss = (await less.render(read(layoutPath.replace('.vue', '.less')))).css;
  assert.match(
    controlCss,
    /\.control-app__resize-handle \{[^}]*position: absolute;[^}]*top: 0;[^}]*bottom: 0;[^}]*left: 0;[^}]*width: 8px;[^}]*cursor: col-resize;[^}]*touch-action: none;/u
  );
  assert.match(
    controlCss,
    /\.control-app__resize-handle--resizing:hover \{\s*background: rgba\(var\(--primary-6\), 0\.3\);/u
  );
  assert.match(
    controlCss,
    /\.control-app__card--focused \{\s*box-shadow: 0 0 0 2px rgba\(var\(--primary-6\), 0\.35\);/u
  );
  assert.match(layoutCss, /\.maestro-layout__control--resizing \{\s*transition: none;/u);
  const layout = read(layoutPath);
  assert.match(
    layout,
    /width: layoutStore\.sidebarOpen \? `\$\{layoutStore\.sidebarWidth\}px` : '0px'/u
  );
  assert.match(layout, /new ResizeObserver\(scheduleReport\)/u);
  assert.match(layout, /requestAnimationFrame\(/u);
  assert.match(control.template.content, /'control-app__card--focused': panelFocused/u);
  assert.match(
    control.template.content,
    /:aria-label="i18nHelper\.menuBar\.maestro\.resizePanel"/u
  );
  assert.doesNotMatch(layout, /resizeHandle/u);
});
