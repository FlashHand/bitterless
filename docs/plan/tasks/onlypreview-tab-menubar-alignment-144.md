---
id: onlypreview-tab-menubar-alignment-144
scope: OnlyPreview tab title inset and icon-only Open folder action
status: done
depends-on: [onlypreview-mount-chrome-134]
verify: focused Shell/mount tests, scoped lint and current-profile build; owner checks Electron layout
---

# Align the OnlyPreview tab MenuBar

## Objective

Inside a Maestro/Cowork tab, OnlyPreview's title must use the ordinary left gutter rather than
reserve macOS traffic-light space. Remove the Open folder text and center its icon vertically.

## Context and root cause

- `docs/features/onlypreview-embeddable-mount.md`
- `docs/plan/tasks/onlypreview-mount-chrome-134.md`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`

The Shell already receives `host: window | cowork` and derives `ownsWindow`, but its macOS inset
class tests only `isMac`, applying the 78px padding to embedded tabs too. No new host detection,
IPC or process is needed. Open folder still renders a text label using a non-square button.

## Layout and contract

```text
Tab:        |10px [icon] OnlyPreview /project/path        [folder+] [agent] [settings]|
Mac window: |78px [icon] OnlyPreview /project/path        [folder+] [agent] [settings]|
```

- Retain the 32px bar, Royal Blue palette (`#4e5882`), light title (`#fff`), muted path, system
  typography and existing compact spacing. No new visual theme or layout abstraction.
- Gate the macOS 78px inset on `isMac && ownsWindow`; Tab uses the existing 10px padding.
- Open folder is icon-only in both hosts and uses the existing 27px square icon-action treatment.
  Preserve its localized tooltip and accessible label, disabled state and choose-folder action.
- Center the icon wrapper and SVG explicitly so text baseline spacing cannot shift the glyph down.
- Preserve window controls, host routing, shortcuts, drag behavior and all unrelated current edits.

## Path

- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- Focused tests in `tests/onlypreview/`
- This task and linked documentation

## Verification

- Cover macOS window versus Cowork inset selection and the icon-only action's accessibility,
  disabled state, click binding and centered geometry rules.
- Run related Shell/mount tests and scoped lint. Build with `yarn electron-vite build` in the
  current profile; do not use the wrapper that switches runtime profiles.
- No Electron launch, E2E, independent review, commit/sync or installed-app replacement.
- Ral checks the embedded and standalone MenuBars, icon centering and folder-picker action.

## Delivery result

Implemented on 2026-09-07; owner visual verification remains pending.

- Shell gates its macOS inset with `isMac && ownsWindow`. Open folder now shares the existing
  icon-command style, localized tooltip and accessible name. Arco icon wrappers use flex centering
  and their SVGs use block layout. The now-unused text-command style was removed.
- Focused mount/Shell tests: 16/16 passed, including two new cases covering the compiled MenuBar
  template's host/platform combinations and the icon-only action's semantics/geometry rules.
- Shell `App.vue` ESLint, `App.less` formatting and scoped whitespace checks passed. Test lint
  retains an existing unused `explicitOpen` and pre-existing formatting warnings.
- `yarn electron-vite build` passed for main/preload/renderer in 44.53 seconds without changing
  runtime-profile, package, builder or installer configuration.
- No Electron/E2E, independent review, commit/sync or installed-app replacement was performed.
