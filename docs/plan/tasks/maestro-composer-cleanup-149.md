---
id: maestro-composer-cleanup-149
scope: BL-only full workspace label without refresh and no synthetic chat greeting
status: done
depends-on: []
verify: focused composer/workspace/message initialization regressions, SFC/Less compilation and scoped checks
---

# BL composer workspace and empty-chat cleanup

## Objective

Ral, 2026-09-07: **Bitterless only**, not Cowork. In `maestro__composer__workspace`, remove the
Refresh button and display the complete workspace name. Also remove the preset chat greeting
`Hi — how can I help you today?`.

## UI contract

```text
Composer tools: [Attach] [Folder  full-workspace-name  | Switch | Clear]
Long name:      [Folder  full-workspace-name-that-    | Switch | Clear]
                        wraps-without-ellipsis
New chat:      empty message list + existing composer (no synthetic greeting)
```

- Remove only the workspace Refresh icon/button and its now-unused local handler/import. Keep
  underlying store/API refresh behavior used elsewhere; do not refactor the workspace service.
- `workspaceLabel` remains the full workspace **name**, not the full absolute path. Remove fixed
  220px/140px name-chip caps and ellipsis/nowrap clipping; use available width and wrap long names,
  including a long unbroken name. Fit within the composer, keep controls accessible and vertically
  aligned; allow content-driven height. Full path remains available via the current tooltip.
- Preserve the existing workspace-click → OnlyPreview route, separate Switch and Clear actions,
  empty-state Set workspace, busy/archive disabling and the stable name attribute. Those routes
  already contain another agent's changes; do not revert or redesign them.
- Keep the existing system font, neutral white surface, `#e2e4eb` border, `#4e5882` folder/icon
  accent, `#323955` text and `#f3f5fc` hover treatment. No new colors, fonts, animation or labels.
  Compact natural sizing for short names; local responsive wrapping for long names.
- New sessions and recovered empty sessions must not inject the synthetic greeting. Preserve real
  messages, persisted conversations, recovered active turns, send behavior, and empty-draft cleanup.
  Remove obsolete welcome-only code only where made unused by this change; no database rewriting
  or deletion of real messages that happen to contain the same sentence.

## Context and path

Canonical feature: `docs/features/maestro.md`. Touch only needed areas of
`src/renderer/maestro/control/src/ChatPanel.vue`, `ChatPanel.less`, message store/types if necessary,
and targeted `scripts/maestro/` or unit tests. No Cowork edits or port, Main/preload/indexing changes,
dependencies, configuration/profile edits, Git sync/branch switches, installation or release.

## Verification

Run compiled Vue/Less checks and focused runtime/source regressions: Refresh absent, full label
without truncation at default and narrow layouts, remaining workspace controls/disable/click wiring
unchanged, and new/recovered chat initialization without fake messages while real turns survive.
Update the obsolete workspace guard requiring Refresh rather than leaving it contradictory.
No independent review, Electron/E2E/app launch or new full-project lint/typecheck expansion.
Ral owns visual testing in the real app.

## Delivery

Completed 2026-09-07, **Bitterless only**. `ChatPanel.vue` removes the Refresh icon and unused
local handler/import, retaining OnlyPreview, Switch, Clear and disabling guards. `ChatPanel.less`
removes fixed chip width/height and ellipsis, permits long unbroken names to wrap, and keeps action
button dimensions stable. The frontend-design skill guided reuse of existing colors/type and
responsive sizing rather than a visual redesign.

`message.store.ts` no longer injects welcome messages for new or recovered sessions;
`message.type.ts` drops the unused welcome field. Nonempty-session detection now checks for real
messages rather than assuming a two-message minimum (welcome + one real message), so a single
real message survives empty-draft cleanup. Legacy welcome-ID compatibility filtering remains;
no persisted data or real text-matching messages were deleted.

Verification:

```sh
node --test --test-concurrency=1 tests/maestro/maestroComposerWorkspaceUi.test.mjs tests/maestro/maestroComposerCleanup.test.mjs
node scripts/maestro/check-chat-composer.mjs
```

- **12/12 passed**: seven actual MessageStore regressions and five UI/compiled Vue/TS/Less/scoped
  workspace-guard checks. The chat-composer guard also passed.
- Scoped TS/Vue lint, `.mjs` lint and `git diff --check` passed. Pure `.mjs` lint disables only
  the inapplicable TS return-type-annotation rule at the command line, not in configuration.
- The full `check-workspace-files.mjs` remains blocked at the untouched line-113 assertion
  `agent should expose read_file`. This task's updated workspace section was executed separately
  and passed; the unrelated assertion/source was not changed.
- No Cowork/Main/preload/indexing/dependency changes, build, full-project typecheck, Electron/E2E,
  independent review, installation, release, Git sync or branch/profile switch.

Human visual acceptance: shrink the BL chat panel with a long workspace name and check that it is
fully visible and actions remain accessible; click the name/Switch/Clear, then create a new chat
and confirm no preset greeting. The `BLOnly` Todo **验收 BL workspace 控件与空白聊天**
(ID `00355284121913696333`) records this handoff; actual-window behavior has not been claimed tested.
