---
id: onlypreview-project-delete-shortcut-166
scope: macOS Project Cmd+Delete confirmation in BL/Cowork
status: done
depends-on: []
verify: Shortcut guards, IPC selection validation and existing delete dialog unit tests
---

# Project Cmd+Delete

With OnlyPreview Shell focused and Project active, Cmd+Delete (macOS Backspace) requests the
existing delete confirmation for the current tree selection. Never invoke a disk removal directly.
Preserve existing multi-selection/collapse, root protection, cancellation and two-phase preload
delete authorization. Do not act in Recents, editable controls, rename, other renderers or inactive
windows. Ignore repeat and suppress concurrent shortcut dialogs. Errors cannot leak across Project
changes. Mirror in Cowork mini-032. No Electron/E2E, real deletion, build, release or Git sync.

## Delivery — 2026-09-08

Implemented a Shell-only key guard and requestProjectDelete IPC in both apps. Cmd+Backspace and
Cmd+Delete both request the existing confirmation. Inputs/contenteditable, rename, Recents and
unfocused Shell do not dispatch; repeats/pending requests stop before reading the tree selection.
Main validates Project capability and collapsed selection, then reuses the existing confirmation,
preload prepare/commit/cancel authority and deleted-row notifications. No direct shortcut deletion.

Verification: seven new behavioral tests per app pass, including real dialog orchestration with
stubbed removal (no syscall), Cancel, confirmation, multi-selection, stale Project, root/invalid
requests, repeats and SFC compilation. BL existing delete-dialog/progress tests 31/31 pass.
Additional BL tree-selection regression 19/20: the pre-existing Shell store is 868 lines against
an 800-line limit; this turn does not change that store or the limit. Scoped lint/diff checks pass.
No app launch, E2E, real file deletion, full typecheck, build, release or Git sync.

Owner test: in BL and Cowork tab/standalone, select a disposable Project file and press Cmd+Delete.
Verify the existing confirmation opens once, Cancel leaves the file untouched, and a deliberate
Confirm deletes only the named selection. Inputs/rename, Recents, root selection, PDF/chat focus
and another active app must not trigger a Project delete.
