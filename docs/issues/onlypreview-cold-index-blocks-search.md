# Cold indexing falsely fails and blocks Files search

Status: implemented and code-verified — task156; packaged-app validation belongs to Ral.

## Evidence — 2026-09-08

Production Preview `main.log` under `~/Library/Logs/Bitterless_PREVIEW/` records:

| UTC | Event |
| --- | --- |
| 03:22:49.728 | initialize accepted |
| 03:22:55.332 | root listing available, 38 entries |
| 03:23:06.357 | metadata count complete, 86,189 entries, 11,025ms |
| 03:32:49.735 | initialize RPC fails at 600,005ms |
| 03:36:57.243 | traversal/content index completes, 86,192 entries, 830,881ms |
| 03:37:00.441 | initialize succeeds in the renderer, 850,388ms |

A concurrent query waited55,425ms at `initial-tree` and exceeded its60,000ms RPC deadline.
After promotion, the next query's first Contents/Files batches took194/404ms. These are batch
times, not complete-query times. The original index was slow but ultimately successful, not a
permanent SQLite failure. The logs do not identify which files account for the content-build cost.

Cowork `main-2026-09-08.log` repeats the same pattern: initialize at01:49:59.577Z, count86,175,
RPC failure after600,003ms, real initialization success at02:04:09.718Z after849,804ms.

## Cause and correction

The metadata-only count discards its entries. Files search then waits for `currentBuildPromise`,
which includes reading/indexing all contents and atomic promotion; its `initial-tree` label is
misleading. Fixed RPC deadlines expire while the background build continues.

- Reuse the count traversal's complete metadata snapshot for early Files/folder batches. Preserve
  exclusion policy, identity, cancellation, folder-first ranking and existing result/token limits.
  Do not add a second traversal or read file bodies for this path. Run it alongside scoped Contents.
- Acknowledge initialize after its first real snapshot. Keep building asynchronously; deliver
  later ready/failure events with host/workspace/generation fences. Do not fabricate an empty-ready
  response, clear a browsable Project on a late build failure, or replay stale snapshots.
- Keep the existing final-query freshness contract: final Contents waits for the atomic index;
  early Files are usable while indexing is visibly pending. BL search deadlines become idle
  deadlines during a build, renewed only by validated, advancing same-generation progress.
  Cowork's existing cancellation/lifecycle-bounded query transport is preserved, not overwritten.

No index deletion, forced rebuild, config changes, Main filesystem I/O, application restart or
packaged-app modification is required for implementing this fix.

## Verification

Block content indexing in a bounded fixture and prove complete metadata Files/folder batches
arrive first. Exercise exclusions, tokens, cancellation, promotion and eventual response. Test
first-snapshot acknowledgement, late genuine failures, stale generations, and BL progress-aware
timeout renewal (duplicates/stale/invalid progress must not extend it). Use Node tests only;
Ral performs packaged-app testing. Delivery: [task156](../plan/tasks/onlypreview-cold-search-156.md).

Final cross-feature regressions pass BL40/40 and Cowork31/31, covering background initialization,
failure recovery, cold metadata and Escape. No live application/cache mutation was performed.
This fix removes the full-content dependency for Files and false timeout reporting; it does not
claim to reduce the observed14-minute body-index duration. Metadata enumeration remains required.
