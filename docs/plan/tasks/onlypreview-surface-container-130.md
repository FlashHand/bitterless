---
id: onlypreview-surface-container-130
scope: give the OnlyPreview composite its own container View and make the layer service order children inside it, one instance per surface
status: implemented; owner verification pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewViewLayer.test.mjs && node --test tests/onlypreview/onlyPreviewSurfaceContainer.test.mjs && yarn typecheck:node && git diff --check
---

# One container View under the four layers

## Objective

Stop attaching OnlyPreview's four layers to a window. Attach them to a container `View` that the
composite owns, so the whole surface can later be placed anywhere a native view can go, and keep
standalone behaviour identical.

## Context

- `docs/features/onlypreview-embeddable-mount.md`
- `src/main/onlypreview/views/onlyPreviewViewLayer.service.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts` (shell attach at window creation)
- `tests/onlypreview/onlyPreviewViewLayer.test.mjs` (existing stub-window ordering test)

## Contract

- The window helper creates and owns the container `View`, keeps it filling the window's content
  rect, and attaches the Shell into it. The module-level `onlyPreviewViewLayerService` singleton
  stays a singleton in this task — per-surface instancing arrives with the registry in task 132, and
  splitting it here would drag the three `*Window` binding seams into a container change.
- `OnlyPreviewViewLayerService.start(container: View)` replaces `start(window: BaseWindow)`, and
  `resort()` calls `container.addChildView(view)`. The re-add-to-reorder algorithm, the
  owner-keyed occupancy, the refusal return value, the no-occlusion rule and the change-only
  `event=view-layers` record are unchanged.
- Liveness: `View` has no `isDestroyed()`, so the service must not invent one. `start(container)`
  records the container, `stop()` clears it, and `resort()` is a no-op with no container. Dead
  *child* detection keeps using the existing `webContents.isDestroyed()` probe.
- The container is created with no background colour, so it cannot paint a rectangle over the host.
- Standalone mode attaches the container to `window.contentView` filling the content rect, so the
  four layers keep the coordinates they have today.

## Verification

- The existing layer test passes against a stub container instead of a stub window: order, refusal,
  owner swap, dead-view eviction, no-occlusion.
- A new test proves the container fills the standalone content rect and that a disposed surface
  performs no further attaches.
- Nothing calls `window.contentView.addChildView` for an OnlyPreview layer any more.

## Result

Implemented. `typecheck:node` clean; `tests/onlypreview/onlyPreviewViewLayer.test.mjs` 6/6 against a
stub container; new `tests/onlypreview/onlyPreviewSurfaceContainer.test.mjs` 4/4; the alert-view,
alert-dialog and application-find-menu suites 37/37.

Whole-domain run: 810 tests, 804 pass, **6 failures that predate this change** — the live-bounds
assertion in `onlyPreviewSearchShellUi.test.mjs` expects a two-argument
`onlyPreviewGlobalSearchWindowService.updateBounds(host.hostToken, bounds)` that the source has not
had for some time (verified: it does not match `HEAD` either), the Draw.io 800-line budget covers
only preview-region and Draw.io files, and the remaining four assert on Shell and preview renderer
sources this task does not touch. Not repaired here — unrelated drift.

## Two repairs the container forced

Found by review after the container landed, both caused by it, both fixed in this task:

1. **`ensureFocusedView` would have stolen focus on every selection.**
   `onlyPreviewPreviewView.service.ts` asked `runtime.window.contentView.children` whether anything
   of this surface held focus. With a container the window has one child, a plain `View` with no
   `webContents`, so the scan always answered "nothing focused" — and its own comment says it must
   only claim focus "when nothing else has it, so navigating the Project tree by keyboard or by click
   keeps its focus". `OnlyPreviewPreviewRegionRuntime` now carries `container: View` and the scan
   reads `container.children`, which is exactly this surface's four layers.
2. **The E2E harness threw.** Eleven places in `tests/onlypreview` read
   `window.contentView.children` and then `.webContents` off each child — `undefined` on a
   container, so a TypeError, not merely a wrong assertion. All eleven now descend through any child
   that is not itself a web view, so a flat window and a nested one return the same list.
   `tests/onlypreview/specs/onlyPreview.spec.ts`'s `toHaveLength(2)` and unique-`webContentsId`
   assertions therefore hold unchanged.

**Electron E2E was not run** — this project forbids agent-initiated E2E. The specs are updated with
the code and are handed to the owner. They are also not type-checked by any tsconfig
(`typecheck:node` covers `src/**` only, and runs with `--noCheck`), so the edits were verified by
ESLint and by reading, not by a compiler.

`package.json` gains `test:onlypreview` (`node --test tests/onlypreview/*.test.mjs`): the domain had
no aggregate runner, which is how a focused `verify` line can pass while the rest of it breaks.

## Note for task 131

`onlyPreviewSourceIntegration.test.mjs` pins `MIN_SIDEBAR_WIDTH`, `RESIZE_HANDLE_WIDTH`,
`MENU_BAR_HEIGHT`, `STATUS_HEIGHT` and the `clampPreviewBounds(currentBounds, width, height)` call
*inside the window helper*, and `onlyPreviewPreviewView.test.mjs` pins `PREVIEW_TOOLBAR_HEIGHT = 43`
there too. Those constants describe the composite's own chrome, not the window, so moving them with
the clamp is right — but both pins move with them in the same change, or two passing tests break.

