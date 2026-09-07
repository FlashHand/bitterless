import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { transform } from 'esbuild';
import less from 'less';
import postcss from 'postcss';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const panelPath = 'src/renderer/maestro/control/src/ChatPanel.vue';
const panel = read(panelPath);
const stylePath = 'src/renderer/maestro/control/src/ChatPanel.less';
const style = read(stylePath);
const { descriptor, errors } = parse(panel, { filename: panelPath });
const compiledStyle = await less.render(style, { filename: resolve(root, stylePath) });
const css = postcss.parse(compiledStyle.css);
const declarations = (selector) => {
  const properties = {};
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((declaration) => {
      properties[declaration.prop] = declaration.value;
    });
  });
  return properties;
};

test('ChatPanel script, template and sibling Less compile without changing its workspace entry', async () => {
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'maestro-composer-workspace' });
  const template = compileTemplate({
    source: descriptor.template.content,
    filename: panelPath,
    id: 'maestro-composer-workspace',
    compilerOptions: { bindingMetadata: script.bindings }
  });
  assert.deepEqual(template.errors, []);
  await transform(script.content, { loader: 'ts', target: 'es2022' });
  assert.ok(compiledStyle.css.includes('.chat-panel__workspace'));
});

test('workspace keeps the full name, absolute-path tooltip and independent Open, Switch, Clear actions', () => {
  assert.match(
    panel,
    /workspaceLabel = computed\(\(\) => workspace\.value\?\.name \|\| 'Workspace'\)/u
  );
  assert.match(
    panel,
    /workspaceTitle = computed\(\(\) => workspace\.value\?\.path \|\| 'Set workspace'\)/u
  );
  assert.match(panel, /:content="workspaceTitle"/u);
  const workspace = panel.slice(
    panel.indexOf('name="maestro__composer__workspace"'),
    panel.indexOf('</Tooltip>', panel.indexOf('name="maestro__composer__workspace"'))
  );
  assert.ok(workspace.includes('{{ workspaceLabel }}'));
  assert.match(workspace, /@click="revealWorkspace"/u);
  assert.match(workspace, /title="Switch workspace"[\s\S]*?@click="chooseWorkspace"/u);
  assert.match(workspace, /title="Clear workspace"[\s\S]*?@click="clearWorkspace"/u);
  assert.equal(
    (workspace.match(/:disabled="turnLocked \|\| Boolean\(session\.archivedAt\)"/gu) ?? []).length,
    3
  );
  assert.match(panel, /title="Set workspace"/u);
  for (const action of ['revealWorkspace', 'chooseWorkspace', 'clearWorkspace']) {
    const handler = panel.slice(panel.indexOf(`async function ${action}(`));
    assert.match(
      handler.slice(0, handler.indexOf('\n}')),
      /if \(turnLocked\.value \|\| props\.session\.archivedAt\) return/u
    );
  }
  assert.match(panel, /coach\.openWorkspaceInPreview\(\{ path \}\)/u);
  assert.doesNotMatch(panel, /IconRefresh|refreshWorkspace|Refresh workspace/u);
});

test('workspace name wraps naturally, including unbroken names, without clipping or viewport caps', () => {
  const workspace = declarations('.chat-panel__workspace');
  const button = declarations('.chat-panel__workspace-select.arco-btn');
  const content = declarations('.chat-panel__workspace-select .arco-btn-content');
  const label = declarations('.chat-panel__workspace-label');
  assert.equal(workspace['max-width'], '100%');
  assert.equal(workspace['min-height'], '32px');
  assert.equal(workspace.flex, '0 1 auto');
  assert.equal(workspace.width, undefined);
  assert.equal(workspace.height, undefined);
  assert.equal(button.height, 'auto');
  assert.equal(button['min-height'], '30px');
  assert.equal(button['white-space'], 'normal');
  assert.equal(label['white-space'], 'normal');
  assert.equal(label['overflow-wrap'], 'anywhere');
  for (const rule of [workspace, button, content, label]) {
    assert.equal(rule['min-width'], '0');
    assert.notEqual(rule.overflow, 'hidden');
    assert.notEqual(rule['text-overflow'], 'ellipsis');
  }
  assert.doesNotMatch(style, /min\(220px, 42vw\)|min\(140px, 32vw\)|max-width:\s*(?:220|140)px/u);
});

test('workspace actions remain fixed-width and narrow footer actions retain their separate line', () => {
  const action = declarations('.chat-panel__workspace-action.icon-btn.arco-btn');
  assert.equal(action.width, '28px');
  assert.equal(action['min-width'], '28px');
  assert.equal(action.flex, '0 0 28px');
  assert.equal(action.height, '30px');
  assert.equal(declarations('.chat-panel__composer-tools')['min-width'], '0');
  const narrow = css.nodes.find(
    (node) =>
      node.type === 'atrule' && node.name === 'container' && node.params === '(max-width: 480px)'
  );
  assert.ok(narrow);
  const footer = narrow.nodes.find((node) => node.selector === '.chat-panel__composer-footer');
  assert.ok(footer.nodes.some((node) => node.prop === 'flex-wrap' && node.value === 'wrap'));
  assert.equal(declarations('.chat-panel__workspace-icon').color, '#4e5882');
  assert.equal(declarations('.chat-panel__workspace').border, '1px solid #e2e4eb');
});

test('the updated workspace verification guard forbids Refresh but retains the store API', () => {
  const guard = read('scripts/maestro/check-workspace-files.mjs');
  const start = guard.indexOf('assert(chatPanel.includes(\'name="maestro__composer__workspace"\')');
  const end = guard.indexOf('assert(messageItem.includes(', start);
  assert.ok(start >= 0 && end > start);
  const runGuard = new Function('chatPanel', 'messageStore', 'assert', guard.slice(start, end));
  runGuard(
    panel,
    read('src/renderer/maestro/control/src/store/message.store.ts'),
    (condition, message) => assert.ok(condition, message)
  );
});
