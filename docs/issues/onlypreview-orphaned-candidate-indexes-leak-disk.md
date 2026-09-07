# OnlyPreview leaks its candidate search indexes, permanently

Found 2026-09-07 while verifying, at Ral's request, that OnlyPreview's search index is unencrypted
and per-project. Both of those hold (see *Verified as correct* below). This is the defect the same
inspection turned up.

## Symptom

`~/Library/Application Support/Bitterless/onlypreview/search-index-v6/` on Ral's machine:

| | size | files |
| --- | --- | --- |
| Real indexes (`*.sqlite`) | **172 KB** | 4 |
| `*.candidate-*` residue | **346 MB** | 6 |

The residue is **~2,000× the size of the data it was staging**, and the oldest file dates from
**20 Aug** — 18 days before this was found. `Bitterless_PREVIEW` shows the same shape with 11 stale
`*.candidate-*-journal` files (its real index is 4.9 GB, so the ratio hides there, but the orphans
are the same bug).

## Root cause

`search-engine.mjs:378` stages every reconcile into a fresh path:

```js
const candidatePath = `${this.databasePath}.candidate-${randomUUID()}`;
```

and the only cleanup is `search-engine.mjs:381`:

```js
await removeSqliteArtifacts(candidatePath);
```

`removeSqliteArtifacts` (`:47-51`) removes exactly one path plus its `-shm` / `-wal` siblings:

```js
['', '-shm', '-wal'].map((suffix) => rm(`${databasePath}${suffix}`, { force: true }))
```

Two consequences follow from that pair:

1. **The path is always brand new.** `randomUUID()` means the pre-emptive delete can never match a
   file left by an earlier run, so it only ever clears a path nothing wrote yet. There is no
   `readdir`-based sweep of sibling `*.candidate-*` files anywhere in
   `src/preload/onlypreview/search/**` or `src/preload/fileSearch/**` — grep confirms zero directory
   scans. **Nothing in the product ever deletes a previous run's candidate.**
2. **`-journal` is not in the suffix list.** A candidate that never reached WAL mode leaves a
   `*-journal` beside it, which even the targeted cleanup skips. That is the `Bitterless_PREVIEW`
   residue.

So every reconcile that does not reach `promote` — quit mid-index, crash, cancellation, or any thrown
error after `backup()` — orphans a full copy of the index forever. On a large project that copy is
measured in hundreds of MB (the `onlypreview-warm-search-before-reconcile-042` measurements put the
candidate backup at **12.09s**, which is exactly the window a user closing the window would interrupt).

## Why this is about to get worse

[`onlypreview-load-before-refresh-141`](../plan/tasks/onlypreview-load-before-refresh-141.md) moves
`counting` / candidate-backup / reconcile **off** the critical path so `initialize()` can return
`ready` immediately. That is the right change, and it makes this leak strictly more likely: the
reconcile then runs in the background, where it is far more likely to still be mid-copy when the user
closes the window. 141 should not land without a sweep.

## Fix

Sweep sibling candidates when the engine opens an index, before staging a new one:

- `readdir` the index directory, match `^<basename>\.candidate-`, and remove each match together with
  its `-shm` / `-wal` / **`-journal`** siblings.
- Add `-journal` to `removeSqliteArtifacts`'s suffix list so the targeted path is fully cleaned too.
- A live candidate from a concurrently running instance must not be swept. The index directory is
  already single-writer per project (`onlyPreviewSearchBootstrap.registry` hands out one capability
  per host), so scoping the sweep to startup — before this process stages anything — is sufficient
  without adding lock files.

## Verified as correct (Ral's actual question)

Both properties he asked about hold, checked three independent ways:

| Property | Evidence |
| --- | --- |
| **Unencrypted** | `sqlite-index.mjs:3,71` uses `node:sqlite`'s `DatabaseSync`, which has no cipher support at all; zero `PRAGMA key` / `cipher` / `rekey` in the search trees; and all four on-disk files start with the plaintext magic `SQLite format 3` |
| **One DB per project** | `onlyPreviewSearchBootstrap.registry.ts:74-78` names the file `sha256(workspace.rootRealPath)` — keyed on the symlink-resolved absolute directory, so two paths to one directory share an index instead of building it twice — and the directory holds 4 distinct `.sqlite` files for 4 projects |

Nothing to change for either.
