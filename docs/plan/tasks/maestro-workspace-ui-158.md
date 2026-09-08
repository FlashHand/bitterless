---
id: maestro-workspace-ui-158
scope: Cowork-aligned Maestro workspace control appearance, BL only
status: implemented; owner testing pending
depends-on: []
verify: workspace UI assertions, composer interaction regressions, Vue/Less compilation and scoped lint
---

# Maestro workspace control polish

## Objective and context

Ral rejects the current maestro__composer__workspace appearance and asks to use Cowork as the
reference. Follow docs/features/maestro.md. Current Cowork source uses32px controls,12px semibold
name,6px icon gap,8px horizontal padding,28px action widths and separate mini tooltips; do not
copy its260px name cap/ellipsis because task149 requires BL's complete name to remain readable.

## UI plan

```text
[ folder  full workspace name | switch | x ]  [attach]
  long names wrap here only     aligned actions
```

Keep the existing system font. Palette: white#ffffff, pale border#d9e2ee, divider#edf2f7,
hover#f4f7fb, text#374151; retain Maestro Royal Blue#4e5882 for the folder/action accent and the
existing danger theme. Compact32px single-line baseline with12px/600 name and fixed centered
16px folder. Full names can expand height; all actions stay aligned at380–480px panel widths.
Use the Cowork segmented control, without extra nested rounded button backgrounds or oversized
mini-button defaults. Visible keyboard focus and disabled states remain. This is reference-led
polish, not new branding or a speculative redesign.

Put Open/path, Switch and Clear tooltips on their own controls. Keep full path tooltip, no Refresh,
existing click-to-OnlyPreview, switch and clear-confirmation handlers, turn/archive guards and
stable names. Do not move attachment or change the two-row footer, history or focus/resize logic.

## Path and verification

Only ChatPanel.vue workspace markup, sibling ChatPanel.less workspace selectors and focused
tests/maestro/maestroComposerWorkspaceUi.test.mjs assertions (plus directly affected focused tests
if needed). No Cowork writes, Main/preload/service changes, dependencies or settings.
Vue script/template/Less compile, target workspace/composer/cleanup tests and scoped lint. No
application/E2E, independent review, full build/typecheck, release/install or Git operation.

## Implementation and verification

The segmented workspace control now uses separate mini Tooltips and explicit32px actions,
12px/600 text,6px gap,16px folder and Cowork-style fine borders/hover. Full names still wrap.
Only ChatPanel.vue/Less, the workspace UI tests and two directly related accessibility assertions
in check-workspace-files changed. Workspace UI, history and cleanup suites passed20/20; Vue
script/template, TS transform and Less compilation passed. Scoped lint passed with the pre-existing
explicit-return-type rule disabled for mjs tests. No application/E2E or release was run.

Ral should check the control at narrow/wide Chat widths, long names and each tooltip/action.

## Screenshot follow-up — 2026-09-08

Ral's current comparison shows the BL icon touching the label, curved inner separators and a
taller control than the Cowork reference. Correct the rendered button structure and effective
style cascade, not just isolated source declarations. Use white#ffffff, text#374151,
border#d9e2ee, divider#edf2f7 and the reference folder blue#165dff locally; leave the global
Maestro theme unchanged. Keep system12px/600 text,6px icon gap,8px horizontal padding and a
32px single-line outer height. Long names still wrap; Open/Switch/Clear and independent tooltips
stay unchanged. Only the outer shell has rounded corners; internal separators are straight.

Add a focused regression against actual Arco rendered button markup and shared button styles so
nonexistent wrapper selectors or higher-priority global rules cannot pass as visual coverage.
No live-app/E2E or independent review; Ral verifies the displayed result.

Confirmed causes: installed Arco renders the default slot directly, without arco-btn-content;
the previous gap rule matched no node. The shared Maestro theme's10px!important radius beat local
rounding, and32px children plus outer borders made a34px shell. ControlApp's later650 font weight
also needed a more specific workspace selector.

Fixed with an explicit workspace-content span, local higher-specificity square segment rules,
30px border-box children within the32px shell, and a locally bright blue folder. Global Button
styles and all interaction handlers are unchanged. Workspace11 + History6 + Cleanup7 pass24/24.
New regressions compile the actual workspace AST with real Arco Button/Tooltip and IconBtn,
then check its DOM and complete shared/component stylesheet cascade in jsdom. The global10px
rule remains loaded while workspace buttons resolve to0; the content gap and border dimensions
are asserted, and long names remain complete. SFC/TS transform/Less compilation passes. Source
lint has zero errors with formatting warnings; focused test lint passes using the existing mjs
return-type override. No app/browser/E2E, installation or Git operation.

## Shared Tooltip arrow follow-up

Ral additionally reports the Choose workspace tooltip arrow in both BL and Cowork. Both use native
Arco Tooltip with shared theme overrides. The content and half-embedded rotated arrow each use
rgba(29,33,41,.72), allowing the inner arrow to show through the translucent bubble. Replace both
backgrounds with the same opaque#5c5f65 (the previous approximate composite color over white).
Keep Arco's position, offset, outside arrow, radius, shadow and trigger behavior unchanged.
This is a shared theme correction, not evidence of a reproduced coordinate-placement error.
Add focused CSS/component regressions in each app; no live-app/E2E required.

Delivered in both tooltip.less files. New Tooltip tests pass3/3 per app: actual Arco SSR retains
the native arrow/10px offset/mini behavior, the Chat entry loads this theme, and compiled Less
resolves both backgrounds to the same color with alpha1 while keeping border/radius/shadow and
no positioning/transform/opacity/display override. Both syntax checks and BL scoped lint pass;
Cowork has no ESLint installed, so native Cowork lint was not run. Workspace/history/cleanup remain
24/24 after the Tooltip change. Human acceptance was appended to the existing UI Todo and sent
to BotAndI. No application/browser/E2E, build, installation or Git operation.

## Workspace dimensions follow-up — 2026-09-08

Ral now requests matching BL/Cowork heights and a 280px maximum workspace-control width with
ellipsis for long project names. This supersedes task149 and the earlier wrapping behavior above.
Cowork's h-8 compiles to 2rem and its html font is 13px: its actual outer height is 26px, not 32px.
Keep Cowork's height unchanged; BL uses a fixed 26px border-box shell/empty-state button and 24px
inner segments. Both controls cap the entire component at 280px and can shrink in a narrow chat.
Only the name truncates; full-path tooltips, actions, colors and footer grouping stay unchanged.
Update the BL actual-Arco/cascade tests and add a Cowork SFC/Tailwind regression covering the
root-font-dependent height, whole-control width, ellipsis and fixed-width actions. No live-app/E2E.

Workspace checks pass 11/11 in BL and 3/3 in Cowork, including SFC and actual Tailwind/Less
compilation. The BL tests retain real Arco markup/shared CSS cascade coverage. Full-path tooltip
and fixed-width action assertions pass; scoped test lint and diff checks have no errors.
