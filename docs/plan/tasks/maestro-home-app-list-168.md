---
id: maestro-home-app-list-168
scope: BL Home navigation and app-list simplification
status: implemented; owner testing pending
depends-on: []
verify: real Arco SSR, Vue/Less compilation, app-opening unit tests and existing Home regressions
---

# Home application list

Ral requests no left navigation, a single uniform-width vertical list of icon/name rows, uppercase
app titles, and whole-row opening without descriptions or separate Open buttons. This overrides
the older Home Mini Apps/Connector rail contract; Workbench Apps and application identities stay intact.

Reference-led UI: left-aligned 320px column, max-width100%, 44px rows, fixed 24px icons, system
14px/600 text, 12px icon gap. Preserve existing tokens: white#ffffff, ink#1e2237, hover#f3f5fc,
hover-text#3e4568, focus#606b9d. Only icon and uppercase localized name are visible. A native Arco
Button fills each row, retains keyboard access/focus, and swaps the icon for its loading indicator.

Remove the rail component and its styles; preserve auth gating, routing, app order and launch
callbacks. Uppercase only Home's computed display names, not shared registry names or Workbench.
Per-app duplicate-open guard and error feedback remain. Update directly affected selector tests;
do not launch Electron/E2E, package/install, synchronize Git or run an independent review.

## Verification

- Passed 23 targeted tests across Home app-list, branding, auth gating and Omni open readiness.
- Compiled the affected Vue scripts/templates and Less; verified real Arco SSR output and row styles.
- Scoped ESLint and `git diff --check` passed.
- Electron/E2E, packaging, installation and Git synchronization were not run.

Owner acceptance: load the updated BL Home, confirm no left rail, seven uniform icon/name rows
with uppercase titles, and whole-row mouse/keyboard opening. OnlyPreview must still open in a
browser tab; busy rows must prevent duplicate opening and failed launches must allow retry.
