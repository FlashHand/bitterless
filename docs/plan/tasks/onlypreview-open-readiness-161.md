---
id: onlypreview-open-readiness-161
scope: Serialize readiness of repeated OnlyPreview workspace opens
status: implemented; owner testing pending
depends-on: []
verify: Actual helper methods with delayed runtime readiness, rejection and stale-host tests
---

# Workspace opening readiness

The03:54:52 DEBUG_PROD log shows a separate pre-index failure: a second explicit open reuses a
partially attached window before its fileSearch runtime is registered. A missing XPC authority
response is correctly rejected as a protocol failure, taking the unfinished runtime down. An
actual helper-method Node fixture reproduces the early return without Electron or HMR.

OnlyPreviewWindowHelper publishes its host/window before attachSurface finishes; both
ensureStandalone and openOnMount existing-host paths currently return without waiting. Track the
current surface opening promise in this helper and await that readiness for all reused opens.
Reject all waiters when opening fails or its host is destroyed. Bind failure cleanup to that host
so an old rejection cannot destroy a replacement. Do not weaken XPC validation or add sleeps,
parallel rival surfaces or a second readiness mechanism in MaestroBrowserView.

Preserve host transitions, focus/open traces and teardown. Inspect Cowork's same helper and port
the narrow readiness fix without reverting its mini-022 late host-registration correction.
Verify concurrent cold standalone/tab opens, failure propagation, destroyed/replaced generations
and existing-ready reuse using native stubs; no application/E2E, review, full build or Git.

## Delivery and verification

Both helpers now share a surfaceOpening readiness promise. The two open entrances join it before
reusing a partially attached host; failure, host revocation and cold tab closure reject waiters.
Cleanup and runtime-exit callbacks are host-fenced so a late old failure cannot destroy a successor.
The temporary cold-start host listener is released after startup; normal teardown and transitions
keep their existing ownership. No MaestroBrowserView or protocol-validator change was needed.

BL38/38 passes (new readiness11, HostToggle10, Mount5, Escape6, Integration6). Cowork26/26 passes
(readiness11, CompositeStartup9, Escape6), preserving its runtime-mode adapter and mini-022.
These execute actual helper methods with deferred runtime gates and native stubs, not Electron.
BL scoped lint passes. Equivalent Cowork checking retains its existing unused app import; no
unrelated cleanup or dependency installation. No app/E2E, full build, review or Git operation.

Targeted semantic checking reports zero diagnostics in the changed readiness sections. Both full
helpers still contain four existing Settings/Guide getSize spread-tuple errors; Cowork also has
existing unused app/settingsWindowState diagnostics. They were not expanded into this fix.

Ral should open the workspace repeatedly during startup, test both tab/window modes and close a
starting tab before opening a replacement. No premature protocol failure or successor teardown
should occur. Task160 separately recovers the confirmed damaged database on the new-code run.
