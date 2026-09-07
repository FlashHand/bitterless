---
id: eyes-on-agents-drop-setup-command-096
scope: Remove the Copy setup command action and replace it with a correct, complete wrapper recipe in the guidance note
status: done
depends-on: [eyes-on-agents-claude-title-provenance-095]
verify: focused EyesOnAgents contract/service/render unit tests, Core strict typecheck, UI strict typecheck; no Electron
---

# EyesOnAgents Drop Copy Setup Command

## Objective

Owner verdict, twice (2026-09-04): the **Copy setup command** action task 089 shipped is pointless —
「setup cmd 是这样的有意义么我感觉没意义」. He is right, and it is worse than pointless:

- **It is incomplete in the way that matters.** His real wrapper (`/usr/local/bin/claude2`) also
  `unset`s `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` so the second
  environment authenticates with its **own** Claude login. The emitted snippet does not. A user with
  a shell-level API key who pastes it gets a `claude2` that silently runs as the **first** account —
  defeating the single reason multi-environment exists ("一台机器登录多个 claude").
- **It assumes a shape most setups do not use.** It emits a shell *function* for a profile: a hard
  syntax error in fish and nushell, invisible to non-interactive spawns, and not what the owner
  actually uses (a `PATH` script, which is shell-agnostic and works from anywhere).
- Bitterless cannot install a wrapper anyway; it only ever put text on the clipboard. Shipping a
  subtly-wrong convenience is worse than shipping none.

Remove the action. Put the **correct and complete** recipe in the guidance note, as text to read.

## Required behavior

- Delete the action end to end: the `Copy setup command` button and its handler/copied-state in
  `ClaudeEnvironmentCard.vue`, `copyClaudeEnvironmentSetupCommand` from the renderer store, the
  `EyesOnAgentsApi` member, the XPC handler method, the `EyesOnAgentsService` method, and
  `buildEyesOnAgentsClaudeEnvironmentSetupCommand` /
  `deriveEyesOnAgentsClaudeEnvironmentFunctionName` and their reserved-word/quoting helpers from
  `eyesOnAgents.contract.ts`. Remove `scripts/eyes-on-agents/claude-environment-setup-command.test.mjs`'s
  setup-command tests and its `package.json` wiring **only if** nothing else in that file survives —
  task 091/092's parser and label-derivation tests live there and **must be kept**.
- Remove the i18n keys the deletion orphans (`copySetupCommand`, and `copied` **only** if the
  `/reload-plugins` copy action no longer uses it — check before deleting) from both `en.ts` and
  `zh.ts`, keeping key order identical.
- **Rewrite the guidance note** (`claudeEnvironment.guidance`) so it carries what a user actually
  needs, in both languages. It must state: each environment needs its own hook install; the command
  used for that environment must set `CLAUDE_CONFIG_DIR` before invoking `claude`; **and** that it
  should clear `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` so the
  environment uses its own login rather than inheriting a shell-level credential. Keep it short
  enough for the existing aside — if the full recipe does not fit as prose, prefer a compact
  `PATH`-script form over a shell function, because that shape works from any shell and from
  non-interactive callers.
- Do not reintroduce a picker, a file writer, or any "install this for me" affordance. Bitterless
  states the requirement; the user owns their shell.

## Non-goals

- Detecting whether a wrapper already exists, or validating the user's shell configuration. Task
  090's per-environment plugin probe already answers "is this directory set up"; the wrapper is
  outside what Bitterless can observe.
- Changing anything about the environment list, the inline path editor, or the plugin probe.
- Reverting task 091's `parseEyesOnAgentsAddClaudeEnvironmentParams` /
  `deriveEyesOnAgentsClaudeEnvironmentLabel` — those are the add flow and stay.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`, `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`, `src/main/xpc/eyesOnAgents.handler.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeEnvironmentCard.vue`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/claude-environment-setup-command.test.mjs`,
  `scripts/eyes-on-agents/claude-environment-render.test.mjs`,
  `scripts/eyes-on-agents/ui-source.test.mjs`, `package.json` (test wiring, only if a file is removed)
- `docs/plan/tasks/eyes-on-agents-claude-env-copy-setup-089.md` (record that it was removed and why),
  `docs/features/eyes-on-agents-claude-multi-environment.md`,
  `docs/integrations/eyes-on-agents-layout.md`, `docs/plan/backlog.md` (drop the now-moot 089 entries)

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`
- `yarn eslint` on each touched file — no new errors.
- `ui-source.test.mjs` asserts things about this action and about the `configDirectory` exclusivity
  file list. Update them to the post-removal truth; **do not** weaken the negative exclusivity
  assertion into a positive match (task 091's review caught that failure mode once already).
- Confirm no orphaned i18n key and no dead export remains: grep for `setupCommand`,
  `SetupCommand`, `FunctionName` across `src/` and `scripts/` and report the result.
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite.
- Two pre-existing failures are not this task's: the deterministic `ui-source.test.mjs` bundle-id
  assertion, and the ~6/10 flaky `thread-card-open-capability.test.mjs` right-click test.

## Implementation evidence

Implemented by the orchestrator; the assigned subagent died on a session limit before it edited
anything.

### Removed

- `ClaudeEnvironmentCard.vue` — the per-row button, `setupCommandCopiedId`, `canCopySetupCommand`,
  `setupCommandCopyLabel`, `handleCopySetupCommand` (37 lines).
- `eyesOnAgents.store.ts` — `copyClaudeEnvironmentSetupCommand`.
- `eyesOnAgents.type.ts` — the `EyesOnAgentsApi` member and its comment block.
- `eyesOnAgents.handler.ts` — the XPC method.
- `eyesOnAgents.service.ts` — the service method and its
  `buildEyesOnAgentsClaudeEnvironmentSetupCommand` import.
- `eyesOnAgents.contract.ts` — `buildEyesOnAgentsClaudeEnvironmentSetupCommand`,
  `deriveEyesOnAgentsClaudeEnvironmentFunctionName`, and the six now-dead module constants
  (`…FUNCTION_NAME_FALLBACK/UNSAFE_PATTERN/UNDERSCORE_RUN_PATTERN/LEADING_DIGIT_PATTERN`,
  `…SINGLE_QUOTE_PATTERN/ESCAPE`, the reserved-word Set, and the `no-control-regex`-suppressed
  comment-blank pattern — so that eslint suppression is gone with the code that needed it).
- i18n `copySetupCommand` from both catalogs.

### Kept, deliberately

- `claudeBridge.copied` — still used by `ClaudeObservationCard.vue`'s `/reload-plugins` copy. Checked
  before deleting.
- `deriveEyesOnAgentsClaudeEnvironmentLabel`, `parseEyesOnAgentsAddClaudeEnvironmentParams`,
  `parseEyesOnAgentsSetClaudeEnvironmentDirectoryParams` — tasks 091/092's add and change-directory
  flows. They shared this feature's test file, which is the trap the contract warned about.

### Test file renamed

`claude-environment-setup-command.test.mjs` → `claude-environment-params.test.mjs` (its 13
setup-command tests removed, its 3 add/change-directory parser tests kept, and its dead service
harness / wrapper constants / unused imports dropped rather than left behind). `package.json`'s
`test:eyes-on-agents:claude` wiring updated. `claude-environment-render.test.mjs` lost its 3
setup-command render tests and the `copySetup` store double.

### Two over-deletions, caught and reverted

Regex-based removal ate live code twice — first the Add-environment button and the entire add form
(125 template lines), then a core render test ("one row renders per configured environment") — both
because a lazy `(?:[^\n]*\n)*?` prefix let the match start at an earlier `<a-button` / `await test(`.
Both were reverted via `git checkout --` and redone with exact-string and line-boundary edits. The
lesson is recorded here because the same shape will recur: for block deletion in these files, anchor
on the full literal or on computed line numbers, never on a regex that can slide backwards.

### New guidance copy

en: "Each environment needs its own hook install: point Bitterless at its CLAUDE_CONFIG_DIR, then
Install. The command you use to start that environment must set CLAUDE_CONFIG_DIR before invoking
claude, and clear ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN — otherwise it
inherits your shell credential and signs in as the wrong account."

zh: 「每个环境都要单独装一次 hook:先把 Bitterless 指向它的 CLAUDE_CONFIG_DIR,再点安装。启动该环境用的
命令必须在调用 claude 之前设置 CLAUDE_CONFIG_DIR,并清掉 ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN、
CLAUDE_CODE_OAUTH_TOKEN —— 否则它会继承 shell 里的凭据,用另一个账号登录。」

The credential clause is the substance: it is the step the removed snippet omitted, and the reason
the snippet was worse than nothing.

### Verification

- `yarn typecheck:eyes-on-agents:core` / `:ui` — 0 errors.
- `yarn test:eyes-on-agents:claude` — passes; the renamed params file 3/3.
- `yarn test:eyes-on-agents:ui` — 102 tests, 101 pass, 1 fail (the logged deterministic bundle-id
  assertion). Measured the HEAD baseline first — 105 tests — and this task removes exactly 3, so
  102 is arithmetic, not a lost test.
- i18n key order verified identical between `en.ts`/`zh.ts` (22 keys each) and `copySetupCommand`
  confirmed absent from both.
- `grep setupCommand|SetupCommand|FunctionName` over `src/` and `scripts/`: no hits outside the
  vendored drawio bundle's unrelated `getFunctionName`.
- `ui-source.test.mjs` needed no change — it had no setup-command assertions, and the
  `configDirectory` exclusivity file list is unaffected (the card still handles directories for the
  add and change-directory flows). The negative exclusivity form is untouched.
- Electron, packaged builds, Playwright and `test:e2e:*` — not run.
