---
id: onlypreview-mount-chrome-134
scope: publish the mount's window-chrome capability to the Shell so an embedded surface renders no minimize or maximize control
status: implemented; owner manual verification pending
depends-on: [onlypreview-shortcut-arbitration-133]
verify: node --test tests/onlypreview/onlyPreviewMountChrome.test.mjs && yarn typecheck:web && yarn check:renderer-i18n && yarn lint && git diff --check
---

# The Shell renders what its host can honour

## Objective

An OnlyPreview inside a Cowork tab must not show traffic lights it cannot operate, and must not
drag a window that is not its own.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (chrome and window commands)
- `src/preload/onlypreview/onlyPreviewEnv.preload.ts` (`--onlypreview-*` additional arguments)
- `src/preload/onlypreview/onlypreview.preload.type.ts` (`OnlyPreviewEnvApi`)
- `src/renderer/onlypreview/shell/src/App.vue:60-100` (the three window controls)
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:205-219`

## Contract

- A new `--onlypreview-host=window|cowork` additional argument reaches the renderer on
  `onlyPreviewEnv.host`, exactly as `hostToken`, `hostId`, `mode` and `platform` already do. No new
  XPC method and no new IPC channel. Named `host`, not `chrome` or `mount`: `mode` already means the
  renderer entry, and `mode`/`mount` differ by one letter on adjacent lines.
- The Shell store exposes the capability; `App.vue` renders minimize and maximize only for
  `window`, and the double-click-to-maximize drag region only for `window`.
- Close stays available in both modes and routes to `mount.requestClose()`.
- Any new user-facing string exists in both `en.ts` and `zh.ts` under the OnlyPreview module and is
  read through `i18nHelper`.

## Verification

- The env resolver maps a missing, valid and invalid argument to a defined capability, defaulting to
  `window`.
- Renderer source assertion: the two controls are conditional on the capability, and no control
  calls a command the mount declares unavailable.

## Result

Follow-up 144 records an implementation gap found on 2026-09-07: the macOS inset class still
tested only `isMac`, despite the intended host gate below. Its repair and the compact folder
action are tracked in [Tab MenuBar alignment](onlypreview-tab-menubar-alignment-144.md).

Implemented. `OnlyPreviewEnvApi` gains `host: OnlyPreviewHostSurface` ('window' | 'cowork'),
resolved in `onlyPreviewEnv.preload.ts` from `--onlypreview-host`, which `createView` fills from
`mount.kind`. The Shell derives `ownsWindow` from it and gates two things on it: the Windows
minimize/maximize/close group, and the macOS traffic-light inset class. Close stays reachable in
both hosts because the mount maps it to a window or a tab.

The fallback direction is deliberate and tested: an absent or unrecognised value resolves to
`window`. A surface that wrongly believes it owns a window shows controls that fail loudly; one that
wrongly believes it is embedded silently loses its own window controls.

Verified by `tests/onlypreview/onlyPreviewMountChrome.test.mjs` (4/4) — a real behavioural test of
the argument builder, bundled with electron stubbed, plus the prefix trap that
`--onlypreview-host` and `--onlypreview-host-token` must both survive together. Build clean;
`typecheck:web` adds nothing (its two `onlypreview`-path errors are in the pre-existing 20-file
baseline). Electron E2E not run.
