import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-runtime-tests-'));
const load = (name) => {
  const output = join(directory, `${name}.cjs`);
  buildSync({
    entryPoints: [`src/main/zellij/${name}.service.ts`],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: output
  });
  return createRequire(import.meta.url)(output);
};
const { ZellijProcessService, parseZellijToken } = load('zellijProcess');
const { ZellijConfigService, resolveZellijConfigFile } = load('zellijConfig');
const { ZellijTokenService } = load('zellijToken');
test.after(() => rmSync(directory, { recursive: true, force: true }));

const TOKEN = '11111111-1111-4111-8111-111111111111';
const shortcuts = { splitDown: 'Super d', splitRight: 'Super Shift d', closePane: 'Ctrl w' };
const fixture = (overrides = {}) => {
  let enabled = false;
  let exitCallback;
  let exited = false;
  const calls = { spawn: 0, run: 0, stop: 0, config: 0, login: 0, token: 0 };
  const child = {
    stop: async () => {
      calls.stop += 1;
      exited = true;
    },
    onExit: (callback) => {
      exitCallback = callback;
    },
    exited: () => exited
  };
  const dependency = {
    config: {
      file: '/fixture/config.kdl',
      read: () => ({
        configFile: '/fixture/config.kdl',
        configDirectory: '/fixture',
        configRevision: 'revision',
        configExists: true,
        shortcuts
      }),
      initialize: async () => {
        calls.config += 1;
      },
      save: async () => {}
    },
    readEnabled: () => enabled,
    persistEnabled: (value) => {
      enabled = value;
    },
    checkBinary: () => {},
    run: async (args) => {
      assert.deepEqual(args, ['--config', '/fixture/config.kdl', 'web', '--create-token']);
      calls.run += 1;
      return `Created token successfully\n\ntoken_1: ${TOKEN}\n`;
    },
    spawn: (args) => {
      calls.spawn += 1;
      assert.deepEqual(args, [
        '--config',
        '/fixture/config.kdl',
        'web',
        '--start',
        '--ip',
        '127.0.0.1',
        '--port',
        '12877'
      ]);
      return child;
    },
    probe: async () => (calls.spawn ? 'matching' : 'absent'),
    login: async () => {
      calls.login += 1;
      return true;
    },
    readToken: () => null,
    writeToken: () => {
      calls.token += 1;
    },
    changed: () => {},
    delay: async () => {},
    ...overrides
  };
  const service = new ZellijProcessService(dependency);
  return {
    service,
    calls,
    dependency,
    exit: () => {
      exited = true;
      exitCallback?.();
    }
  };
};

test('opening state and enabling are read-only; explicit initialization owns one foreground server', async () => {
  const { service, calls } = fixture();
  assert.equal(service.snapshot().enabled, false);
  assert.equal((await service.initialize()).error, 'disabled');
  assert.equal(calls.spawn, 0);
  assert.equal(calls.config, 0);
  await service.setEnabled(true);
  assert.equal(calls.spawn, 0);
  const first = service.initialize();
  assert.equal(service.initialize(), first);
  assert.equal((await first).status, 'ready');
  assert.equal(calls.spawn, 1);
  assert.equal(calls.run, 1);
  await service.setEnabled(false);
  assert.equal(calls.stop, 1);
  assert.equal(service.snapshot().status, 'idle');
});

test('matching external server is reused and never killed; occupied/version mismatch fails closed', async () => {
  const reused = fixture({ probe: async () => 'matching', readToken: () => TOKEN });
  await reused.service.setEnabled(true);
  assert.equal((await reused.service.initialize()).status, 'ready');
  await reused.service.stop();
  assert.equal(reused.calls.spawn, 0);
  assert.equal(reused.calls.run, 0);
  assert.equal(reused.calls.stop, 0);
  for (const probe of ['occupied', 'mismatch']) {
    const current = fixture({ probe: async () => probe });
    await current.service.setEnabled(true);
    const state = await current.service.initialize();
    assert.equal(state.error, probe === 'occupied' ? 'port-occupied' : 'version-mismatch');
    assert.equal(current.calls.spawn, 0);
    assert.equal(current.calls.run, 0);
  }
});

test('authentication failure stops only an owned server and snapshots never contain credentials', async () => {
  const current = fixture({ login: async () => false });
  await current.service.setEnabled(true);
  const state = await current.service.initialize();
  assert.equal(state.error, 'authentication-failed');
  assert.equal(current.calls.stop, 1);
  assert.ok(!JSON.stringify(state).includes(TOKEN));
  assert.throws(() => parseZellijToken('unrecognized token output'), /token-failed/);
});

test('retry with an absent listener stops the previous owned child before replacing it', async () => {
  let spawned = 0;
  let probeCount = 0;
  const stopped = [];
  const current = fixture({
    probe: async () => (++probeCount % 2 === 1 ? 'absent' : 'matching'),
    spawn: () => {
      const id = ++spawned;
      return { stop: async () => stopped.push(id), onExit: () => {}, exited: () => false };
    }
  });
  await current.service.setEnabled(true);
  assert.equal((await current.service.initialize()).status, 'ready');
  assert.equal((await current.service.initialize()).status, 'ready');
  assert.equal(spawned, 2);
  assert.deepEqual(stopped, [1]);
  await current.service.stop();
  assert.deepEqual(stopped, [1, 2]);
});

test('disable during token creation fences late login/readiness and never restarts the server', async () => {
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  let tokenStarted;
  const entered = new Promise((resolve) => {
    tokenStarted = resolve;
  });
  const current = fixture({
    run: async () => {
      tokenStarted();
      return waiting;
    }
  });
  await current.service.setEnabled(true);
  const open = current.service.initialize();
  await entered;
  await current.service.setEnabled(false);
  finish(`token_1: ${TOKEN}`);
  const state = await open;
  assert.equal(state.enabled, false);
  assert.equal(state.status, 'idle');
  assert.equal(current.calls.stop, 1);
  assert.equal(current.calls.login, 0);
  assert.equal(current.calls.token, 0);
});

test('owned server exit becomes an error; unknown diagnostics are not leaked', async () => {
  const current = fixture();
  await current.service.setEnabled(true);
  await current.service.initialize();
  current.exit();
  assert.equal(current.service.snapshot().error, 'start-failed');
  const failed = fixture({
    run: async () => {
      throw Error(`secret:${TOKEN}`);
    }
  });
  await failed.service.setEnabled(true);
  const state = await failed.service.initialize();
  assert.equal(state.error, 'operation-failed');
  assert.ok(!JSON.stringify(state).includes(TOKEN));
});

test('development token storage is memory-only and never calls keychain or creates a file', () => {
  const file = join(directory, 'dev', 'token.enc');
  const never = () => {
    throw Error('Keychain must not be called');
  };
  const store = new ZellijTokenService(file, {
    persistent: false,
    available: never,
    encrypt: never,
    decrypt: never
  });
  assert.equal(store.read(), null);
  store.write(TOKEN);
  assert.equal(store.read(), TOKEN);
  assert.equal(existsSync(file), false);
});

test('packaged token storage writes only ciphertext and rejects unavailable secure storage', () => {
  const file = join(directory, 'release', 'token.enc');
  const options = {
    persistent: true,
    available: () => true,
    encrypt: () => Buffer.from('opaque ciphertext'),
    decrypt: () => TOKEN
  };
  const store = new ZellijTokenService(file, options);
  store.write(TOKEN);
  assert.equal(readFileSync(file, 'utf8'), 'opaque ciphertext');
  assert.equal(new ZellijTokenService(file, options).read(), TOKEN);
  const unavailable = new ZellijTokenService(file, { ...options, available: () => false });
  assert.throws(() => unavailable.read(), /secure-storage-unavailable/);
  assert.throws(() => unavailable.write(TOKEN), /secure-storage-unavailable/);
  assert.equal(readFileSync(file, 'utf8'), 'opaque ciphertext');
});

test('config saves preserve unrelated bytes, backup originals, reject drift and rejected candidates', async () => {
  const folder = mkdtempSync(join(directory, 'config-'));
  const file = join(folder, 'config.kdl');
  const source = '// own config\nsession_serialization false\n';
  writeFileSync(file, source);
  let reject = false;
  let drift = false;
  const config = new ZellijConfigService(file, {
    platform: 'darwin',
    validate: async (candidate) => {
      assert.ok(readFileSync(candidate, 'utf8').includes('normal {'));
      if (drift) writeFileSync(file, `${source}// changed elsewhere\n`);
      if (reject) throw Error('config-validation-failed');
    }
  });
  const snapshot = config.read();
  await config.save({ revision: snapshot.configRevision, shortcuts });
  assert.ok(readFileSync(file, 'utf8').startsWith(source));
  assert.equal(readdirSync(folder).filter((name) => name.includes('backup-')).length, 1);
  await assert.rejects(
    config.save({ revision: snapshot.configRevision, shortcuts }),
    /config-drift/
  );
  const before = readFileSync(file, 'utf8');
  reject = true;
  await assert.rejects(
    config.save({ revision: config.read().configRevision, shortcuts }),
    /config-validation-failed/
  );
  assert.equal(readFileSync(file, 'utf8'), before);
  reject = false;
  drift = true;
  await assert.rejects(
    config.save({ revision: config.read().configRevision, shortcuts }),
    /config-drift/
  );
  assert.equal(readFileSync(file, 'utf8'), `${source}// changed elsewhere\n`);
  assert.equal(
    readdirSync(folder).some((name) => name.startsWith('.bitterless-')),
    false
  );
});

test('config read does not create directories; explicit overrides and fresh platform paths resolve', () => {
  const folder = join(directory, 'no-config');
  const file = join(folder, 'config.kdl');
  const config = new ZellijConfigService(file, { platform: 'darwin', validate: async () => {} });
  assert.equal(config.read().configExists, false);
  assert.equal(existsSync(folder), false);
  assert.equal(
    resolveZellijConfigFile({
      home: folder,
      env: { ZELLIJ_CONFIG_FILE: file, ZELLIJ_CONFIG_DIR: '/not-used' },
      platform: 'darwin'
    }),
    file
  );
  assert.equal(
    resolveZellijConfigFile({
      home: folder,
      env: { ZELLIJ_CONFIG_DIR: folder },
      platform: 'win32'
    }),
    file
  );
  assert.equal(
    resolveZellijConfigFile({ home: folder, env: { APPDATA: folder }, platform: 'win32' }),
    join(folder, 'Zellij', 'config', 'config.kdl')
  );
});
