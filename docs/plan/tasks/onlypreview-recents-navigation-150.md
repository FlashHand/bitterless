---
id: onlypreview-recents-navigation-150
scope: external preview without Project mutation, persisted 100-file Recents, toolbar navigation/reload and local Markdown links
status: done
depends-on: []
verify: scoped authority/history/renderer/link regressions, i18n, typecheck and serialized direct builds; human owns Electron testing
---

# OnlyPreview external files and Recents navigation

## Objective and context

Implement Ral's 2026-09-07 goal in BL and Cowork. Canonical acceptance contract:
`docs/features/onlypreview-browse-history.md`, **Current delivery** section. That section replaces
the old file History/separate browser stack decisions of pending tasks 128/129, not task 127's
separate directory-preview implementation. Preserve all earlier fixes and other agents' dirty work.

## Path and integration

1. Backend/shared/preload: scoped Recents DTO/API and settings persistence; record committed opens
   at explicit open / Project file selection boundaries, not generic presentation calls; preserve
   external single-file capability and live external restore; source-verified Markdown resolution.
2. Renderer: a small Recents controller/component outside the existing near-800-line Shell store;
   Project/Recents tabs, PreviewToolbar actions, localized labels and source-bound Markdown clicks.
3. Integration: same-host explicit-file FIFO and generation checks connect agent, tree/search open,
   link, Recents activation and navigation; reloading does not invoke Project refresh/indexing.
4. Port only canonical hunks to Cowork task `mini-020`, preserving host adapters and language imports.
   Do not port unrelated BL-only Maestro task 149 or overwrite vendored trees wholesale.

Root owns docs and two private-workspace test Markdown files; workers own explicitly assigned code
modules/tests. Align shared DTOs before parallel backend/renderer production within this one task.
No independent review agent, Git sync, branch/profile changes, install/release or Electron/E2E.
Use direct unchanged-profile `yarn electron-vite build` serially if verifying both Electron builds;
never invoke profile-switching build wrappers.

## Verification

- External file open/reload/navigation preserves Project root/current directory/tree state and
  does not bind an external parent index; inside/unsettled classification and restore remain safe.
- MRU dedup/cap100/persistence/isolation, private-path DTO authority, stale and missing entries,
  explicit promotion once, Back/Forward/cursor boundaries and Reload order preservation.
- Actual API/store integration covers agent/explicit open, tree single/double click, committed
  search open vs inline search preview, same-path repeat, stale async completion and host revoke.
- SFC/Less/i18n and focused renderer state tests cover tab/scroll/selection preservation, rows,
  toolbar placement/disabled state, preview reload without Project-index refresh.
- Markdown links: source-relative/sibling/absolute/fileURL, spaces/Unicode, anchor and stale-source
  behavior, dangerous schemes/remote file host rejection, no sibling capability bypass or Main
  content I/O. Do not add active href behavior to search snippets without source authority.
- Add two mutually linked Markdown fixtures, one inside a small test workspace and one sibling
  outside it. Give Ral exact steps to open that fixture workspace (not the broad overmind root)
  so the external-file assertion is meaningful. No app-driven E2E or live smoke verification.

## Delivery

Implemented in BL and ported to Cowork mini-020. Ral retains live visual/Electron acceptance.

- Main: bounded per-Project settings-backed MRU; opaque snapshot IDs/revisions; shared serialized
  explicit/recent/navigation/link opens; preview-only reload; external Project-state preservation
  and restore guard. A-to-B changes during pending file inspection cannot leak a record/preview.
- Renderer: dedicated Recents controller, Project/Recents panels retaining the Project tree DOM,
  existing IconBtn toolbar controls, localized rows/states, sanitized source-authorized Markdown
  links and decoded fragments. Shell store remains below its existing 800-line boundary.
- Cowork preserves its MCP, settings readiness, language and IconBtn adapters. No external parent
  directory is indexed; no new Main file-content I/O or dependency installation was introduced.

### Initial delivery verification, 2026-09-07

- BL backend: **105/105**, serial Node tests for Recents, actual navigation, host toggle,
  explicit FIFO, recent-directory persistence, workspace, selection coordinator, PreviewRegion,
  presentation contract and App wiring. Includes two delayed A-to-B inspection cases.
- BL renderer: **64/64**, Recents/Markdown/rendering/tree/collapse/search-shell/adapter tests.
  Six SFCs and three Less files compile; renderer i18n check passes. Private fixture check:
  eight reciprocal links/anchors resolve and the outside-only sentinel is absent from Project A.
- Cowork: **34/34** backend/storage tests, **29/29** existing config/exclusion/collapse regressions,
  **32/32** renderer tests. Core/renderer parity checked with only explicit Cowork adapters.
- Direct unchanged-profile `yarn electron-vite build` succeeds in both projects, run serially:
  BL final build 28.59s; Cowork 32.10s.
- Type checks are **not globally green**: BL actual Main `tsc` hit its default 4GB heap limit
  without diagnostics; heap was not raised. BL web has 81 existing errors, none in this task's
  renderer files. Cowork node retains existing vendored errors; web retains three existing errors
  (Shell unused field, TreeSelection error type, Find directory mapping). No new task errors found.
  BL's normal Main script includes `--noCheck`; its pass is only transpilation evidence.
- Scoped diff checks pass. Backend lint excluding app.main has no errors and 37 formatting
  warnings; app.main retains 18 existing empty-cleanup-catch errors outside these changes.
  Scoped renderer lint is clean. Unrelated errors were not expanded into this task.

No Electron/E2E, independent review, installation, release, Git sync or branch/profile change.
For manual acceptance, open the private workspace's `tmp/onlypreview-recents-link-test/project-a`
as the Project, then `inside.md`; its sibling `outside/outside.md` provides the reciprocal external
links and search-exclusion sentinel. Check per-Project persistence/isolation, navigation order,
reload, Project tree preservation and Markdown anchors in both hosts using the new code.

### Follow-up: stable Recents activation, 2026-09-07

Implemented in both hosts. Ral approved treating Recents double-click/Enter as history navigation:
open the selected file and update the active cursor without reordering or rewriting MRU. Promotion
from Project/search/Markdown/agent opens remains unchanged. Only the `openRecent` promotion flag
and corresponding actual navigation regression changed; no renderer or API contract change.

BL and Cowork each pass **21/21** Recents/navigation tests. The regression first failed against the
old promotion behavior, then verifies middle/oldest/newest entry order and persistence write count
stay unchanged while active entry and Back/Forward boundaries update correctly. Existing explicit,
tree and Markdown promotion tests remain green. Both source/test pairs match; scoped lint is clean.
No new build, whole-project type check, E2E, independent review or Git operation was run for this
narrow follow-up. Manual check: double-click/Enter a non-first Recents row; it opens in place.
