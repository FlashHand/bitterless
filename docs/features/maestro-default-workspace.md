# Maestro Default Workspace

**Status:** implemented 2026-09-10; owner E2E pending.

Owner decision 2026-09-10 (Ral:「不要区分会话,实际工作的时候 n 个会话都在做一个事情,干脆就搞一个大的
默认工作空间得了」). With no workspace bound to a chat, every workspace tool resolves against **one
shared directory**:

```
~/.bitterless-<runtime profile id>/default-workspace
```

## Why the profile id keys the path

`<runtime profile id>` is the axis that already splits `userData`
(`docs/features/desktop-release-channels.md`), so each edition keeps its own default workspace and
Preview can never write into Production's files — the two hold different real data by design:

| profile id | userData | default workspace |
| --- | --- | --- |
| `production` | `Bitterless` | `~/.bitterless-production/default-workspace` |
| `production-preview` | `Bitterless_PREVIEW` | `~/.bitterless-production-preview/default-workspace` |
| `production-debug` | `Bitterless_DEBUG_PROD` | `~/.bitterless-production-debug/default-workspace` |
| `test-debug` | `Bitterless_DEBUG_DEV` | `~/.bitterless-test-debug/default-workspace` |
| `test-release` | `Bitterless_DEV` | `~/.bitterless-test-release/default-workspace` |

The root resolves through `app.getPath('home')`, not `os.homedir()`, because E2E redirects the home
path (`BITTERLESS_E2E_HOME_DIR`) — a test run must not touch the real `~/.bitterless-*`.

## Contract

- **Ensured, never asked.** `mkdir -p` at boot (`src/main/app.main.ts`, after `configureE2EUserData()`
  and skipped in helper processes) and again on every resolve. "Pick a workspace first" is no longer a
  reachable answer.
- **Not per session.** It replaces the per-chat `<userData>/cowork/chat_workspaces/<chat id>` fallback:
  n chats working on one job were writing into n directories nobody could find again. Old per-chat
  directories are left where they are; nothing is moved.
- **It is the workspace, not a narrow fallback.** `resolveWorkspacePath` — the single door — answers
  with it, so `list_workspace_files`, `search_files`, `read_file`, `write_file`, `create_artifact`, the
  archive tools and `open_workspace_folder` all take it. `WorkspaceArchiveService.resolveWritablePath`
  existed only to give the archive tools a fallback the write tools were denied; it is deleted.
- **An explicit workspace always wins.** Binding one is still a real choice; this is only what
  "nothing chosen" resolves to. Only an explicit reference can go stale, so only that one is cleared
  on a missing directory.
- **Reads and writes share one base.** A relative `read_file` path used to resolve against `~` while a
  write resolved against the workspace, so the agent could write `notes.md` and then fail to read it
  back by that name. Both now resolve against `effectiveWorkspaceRoot` (explicit, else default).
  Absolute reads stay unconfined — the OS remains the gate.
- **The boundary is unchanged.** The default root goes through the same `resolve + relative` and
  `realpath` checks, so `../` still fails as `outside-workspace`.
- **The composer still shows `Choose workspace`.** An unmade choice stays unmade — the chip reports
  what the owner picked, not where the tools landed. Every write already names its absolute
  destination in the reply, which is how the owner finds it.

## Files

| file | role |
| --- | --- |
| `src/main/maestro/files/defaultWorkspace.ts` | `defaultWorkspaceRoot()` + `ensureDefaultWorkspace()` |
| `src/main/maestro/windows/main/workspaceFile.service.ts` | `effectiveWorkspaceRoot()`, `resolveWorkspacePath`, `resolveReadPath` |
| `src/main/maestro/files/workspaceArchive.service.ts` | archive tools now use the host door only |
| `src/main/agent/prompt/maestroSysPrompt.ts` · `src/main/agent/runtime/agentPrompt.ts` | the agent is told writes always have a home |

Cowork carries the same contract against `~/.micromeet-<env>/default-workspace`
(`micromeet-cowork/docs/features/cowork-workspace-files.md` § Default Workspace); the two apps are
deliberately separate roots.
