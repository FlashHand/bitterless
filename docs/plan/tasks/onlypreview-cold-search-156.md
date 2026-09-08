---
id: onlypreview-cold-search-156
scope: cold-index acknowledgement and early metadata search in BL and Cowork
status: done
depends-on: []
verify: focused engine, background-index, relay and Shell lifecycle Node regressions
---

# Cold indexing and global search

Implement [the evidence-backed issue](../../issues/onlypreview-cold-index-blocks-search.md).
Success means Files can stream from complete metadata before content indexing finishes;
legitimately progressing background work does not cause an initialization/search false failure;
real failures and cancellation still terminate correctly. Preserve the atomic final-query contract.

Port Cowork's existing background-initialization protocol to BL, preserving BL host authorization
and fixed idle-watchdog behavior. Do not overwrite unrelated Cowork work. Add early metadata
search to both engines without extra filesystem traversal or Main I/O. New memory is limited to
the existing tree-metadata policy; no unbounded body cache or parallel rebuild.

Code-level Node/compile/lint verification only. No application/E2E, independent review, full build,
installation, release, index deletion, branch change or Git sync. Ral owns live verification.

## Delivery

Both engines reuse the count traversal's metadata for early folder-first Files batches while
priority/scoped Contents runs cooperatively. Cold metadata has separate lifetime/accounting;
committed-index readiness is unchanged. Cancellation drains sibling work and revokes tokens;
final promotion still replaces partial results. Logs distinguish metadata and index-build gates.

BL adopts first-real-snapshot background initialization, coalesced refresh, genuine failure events
and recovery, plus late-ACK fences in Main and Shell. Search's60s idle timer renews only on
validated advancing current-build progress; stale/duplicate/regressive/retired events cannot extend
it, and runtime stop still terminates immediately. Cowork's existing background protocol and
cancellation/lifecycle-bounded query timeout policy were preserved.

Verification: BL background/relay/Shell regressions88/88 (28 new); six targeted source semantic
checks and scoped runtime lint pass. Cold metadata tests6/6 on each copy; BL existing engine/scope/
traversal24/24 and recovery/refresh/diagnostics13/13 pass. Final cross-feature run of BackgroundIndex,
IndexRecovery, ColdMetadataSearch and GlobalSearchEscape passes **BL40/40, Cowork31/31**. It uses
blocked-body SQLite fixtures and fake time, not a live app or the user's index. No full typecheck,
build, E2E, independent review, installation, release or Git operation.

Core checks:11 Node syntax checks and four source-pair/new-test parity checks pass. New test lint
has zero errors/warnings. Core scoped ESLint is not green:97 errors, of which93 are the existing
TypeScript-return-type rule applied to .mjs (also affecting new functions), and4 are pre-existing
unused declarations. No lint configuration or unrelated cleanup was changed.

Human check: with a build containing this fix, open a large Project without deleting its existing
cache. While its initial index is building, search a known filename and folder: Files should arrive
once the metadata enumeration is available, without waiting for all contents. Contents may still
be pending; do not treat this change as faster body indexing or promise instant cold search.
Change queries/close/reopen while indexing, wait for actual ready, and verify final results plus
absence of the old600s initialization false failure. Repeat in Cowork; log first-batch versus
terminal timings separately. Real build errors must remain visible and retryable.
