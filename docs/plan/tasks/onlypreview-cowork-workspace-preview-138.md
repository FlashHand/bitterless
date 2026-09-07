---
id: onlypreview-cowork-workspace-preview-138
scope: clicking the workspace path in the Cowork Control panel opens OnlyPreview on that workspace directory
status: in-progress
depends-on: [onlypreview-cowork-tab-mount-135]
verify: focused workspace-preview tests, scoped lint/typechecks, renderer i18n, current-profile electron-vite build, scoped diff check
---

# Preview the Cowork workspace

## Objective

Owner request, 2026-09-05: 「点击 control 下的 workspace 目录要能打开对这个 workspace 的预览」 — the
workspace path shown in the Control chat panel is a directory, and clicking it should open
OnlyPreview on that directory.

This is the use case the embeddable mount exists for: Cowork's agent works against a workspace
directory, and OnlyPreview is the app that can show what is in it.

Latest report, 2026-09-07, explicitly targets **Bitterless**: clicking the workspace name in the
Maestro composer must open OnlyPreview. The separate micromeet-cowork application is not in scope.
The current Bitterless name button still calls `chooseWorkspace`; task 142 connected the agent
tool only. A leftover `coach.handler.openWorkspaceInPreview` points at an absent controller method
and has neither a shared API contract nor a renderer caller.

During this delivery another writer changed these files after the initial inspection: the API,
controller, composer and composite `openTarget` route now exist, marked `mini-016`. Ral confirmed
「有，workspace 交给另一个 agent」 on 2026-09-07. This session makes no code changes to that chain
and does not claim its verification; its implementation remains owned by the other agent. Only
the independent address-state fix in task 145 continues here. The paragraph above records the
initial snapshot, not the updated file state.

## Context

- `src/renderer/maestro/control/src/ChatPanel.vue:615-650` — the workspace chip: a text `Button`
  showing `workspaceLabel` (currently `chooseWorkspace`), plus Refresh and Clear `IconBtn`s. The
  empty state at :610 offers "Set workspace" and must keep doing so.
- `src/main/maestro/windows/main/workspaceFile.service.ts` — `getWorkspaceDirectory`,
  `setWorkspaceDirectory`, and `toolOpenWorkspaceFolder`, which is the agent-facing equivalent.
- `src/main/onlypreview/onlyPreviewExplicitOpen.service.ts` and
  `onlyPreviewExplicitTarget.registry.ts` — the existing route that opens one explicit absolute
  target, already used by the OS file-open queue and the MCP preview bridge.
- `docs/plan/tasks/onlypreview-directory-preview-target-127.md` — a directory is already a
  previewable target, so this needs no new target kind.

## Contract

- Clicking the workspace **path** opens the preview; the existing Switch/Refresh/Clear actions all
  stay reachable. Switching moves to its own `IconBtn` in the same chip rather than being displaced:
  a path reads as something to open, but nothing may become unreachable to satisfy that.
- The open goes through the existing explicit-open route with the workspace's absolute path. No new
  target kind, no second open path, and the same containment and authorization the route already
  applies.
- Opened from Bitterless's Maestro, it reuses the current OnlyPreview surface. If none is live,
  prefer the existing browser's registered OnlyPreview tab. A live standalone window is focused
  rather than creating an empty tab or relocating it. Do not implement tasks 136/137/140's planned
  automatic ownership/placeholder/remembered-host policies in this fix.
- A workspace that has since been deleted or is no longer a directory fails the way the explicit
  route already fails, with no partially-opened tab left behind.
- Use the current Bitterless Control's Arco/Button/IconBtn, Royal Blue/BEM styles and its existing
  localized `maestroControl` namespace. Preserve the name/path tooltip, truncation, keyboard access,
  current disabled conditions, and the empty-state Set workspace behavior.
- Prevent duplicate in-flight opens and show failures through the existing visible error path. Do
  not silently substitute Finder when the registered OnlyPreview opener fails.
- Keep host integration in the existing `previewOpener` registration: Maestro must not import
  OnlyPreview internals. Reuse explicit-target authorization/FIFO rather than a second file-open
  pipeline, and do not add heavy Main filesystem I/O.

## Path and interaction

```text
Composer: [Attach] [workspace name → preview] [Switch] [Refresh] [Clear]
No workspace:     [Set workspace → picker]

Name click → renderer action → typed coach API → Main workspace service
           → registered host preview opener → existing explicit-target authorization/open
```

Code touches are limited to the composer/action, coach contract/handler/controller delegation,
workspace service, existing host opener glue, localized action labels, and focused tests. Keep
existing dirty changes and current branch; no install, release, sync, independent review or E2E.

## Verification

- The click routes the workspace's absolute path through the explicit-open service exactly once.
- Switch, Refresh and Clear remain present and enabled under the same conditions as today.
- The empty state still offers "Set workspace" and never attempts a preview.
- A missing or non-directory workspace surfaces the route's own failure.
- Verify the actual UI-to-API and service-to-host boundary, not only the agent tool. Cover existing
  standalone/tab, cold open, duplicate click and visible failure without launching Electron.
- Ral owns live testing: click the workspace name and confirm the same directory opens in
  OnlyPreview; separately check Switch/Refresh/Clear and an absent/deleted directory.
