---
id: eyes-on-agents-search-raw-input-100
scope: Preserve raw Search threads input and derive normalized matching state
status: done
depends-on: [eyes-on-agents-search-input-lifecycle-099]
verify: real Arco input/modal regressions, search/store tests and EyesOnAgents UI typecheck; no Electron
---

# Preserve Search threads input

## Objective

The owner identified EyesOnAgents Search threads as the field whose typed text disappears.
Keep the raw field bound through `v-model`; normalization belongs to read-only computed search
state, never to an input callback that rewrites the field. Preserve the previously reproduced
interrupted-composition lifecycle fix and distinguish shipped behavior from current source.

## Context

- `docs/issues/eyes-on-agents-search-after-long-uptime.md`
- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md` — Focus search
- `docs/plan/tasks/eyes-on-agents-search-input-lifecycle-099.md`

## Path

- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- Directly related Search tests under `scripts/eyes-on-agents/`
- This task and its issue/feature/layout documentation

## Contract

- Preserve raw input exactly, including surrounding spaces, case, punctuation and Unicode.
- Use `v-model` for the field; any model adapter setter only writes the raw draft. Derive
  normalization/tokenization with read-only computed state, without writing it back to the draft.
- Keep one leading/trailing 120ms search scheduler with the current lifecycle fences. Background
  snapshots and late work cannot clear or replace the draft or revive an earlier search session.
- Retain fresh Input instances per modal lifetime, completed/interrupted IME handling, explicit
  clear/close reset, keyboard selection, title matching and the unfiltered Focus board.
- No visual layout change, provider/backend change, persisted-data mutation or release/install.

## Verification

- Real Arco Input/Modal tests: raw spaces/case, ordinary typing and rapid replacement, background
  rerender, interrupted and completed IME, close/reopen, explicit clear and late scheduler work.
- Check actual store behavior, not only a component stub. Preserve existing receiver-safety tests.
- Run scoped Search/store tests and `yarn typecheck:eyes-on-agents:ui`, targeted lint and whitespace
  checks. Report unrelated existing errors without changing their modules.
- No independent review and no Electron/E2E. Ral tests the updated build's Search threads dialog.

## Delivery result

Implemented and code-verified on 2026-09-07; owner real-window verification remains pending.

- Search/store tests: 38/38 passed (30 store and 8 real Arco interaction tests), five more than the
  prior 33-test baseline. Search source-boundary checks: 3/3 passed.
- `yarn typecheck:eyes-on-agents:ui`: passed.
- Current-profile `yarn electron-vite build`: passed for main/preload/renderer in 36.01 seconds;
  package, builder and installer configuration were not changed.
- Scoped ESLint remains blocked by existing violations: the store separator regex's unnecessary
  escape and test-file empty DOM stubs, return-type and source-regex rules. These unrelated cleanup
  changes were not made. Scoped whitespace checks passed.
- No Electron/E2E, independent review, commit, sync or installed-application replacement.

Human test: in a new build containing tasks 099/100, open Search threads, type and rapidly replace
a known title with spaces/case preserved, wait for background refresh, then interrupt Chinese
composition by closing and reopening Search. Input must remain usable and results must match;
explicit Clear/Escape/close should still reset the session.
