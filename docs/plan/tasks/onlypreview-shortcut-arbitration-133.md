---
id: onlypreview-shortcut-arbitration-133
scope: resolve the macOS Find accelerators through a surface resolver so they reach an embedded OnlyPreview and still fall through to every other window
status: partially implemented — the Command+W hole is fixed; the menu resolver is still pending
depends-on: [onlypreview-surface-registry-132]
verify: node --test tests/onlypreview/onlyPreviewApplicationFindMenu.test.mjs && node --test tests/onlypreview/onlyPreviewShortcutArbitration.test.mjs && yarn typecheck:node && git diff --check
---

# Which surface owns this chord

## Objective

Make the one window-aware shortcut carrier host-aware instead, so Command+F and Shift+Command+F work
when OnlyPreview is a Cowork tab without taking those chords from Maestro or from any other window.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (the three-rule resolver and the collision list)
- `src/main/menu/applicationFindMenu.service.ts` (accelerator, dispatch, replay fallback)
- `src/main/windows/onlyPreviewWindow.helper.ts` `runMenuFindCommand`, `bindNativeShortcuts`,
  `executeNativeCommand`, `resolveFocusedOrigin`
- `tests/onlypreview/onlyPreviewApplicationFindMenu.test.mjs`

## Contract

- A pure `resolveShortcutSurface({ focusedWindow, focusedContents, surfaces })` applies, in order:
  1. the focused `webContents` belongs to a surface's views → that surface;
  2. the focused window is a surface's mount window **and** that surface is the mount's active
     foreground content → that surface;
  3. otherwise none, and the existing replay to the focused contents runs unchanged.
- `runMenuFindCommand` uses the resolver in place of `window !== this.baseWindow`. Returning `false`
  must keep meaning "not claimed", so the replay path is untouched.
- `bindNativeShortcuts` is unchanged: `before-input-event` is already scoped to the focused view, and
  a background tab's container is hidden so its views cannot hold focus.
- Chords that must never be claimed by OnlyPreview in either mount: Command+W, Command+T,
  Command+L, Command+R. In the Cowork mount, the composite's own close request is
  `mount.requestClose()` — closing the tab, not tearing down the window.
- The alert-layer swallow widens from `{find-in-file, focus-search}` to **every** native command
  while a dialog is visible: a dialog is modal to the composite, so no chord may act behind it.
- The claiming mechanism stays `event.preventDefault()` on `before-input-event`, which suppresses the
  menu shortcut too. Do **not** rewrite the `fileMenu`/`viewMenu` roles, and do **not** reach for
  `webContents.setIgnoreMenuShortcuts` — it would disarm Find and Find-in-Project on the
  out-of-process PDF frame that made the menu accelerator necessary. Record the rejection.
- The mount claims keyboard focus for the composite's preferred view on mount, on activation, and
  immediately after `openDevTools({ mode: 'detach', activate: false })` — a `BaseWindow` of views can
  have no focused child at all, and a detached DevTools window takes key status while binding both
  Find chords itself.
- Any remaining focus scan must ask the surface's own views, never the window's children. The one in
  `ensureFocusedView` was already moved to `container.children` while landing task 130; this task
  checks no other scan is left.
- The DevTools gate keeps its current behaviour.

## Verification

- The resolver is tested for: focus inside a surface view; focus in the host chrome with the surface
  active; focus in the host chrome with the surface in a background tab (not claimed); no surface at
  all; a revoked surface.
- The existing find-menu test passes, including the unclaimed-chord replay.

## Result so far

**The Command+W hole is fixed** — it was a live defect in what task 135 shipped, not a future risk.

`src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts` gains a module `WeakSet` and
`enrollMaestroShortcutContents(contents)`, and its gate widens from
`contents.session !== session.fromPartition(MAESTRO_PARTITION)` to also admit enrolled contents. The
partition test stays the default on purpose: it is what stops arbitrary web content in a tab from
claiming Bitterless chords. Enrollment grants a keystroke, not a session — the composite keeps its
own session.

Enrollment reaches the seam rather than the host: `OnlyPreviewMount` gains
`registerSurfaceView(webContents)`, the standalone mount ignores it, and the Cowork mount enrolls.
The composite offers every view it creates — in `createView` for the four layers, and in
`bindChromeShortcuts` for the raw Chromium surface, which `createView` does not build and would
otherwise have left Command+W taking the window whenever a PDF had focus.

One ordering detail that would have been a silent no-op: enrollment can happen before or after
`activateShortcuts`, so the actions are remembered in a module variable rather than captured. A view
enrolled first would otherwise have received no binding at all.

### Still pending in this task

The three-rule menu-accelerator resolver, the widened alert swallow, `claimKey()` on
mount/activation/after detached DevTools, and the own-views focus scan. Those need the surface
registry (task 132); the Command+W fix did not, so it went in first.

### Verification

Build clean, `yarn test:onlypreview` green, `check:maestro` gains no violation from the change
(my count stays 0; the 29 it reports are pre-existing). Electron E2E not run.

