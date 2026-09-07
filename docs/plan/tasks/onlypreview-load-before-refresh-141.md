---
id: onlypreview-load-before-refresh-141
scope: a reusable index loads and reports ready immediately, and the freshness reconcile moves off the initialize and search path into the background
status: pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs tests/onlypreview/onlyPreviewLoadBeforeRefresh.test.mjs && yarn test:onlypreview && yarn typecheck:node && yarn build && git diff --check
---

# Load the index, then refresh it in the background

## Objective

Owner request, 2026-09-07: 「拆开"加载"与"刷新"。`initialize()` 找到有效索引后直接加载并返回 ready，
跳过目前无条件执行的全目录计数、数据库复制、遍历和替换。首次打开才建立索引。」

And the owner's own specification of the reopen case:

> 例如关闭 Preview 后修改 A 目录，再打开时：
> - 立即加载 A 的已有索引，允许搜索。
> - 后台扫描文件路径、大小和修改时间。
> - 新增、修改的文件：读取内容并更新对应索引。
> - 删除的文件：移除对应索引。
> - 未变化的文件：保留原索引，不重新读取正文、分词。
>
> 现有 `reconcile` 已有跳过未变化文件内容的逻辑，可以沿用。主要需要让它独立在后台执行，避免初始化
> 和搜索等待它结束。需要区分：关闭期间没有监听，所以重开后仍需扫描元数据来发现变化。

**This is a scheduling change, not a rewrite of reconcile.** The unchanged-file skip already exists
and stays; what moves is when it runs and what waits for it.

## Evidence

`onlypreview-warm-search-before-reconcile-042` measured the current open path on a reusable index:

| stage | measured |
| --- | --- |
| Shell dispatch → hidden-runtime acceptance | ~5ms |
| SQLite reuse / hydration | 1.203s |
| **full count** | **9.07s** |
| **candidate backup (database copy)** | **12.09s** |
| **traversal / reconcile** | **16.94s** |
| **promotion** | **0.714s** |
| behind the initial-tree gate | **33.024s** |

Everything in bold happens today *before* `state = 'ready'`, on every open, even when the index is
reusable. Task 042 already un-gated *search* from it; this task un-gates readiness itself.

## Where it is

`src/preload/onlypreview/search/core/search-engine.mjs` `initializeInternal` (from ~:260):
`hasActiveIndex = seedIndex.isReusable(this.identity)` already adopts the index and hydrates the
tree snapshot at :297-301 — and then unconditionally continues into `emitBuildProgress('counting')`,
`countWorkspaceSearchEntries`, and `buildAndPromoteCandidate({ reconcileExisting: canReconcile })`,
only reaching `state = 'ready'` at :350.

## Contract

- **Reusable index → ready on the load, not on the refresh.** When `isReusable`, adopt the index,
  hydrate the tree, publish the snapshot and set `state = 'ready'`. The count, the candidate copy,
  the traversal and the promotion do not run on this path.
- **First open is unchanged.** No reusable index → today's full build, `state = 'building'`, the
  fail-closed first-build guarantee intact.
- **The offline window is the reason the scan cannot be dropped.** Nothing watches while the app is
  closed, so a reopen must still scan metadata — path, size, `modified_ms` — to discover what
  changed. `search_tree` and `files` both already carry `size` and `modified_ms`, so the scan has
  what it needs without reading content.
- **The background pass reuses the existing reconcile**, including its skip of unchanged files'
  content and tokenization. New and modified files get read and reindexed; deleted files get removed;
  unchanged files are left alone. Do not write a second reconcile.
- **Nothing waits for it.** Not `initialize`, not a query, not the tree. It reports progress, and its
  completion is an event rather than a gate.
- **No UI contract change is needed, and none should be made.** `OnlyPreviewProjectIndexState` stays
  `'building' | 'reconciling' | 'ready' | 'failed'`, because
  `onlyPreviewProjectIndexState.service.ts:66-71` already latches: once `ready` is published for a
  bind, a later `reconciling` is ignored, precisely so "an ordinary file save" does not re-show
  "Loading project". Publishing `ready` on the load and letting the background pass report
  `reconciling` is exactly the shape that latch was built for.
- **Preserve what 042 listed as non-negotiable**: fail-closed first build, cancellation, capability
  scoping, memory bounds, and candidate isolation. If the background pass keeps copy-then-promote,
  candidate isolation is unchanged and the cost simply moves off the critical path; if it writes in
  place instead, say so and say what replaces that guarantee.
- The full count exists to give progress a denominator. A background pass does not need one up
  front — leave the count out of the ready path entirely, and either stream a running total or
  report indeterminate progress. Do not reintroduce a 9-second count to draw a progress bar.

## Verification

- Reopen with a reusable index reaches `ready` without calling the count, the candidate copy or the
  traversal — asserted on the call path, since this is the whole point and it is invisible from the
  outside once it is fast.
- The owner's scenario end to end: close, modify a directory (add, edit, delete), reopen. Search
  works against the old index immediately; the background pass then reflects all three changes.
- Unchanged files are not re-read and not re-tokenized during that pass.
- A query issued while the background pass is running is answered, not queued behind it.
- First open still builds, and a failed first build still fails closed.
- Cancellation: closing the workspace mid-pass leaves no half-promoted index and no orphaned copy.
- The project-index pane does not flip back to "Loading project" when the background pass starts.

## micromeet-cowork

`micromeet-cowork` has no OnlyPreview and no equivalent index —
`grep -rln 'fts5|DatabaseSync|search-index' apps/cowork/src` is empty. So this change lands in
bitterless only and travels with the port under the one-way rule (PQ-4 in
`projects/micromeet-cowork/docs/features/onlypreview-miniapp.md`: bitterless is the source). Doing it
**before** the port is the cheaper order — it is one fewer divergence to carry across.
