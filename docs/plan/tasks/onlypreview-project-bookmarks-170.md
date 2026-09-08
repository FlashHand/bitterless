---
id: onlypreview-project-bookmarks-170
scope: Project-local fixed bookmarks and preload state SQLite
status: done
depends-on: []
verify: SQLite and renderer contract tests; touched TS, SFC and Less compilation
---

## Objective

Implement the owner-requested Project bookmark list and commit-driven persistence. Replace task
165's top bar and bookmark setting-store writes, preserving its focus and activation behavior.

## Context

- `docs/features/onlypreview-project-bookmarks.md`
- `docs/plan/tasks/onlypreview-bookmarks-focus-165.md` (historical implementation)

## Path

OnlyPreview bookmarks Shell component/store, API/types/handlers, trusted preload storage and
its registration/authority routing, existing bookmark tests and narrow integration tests.

## Verification

Follow the feature's code-level checks. No E2E, live app, review, branch change or Git sync.
Port to Cowork only after Bitterless code verification; parent owns documentation/handoff.

## Human acceptance

Code verified 2026-09-08: 20/20 bookmark/storage tests, actual private XPC/preload integration,
SFC/Less, touched TS transforms, six new core modules' targeted semantic TypeScript and scoped
lint pass. Live acceptance remains pending. Cowork port is tracked independently in mini-033.

In each app, test both browser-tab and standalone OnlyPreview mounts:

1. In Project A, add a file and nested folder via the tree menu, including while indexing.
   They appear above the root; scroll the tree and verify they stay visible. Recents hides them.
2. Click the file to preview and folder to locate/expand. Click the right-side removal button;
   only that bookmark disappears, the disk target and current preview are unchanged.
3. Switch A → B → A: B must not show A's bookmarks. Restart and verify A's bookmarks restore
   and removed bookmarks do not return. Confirm existing pre-upgrade bookmarks migrate.
4. Rapidly add/remove and switch Projects; no duplicates, lost confirmed writes or cross-Project
   display. Root remains non-bookmarkable; missing files remain removable.
