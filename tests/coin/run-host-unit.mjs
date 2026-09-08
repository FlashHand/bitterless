import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = mkdtempSync(join(tmpdir(), 'bitterless-trench-host-unit-'));
try {
  const entries = [
    'trenchHost.test.ts',
    'trenchHostHandler.test.ts',
    'coinWindow.lifecycle.test.ts',
    'coinSender.guard.test.ts',
    'snipingSender.guard.test.ts'
  ];
  await build({
    entryPoints: entries.map((name) => join(root, 'tests/coin/unit', name)),
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: join(root, 'tsconfig.node.json'),
    plugins: [
      {
        name: 'fake-electron-host',
        setup(plugin) {
          plugin.onResolve({ filter: /^(electron|@main\/windows\/windowState\.service)$/ }, () => ({
            path: join(root, 'tests/coin/fixtures/trenchHostElectron.ts')
          }));
          plugin.onResolve({ filter: /^@electron-toolkit\/utils$/ }, () => ({
            path: 'toolkit',
            namespace: 'host-test'
          }));
          plugin.onResolve({ filter: /^electron-xpc\/main$/ }, () => ({
            path: 'xpc',
            namespace: 'host-test'
          }));
          plugin.onResolve(
            { filter: /^@maestro-main\/windows\/main\/maestroWindow\.controller$/ },
            () => ({
              path: join(root, 'tests/coin/fixtures/trenchHostMaestro.ts')
            })
          );
          plugin.onLoad({ filter: /.*/, namespace: 'host-test' }, ({ path }) => ({
            contents:
              path === 'toolkit'
                ? 'export const is = { dev: false };'
                : 'export class XpcMainHandler {} export const xpcIgnore = () => {}; export const xpcMain = { broadcast() {} };'
          }));
        }
      }
    ]
  });
  const result = spawnSync(
    process.execPath,
    ['--test', ...entries.map((name) => join(output, name.replace(/\.ts$/, '.js')))],
    {
      cwd: root,
      stdio: 'inherit'
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(output, { recursive: true, force: true });
}
