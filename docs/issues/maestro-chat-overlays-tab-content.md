# Maestro Chat reappears over tab content and cannot close

Status: implemented; real-window verification pending with Ral

## Root cause

When the Shell restores a closed Chat sidebar, it reports full-width operation bounds and a
zero-width Control rectangle. Creating the deferred Workbench calls the controller's `layout()`
again, which overwrites native bounds with the first-frame 480px sidebar layout. Window resize can
take the same path. The Shell still considers Chat closed, so its close action makes no state
change. New tabs use the remembered full-width operation rectangle and sit underneath Control.

The direct `layout()` setters also bypass the bounds applier's cache. A repeated zero-width
rectangle can consequently be suppressed while the native view is actually 480px wide. This
sequence was reproduced with methods extracted from the installed Preview build `260904172934`
using Node stubs, without launching Electron.

## Required behavior

The renderer's measured operation/Control rectangles remain authoritative after the first report.
Deferred view creation and window resize must never restore an independently assumed open sidebar.
Control must be natively hidden when its reported drawable bounds are empty, and visible again
when Chat opens. All native bounds updates must share coherent redundant-update handling.

```text
Chat closed                         Chat open
+------------------------------+    +------------------------------+
| Tabs and address bar         |    | Tabs and address bar         |
+------------------------------+    +-------------------+----------+
| Active tab: full width       |    | Active tab        | Chat     |
| Control view hidden          |    |                   | 480px    |
+------------------------------+    +-------------------+----------+
```

The latest measured bounds must apply to late-created Workbench views and new/activated browser
or composite Mini App tabs. Window teardown clears geometry for the next window. Keep existing
Chat content, preferences, close/toggle controls, XPC contracts, and composite tab mount ownership.

## Verification

Implemented on 2026-09-07: the controller retains both measured rectangles, view services use a
shared bounds path that checks actual native geometry, and Control starts hidden and follows
non-empty drawable bounds. Window reset clears both remembered rectangles. Existing composite
tab refresh and mount ownership are preserved.

- Maestro Node regression tests: 59/59 passed, including 16 new tests for deferred creation,
  browser and composite tabs, resize, close/reopen, reset, visibility and native bounds correction.
- `yarn electron-vite build`: passed for main, preload and renderer in the current profile;
  no profile-switching build wrapper was run.
- Targeted ESLint: four service/helper files and two new tests passed. The controller remains
  blocked by its pre-existing unused `AgentConversationContext` import.
- `yarn typecheck:node`: passed, but this script uses `--noCheck`, so this is not full semantic
  type validation. `typecheck:web` remains blocked by existing errors in unchanged renderer modules.
- `yarn check:maestro`: blocked by 29 existing alias-rule violations in unchanged modules.

No Electron app, E2E or independent review was run. The installed application was not replaced.
Ral should test a build containing this fix: close Chat, quit/reopen, switch webpage and Mini App
tabs, then toggle Chat and resize/maximize. Closed Chat must stay hidden; open Chat must sit beside,
not over, tab content.

Task: [Maestro Chat layout 143](../plan/tasks/maestro-chat-layout-143.md).
