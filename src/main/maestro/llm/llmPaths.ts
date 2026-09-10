import { app } from 'electron'
import { join } from 'path'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import {
  clearAuthProvider,
  legacyAuthFilesFor,
  mergeAuthProviders,
  migratePiStateFiles,
  resolveMaestroPiPaths
} from '@maestro-main/llm/piAgentDir.service'

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
//
// **每次调用都跑一次逐 provider 的前向合并**,不是一次性的:`migratePiDirOnce` 的 copy-if-absent
// 补不上"目标是 pi 自己造出来的 `{}` 空壳"这种情形(pi 的 `AuthStorage` 构造时就会写那个空壳),
// 而那正好让"登录成功但回合说没登录"变成永久状态。合并只填目标缺的 provider,已有的绝不覆盖。
// 契约:`docs/issues/codex-login-writes-a-store-the-turn-never-reads.md`。
export const maestroAuthPath = (): string => {
  const paths = piPaths()
  migratePiDirOnce(paths)
  mergeLegacyAuthOnce(paths.authFile)
  return paths.authFile
}

/** 同一个 userData 下的旧库 auth.json(**不跨 edition**,理由见 `legacyAuthFilesFor`)。 */
export const maestroLegacyAuthFiles = (): string[] => legacyAuthFilesFor(piPaths().authFile)

/**
 * 退出登录时把某个 provider 从目标**和旧库**里一起删掉。
 *
 * 少了旧库那一半,`maestroAuthPath()` 的前向合并会在下一次就绪探测时把凭据复活 ——
 * 于是 Logout 看起来像没反应(cowork 踩过,注释在 `clearCoworkAuthProvider`)。
 */
export const clearMaestroAuthProvider = (provider: string): string[] => {
  const paths = piPaths()
  migratePiDirOnce(paths)
  const cleared = clearAuthProvider({
    provider,
    authFile: paths.authFile,
    legacyAuthFiles: legacyAuthFilesFor(paths.authFile)
  })
  if (cleared.length > 0) console.log(`[maestro] cleared ${provider} credential from ${cleared.length} store(s)`)
  return cleared
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

/**
 * 合并本身是幂等的,但**每次 `maestroAuthPath()` 都读两个文件**没必要 —— 一个进程里补过一次就够,
 * 后续的登录直接写目标文件(见 `codexPaths.ts` 已改指 `.pi`)。
 * 与 `piDirMigrated` 分开记:那一个是目录级的一次性搬运,这一个是凭据级的补齐,失败语义不同。
 */
let legacyAuthMerged = false
const mergeLegacyAuthOnce = (authFile: string): void => {
  if (legacyAuthMerged) return
  legacyAuthMerged = true
  const merged = mergeAuthProviders({ authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) })
  if (merged.length > 0) console.log(`[maestro] merged credential(s) forward into ${authFile}: ${merged.join(', ')}`)
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
