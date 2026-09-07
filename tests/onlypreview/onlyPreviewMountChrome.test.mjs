/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-mount-chrome-'));
const bundlePath = join(buildRoot, 'rendererTarget.mjs');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

// The argument builder is pure, but its module imports `shell` and `is` at load time. Bundling them
// away is what lets this be a behavioural test rather than another source assertion.
const electronStub = join(buildRoot, 'electron.stub.mjs');
const toolkitStub = join(buildRoot, 'toolkit.stub.mjs');
writeFileSync(electronStub, 'export const shell = { openExternal: () => undefined };\n');
writeFileSync(toolkitStub, 'export const is = { dev: false };\n');

await build({
  entryPoints: [join(projectRoot, 'src/main/onlypreview/views/onlyPreviewRendererTarget.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  alias: { electron: electronStub, '@electron-toolkit/utils': toolkitStub }
});

const { getOnlyPreviewRendererArguments } = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const host = { hostToken: 'token-1', hostId: 'host-1' };
const argFor = (args, name) =>
  args.find((value) => value.startsWith(`--onlypreview-${name}=`))?.split('=')[1] ?? null;

test('the renderer is told which host carries it, defaulting to a window', () => {
  // Every view already learns its identity and entry through additional arguments; the host kind
  // rides the same channel rather than introducing an IPC call for one immutable fact.
  assert.equal(argFor(getOnlyPreviewRendererArguments(host, 'shell'), 'host'), 'window');
  assert.equal(
    argFor(getOnlyPreviewRendererArguments(host, 'shell', undefined, undefined, undefined, undefined, 'cowork'), 'host'),
    'cowork'
  );
  assert.equal(
    argFor(getOnlyPreviewRendererArguments(host, 'preview', undefined, undefined, undefined, undefined, 'window'), 'host'),
    'window'
  );
});

test('the host argument never displaces the identity arguments', () => {
  const args = getOnlyPreviewRendererArguments(
    host,
    'preview',
    'runtime-1',
    'office-1',
    'read-1',
    'tag-1',
    'cowork'
  );
  assert.equal(argFor(args, 'host-token'), 'token-1');
  assert.equal(argFor(args, 'host-id'), 'host-1');
  assert.equal(argFor(args, 'mode'), 'preview');
  assert.equal(argFor(args, 'runtime-token'), 'runtime-1');
  assert.equal(argFor(args, 'open-tag'), 'tag-1');
  // `--onlypreview-host` and `--onlypreview-host-token` share a prefix, so a sloppy parser could
  // read one as the other. Both must survive together.
  assert.equal(argFor(args, 'host'), 'cowork');
});

test('an unrecognised host value resolves to the window, not to nothing', () => {
  // The preload resolves the argument, and the fallback direction matters: a surface that wrongly
  // believes it owns a window shows controls that fail loudly, while one that wrongly believes it is
  // embedded silently loses its own window controls.
  const preload = source('src/preload/onlypreview/onlyPreviewEnv.preload.ts');
  assert.match(preload, /getOnlyPreviewArgument\('onlypreview-host'\) === 'cowork' \? 'cowork' : 'window'/);
  assert.match(preload, /host: resolveHostSurface\(\)/);
});

test('the Shell renders only the window controls its host can honour', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.match(app, /const ownsWindow = onlyPreviewEnv\.host !== 'cowork';/);
  // Minimize and maximize are window affordances; so is the macOS traffic-light inset.
  assert.match(app, /v-if="isWindows && ownsWindow"/);
  assert.match(app, /'onlypreview-shell__menu-bar--windows': isWindows && ownsWindow/);
  // Close stays in both hosts — the mount maps it to a window or a tab.
  assert.match(app, /name="onlypreview__close"/);
  const closeIndex = app.indexOf('name="onlypreview__close"');
  const gateIndex = app.indexOf('v-if="isWindows && ownsWindow"');
  assert.ok(gateIndex > 0 && closeIndex > gateIndex, 'close lives inside the Windows control group');
});

test('the compiled MenuBar reserves macOS traffic-light space only in a native window', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const header = app.match(/<header\b[\s\S]*?>/);
  assert.ok(header, 'the Shell must expose its MenuBar header');
  const { code } = compile(`${header[0]}</header>`, { mode: 'function' });
  const render = new Function('Vue', code)(Vue);

  for (const [platform, host, macInset] of [
    ['darwin', 'window', true],
    ['darwin', 'cowork', false],
    ['win32', 'window', false],
    ['win32', 'cowork', false]
  ]) {
    const headerNode = render({
      isMac: platform === 'darwin',
      isWindows: platform === 'win32',
      ownsWindow: host !== 'cowork',
      handleMenuBarDoubleClick: () => undefined
    });
    assert.equal(headerNode.props.name, 'onlypreview__menuBar');
    assert.equal(
      headerNode.props.class.split(/\s+/).includes('onlypreview-shell__menu-bar--mac'),
      macInset,
      `${platform} / ${host} must use the appropriate left inset`
    );
  }
});
