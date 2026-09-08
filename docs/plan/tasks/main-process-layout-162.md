---
id: main-process-layout-162
scope: BL main-process directory restructure — drop claudeSubscription, hoist agent, introduce modules/ and miniapps/
status: implemented; owner testing pending
depends-on: []
verify: typecheck (baseline-diffed), scoped maestro check scripts, yarn build, ripgrep for dangling references
---

# Main-process layout refactor

## Objective and context

Ral is restructuring BL and Cowork main processes toward the same shape. Cowork already carries
`src/main/agent/` and `src/main/modules/`; BL still nests its agent runtime under
`src/main/maestro/agent/` and has no `modules/` or `miniapps/` layer. Cowork's OnlyPreview main
process moves under `src/main/miniapps/onlypreview/` in the sibling task; BL follows so the two
trees line up.

The same change removes the Claude subscription (sub2api) feature outright. Ral confirmed the full
cut: the local HTTP responses server, the Claude CLI auth/exec chain, its XPC handler, its
Workbench view and store, its tests, and the Maestro `Local` LLM provider that exists only to point
pi at that server.

## Scope

### 1. Remove claudeSubscription

Delete:

- `src/main/claudeSubscription/` (20 files)
- `src/shared/claudeSubscription/` (contract, schema, redaction, index)
- `src/main/xpc/claudeSubscription.handler.ts` and its side-effect import in `src/main/xpc/xpc.helper.ts`
- `tests/claudeSubscription/`
- `src/renderer/maestro/workbench/src/claudeSubscription.store.ts`
- `src/renderer/maestro/workbench/src/views/WorkbenchSub2ApiView.vue`

Unwire:

- `src/main/app.main.ts` — `claudeSubscriptionRuntime` start/stop
- `src/main/maestro/llm/maestroLlm.service.ts` — snapshot read, `LOCAL_LLM_PROVIDER` branches, `syncLocalClaudeProviderModels`
- `src/main/maestro/llm/llmModels.ts` — `LOCAL_LLM_PROVIDER`, its provider/model catalog entries, default preset, label and alias mapping
- `src/main/maestro/llm/localClaudeProvider.ts` — delete
- Workbench nav / Control app: Sub2Api route, snapshot-changed subscription
- `src/renderer/common/i18n/{en,zh}.ts` — the sub2api key groups

`src/main/codex/codexResponses.upstream.ts` is the one file that looked like collateral and is not:
it borrows `ClaudeBridgePayload`, `ClaudeDecision` and `ClaudeNormalizedCodexTool` from the shared
contract, so the first plan was to relocate those three types. Tracing its consumers settled it the
other way — `claudeResponses.server`, `claudeResponses.translator` and `claudeSubscription.runtime`
are its **only** callers. It is the sub2api server's Codex upstream, not part of the Codex proxy, so
it is deleted with the rest and no type needs a new home. Everything else under `src/main/codex/`
(`codexPaths`, `codexProxy.service`, `codexRuntime.service`, the credential chain) has live consumers
in Translator, Coin and modelProvider and stays.

### 2. Hoist the agent runtime

`src/main/maestro/agent/` → `src/main/agent/`. Agents are not Maestro-specific; Cowork already
places them at `src/main/agent/`.

Import surface: every consumer uses the `@maestro-main/agent/...` alias, which becomes
`@main/agent/...`. Relative imports inside the subtree (`../hostToolCatalog`,
`../steering/steeringPolicy`) stay valid because the whole subtree moves together. Imports the
subtree makes *outward* (`@maestro-main/llm/...`, `@maestro-shared/...`) keep pointing at Maestro
and are unchanged. Twelve `scripts/maestro/check-*.mjs` guards read the files by literal path
(`main/maestro/agent/...`) and must be repointed.

### 3. Introduce modules/ and miniapps/

Create `src/main/modules/` and `src/main/miniapps/`, then move `src/main/onlypreview/` →
`src/main/miniapps/onlypreview/`. `modules/` stays empty for now (`.gitkeep`); it is the landing
zone for the next step of the restructure, which this task does not perform.

Import surface: `@main/onlypreview/...` → `@main/miniapps/onlypreview/...`; literal-path readers in
`scripts/` and `tests/` follow.

## Non-goals

- No behavior change to OnlyPreview, Maestro, Codex or the agent runtime. Every move is
  path-only; a file's contents change only where an import specifier or a removed symbol forces it.
- Nothing is moved *into* `modules/` here.
- No Electron E2E.

## Verification

`yarn typecheck` reports pre-existing errors on this branch, so the check is a diff against
`git archive HEAD`, not an absolute zero. Then `yarn build`, the `scripts/maestro/check-*.mjs`
guards that this task repoints, and a ripgrep sweep proving no `claudeSubscription`,
`@maestro-main/agent` or `@main/onlypreview` reference survives.

## Delivered

Removal, hoist and the `miniapps/` move all landed as planned, plus three repairs the plan did not
anticipate:

- **`src/main/codex/codexResponses.upstream.ts` deleted** rather than kept — see the reasoning above.
- **The Maestro alias boundary had to learn the new shape.** `scripts/maestro/_harness.mjs` forbids
  host aliases (`@main/…`) inside Maestro's tree. Hoisting `agent/` out of that tree means Maestro
  code now reaches it through exactly such an alias, by design. Rather than list each of the eight
  consumer files — a second copy of the import graph — the boundary takes a prefix allowlist holding
  `@main/agent/`. `resolveMaestroPath`, and the two scripts carrying their own copy of that helper
  (`check-inject-button`, `check-integration-target`), resolve `main/agent/…` at the host root
  instead of injecting the `maestro` segment.
- **Fifteen `scripts/maestro/check-*.mjs` module resolvers** knew `@maestro-main/` and
  `@maestro-shared/` but not `@main/`, so any check that loads an agent module failed to resolve it.
  Each gained one `@main/` line.

## Verification

Ran on `dev/next`, whose working tree already carried unrelated in-flight edits from other sessions,
so every result below is a **diff against a `git archive HEAD` baseline**, not an absolute number.

- **Type-check** (`yarn typecheck`, per-surface). `main`: 63 diagnostics vs 68 at HEAD; comparing by
  (file, code, message) with paths remapped, this change introduces **zero** new diagnostics and
  removes the three that lived in `claudeResponses.translator.ts`. The three that appear "new" in
  `onlyPreviewPreviewRegion.service.ts` are the same three errors upgraded from `TS2741` to `TS2739`
  by another session's edit to `onlyPreview.types.ts`. `renderer/maestro`: **zero** new, one removed.
- **Build**: `yarn build` succeeds.
- **Maestro alias boundary**: 19 violations vs 29 at HEAD — zero new, ten removed. (The check was
  already red at HEAD; it is less red now.)
- **`scripts/maestro/check-*.mjs`**: same pass/fail profile as HEAD. Two exceptions, neither ours:
  `check-chat-composer` fails on another session's `ChatPanel.less` edit, and `check-startup-settings`
  now fails on a content assertion that HEAD reached only after its `@shared/claudeSubscription`
  import was made resolvable — confirmed by patching the baseline's resolver, where it fails
  identically.
- **`yarn test:onlypreview`**: the decisive check. Replaying *only* the two directory moves and their
  reference rewrites onto a clean HEAD copy gives 913 tests, 910 pass, and the **same three**
  pre-existing failures as HEAD itself — the restructure causes no test regression. The live working
  tree shows 991/978/13 because other sessions added 78 tests and ten failures with them (800-line
  budget assertions, `ChatPanel`, `installControlLinkPolicy` mocks).
- **`tests/maestro`**: 103/90/13 vs 73/73/0 at HEAD. All 13 are in `maestroChatLayout.test.mjs` and
  `maestroNativeViewBounds.test.mjs`, both modified by another session; the failures are
  `TypeError: webContents.setWindowOpenHandler is not a function` from that session's new
  `installControlLinkPolicy`, with no module-resolution error among them.
- **Lint**: the twelve files this task edited carry 20 errors, identical to HEAD (18 pre-existing
  `no-empty` in `app.main.ts`, 2 in `eyesOnAgents.handler.ts`).
- **Not run**: Electron E2E, per the repo rule against launching it unprompted.
