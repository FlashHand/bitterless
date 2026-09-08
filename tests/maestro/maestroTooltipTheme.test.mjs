import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { Tooltip } from '@arco-design/web-vue';
import less from 'less';
import postcss from 'postcss';

const root = resolve(import.meta.dirname, '../..');
const renderer = 'src/renderer/maestro';
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const stylePath = `${renderer}/common/assets/style/arco/tooltip.less`;
const { css } = await less.render(read(stylePath), { filename: resolve(root, stylePath) });
const rules = new Map();
postcss.parse(css).walkRules((rule) => {
  rules.set(
    rule.selector,
    Object.fromEntries(
      rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value])
    )
  );
});

test('Chat uses native Arco Tooltip and loads the shared tooltip theme', () => {
  assert.match(
    read(`${renderer}/control/src/ChatPanel.vue`),
    /import\s*\{[^}]*\bTooltip\b[^}]*\}\s*from\s*['"]@arco-design\/web-vue['"]/u
  );
  assert.match(
    read(`${renderer}/control/src/control.ts`),
    /import ['"]\.\.\/\.\.\/common\/style\.css['"]/u
  );
  assert.match(
    read(`${renderer}/common/style.css`),
    /@import ['"]\.\/assets\/style\/theme\.less['"]/u
  );
  assert.match(
    read(`${renderer}/common/assets/style/theme.less`),
    /@import ['"]\.\/arco\/tooltip\.less['"]/u
  );
});

test('real Arco Tooltip keeps its arrow and placement for regular and mini tooltips', async () => {
  for (const mini of [false, true]) {
    let trigger;
    const app = createSSRApp({
      render: () =>
        h(
          Tooltip,
          { content: 'Set workspace', popupVisible: true, mini },
          {
            default: () => h('button', 'Workspace')
          }
        )
    });
    app.mixin({
      created() {
        if (this.$options.name === 'Trigger') trigger = this.$props;
      }
    });
    await renderToString(app);
    assert.ok(trigger);
    assert.equal(trigger.showArrow, true);
    assert.equal(trigger.position, 'top');
    assert.equal(trigger.popupOffset, 10);
    assert.ok(trigger.arrowClass.includes('arco-tooltip-popup-arrow'));
    assert.ok(trigger.contentClass.includes('arco-tooltip-content'));
    assert.equal(trigger.contentClass.at(-1)['arco-tooltip-mini'], mini);
  }
});

test('compiled theme uses matching opaque surfaces without replacing Arco geometry', async () => {
  const content = rules.get('.arco-tooltip-content');
  const arrow = rules.get('.arco-tooltip-popup-arrow');
  assert.deepEqual([...rules.keys()], ['.arco-tooltip-content', '.arco-tooltip-popup-arrow']);
  assert.equal(content['background-color'], '#5c5f65');
  assert.equal(arrow['background-color'], content['background-color']);
  const alpha = await less.render(
    `.alpha { content: alpha(${content['background-color']}); arrow: alpha(${arrow['background-color']}); }`
  );
  const values = [];
  postcss.parse(alpha.css).walkDecls((declaration) => values.push(declaration.value));
  assert.deepEqual(values, ['1', '1']);
  assert.equal(content['border-radius'], '10px');
  assert.equal(content.border, '0.5px solid rgba(255, 255, 255, 0.12)');
  assert.equal(content['box-shadow'], '0 6px 24px rgba(0, 0, 0, 0.18)');
  assert.deepEqual(Object.keys(content).sort(), [
    'background-color',
    'border',
    'border-radius',
    'box-shadow'
  ]);
  assert.deepEqual(Object.keys(arrow), ['background-color']);
});
