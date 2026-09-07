---
id: onlypreview-composite-tab-address-145
scope: show the OnlyPreview identity in the Maestro address bar after opening its composite tab
status: done
depends-on: [onlypreview-cowork-tab-mount-135]
verify: focused composite-tab navigation tests, scoped lint, current-profile electron-vite build
---

# OnlyPreview tab retains the Home URL

## Objective

Owner report, 2026-09-07: opening OnlyPreview from Bitterless's Mini App list leaves
`bitterless://home` in the address bar. The active OnlyPreview tab must show its existing registered
display URL, not the previous tab's address.

## Root cause

`maestroBrowserView.service.ts` returns early when activating a composite tab after updating the
tab selection and broadcasting `coach/tabs`. Unlike ordinary tabs, this branch does not send the
navigation/title state or update Main's `currentUrl`.

The renderer cannot rely on a second `coach/tabs` subscriber to compensate: the installed
electron-xpc preload retains one callback per handle name, and TabStore initializes after MenuBar
and overwrites its subscription. The Tab strip updates while the old Home address remains.

## Contract and path

- Reuse the existing composite identity/display URL; do not invent a web load or a second scheme.
- On composite activation, use the same existing navigation/title publication helpers as ordinary
  tabs. Main URL, renderer address, title and disabled history state must agree with the active tab.
- Keep the tab broadcast and existing composite mount/activation lifecycle intact.
- Switching back to Home or a web tab must publish that tab's real identity again.
- Do not change electron-xpc, introduce another competing topic listener, or refactor all stores.
- Scope: `src/main/maestro/windows/main/maestroBrowserView.service.ts` and focused regression tests;
  update docs with verification. Preserve all earlier layout/host-toggle edits.

```text
Mini Apps → open OnlyPreview composite → activate tab
                                      ├─ tab selection broadcast
                                      └─ existing nav/title helpers → address bar
```

## Verification

- Execute the actual composite activation path with native-view stubs; assert the registered URL,
  title, current URL and navigation-disabled state are published, including prior Home/web state.
- Existing Home/web tab activation and composite attachment remain intact.
- Focused tests, scoped lint and current-profile `yarn electron-vite build`; report pre-existing
  failures without unrelated cleanup. No Electron/E2E, review, profile switch, install or sync.
- Ral checks Mini Apps → OnlyPreview, then Home/web → OnlyPreview switching in the updated build.

## Delivery — 2026-09-07

The composite activation branch now calls the existing `sendTabNav(tab)` and
`sendTitle(tab.title)` helpers before returning. This updates Main's `currentUrl`, address,
title and navigation state without relying on the overwritten `coach/tabs` subscription. The
existing tab broadcast, mount and all concurrent workspace `openTarget` changes are preserved.

- New actual-module navigation tests in `tests/maestro/maestroCompositeTabNavigation.test.mjs`
  passed **2/2**; with necessary existing layout/Home/native-bounds regressions, **22/22** passed.

  ```sh
  node --test tests/maestro/maestroCompositeTabNavigation.test.mjs tests/maestro/maestroChatLayout.test.mjs tests/maestro/maestroNativeViewBounds.test.mjs tests/maestro/maestroLogoutHomeLanding.test.mjs
  ```

- Scoped ESLint `--quiet` and `git diff --check` passed.
- Current-profile `yarn electron-vite build` passed in **39.51 seconds**, without changes to
  package/builder/installer configuration.
- No full-repository type cleanup or independent review was performed for this two-line change.
  No new types or copy were introduced, so the already-blocked full typecheck and i18n checks
  were not repeated.
  No Electron/E2E, live-app test, installation, sync or profile/branch switch was performed.

Ral explicitly assigned workspace-click task 138 to another agent; this delivery neither changes
nor verifies that overlapping implementation. The BL Todo **验证 OnlyPreview Tab 地址栏显示**
records the remaining human acceptance in the updated build.
