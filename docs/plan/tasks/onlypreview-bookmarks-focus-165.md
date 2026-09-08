---
id: onlypreview-bookmarks-focus-165
scope: Project-scoped bookmarks and renderer-focus selection parity in BL/Cowork
status: done
depends-on: []
verify: Bookmark persistence/authority, renderer state and component compilation checks
---

# OnlyPreview bookmarks and focus

Selected Project rows retain the existing pale highlight when Shell loses focus to another
renderer/window. Shell focus deepens the blue without changing selection, preview or Recents.

A compact bookmark bar below the menu bar belongs to the active Project. File/directory row
context menus offer Add bookmark; the Project root cannot be bookmarked. File bookmarks preview
directly and promote Recents. Directory bookmarks reveal, select and expand the target and its
parents without replacing Project. A bookmark's native context menu removes the bookmark only.
Persist per canonical Project root across restart and tab/window moves; duplicates do not reorder.
Missing targets remain removable. Fence async reads/actions against Project changes.

Visual tokens reuse white #ffffff, rail #f9fafc, ink #25283a, divider #d9ddea and pale selection
#d6e4ff; focused selection uses #a9c9ff. Use the existing system typeface, 12px bookmarks,
left-aligned Tabler icons and one 30px-high horizontally scrolling row; no decorative cards.
Native preview bounds continue to follow the actual remaining preview host rectangle.

Verify code/unit/source contracts only. Ral owns live/E2E testing. No app launch, packaging,
release, independent review, branch change or Git sync. Cowork counterpart: mini-031.

## Delivery — 2026-09-08

Implemented in both apps. Small configuration records use the existing setting store, keyed by a
hash of the canonical Project root; no bookmark content reads, enumeration or indexing in Main.
Serialized CAS writes preserve concurrent additions; duplicate paths keep their position. Limit
configuration to 1,000 bookmarks per Project. Reads and writes reject obsolete workspace authority.
Missing targets are not checked on load, so they stay removable without startup disk scans.

The 30px bar uses native Remove bookmark and tree Add bookmark menus. File activation uses the
existing explicit selection/Recents path. Folder activation loads only the required parent/folder
listings and fences rapid clicks or Project changes. The existing preview-host ResizeObserver
keeps native PDF/Vue surfaces below the bar. Shell document focus drives emphasis without IPC,
polling, tree traversal, changing selection or index work.

Verification: BL 70/70, Cowork 88/88 across bookmarks, Recents, navigation, collapse, header menus,
macOS Open With and Cowork adapter/native labels. Eleven new bookmark/focus tests per app;
Vue SFC and Less compilation included. New-file lint and scoped diff checks pass.
BL Main + OnlyPreview surface typecheck reports 66 diagnostics outside the newly added code;
Cowork web typecheck reports existing preload include, unused pendingCharacterCount and tree
error-code diagnostics. Neither broad check is green; no unrelated repairs performed.

Human acceptance: in each app and both tab/window mounts, bookmark a file and nested folder;
collapse the tree, click the folder bookmark and check selected Current directory, expansion and
centering; click the file and check preview/Recents. Remove a bookmark without deleting its target.
Check root exclusion, duplicate add, A/B/A, restart and tab/window moves; deleted targets remain
removable. With a selected file, move focus among Shell, PDF/Vue, chat and another app: deep blue
only in Shell, pale otherwise. Native preview must not cover the bookmark bar.
