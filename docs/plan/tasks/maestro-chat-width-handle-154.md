---
id: maestro-chat-width-handle-154
scope: Maestro Chat 8px drag handle and active focus shadow matching Cowork
status: done
depends-on: []
verify: focused pointer/layout/store regressions, Vue/Less compile and scoped lint
---

# Resize Maestro Chat

## Objective and context

Implement the Chat width handle contract in `docs/features/maestro.md`, referencing Cowork's
current ControlApp and Home layout store. Range380–480px, left-edge hit region8px, retain BL
default480px. Preserve task143 native view visibility/layout fixes and task149 composer cleanup.
Use the frontend-design skill only to match the existing visual language, not redesign Chat.
Include Ral's follow-up active blue shadow: Chat document/window focus adds the primary-color
2px card shadow (35% opacity); blur removes it, unmount releases listeners, no IPC polling.

## Path

Own `src/renderer/maestro/control/src/ControlApp.vue` and `.less`, plus
`src/renderer/maestro/home/src/store/layout.store.ts` and `views/layout/Layout.vue`/`.less`.
Add only the resize handle label to existing en/zh locale dictionaries.
Keep resize interaction in the chat WebContentsView, use `coach/sidebar-width` through existing
XPC and Home's measured-bound pipeline. Store width once per completed gesture, no disk writes per
move. End safely on pointerup/cancel/lost capture. No Main layout duplication or new overlay.

## Verification

Test bounds/default/persistence, saved invalid values, screenX drag direction and edge movement,
pointer lifecycle, drag transition and close/reopen/native geometry with existing layout tests.
Verify focused/unfocused initialization and focus/blur cleanup.
Compile affected Vue/Less and run scoped lint; no full build/heap-heavy typecheck, Electron/E2E,
independent review, Git sync, branch operation or release. Ral owns actual drag testing.

## Delivery

Implemented the original five renderer files, en/zh resize labels and
`tests/maestro/maestroChatWidthHandle.test.mjs`. Range380–480px/default480px; 8px pointer capture
uses screenX, filters pointer identity and settles once on up/cancel/lost capture/blur/close/unmount.
Home persists only settled width, disables transition during dragging and retains existing bounds
reporting. Focus state starts from document.hasFocus and follows window focus/blur; the card uses
the current primary theme's 2px/35%-opacity blue shadow. No Main or Cowork change.

**12/12** tests passed (seven new plus five existing Chat layout regressions), including Vue SFC
and Less compilation. Scoped ESLint, `yarn check:renderer-i18n` and scoped diff checks pass. No app
launch, E2E, full build/typecheck, independent review or Git operation. Ral should test actual
cross-view dragging, lower/upper limits, saved width after reopening and shadow changes when
clicking the Chat versus a webpage in a build containing these changes.

## Follow-up: resize interrupted by preview focus

The owner reported that the real BL drag barely moves, while Cowork works. The initial tests
covered drag and view layout separately, but not focus being stolen by a composite preview during
the drag. Track the confirmed root cause and BL-only repair in
[the resize/focus issue](../../issues/maestro-chat-resize-interrupted-by-preview-focus.md).
That repair supersedes the original blur-as-gesture-end behavior above: blur only changes the
shadow; pointer termination, explicit close and unmount settle the gesture. Existing width
preferences and limits remain unchanged.
