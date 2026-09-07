# OnlyPreview verification checks red at HEAD

Status: Fixed

## Observed behavior

Three verification checks are red on `dev/next` for reasons unrelated to any in-flight OnlyPreview
surface work. All three reproduce at `HEAD` (`94dfa75`) and none of them is caused by the current
worktree edits, which touch only `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`,
`src/main/windows/onlyPreviewWindow.helper.ts`, the Playwright specs/fixtures, `docs/`, and
`package.json`.

### 1. `yarn check:renderer-i18n` — stale startup pin

`scripts/renderer-i18n/check-renderer-i18n.mjs` asserts `trayCreateIndex > homeCreateIndex` by
locating the literal `trayHelper.init(mainWindowHelper)` in `src/main/app.main.ts`. Commit
`c67ac21` ("consolidate desktop workbench and local Claude accounts") changed the tray to take a
`{ show }` callback that opens Maestro instead of the Home window helper, so `indexOf` returns
`-1` and the ordering comparison fails.

The startup ordering itself did not regress. `runSqliteFirstGuiStartup` still awaits
`createHome()`, then `refreshMcpShim()`, then `initializeTray()`
(`src/main/startup/guiStartup.service.ts`), and in `app.main.ts` the `createHome` dependency is
still declared before `initializeTray`. Only the pinned call shape is stale.

### 2. `yarn test:onlypreview` — 6 failures

`test:onlypreview` (`node --test tests/onlypreview/*.test.mjs`) is new in the current worktree;
it is absent from `HEAD`'s `package.json`. Wiring the script exposed drift that had accumulated
unrun.

- **Four assertions pinned the pre-floating Global Search layout.** Commit `250cca1` moved Global
  Search to a full-window transparent canvas that positions a floating `GlobalSearchWorkspace`
  from `layout.workspaceBounds`. Three tests still require the bare
  `<GlobalSearchWorkspace />` element in `globalSearch/src/App.vue`
  (`onlyPreviewSearchShellUi`, `onlyPreviewFindRenderer`, `onlyPreviewSourceIntegration`), and one
  still requires a two-argument
  `onlyPreviewGlobalSearchWindowService.updateBounds(host.hostToken, bounds)` in
  `onlyPreviewWindow.helper.ts`, which has passed the full content rect plus the clamped preview
  bounds since the same commit. Both invariants — Global Search owns its own renderer, and Main
  shares one clamped preview rect with Preview and Global Search — still hold.
- **The 800-line budget in `onlyPreviewDrawioSource.test.mjs` is genuinely violated.** The
  assertion was added at `6caec1a` with all ten listed files under budget and was still green at
  `73316b0` (2026-08-31: 759 / 775 / 797 lines). Three files then crossed during 2026-09-01..04
  work: `onlyPreviewPreviewRegion.service.ts` 796 -> 865, `onlyPreviewPreview.store.ts` 797 -> 816,
  and `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs` 797 -> 867. 800 is the repo-wide
  `code-review` TS-1 hard limit, independently gated by six other test files and recorded as debt
  in `docs/plan/backlog.md`; it is not a number to raise.
- **`onlyPreviewSearchUtilityRpc`'s pending-initialize test uses a stale bootstrap fixture.**
  `runtimeBootstrap.rootPath` is the synthetic `/private/workspace`. Since `f8d25fa`,
  `createFileSearchCoordinator().initialize()` awaits
  `officeReader.bindWorkspace(workspaceId, rootPath)`, which `lstat`s the real path, so initialize
  now fails with `PATH_NOT_FOUND` before the stub engine can emit its root browse listing. The
  browse listing and search batch never reach the renderer and `projection.ready` stays `false`.
  This is the only test in the file that drives the real coordinator; the rest inject stubs, which
  is why only it fails. Real filesystem I/O in `bindWorkspace` also means one `setImmediate` is no
  longer enough for the listing to arrive.

### 3. `eslint src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`

`webFrameMain` is imported from `electron` and never used. Identical at `HEAD`.

### Not in scope but confirmed red at HEAD

`yarn typecheck` fails with 80 errors — chat message list, plugin/shell/omni XPC handler module
resolution, Maestro window bridges and turn service, `onlyPreviewTreeSelection.store.ts`, and
`pathMain.helper.ts`. A `git archive HEAD` baseline produces a byte-identical error list, so this is
a separate pre-existing debt and none of it belongs to the repairs below.

## Required behavior

- `check:renderer-i18n` must keep proving that tray initialization follows Home creation, pinned to
  the call shape the startup code actually has, and must also pin the ordering where it is now
  decided (`guiStartup.service.ts`).
- The four Global Search assertions must keep proving their invariants against the floating-canvas
  layout instead of the superseded element and call shapes.
- The three over-budget files must come back under the 800-line TS-1 limit by behavior-preserving
  extraction. The budget itself must not be raised, narrowed, or removed.
- The pending-initialize test must keep proving that a root projection and a streamed search batch
  render while the initialize call is still pending, using a workspace root that satisfies the
  Office workspace binding.
- The unused `webFrameMain` import must be removed without touching the concurrent surface-container
  edits in the same file.
- No assertion may be deleted or weakened to reach green.

## Acceptance

- `yarn test:onlypreview` and `yarn check:renderer-i18n` pass.
- `yarn typecheck` produces exactly the pre-existing HEAD error list and nothing more.
- No lint error in any touched file, and no new lint warning against the HEAD baseline.
- Every file listed in the Draw.io budget is at or under 800 lines.
- Electron E2E is not run (agent-initiated E2E is forbidden for this project).

## Resolution

- Repinned the tray assertion to `trayHelper.init(` and added a `guiStartup.service.ts` assertion
  that `createHome()` precedes `initializeTray()`, so the ordering is now pinned where the startup
  sequence actually decides it rather than only by declaration order in `app.main.ts`.
- Repinned the four Global Search assertions to the floating-canvas shapes: the
  `GlobalSearchWorkspace` element with its bounds-driven props, and a three-argument
  `onlyPreviewGlobalSearchWindowService.updateBounds` that still receives the same clamped preview
  rect passed to `onlyPreviewPreviewRegionService.updateBounds`.
- Brought the three over-budget files back under 800 lines:
  - extracted the preview open-trace bookkeeping into
    `src/main/onlypreview/views/onlyPreviewPreviewOpenTrace.service.ts`;
  - moved the presentation projection and the prepared-preview cancellation helper into the
    existing `onlyPreviewPreviewAdapter.service.ts` sibling;
  - extracted the renderer-error mapper, the metadata view model, and its projection into
    `src/renderer/onlypreview/preview/src/onlyPreviewPreviewViewModel.service.ts`;
  - split the four canonical-presentation-contract cases out of
    `onlyPreviewPreviewRegion.test.mjs` into
    `tests/onlypreview/onlyPreviewPreviewRegionPresentationContract.test.mjs`.
- Pointed `runtimeBootstrap` at a real temporary workspace directory and replaced the
  single-`setImmediate` wait with a bounded wait for `projection.ready`, keeping the
  `initializeSettled === false` assertion that proves rendering happens before initialize
  terminates.
- Removed the unused `webFrameMain` import.

## Verification

- `yarn test:onlypreview`: 810/810 pass, from 804 pass / 6 fail. The same 810 tests run before and
  after, so the split moved cases rather than dropping them.
- `yarn check:renderer-i18n`: `[check-renderer-i18n] ok`.
- `yarn typecheck`: still 80 errors, `diff`-identical to a `git archive HEAD` baseline — zero
  introduced, zero fixed (out of scope).
- Lint: `eslint --no-cache` over all 16 touched files reports **0 errors**, 249 warnings, and a
  per-file comparison against the HEAD baseline shows no new warning anywhere —
  `onlyPreviewPreviewRegion.service.ts` actually drops from 3 warnings to 1, and all four new
  modules are completely clean. 226 of the 249 are pre-existing `prettier/prettier` warnings in
  `check-renderer-i18n.mjs`, which is deliberately semicolon-free; reformatting it would be a large
  unrelated diff.
- **`yarn lint` (whole repo) cannot complete on this checkout — it runs out of memory.** A clean
  run with no competing process ends in `FATAL ERROR: Ineffective mark-compacts near heap limit -
  JavaScript heap out of memory` at roughly 4 GB, aborting with `SIGABRT`; it never reaches a
  verdict. That also explains the concurrent session's three-hour run, which was heading to the same
  crash. This is independent of the repairs here and reproduces without them. The per-file evidence
  above is what decides the gate — `yarn lint` fails on errors, not warnings, and there are none.
- Electron E2E, packaging, signing, and notarization were intentionally not run.
