import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';

/**
 * The one shared default workspace — where every workspace tool works when no directory is bound
 * (Ral 2026-09-10:「不要区分会话,实际工作的时候 n 个会话都在做一个事情,干脆就搞一个大的默认工作空间
 * 得了」). See docs/features/maestro-default-workspace.md.
 *
 * It replaces the per-chat `<userData>/cowork/chat_workspaces/<chat id>` fallback: n chats working on
 * one job were writing into n directories nobody could find again.
 *
 * The path is keyed by the RUNTIME PROFILE ID, the same axis that already splits `userData`
 * (`Bitterless` / `Bitterless_PREVIEW` / `Bitterless_DEBUG_PROD` / …), so Preview and Production can
 * never write into each other's files — they hold different real data by design.
 *
 * `app.getPath('home')`, not `os.homedir()`: E2E redirects the home path, and a test run must not
 * write into the real `~/.bitterless-*`.
 */
export const defaultWorkspaceRoot = (): string =>
  join(app.getPath('home'), `.bitterless-${getRuntimeProfile().id}`, 'default-workspace');

/** `mkdir -p` the default workspace and return it. Idempotent — called at boot and on every resolve. */
export const ensureDefaultWorkspace = (): string => {
  const root = defaultWorkspaceRoot();
  mkdirSync(root, { recursive: true });
  return root;
};
