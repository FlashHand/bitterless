# EyesOnAgents Search Stops Accepting Input or Updating Results

Status: reproduced failure path fixed; owner verification pending (2026-09-07).

## Owner report

After EyesOnAgents remains open for a long time, the Search modal still opens, but its input cannot
be used or typed text produces no results. This is distinct from the existing Omni issue where
Cmd+F never opens the modal; shortcut routing alone does not explain this report.

## Scope and verified boundary

`EyesOnAgentsState.threadSearchResults` matches normalized title tokens against the renderer's
current snapshot in memory. Search does not query SQLite, call a provider, or await polling.
Investigate the input/modal lifecycle, draft-to-query publishing, and snapshot-driven rendering.
Keep title-only matching, clear-on-close, keyboard selection, successful-open close, and the complete
Focus board unchanged. A suspected cause must be distinguished from a reproduced regression.

## Reproduced failure path

`ThreadSearch.vue` keeps the Arco Modal's children mounted while closed. Installed Arco Input stores
an internal composition flag: composition start sets it, composition end clears it, and ordinary
input events do not publish `update:modelValue` while it remains set. Neither blur nor resetting
the bound draft clears that internal flag.

With real Arco Modal/Input in JSDOM, starting composition and closing before composition end leaves
the same poisoned Input instance mounted. Reopening and typing ordinary text then publishes no
model updates, keeps `titleDraft` empty, and lets a later controlled render erase the visible text.
The existing test Modal stub destroyed children immediately on close and therefore concealed this
failure. Recreating Input using the search lifecycle revision restores normal input and matching in
the same reproduction, including rapid close/reopen without waiting for a leave transition.

This demonstrates a code defect that fits the symptom. The owner's particular live incident has
not been instrumented; it is not proven that its composition-end event was lost.

## Repair

Key the Input by `threadSearchRevision` so each search lifetime starts with fresh component-private
editing state. Preserve the modal, input focus guards, draft/query reset, throttle, and title
matching contract. Add real Modal/Input regression coverage instead of relying only on the stub.
The fix is tracked in [task 099](../plan/tasks/eyes-on-agents-search-input-lifecycle-099.md).

The regression failed before the fix on the missing draft update and passes after it, using real
Arco components. Focused search/store tests passed 33/33 and the UI typecheck passed. Final UI
aggregate: 112/113 passed, with only the unrelated existing Windows App ID source assertion failing.
No Electron instance was launched.

## Acceptance

### Raw-input follow-up (2026-09-07)

The owner confirmed the affected entry with a screenshot of **Search threads**, and requested
`v-model` for raw editing plus computed-only normalization rather than rewriting input in event
handlers. [Task 100](../plan/tasks/eyes-on-agents-search-raw-input-100.md) implements that boundary
and adds raw-input/rerender regression coverage while preserving task 099's lifecycle repair.
The screenshot alone does not establish which event cleared the field; compare the installed
build with the reproduced source path before attributing the live incident to a particular cause.

Read-only inspection of `/Applications/Bitterless Preview.app/Contents/Resources/app.asar` found
Preview `version_code 260904172934`. Its `out/renderer/assets/App-BFJDSw4k.js` retains Modal children
(`unmount-on-close: false`, line 2974), but its Input props (lines 2985–3006) omit the lifecycle
`key` now present in source. The receiver-safe handler is already included (lines 2914–2916), and
the setter stores text unchanged (lines 199–206): it does not trim the input.

The bundled `arco-vue-DgIhp5Cq.js` retains composition state across blur (lines 1060, 1110), resets
it only on composition end (1117), and suppresses model updates during composition (1149). This
confirms the old build still contains the reproduced defect, not a normalization write-back bug.
It does not prove that the owner lost a composition-end event in this particular live incident.

Task 100 now binds the field through a raw `v-model` adapter and reuses the existing 120ms
leading/trailing scheduler. A read-only computed value derives normalized tokens from the committed
query, shared by result matching and its empty-state predicate. It captures the reactive store,
not the unproxied class constructor. No normalization writes back to the field, and no new
input-time watcher or competing search scheduler is introduced.

Task 100 verification: Search/store tests 38/38 (including 8 real Arco interaction tests), Search
source checks 3/3, scoped UI typecheck and current-profile main/preload/renderer build passed.
Scoped lint retains existing regex/test-style violations; whitespace checks passed. No Electron,
E2E, independent review or installed-app replacement was performed. Use a build containing tasks
099/100 for the owner check below.

### Human verification

- Repeated open/close and window inactive/reactivated cycles leave the input usable and focused on
  opening; fresh typing updates matches without restarting Bitterless.
- Delayed background work cannot gate local input or title matching.
- Query/selection reset on close, and stale work from an earlier modal lifetime cannot restore them.
- Verify at code level without launching Electron; Ral owns the long-running live check.
