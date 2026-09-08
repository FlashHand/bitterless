---
id: trench-host-toggle-029
scope: ordinary Trench singleton with Maestro tab and standalone window hosting; independent Omni panels retained
status: implemented; owner verification pending
depends-on:
  - trench-long-term-monitoring-028
---

# Trench Host Toggle

Contract: [Trench Tab and Window Hosting](../../features/trench-host-toggle.md).

- [x] Confirm ordinary singleton and independent multi-renderer Omni scope.
- [x] Implement managed surface, host switching and lifecycle cleanup.
- [x] Connect Mini Apps entry points and header toggle.
- [x] Run focused code verification and record results.

Human acceptance: open from Maestro, switch tab/window repeatedly, close/reopen, log out while
opening, and keep two Omni monitoring panels open alongside the ordinary surface. Confirm one
ordinary renderer, preserved UI state, correct bounds and no effect on Omni panels.

## Verification Results

2026-09-08, without launching Electron:

- `node tests/coin/run-host-unit.mjs`: 20 passed, including simultaneous entry points, token
  isolation, carrier-close ownership, attach failure recovery, auth cancellation and login epochs.
- `node tests/coin/run-monitoring-unit.mjs`: 76 passed.
- `node --test --test-skip-pattern='production build' tests/omni/trenchOmniEmbedding.test.mjs`:
  5 source-contract tests passed. The unfiltered artifact assertion failed because the output is
  older than source; it is not treated as a pass.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --incremental false`: passed.
- Scoped ESLint, `yarn check:renderer-i18n`, `git diff --check`: passed.
- `yarn tsc --noEmit -p tests/coin/tsconfig.trench-node.json`: blocked by existing/transitive
  diagnostics in Agent, Codex, legacy Coin, OnlyPreview and Omni; no diagnostics in this task's
  modified source files at the time of the check.
- `yarn check:maestro`: blocked by missing `src/main/agent/BaseAgent.ts` during another change.
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`:
  blocked resolving `typebox` from `projects/maestro-agent-sdk/runtime/piRuntimeAdapter.ts`.
  No dependency or unrelated Agent changes were made to bypass that error.

The existing Omni E2E helper now locates the standalone Trench BaseWindow's WebContentsView;
the suite was not run. No installation, release, Git sync or independent review was performed.
