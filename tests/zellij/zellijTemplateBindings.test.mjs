import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * `@change="zellijStore.setEnabled"` shipped and crashed at runtime with
 * `Cannot read properties of undefined (reading 'toggling')`.
 *
 * The store is a CLASS wrapped in `reactive()`, and this repo deliberately keeps class methods as
 * method shorthand rather than arrow fields (arrow class fields break `this`/prototype semantics —
 * see CLAUDE.md). So handing a method out as a bare reference detaches it: the framework calls it
 * with no receiver, and every `this.x` throws.
 *
 * TypeScript cannot see this — `zellijStore.setEnabled` is a perfectly typed function value. Only a
 * source rule catches it, so: in a template listener, a store method must be CALLED, never passed.
 */
const RENDERER_ROOT = 'src/renderer';

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : walk(full);
    return entry.name.endsWith('.vue') ? [full] : [];
  });

const templateOf = (source) => {
  const start = source.indexOf('<template>');
  const end = source.lastIndexOf('</template>');
  return start === -1 || end === -1 ? '' : source.slice(start, end);
};

test('no template hands a store method to a listener as a bare reference', () => {
  // Whole renderer, not one folder. Scoped to src/renderer/zellij this guard could not see
  // TerminalSetting.vue, which shipped the identical `@change="store.change"` defect — the same
  // class of bug in a different folder is exactly what a narrow guard licenses.
  const files = walk(RENDERER_ROOT);
  assert.ok(files.length > 0, 'expected SFCs to guard');

  const offenders = [];
  for (const name of files) {
    const template = templateOf(readFileSync(name, 'utf8'));
    // `@event="something.method"` with no `(` and no `=>` — i.e. a reference, not a call.
    for (const match of template.matchAll(/@[a-zA-Z-]+\s*=\s*"([^"]*)"/g)) {
      const expression = match[1].trim();
      if (expression.includes('(') || expression.includes('=>')) continue;
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(expression)) continue;
      if (!/[sS]tore\./.test(expression)) continue;
      offenders.push(`${name}: @${match[0].slice(1).split('=')[0].trim()}="${expression}"`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `bind a call, not a reference — e.g. @change="(v) => store.setEnabled(v)":\n${offenders.join('\n')}`
  );
});
