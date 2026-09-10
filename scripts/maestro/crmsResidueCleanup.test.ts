import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CLI_CREDENTIAL_KEY_FILE,
  CLI_SYS_CREDENTIAL_FILE,
  CRMS_CLI_CREDENTIAL_FILE,
  planCliCredentialRemoval,
  removeCrmsCliCredentials,
  resolveCrmsResiduePaths,
  stripCrmsProvider,
  stripCrmsProviderFromPiModels
} from '../../src/main/maestro/retirement/crmsResidueCleanup.service.ts';

/**
 * AI-CRMS 退役残留清理的**决策**。测的不是路径拼接,是三件坏掉不会报错的事:
 * 摘 provider 时两份 pi 文档的形状不同(一个嵌在 `providers` 下、一个 provider 直接做顶层键)、
 * 没有残留时不该白写一遍盘、以及 sys.json 还在时不许删那把共用密钥。
 * 见 docs/features/maestro-crms-retirement.md #6。
 */

test('models.json 的 provider 嵌在 providers 下,models-store.json 直接做顶层键', () => {
  const nested = stripCrmsProvider({ providers: { 'ai-crms': { token: 'x' }, local: {} } }, 'providers-map');
  assert.deepEqual(nested, { providers: { local: {} } });

  const flat = stripCrmsProvider({ 'ai-crms': { token: 'x' }, 'openai-codex': {} }, 'top-level');
  assert.deepEqual(flat, { 'openai-codex': {} });
});

test('没有残留就返回 null —— 调用方据此不落盘', () => {
  assert.equal(stripCrmsProvider({ providers: { local: {} } }, 'providers-map'), null);
  assert.equal(stripCrmsProvider({ 'openai-codex': {} }, 'top-level'), null);
  // 布局搞反时也不该误伤:models.json 的顶层键是 `providers`,不是 provider 名。
  assert.equal(stripCrmsProvider({ providers: { 'ai-crms': {} } }, 'top-level'), null);
  assert.equal(stripCrmsProvider(null, 'providers-map'), null);
  assert.equal(stripCrmsProvider([{ 'ai-crms': {} }], 'top-level'), null);
});

test('两份 pi 文档一起摘,只重写真的改过的那份', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-crms-pi-'));
  const piModelsFile = join(dir, 'models.json');
  const piModelsStoreFile = join(dir, 'models-store.json');
  writeFileSync(piModelsFile, JSON.stringify({ providers: { 'ai-crms': { jwt: 'secret' }, local: { a: 1 } } }));
  writeFileSync(piModelsStoreFile, JSON.stringify({ 'openai-codex': { b: 2 } }));

  const paths = { piModelsFiles: [piModelsFile], piModelsStoreFiles: [piModelsStoreFile] };
  const rewritten = stripCrmsProviderFromPiModels(paths);
  assert.deepEqual(rewritten, [piModelsFile]);
  assert.deepEqual(JSON.parse(readFileSync(piModelsFile, 'utf8')), { providers: { local: { a: 1 } } });

  // 幂等:再跑一次什么都不改。
  assert.deepEqual(stripCrmsProviderFromPiModels(paths), []);
});

test('legacy pi 目录里的同名副本也要清 —— 那次迁移是 copy 不是 move', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-crms-pi-legacy-'));
  const current = join(dir, 'models.json');
  const legacy = join(dir, 'legacy-models.json');
  writeFileSync(current, JSON.stringify({ providers: { local: { a: 1 } } }));
  writeFileSync(legacy, JSON.stringify({ providers: { 'ai-crms': { jwt: 'secret' }, local: { a: 1 } } }));

  // 新目录干净、旧目录还留着一枚 JWT —— 只看新目录的实现会漏掉它,而它的 writer 已经删了。
  const rewritten = stripCrmsProviderFromPiModels({
    piModelsFiles: [current, legacy],
    piModelsStoreFiles: []
  });
  assert.deepEqual(rewritten, [legacy]);
  assert.deepEqual(JSON.parse(readFileSync(legacy, 'utf8')), { providers: { local: { a: 1 } } });
});

test('一份文档 JSON 坏掉时跳过它,另一份照样清干净', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-crms-pi-broken-'));
  const broken = join(dir, 'broken.json');
  const good = join(dir, 'good.json');
  writeFileSync(broken, '{ "providers": { "ai-crms"');
  writeFileSync(good, JSON.stringify({ providers: { 'ai-crms': { jwt: 'secret' }, local: { a: 1 } } }));

  // 坏文件不许把整段清理拖下水:抛出去会让 marker 永不写入,于是每次启动重跑、每次再抛一次,
  // 而这份本来清得掉的文档也一起被拖着不清。
  const rewritten = stripCrmsProviderFromPiModels({ piModelsFiles: [broken, good], piModelsStoreFiles: [] });
  assert.deepEqual(rewritten, [good]);
  assert.deepEqual(JSON.parse(readFileSync(good, 'utf8')), { providers: { local: { a: 1 } } });
});

test('sys.json 还在时不删共用密钥,不在时才删,清空后连目录一起收走', () => {
  const withSys = planCliCredentialRemoval({
    directory: '/creds',
    entries: [CRMS_CLI_CREDENTIAL_FILE, CLI_CREDENTIAL_KEY_FILE, CLI_SYS_CREDENTIAL_FILE]
  });
  assert.deepEqual(withSys, { files: [join('/creds', CRMS_CLI_CREDENTIAL_FILE)], removeDirectory: false });

  const withoutSys = planCliCredentialRemoval({
    directory: '/creds',
    entries: [CRMS_CLI_CREDENTIAL_FILE, CLI_CREDENTIAL_KEY_FILE]
  });
  assert.deepEqual(withoutSys, {
    files: [join('/creds', CRMS_CLI_CREDENTIAL_FILE), join('/creds', CLI_CREDENTIAL_KEY_FILE)],
    removeDirectory: true
  });

  // 什么都没删的目录不算「清空了」,不该被收走。
  assert.deepEqual(planCliCredentialRemoval({ directory: '/creds', entries: [] }), {
    files: [],
    removeDirectory: false
  });
});

test('两个发布通道的凭据目录都清,缺席的目录跳过', () => {
  const userData = mkdtempSync(join(tmpdir(), 'bl-crms-cli-'));
  const home = mkdtempSync(join(tmpdir(), 'bl-crms-home-'));
  const paths = resolveCrmsResiduePaths({
    piModelsFile: join(userData, '.pi', 'models.json'),
    legacyPiDir: join(userData, 'cowork', 'pi'),
    appUserDataPath: userData,
    homeDirectory: home
  });
  const [stableDir, previewDir] = paths.cliCredentialDirs;
  assert.equal(stableDir, join(home, '.micromeet', 'credentials'));
  assert.equal(previewDir, join(userData, 'cowork', 'cli', 'credentials'));
  // 新旧两个目录都要进清理面 —— 迁移是 copy,旧目录里那份副本的 writer 已经随退役删了。
  assert.deepEqual(paths.piModelsFiles, [
    join(userData, '.pi', 'models.json'),
    join(userData, 'cowork', 'pi', 'models.json')
  ]);
  assert.deepEqual(paths.piModelsStoreFiles, [
    join(userData, '.pi', 'models-store.json'),
    join(userData, 'cowork', 'pi', 'models-store.json')
  ]);

  // Stable 侧还留着 Sys realm;Preview 侧只有 CRMS。
  mkdirSync(stableDir, { recursive: true });
  writeFileSync(join(stableDir, CRMS_CLI_CREDENTIAL_FILE), '{}');
  writeFileSync(join(stableDir, CLI_CREDENTIAL_KEY_FILE), 'k');
  writeFileSync(join(stableDir, CLI_SYS_CREDENTIAL_FILE), '{}');
  mkdirSync(previewDir, { recursive: true });
  writeFileSync(join(previewDir, CRMS_CLI_CREDENTIAL_FILE), '{}');
  writeFileSync(join(previewDir, CLI_CREDENTIAL_KEY_FILE), 'k');

  const removed = removeCrmsCliCredentials(paths.cliCredentialDirs);
  assert.deepEqual(removed, [
    join(stableDir, CRMS_CLI_CREDENTIAL_FILE),
    join(previewDir, CRMS_CLI_CREDENTIAL_FILE),
    join(previewDir, CLI_CREDENTIAL_KEY_FILE)
  ]);
  assert.equal(existsSync(join(stableDir, CLI_SYS_CREDENTIAL_FILE)), true);
  assert.equal(existsSync(join(stableDir, CLI_CREDENTIAL_KEY_FILE)), true);
  assert.equal(existsSync(previewDir), false);

  // 幂等:第二遍什么都不删,也不因目录已消失而抛。
  assert.deepEqual(removeCrmsCliCredentials(paths.cliCredentialDirs), []);
});
