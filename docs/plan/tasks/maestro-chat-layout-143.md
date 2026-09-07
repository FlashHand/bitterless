---
id: maestro-chat-layout-143
scope: Maestro native Chat visibility and tab geometry
status: done
depends-on: []
verify: Node regression tests, targeted lint, Maestro checks, build; owner tests Electron
---

# Keep Maestro Chat visibility consistent with tab layout

## Objective

Fix the diagnosed startup/resize path that revives a closed Chat view over tab content and makes
its close button ineffective. Implement the bounded fix and proportionate code verification, then
hand off to Ral for human testing without an independent review phase.

## Context

- `docs/issues/maestro-chat-overlays-tab-content.md`
- `docs/features/maestro-window-ioc.md`
- `docs/features/maestro.md`

## Path

- `src/main/maestro/windows/main/maestroWindow.controller.ts`
- `src/main/maestro/windows/main/maestro{Browser,Control,Workbench}View.service.ts`
- `src/main/maestro/windows/main/viewBounds.ts`
- `tests/maestro/` focused native-layout regression tests and directly affected guards
- This task, its issue, feature contract and documentation indexes

## Contract

- First-frame fallback geometry applies only before the Shell has reported authoritative bounds.
- Preserve the measured operation/Control pair through deferred Workbench creation and resize;
  subsequent renderer measurements update both surfaces together.
- Native Control visibility follows its non-empty reported bounds; closed means natively hidden.
- Route geometry writes coherently so cached bounds cannot suppress a required native update.
- Preserve composite-tab refresh calls and all unrelated current-worktree work.
- Clear retained geometry when the window is reset; do not change persisted configuration.

## Verification

- Reproduce the previous 480px overlap in a pure Node regression, then prove it is fixed.
- Cover closed and open startup, deferred view creation, browser-tab activation, repeated geometry,
  resize and close/reopen, and window geometry reset.
- Run focused tests, targeted ESLint, `yarn check:maestro`, available TypeScript verification and
  `yarn electron-vite build` in the current environment; report exact pre-existing failures or
  verification limitations. The normal `yarn build` wrapper switches Rig's environment and
  rewrites generated profile files, so use the underlying build without changing that configuration.
- Do not launch Electron, run E2E, or start an independent review.

## Human test

Close Chat, quit and reopen Bitterless, then open/switch a webpage tab and a Mini App tab. Confirm
their full right-hand content is visible. Toggle Chat repeatedly and resize/maximize the window:
Chat must close reliably and take space alongside tab content only while open.

## Delivery result

Implemented and code-verified on 2026-09-07; human window verification remains pending.

- All 59 Maestro Node tests passed, including 16 new native-layout regressions.
- Main/preload/renderer production compilation passed with `yarn electron-vite build` using the
  current profile. No installed app replacement or release was performed.
- Four service/helper files and both new test files passed targeted ESLint. The controller's
  existing unused `AgentConversationContext` import still prevents a clean lint result there.
- `typecheck:node` passed with its existing `--noCheck` limitation. Unchanged renderer type errors
  block `typecheck:web`; 29 existing alias-rule violations block `check:maestro`.
- No Electron launch, E2E or independent review. The owner test above is the remaining handoff.
