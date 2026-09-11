import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

/**
 * `zellij web` has no session flag — it serves every session, and the web client picks one from the
 * URL PATH (`/` and `/<name>` return byte-identical HTML; the choice happens in its JavaScript).
 *
 * The name is per SURFACE, not per runtime profile. Keying on the profile meant every terminal
 * resolved to the same `bitterless` session, so "Initialize and open" reattached to the previous
 * session instead of starting a fresh one, and a second terminal drove the first one's panes.
 */
const directory = mkdtempSync(join(tmpdir(), 'zellij-session-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'session.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijSession.service.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const {
  resolveZellijSessionName,
  zellijSessionPrefix,
  zellijSessionUrl,
  ZELLIJ_SESSION_BASE_NAME,
  ZELLIJ_SESSION_MAX_LENGTH
} = createRequire(import.meta.url)(outfile);

const PROFILES = ['production', 'production-preview', 'production-debug', 'test-debug', 'test-release'];

test('two surfaces never share a session, so a new terminal is a NEW shell', () => {
  // This is the defect Ral hit: every surface resolved to one profile-wide name, so opening a
  // second terminal — or pressing "Initialize and open" again — reattached to the existing panes.
  const a = resolveZellijSessionName('production', 'surface-a');
  const b = resolveZellijSessionName('production', 'surface-b');
  assert.notEqual(a, b);
});

test('the same surface id always resolves to the same session, which is what restore relies on', () => {
  // A restored tab is reconstructed with its STORED id; deriving the name from it is the whole
  // mechanism by which the shell comes back.
  assert.equal(
    resolveZellijSessionName('production', 'surface-a'),
    resolveZellijSessionName('production', 'surface-a')
  );
});

test('profiles stay distinguishable, because they can run side by side', () => {
  const names = PROFILES.map((profile) => resolveZellijSessionName(profile, 'same-surface'));
  assert.equal(new Set(names).size, PROFILES.length);
  assert.equal(zellijSessionPrefix('production'), ZELLIJ_SESSION_BASE_NAME);
  for (const name of names) assert.match(name, /^[a-z][a-z0-9-]*$/);
});

test('an id that sanitises away is refused, never collapsed onto a shared session', () => {
  // Returning a bare prefix would silently put every such surface on ONE session — precisely the
  // bug this design exists to prevent.
  for (const id of ['', '///', '  ']) {
    assert.throws(() => resolveZellijSessionName('production', id), /no usable characters/);
  }
});

test('names stay legal in both places they appear: the Zellij CLI and a URL path', () => {
  for (const id of ['A1B2-C3D4', 'a b/c', 'UPPER_case']) {
    const name = resolveZellijSessionName('production', id);
    assert.match(name, /^[a-z0-9-]+$/, `${id} produced an unusable name: ${name}`);
    assert.ok(name.length <= ZELLIJ_SESSION_MAX_LENGTH);
    // Sanitised, so encoding is a no-op — a name needing escapes would mean the sanitiser leaked.
    assert.equal(zellijSessionUrl('http://127.0.0.1:12877', name), `http://127.0.0.1:12877/${name}`);
  }
});
