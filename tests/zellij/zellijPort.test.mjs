import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSync } from 'esbuild';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COWORK = join(APP, '..', 'micromeet-cowork', 'apps', 'cowork');

const directory = mkdtempSync(join(tmpdir(), 'zellij-port-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'port.cjs');
buildSync({
  entryPoints: [join(APP, 'src/main/zellij/zellijPort.service.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const {
  resolveZellijPort,
  ZELLIJ_BASE_PORT,
  ZELLIJ_PORT_BLOCK_SIZE,
  ZELLIJ_PORT_ENV_VAR
} = createRequire(import.meta.url)(outfile);

const PROFILES = [
  'production',
  'production-preview',
  'production-debug',
  'test-debug',
  'test-release'
];

test('every runtime profile gets its own port so side-by-side installs never collide', () => {
  const ports = PROFILES.map((profile) => resolveZellijPort(profile, {}));

  // Distinctness is the point: two profiles on one port means the second one to start either fails
  // with port-occupied or, worse, attaches to the other profile's shells — the probe accepts any
  // version-matching server.
  assert.equal(new Set(ports).size, PROFILES.length);
  assert.equal(ports[0], ZELLIJ_BASE_PORT, 'production keeps the base port across releases');
  for (const port of ports) {
    assert.ok(port >= ZELLIJ_BASE_PORT && port < ZELLIJ_BASE_PORT + ZELLIJ_PORT_BLOCK_SIZE);
  }
});

test('the two apps reserve disjoint blocks', {
  skip: existsSync(COWORK) ? false : 'micromeet-cowork is not checked out beside this repo'
}, () => {
  // A cross-repo source check: an overlap is invisible in either repo alone and reads at runtime as
  // one app driving the other's shells.
  const theirs = readFileSync(join(COWORK, 'src/main/zellij/zellijPort.service.ts'), 'utf8');
  const theirBase = Number(/ZELLIJ_BASE_PORT = (\d+)/.exec(theirs)?.[1]);
  assert.ok(Number.isFinite(theirBase));
  assert.ok(
    theirBase >= ZELLIJ_BASE_PORT + ZELLIJ_PORT_BLOCK_SIZE,
    `bitterless ${ZELLIJ_BASE_PORT}..${ZELLIJ_BASE_PORT + ZELLIJ_PORT_BLOCK_SIZE - 1} overlaps cowork ${theirBase}`
  );
});

test('an explicit override wins for every profile', () => {
  for (const profile of ['production', 'test-debug']) {
    assert.equal(resolveZellijPort(profile, { [ZELLIJ_PORT_ENV_VAR]: '23456' }), 23456);
  }
  // Absent and blank are "not configured", not "configured badly".
  assert.equal(resolveZellijPort('production', {}), 12877);
  assert.equal(resolveZellijPort('production', { [ZELLIJ_PORT_ENV_VAR]: '   ' }), 12877);
});

test('an unusable override throws instead of silently starting somewhere else', () => {
  for (const bad of ['0', '80', '70000', 'abc', '12877.5', '-1']) {
    assert.throws(
      () => resolveZellijPort('production', { [ZELLIJ_PORT_ENV_VAR]: bad }),
      /must be an integer port/,
      `expected ${bad} to be rejected`
    );
  }
});

test('the origin is derived from the resolved port, never a constant', () => {
  const { zellijOriginForPort } = createRequire(import.meta.url)(outfile);
  assert.equal(zellijOriginForPort(resolveZellijPort('production', {})), 'http://127.0.0.1:12877');
  assert.equal(
    zellijOriginForPort(resolveZellijPort('production-preview', {})),
    'http://127.0.0.1:12878'
  );
});
