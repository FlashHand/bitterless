---
id: onlypreview-config-quiet-reconcile-148
scope: apply workspace indexing config after sixty quiet seconds with serialized reconciliation and restart recovery
status: done
depends-on: []
verify: fake-time config/watch scheduling and real persisted-index reopen regressions
---

# Quiet-period application of workspace search configuration

## Objective

Owner request, 2026-09-07: follow edits to `.bitterless/preview-config.yml` automatically, apply
index adjustments only after one minute without another edit, never overlap adjustments, and
recover edits even when the app closes immediately then reopens. Apply the canonical behavior to
Bitterless and Cowork (`mini-019`); do not edit the owner's actual workspace config.

## Contract

- Live configuration changes use a **60,000ms trailing quiet period**, reset by each relevant
  create/change/rename/delete event. Cover editor atomic-save replacement and config-parent events.
  Do not extend normal content-watch's existing 400ms trailing period to a minute.
- Keep the currently applied parsed config/policy separate from pending disk changes. Ordinary
  file updates, full-watch fallbacks and content refreshes continue with the applied config; they
  must not read/apply an unsettled config early. Initial project open is the explicit exception.
- Reuse the engine's existing serialized operation queue. A config job must recheck its revision
  and quiet deadline when it actually starts, not only when the timer fired. Newer edits supersede
  queued obsolete work. Keep one latest pending intent, not a queue of every saved config version.
- If an index adjustment is already running, let it finish through the existing safe commit path.
  Accumulate only the latest next config intent and apply it after both queue availability and
  its final quiet deadline. Never create a second index writer or restart the build on every save.
- Load/validate the latest settled config in the fileSearch preload. No semantic policy change
  means no extra index reconciliation; comments/format-only edits must not rebuild the index.
  Invalid runtime config preserves the existing parse error for a local error callback, emits one
  fixed safe background diagnostic per failed apply attempt, and preserves the last valid applied
  index/policy; no empty-policy fallback or uncontrolled retry loop. A later valid
  edit schedules recovery. Deletion means the existing default policy, subject to the same delay.
- On every actual project reopen/process startup, reread disk config and compare its semantic
  hash against persisted index build identity before warm reuse. A changed config is reconciled
  immediately through the existing startup candidate path, without waiting another minute.
  Do not depend on an in-memory pending timer surviving exit or persist a new timer/job format.
  Unchanged config keeps normal warm reuse. Existing invalid-startup behavior remains explicit.
- Timers and watch subscriptions must be disposed on close/workspace change, and stale queued
  callbacks must not apply a previous workspace's config. Preserve current search policy, tree
  capabilities/selection, 147 exclusions and same-named-file watch/preview repairs.
- No Main heavy I/O, UI changes, new dependencies, config schema changes, Git sync, branch/profile
  switch, app install/release, Electron/E2E or independent review. Ral owns live testing.

## Context and path

`docs/features/onlypreview.md` watch and persisted-index sections are canonical. Existing
`watch-controller.mjs` coalesces all events at 400ms; `watch-reconciler.mjs` turns config events into
full refreshes. Engine `refreshInternal` rereads config, while `operationTail` already serializes
initialization/refresh/watch/shutdown. Separate config adoption from ordinary reconciliation instead
of adding a parallel indexing service. Scope: preload search-core scheduling/config/engine helpers
and focused tests, then a narrow canonical Cowork port preserving its host adapters.
Existing parse errors are `TypeError`; there is no dedicated runtime configuration-error UI event
and the previous watch error callback is empty. This task adds bounded background reporting only,
not a new Shell/IPC error surface, and never logs configuration contents.

## Verification

- Fake clock: 59,999ms does nothing, 60,000ms applies once; repeated edits reset deadline; ordinary
  changes retain 400ms behavior and never bypass pending config; atomic save/parent change covered.
- Deferred queue/active adjustment: multiple edits coalesce to latest, stale queued deadlines cannot
  apply, maximum concurrent adjustment is one, later config arrives only after its own quiet edge.
- Equivalent config is a no-op; invalid config preserves live policy and later valid config recovers;
  config removal restores defaults at the same boundary; shutdown clears pending work.
- Actual persisted SQLite: initial policy A → edit policy B → close before timeout → reopen adopts B;
  next reopen reuses B. No real 60-second sleeps, heavy fixture growth or Electron launch.
- Focused related regressions, syntax/scoped lint and canonical source parity. Build/typecheck only
  if touched compiled boundaries require them; no unrelated full-suite or review expansion.

## Delivery

Completed 2026-09-07 in six preload search-core files: `constants.mjs`, `workspace-config.mjs`,
`config-reconciler.mjs` (new), `watch-controller.mjs`, `watch-reconciler.mjs`, and `search-engine.mjs`.
The controller tracks one latest quiet intent, reuses `operationTail`, fences stale queued/read
results, and disposes timers on close. Ordinary content reconciliation uses applied config.
Unknown/fallback events probe metadata signatures rather than resetting the quiet period for
unrelated writes. Ordered compiled-rule hashing ignores comment/format changes but retains rule order.

**Upgrade note:** existing raw-text config hashes are not migrated in place. The first open after
this upgrade rebuilds the old index once through the existing candidate path, even when its rules
are unchanged. After that, semantic-equal configuration reuses the index across subsequent opens.
No SQLite schema or persistent timer format was introduced.

Verification:

- **61/61 passed (8 new + 53 existing)** with fake time and real SQLite; no real minute-long sleep.

  ```sh
  node --test --test-concurrency=1 tests/onlypreview/onlyPreviewConfigQuietReconcile.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewSearchEngine.refresh.test.mjs tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewPythonGoExclusions.test.mjs tests/onlypreview/onlyPreviewSearchExclusionLifecycle.test.mjs
  ```

- Six source files and three test files passed syntax and scoped `git diff --check` checks.
- Scoped ESLint still reports five existing unused-variable errors (engine: one; boundary test:
  four), all reproduced against HEAD. Other changed files pass; no new lint errors. The CLI disables
  only the TS `explicit-function-return-type` rule for pure `.mjs`; lint configuration is unchanged.
- Cowork's narrow port passed **16/16** tests (10 config/reopen + 6 prior exclusions). Its six
  canonical source files and shared eight-case test are byte-identical; syntax/whitespace passed.
- No build/typecheck was repeated for this `.mjs` boundary; no Electron/E2E, independent review,
  installation, release, Git sync, branch/profile switch, or actual owner config modification.

Human acceptance is recorded under `agent builid` as **验证 OnlyPreview 配置静默一分钟与重启恢复**
(ID `00355281513543147593`). Use a harmless test project in each host: save again at 30 seconds,
confirm adoption only 60 seconds after the last save; normal file updates remain responsive;
close immediately after another config edit and reopen to verify current disk rules and later reuse.
