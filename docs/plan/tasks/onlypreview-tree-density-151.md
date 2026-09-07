---
id: onlypreview-tree-density-151
scope: Project tree 14px type, semibold root and uniform 22px rows
status: done
depends-on: []
verify: focused tree UI/source regressions, Vue/Less compilation and scoped diff checks
---

# Compact Project tree typography

## Objective

Ral requested a Medium Bold root, one-pixel larger file/directory names and uniform 22px
`onlypreview__treeRow` height. Apply to BL and Cowork; keep the current visual language.

## Context and layout

Canonical contract: `docs/design/onlypreview-global-search.md`, Project Root And Scope.
Keep system font, Royal Blue selection, excluded orange, indentation, icons, focus and gestures.

```text
Project | Recents
▾ project-root    14px / 600 / 22px row
  ▾ directory     14px / 500 / 22px row
    file.md       14px / 500 / 22px row
```

Only the synthetic root (`relativePath: ''`) gets the stronger weight. Base tree names increase
from 13px to 14px. Recents, Search result typography, toolbar/header button sizes and preview
document content are not in scope. No new state, runtime I/O, list scan or font dependency.

## Path and verification

- `src/renderer/onlypreview/shell/src/App.vue` and `App.less`; related focused tree/source tests.
- Port these narrow hunks to Cowork `mini-021`, preserving all concurrent edits and host adapters.
- Compile Vue/Less and assert root-only 600, shared 14px/22px rows and retained interaction/color
  invariants. Verify no existing virtual-row/scroll constants require a matching geometry change.
- No app launch, Electron/E2E, independent review, whole-project typecheck/build, Git or branch work.

## Delivery

Implemented and ported to Cowork. Root identity now adds only the semantic `--root` modifier;
shared tree rows are 14px/22px, the root is weight600, all other rows stay500. Arrow hit areas and
toolbar/header controls are untouched. Locate uses `scrollIntoView`, not a fixed row-height offset.

BL **29/29** and Cowork **23/23** focused tests pass, including three new real Vue-VNode/Less
compilation regressions for root-only emphasis, shared row metrics and preserved UI boundaries.
Both SFC/Less compilations, source/test byte parity and scoped diff checks pass. New tests/App.vue
lint passes; AdapterSource's existing unused `region` variable at line312 remains outside scope.
No full build/typecheck, app launch, E2E, independent review, Git or branch operation was performed.

Ral owns visual acceptance: open Project, compare root vs nested names and verify all rows are
equally compact, with centered icons and no clipped text. Preview MCP was offline at handoff, so
the existing OnlyPreview acceptance Todo could not be extended and the document was not auto-opened.
