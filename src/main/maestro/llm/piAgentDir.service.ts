import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Where pi's agent state lives, and the one-time move off the pre-2026-09-08 layout.
 *
 * Electron-free on purpose: the decisions worth testing here are "which dir" and "what does the
 * migration copy", and both become untestable the moment this module reaches for `app.getPath()`.
 * `llmPaths.ts` is the thin Electron-bound wrapper.
 */

/** pi's own `CONFIG_DIR_NAME`. Cowork uses the same `<userData>/.pi` shape. */
export const PI_DIR_NAME = '.pi';

/** 2026-09-08 之前 pi 的 auth/models 目录名(在 `LEGACY_MAESTRO_STATE_DIR` 之下)。 */
export const LEGACY_PI_DIR_NAME = 'pi';

/**
 * `maestroDataRoot()` 的末段。登录侧至今还在往 `<userData>/cowork/pi/` 写,所以这个"legacy"目录
 * 其实是活的 —— 名字保留是因为它就是那个历史位置,而 `legacyAuthFilesFor()` 要用它推路径。
 */
export const LEGACY_MAESTRO_STATE_DIR = 'cowork';

/**
 * Files pi keeps directly in the agent dir.
 *
 * `bin/` is deliberately NOT here: it is pi's `TOOLS_DIR`, and anything inside it wins over PATH,
 * so copying a previously downloaded ripgrep forward would re-create the shadowing that an empty
 * `bin` exists to prevent.
 */
export const PI_STATE_FILES = ['auth.json', 'models.json', 'models-store.json', 'settings.json'] as const;

export interface MaestroPiPaths {
  /** pi's `agentDir` — global AGENTS.md / SYSTEM.md / skills / settings / managed `bin`. */
  agentDir: string;
  authFile: string;
  modelsFile: string;
  /** Pre-2026-09-08 location of auth/models, kept only as a migration source. */
  legacyDir: string;
}

export const resolveMaestroPiPaths = (input: {
  appUserDataPath: string;
  /** `maestroDataRoot()` — the subsystem dir that used to hold `pi/`. */
  legacyStateRoot: string;
}): MaestroPiPaths => {
  const agentDir = join(input.appUserDataPath, PI_DIR_NAME);
  return {
    agentDir,
    authFile: join(agentDir, 'auth.json'),
    modelsFile: join(agentDir, 'models.json'),
    legacyDir: join(input.legacyStateRoot, 'pi')
  };
};

/**
 * Copy, not rename: a half-finished rename would leave neither dir usable, and the old dir is cheap
 * to leave behind. Target entries always win, so a second run copies nothing.
 *
 * @returns the file names actually copied — empty when there is nothing to do.
 */
export const migratePiStateFiles = (input: { legacyDir: string; agentDir: string }): string[] => {
  if (!existsSync(input.legacyDir)) return [];
  const copied: string[] = [];
  for (const name of PI_STATE_FILES) {
    const from = join(input.legacyDir, name);
    const to = join(input.agentDir, name);
    if (!existsSync(from) || existsSync(to)) continue;
    mkdirSync(input.agentDir, { recursive: true });
    copyFileSync(from, to);
    copied.push(name);
  }
  return copied;
};

/**
 * **凭据的前向合并** —— 这一段是 `migratePiStateFiles` 的 copy-if-absent **补不上的那个洞**。
 *
 * 洞长这样(2026-09-10 实测,`docs/issues/codex-login-writes-a-store-the-turn-never-reads.md`):
 * pi 自己的 `AuthStorage.ensureFileExists()` 在文件不存在时写字面量 `"{}"`,而它由构造函数触发 ⇒
 * **只要构造过一次指向 `.pi/auth.json` 的 ModelRuntime,那个空壳就诞生了**。此后上面那句
 * `existsSync(to)` 认为"已迁移",而登录侧仍在写旧库 —— 于是界面说登录成功、回合说没登录、重登无效,
 * 而且**永久**如此。文件级的"目标优先"在这里是错的粒度:要的是**逐 provider** 的目标优先。
 *
 * 所以这个函数每次调用都跑(不是一次性的),只填目标**缺**的 provider,已有的绝不覆盖。
 * @returns 实际补进去的 provider id;没动就是空数组。
 */
export const mergeAuthProviders = (input: { authFile: string; legacyAuthFiles: string[] }): string[] => {
  const merged: string[] = [];
  try {
    const current = readAuthRecord(input.authFile);
    const next = { ...current };
    for (const source of input.legacyAuthFiles) {
      if (source === input.authFile) continue;
      for (const [provider, credential] of Object.entries(readAuthRecord(source))) {
        // 目标已有这个 provider ⇒ 一个字都不动。旧库里那份可能是别的账号、也可能更旧。
        if (next[provider]) continue;
        if (!credential || typeof credential !== 'object') continue;
        next[provider] = credential;
        merged.push(provider);
      }
    }
    if (merged.length === 0) return [];
    mkdirSync(dirname(input.authFile), { recursive: true });
    writeAuthRecord(input.authFile, next);
    return merged;
  } catch {
    // 合并永远不能挡住启动或登录 —— 漏掉的表现是"再登一次",而诊断会把缺谁说清楚。
    return [];
  }
};

/**
 * 权威的退出登录:把 `provider` 从目标**和每一个旧库**里删掉。
 *
 * 不连旧库一起清,`mergeAuthProviders` 会在下一次就绪探测时把它**复活**,于是 Logout 看起来像没反应
 * (cowork 的 `clearCoworkAuthProvider` 注释里记的就是这个坑)。
 * @returns 实际改动过的文件路径。
 */
export const clearAuthProvider = (input: {
  provider: string;
  authFile: string;
  legacyAuthFiles: string[];
}): string[] => {
  const cleared: string[] = [];
  for (const file of [input.authFile, ...input.legacyAuthFiles]) {
    try {
      if (!existsSync(file)) continue;
      const parsed = readAuthRecord(file);
      if (!(input.provider in parsed)) continue;
      delete parsed[input.provider];
      writeAuthRecord(file, parsed);
      cleared.push(file);
    } catch {
      // 一个坏掉/被锁住的旧库文件不能挡住退出登录。
    }
  }
  return cleared;
};

/**
 * 给定回合读的那份 auth.json,推出**同一个 userData 下**的旧库副本。
 *
 * 关系是固定的:`<root>/.pi/auth.json` ↔ `<root>/<LEGACY_MAESTRO_STATE_DIR>/pi/auth.json`,
 * 所以从路径本身就能推出来,不需要把 Electron 或 `maestroDataRoot()` 拖进这个 Electron-free 模块。
 *
 * **刻意不跨 edition。** cowork 那边会跨 channel 合并(「login survives a dev↔prod switch」),
 * 这里只在同一个 userData 里合 —— 理由是实测那台机器:PREVIEW 是一个账号、DEBUG_PROD 是另一个,
 * 跨 edition 合并会把**别的账号**塞进一个本来没有凭据的 edition,而那正是被报上来的抱怨本身。
 */
export const legacyAuthFilesFor = (authFile: string): string[] => {
  const agentDir = dirname(authFile);
  const userDataRoot = dirname(agentDir);
  return [join(userDataRoot, LEGACY_MAESTRO_STATE_DIR, LEGACY_PI_DIR_NAME, 'auth.json')].filter(
    (path) => path !== authFile
  );
};

const readAuthRecord = (file: string): Record<string, unknown> => {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

/**
 * `mode: 0o600` 与 pi 自己写 auth.json 的口径一致 —— 合并/清除不该顺手把凭据文件放宽。
 *
 * `chmodSync` 不是多余的:`writeFileSync` 的 `mode` **只在创建文件时生效**,重写一份已存在的
 * 0644 凭据文件不会收紧它(守卫实测到 644)。既然这一步本来就在重写它,就顺手把权限收回来。
 * chmod 失败不阻断(文件可能不归本进程所有)—— 合并成功比权限收紧更重要,而后者只是尽力而为。
 */
const writeAuthRecord = (file: string, record: Record<string, unknown>): void => {
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // 权限收紧是尽力而为,不该把一次成功的合并变成失败。
  }
};
