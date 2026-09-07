---
id: onlypreview-collapse-directories-146
scope: collapse all Project descendants with a vertical icon left of Locate
status: done
depends-on: []
verify: focused OnlyPreview tree/action/UI regressions, scoped lint/i18n, current-profile build
---

# Fold the Project tree to the root

## Objective

Owner request, 2026-09-07: add a vertical-collapse button immediately left of
`Locate current preview in project` in both Bitterless and Micromeet Cowork OnlyPreview.

## Contract

```text
Project                              [Fold vertically] [Locate]
v project-root
  > child-folder
  > another-folder
    root-file.md
```

- One compact icon-only action, using an available Tabler vertical-collapse glyph, immediately
  before the existing crosshair. Reuse its size, focus/hover treatment, localized title and
  accessible label. Stable name: `onlypreview__collapseDirectories`.
- Clicking keeps the synthetic root expanded and clears **all descendant expansion state**,
  including deep and currently hidden descendants. Reopening a first-level folder must not revive
  previously expanded grandchildren.
- Preserve current preview, selected file, selected/current directory anchor, loaded directory/index
  data and caches. Hidden multi-selected rows retain the tree's existing pruning behavior; do not
  introduce hidden actionable selections or change that policy. This is not preview navigation.
- Do not enumerate disk, dispatch IPC, reindex, reload the preview or load unopened directories.
  Use expansion state, not a traversal of the filesystem or complete file model.
- Late passive directory-list/watch responses may update cached data but must not reopen collapsed
  children. Explicit later Locate or a new user expand action continues to work.
- Any older unfinished Locate/search-reveal yields to the newer collapse action. Fence tree
  expansion/focus intent only; do not cancel index/loading work or alter workspace generations.
- Disabled with no workspace/index. Repeated clicks are harmless; a manually collapsed root is
  reopened to show its immediate children.
- Keep current layout and file naming; avoid new global abstractions, timers, dependencies,
  Main/preload changes, and unrelated source cleanup.

## Verification

- Actual state/action regression with nested expansions, repeated collapse, collapsed root, empty
  workspace, and preservation of preview/current directory/anchor/cache with existing multi-select pruning.
- Verify first-level visibility, descendants closed after subsequent re-expansion, and late listing
  behavior; Locate still reveals the current preview on an explicit later click.
- UI wiring confirms vertical icon, immediately-left order, disabled state and localized aria/title.
- Focused tests and scoped lint/translation/build checks. No Electron/E2E, independent review,
  install, release, Git sync or branch/profile switch. Ral owns live testing in both apps.

## Context and path

Source contract: `docs/features/onlypreview.md`, Project header and tree interaction.
Implementation: `src/renderer/onlypreview/shell/src/` App, expansion action/controller and existing
tree state, plus `common/onlyPreviewI18n.ts` and focused `tests/onlypreview/` cases.
Bitterless is the source; port the same small change into Cowork task `mini-017`, preserving each
host's existing adapters rather than overwriting the full vendor tree.

## Delivery — 2026-09-07

The Project header now has a 15px Tabler `IconFold` action immediately left of Locate, using the
existing 27px button style and bilingual title/aria label. A focused `OnlyPreviewTreeExpansionStore`
owns collapse, existing Locate/ancestor expansion and a tree-local intent revision. The old
asynchronous reveal paths respect the revision, while passive expansion of the collapsed selection
is suppressed until a later explicit action. No Main, preload, I/O, IPC or indexing changes.

Current preview, current directory/anchor and loaded listings remain intact. Hidden multi-selected
rows still follow existing pruning. Shell remains within its existing source budget at 785 lines.

Verification:

- `tests/onlypreview/onlyPreviewCollapseDirectories.test.mjs`: **10/10** new actual state/UI
  regressions passed; with affected existing regressions, **67/67** passed.

  ```sh
  node --test tests/onlypreview/onlyPreviewCollapseDirectories.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs tests/onlypreview/onlyPreviewTreeSelection.test.mjs tests/onlypreview/onlyPreviewAdapterSource.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs
  ```

- Scoped ESLint, `yarn check:renderer-i18n` and scoped `git diff --check` passed.
- `yarn typecheck:web` still reports 81 existing project errors; touched source has zero errors.
- Unchanged-profile `yarn electron-vite build` passed in **47.56 seconds**.
- Cowork's small canonical port also completed: **20/20** focused tests and a **31.92-second**
  direct build passed. Five shared Shell files match byte-for-byte; Cowork's language adaptation
  remains intact. See its `docs/plan/tasks/mini-017.md` for the three existing port type errors.

The two builds ran sequentially. No Electron/E2E, independent review, installation, release,
Git sync or branch/profile switch was performed. Code delivery is complete; Ral owns actual-window
acceptance. The existing BL Todo **验证 BL 与 Cowork 的 OnlyPreview 目录折叠按钮** holds the checklist.
