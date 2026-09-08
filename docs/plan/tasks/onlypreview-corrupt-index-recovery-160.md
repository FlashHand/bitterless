---
id: onlypreview-corrupt-index-recovery-160
scope: Recover explicit corrupt persistent OnlyPreview indexes in BL and matching Cowork code
status: implemented; owner testing pending
depends-on: []
verify: Deterministic corrupt SQLite fixtures, healthy reuse, failure cleanup and scoped tests
---

# Corrupt persistent index recovery

See docs/issues/onlypreview-corrupt-project-index.md for the observed error and read-only evidence.
Keep heavy I/O in the existing fileSearch preload. A corrupt derived cache must not prevent normal
Project browsing or permanently block search. Catch explicit SQLite corruption during open/restore,
close any partially constructed database handle, quarantine exact database/sidecars by rename (not
a4.8GB copy), and rebuild once from project files. Healthy reusable indexes retain the current path.
Quarantine must be bounded, recoverable and not overwrite previous quarantines; non-corruption
errors must still fail visibly. Log initialization stage and SQLite code, not indexed content.

Use small deterministic fixtures to cover malformed database, a valid-header damaged search_tree,
healthy warm reuse, handle cleanup and non-corruption failures. No real profile writes or broad
integrity scans, application/E2E, independent review, install/release or Git operations. Inspect and
port to the matching Cowork search core if it shares the bug. Ral owns live testing.

## Delivery and verification

Added sqlite-recovery.mjs in each preload and connected startup restoration in search-engine.
Classification uses primary SQLite codes11/26; database and-journal/-wal/-shm are renamed into a
unique same-parent quarantine directory. Partial rename failure rolls back without overwriting a
new occupant. Failed handles close before quarantine; a fresh open is attempted once. Existing
sqlite-index constructor already closes a partially initialized database, so it needed no change.
The diagnostic allowlist supports fixed initialization failure stages and numeric SQLite codes.

BL46/46 passes across recovery safety, diagnostics, IndexRecovery, BackgroundIndex and
ColdMetadataSearch; Cowork33/33 corresponding tests. BL additional24/24 covers configuration quiet
period and existing recovery/constructor-close behavior. Three source files and the safety test
match across both applications; node syntax checks pass. Scoped core lint passes with the mjs
TS-return rule disabled and the existing engine candidateTreeEntries-unused baseline excluded.

Actual SQLite fixtures pass3/3 in each app: malformed header(code26), valid header with damaged
search_tree page(code11, other metadata/files readable), and healthy warm reuse. Assertions cover
initialize-to-ready, real Files/Contents queries, byte-identical quarantined originals and no repeat
quarantine on healthy reopening. Tests use only a few small temporary files, not the live4.8GB
cache. New fixture lint passes in BL; Cowork has no eslint command installed, so byte-identical
test parity and BL lint are the evidence there. No live profile or installed app changed.
