import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

/**
 * The seeded config is validated by the REAL bundled binary, not by eyeballing the KDL.
 *
 * Two mistakes this catches that nothing else would: colours in Zellij are space-separated RGB
 * triples (a hex string parses as KDL but is rejected by Zellij), and `explicit_theme_hue` /
 * `default_layout` are spelled exactly this way. Both would ship as "the terminal just will not
 * start" — and the seed runs before anyone can see a log.
 */
const BINARY = 'build/maestro-tools/zellij';
const directory = mkdtempSync(join(tmpdir(), 'zellij-default-config-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'default.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijDefaultConfig.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const { buildZellijDefaultConfig } = createRequire(import.meta.url)(outfile);

const check = (platform) => {
  const file = join(directory, `${platform}.kdl`);
  writeFileSync(file, buildZellijDefaultConfig({ platform }));
  return execFileSync(BINARY, ['--config', file, 'setup', '--check'], { encoding: 'utf8' });
};

test('the seeded config is accepted by the bundled Zellij on every platform default', {
  skip: existsSync(BINARY) ? false : `${BINARY} is not staged — run yarn tools:init`
}, () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.match(
      check(platform),
      /\[CONFIG FILE\]: Well defined\./,
      `${platform} default config was rejected by Zellij`
    );
  }
});

test('the seed carries a theme, because a browser tab has no palette to inherit', () => {
  const config = buildZellijDefaultConfig({ platform: 'darwin' });
  // The original seed wrote keybinds ONLY, which is precisely why every cell rendered white.
  assert.match(config, /^themes \{/m, 'no themes block');
  assert.match(config, /^theme "bitterless"$/m, 'theme defined but never selected');
  assert.match(config, /^explicit_theme_hue "dark"$/m);
  assert.match(config, /^default_layout "default"$/m);
  // RGB triples, not hex — the shape Zellij actually accepts.
  assert.match(config, /\n\s+fg \d{1,3} \d{1,3} \d{1,3}\n/);
  assert.doesNotMatch(config, /#[0-9a-fA-F]{6}/, 'hex colours are silently wrong here');
});

test('the seeded binds are the same ones the settings panel calls default', () => {
  // Hand-written binds here would read back as drift the first time the panel opened.
  const mac = buildZellijDefaultConfig({ platform: 'darwin' });
  assert.match(mac, /bind "Super d" \{ NewPane "Down"; \}/);
  assert.match(mac, /bind "Super Shift d" \{ NewPane "Right"; \}/);
  assert.match(mac, /bind "Super w" \{ CloseFocus; \}/);

  const other = buildZellijDefaultConfig({ platform: 'linux' });
  assert.match(other, /bind "Ctrl Alt w" \{ CloseFocus; \}/);
  assert.doesNotMatch(other, /Super/, 'Super is a macOS-only modifier here');
});
