import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where pi's agent state lives, and the one-time move off the pre-2026-09-08 layout.
 *
 * Electron-free on purpose: the decisions worth testing here are "which dir" and "what does the
 * migration copy", and both become untestable the moment this module reaches for `app.getPath()`.
 * `llmPaths.ts` is the thin Electron-bound wrapper.
 */

/** pi's own `CONFIG_DIR_NAME`. Cowork uses the same `<userData>/.pi` shape. */
export const PI_DIR_NAME = '.pi';

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
