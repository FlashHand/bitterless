import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  CORE_EXCLUDED_DIRECTORY_NAMES,
  CORE_EXCLUDED_DIRECTORY_SEQUENCES,
  CORE_EXCLUDED_DIRECTORY_SUFFIXES,
  SEARCH_SCHEMA_VERSION
} from '../../src/preload/onlypreview/search/core/constants.mjs';
import { SEARCH_ENGINE_IDENTITY } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import {
  countWorkspaceSearchEntries,
  createTraversalPolicy,
  createWorkspaceTraversal
} from '../../src/preload/onlypreview/search/core/traversal.mjs';
import { parseOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const names = [
  '__pycache__',
  '__pypackages__',
  'venv',
  'site-packages',
  'htmlcov',
  'vendor',
  'go-build'
];
const excludedDirectories = [
  ...names,
  'package.egg-info',
  'package.dist-info',
  'pkg/mod',
  'pkg/sumdb'
];
const entry = (isDirectory) => ({ isDirectory: () => isDirectory });

test('Python and Go hard policy matches directory components, inherits and normalizes separators', () => {
  const policy = createTraversalPolicy();
  for (const directory of excludedDirectories) {
    for (const prefix of ['', 'nested/source/']) {
      const path = prefix + directory;
      for (const value of [path, path.replaceAll('/', '\\')]) {
        assert.equal(policy.isExcludedDirectoryPath(value), true, value);
        assert.equal(policy.isExcluded(value, entry(true)), true, value);
        assert.equal(policy.isExcludedFilePath(value + '/nested/source.py'), true, value);
        assert.equal(policy.isExcludedDirectoryPath(value + '/nested'), true, value);
        assert.equal(policy.canTraverseExcludedDirectoryPath(value), false, value);
      }
    }
  }
});

test('same-named regular files, source directories and substrings remain eligible', () => {
  const policy = createTraversalPolicy();
  for (const file of excludedDirectories) {
    assert.equal(policy.isExcludedFilePath(file), false, file);
    assert.equal(policy.isExcluded(file, entry(false)), false, file);
    assert.equal(policy.isExcludedFilePath('source/' + file), false, file);
  }
  for (const directory of [
    'pkg',
    'src',
    'bin',
    'env',
    'mod',
    'sumdb',
    'pkg/src',
    'pkg/bin',
    'pkg/module',
    'pkg/other/mod',
    'pkg/other/sumdb',
    'pkg-other/mod',
    'vendor-source',
    'myvenv',
    'venv-source',
    'go-builders',
    'package.egg-info.backup',
    'package.dist-info.txt'
  ]) {
    assert.equal(policy.isExcludedDirectoryPath(directory), false, directory);
    assert.equal(policy.isExcludedFilePath(directory + '/source.py'), false, directory);
  }
});

test('workspace negations cannot undo hard exclusions and hidden directories remain covered', () => {
  const config = parseOnlyPreviewWorkspaceConfig('version: 1\nexclude:\n  - "!**"\n');
  const policy = createTraversalPolicy(config);
  for (const directory of [
    ...excludedDirectories,
    '.venv',
    '.tox',
    '.nox',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache'
  ]) {
    assert.equal(policy.isExcludedDirectoryPath(directory), true, directory);
    assert.equal(policy.isExcludedFilePath(directory + '/source.py'), true, directory);
    assert.equal(policy.canTraverseExcludedDirectoryPath(directory), false, directory);
  }
  assert.equal(policy.isExcludedFilePath('src/main.py'), false);
  assert.equal(policy.isExcludedFilePath('.env.example'), false);
});

test('engine identity deterministically includes the hard policy without a schema bump', () => {
  const policy = JSON.parse(SEARCH_ENGINE_IDENTITY.slice(SEARCH_ENGINE_IDENTITY.indexOf('{')));
  assert.deepEqual(policy, {
    hiddenDirectories: true,
    directoryNames: [...CORE_EXCLUDED_DIRECTORY_NAMES].sort(),
    directorySuffixes: [...CORE_EXCLUDED_DIRECTORY_SUFFIXES].sort(),
    directorySequences: CORE_EXCLUDED_DIRECTORY_SEQUENCES.map((parts) => parts.join('/')).sort()
  });
  assert.equal(SEARCH_SCHEMA_VERSION, 8);
});

test('traversal and counting prune dependency bodies while retaining ordinary source and same-named files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'onlypreview-python-go-'));
  try {
    const includedPaths = [
      ...excludedDirectories.map((name) => 'regular-files/' + name),
      'pkg/main.go',
      'pkg/src/main.go',
      'src/main.py',
      'bin/tool.py',
      'env/config.py',
      'mod/main.go',
      'sumdb/main.go',
      'pkg/other/mod/main.go',
      'vendor-source/main.go'
    ];
    const excludedPaths = excludedDirectories.map(
      (name) => 'dependencies/' + name + '/deep/source.txt'
    );
    for (const path of [...includedPaths, ...excludedPaths]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), 'searchable fixture');
    }
    const config = parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []\n');
    const reads = [];
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config,
      shouldReadContent: ({ relativePath }) => {
        reads.push(relativePath);
      }
    });
    const files = [];
    for await (const file of traversal.entries) files.push(file.relativePath);
    assert.deepEqual(files.sort(), [...includedPaths].sort());
    assert.deepEqual(reads.sort(), [...includedPaths].sort());
    assert.equal(
      await countWorkspaceSearchEntries({ rootPath: root, config }),
      includedPaths.length
    );
    const policy = createTraversalPolicy(config);
    assert.equal(
      traversal.treeEntries.some((item) =>
        policy.isExcluded(item.relativePath, entry(item.nodeKind === 'directory'))
      ),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
