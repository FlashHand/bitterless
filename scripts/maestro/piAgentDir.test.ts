import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  PI_DIR_NAME,
  migratePiStateFiles,
  resolveMaestroPiPaths
} from '../../src/main/maestro/llm/piAgentDir.service.ts';

/**
 * pi 的 agent 目录 = `<userData>/.pi`,以及从 `<userData>/cowork/pi` 的一次性前向迁移。
 * 测的是**迁移语义**(缺哪个补哪个 · 目标侧优先 · 绝不迁 `bin/`),不是路径拼接 ——
 * 前者坏掉的表现是"用户被静默登出"或"随包二进制被重新遮蔽",两者都不会报错。
 * 见 docs/issues/pi-agent-dir-uses-global-home.md。
 */

const paths = resolveMaestroPiPaths({
  appUserDataPath: join('/fixtures', 'Bitterless'),
  legacyStateRoot: join('/fixtures', 'Bitterless', 'cowork')
});

test('agent dir 在 userData 根下的 .pi,不是 ~/.pi/agent 也不是 cowork/pi', () => {
  assert.equal(PI_DIR_NAME, '.pi');
  assert.equal(paths.agentDir, join('/fixtures', 'Bitterless', '.pi'));
  assert.equal(paths.authFile, join('/fixtures', 'Bitterless', '.pi', 'auth.json'));
  assert.equal(paths.modelsFile, join('/fixtures', 'Bitterless', '.pi', 'models.json'));
  assert.equal(paths.legacyDir, join('/fixtures', 'Bitterless', 'cowork', 'pi'));
});

const seeded = (): { legacyDir: string; agentDir: string } => {
  const userData = mkdtempSync(join(tmpdir(), 'bl-pidir-'));
  const resolved = resolveMaestroPiPaths({ appUserDataPath: userData, legacyStateRoot: join(userData, 'cowork') });
  mkdirSync(join(resolved.legacyDir, 'bin'), { recursive: true });
  writeFileSync(join(resolved.legacyDir, 'auth.json'), JSON.stringify({ marker: 'legacy-auth' }));
  writeFileSync(join(resolved.legacyDir, 'models.json'), JSON.stringify({ marker: 'legacy-models' }));
  writeFileSync(join(resolved.legacyDir, 'models-store.json'), JSON.stringify({ marker: 'legacy-store' }));
  writeFileSync(join(resolved.legacyDir, 'settings.json'), JSON.stringify({ marker: 'legacy-settings' }));
  writeFileSync(join(resolved.legacyDir, 'bin', 'rg'), 'downloaded-binary');
  return { legacyDir: resolved.legacyDir, agentDir: resolved.agentDir };
};

test('四个状态文件被搬过去,bin/ 一个字节都不搬', () => {
  const dirs = seeded();
  const copied = migratePiStateFiles(dirs);
  assert.deepEqual(copied, ['auth.json', 'models.json', 'models-store.json', 'settings.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(dirs.agentDir, 'auth.json'), 'utf8')), { marker: 'legacy-auth' });
  assert.equal(existsSync(join(dirs.agentDir, 'bin')), false, 'bin 是 TOOLS_DIR,非空即遮蔽 PATH 上的二进制');
  assert.equal(existsSync(join(dirs.legacyDir, 'bin', 'rg')), true, '旧目录是只读来源,不该被清掉');
});

test('目标侧已存在的文件不被覆盖', () => {
  const dirs = seeded();
  mkdirSync(dirs.agentDir, { recursive: true });
  writeFileSync(join(dirs.agentDir, 'auth.json'), JSON.stringify({ marker: 'current-auth' }));
  const copied = migratePiStateFiles(dirs);
  assert.equal(copied.includes('auth.json'), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dirs.agentDir, 'auth.json'), 'utf8')), { marker: 'current-auth' });
});

test('第二次迁移什么都不做', () => {
  const dirs = seeded();
  migratePiStateFiles(dirs);
  assert.deepEqual(migratePiStateFiles(dirs), []);
});

test('旧目录不存在时是 no-op,不建目录也不抛', () => {
  const userData = mkdtempSync(join(tmpdir(), 'bl-pidir-fresh-'));
  const resolved = resolveMaestroPiPaths({ appUserDataPath: userData, legacyStateRoot: join(userData, 'cowork') });
  assert.deepEqual(migratePiStateFiles(resolved), []);
  assert.equal(existsSync(resolved.agentDir), false);
});
