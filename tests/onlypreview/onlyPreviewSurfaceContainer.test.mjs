import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');
// These files carry long "why" comments that quote the code they replaced, so an assertion about
// what the code does must not read the history above it.
const code = (relativePath) =>
  source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const HELPER = 'src/main/windows/onlyPreviewWindow.helper.ts';
const MOUNT = 'src/main/windows/onlyPreviewStandaloneMount.ts';
const SEAM = 'src/main/onlypreview/onlyPreviewSurface.mount.ts';
const LAYERS = 'src/main/onlypreview/views/onlyPreviewViewLayer.service.ts';

test('the composite is parented by its own container, not by the window', () => {
  const layers = source(LAYERS);
  // The layer service must know nothing about windows: its parent is a `View`, so the same
  // algorithm works whether that view fills a window or a region of somebody else's window.
  assert.match(layers, /start\(container: View\): void/);
  assert.match(layers, /container\.addChildView\(occupant\.view\)/);
  const layerCode = code(LAYERS);
  assert.doesNotMatch(layerCode, /BaseWindow/, 'the layer service must not depend on a window type');
  assert.doesNotMatch(
    layerCode,
    /contentView/,
    'the layer service must not reach for a window content view'
  );
});

test('the container reaches its host before anything sorts into it', () => {
  const helper = source(HELPER);
  const attach = helper.indexOf('mount.attach(surfaceContainer)');
  const start = helper.indexOf('onlyPreviewViewLayerService.start(surfaceContainer)');
  assert.ok(attach > 0, 'the helper must attach the surface container through its mount');
  assert.ok(start > 0, 'the layer service must be started on the container');
  // A first sort into a container that is not yet in the window would attach the shell to a view
  // with no parent, which paints nothing and gives no error.
  assert.ok(attach < start, 'the container must reach the host before the first sort');
  assert.doesNotMatch(
    helper,
    /onlyPreviewViewLayerService\.start\(window\)/,
    'the layer service must never be started on a window again'
  );
});

test('only the mount touches the host window view tree', () => {
  // The whole point of the seam: the composite asks its mount, and the mount is the only code that
  // knows a window is involved. A stray `contentView` call in the helper would be a second host
  // implementation hiding in the composite.
  assert.deepEqual(
    code(HELPER).match(/contentView|getContentSize/g),
    null,
    'the window helper must not reach for a window content view or its size'
  );
  const mount = code(MOUNT);
  assert.deepEqual(
    mount.match(/contentView\.\w+\([^)]*\)/g),
    ['contentView.addChildView(container)', 'contentView.removeChildView(container)'],
    'the mount attaches and detaches exactly the container, and nothing else'
  );
});

test('one detach releases the whole composite', () => {
  // The layers are children of the container, so teardown removes the container and they go with
  // it. Removing the shell alone would leave the container — and any overlay still in it — attached.
  const helper = code(HELPER);
  assert.match(helper, /mount\?\.detach\(\)/);
  assert.match(helper, /this\.surfaceContainer = null;/);
  assert.match(helper, /this\.standaloneMount = null;/);
  assert.doesNotMatch(helper, /removeChildView/, 'detaching is the mount\'s job, not the helper\'s');
});

test('exactly one place turns a host into a surface size', () => {
  // `contentSize()` is what a second host reimplements; everything downstream is host-agnostic
  // because it only ever sees a width and a height.
  const mount = code(MOUNT);
  assert.deepEqual(
    mount.match(/getContentSize\(\)/g),
    ['getContentSize()'],
    'the mount must translate the window exactly once'
  );
  assert.match(mount, /contentSize\(\): OnlyPreviewSurfaceSize \| null/);
  assert.match(mount, /container\.setBounds\(\{ x: 0, y: 0, \.\.\.size \}\)/);
});

test('the seam declares no host, and the composite asks it for liveness', () => {
  const seam = code(SEAM);
  assert.match(seam, /export interface OnlyPreviewMount/);
  // `View` exposes no `isDestroyed()`, so liveness is a question for the host, not a property of a
  // window the composite should not be holding.
  assert.match(seam, /isAlive\(\): boolean/);
  assert.doesNotMatch(seam, /maestro|Maestro/, 'the seam must not name a host');
  for (const path of [
    'src/main/onlypreview/views/onlyPreviewAlertView.service.ts',
    'src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts',
    'src/main/onlypreview/views/onlyPreviewPreviewView.service.ts',
    'src/main/onlypreview/views/onlyPreviewAlertWindow.service.ts',
    'src/main/onlypreview/views/onlyPreviewGlobalSearchWindow.service.ts'
  ]) {
    const service = code(path);
    assert.match(service, /isHostLive/, `${path} must ask the host for liveness`);
    assert.doesNotMatch(
      service,
      /window\.isDestroyed\(\)/,
      `${path} must not interrogate a window it does not own`
    );
  }
});
