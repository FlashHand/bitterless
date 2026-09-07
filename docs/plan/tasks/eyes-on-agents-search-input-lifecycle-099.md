---
id: eyes-on-agents-search-input-lifecycle-099
scope: Reset retained Arco input editing state between Search modal lifetimes
status: implemented; owner verification pending
depends-on: [eyes-on-agents-search-shortcut-focus-reset-072]
verify: real Arco Modal/Input interaction regression, search store tests and EyesOnAgents UI typecheck; no Electron
---

# EyesOnAgents Search Input Lifecycle

## Evidence and required behavior

See [the reproduced issue](../../issues/eyes-on-agents-search-after-long-uptime.md). The modal opens,
but an interrupted IME composition can survive its close because its Input remains mounted. Search
uses renderer memory, not SQLite; native Cmd+F routing is a separate issue and outside this fix.

- Recreate the Input for each `threadSearchRevision`. Do not change the title matching semantics,
  shared 120ms scheduler, modal containment, result cards, or board contents.
- Retain automatic input focus on opening, query/selection clear on every close path, and guards
  against old lifecycle callbacks. A rapid close/reopen must not depend on the leave transition.
- A normal completed composition still publishes its text; composing Arrow/Enter keys remain
  owned by the input method rather than search navigation.
- Repeated openings and pending background snapshot work cannot disable local typing/filtering.

## Verification

Use installed real Arco Modal and Input for interrupted-composition regression coverage, including
close before composition end, reopen, plain typing, focus, results, and no component errors. Keep
existing mounted tests for the other interaction paths. Run focused search/store tests and UI
typecheck; no Electron launch, long-lived live test, or independent review. Ral owns live testing.

## Result

Input is now keyed by the existing search lifecycle revision. The real Arco regression failed
before the fix because ordinary typing after interrupted composition left the draft empty; it
passed after the change. Three interrupted-composition reopen cycles, rapid reopening during the
leave transition, input value, draft/query, visible matching cards, focus, and no component errors
are covered. Completed Chinese composition and IME navigation keys remain intact. Pending snapshot
work and an existing busy action are separately shown not to gate local matching.

- Focused search/store tests: 33/33 passed.
- EyesOnAgents UI typecheck and scoped whitespace checks: passed.
- Final full EyesOnAgents UI suite: 112/113 passed. The unchanged source assertion at
  `scripts/eyes-on-agents/ui-source.test.mjs:66` still expects the former Windows App ID ternary;
  the current application uses `runtimeProfile`. This is unrelated to either 098 or 099 and was
  not changed as part of these fixes.
- Electron E2E and long-running live verification: not run; owner handoff.

Human check: begin Chinese composition, close Search before choosing a candidate, reopen, and type
a known session title. Verify focused input and matching results; then repeat after normal long
use/window switching. The reproduced defect is fixed, but the original live incident's precise
cause remains unconfirmed without that check.
