# The host toggle leaves an empty Cowork tab behind, and standalone does not take effect

Reported by Ral 2026-09-07, against **both** bitterless and the micromeet-cowork port:
「onlypreview toggle 独立窗口打开没生效，另外注意独立窗口打开，浏览器里的 tab 就得关掉」.

Fix belongs here. `onlyPreviewHostToggle.service.ts` is bitterless code; the cowork port vendors it
(PQ-4 is single-direction), so patching it there would produce exactly the drift that policy exists
to prevent.

## Symptom 2 — the tab already IS closed on undock. Nothing to do in bitterless.

> **Correction 2026-09-07.** This section first claimed the undock direction had no tab-closing
> counterpart and needed one. That was wrong, and it is recorded rather than deleted because acting
> on it would have added a second, redundant close path to a transition that is already delicate.

`destroyStandalone()` closes the carrier through the mount, and says so on the line above it
(`onlyPreviewWindow.helper.ts`):

```ts
// The host goes down the way this host goes down — the standalone window is destroyed, a Cowork
// tab is closed — and only then are the mount's own listeners released.
mount?.destroyHost();
mount?.dispose();
```

`OnlyPreviewCoworkMount.destroyHost()` is `this.deps.close()`, i.e. "close this tab". So the mount
seam is exactly what makes one call mean "destroy the window" in one host and "close the tab" in the
other — which is the design working, not a gap.

**One real caveat, and it is cowork-only.** There, `deps.close()` lands on
`BrowserController.closeTab`, which silently refuses in two cases: `tabs.length <= 1`, and a
`pinned` tab. So if OnlyPreview were ever the only tab, undocking would leave its tab behind and
the refusal would be invisible. Today the pinned first tab guarantees `length >= 2`, so it does
not bite — but it is a latent edge, and the same silent-refusal behaviour is what
`closeActiveTab` had to work around for Cmd+W (it now hides the window when the close does not
happen). If this ever needs hardening, the check belongs behind `onlyPreviewDockHost`, not in the
vendored service.

## Symptom 1 — "standalone does not take effect". NOT yet diagnosed.

Stated honestly: I have not reproduced this one, and the leftover tab above does not explain it.

What to check first, in order:

1. **Does `toggle()` even run?** `getState()` gates the button on `canDock`, and the shell disables
   it via `onlyPreviewShellStore.hostToggle.disabled`. If `pending` never clears, the button stays
   disabled after the first press and a second press is a silent no-op.
2. **Does `relocate()` throw and silently recover?** Its `catch` rebuilds the host on `sourceKind`
   and calls `recordFailure`, so a failed undock **looks like nothing happened** — the composite is
   back where it started and the only trace is `writeOperationFailure` in the OnlyPreview log plus
   `failure` in the next `getState()`. Read `<userData>/onlypreview/onlypreview.log` around the
   press before assuming the click was lost.
3. **`buildHost('standalone', …)`** — `destroyStandalone()` runs first, so if building the standalone
   window fails, the recovery path is the only thing that renders anything.

That ordering is the reason this symptom is invisible: the failure mode of this transition is
"returns to the previous host", which is indistinguishable from "the button did nothing".
