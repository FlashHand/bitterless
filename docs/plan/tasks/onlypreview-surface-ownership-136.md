---
id: onlypreview-surface-ownership-136
scope: let only one OnlyPreview content surface be live, with the standalone window taking priority and the Cowork tab falling back to a View-in-window placeholder
status: pending
depends-on: [onlypreview-cowork-tab-mount-135]
verify: node --test tests/onlypreview/onlyPreviewSurfaceOwnership.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn check:renderer-i18n && git diff --check
---

# One live surface, and the window wins

## Objective

Owner decision, 2026-09-04: a standalone OnlyPreview window and a Cowork OnlyPreview tab must never
both be showing OnlyPreview. While the window is open the tab shows **View in window**, and clicking
it focuses the window.

## Context

- `docs/features/onlypreview-embeddable-mount.md` — *Lifecycle, ownership and identity*, including
  the state table and the transition table this task implements
- `src/main/onlypreview/onlyPreviewHost.registry.ts` (`hostToken` identity, revocation listeners)
- `src/main/onlypreview/views/onlyPreviewViewLayer.service.ts` (`OnlyPreviewViewLayerOwner`)
- `src/main/windows/onlyPreviewWindow.helper.ts` (`ensureStandalone`, `destroyStandalone`)
- `src/main/onlypreview/onlyPreviewOpenRouter.service.ts` (the one route every explicit open takes)

## Contract

- An arbiter owns the single-live-surface rule, and it lives in one place. Opening the standalone
  window demotes a `live` Cowork tab to `deferred` *before* the window's own surface is built, so the
  two never overlap even for one frame.
- `deferred` is a real occupant of the composite's `base` layer, owned by a new
  `OnlyPreviewViewLayerOwner` value `'deferred'`. The container and the layer service are the same in
  both states; the takeover is `hide('base', 'deferred')` then `show('base', 'shell', shellView)`.
- The placeholder is its own small renderer entry — the OnlyPreview mark, one line of copy, and one
  action. It gets a host capability of its own so its single call is token-checked like every other
  OnlyPreview call; it never receives a workspace, an index, or a file path.
- **View in window** shows and focuses the standalone window. If that window has gone away between
  paint and click, the action instead promotes the tab, rather than failing.
- Demotion disposes the tab's composite — not hides it. One bound workspace, one index watcher and
  one find session at a time is what lets the content services keep their single runtime.
- Both strings exist in `en.ts` and `zh.ts` under the OnlyPreview module and are read through
  `i18nHelper`.

## Verification

- The transition table, driven against stub mounts: every row, including the two "opened from the
  Mini Apps grid" rows and both close paths.
- Demotion disposes exactly one composite and leaves the tab's container attached.
- A promote request against a window that has already gone away promotes instead of throwing.
- No path can produce two live content surfaces, including a standalone open racing a tab open.
