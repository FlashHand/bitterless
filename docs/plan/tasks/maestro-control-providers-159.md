---
id: maestro-control-providers-159
scope: Remove Micromeet and Local from BL Maestro Control choices
status: implemented; owner testing pending
depends-on: []
verify: Focused provider selection/restore/send tests and Vue compilation
---

# Maestro Control provider choices

Ral requests removal of Micromeet (`ai-crms`) and Local (`local`) from BL Maestro Control.
Filter both provider declarations and preset-derived groups in ControlApp. Do not delete shared
Main providers, Workbench configuration or Cowork implementations, or rewrite saved settings.

An existing saved selection for a removed provider stays truthfully labelled but cannot send,
select models/effort, log in or trigger an injected skill in this Control. Keep the provider picker
available so Ral can explicitly select another provider. Never silently choose the first group or
switch to a potentially chargeable provider. Reuse existing controls, theme and localized notice.

Implement only ControlApp.vue, necessary translation entries and focused tests. Compile the SFC,
test filtering/preset fallback, persisted selection and both send entry points. No application/E2E,
independent review, full build/typecheck, release/install or Git operations.

## Delivery

Implemented only ControlApp and one localized notice per language. Removed the Control-only
Local Configure branch; shared backend providers and stored values remain untouched. The selector
filters both sources, no first-group fallback disguises an old provider, and normal/manual switch
and injected-skill paths enforce the same availability check.

Six actual SFC setup/render tests pass, covering restored/broadcast old values with no settings
write, labels and disabled controls, both filtered sources, explicit provider changes and normal
login/effort/turn-lock behavior. The persistence guard, SFC/TS transform/template compilation and
bundled en/zh notice checks pass. Scoped source lint has zero errors and305 formatting warnings;
the new test has zero errors/warnings. No full semantic typecheck, application/E2E or release.

Ral should verify both removed providers are absent from the picker, and a saved old provider
requires an explicit allowed choice before sending. Model selection is right aligned by task155.
