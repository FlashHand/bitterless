# Re-opening the workspace that is already open reloads it, and can fail WORKSPACE_ACCESS_DENIED

Reported by Ral 2026-09-07: with a workspace already open in OnlyPreview, opening the same workspace
again re-loads it. Re-opening what is already open should be a no-op. Observed alongside:

```
OnlyPreview error · 2026-09-07T07:35:13.151Z
code: WORKSPACE_ACCESS_DENIED
name: OnlyPreviewContractError
message: Project authority does not match the active workspace.
```

Applies to bitterless and, by vendoring, to the micromeet-cowork port. Fix here (PQ-4).

## Why the two observations are probably one bug

The error is an authority-generation mismatch, and a re-open is exactly what produces a new
generation. Binding a project workspace goes through `fileSearchWindowService.bindProjectWorkspace`,
which returns a `workspaceGeneration`; that value is then pinned with
`onlyPreviewWorkspaceRegistry.bindProjectAuthority(hostToken, workspaceId, generation)`. Anything
still holding the previous generation — an in-flight preview authorization, a pending selection
restore — fails the comparison afterwards, and `WORKSPACE_ACCESS_DENIED` is the message for that.

So the sequence that fits all of it: re-open → re-bind → new generation → in-flight work from before
the re-open is denied. The unnecessary reload is not just wasted time; it is what invalidates
references that were perfectly valid a moment earlier.

This is also the likely amplifier of the sibling issue
[`onlypreview-external-preview-clears-project-selection`](onlypreview-external-preview-clears-project-selection.md):
a re-bind puts the workspace back into `projectAuthorityPending`, and while it is pending
`resolveProjectFileRef` returns `null`, so an external preview arriving in that window is classified
as external and clears the tree selection. One root cause, three visible faces — worth fixing before
either symptom is chased on its own.

## What to change

**Short-circuit the open when the requested directory is the one already bound.** The comparison has
to be on the resolved real path, not the string the caller passed, or a symlinked or
differently-spelled path to the same directory will miss the short-circuit and re-bind anyway — the
same path-form trap the sibling issue describes.

A no-op here still has to do the small amount of work a user expects from "open this again":
bring the surface forward (`onlyPreviewWindowHelper.show()`) and leave the existing selection alone.
What it must NOT do is re-bind the authority, re-copy the index, or advance the generation.

Where to put it: the directory branch of `performOpenOnlyPreviewAbsoluteTarget`, before
`onlyPreviewRecentDirectoryService.openExplicitTarget(...)`. `openExplicitTarget` already has
in-flight de-duplication (`restoreFlights`, `activeExplicitGeneration`), but that de-duplicates
*concurrent* calls to the same open — it does not answer "this directory is already the active
workspace", which is the case reported here.

## Fix — landed 2026-09-07

`isActiveProjectRoot(hostToken, rootRealPath)` on the workspace registry, consulted in the directory
branch of `performOpenOnlyPreviewAbsoluteTarget` **before** `openExplicitTarget`. On a hit it only
calls `onlyPreviewWindowHelper.show()` and returns — deliberately not
`selectionCoordinator.advance` and not `previewRegionService.clearWorkspace`, which are how an open
*replaces* what is on screen.

**A predicate, not a `rootRealPath` getter.** The obvious implementation was to read the path off
`restore()` and compare — but `toSnapshot` deliberately keeps `rootRealPath` out of
`OnlyPreviewWorkspace` (that path is what file authority is built on, so publishing it to answer a
comparison would widen the surface to save a line). The registry answers the question instead and
the path never leaves it.

It returns false while `projectAuthorityPending`, matching `restore()`: "not settled yet" is not
"already open", and short-circuiting a half-bound workspace would skip a bind that is still needed.

## Verification

`isActiveProjectRoot` has three cases in `onlyPreviewWorkspaceCore.test.mjs`:

- the bound root → true; a sibling directory → false; a **descendant** → false (re-opening a child
  directory is a real open, not a no-op); non-string → false.
- pending authority → false.
- **`realpathSync(symlink)` → true, raw symlink path → false.** The second half is not a defect, it
  pins the precondition: this function requires a real path, which is why the caller passes
  `inspected.rootRealPath`. That is also what makes a symlinked spelling — or macOS's `/tmp` vs
  `/private/tmp` — hit the short-circuit instead of sliding past it into a needless re-bind.

The source-shape guard in `onlyPreviewExternalFilePreview.test.mjs` asserts `isActiveProjectRoot`
appears **before** `openExplicitTarget`, so the short-circuit cannot be reordered after the re-bind
it exists to prevent.

bitterless: `typecheck` 0 errors, `test:onlypreview` 847/847. Synced to micromeet-cowork
(node 93 / web 3 — unchanged baseline, build green, 7 guards green).

Not verified by hand: the reported `WORKSPACE_ACCESS_DENIED` needs a re-open with an authorization
in flight, which is timing-dependent and has no unit-level repro. The causal chain is argued above
from the generation logic, not observed.
