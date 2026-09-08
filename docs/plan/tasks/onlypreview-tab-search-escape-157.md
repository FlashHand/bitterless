---
id: onlypreview-tab-search-escape-157
scope: Escape closes global search in embedded OnlyPreview, including Cowork
status: done
depends-on: []
verify: focused native shortcut and search focus regression tests
---

# Embedded global search Escape

Ral reports that Escape does not close global search when OnlyPreview is inside a browser tab.
Trace the focused WebContents and host routing; repair the smallest boundary in BL and port any
same-source fix to Cowork. Escape must close only the active global-search surface, including when
its input/results/preview owns focus, without closing the tab, changing the Project, or stealing
unrelated shortcuts. Preserve standalone behavior and existing transparent outside-click close.

Root cause confirmed in both copies: renderer handleEscape intentionally clears non-empty input
before dismissing on a second Escape, and its capture handler only receives DOM events inside
the search workspace. Body/blank-surface/Office iframe focus can bypass it. Main has native Escape
routing for find-in-file but none for active global search. The corrected contract is **one bare
Escape closes global search even when the query is non-empty**. Prefer current-host active-search
routing at the native input boundary, preserve alert-modal priority, and keep renderer dismissal
as a consistent fallback. Restore focus to the search opener; do not close the browser tab.

Record the observed code cause and focused test evidence here after implementation. No app/E2E,
independent review, full build, release/install, Git sync or branch changes. Preserve concurrent
background-index, agent-preview, Maestro and Cowork changes.

## Delivery

Both copies now route the current host's bare Escape in OnlyPreviewWindowHelper before Find;
active alert handling is not intercepted. GlobalSearchWindow closes via the existing view/focus
restoration path. Renderer handleEscape dismisses immediately, and the Workspace fallback rejects
modified/repeated keys. No tab close, Project rebind or index mutation.

BL focused regression49/49; Cowork21/21. Each includes6 new integration tests executing native
dispatch → search service/view → opener focus without relying on a DOM key event. Cover current
host, hidden search, alert priority, Find fallback, repeat/modifiers and invalid opener. SFC
compilation and6 TS transforms pass (not a full semantic typecheck), scoped BL lint and narrow
cross-project parity checks pass. An expanded run still encounters the existing GlobalSearchUi
line140 assertion for `succeeded` versus HEAD's `accepted`; this unrelated old guard was preserved.

Human check: in each app's OnlyPreview tab, open search over a PDF, enter text, click input,
results, blank search area and an Office preview in turn, and press one Escape each time. Search
must close while tab/Project remain unchanged and focus returns to the opener. Check standalone
mode and alert-modal priority too. No application/E2E, build, install/release or Git operation run.
