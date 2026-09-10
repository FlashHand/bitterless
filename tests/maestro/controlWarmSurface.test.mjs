import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import less from 'less';
import postcss from 'postcss';
import { parse, compileTemplate } from '@vue/compiler-sfc';
import { transform } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const directory = 'src/renderer/maestro/control/src';
const read = (file) => readFileSync(resolve(root, directory, file), 'utf8');
const styles = ["ControlApp.less","ChatPanel.less","MessageList.less"];
const css = postcss.parse((await Promise.all(styles.map(async (file) =>
  (await less.render(read(file), { filename: resolve(root, directory, file) })).css
))).join('\n'));
const declarations = (selector) => {
  const result = {};
  css.walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
  });
  return result;
};

test('chat surface is subtly warm while the surrounding cool gray is unchanged', () => {
  const outer = declarations('.control-app');
  assert.equal(outer['--control-chat-surface'], '#fffcf7');
  assert.equal(outer.background, '#f8fafc');
  assert.equal(declarations('.control-app__card').background, 'var(--control-chat-surface)');
  assert.equal(declarations('.chat-panel__textarea:focus').background, 'var(--control-chat-surface)');
});

test('large inner surfaces do not cover the warm card with pure white', () => {
  for (const selector of ['.control-app__toolbar', '.control-app__state', '.chat-panel', '.chat-panel__composer', '.message-list']) {
    assert.equal(declarations(selector).background, 'transparent', selector);
  }
  assert.equal(declarations('.chat-panel__textarea').background, '#fbfcfe');
  assert.match(declarations('.control-app__card--focused')['box-shadow'], /var\(--primary-6\)/);

});

test('affected chat templates, TypeScript scripts and Less compile', async () => {
  for (const file of ['ControlApp.vue', 'ChatPanel.vue', 'MessageList.vue']) {
    const { descriptor, errors } = parse(read(file), { filename: file });
    assert.deepEqual(errors, [], file);
    const template = compileTemplate({ source: descriptor.template.content, filename: file, id: 'warm-surface', compilerOptions: { expressionPlugins: ['typescript'] } });
    assert.deepEqual(template.errors, [], file);
    for (const script of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
      await transform(script.content, { loader: script.lang === 'ts' ? 'ts' : 'js' });
    }
  }
});
