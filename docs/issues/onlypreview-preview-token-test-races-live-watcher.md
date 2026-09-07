# OnlyPreview preview-token test races its own live workspace watcher

Status: repaired in the test; one product observation left open

## Symptom

`tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs` -> "result preview is token-only,
bounded, typed, and revoked by the next query" fails intermittently under the full parallel
`yarn test:onlypreview` run, and passes on an immediate re-run with no source change. In isolation it
passes every time. The failure is a positive `engine.preview(...)` assertion rejecting with

```text
Global search preview request is stale
```

for a token the test has neither re-queried nor revoked.

## Source Diagnosis

`engine.initialize()` attaches a real recursive `fs.watch` on the workspace root
(`search-engine.mjs:304`), so the test runs its whole token-lifetime scenario against a live
watcher. A watch commit is a **third** revocation source that the test does not control, alongside
the next query and `refresh()`:

```text
fs.watch event -> watch-controller.schedule()
              -> setTimeout(flush, WATCH_TRAILING_MS = 400ms)
              -> onReconcile -> applyWatchChangesInternal
              -> watch-reconciler.apply()  (incremental branch)
              -> context.globalSearchSession.revoke()      <- watch-reconciler.mjs:287
```

That bare `revoke()` clears `workspaceId` / `generation` / `requestId` *and* every issued token, so
the next `preview()` fails `isCurrent()` and reports "preview request is stale".

The event itself comes from the test's own fixture writes. On macOS, FSEvents delivers events for
writes that completed **shortly before** the watcher was attached - kernel-side coalescing has not
flushed the directory's bucket yet - so the tail of the 205-file fixture setup lands in a watcher
created afterwards. Measured leak probability against the gap between the last write and attach, on
an idle machine:

```text
gap=  0ms  leakedRuns=4/8   totalEvents=6
gap=  5ms  leakedRuns=4/8   totalEvents=13
gap= 10ms  leakedRuns=0/8   totalEvents=0
gap= 20ms  leakedRuns=0/8   totalEvents=0   (and 40 / 80 / 160ms: 0/8)
```

The engine attaches roughly 10-30ms after the fixture writes, which is why an idle machine never
loses: the window has closed. Under the parallel suite's I/O and CPU contention the delivery window
stretches past that gap, the event lands, and 400ms later the reconcile wipes the session. The test
takes 1136-4878ms in a parallel run, so it is fully exposed to a 400ms timer; the other three tests
in the file take 16-304ms and assert only rejections, so they do not lose.

## Evidence

Captured in a real failing suite run, with the engine instrumented to buffer every session
transition and dump it when `preview()` throws. The leaked paths name themselves - they are the last
two files the fixture setup wrote:

```text
646.82ms  revoke       <- promoteCandidate                       (end of initialize)
660.91ms  WATCH_APPLY  full=false state=ready
                       paths=["preview-directory/child-203.txt",
                              "preview-directory/child-204.txt"]
661.77ms  begin        req="preview-request"                     (the test's query)
663.19ms  replace      req="preview-request"
664.14ms  revoke       current="preview-request" <- watch-reconciler.mjs:287
```

The reconcile is **queued behind the initialize build** in the engine's operation queue: the trailing
timer fires while the build still owns `operationTail`, so the reconcile runs as soon as the build
releases it - interleaved with the query that follows. The revoke at 664.14ms therefore destroys a
session that `begin()` created at 661.77ms, three milliseconds *after* the reconcile had already
started.

Deterministic A/B, forcing that exact ordering (an unrelated write 60ms into a build long enough that
the 400ms trailing timer fires before the build ends), 3 runs each:

```text
mode=none   preview=REJECTED: Global search preview request is stale   watchApplies=[{"paths":1,"state":"ready"}]
mode=drop   preview=REJECTED: Global search preview request is stale   watchApplies=[{"paths":1,"state":"ready"}]
mode=drain  preview=OK (text)                                          watchApplies=[{"paths":1,"state":"ready"}]
```

`mode=drop` is `close({ drain: false })`: closing the controller does **not** cancel a reconcile that
is already queued, and the extra awaits actually make the interleaving *more* likely than leaving the
watcher alone.

## Classification

This is a **test artifact, not a token-lifetime defect**. The failure direction is fail-closed: a
token is revoked *earlier* than the test's model expects, never observed as still-valid after a
revocation. `OnlyPreviewGlobalSearchSession` rejects every stale path (`issue`, `replace` and
`resolve` all check `isCurrent` first), each `search()` calls `begin()` and drops the previous
request's tokens, and `previewOnlyPreviewGlobalSearchResult` re-verifies on-disk identity before
returning bytes. Nothing here lets a revoked token read anything.

## Fix

Stop the live watcher immediately after `initialize()` in that test - the idiom the rest of this
suite already uses for engine tests that are not about watch reconciliation
(`onlyPreviewSearchEngineSqliteIndex`, `onlyPreviewSearchEngine.boundary`,
`onlyPreviewWarmSearchLifecycle`, `onlyPreviewSelectedFileIndexPriority`, and others) - but
**draining**, which those tests do not need because they drive `applyWatchChangesInternal` by hand:

```js
await engine.watchController.close({ drain: true });
engine.watchController = undefined;
engine.watchRevision += 1;
```

`close()` sets `closed` first and clears the trailing timer, so no further reconcile can be
triggered; `drain: true` then awaits `running`, which settles only after an already-triggered
reconcile has finished - including the wait for the engine's operation queue. Nothing is left in
flight when the query below issues its tokens. The `watchRevision` bump neutralizes anything that
still slips past the drain, since the engine's `onReconcile` closure returns early once the revision
moves. Watch-driven revocation keeps its own coverage in `onlyPreviewPreviewWatchCommit.test.mjs`
and `onlyPreviewSearchEngineWatchBoundary.test.mjs`.

## Open product observation - not changed here

The incremental watch commit revokes more than the refresh path does, and the asymmetry looks
accidental rather than decided:

| Trigger | Call | Effect |
| --- | --- | --- |
| `refresh()` | `revokeResults()` (`search-engine.mjs:561`) | session identity kept, tokens dropped |
| incremental watch commit | `revoke()` (`watch-reconciler.mjs:287`) | session identity **and** tokens dropped |
| promotion | `revoke()` (`search-engine.mjs:484`) | session identity and tokens dropped |

Two things follow from that, and the second is the sharper one.

- **Scope.** One unrelated file changing anywhere in the workspace ends the viewer's whole search
  session rather than just invalidating its result capabilities, so the renderer sees "preview
  request is stale" instead of "result capability is stale".
- **Ordering.** `revoke()` is unconditional: it does not ask whether the session it is destroying is
  newer than the change that triggered the reconcile. The trace above shows a reconcile revoking a
  session that began after it started. In the product that reads as: edit a file, type a new search
  within the 400ms trailing window, and the fresh result list comes back un-previewable even though
  the edit predates the query.

Both are fail-closed, and preview re-verifies on-disk identity regardless, so nothing is exposed.
Narrowing the call at `watch-reconciler.mjs:287` - to `revokeResults()`, or to a revoke that only
fires for sessions that predate the reconcile - changes which live sessions survive an unrelated
edit, so it needs an owner decision rather than being folded into a test repair.

## Related

- [OnlyPreview first search waits for startup reconciliation](onlypreview-first-search-startup-delay.md) -
  the other startup-timing gate on this engine
