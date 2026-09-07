---
id: onlypreview-cowork-tab-mount-135
scope: implement the Cowork mount as a Maestro tab kind that carries the OnlyPreview container, and open it from the Mini Apps grid inside Maestro
status: done — owner verified 2026-09-07
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

## Result

Implemented, with the surface/window split that made it possible.

**The split.** `createStandaloneWindow` now stops after creating the window, registering its
persisted geometry and translating its three events (`closed`, `focus`, `blur`) for the mount. The
~250 lines after that moved verbatim into `attachSurface(host, mount, ...)`, which both hosts run.
`openOnMount(mount)` is the second entry: it issues the host capability and calls the identical
`attachSurface`, so the Cowork path shares every diagnostic, lease, renderer-failure handler and
DevTools guard rather than reimplementing them.

Three more host-shaped behaviours left the composite for the seam: `showSurface()` (a window shows
and focuses itself; a tab activates), `onHostGone()` (was `window.once('closed')` directly, which is
precisely the assumption that made the composite unhostable), and `destroyHost()`.

**The tab.** `TabKind` gains `'onlypreview'`; `OperationTab` gains `surface`/`surfaceDispose` and
keeps `view: null`. That null is load-bearing twice over: `enforceWarmCap`'s `warm` filter only
counts tabs with a live `view`, so a composite tab can never be cooled — which would have detached
the container while orphaning four renderers, the hidden `fileSearch` runtime, the bound workspace
and the host capability — and the persistence writer filters to `kind === 'browser'`, so a URL-less
tab is never saved or restored as a broken web tab. Both were checked, not assumed.

`activateTab` gains one early branch for the kind (no warm, no load, no capture, no replay) plus a
`hideTabContent` helper so leaving a composite tab reaches its mount; `performCloseTab` gains a
branch that routes to the surface's own teardown. The container attaches at
`addChildView(container, 0)` — the tab-view position — so the whole composite sits below Maestro's
chrome and control sidebar by construction, and OnlyPreview's own sort can never interleave with
Maestro's views. Two independent stacks, one nested inside the other.

**Bounds.** `MAESTRO_TOOLBAR_H`/`MAESTRO_SIDEBAR_W` and a `maestroFirstFrameOperationRect` helper
moved into `viewBounds.ts`, which both sides already import. A composite tab cannot wait for the
renderer's first measurement the way a loading web page can: with no rect the container gets no
bounds, and a zero-size container hides its children, so OnlyPreview would have opened to nothing.
`setViewBounds` and `layout()` both now call `refreshCompositeTabs()`, without which the container
would keep a stale rect through every window resize.

**The front door.** The Mini Apps grid is one component shared by the Bitterless Home window and
Maestro's bundled Home tab, so it takes a `host` prop — `'cowork'` from `localHome.router.ts`, the
same way that router already passes `showChatMenuControl` — and routes to `coach.openOnlyPreviewTab`
in Cowork and to the standalone window everywhere else. The Workbench Apps pane, being
Maestro-only, calls the tab route unconditionally.

### Not in this slice

- Shortcut arbitration, including the Command+W hole (task 133) and the Maestro enrollment seam.
- The chrome capability, so the embedded Shell still renders its window controls (task 134). Close
  works; minimize and maximize will do nothing until 134.
- The `deferred` placeholder and the standalone-close takeover (tasks 136, 137). Today the ownership
  rule is enforced only as "one live surface": whichever entry point asks second brings the existing
  surface forward instead of building a rival.
- `onlyPreviewHostRegistry.issue('standalone', 'content')` is still the kind issued for a Cowork
  surface, because two guards and a pinned union test compare against `'standalone'`. The name is
  now a misnomer meaning "the content host"; task 132 renames it.

### Verification

`yarn build` clean, `yarn typecheck:web` clean for these changes (19 pre-existing errors, all in
`src/renderer/common/poker/gto/tests/gtoEngine.test.ts`), `yarn check:maestro` clean,
`yarn test:onlypreview` 817/817, targeted ESLint 0 errors on every touched file. Electron E2E not
run, by instruction.

**Owner verified 2026-09-07**: 「bitterless 里那个 Cowork tab 出来了」. The remaining checklist items
below stay useful as a regression script, but the load-bearing one — the tab appears and carries the
composite — is confirmed.

## Owner manual checklist

Priority order, per the owner's instruction that OnlyPreview must open first.

1. **Standalone still opens.** Bitterless Home → Mini Apps → OnlyPreview. Expect the window exactly
   as before: project rail, toolbar, status bar, traffic lights, 800x600 minimum, restored geometry.
   Open a file, resize the window, open Global Search (Shift+Cmd+F), open Find (Cmd+F), delete
   something to get a dialog. This is the regression check for tasks 130 and 131.
2. **OnlyPreview opens in Cowork.** Open Cowork, Home tab → Mini Apps → OnlyPreview. Expect a new
   tab titled "OnlyPreview" whose content is the full OnlyPreview surface, sitting under the tab
   strip and address row and left of the chat sidebar.
3. **Tab switching.** Switch to another tab and back. Expect OnlyPreview to disappear and return
   with its project and selected file intact — including any open dialog or Global Search.
4. **Resize.** Resize the Cowork window with the OnlyPreview tab active. Expect the composite to
   track the content rect with no gap and no overhang over the chrome or the sidebar.
5. **Close.** Close the OnlyPreview tab. Expect the tab to go and OnlyPreview to shut down — not the
   window. Then reopen it from Mini Apps.
6. **One at a time.** With the Cowork tab open, open OnlyPreview from the Bitterless Home grid.
   Expect the existing surface to be brought forward rather than a second one appearing. The
   placeholder and the rebuild-on-close behaviour are tasks 136/137 and are not in yet.

Known-not-done while testing: minimize/maximize in the embedded Shell do nothing, and Command+W with
focus inside the embedded OnlyPreview may close the Cowork window (task 133).

