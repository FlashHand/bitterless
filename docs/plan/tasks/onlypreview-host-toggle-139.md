---
id: onlypreview-host-toggle-139
scope: one toggle in the OnlyPreview top-right that moves the surface between a Cowork tab and its own window, with a two-state Tabler icon
status: done
depends-on: [onlypreview-mount-chrome-134]
verify: focused host-toggle tests, scoped lint/typechecks, yarn check:renderer-i18n, yarn electron-vite build, git diff --check
---

# Move OnlyPreview between a tab and a window

## Objective

Owner request, 2026-09-07: 「onlypreview 右上角增加一个按钮 即 tabler open in standalone window 的
方式，打开后，关闭 onlypreview 的 tab 并在单独窗口打开，然后，再次点击能回到 tab，做成一个 toggle
开关风格的 icon 两种风格。micromeet-cowork 和 bitterless 都要」

Latest owner clarification: place the button **right of Settings**, with visibly different Tabler
states. This delivery targets Bitterless's OnlyPreview; the separate micromeet-cowork port remains
outside this task.

One control, two states: from a Cowork tab it opens OnlyPreview in its own window and closes the
tab; from the window it puts OnlyPreview back in a tab and closes the window.

## Context

- `src/renderer/onlypreview/shell/src/App.vue:44-99` — the top-right command row: a Settings
  `a-button` on every platform, then minimize/maximize/close **only** under `v-if="isWindows"`
  (macOS uses native traffic lights). Icons come from `@tabler/icons-vue`.
- `docs/features/onlypreview-embeddable-mount.md` *Lifecycle, ownership and identity* — the
  ownership rule this button drives, and the owner's 2026-09-04 decision behind it.
- Task 134 publishes `--onlypreview-host=window|cowork` to the Shell. Tasks 136/137 remain planned:
  there is no implemented ownership arbiter or deferred placeholder to call. The current helper
  already owns exactly one live mount, but its open methods only focus an existing mount. This task
  adds one explicit serialized relocation entry over that helper and existing mount teardown/open
  operations; it does not implement the separate automatic priority/placeholder policy.

## Contract

- **One button, right of Settings, present in both modes** — not inside the `isWindows` block, which
  exists for window controls macOS renders natively. It is the one control that means something in
  every host.
- **Two states, from the mount kind, not from a local flag.** The Shell already learns its host
  through the existing `onlyPreviewEnv.host` argument; derive the icon and the label from that,
  without another bootstrap argument. A local
  boolean would drift the moment the surface is relocated by anything other than this button.
  - In a Cowork tab: `IconExternalLink` — "open in a separate window".
  - In its own window: `IconBrowser` — "put back in a Cowork tab".
  Both names verified present in `@tabler/icons-vue`. The window state also has a subtle selected
  background. Keep the existing Royal Blue (`#4e5882`) bar, 27px target, light icons and focus ring.
- **One explicit transition path.** A capability-checked Main entry serializes against existing
  target mutations and guards duplicate calls. It checks that the source is current and the target
  host is available before disposing the old mount and opening the new one. Wait for already-queued
  persistence and reuse first-restore for the Project. A bounded Main-only descriptor of the current
  Project and selected target may bridge this explicit transition, because a file opened outside
  the Project has no existing `last_file` record. Capture it from current authority, never renderer
  paths; reauthorize the target and issue fresh capabilities on the destination through the existing
  preview pipeline. Recheck source/target liveness after awaits and prefer the latest accepted
  selection before teardown. **No live view, bytes, index or capability is transferred, and no
  container is re-parented.** This narrow explicit-toggle exception does not change the planned
  automatic standalone-close takeover or create a second persistence schema.
- **Docking needs a host.** Going window → tab requires a Cowork window able to carry it. When
  there is none the button is disabled with a title saying why, rather than silently doing nothing
  or opening a window the owner did not ask for. See PQ-1 below.
- The button is disabled while a relocation is in flight, so a double click cannot start two.
- Failure before teardown leaves the source intact. A destination failure after teardown must
  attempt to recover the source host through the same open/restore path and surface/log the failure;
  never report success for an unbuilt target or create a second live surface. Main finishes the
  transition independently of the old Shell's XPC response, because teardown destroys that sender.
- Availability is fetched on Shell initialization and when the window regains focus; Main always
  validates again at click time. No polling loop or per-keystroke work is needed.
- Labels for both states exist in `en.ts` and `zh.ts` under the OnlyPreview topbar namespace and are
  read through `onlyPreviewI18n`, like every sibling control in that row.
- Stable `name` attribute for automation, matching its siblings: `onlypreview__host-toggle`.

```text
MenuBar ... [Open folder] [Agent guide] [Settings] [Host toggle] [Windows controls, if owned]
Tab host:    [ExternalLink]  -> separate window
Window host: [Browser + selected tint] -> Cowork tab (disabled if browser absent)
```

## Implementation boundary

Host glue belongs in `src/main/windows/`, which may know both OnlyPreview and Maestro. Modules
under `src/main/onlypreview/` must not import Maestro. Reuse the existing composite registration and
target mutation queue; no new filesystem I/O or preview/index pipeline. Shared types and the
OnlyPreview XPC handler expose only scoped state and the switch intent. The renderer owns button
state, localized labels, pending/error presentation and focus-time refresh.

`onlyPreviewTargetMutations.run` already serializes explicit opens and folder-choice commits.
Revalidate a dialog's old host inside its queued callback after a possible relocation. Do not
re-enter that FIFO from a queued switch. Add a bounded flush of the existing recent-directory/file
write chain before teardown; reuse the first-restore and existing target authorization/presentation
operations without forwarding old capabilities or adding filesystem work in Main.
Use mount teardown, not the old `closeWindow()` helper, which can close the browser itself.

## micromeet-cowork

The same control is wanted there, and it is **contingent on the port decision** — OnlyPreview does
not exist in that repository today. See `projects/micromeet-cowork/docs/features/onlypreview-miniapp.md`.
When it lands there it follows that repo's conventions, not these: its own i18n handling and its
mini-app tab lifecycle. The contract above that carries over unchanged is the two-state derivation
from the mount and reuse of the host's existing teardown/open lifecycle.

## Verification

- The icon and label follow the mount kind, for both kinds, including a mount kind the renderer does
  not recognise (fall back to the window state rather than rendering nothing).
- Tab → window: the relocation entry is called once, the tab is disposed, the window is built, and the
  rebuilt surface requests the persisted directory and file.
- Window → tab: the same in reverse; with no Cowork host available the button is disabled and the
  relocation entry leaves the window untouched.
- A double click starts exactly one relocation.
- Both strings present in both languages; `check:renderer-i18n` passes.
- Exercise actual host glue with native/runtime stubs, delayed persistence, duplicate requests,
  invalid/stale capabilities, absent/closing browser and failed destination recovery. Mounted/source
  UI checks cover ordering, both icons, selected state, disabled/pending and receiver-safe click.
- Continuity cases include an ordinary Project file, an explicitly opened Project file, a file
  outside the Project, no Project, and a file removed before destination reauthorization. A missing
  file keeps the Project visible with an honest error/empty state, never a stale rendered document.
- Run focused tests, scoped lint/typechecks and current-profile `yarn electron-vite build`.
  Report existing unrelated failures; do not change build profile, install/release, sync or branch.
- No independent review or Electron/E2E. Ral owns real-window and PDF/Office continuity checks.

### Human validation after running the updated build

1. Open OnlyPreview in a browser tab. Confirm the toggle is immediately right of Settings, with
   the external-link icon; click it and confirm only the OnlyPreview tab closes, not the browser.
2. In the standalone window confirm the browser icon and selected tint, then click it to return to
   a tab. The old window must close, with one OnlyPreview surface remaining.
3. Repeat with a selected Project file and an explicitly opened external file, including PDF and
   Office. The same Project/file should reopen; this is target continuity, not preservation of
   transient zoom, scroll, selection or media playback.
4. Click rapidly while switching. Confirm the pending control prevents duplicate windows/tabs.
5. Close the browser while OnlyPreview is standalone. Refocus OnlyPreview and confirm docking is
   disabled with a reason; opening the browser and refocusing should enable it again.

## Delivery — 2026-09-07

Implemented in `onlyPreviewHostToggle.service.ts` (Main host glue), the existing scoped XPC API,
and `onlyPreviewHostToggle.store.ts` / Shell MenuBar. The source host is destroyed before the
destination is rebuilt. Recent writes are awaited; a Main-only Project/file descriptor is
reauthorized through the existing preview pipeline, including explicitly opened external files.
Destination failures attempt source recovery; stale directory-dialog commits cannot overwrite the
new host. No new Main filesystem I/O, preview engine or persistent storage schema was introduced.

The original 800-line source guards remain: Shell store 796 lines; handler 783. Only the new
toggle state and the affected folder-dialog operation were extracted into focused modules.

Code verification:

- **70/70 passed**, including 10 new Main and 7 new UI/store cases:

  ```sh
  node --test \
    tests/onlypreview/onlyPreviewHostToggle.test.mjs \
    tests/onlypreview/onlyPreviewHostToggleUi.test.mjs \
    tests/onlypreview/onlyPreviewAppWiring.test.mjs \
    tests/onlypreview/onlyPreviewMountChrome.test.mjs \
    tests/onlypreview/onlyPreviewExplicitOpenSerialization.test.mjs \
    tests/onlypreview/onlyPreviewRecentDirectory.test.mjs \
    tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs
  ```

- `yarn check:renderer-i18n` passed. New source/tests ESLint passed; touched source has no lint
  errors. The wider scoped lint retains the pre-existing unused `explicitOpen` in
  `onlyPreviewAppWiring.test.mjs:204` and existing formatting warnings.
- `yarn typecheck:web` remains blocked by existing poker test globals, home/omni/maestro,
  OnlyPreviewTreeSelection and Find.registry errors. `yarn check:maestro` remains blocked by
  existing host-alias boundary failures. These unrelated modules were not repaired in this task.
- `yarn typecheck:node` passed its configured `--noCheck` command; this is not evidence of a full
  Node typecheck.
- `yarn electron-vite build` passed in 25.26 seconds on the unchanged current profile. No generated
  package/builder/installer configuration differences resulted.
- Scoped `git diff --check` passed. Whole-worktree checking still reports unrelated task 133/135
  documentation trailing blank lines; those edits were preserved.

No Electron/E2E, installed-app replacement, independent review, commit, sync or branch switch was
performed. Code delivery is complete; actual-window acceptance belongs to Ral. The existing BL
Todo **window toggle** holds the human checklist and remains active; its title/star/date were
preserved.

## Pending questions

| id | question | default if unanswered |
| -- | -------- | --------------------- |
| ~~PQ-1~~ | ~~With no Cowork window open, should the dock button be disabled, or should it open Cowork?~~ | **Decided by the owner 2026-09-07 ("go 按你的建议来"): disabled, with a title saying why.** OnlyPreview does not launch the browser. |
