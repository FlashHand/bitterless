import { app, session } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { xpcMain } from 'electron-xpc/main';
import { CoachSettingsService } from '@maestro-main/settings/coachSettings.service';
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot';
import { mainSafeStorage } from '@main/security/safeStorage.runtime';
import { ZELLIJ_STATE_EVENT, type ZellijSnapshot } from '@shared/zellij/zellij.type';
import { ZellijConfigService, resolveZellijConfigFile } from './zellijConfig.service';
import { ZellijProcessService } from './zellijProcess.service';
import { ZellijTokenService } from './zellijToken.service';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';
import { resolveZellijPort, zellijOriginForPort } from './zellijPort.service';
import { resolveZellijSessionName, zellijSessionUrl } from './zellijSession.service';
import type { ZellijOwnedProcess } from './zellijRuntime.type';

/**
 * Resolved once per process, not per call: the profile is fixed for the process lifetime, and a
 * value that could drift mid-run would let the navigation allowlist and the loaded URL disagree.
 * Memoized rather than computed at module load so an invalid override throws where a caller can
 * report it, not during import.
 */
let resolvedPort: number | null = null;

export const zellijPort = (): number => {
  if (resolvedPort === null) resolvedPort = resolveZellijPort(getRuntimeProfile().id);
  return resolvedPort;
};

export const zellijOrigin = (): string => zellijOriginForPort(zellijPort());

/**
 * The URL a terminal view loads: the origin PLUS this SURFACE's session name.
 *
 * Loading the bare origin is what made the web client ask for a session name on every open — it
 * picks the session from the path, and an empty path means "none chosen yet". Keying the name on the
 * surface rather than the profile is what makes a second terminal a second session instead of a
 * second view onto the first one's panes.
 */
export const zellijTerminalUrl = (surfaceId: string): string =>
  zellijSessionUrl(zellijOrigin(), resolveZellijSessionName(getRuntimeProfile().id, surfaceId));

export const ZELLIJ_PARTITION = 'persist:bitterless-zellij';

const binaryPath = (): string => {
  if (process.platform !== 'darwin' && process.platform !== 'win32')
    throw new Error('unsupported-platform');
  const binary = process.platform === 'win32' ? 'zellij.exe' : 'zellij';
  const file = app.isPackaged
    ? join(process.resourcesPath, 'maestro-tools', binary)
    : join(app.getAppPath(), 'build', 'maestro-tools', binary);
  if (!existsSync(file)) throw new Error('binary-missing');
  return file;
};

const runCli = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(binaryPath(), args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('operation-failed'));
    }, 15_000);
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8');
      if (stdout.length > 64 * 1024) {
        child.kill();
        finish(new Error('operation-failed'));
      }
    });
    // Consume diagnostics without forwarding config paths or credentials into logs/IPC.
    child.stderr.resume();
    child.once('error', () => finish(new Error('operation-failed')));
    child.once('exit', (code) => finish(code === 0 ? undefined : new Error('operation-failed')));
  });

const spawnServer = (args: string[]): ZellijOwnedProcess => {
  const child = spawn(binaryPath(), args, { shell: false, windowsHide: true, stdio: 'ignore' });
  let ended = false;
  let stopped = false;
  const callbacks = new Set<() => void>();
  const exited = (): void => {
    ended = true;
    for (const callback of callbacks) callback();
  };
  child.once('exit', exited);
  child.once('error', exited);
  return {
    exited: () => ended,
    onExit: (callback) => {
      callbacks.add(callback);
      if (ended) callback();
    },
    stop: async () => {
      if (ended || stopped) return;
      stopped = true;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          resolve();
        };
        child.once('exit', done);
        const timer = setTimeout(() => {
          if (!ended) child.kill('SIGKILL');
          resolve();
        }, 2_000);
        if (ended) done();
      });
    }
  };
};

export const zellijTerminalSession = (): Electron.Session =>
  session.fromPartition(ZELLIJ_PARTITION);

let runtime: ZellijProcessService | null = null;

/**
 * A Set, not a single slot. This used to be `stateListener = listener`, which meant the SECOND
 * subscriber silently unsubscribed the first — the first surface then never saw another
 * ready/error transition, so it neither built nor tore down its terminal again. That is a
 * silent-corruption failure, not a crash, and it becomes reachable the moment a second surface
 * exists. Returning a disposer is what lets a surface unsubscribe when it is torn down.
 */
const stateListeners = new Set<(snapshot: ZellijSnapshot) => void>();

export const subscribeZellijState = (
  listener: (snapshot: ZellijSnapshot) => void
): (() => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};

export const getZellijRuntime = (): ZellijProcessService => {
  if (runtime) return runtime;
  const settings = new CoachSettingsService(maestroDataRoot());
  const token = new ZellijTokenService(join(app.getPath('userData'), 'zellij', 'web-token.enc'), {
    persistent: app.isPackaged && import.meta.env.VITE_MODE === 'release',
    available: () => mainSafeStorage.isEncryptionAvailable('zellij'),
    encrypt: (value) => mainSafeStorage.encryptString(value, 'zellij'),
    decrypt: (bytes) => mainSafeStorage.decryptString(bytes, 'zellij')
  });
  const config = new ZellijConfigService(resolveZellijConfigFile({ userData: app.getPath('userData') }), {
    platform: process.platform,
    validate: async (file) => {
      let output: string;
      try {
        output = await runCli(['--config', file, 'setup', '--check']);
      } catch {
        throw new Error('config-validation-failed');
      }
      if (!output.includes('[CONFIG FILE]: Well defined.'))
        throw new Error('config-validation-failed');
    }
  });
  runtime = new ZellijProcessService({
    config,
    readEnabled: () => settings.read().terminalEnabled,
    persistEnabled: (enabled) => {
      settings.save({ terminalEnabled: enabled });
    },
    checkBinary: () => {
      binaryPath();
    },
    port: zellijPort,
    run: runCli,
    spawn: spawnServer,
    probe: async () => {
      try {
        const response = await fetch(`${zellijOrigin()}/info/version`, {
          signal: AbortSignal.timeout(900),
          redirect: 'error'
        });
        if (!response.ok) return 'occupied';
        const text = await response.text();
        return text.trim() === '0.45.1' ? 'matching' : 'mismatch';
      } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause;
        return cause?.code === 'ECONNREFUSED' ? 'absent' : 'occupied';
      }
    },
    login: async (authToken) => {
      try {
        const response = await zellijTerminalSession().fetch(`${zellijOrigin()}/command/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_token: authToken, remember_me: true }),
          credentials: 'include',
          redirect: 'error',
          signal: AbortSignal.timeout(5_000)
        });
        if (response.status !== 200) return false;
        const result = (await response.json()) as { success?: boolean };
        return result.success === true;
      } catch {
        return false;
      }
    },
    readToken: () => token.read(),
    writeToken: (value) => token.write(value),
    changed: (snapshot) => {
      // Copy first: a listener may dispose itself (or a sibling surface) while being notified.
      for (const listener of [...stateListeners]) listener(snapshot);
      xpcMain.broadcast(ZELLIJ_STATE_EVENT, snapshot);
    },
    delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  });
  return runtime;
};

export const notifyZellijSettingsChanged = async (enabled: boolean): Promise<void> => {
  if (runtime) await runtime.settingsChanged(enabled);
};
