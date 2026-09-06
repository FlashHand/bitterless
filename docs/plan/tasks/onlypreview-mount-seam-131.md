---
id: onlypreview-mount-seam-131
scope: introduce OnlyPreviewMount with a standalone implementation, route the single bounds choke point through it, and clamp every layer inside the composite rect
status: implemented; owner verification pending
depends-on: [onlypreview-surface-container-130]
verify: node --test tests/onlypreview/onlyPreviewMountSeam.test.mjs && node --test tests/onlypreview/onlyPreviewPreviewBounds.test.mjs && yarn typecheck:node && git diff --check
---

# The mount seam

## Objective

Make the composite ask its host for geometry and window services instead of holding a `BaseWindow`,
with today's window as the first implementation and no behaviour change.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (the `OnlyPreviewMount` interface)
- `src/main/windows/onlyPreviewWindow.helper.ts:528` (`updatePreviewBounds`, the one choke point)
- `src/main/windows/onlyPreviewWindow.helper.ts` `clampPreviewBounds`, `MIN_WIDTH`, `MIN_HEIGHT`
- `src/main/windows/windowState.service.ts`

## Contract

- `OnlyPreviewMount` is declared next to the surface, not next to any host: `kind`, `attach`,
  `detach`, `contentSize`, `onResize`, `onActivation`, `window`, `chrome`, `requestClose`,
  `reportTitle`. Hosts implement it; OnlyPreview never imports a host.
- `StandaloneOnlyPreviewMount` moves today's window ownership: `BaseWindow` creation and options,
  `WindowStateController`, bounds persistence, `MIN_WIDTH`/`MIN_HEIGHT`, `resize` → `onResize`,
  window focus → `onActivation`.
- `updatePreviewBounds` reads `mount.contentSize()` instead of `window.getContentSize()`. The three
  distributed rects and their consumers are unchanged.
- Containment is an invariant, not an assumption: a pure `clampSurfaceLayout(measured, contentSize)`
  returns the preview rect **and** the overlay rect, both contained in
  `{0, 0, contentSize.width, contentSize.height}`. Nothing may rely on a parent view clipping its
  children — that is unverified on this Electron build.
- Settings and the Agent Skill guide windows take their parent from `mount.window()`.
- `minimizeWindow` / `toggleMaximizeWindow` / `closeWindow` route through the mount.

## Verification

- A stub mount drives the surface: resize propagates, `contentSize` feeds all three rects.
- A **property test** over (composite extent × reported preview rect), including degenerate extents,
  asserting every returned rect lies inside `{0, 0, width, height}`. This is the invariant that
  stands in for ancestor clipping, which is deliberately not relied on.
- An **import-direction guard**: no file under `src/main/onlypreview/` imports `@maestro*`. The rule
  is stated in the feature doc and is otherwise unenforced.
- `yarn test:onlypreview` (added with this feature) so a focused verify line cannot pass while the
  rest of the domain breaks, plus `yarn build` for renderer-entry and CSP drift.
- `clampSurfaceLayout` is exhaustively tested including zero and negative sizes, an oversized
  measured rect, and a rect whose origin is outside the composite.
- Standalone geometry, minimum size and window-state persistence are unchanged.

## Result

Implemented.

New: `src/main/onlypreview/onlyPreviewSurface.mount.ts` (the `OnlyPreviewMount` seam — no host is
named in it), `src/main/onlypreview/onlyPreviewSurfaceLayout.ts` (the composite's own chrome
constants plus `clampOnlyPreviewSurfaceLayout`), `src/main/windows/onlyPreviewStandaloneMount.ts`.

`updatePreviewBounds` and the window's `resize` handler collapsed into one private
`applySurfaceLayout`, whose extent comes from `mount.contentSize()`. The window helper no longer
calls `contentView` or `getContentSize` anywhere — asserted, not just claimed. The window's `resize`
now only tells the mount; the mount re-sizes the container and notifies the composite.

`window: BaseWindow` left five runtimes for `isHostLive: () => boolean`: the alert, Global Search and
preview-view runtimes and their two `*Window` binding seams. A `surfaceLayoutFanout` flag was needed
because the overlay owners start after the window is shown, so the startup path would otherwise fan
a layout out to services that would refuse a host token they had not been given.

### Two bugs this found

Both were invisible to `typecheck:node`, which runs `tsc --noCheck` — i.e. it does not type-check.

1. `OnlyPreviewPreviewViewService.detachView` detached from `runtime.window.contentView`. The
   preview is a child of the *container*, and `removeChildView` on a non-parent is documented as a
   no-op, so the outgoing preview would have been left attached — and with `window` gone from the
   runtime the guard returned early and it never detached at all. Now detaches from
   `runtime.container`.
2. `onlyPreviewPreviewRegionGuards.service.ts` (extracted by concurrent work during this task) still
   gated on `runtime.window.isDestroyed()`, which threw on every guarded call. Now `isHostLive()`.

### Verification

- `yarn test:onlypreview`: 817 tests, all passing. Test harnesses migrated with the runtimes they
  stub — the preview-region, alert-view and Global-Search-view harnesses now hand the service a
  container and a liveness bit instead of a fake window.
- New `tests/onlypreview/onlyPreviewSurfaceLayout.test.mjs`: the property test over
  (extent x reported rect) proving every layer rect lies inside the composite, **plus** a proof that
  the preview rect is byte-identical to the pre-change clamp at every extent at or above the
  standalone 800x600 minimum — so standalone geometry cannot have moved. Also the
  import-direction guard: nothing under `src/main/onlypreview/` imports a host.
- Six pins moved with the code they describe, in `onlyPreviewSourceIntegration`,
  `onlyPreviewPreviewView`, `onlyPreviewViewLayer`, `onlyPreviewSurfaceContainer`,
  `onlyPreviewGlobalSearchUi` and `onlyPreviewSearchShellUi`.
- Targeted ESLint on all ten touched main-process files: 0 errors.
- Electron E2E not run.

### A verification hole worth knowing about

`yarn typecheck:node` is `tsc --noEmit --noCheck`: it parses, it does not check types. A real
`tsc --noEmit` over `src/main` **runs out of memory** — it died at 4GB in 70s and again at 12GB in
523s — which is presumably why `--noCheck` is there. `yarn lint` over the repo also aborts with
SIGABRT.

A narrow project that includes only `src/main/onlypreview/**`, the two OnlyPreview window files and
`src/shared/onlypreview/**` **does** complete, and is the only real type check available for this
work. Run against it, nothing in this task's changes errors; the errors it does report are
pre-existing (`import.meta.env.VITE_*` typings, several discriminated-union narrowing sites, and one
`A spread argument must either have a tuple type` in `openSettings`, untouched here).

