---
id: trench-index-generate-031
status: implemented; owner verification pending
depends-on: [trench-index-incremental-030]
---

# CA List and Explicit Generate

## Accepted Flow

```text
Trench header                          Agent  Refresh  Settings  Host

Selected chain
CA list                        [+]     INDEX wallets          [Generate]
SYMBOL  Token name                      Previous successful ranking
Contract address                       ... at most 300
```

- Left Add opens the existing batch textarea, defaults to the selected chain, and fetches/saves
  symbol/name via token-info. It never fetches traders or changes the published INDEX.
- Right Generate rebuilds from all saved CAs on the selected chain; it includes incumbents, retains
  the other chains and historical evidence, and publishes only after success.
- No header Add, automatic analysis on Add, or global Reanalyze all button remains in the UI.
- Metadata saves are bounded, transactional and durably request-idempotent. Repeated CA identities
  remain unique. Failure preserves the draft. Generate is disabled for an empty selected chain.
- New controls use borderless IconBtn/Tabler or borderless command buttons. INDEX columns and rows
  use spacing/background instead of divider lines; existing navigation and unrelated modules stay.
- Existing per-chain 300 capacity and token-sample profit metric are unchanged. Legacy incremental
  storage operations/history remain compatible, but the visible Add route no longer invokes them.

## Delivery

- [x] Metadata-only Add API, storage receipt ledger and scoped Generate.
- [x] CA-list Add, explicit Generate, token identity and loading/error UI.
- [x] Unit/source tests, typecheck, lint/i18n and build; unrelated Main typecheck failures recorded below.
- [x] Human test handoff. No Electron E2E, live GMGN, install or independent review.

## Code Verification

2026-09-10:

- 24 INDEX normalization/orchestrator/validation/input/avatar unit tests passed.
- `node tests/coin/run-trench-index-unit.mjs`: 25 native SQLite tests passed in temporary
  encrypted databases, including metadata-only receipts, scoped rebuild, replay, restart,
  rollback, chain preservation, legacy history and migration coverage. No app UI was started.
- 8 relevant `scripts/coin/trench-index-layout.test.mjs` source contracts passed with
  `--test-name-pattern='Add CA|Generate exclusively|Arco navigation|Main owns|all visible INDEX|wallet avatars|workspace and SQLite'`.
- Strict Trench renderer and trench-io typechecks passed using `yarn vue-tsc --noEmit -p
  tests/coin/tsconfig.trench-renderer.json --incremental false` and `yarn tsc --noEmit -p
  tests/coin/tsconfig.trench-io.json --incremental false`.
- Targeted ESLint has no errors; renderer i18n check and `git diff --check` passed.
- `yarn build` passed. No installation, release, live GMGN request or real Trench database edit.
- Broad Main typecheck (`tests/coin/tsconfig.trench-node.json`) remains blocked by diagnostics
  in unrelated Agent, Codex, legacy Coin, OnlyPreview and Omni dependencies. No diagnostics
  reference this task's changed files; this is not a claim that Main typechecking passed.

## Human Acceptance

Use a build containing task 031; an already-installed older app does not contain these changes.

1. In INDEX, select a chain, click the left CA-list plus, and paste multiple token CAs. After Add,
   each unique CA shows its provider symbol/name, while the wallet INDEX remains unchanged.
2. Click right-column Generate. All saved CAs on that chain are analyzed, including indexed
   wallets; at most 300 are published. Repeat Generate and switch chains to confirm their ranks
   and original evidence are retained independently. Empty-chain Generate is disabled.
3. Try a duplicate CA and an invalid/provider-failing batch. No duplicate or partial list is saved;
   failed Add retains the draft, and failed Generate retains the last successful ranking.
4. Check independent window, tab and a narrow Omni panel: both actions remain reachable and
   symbol/name/CA do not overlap. Reopen to confirm saved CAs persist.

No Electron E2E, automated app screenshots or independent review were run; Ral owns live testing.

Handoff recorded in BLOnly Todo `00355667779833077778` (updated from task 030; still incomplete)
and delivered to BotAndI as rendered Chinese Markdown, message `om_x100b6513f76c2900b3b6d5211eba2ab`.
