/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const mocks = {
  electron: `
    export class WebContentsView {
      constructor() {
        this.bounds = { x: 0, y: 0, width: 0, height: 0 };
        this.visible = true;
        this.destroyed = false;
        this.boundsWrites = [];
        this.visibilityWrites = [];
        this.failNextBoundsWrite = false;
        this.closeCount = 0;
        this.inputListeners = new Map();
        this.ignoredMenuShortcuts = [];
        this.webContents = {
          on: (name, listener) => this.inputListeners.set(name, listener),
          setIgnoreMenuShortcuts: (ignore) => this.ignoredMenuShortcuts.push(ignore),
          isDestroyed: () => this.destroyed,
          loadFile: () => Promise.resolve(),
          loadURL: () => Promise.resolve(),
          close: () => { this.destroyed = true; this.closeCount++; }
        };
      }
      getBounds() {
        if (this.destroyed) throw new Error('Read from destroyed view');
        return { ...this.bounds };
      }
      setBounds(bounds) {
        if (this.destroyed) throw new Error('Write to destroyed view');
        if (this.failNextBoundsWrite) {
          this.failNextBoundsWrite = false;
          throw new Error('Native bounds write failed');
        }
        this.bounds = { ...bounds };
        this.boundsWrites.push({ ...bounds });
      }
      getVisible() { return this.visible; }
      setVisible(visible) {
        if (this.destroyed) throw new Error('Write to destroyed view');
        this.visible = visible;
        this.visibilityWrites.push(visible);
      }
    }
  `,
  '@electron-toolkit/utils': 'export const is = { dev: false };',
  inversify: 'export const injectable = () => (target) => target; export class Container {}',
  'reflect-metadata': '',
  '@maestro-main/data/maestroDataRoot': 'export const MAESTRO_PARTITION = "test:maestro";'
};

const bundled = await build({
  stdin: {
    contents: `
      export { createBoundsApplier } from './src/main/maestro/windows/main/viewBounds.ts';
      export { MaestroControlViewService } from './src/main/maestro/windows/main/maestroControlView.service.ts';
      export { WebContentsView } from 'electron';
    `,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json'),
  define: {
    __dirname: JSON.stringify(resolve(root, 'out/main')),
    'import.meta.env.VITE_MODE': JSON.stringify('release')
  },
  plugins: [
    {
      name: 'maestro-native-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'maestro-native-mock' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'maestro-native-mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const encoded = Buffer.from(bundled.outputFiles[0].text).toString('base64');
const { createBoundsApplier, MaestroControlViewService, WebContentsView } = await import(
  `data:text/javascript;base64,${encoded}`
);

const openRect = { x: 800, y: 78, width: 480, height: 722 };
const closedRect = { x: 1280, y: 78, width: 0, height: 722 };

const createControl = () => {
  const children = [];
  const visibleWhenAttached = [];
  const service = new MaestroControlViewService();
  service.setState({
    browserWindow: {
      contentView: {
        addChildView(view) {
          children.push(view);
          visibleWhenAttached.push(view.getVisible());
        }
      }
    },
    emitTrace(event) {
      assert.fail(`Unexpected Control trace: ${JSON.stringify(event)}`);
    }
  });
  return { service, children, visibleWhenAttached };
};

test('only Control receives chat shortcut routing; another native view is untouched', async () => {
  const { service, children } = createControl();
  const otherView = new WebContentsView();
  await service.create();
  assert.equal(children[0].inputListeners.has('before-input-event'), true);
  assert.equal(otherView.inputListeners.size, 0);
  service.reset();
});

test('precise chat H/N chords bypass the menu without consuming DOM keyboard events', async () => {
  const { service, children } = createControl();
  await service.create();
  const view = children[0];
  const onInput = view.inputListeners.get('before-input-event');
  const modifier = process.platform === 'darwin' ? { meta: true } : { control: true };
  const event = { preventDefault: () => assert.fail('DOM keyboard events must reach ChatPanel') };
  for (const key of ['h', 'H', 'n', 'N']) {
    onInput(event, { type: 'keyDown', key, ...modifier });
    assert.equal(view.ignoredMenuShortcuts.at(-1), true);
    onInput(event, { type: 'keyUp', key, ...modifier });
    assert.equal(view.ignoredMenuShortcuts.at(-1), false);
  }
  for (const input of [
    { key: 't' }, { key: 'w' }, { key: 'q' }, { key: 'r' }, { key: 'a' },
    { key: 'h', alt: true }, { key: 'h', shift: true }, { key: 'h', isComposing: true },
    { key: 'h', meta: false, control: false }
  ]) {
    onInput(event, { type: 'keyDown', ...modifier, ...input });
    assert.equal(view.ignoredMenuShortcuts.at(-1), false);
  }
  service.reset();
});

test('native bounds round coordinates and clamp negative dimensions', () => {
  const apply = createBoundsApplier();
  const view = new WebContentsView();
  apply(view, { x: -4.7, y: 78.3, width: -0.8, height: 721.7 });
  assert.deepEqual(view.getBounds(), { x: -5, y: 78, width: 0, height: 722 });
  apply(view, { x: -4.6, y: 78.2, width: -20, height: 721.9 });
  assert.equal(view.boundsWrites.length, 1);
});

test('native bounds already at the requested rectangle need no initial or repeated write', () => {
  const apply = createBoundsApplier();
  const view = new WebContentsView();
  view.setBounds(openRect);
  const previousWrites = view.boundsWrites.length;
  apply(view, openRect);
  apply(view, { ...openRect });
  assert.equal(view.boundsWrites.length, previousWrites);
});

test('a repeated geometry report repairs an out-of-band native write', () => {
  const apply = createBoundsApplier();
  const view = new WebContentsView();
  apply(view, closedRect);
  view.setBounds(openRect);
  apply(view, closedRect);
  assert.deepEqual(view.getBounds(), closedRect);
  assert.equal(view.boundsWrites.length, 3);
});

test('native bounds suppression is per view and ignores null or destroyed views', () => {
  const apply = createBoundsApplier();
  const first = new WebContentsView();
  const second = new WebContentsView();
  apply(first, openRect);
  apply(second, openRect);
  assert.equal(first.boundsWrites.length, 1);
  assert.equal(second.boundsWrites.length, 1);
  first.webContents.close();
  assert.doesNotThrow(() => apply(null, closedRect));
  assert.doesNotThrow(() => apply(first, closedRect));
  assert.equal(first.boundsWrites.length, 1);
});

test('a failed native bounds write is retried for the same report', () => {
  const apply = createBoundsApplier();
  const view = new WebContentsView();
  view.failNextBoundsWrite = true;
  assert.throws(() => apply(view, openRect), /Native bounds write failed/);
  apply(view, openRect);
  assert.deepEqual(view.getBounds(), openRect);
  assert.equal(view.boundsWrites.length, 1);
});

test('Control is hidden before attachment and stays hidden until it has geometry', async () => {
  const { service, children, visibleWhenAttached } = createControl();
  await service.create();
  assert.deepEqual(visibleWhenAttached, [false]);
  assert.equal(children[0].getVisible(), false);
  assert.equal(children[0].boundsWrites.length, 0);
});

test('Control layout and renderer bounds share normalization and native write suppression', async () => {
  const { service, children } = createControl();
  await service.create();
  const view = children[0];
  service.layout({ x: 800.2, y: 77.8, width: 479.8, height: 722.2 });
  assert.deepEqual(view.getBounds(), openRect);
  assert.equal(view.getVisible(), true);
  service.setBounds(openRect);
  service.layout(openRect);
  assert.equal(view.boundsWrites.length, 1);
  service.setBounds(closedRect);
  service.layout(closedRect);
  assert.deepEqual(view.getBounds(), closedRect);
  assert.equal(view.getVisible(), false);
  assert.equal(view.boundsWrites.length, 2);
});

test('Control visibility requires both rounded dimensions to be positive', async () => {
  const { service, children } = createControl();
  await service.create();
  const view = children[0];
  for (const method of ['layout', 'setBounds']) {
    for (const dimension of ['width', 'height']) {
      service[method](openRect);
      assert.equal(view.getVisible(), true);
      service[method]({ ...openRect, [dimension]: 0.49 });
      assert.equal(view.getBounds()[dimension], 0);
      assert.equal(view.getVisible(), false);
      service[method]({ ...openRect, [dimension]: -3 });
      assert.equal(view.getBounds()[dimension], 0);
      assert.equal(view.getVisible(), false);
      service[method]({ ...openRect, [dimension]: 0.51 });
      assert.equal(view.getBounds()[dimension], 1);
      assert.equal(view.getVisible(), true);
    }
  }
});

test('repeated Control close corrects native geometry and visibility after external changes', async () => {
  const { service, children } = createControl();
  await service.create();
  const view = children[0];
  service.setBounds(closedRect);
  view.setBounds(openRect);
  view.setVisible(true);
  service.setBounds(closedRect);
  assert.deepEqual(view.getBounds(), closedRect);
  assert.equal(view.getVisible(), false);
  for (let index = 0; index < 3; index++) {
    service.layout(openRect);
    assert.equal(view.getVisible(), true);
    service.setBounds(closedRect);
    assert.equal(view.getVisible(), false);
  }
});

test('Control reset closes the previous view and recreation accepts the same rectangle', async () => {
  const { service, children, visibleWhenAttached } = createControl();
  await service.create();
  const first = children[0];
  service.setBounds(openRect);
  service.reset();
  service.reset();
  assert.equal(first.closeCount, 1);
  assert.doesNotThrow(() => service.layout(closedRect));
  assert.doesNotThrow(() => service.setBounds(closedRect));
  await service.create();
  const second = children[1];
  assert.deepEqual(visibleWhenAttached, [false, false]);
  assert.equal(second.getVisible(), false);
  service.setBounds(openRect);
  assert.deepEqual(second.getBounds(), openRect);
  assert.equal(second.getVisible(), true);
  assert.equal(second.boundsWrites.length, 1);
  service.setBounds(closedRect);
  assert.equal(second.getVisible(), false);
  assert.equal(first.boundsWrites.length, 1);
});

test('Control methods safely ignore an already destroyed native view', async () => {
  const { service, children } = createControl();
  await service.create();
  children[0].webContents.close();
  assert.doesNotThrow(() => service.layout(openRect));
  assert.doesNotThrow(() => service.setBounds(openRect));
  assert.doesNotThrow(() => service.reset());
  assert.equal(children[0].closeCount, 1);
});
