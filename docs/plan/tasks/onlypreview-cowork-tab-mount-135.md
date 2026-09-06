---
id: onlypreview-cowork-tab-mount-135
scope: implement the Cowork mount as a Maestro tab kind that carries the OnlyPreview container, and open it from the Mini Apps grid inside Maestro
status: pending
depends-on: [onlypreview-mount-chrome-134]
verify: node --test tests/onlypreview/onlyPreviewCoworkMount.test.mjs && node --test tests/maestro/maestroTabSurface.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn check:maestro && yarn check:renderer-i18n && git diff --check
---

# OnlyPreview as a Cowork tab

## Objective

Open OnlyPreview inside the Maestro browser window as a Mini App tab, using the tab rect Maestro
already measures and the tab visibility it already toggles.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (the design, and what the host already offers)
- `src/main/maestro/windows/main/maestroBrowserView.service.ts` (`OperationTab`, `buildViewSlot`,
  `buildPinnedHomeView`, `activateTab`, `closeTab`, `addChildView(view, 0)`)
- `src/main/maestro/windows/main/maestroWindow.controller.ts:1593-1614` (`layout`, `setViewBounds`,
  `opBounds`, `TOOLBAR_H`, `SIDEBAR_W`)
- `src/renderer/maestro/workbench/src/views/WorkbenchAppsView.vue:35` and the local Home Mini Apps
  grid, which call `openOnlyPreviewWindow()` today

## Contract

- `OperationTab` gains a `kind: 'onlypreview'` whose content is a container `View`, not a
  `WebContentsView`. Tab code that reaches for `tab.view.webContents` — navigation, address, favicon,
  loading watchdog, capture, replay, debugger — must be inert for this kind rather than throwing.
  Title comes from `mount.reportTitle`, and the tab's icon is the OnlyPreview icon.
- The container is attached with `addChildView(container, 0)` so it sits below Maestro's chrome and
  control sidebar, and is positioned from `opBounds` — with `layout()`'s first-frame rect as the
  fallback, exactly as tab views are today.
- Tab switching uses `container.setVisible(false|true)`. Per-layer visibility inside the composite
  is not touched: hiding a container already hides its children, and the composite's own layer state
  must survive a switch.
- Closing the tab calls the surface's dispose path; disposing the surface closes the tab. Neither may
  leave the other behind.
- Inside Maestro, the Mini Apps OnlyPreview entry opens this tab. The Bitterless Home grid keeps
  opening the standalone window. Both go through the same open router.
- **Command+W must close the tab, not the window.** Maestro installs its tab chords only for
  contents in `MAESTRO_PARTITION` (`src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts`),
  and the composite's views carry no partition, so today the chord would fall through to the
  inherited `fileMenu` `close` role and close the whole Cowork window. Add a module `WeakSet` plus
  `enrollMaestroShortcutContents(contents)` in that file, widen its gate to admit enrolled contents,
  and have this mount enroll each composite view as it is created. The partition test stays the
  default so web content in a tab still cannot claim Bitterless chords. Enrollment grants a
  keystroke, not a session: the composite stays in the default session and shares no cookies or
  storage with sibling tabs.
- **The OnlyPreview tab is excluded from the warm cap.** `enforceWarmCap` keeps at most `MAX_WARM`
  warm views and evicts the rest through `performCoolTab`, which does
  `removeChildView(view)` + `view.webContents.close()` and sets `tab.view = null`. Against a
  container that closes nothing and disposes nothing — the shell, preview, overlay renderers, the
  hidden `fileSearch` runtime, the bound workspace, the index watcher and the host capability would
  all be orphaned while the tab looked empty. Exclude the kind, and assert it.
- Teardown is symmetric and complete: `closeTab` and `reset` route to surface disposal, and
  disposing the surface closes the tab. Whichever event actually fires when the Cowork window goes
  away must reach disposal — verify which one that is rather than assuming `closed`.
- Maestro's own chords keep working while an OnlyPreview tab is active, per task 133.

## Verification

- A stub Maestro host drives the mount: attach at index 0, `opBounds` positioning, first-frame
  fallback, activate/deactivate visibility, close in both directions.
- Non-web tab kinds do not reach `webContents` on any tab path.
- Existing Maestro checks and tab tests pass.
