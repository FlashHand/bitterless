import { app } from 'electron'
import { join } from 'path'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { migratePiStateFiles, resolveMaestroPiPaths } from '@maestro-main/llm/piAgentDir.service'

const piPaths = (): ReturnType<typeof resolveMaestroPiPaths> =>
  resolveMaestroPiPaths({ appUserDataPath: app.getPath('userData'), legacyStateRoot: maestroDataRoot() })

/**
 * pi's agent dir — app-local, NOT the user's own `~/.pi/agent`.
 *
 * Why this must be ours: `getAgentDir()` drives far more than auth.json. It is where pi looks for
 * the GLOBAL `AGENTS.md` (injected into the session's **system** prompt as `<project_context>`, so
 * it is never compressed), for `SYSTEM.md` / `APPEND_SYSTEM.md` (which REPLACE our system prompt
 * outright), for `skills/`, for `settings.json`, and for `TOOLS_DIR = <agentDir>/bin`. Left at the
 * default, every one of those reads the user's own pi CLI state: on this machine
 * `~/.pi/agent/AGENTS.md` was a git-sync rulebook, and it was reaching the model every turn.
 * See docs/issues/pi-agent-dir-uses-global-home.md.
 */
export const maestroAgentDir = (): string => {
  const paths = piPaths()
  migratePiDirOnce(paths)
  return paths.agentDir
}

// Maestro's own pi/Codex auth store — under userData (NOT ~/.pi/agent), so the app's ChatGPT login
// is self-contained and independent of any local `pi` CLI. AuthStorage.login (browser OAuth)
// writes here; the agents + getLlmConfig read here via BaseAgent's `authPath`.
export const maestroAuthPath = (): string => {
  const paths = piPaths()
  migratePiDirOnce(paths)
  return paths.authFile
}

// `models-store.json` is written beside this file by pi's ModelRuntime (it derives that path from
// dirname(modelsPath)), which is why the migration carries both.
export const maestroModelsPath = (): string => {
  const paths = piPaths()
  migratePiDirOnce(paths)
  return paths.modelsFile
}

/**
 * 2026-09-08 之前 pi 的 auth/models 所在的目录。**只给退役残留清理用。**
 *
 * 为什么它还有意义:那次迁移是 `copyFileSync` 而不是 rename(`migratePiStateFiles` 自己的注释
 * 写着「the old dir is cheap to leave behind」),所以旧目录里那几份同名副本原样留在盘上。
 * 正常读写一律走新路径 —— 这个 accessor 存在只是为了让清理代码够得着那份副本里的凭据。
 */
export const maestroLegacyPiDir = (): string => piPaths().legacyDir

/**
 * Point pi's `getAgentDir()` at our dir, for every code path that does not take an explicit
 * `agentDir`.
 *
 * `getAgentDir()` reads ONLY `process.env.PI_CODING_AGENT_DIR` before falling back to
 * `~/.pi/agent`, and pi freezes `TOOLS_DIR` into a module-level const at its first import — so this
 * MUST run during boot, before the first `await import('@earendil-works/pi-coding-agent')`. Every
 * pi import under src/main is dynamic (verified), so calling it from app startup is early enough;
 * do not move it after the first session is created.
 */
export const configureMaestroPiAgentDir = (): string => {
  const agentDir = maestroAgentDir()
  process.env.PI_CODING_AGENT_DIR = agentDir
  return agentDir
}

let piDirMigrated = false
const migratePiDirOnce = (paths: ReturnType<typeof resolveMaestroPiPaths>): void => {
  if (piDirMigrated) return
  piDirMigrated = true
  try {
    const copied = migratePiStateFiles(paths)
    if (copied.length > 0) console.log(`[maestro] migrated pi state to ${paths.agentDir}: ${copied.join(', ')}`)
  } catch (error) {
    // Never block startup or login on migration; a miss degrades to "log in again".
    console.warn('[maestro] pi state migration skipped:', error)
  }
}
