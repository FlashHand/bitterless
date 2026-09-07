# An external preview of a file INSIDE the open project clears the project's tree selection

Reported by Ral 2026-09-07: a project directory is open; an external program asks OnlyPreview to
preview a file; the file previews, but the project tree loses its selection — even though the file is
a child of the directory already open, so it should have been selected *in* the project.

Applies to bitterless and, by vendoring, to the micromeet-cowork port. Fix here (PQ-4).

## What "deselected the project" actually is

Worth pinning down, because the wording suggests the project got closed and it did not.
`clearProjectSelection` touches exactly one field:

```ts
clearProjectSelection(hostToken: unknown): boolean {
  …
  delete workspace.selectedRelativePath;
  return true;
}
```

The project binding, its authority and its index all survive. What is lost is which item is
highlighted — which is the visible symptom.

## Root cause

`performOpenOnlyPreviewAbsoluteTarget` (`onlyPreviewExplicitOpen.service.ts`) branches on whether
the target resolves to a file inside the bound project:

```ts
let fileRef = onlyPreviewWorkspaceRegistry.resolveProjectFileRef(host.hostToken, inspected);
if (fileRef) {
  // …authorize through the project, select it in the tree…
} else {
  fileRef = onlyPreviewWorkspaceRegistry.registerExternalPreview(host.hostToken, inspected);
  onlyPreviewWorkspaceRegistry.clearProjectSelection(host.hostToken);   // ← the symptom
}
```

So the bug is upstream of the clear: **`resolveProjectFileRef` returned `null` for a file that is
inside the project**, and the `else` branch then did what it is supposed to do for a genuinely
external file.

`resolveProjectFileRef` has four `return null` paths (`onlyPreviewWorkspace.registry.ts:143-170`):

| # | condition | verdict for this bug |
| --- | --- | --- |
| 1 | `!selectedRelativePath` — target is not a regular file | not this: a file previewed |
| 2 | `!workspaceId` — no project bound to this host | not this: a project was open |
| 3 | `workspace.projectAuthorityPending` | **prime suspect** |
| 4 | the relative path escapes the project root | **prime suspect** |

**#3 is a race, and it is the one that matches "it happens sometimes".** While the project's
authority is being bound, any external open arriving in that window is classified external and
clears the selection. The window is not small — binding goes through `fileSearchWindowService`.

**#4 is a path-form mismatch.** The comparison is
`relative(workspace.rootRealPath, resolve(target.rootRealPath, selectedRelativePath))`. Both sides
are supposed to be real paths, so any asymmetry in how they were resolved (a symlinked project root,
or macOS's `/tmp` → `/private/tmp`) yields a `../…` result and a false "outside the project".

## Fix — landed 2026-09-07

**#3 fixed: the three answers are now distinguishable.** `classifyProjectTarget` replaces the single
`null` with `{ kind: 'project' | 'outside' | 'unsettled' }`, and the caller clears the selection only
on `'outside'`:

```ts
if (classification.kind === 'outside') {
  onlyPreviewWorkspaceRegistry.clearProjectSelection(host.hostToken);
}
```

`unsettled` is a moment in time, `outside` is a fact about the path, and only the second one
justifies destroying project state. `resolveProjectFileRef` stays as a two-answer wrapper for the
callers that only ask "is it in the project" — but anything that clears state must use the
classifier, which its doc comment now says.

**#4 was NOT changed, on purpose.** The comparison is
`relative(workspace.rootRealPath, resolve(target.rootRealPath, selectedRelativePath))`, and both
sides are produced by `inspectTarget`, i.e. both are already real paths from the same producer.
`relative()` between two real paths is sound, so there was nothing to harden — a "fix" here would
have been churn against a suspicion. If a case-sensitivity variant ever shows up (two spellings of
one directory that `realpath` does not fold), that is where to look, and it needs a repro first.

**The root cause upstream of both** was the re-bind fixed in
[`onlypreview-reopening-same-workspace-reloads`](onlypreview-reopening-same-workspace-reloads.md):
re-opening the active workspace put it back into `projectAuthorityPending`, which is what widened
the `unsettled` window enough to be hit by hand. That fix removes most of the exposure; this one
removes the consequence.

## Verification

`classifyProjectTarget separates inside, outside, and not-yet-knowable` covers all three: pending →
`unsettled`, then the *same* workspace settled → `project` with the right `relativePath`, a sibling
directory's file → `outside`, and a directory target → `outside`. A companion case pins that
`resolveProjectFileRef` still agrees with the classifier on the one answer it can express.

The source-shape guard in `onlyPreviewExternalFilePreview.test.mjs` now also asserts the clear is
**guarded** rather than unconditional — an unconditional `clearProjectSelection` would otherwise
reintroduce this silently.

bitterless: `typecheck` 0 errors, `test:onlypreview` 847/847. Synced to micromeet-cowork
(node 93 / web 3 — unchanged baseline, 0 unresolved modules, build green, 7 guards green).

