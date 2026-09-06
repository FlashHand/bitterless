---
id: onlypreview-directory-preview-target-127
scope: let a directory reach the preview pane and render its name, path, and child entries
status: in-progress — contract landed, producer and rendering pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewDirectoryTarget.test.mjs && yarn typecheck:node && yarn check:renderer-i18n && git diff --check
---

# Preview a directory

## Objective

Selecting a directory — from the tree or from Global Search — shows that directory in the preview
pane instead of doing nothing.

## Context

- `docs/features/onlypreview-browse-history.md`
- `src/main/xpc/onlyPreview.handler.ts:261-295` (`selectStandaloneFile` and its file guard)
- `src/main/xpc/onlyPreviewSearchRuntime.handler.ts:141-150` (`browseDirectory`, the listing source)
- `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/DirectorySearchPreview.vue`

## Contract

- Add a directory selection path beside `selectStandaloneFile`. **Do not** loosen its
  `PATH_NOT_REGULAR_FILE` guard: everything downstream of a file selection — read broker, asset
  grants, Office sessions, Find — assumes a regular file.
- A directory presentation carries no `fileRef` authority: no broker grant, no asset URL, no Find
  coverage, no `selectedTextAvailable`.
- Enumerate through the existing `browseDirectory`, not the Global Search directory preview: that
  one needs a `resultToken` minted by a search result, which a tree row does not have. Do not add a
  third way to enumerate a directory.
- The preview pane renders name, full relative path, the child entries, and a total count. The
  toolbar shows the directory name in place of a file name and hides the type badge and file
  actions.
- Selecting a directory must not change what Locate or the MCP `preview.open` contract consider the
  previewed file.
- Both languages get every new string; no hardcoded user-facing text.
- Bounded like every other listing: a directory with very many children is truncated with the total
  still reported.

## Verification

- Main refuses a directory through the file path and accepts it through the directory path.
- A directory presentation issues no broker grant and no asset URL.
- The preview renders name, path, entries, and count; an empty directory renders its empty state.
- Selecting a directory then a file leaves the file authority intact.
- `yarn check:renderer-i18n` passes.
- Do not run Electron, Playwright, or packaging.

## Progress

**Landed — the contract, additively and inertly.**

- `OnlyPreviewPreviewAdapterId` gained `'directory'`; the presentation gained
  `directory: OnlyPreviewDirectoryTarget | null`, with `OnlyPreviewDirectoryTarget` /
  `OnlyPreviewDirectoryTargetEntry` beside it. The entry reuses the existing `OnlyPreviewNodeKind`.
- All three fresh presentation literals in `onlyPreviewPreviewRegion.service.ts` and the empty
  presentation in `onlyPreviewPreviewAdapter.service.ts` set `directory: null`; the three
  spread-based transitions inherit it.
- `projectOnlyPreviewPresentation()` deep-copies it, `entries` included, for the same reason it
  already copies `fileRef`, `descriptor` and `error`.

Nothing produces or consumes a directory target yet, so behaviour is unchanged: 43/43 across the
rendering-adapter, search-window, index-state and tree-selection suites, and `git diff --check` clean
on every file this task touched.

**Pending.**

1. Main producer: a directory selection path beside `selectStandaloneFile`, enumerating through
   `fileSearchRuntimeRelayService.call(hostToken, 'browseDirectory', …)` — the relay already knows
   that method (`fileSearchRuntimeRelay.service.ts:382`) and it needs no result token.
2. Preview renderer: a `directory` branch in the preview store and a component rendering name, path,
   entries and count, following `DirectorySearchPreview.vue`.
3. Shell: activating a directory row selects it for preview; the toolbar shows the directory name and
   hides the type badge and file actions.
4. Both languages, and the tests listed above.

## Note on verification in this repo

`yarn typecheck:node` runs `tsc --noEmit --noCheck`, so it is a **parse** check, not a type check —
it cannot catch a missing required field. A real `tsc --noEmit` over `tsconfig.node.json` exhausts
the V8 heap, which is presumably why `--noCheck` is pinned. Construction sites for a new required
presentation field therefore have to be found by hand; they were, by grepping the one field every
literal carries.
