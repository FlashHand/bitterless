---
id: onlypreview-cowork-workspace-preview-138
scope: clicking the workspace path in the Cowork Control panel opens OnlyPreview on that workspace directory
status: pending
depends-on: [onlypreview-cowork-tab-mount-135]
verify: node --test tests/onlypreview/onlyPreviewCoworkWorkspacePreview.test.mjs && yarn typecheck:web && yarn check:maestro && git diff --check
---

# Preview the Cowork workspace

## Objective

Owner request, 2026-09-05: 「点击 control 下的 workspace 目录要能打开对这个 workspace 的预览」 — the
workspace path shown in the Control chat panel is a directory, and clicking it should open
OnlyPreview on that directory.

This is the use case the embeddable mount exists for: Cowork's agent works against a workspace
directory, and OnlyPreview is the app that can show what is in it.

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
- Opened from inside Cowork, it lands in the Cowork OnlyPreview tab, per the ownership rule in
  `docs/features/onlypreview-embeddable-mount.md`: if a standalone window currently owns the single
  live surface, the tab stays `deferred` and the owner is pointed at the window instead.
- A workspace that has since been deleted or is no longer a directory fails the way the explicit
  route already fails, with no partially-opened tab left behind.
- Control is a Cowork-origin surface with hardcoded English strings and Tailwind utilities; match it
  (plus a BEM class per the workspace conventions), and do not add it to the renderer-i18n
  inventory, which does not cover Maestro Control.

## Verification

- The click routes the workspace's absolute path through the explicit-open service exactly once.
- Switch, Refresh and Clear remain present and enabled under the same conditions as today.
- The empty state still offers "Set workspace" and never attempts a preview.
- A missing or non-directory workspace surfaces the route's own failure.
