---
id: eyes-on-agents-search-ime-render-101
scope: Preserve uncommitted IME text across Search rerenders while retaining computed v-model
status: implemented; owner verification pending
depends-on: [eyes-on-agents-search-raw-input-100]
verify: real Modal/native-input interaction regressions, actual-store search tests, compiled Less checks and UI typecheck; no Electron
---

# Preserve composing text during Search updates

## Evidence

Arco 2.57.0 suppresses model updates while composing but renders its input with the old committed
model value. Real ThreadSearch/Modal/store experiments reproduce DOM `zhong` → empty on a normal
`loadSnapshot(true)`, and `cla zhong` → `cla` during a pending search throttle. No store setter or
clear method is called and the input node is unchanged. Explicit model-value/update binding has the
same failure; native Vue `input v-model` preserves the composition under those updates. Task 099's
lifecycle key and task 100's computed binding do not protect this same-lifetime rerender path.

## Required change

- Replace only the Arco text field with a native text input using Vue's composition-aware `v-model`
  directive. Keep the existing writable `computed` adapter, `setTitleDraft`, computed tokenization,
  120ms scheduler and provider/store behavior unchanged.
- Preserve the input lifecycle reset, initial focus, raw spaces/case/Unicode, combobox ARIA and
  selected-option attributes, keyboard navigation, successful-open close, and empty-state behavior.
- Preserve explicit clear and all close/reopen paths, including while composition is pending. A
  late event from an obsolete input must not repopulate a newly cleared/opened field.
- Keep the existing compact search layout and theme/font tokens. Use a borderless wrapper and
  native input; express focus with background, and use the shared IconBtn + Tabler clear icon with
  a localized accessible label. Compile the surface's Less to verify the actual no-border reset.
- Preserve unrelated user edits, including the current section-id edit. Do not change global
  shortcut routing, other inputs, provider behavior, packaging, or dependencies.

```text
Search threads
  search icon   native input (computed v-model)   clear icon
  normal session result cards (unchanged)
```

## Verification / owner handoff

Add real Modal/input and actual-store coverage for uncommitted IME across snapshot/selection
updates, pending throttle commits, focused-state changes, empty/non-empty committed drafts,
completed composition, explicit clear, and repeated close/reopen. Retain ordinary search and
keyboard tests. Run focused search/store tests, UI typecheck, and compiled Less assertions; no
Electron/E2E or independent review. Ral tests Pinyin + Cmd+F and keeps composition active through
a background refresh, then checks selection/clear/close/reopen in the real window.

### Code verification (2026-09-10)

- Real Modal/native-input interaction regressions: 12/12 passed, including actual-store snapshot
  refresh, pending search commits, candidate key routing, clear/close late events and rapid reopen.
- UI typecheck passed. The actual renderer Less stack (Arco, theme, IconBtn and Search) compiled;
  its borderless input/button and background-focus assertions passed (1/1).
- Full `yarn test:eyes-on-agents:ui`: 121/123 passed. Two existing source assertions remain:
  the notification test expects the old VITE_ENV-based Windows App ID expression, and the search
  test expects a section ID without the owner's pre-existing inserted space. Neither unrelated
  source change was reverted and neither assertion was weakened to conceal the mismatch.
- Scoped whitespace checks passed. Store production code, writable computed binding and the
  120ms scheduler are unchanged. No Electron/E2E, independent review, packaging or Git sync ran.

Owner check: in the new code, activate Pinyin, open with Cmd+F and leave `zhong` uncommitted
through a background refresh. Also start with `cla` before composing more text. Confirm no rollback,
then check candidate confirmation, result navigation/open, clear, and close/reopen focus/reset.
