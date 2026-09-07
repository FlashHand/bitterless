import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Tasks 091/092: the pure contract functions behind adding an environment by pasting its absolute
// CLAUDE_CONFIG_DIR and repointing an existing one — the shared absolute-path rule, both param
// parsers, and the label derived from the directory. Electron-free, so they are unit-testable.
//
// This file used to also cover task 089's copyable shell wrapper; task 096 removed that feature at
// the owner's request, and the file was renamed from claude-environment-setup-command.test.mjs.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-env-params-'));

const loadTypeScriptModule = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const contractModule = await loadTypeScriptModule(
  'contract',
  'src/shared/eyesOnAgents/eyesOnAgents.contract.ts'
);

try {
  // ---- Task 091: add-by-pasted-path ----
  await test('the add params parser accepts an absolute path and rejects everything else', () => {
    assert.deepEqual(
      contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({
        configDirectory: '/Users/ral/.claude2'
      }),
      { configDirectory: '/Users/ral/.claude2' }
    );
    // Windows absolute paths must survive too — this parser is shared, not macOS-only.
    assert.deepEqual(
      contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({
        configDirectory: 'C:\\Users\\ral\\.claude2'
      }),
      { configDirectory: 'C:\\Users\\ral\\.claude2' }
    );
    // A relative path is the most likely paste mistake and must be caught before it reaches Main.
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ configDirectory: '.claude2' }),
      /absolute/
    );
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ configDirectory: '~/.claude2' }),
      /absolute/,
      'a tilde is not expanded by the parser, so it must be rejected rather than passed through'
    );
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ configDirectory: '' }),
      /Claude config directory/
    );
    // The old label-based shape must no longer be accepted, or a stale caller would silently add
    // an environment pointing at a label-shaped "path".
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ label: 'claude2' }),
      /Claude environment params/
    );
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({
        configDirectory: '/Users/ral/.claude2',
        label: 'claude2'
      }),
      /Claude environment params/,
      'extra keys must be rejected, not ignored'
    );
  });

  await test('the set-directory params parser shares the add parser\'s absolute-path rule', () => {
    const parse = contractModule.parseEyesOnAgentsSetClaudeEnvironmentDirectoryParams;
    const id = 'af147ca5-5493-4079-81db-1c6f8841682b';
    assert.deepEqual(parse({ id, configDirectory: '/Users/ral/.claude2' }),
      { id, configDirectory: '/Users/ral/.claude2' });
    // Same rejections as the add parser — the rule is shared, not duplicated.
    assert.throws(() => parse({ id, configDirectory: '.claude2' }), /absolute/);
    assert.throws(() => parse({ id, configDirectory: '~/.claude2' }), /absolute/);
    assert.throws(() => parse({ id, configDirectory: '' }), /Claude config directory/);
    // Both fields are required, and nothing else is accepted.
    assert.throws(() => parse({ configDirectory: '/Users/ral/.claude2' }), /Claude environment/);
    assert.throws(() => parse({ id }), /Claude config directory/);
    assert.throws(() => parse({ id, configDirectory: '/x', label: 'y' }), /Claude environment params/);
    assert.throws(() => parse({ id: 'not-a-uuid', configDirectory: '/x' }), /Claude environment/);
  });

  await test('the environment label is derived from its directory', () => {
    const derive = contractModule.deriveEyesOnAgentsClaudeEnvironmentLabel;
    assert.equal(derive('/Users/ral/.claude2'), 'claude2', 'a leading dot is stripped');
    assert.equal(derive('/Users/ral/claude-work'), 'claude-work');
    // Trailing slashes and "/./" segments must not change the derived label, which is why the
    // caller derives from the canonicalized path.
    assert.equal(derive('/Users/ral/.claude2/'), 'claude2');
    assert.equal(derive('/Users/ral/.claude2//'), 'claude2');
    assert.equal(derive('C:\\Users\\ral\\.claude2'), 'claude2', 'Windows separators too');
    // A dot-only basename leaves nothing after stripping, so the original basename is kept.
    assert.equal(derive('/Users/ral/.'), '.');
    assert.equal(derive('/'), 'Claude environment', 'nothing usable falls back');
    assert.equal(derive(''), 'Claude environment');
    // Labels are bounded the same way parseEyesOnAgentsClaudeEnvironmentLabel bounds them.
    assert.equal(derive(`/Users/ral/${'n'.repeat(200)}`).length, 80);
  });

  console.log('EyesOnAgents Claude environment params tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
