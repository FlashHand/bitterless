# The host toggle's standalone window dies before it is shown: a stale rejection tears down the new runtime

Reported by Ral 2026-09-07: pressing **Open in window** does not open a separate window — the
composite reloads in the browser tab instead. Same in bitterless and in the micromeet-cowork port.

Fix belongs here; cowork vendors this code (PQ-4).

## What the user sees, and why nothing looked wrong

`createStandaloneWindow` creates the base window with **`show: false`** and only reveals it later. So
a failure between creation and `show()` produces no window at all — and `relocate`'s `catch` then
rebuilds on `sourceKind`, putting the composite back in the tab. Together those two make a failed
move look exactly like *"the button reloaded the tab"*, with no window ever appearing.

## Root cause, from the log

Instrumenting `stop()` with its caller and `relocate` with its decision made one press readable:

```
29.815 host-toggle phase=plan source=cowork destination=standalone dock=yes
29.817 runtime-stop lifecycle=3  hadWindow=true   by=OnlyPreviewWindowHelper.destroyStandalone
29.840 runtime-stop lifecycle=5  hadWindow=false  by=FileSearchWindowService.start
29.854 runtime-stop lifecycle=7  hadWindow=TRUE   by=FileSearchWindowService.rejectOfficeReadProtocol   ★
29.913 host-toggle phase=failed  destination=standalone recoverTo=cowork
       error=ERR_FAILED (-2) loading 'http://localhost:5173/fileSearch/index.html'
30.420 host-toggle phase=recovered kind=cowork
```

`hadWindow=TRUE` on the starred line is the whole bug. 14 ms after `start()` created the **new**
file-search window, `rejectOfficeReadProtocol` called `stop()` and destroyed it mid-load. That
aborts the pending `loadURL`, which is why the error is `ERR_FAILED (-2)` and why `did-fail-load`
never fires — the instrumented `runtime-load-failed` line was emitted **zero** times, proving the
page was never the problem. Both dev servers answer `/fileSearch/index.html` with HTTP 200; that was
checked directly.

The rejection comes from the **old** runtime's in-flight readiness call. Teardown lands while
`waitUntilReady` is awaiting, the response arrives against a runtime that is already gone, fails
validation, and takes the `rejectProtocol` path:

```ts
private rejectOfficeReadProtocol(message: string): never {
  const reportFatal = this.privilegedRuntimeFatal;
  this.stop();          // ← unconditional
  reportFatal?.();
```

`stop()` there is unconditional, so a stale conversation tears down whichever runtime is current.
Everywhere else in this service already guards on lifecycle — the request wrapper re-checks
`current.lifecycleId !== initial.lifecycleId` after its await and throws *"was superseded"* — but the
readiness path never captured an `initial` to compare against.

## Fix

`waitUntilReady` now snapshots `getLifecycleState().lifecycleId` on entry, and on an invalid
response prefers **superseded** over **invalid**:

```ts
if (this.host.getLifecycleState().lifecycleId !== startedLifecycleId) {
  throw new Error('Office read runtime startup was superseded.');
}
return this.rejectProtocol('Office read readiness response is invalid.');
```

Applied to both readers (office and preview-read), which had the identical shape. A stale
conversation is now an ordinary superseded error — it fails its own startup and touches nothing
else — while a genuine protocol violation on the *live* runtime still reaches `rejectProtocol` and
still tears it down, which is what that path is for.

This is the minimal correct change: it does not widen the `rejectProtocol` contract, and it reuses
the exact comparison the request wrapper already makes 300 lines away.

## Also landed: repeated clicks now settle

Ral 2026-09-07: 「要能退火连续点击这个 toggle」. `toggle()` refused a second request whose host token
differed:

```ts
if (this.pending.hostToken === hostToken) return this.pending.promise;
throw new OnlyPreviewContractError('OPERATION_FAILED', 'OnlyPreview is already changing hosts.');
```

That was wrong in the only case that happens. A transition **replaces the host**, so the shell firing
the second click is a different shell holding a different token — the guard turned "clicked twice"
into a thrown error the user saw as a failure banner. It now coalesces for any token: at most one
composite is live, so two requests to move it are the same request, and joining the in-flight
promise is both correct and what keeps a second `relocate` from starting on top of the first.

## Still open

The instrumentation is deliberately left in place. It is what made this readable at all, and the
transition has more than one way to fail quietly — `restoreTarget` swallows its own errors by design
so a move can succeed with a stale document on screen, and the recovery path will keep making any
future failure look like "the button did nothing".
