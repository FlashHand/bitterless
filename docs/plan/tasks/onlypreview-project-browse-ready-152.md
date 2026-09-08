---
id: onlypreview-project-browse-ready-152
scope: OnlyPreview empty preview follows root-listing readiness, not index completion
status: done
depends-on: []
verify: focused lifecycle and presentation regressions, targeted compilation and source parity
---

# Project browsing readiness

## Objective

Implement the 2026-09-08 contract in `docs/features/onlypreview-project-loading-state.md`:
once Project's root listing is loaded, show Select a file even if indexing is building/reconciling.
Only the pre-listing interval shows Loading project. Preserve actual index progress and selected
file previews. Port the shared fix to Cowork mini-022 after the canonical BL implementation.

## Context and path

Read the current loading-state feature and historical issues
`onlypreview-index-never-latches-ready.md` / `onlypreview-preview-stuck-loading-after-delete.md`.
Limit edits to the existing root listing → Main presentation → preview store boundary in
`src/main/onlypreview`, `src/main/xpc`, `src/shared/onlypreview`, `src/renderer/onlypreview`,
and focused `tests/onlypreview`. No change to index reuse, persistence, configuration or file I/O.

## Verification

Cover pending listing, populated/empty successful listing while index builds, later reconciliation,
listing failure, delayed preview renderer, Project switch and stale old-workspace replies. Retain
the selected-file/deletion behavior. Run focused unit/source/compile checks, no Electron launch,
E2E, independent review, Git sync or branch operation. Ral owns live testing.

## Delivery

Implemented independent `projectBrowseState` in the existing Main workspace-state service,
observed authenticated root-listing events in the helper, and forwarded the state through the
pullable preview presentation (empty presentation defaults to null). Empty/failed/stale workspace
cases are covered; the index state and existing selected-file retirement remain independent.
Loading copy now refers to the project folder rather than building the index. Ported to Cowork
mini-022, preserving its host/i18n adapters.

**57/57** focused regressions passed: browse6, index7, rendering10, region24, search integration6,
presentation4. The seven changed source boundaries compile via TypeScript transpilation with zero
diagnostics; scoped ESLint and diff checks pass. Cowork port **29/29** passes (browse6, collapse13,
recents7, density3), with source parity and targeted compilation. Transpilation is not a full
semantic typecheck. No full build/typecheck, Electron/E2E, independent review or Git operation.

Human check: in a fresh and a reused Project, before root rows arrive retain Loading project;
after they arrive and before indexing completes, show Select a file with only the bottom-left
index rail busy. Check an empty folder and A→B→A, then select/delete a file and confirm the correct
empty state. Use a version built from this change, not an older installed package.
