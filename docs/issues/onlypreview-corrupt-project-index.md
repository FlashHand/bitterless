# OnlyPreview workspace opening fails on a corrupt persistent index

Status: root cause confirmed; recovery implemented, owner testing pending (task160).

Ral reported `OPERATION_FAILED` at 2026-09-08T03:54:57.285Z after clicking the BL workspace.
The matching log is the DEBUG_PROD profile, not the installed PREVIEW profile. The directory
target was accepted at03:54:54.434Z; initialization logged reusable/reconcilable SQLite at
03:54:56.791Z, then failed at03:54:57.279Z before publishing the root listing. The contract masked
the underlying exception as a generic operation failure.

An earlier attempt at03:54:52 also hits a distinct cold-open readiness race. A second explicit
request returns the already allocated host before fileSearch startup finishes; the still-unregistered
authority returns no valid protocol envelope. This is reproducible with actual helper methods and
a delayed ready gate, without HMR. Task161 now serializes host readiness; task160 addresses the
independently confirmed database corruption after startup succeeds.

A read-only query against the existing derived index confirms SQLite error11 (`SQLITE_CORRUPT`):
`database disk image is malformed`. The files/metadata tables remain readable, but iteration of
search_tree fails after14,662 rows. The database is approximately4.8GB. No database, project file,
configuration or installed application was changed for diagnosis.

Fix: recognize only explicit corrupt/not-a-database errors, close failed handles and quarantine
that exact cache database with its sidecars before one clean rebuild in the search preload.
Do not scan/checksum/copy the large database on startup, silently treat every exception as
corruption, or delete the project/configuration. Preserve healthy warm-index reuse. Emit bounded
stage/error diagnostics without file contents. Recover the original data if quarantine fails;
do not loop forever on a fresh build failure. Inspect Cowork for the identical code path and port
the same correction if present. See task160 for verification.

Implemented recovery in both BL and Cowork's matching core; this does not assert that Cowork's
live cache is corrupt. Real small SQLite fixtures reproduce a malformed header and a damaged
search_tree under a valid header. Both recover searchable Files/Contents while retaining damaged
bytes in quarantine. No actual profile database was repaired during this session.

Storage note: a read-only capacity check found about11GiB available on the data volume. Preserving
the approximately4.8GB damaged cache means the new index needs additional space; no project files
or existing caches were deleted to make room. The cause of the original database corruption is
not established by these logs; the confirmed failure is its unhandled restoration error.
