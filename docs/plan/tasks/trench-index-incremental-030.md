---
id: trench-index-incremental-030
status: implemented; owner verification pending
depends-on: [trench-host-toggle-029]
---

# INDEX Incremental Token Import

Superseded UI/command flow: [task 031](trench-index-generate-031.md) moves Add into the CA list,
saves metadata without analysis, and provides explicit selected-chain Generate. The delivery and
verification below describe task 030's historical implementation, not the current Add behavior.

## Contract

- [INDEX](../../features/trench-index.md): incremental top-300 semantics and evidence provenance.
- [Layout](../../features/trench-index-layout.md): global Add Token CA entry and batch dialog.
- Keep existing per-chain capacity and token-sample USD profit metric, not full-wallet P&L.

## Delivery

- [x] Global menu-bar Add Token CA; chain selector and batch textarea.
- [x] Submitted-token reads; skip incumbents; merge strict-profit newcomers.
- [x] Preserve historical source evidence with an additive database migration.
- [x] Unit tests for ranking, chain isolation, repeated import, rollback and migration; typecheck/lint.
- [x] Record owner-only live acceptance. No Electron E2E or independent review.

## Verification

2026-09-08, code-level only:

- `node tests/coin/run-trench-index-unit.mjs`: 23 passed, using temporary encrypted databases and
  Electron's Node mode only (no application/window launch). Includes upgrades with source backfill,
  strict-profit replacement at 300, partial fill, stable equal-profit incumbents, same-token
  reimport, chain isolation, original evidence retention, full rebuild and rollback.
- 23 `trenchIndex*.test.ts` units bundled with esbuild and run with `node --test`: passed.
  Covers orchestration, no incumbent profit analysis, token batch deduplication, bounds and ranking.
- Six focused source-contract tests in `scripts/coin/trench-index-layout.test.mjs`: passed using
  `--test-name-pattern='Add CA|Main owns|all visible INDEX|wallet avatars|workspace and SQLite'`.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --incremental false`: passed.
- `yarn tsc --noEmit -p tests/coin/tsconfig.trench-io.json --incremental false`: passed.
- Scoped ESLint: no errors; legacy files retain formatting warnings without wholesale formatting.
- `yarn check:renderer-i18n`, `git diff --check`, and `yarn build`: passed.
- Strict `tsconfig.trench-node.json` check remains blocked by existing/transitive diagnostics in
  Agent, Codex, legacy Coin, OnlyPreview and Omni. No diagnostics name the modified INDEX files.
- No real GMGN requests, real database migration, installation, release, Git sync or E2E was run.

## Owner Acceptance

Use a build containing task 030. In standalone, tab and narrow Omni, open the top-bar plus action
from INDEX and another module, choose the chain and paste multiple Token CAs (including repeats).
Confirm one run starts; unrelated tokens do not rerun; existing INDEX stays visible. Repeat the
same token, try a weaker batch, and verify no duplicates/lost incumbents and at most 300 per chain.
Check provider failure retains pasted text, successful completion appears in other open panels,
and reopening retains results. The explicit Reanalyze all action still rebuilds all targets.

Profit is the existing token-sample USD sum, not wallet-wide 30-day/lifetime profit. Candidate
discovery remains GMGN's top 100 profit-ranked traders per token. These are the implemented source
limits, not a claim to enumerate every holder or every trade of a wallet.
