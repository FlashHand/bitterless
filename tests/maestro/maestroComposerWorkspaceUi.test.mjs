import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';
import { compile, createSSRApp, defineComponent } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { Button, Tooltip } from '@arco-design/web-vue';
import { IconFolderOpen, IconFolderSearch, IconX } from '@tabler/icons-vue';
import { JSDOM } from 'jsdom';
import { transform } from 'esbuild';
import less from 'less';
import postcss from 'postcss';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const panelPath = 'src/renderer/maestro/control/src/ChatPanel.vue';
const panel = read(panelPath);
const stylePath = 'src/renderer/maestro/control/src/ChatPanel.less';
const style = read(stylePath);
const workspaceSelect = '.chat-panel__workspace .chat-panel__workspace-select.arco-btn';
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

const findWorkspaceNode = (node) => {
  if (node.type === 1 && node.props.some((prop) => prop.type === 6 &&
    prop.name === 'name' && prop.value?.content === 'maestro__composer__workspace')) return node;
  for (const child of node.children ?? []) {
    const found = findWorkspaceNode(child);
    if (found) return found;
  }
};
const workspaceNode = findWorkspaceNode(baseParse(descriptor.template.content));
const workspaceTemplate = workspaceNode.loc.source.replace(/\s+v-else-if="[^"]+"/u, '');
const iconButton = parse(read('src/renderer/common/components/IconBtn/IconBtn.vue')).descriptor;
const IconBtn = defineComponent({
  inheritAttrs: false,
  // eslint-disable-next-line vue/no-reserved-component-names -- Keep the actual IconBtn template's Arco binding.
  components: { Button },
  render: compile(iconButton.template.content)
});
// Same order as control.ts and ControlApp.vue: Arco, shared themes, IconBtn, ChatPanel,
// then ControlApp's broad button rules. Keep the actual rules, including !important.
const cascadePaths = [
  'node_modules/@arco-design/web-vue/es/button/style/index.css',
  'src/renderer/maestro/common/style.css',
  'src/renderer/common/components/IconBtn/IconBtn.less',
  stylePath,
  'src/renderer/maestro/control/src/ControlApp.less'
];
const cascadeStyle = (await Promise.all(cascadePaths.map(async (path) =>
  (await less.render(read(path), { filename: resolve(root, path) })).css
))).join('\n');
const renderWorkspace = async (workspaceLabel = 'bitterless') => {
  const unexpectedInteraction = () => assert.fail('SSR must not invoke a workspace action');
  const app = createSSRApp({
    components: { Button, Tooltip, IconBtn, IconFolderOpen, IconFolderSearch, IconX },
    data: () => ({
      workspaceLabel,
      workspaceTitle: '/workspace',
      turnLocked: false,
      session: { archivedAt: null }
    }),
    methods: {
      revealWorkspace: unexpectedInteraction,
      chooseWorkspace: unexpectedInteraction,
      clearWorkspace: unexpectedInteraction
    },
    render: compile(workspaceTemplate)
  });
  const html = await renderToString(app);
  const dom = new JSDOM(`<style>${cascadeStyle}</style><div class="control-app"><div class="chat-panel">${html}<button class="arco-btn arco-btn-text arco-btn-shape-square" data-unrelated>Unrelated</button></div></div>`);
  const query = (selector) => dom.window.document.querySelector(selector);
  return { dom, query, computed: (selector) => dom.window.getComputedStyle(query(selector)) };
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
    panel.indexOf('name="maestro__composer__attach"')
  );
  assert.ok(workspace.includes('{{ workspaceLabel }}'));
  assert.match(workspace, /@click="revealWorkspace"/u);
  assert.match(workspace, /aria-label="Switch workspace"[\s\S]*?@click="chooseWorkspace"/u);
  assert.match(workspace, /aria-label="Clear workspace"[\s\S]*?@click="clearWorkspace"/u);
  assert.equal(
    (workspace.match(/:disabled="turnLocked \|\| Boolean\(session\.archivedAt\)"/gu) ?? []).length,
    3
  );
  assert.match(panel, /i18nHelper\.maestroControl\.chat\.chooseWorkspace/u);
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

test('workspace is capped at 280px and matches Cowork at 26px tall while only the project name truncates', () => {
  const workspace = declarations('.chat-panel__workspace');
  const button = declarations(workspaceSelect);
  const content = declarations('.chat-panel__workspace-content');
  const label = declarations('.chat-panel__workspace-label');
  assert.equal(workspace['max-width'], '280px');
  assert.equal(workspace['min-height'], '26px');
  assert.equal(workspace.flex, '0 1 auto');
  assert.equal(workspace.width, undefined);
  assert.equal(workspace.height, '26px');
  assert.equal(button.height, '24px');
  assert.equal(button['min-height'], '24px');
  assert.equal(button['white-space'], 'nowrap');
  assert.equal(label['white-space'], 'nowrap');
  assert.equal(label['text-overflow'], 'ellipsis');
  assert.equal(label.overflow, 'hidden');
  assert.equal(label['overflow-wrap'], undefined);
  for (const rule of [workspace, button, content, label]) {
    assert.equal(rule['min-width'], '0');
  }
  assert.equal(workspace.overflow, 'hidden', 'the outer shell clips segmented hover backgrounds');
  for (const rule of [button, content]) assert.notEqual(rule.overflow, 'hidden');
  const choose = declarations('.chat-panel__choose-workspace.arco-btn');
  assert.equal(choose.height, '26px');
  assert.equal(choose['max-width'], '280px');
  assert.doesNotMatch(style, /min\(220px, 42vw\)|min\(140px, 32vw\)|max-width:\s*(?:220|140|260)px/u);
});

test('workspace actions remain fixed-width and footer actions always retain their separate line', () => {
  const action = declarations('.chat-panel__workspace-action.icon-btn.arco-btn');
  assert.equal(action.width, '28px');
  assert.equal(action['min-width'], '28px');
  assert.equal(action.flex, '0 0 28px');
  assert.equal(action.height, '24px');
  assert.equal(declarations('.chat-panel__composer-tools')['min-width'], '0');
  assert.equal(declarations('.chat-panel__composer-footer')['flex-direction'], 'column');
  assert.equal(declarations('.chat-panel__composer-footer')['align-items'], 'stretch');
  assert.equal(declarations('.chat-panel__workspace-icon').color, '#165dff');
  assert.equal(declarations('.chat-panel__workspace').border, '1px solid #d9e2ee');
});

test('workspace uses three independent mini tooltips without a nested outer trigger', () => {
  const elements = [];
  const walk = (node, parent) => {
    if (node.type === 1) elements.push({ node, parent });
    for (const child of node.children ?? []) walk(child, node);
  };
  walk(baseParse(descriptor.template.content));
  const attr = (node, name) => node.props.find((prop) => prop.type === 6 && prop.name === name);
  const workspace = elements.find(({ node }) => attr(node, 'name')?.value?.content === 'maestro__composer__workspace');
  assert.equal(workspace.node.tag, 'div');
  assert.notEqual(workspace.parent.tag, 'Tooltip');
  const tooltips = workspace.node.children.filter((node) => node.type === 1);
  assert.equal(tooltips.length, 3);
  const actions = ['revealWorkspace', 'chooseWorkspace', 'clearWorkspace'];
  for (const [index, tooltip] of tooltips.entries()) {
    assert.equal(tooltip.tag, 'Tooltip');
    assert.ok(attr(tooltip, 'mini'));
    assert.equal(attr(tooltip, 'position').value.content, 'top');
    const button = tooltip.children.find((node) => node.type === 1);
    assert.equal(button.props.find((prop) => prop.name === 'on' && prop.arg.content === 'click').exp.content, actions[index]);
    assert.equal(attr(button, 'title'), undefined, 'native title must not duplicate the mini tooltip');
    assert.ok(attr(button, 'aria-label'));
  }
  assert.equal(tooltips[0].props.find((prop) => prop.name === 'bind' && prop.arg.content === 'content').exp.content, 'workspaceTitle');
  assert.equal(attr(tooltips[1], 'content').value.content, 'Switch workspace');
  assert.equal(attr(tooltips[2], 'content').value.content, 'Clear workspace');
});

test('workspace compact typography, icon alignment and segmented interaction states match the reference', () => {
  const button = declarations(workspaceSelect);
  const content = declarations('.chat-panel__workspace-content');
  const icon = declarations('.chat-panel__workspace-icon');
  const action = declarations('.chat-panel__workspace-action.icon-btn.arco-btn');
  assert.equal(button['font-size'], '12px');
  assert.equal(button['font-weight'], '600');
  assert.equal(button.padding, '0 8px');
  assert.equal(button.color, '#374151');
  assert.equal(content.display, 'flex');
  assert.equal(content['align-items'], 'center');
  assert.equal(content.gap, '6px');
  assert.equal(icon.width, '16px');
  assert.equal(icon.height, '16px');
  assert.equal(icon.flex, '0 0 16px');
  assert.equal(action['border-left'], '1px solid #edf2f7');
  for (const selector of ['.chat-panel__workspace-select.arco-btn', '.chat-panel__workspace-action.icon-btn.arco-btn']) {
    assert.equal(declarations(`${selector}:hover:not([disabled])`).background, '#f4f7fb');
    assert.equal(declarations(`${selector}:focus-visible`).outline, '2px solid #165dff');
    assert.equal(declarations(`${selector}[disabled]`).cursor, 'not-allowed');
  }
  assert.equal(declarations('.chat-panel__workspace-action.icon-btn.arco-btn:active').transform, 'none');
});

test('real Arco default-slot DOM contains the owned flex row, visible icon gap and blue folder', async () => {
  const { dom, query, computed } = await renderWorkspace();
  try {
    const content = query('.chat-panel__workspace-content');
    assert.ok(content, 'the flex row must exist in rendered DOM, not just in a CSS selector');
    assert.ok(content.parentElement.matches('button.arco-btn.chat-panel__workspace-select'));
    assert.equal(content.getAttribute('name'), 'maestro__composer__workspace-content');
    assert.ok(content.children[0].matches('svg.chat-panel__workspace-icon'));
    assert.ok(content.children[1].matches('span.chat-panel__workspace-label'));
    assert.equal(query('.arco-btn-content'), null, 'this installed Arco version has no default-slot content wrapper');
    assert.equal(computed('.chat-panel__workspace-content').display, 'flex');
    assert.equal(computed('.chat-panel__workspace-content').alignItems, 'center');
    assert.equal(computed('.chat-panel__workspace-content').gap, '6px');
    assert.equal(computed('.chat-panel__workspace-icon').color, 'rgb(22, 93, 255)');
    assert.ok(query('.chat-panel__workspace-action > .arco-btn-icon > svg'), 'IconBtn retains its real Arco icon slot');
  } finally {
    dom.window.close();
  }
});

test('real shared Button cascade leaves one outer radius, straight dividers and a 26px border-box shell', async () => {
  const { dom, query, computed } = await renderWorkspace();
  try {
    assert.equal(computed('[data-unrelated]').borderRadius, '10px', 'global important rule must remain present and unchanged');
    for (const button of query('.chat-panel__workspace').querySelectorAll('button')) {
      assert.equal(dom.window.getComputedStyle(button).borderRadius, '0px', 'local segmentation must beat the shared important radius');
    }
    const shell = computed('.chat-panel__workspace');
    const select = computed('.chat-panel__workspace-select');
    const action = computed('.chat-panel__workspace-action');
    assert.equal(shell.borderRadius, '6px');
    assert.equal(shell.overflow, 'hidden');
    assert.equal(shell.boxSizing, 'border-box');
    assert.equal(shell.minHeight, '26px');
    assert.equal(shell.height, '26px');
    assert.equal(select.minHeight, '24px');
    assert.equal(select.height, '24px');
    // jsdom's computed font shorthand/longhand inheritance is incomplete. The typography
    // assertions above cover the owned declaration; this selector has three classes versus
    // ControlApp's two, so the later broad rule cannot override it in the browser cascade.
    assert.ok(query('.chat-panel__workspace-select').matches(workspaceSelect));
    assert.equal(workspaceSelect.split('.').length - 1, 3);
    assert.equal(select.paddingLeft, '8px');
    assert.equal(select.paddingRight, '8px');
    assert.equal(action.height, '24px');
    assert.equal(action.width, '28px');
    assert.equal(action.borderLeftWidth, '1px');
    assert.equal(action.borderLeftStyle, 'solid');
    assert.equal(parseFloat(shell.borderTopWidth) + parseFloat(action.height) + parseFloat(shell.borderBottomWidth), 26);
  } finally {
    dom.window.close();
  }
});

test('real long workspace names retain their text but truncate without growing the shell', async () => {
  const name = 'workspace-'.repeat(24);
  const { dom, query, computed } = await renderWorkspace(name);
  try {
    assert.equal(query('.chat-panel__workspace-label').textContent, name);
    const label = computed('.chat-panel__workspace-label');
    assert.equal(label.whiteSpace, 'nowrap');
    assert.equal(label.overflow, 'hidden');
    assert.equal(label.textOverflow, 'ellipsis');
    assert.equal(computed('.chat-panel__workspace').maxWidth, '280px');
    assert.equal(computed('.chat-panel__workspace').height, '26px');
    assert.equal(computed('.chat-panel__workspace-select').height, '24px');
    assert.equal(computed('.chat-panel__workspace-action').flexShrink, '0');
  } finally {
    dom.window.close();
  }
});

test('provider, model and effort align right beside delivery controls without moving the context row', () => {
  const models = declarations('.chat-panel__model-controls');
  assert.equal(models.display, 'flex');
  assert.equal(models['justify-content'], 'flex-end');
  assert.equal(models.flex, '1 1 auto');
  assert.equal(models['min-width'], '0');
  assert.equal(models['white-space'], undefined);
  assert.equal(models.width, undefined);
  assert.equal(declarations('.chat-panel__composer-actions')['justify-content'], 'flex-end');
  assert.equal(declarations('.chat-panel__composer-footer')['flex-direction'], 'column');
  assert.ok(panel.indexOf('class="chat-panel__model-controls"') < panel.indexOf('class="chat-panel__voice-button"'));
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
