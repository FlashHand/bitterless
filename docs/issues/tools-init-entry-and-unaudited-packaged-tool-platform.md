# `yarn tools:init` is the initialization entry, and the packaged tool platform is never audited

Status: implemented; owner initialization/package verification pending · 2026-09-10

## Observed behavior

Two problems in the same seam, both about "which platform's tools are in this package".

**1. The entry point diverges from Cowork.** Bitterless and `micromeet-cowork` ship the same four
pinned CLIs (`bun` 1.3.14 · `rg` 14.1.1 · `fd` 10.5.0 · `ouch` 0.8.2, identical digests — Cowork's
`prepare-bundled-runtimes.cjs` header records that the two repositories independently downloaded the
same bytes), keep the same three-platform store, and stage exactly one platform per package. Only the
command differed: Cowork initializes with `yarn tools:init`, Bitterless with `yarn external-tools:init`.
Owner instruction 2026-09-10: one name, `yarn tools:init`, in both repositories.

**2. Nothing audits the packaged tool platform.** `verify-stage` proves `build/maestro-tools` before
Electron Builder runs, and `desktopPackage.audit.cjs` proves the application executable and the
unpacked `better_sqlite3.node` against the target platform/arch — but it never looked at
`Resources/maestro-tools`. So a package assembled from a staging directory belonging to another
target (a manual `externalTools.cjs stage mac_arm` followed by `signedBuild.js --win`, an interrupted
`_package:*` that skipped its stage step, or a `--dir` build reused across targets) ships the wrong
platform's binaries and **every existing gate stays green**. The failure is invisible until a user
launches the app and the shipped `bun` / `anydoc.node` cannot execute.

`_package:mac_arm` / `_package:mac_x64` / `_package:win` do pair stage + verify-stage today, so this
is a missing gate rather than an observed shipped defect.

## Required behavior

- `yarn tools:init` initializes all three platform stores (`external_tools/mac_arm`,
  `external_tools/mac_intel`, `external_tools/win`) on any supported host, independent of the host's
  own platform. `tools:stage` / `tools:verify` follow the same naming, and the old
  `external-tools:*` aliases are gone rather than kept alongside them.
- The packaged-application audit derives the target from the application executable's own Mach-O/PE
  header (never from a script flag) and asserts `Resources/maestro-tools`:
  - carries exactly that platform's payload set — no stray, and no file whose name belongs to another
    store; a name staged by both mac stores reports both owners rather than guessing one;
  - every shipped binary (`bun` · `rg` · `fd` · `ouch` · `anydoc/anydoc.node`) is that platform's
    format and architecture, read from the file header. Not from a digest — code signing rewrites
    every Mach-O listed under `mac.binaries`. Not by execution — a win64 package built on macOS
    cannot run here, and that is exactly the case a name-only check cannot cover;
  - the AnyDoc JavaScript bundle is present and complete (its bytes stay pinned one step earlier, by
    `tools:verify`, which runs immediately before Electron Builder);
  - `external-tools.manifest.json` declares that same platform.
- Failing any of it aborts with the initialization/stage instruction rather than publishing.

## Acceptance

- `scripts/maestro/externalTools.test.mjs` asserts the `tools:init` / `tools:stage` / `tools:verify`
  contract, that the renamed script does not linger, and that the store is those three platforms.
- `scripts/package/desktopPackageAudit.test.mjs` covers six cases: a correct package reports its store
  platform; one tool carrying another platform's bytes fails; a package staged from the wrong store
  entirely fails; another platform's file name left behind fails; a manifest naming another platform
  fails; never-staged tools fail with the initialization instruction.
- The gate runs from Electron Builder's `afterPack`, so it fires on every packaging run, not only from
  `scripts/publish.js`.

## Verified (2026-09-10, mac_arm host)

| 项 | 结果 |
| --- | --- |
| `yarn tools:init` | 三个 store 全部 `already initialized and verified`,零下载 |
| `yarn tools:verify`(mac_arm) | `staged tools verified for mac_arm` |
| `node --test scripts/maestro/externalTools.test.mjs` | 10/10 |
| `node --test scripts/package/desktopPackageAudit.test.mjs` | 28/29 —— 唯一的红是**既有**的:`afterPack` 那个用例传的合成 context 没有 `packager`,而 `onlyPreviewAssociations.audit.cjs:46` 读 `context.packager.appInfo`,与本次改动无关 |

未跑:真实三平台打包(需要另一台设备 / Windows 侧),owner 自行验收。
