# OnlyPreview preview-token test races its own live workspace watcher

Status: repaired in the test; the product observation it raised is now settled and fixed - see
[a watch commit revokes a newer search session](onlypreview-watch-commit-revokes-a-newer-search-session.md)

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

## The product defect this exposed - now fixed

The incremental watch commit revoked more than the refresh path did, and the asymmetry was not
decided, it was accidental:

| Trigger | Call | Effect |
| --- | --- | --- |
| `refresh()` | `revokeResults()` (`search-engine.mjs:561`) | session identity kept, tokens dropped |
| incremental watch commit | `revoke()` (`watch-reconciler.mjs:287`) | session identity **and** tokens dropped |
| promotion | `revoke()` (`search-engine.mjs:484`) | session identity and tokens dropped |

The sharper half was ordering, not scope: `revoke()` never asked whether the session it destroyed was
newer than the change that triggered the reconcile, and `engine.search()` does not serialize against
the reconcile at all. That is reachable in the shipped app, not only in this test. It is fixed by
marking the session on reconcile entry - see
[a watch commit revokes a newer search session](onlypreview-watch-commit-revokes-a-newer-search-session.md)
for the diagnosis, the fix and its verification.

With that fix in place this test's own hazard is closed at the source too: the leaked reconcile starts
before the test's query, so the query's session now outlives it. The `drain: true` change above is
kept anyway - a test about the query/refresh/explicit-revoke token lifetime should not have a live
watcher in it at all.

## Correction worth carrying forward

`close({ drain: false })` followed by `engine.watchRevision += 1` - the idiom at 18 sites in this
suite - does **not** reliably neutralize a pending reconcile, which is easy to assume it does. The
revision guard lives inside the enqueued closure:

```js
onReconcile: (change) => this.enqueue(async () => {
  if (this.watchRevision !== watchRevision) return;
  await this.applyWatchChangesInternal(change);
}),
```

Once the build releases `operationTail`, that closure's check runs in the same microtask drain that
resumes the test after `await engine.initialize(...)`. If the check wins, the reconcile is already
past the guard and the later bump changes nothing. The deterministic A/B above shows exactly that:
`mode=drop` performs the close **and** the revision bump and still loses 3 out of 3. Only draining
settles it.

## Related

- [OnlyPreview first search waits for startup reconciliation](onlypreview-first-search-startup-delay.md) -
  the other startup-timing gate on this engine
