# A watch commit revokes a Global Search session that began after the commit started

Status: fixed in the engine; ported to the micromeet-cowork vendored copy

## Symptom

Edit any file in the workspace, then run a Global Search within the next ~400ms, and the fresh result
list can come back un-previewable. The preview pane replaces "Loading preview…" with a single line -
"OnlyPreview could not complete this action." - with no retry control and no detail. The results list
and selection are untouched, and `Open` still works, because it sends a `relativePath` rather than a
result token.

The edit that causes it need not be related to anything the query matched.

## Source Diagnosis

A watch event schedules a reconcile `WATCH_TRAILING_MS` (400ms) later. The incremental branch of that
reconcile took the writer lease and then revoked the *whole* Global Search session:

```js
const writer = await context.acquireSearchSnapshotWriter();   // watch-reconciler.mjs:284
try {
  context.globalSearchSession.revoke();                       // watch-reconciler.mjs:287
```

That bare `revoke()` clears `workspaceId` / `generation` / `requestId` **and** every issued token, so
`resolve()` fails `isCurrent()` and throws "Global search preview request is stale".

The ordering is the defect. A query is not serialized against the reconcile:

- `engine.search()` does **not** go through the engine's serial operation queue. `this.enqueue()` is
  used only by `initialize()`, the watch `onReconcile` callback, `refresh()` and `shutdown()`
  (`search-engine.mjs:229/307/563/809`); `search` / `preview` / `browseDirectory` call their
  implementations directly (`search-engine.mjs:645-666`).
- `globalSearchSession.begin()` runs at the very top of the executor
  (`global-search-executor.mjs:293-294`), 61 lines *before* the promotion gate is even read at `:355`.
- The reader/writer lease does not prevent this - it **schedules** it.
  `acquireSearchSnapshotWriter()` claims `promotionPromise` first and only then waits for readers to
  drain (`search-engine.mjs:178-185`), so the commit politely waits for exactly the query it is about
  to destroy, and revokes immediately after that query releases its lease.

The window runs from the reconcile's first `await` to the writer acquisition, and it is wide: per
changed path the reconcile does `realpath` / `lstat` / `realpath` (`watch-reconciler.mjs:205/210/211`)
plus `readParentDirectoryTreeEntry`'s own three, over a batch of up to `MAX_WATCH_CHANGE_PATHS` (512).

Captured in a real run, the revoke destroying a session that began 2.4ms after the reconcile started:

```text
660.91ms  WATCH_APPLY  full=false state=ready paths=[...child-203.txt, ...child-204.txt]
661.77ms  begin        req="preview-request"
663.19ms  replace      req="preview-request"
664.14ms  revoke       current="preview-request" <- watch-reconciler.mjs:287
```

## Fix

Stamp a monotonic sequence on the session each time a query claims it, mark it when the reconcile
starts, and revoke only the session that was observed then:

```js
// global-search-session.mjs
begin({ workspaceId, generation, requestId }) { this.sequence += 1; ... }
sessionMark() { return this.sequence; }
revokeSessionMark(sessionMark) {
  if (this.sequence !== sessionMark) return false;
  this.revoke();
  return true;
}
```

`watchReconciler.apply()` takes `const sessionMark = context.globalSearchSession.sessionMark()` on
entry and calls `revokeSessionMark(sessionMark)` at the commit. A session that predates the commit is
still revoked exactly as before; a session created inside the window survives.

Only the **incremental** branch is narrowed. The full-reconcile and promotion paths
(`search-engine.mjs:484`, reached for config changes among others) keep their unconditional
`revoke()`, which matters because a config change can move the search policy underneath a captured
authority.

### The promotion twin is kept deliberately - with a known residual

`promoteCandidate` has the same shape as the defect above and is *not* narrowed:
`acquireSearchSnapshotWriter()` at `search-engine.mjs:468` claims `promotionPromise` and drains
readers, then `revoke()` at `:484` - so it too waits for a query before destroying it. That is kept,
because a promotion is the one commit that can change what a token is *allowed* to read:
`bindSnapshotAuthority` freezes `lease.searchPolicy` onto every authority
(`global-search-executor.mjs:160-164`) and `engine.preview` prefers that frozen policy over the live
one - `authority.searchPolicy ?? this.activeSearchPolicy ?? this.searchPolicy`
(`search-engine.mjs:683`) - so a session begun inside the promotion window holds authorities bound to
the pre-promotion policy. `readStableIdentity` fails closed on *content* but not on *policy*, so
those tokens must die.
Sequence-marking them would open a real policy hole; the identity re-check above cannot cover it.

The residual: for a full reconcile that is **not** a config change (rename storm, watch overflow,
initial build), a newer session is still revoked and produces the same user-visible line. Two things
keep it rare. The executor reads the promotion gate at `global-search-executor.mjs:355` and re-calls
`begin(request)` after it at `:365`, so a query that arrives while a promotion is already pending
re-claims the session and survives; only a query that clears the gate in the instant before
`promoteCandidate` claims `promotionPromise` loses. And full reconciles are orders of magnitude rarer
than the 400ms incremental commits this issue fixed. Narrowing it properly means distinguishing a
policy-changing promotion from an index-only one - a larger change than this issue, and not attempted
here. The `sessionMark()` / `revokeSessionMark()` plumbing to build on already exists.

### Why this is safe

Surviving tokens are not trusted. Every preview branch re-verifies on-disk identity before returning
bytes - `readStableIdentity` does two `lstat`s and two `realpath`s and compares `dev`/`ino`/`size`/
`mtimeMs` against the stored authority, and the file branch re-checks again through the open handle:

- directory -> `browseDirectoryPreview` -> `readStableIdentity(..., 'directory')`
- non-text -> `infoPreview` -> `readStableIdentity(..., 'file')`
- text -> `readTextPreview` -> `infoPreview` or `readStableFileBuffer` -> `readStableIdentity`

So an authority the commit invalidated fails closed at preview time: a changed file trips the
mtime/size comparison, a deleted one trips `ENOENT`, a replaced-by-symlink one trips
`!stat.isSymbolicLink()`. The office hook only ever runs after an `info` preview that already passed
that check.

Narrowing also removes a second, worse symptom the bare revoke could produce: because `revoke()`
cleared `requestId`, a query still in flight when the commit landed failed `isCurrent()` at its
terminal `replace()`, rejecting the **whole search** rather than one preview token.

## Verification

- `tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs` gains two tests that pin both
  directions of the contract. They hold the commit open at the writer-lease boundary with a deferred,
  so the interleaving is deterministic rather than timing-dependent:
  - "a watch commit revokes the search session it observed when the commit began" - the control;
    passes both before and after the change, so the fix cannot silently disable revocation.
  - "a watch commit leaves a session that began inside the commit window alive" - fails against the
    bare `revoke()`, passes with the mark.
- `yarn test:onlypreview` 6 consecutive runs, 823/823 each. `yarn typecheck:node` clean.
- The hand-built context in `onlyPreviewWarmSearchScale.test.mjs:122` stubs `globalSearchSession`, so
  it was updated to the current contract (`sessionMark` / `revokeSessionMark`) rather than making the
  reconciler defensive about a double that no longer matches it.
- Electron E2E not run - agent-initiated E2E is prohibited in this project.

## micromeet-cowork port

`micromeet-cowork` vendors OnlyPreview, and `docs/features/onlypreview-miniapp.md` PQ-4 fixes the
direction: **one-way, bitterless is the source**. All four vendored trees were byte-identical before
this change, so the port is the two changed files copied verbatim; `diff -rq` over
`src/preload/onlypreview/search/` is silent again afterwards.

Cowork has no OnlyPreview tests, so the ported copy was exercised directly: the same two-direction
scenario run against cowork's own modules returns `OK (text)` for a session begun inside the window
and `REJECTED: Global search preview request is stale` for one begun before the commit - matching
bitterless exactly. `yarn typecheck:node` there is 103 errors before and after the port, none in the
two ported files; those are the in-flight vendoring's own missing-module errors, not this change.

## Related

- [OnlyPreview preview-token test races its own live watcher](onlypreview-preview-token-test-races-live-watcher.md) -
  the test-level flake that exposed this, and the FSEvents behaviour that made it fire during a test
