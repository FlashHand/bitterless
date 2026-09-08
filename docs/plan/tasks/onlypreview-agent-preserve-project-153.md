---
id: onlypreview-agent-preserve-project-153
scope: agent/MCP file preview preserves active Project and tree selection
status: done
depends-on: []
verify: focused explicit-open, MCP wiring and Shell selection regressions
---

# Agent preview must not steal Project selection

## Objective and context

Ral 2026-09-08: preview calls by an agent must not cancel the selected workspace, in BL and
Cowork. Follow `docs/features/onlypreview-browse-history.md` State and persistence clarification.
For agent file calls, preserve Project root/authority/index, selected tree row/current directory,
expanded paths and loaded listings. Still preview the requested file and promote the active
Project's Recents. Internal files keep Project authority; external files remain single-file and
unindexed. Explicit directory opens retain Project-switch semantics, as do normal user selection
gestures. Locate remains the opt-in tree reveal action.

## Root cause and path

Task150 preserved Main's Project for external targets, but explicit file completion still emits
SELECTION_CHANGED for every file. Shell `syncSelection` then overwrites its independent selected
directory/focus with Main's prior `selectedRelativePath`, or null. Inside-project file calls also
replace that selection directly. This is a selection side effect, not new external indexing.

Limit changes to the MCP opener wiring, explicit-file open policy, necessary Shell synchronization
and focused tests. Use the existing presentation/Recents notifications where possible. No extra
file I/O, new process, automatic Locate, index rebuild, broad source refactor or public MCP schema
change. Preserve concurrent task152 and Find changes. Port shared changes to Cowork mini-023;
its existing internal `preview_file` adapter is the corresponding agent entry, not a new MCP host.

Implementation choice: Main-only `preserveTreeSelection` option for agent callers, default false
for existing user/OS entry points. It suppresses only the final SELECTION_CHANGED event; Main's
current-file selection and ordinary preview/Recents publication remain correct. Shell keeps its
browse selection on presentation updates. Explicit Locate uses the same-Project live preview
reference, not the last browse selection or an already-loaded-entry requirement.

## Verification

Cover inside/external file calls while a different directory is selected, repeat calls and cold
open, Recents promotion/isolation, pending Project switch/stale reply, explicit directory behavior,
and normal user selection/Locate. Assert the agent entry actually chooses preservation, not only
helper behavior. Focused Node tests, targeted compile/lint only; no full heap-heavy typecheck,
Electron launch, E2E, independent review, Git sync, install or release. Ral owns live verification.

## Delivery and verification

Implemented MCP-only preservation in app.main and ExplicitOpen's FIFO context, plus Shell/App's
explicit Locate target. The three shared source hunks were ported to Cowork; its agent adapter and
tool caller opt in separately, keeping workspace-chip and ordinary user behavior unchanged.

BL **48/48**: RecentNavigation, CollapseDirectories, AppWiring, RecentsRenderer; Cowork shared
**31/31**: RecentNavigation and CollapseDirectories. New tests execute inside/external/repeated/
unbound opens, Recents, per-request queue-option isolation, late A→B replies, background snapshot
preservation and unloaded-target Locate. Both App SFCs compile; seven TS transforms pass (not a
semantic full typecheck). Five BL source/test files pass scoped lint; Cowork's three source files
pass with BL rules, retaining existing formatting warnings.

Existing checks remain non-green: including app.main reports its pre-existing18 no-empty errors;
an extra four-file regression run was43/44 because GlobalSearchUi line140 still expects
`if (succeeded)` while HEAD source already uses `if (accepted)`. That test and its source were not
changed this turn. No independent review, full build/typecheck, application/E2E or Git operation.

Human check: select and expand a Project directory, then call the agent preview on internal and
external files repeatedly. Current directory, tree highlight and expansions must stay unchanged;
Recents must promote the opened file in that Project only. Click Locate on an internal file to
explicitly reveal it; an external file must not replace the Project or enter indexing.
