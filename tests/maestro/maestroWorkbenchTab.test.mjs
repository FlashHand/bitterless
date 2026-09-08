/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';
import { transform } from 'esbuild';
import less from 'less';
import { MAESTRO_WORKBENCH_DISPLAY_URL } from '../../src/shared/maestro/coach.api.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const menuPath = 'src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue';
const source = read(menuPath);
const { descriptor, errors } = parse(source, { filename: menuPath });
const nodes = [];
function walk(node) {
  if (node.type === 1) nodes.push(node);
  for (const child of node.children ?? []) walk(child);
}
walk(baseParse(descriptor.template.content));
const attr = (node, name) => node.props.find((prop) => prop.type === 6 && prop.name === name)?.value?.content;
const binding = (node, directive, name) => node.props.find((prop) =>
  prop.type === 7 && prop.name === directive && prop.arg?.content === name)?.exp?.content;
const named = (name) => nodes.find((node) => attr(node, 'name') === name);

test('Workbench menu compiles and gear has no toggle, pressed style, or filled icon', async () => {
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'workbench-tab' });
  assert.deepEqual(compileTemplate({
    source: descriptor.template.content,
    filename: menuPath,
    id: 'workbench-tab',
    compilerOptions: { bindingMetadata: script.bindings }
  }).errors, []);
  await transform(script.content, { loader: 'ts' });
  await less.render(read('src/renderer/maestro/home/src/components/MenuBar/MenuBar.less'));
  const gear = named('menubar__workbench__open');
  assert.equal(binding(gear, 'on', 'click'), 'workbenchStore.openTab()');
  assert.equal(binding(gear, 'bind', 'class'), 'navBtn');
  assert.equal(binding(gear, 'bind', 'aria-pressed'), undefined);
  assert.doesNotMatch(gear.loc.source, /IconSettingsFilled|workbenchStore\.visible|toggle/u);
});

test('Workbench is one closable fixed chip after pinned tabs, independent of browser persistence', () => {
  assert.equal(nodes.filter((node) => attr(node, 'name') === 'menubar__workbench__tab').length, 1);
  const chip = named('menubar__workbench__tab');
  assert.equal(attr(chip, 'role'), 'tab');
  assert.equal(binding(chip, 'bind', 'aria-selected'), 'workbenchStore.visible');
  assert.equal(binding(chip, 'on', 'click'), 'workbenchStore.openTab()');
  assert.equal(binding(named('menubar__workbench__close'), 'on', 'click'), 'workbenchStore.close()');
  assert.match(source, /v-if="workbenchStore.open && i === workbenchChipAfterIndex"/u);
  assert.match(source, /findLastIndex\(\(tab\) => tab.pinned\)/u);
  assert.match(source, /return tab.active && !workbenchStore.visible/u);
  assert.match(source, /await workbenchStore.background\(\)[\s\S]*?await tabStore.activate\(id\)/u);
  assert.match(read('src/renderer/maestro/home/src/components/MenuBar/MenuBar.less'),
    /__tab--workbench \{ width: 132px; flex-shrink: 0; \}/u);
  assert.doesNotMatch(read('src/renderer/maestro/home/src/store/workbench.store.ts'), /localStorage|tabs\.push/u);
  assert.match(read('src/renderer/maestro/workbench/src/workbench.store.ts'), /await coach.closeWorkbenchTab\(\)/u);
});

test('Workbench shows its own address and disables hidden-page navigation without rewriting its URL', () => {
  assert.equal(MAESTRO_WORKBENCH_DISPLAY_URL, 'bitterless://workbench');
  const input = nodes.find((node) => node.tag === 'input');
  assert.equal(input.props.find((prop) => prop.name === 'model').exp.content, 'addressValue');
  assert.equal(binding(input, 'bind', 'disabled'), 'workbenchStore.visible || tabStore.activeLocked');
  assert.match(source, /get: \(\) => workbenchStore.visible \? MAESTRO_WORKBENCH_DISPLAY_URL : menuBarStore.url/u);
  assert.match(source, /if \(!workbenchStore.visible\) menuBarStore.url = value/u);
  for (const action of ['back', 'forward', 'reload']) {
    const button = nodes.find((node) => binding(node, 'on', 'click') === `menuBarStore.${action}()`);
    assert.match(binding(button, 'bind', 'disabled'), /^workbenchStore.visible/u);
  }
});
