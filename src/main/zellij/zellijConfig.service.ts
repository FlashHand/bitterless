import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ZellijSnapshot } from '@shared/zellij/zellij.type';
import {
  defaultZellijShortcuts,
  editZellijShortcuts,
  readZellijShortcuts
} from './zellijConfigEdit.service';
import { buildZellijDefaultConfig } from './zellijDefaultConfig';
import type { ZellijShortcuts } from './zellijConfig.type';

export const ZELLIJ_CONFIG_ARG = '--zellij-config';

/**
 * `--zellij-config=<path>` on the app's own command line.
 *
 * Ranked ABOVE the two Zellij environment variables on purpose: a launch argument describes THIS
 * launch, while an exported env var leaks into every child process the app spawns — including the
 * `zellij` CLI itself, where it would silently override the `--config` we pass explicitly. An
 * argument also survives being read twice, which an env var mutated mid-run does not.
 *
 * macOS caveat: a bundle started from Finder or the Dock receives no arguments, so this is for
 * terminal launches (`open -a Bitterless --args --zellij-config=…`, or the binary directly) and for
 * per-environment shortcuts. It is NOT a substitute for a user-facing setting.
 */
export const parseZellijConfigArg = (argv: readonly string[]): string | undefined => {
  const prefix = `${ZELLIJ_CONFIG_ARG}=`;
  let found: string | undefined;
  for (const arg of argv) {
    if (arg === ZELLIJ_CONFIG_ARG) {
      // Reject the space-separated form rather than quietly consuming the next argv entry, which on
      // a packaged launch is just as likely to be a file the OS appended (Open With) as our value.
      throw new Error(`${ZELLIJ_CONFIG_ARG} must be written as ${ZELLIJ_CONFIG_ARG}=<path>`);
    }
    if (!arg.startsWith(prefix)) continue;
    const value = arg.slice(prefix.length);
    if (!value || /[\0\r\n]/.test(value)) {
      throw new Error(`${ZELLIJ_CONFIG_ARG} must be a non-empty single-line path`);
    }
    // Ambiguity here is a misconfiguration, not something to resolve by picking one.
    if (found !== undefined) throw new Error(`${ZELLIJ_CONFIG_ARG} may be provided only once`);
    found = value;
  }
  return found;
};

export const resolveZellijConfigFile = (
  options: {
    argv?: readonly string[];
    env?: NodeJS.ProcessEnv;
    home?: string;
    platform?: string;
    /**
     * The app's private data root. When given it is the default, ranked BELOW the explicit
     * argument and the two Zellij env vars so an operator can still point at the system file.
     * Omitted (tests, and any caller that genuinely wants the system config) keeps the old
     * directory probing.
     */
    userData?: string;
  } = {}
): string => {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const fromArgv = parseZellijConfigArg(options.argv ?? process.argv);
  if (fromArgv) return resolve(fromArgv);
  if (env.ZELLIJ_CONFIG_FILE) return resolve(env.ZELLIJ_CONFIG_FILE);
  if (env.ZELLIJ_CONFIG_DIR) return join(resolve(env.ZELLIJ_CONFIG_DIR), 'config.kdl');
  // App-private by default (Ral 2026-09-11). Bitterless and cowork both bundle Zellij, and the
  // shared system file made their settings panels fight: one app's save is the other's
  // `config-drift`, because drift detection is a sha256 of the whole file. `userData` already
  // differs per runtime profile, so Production/Preview/debug get separate files for free.
  if (options.userData) return join(options.userData, 'zellij', 'config.kdl');
  const conventional = join(home, '.config', 'zellij');
  const platformDirectory =
    platform === 'win32'
      ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Zellij', 'config')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'org.Zellij-Contributors.Zellij')
        : join(
            env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
              ? env.XDG_CONFIG_HOME
              : join(home, '.config'),
            'zellij'
          );
  const candidates =
    platform === 'win32' ? [platformDirectory] : [conventional, platformDirectory, '/etc/zellij'];
  const existing = candidates.find((directory) => {
    try {
      return statSync(directory).isDirectory();
    } catch {
      return false;
    }
  });
  return join(existing ?? (platform === 'win32' ? platformDirectory : conventional), 'config.kdl');
};

export class ZellijConfigService {
  constructor(
    readonly file: string,
    private readonly options: { platform: string; validate: (file: string) => Promise<void> }
  ) {}

  read(): Pick<
    ZellijSnapshot,
    'configDirectory' | 'configFile' | 'configRevision' | 'configExists' | 'shortcuts'
  > {
    const source = this.source();
    return {
      configDirectory: dirname(this.file),
      configFile: this.file,
      configRevision: this.revision(source),
      configExists: source !== null,
      shortcuts:
        source === null
          ? defaultZellijShortcuts(this.options.platform)
          : readZellijShortcuts(source, this.options.platform)
    };
  }

  /**
   * Seed the starting config, once, when nothing is there.
   *
   * This used to write ONLY keybinds (via `save()` with the default shortcuts), which is why every
   * cell rendered in the default foreground: the seeded file carried no theme, and a browser tab
   * has no palette for Zellij to fall back on. It now writes the full starting config — keybinds,
   * theme, pinned appearance and layout — and still validates it with the real binary before it
   * lands, so a bad default can never be the thing that breaks startup.
   */
  async initialize(): Promise<void> {
    if (this.source() !== null) return;
    const candidate = buildZellijDefaultConfig({ platform: this.options.platform });
    const directory = dirname(this.file);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.bitterless-zellij-${randomUUID()}.kdl`);
    try {
      // `wx` on both writes: losing a race against another profile booting against the same path
      // must be a no-op, never an overwrite of a file the owner has since edited.
      writeFileSync(temporary, candidate, { flag: 'wx', mode: 0o600 });
      await this.options.validate(temporary);
      if (this.source() !== null) return;
      renameSync(temporary, this.file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  async save(input: { revision: string; shortcuts: ZellijShortcuts }): Promise<void> {
    const source = this.source();
    if (this.revision(source) !== input.revision) throw new Error('config-drift');
    const candidate = editZellijShortcuts(source ?? '', input.shortcuts);
    const directory = dirname(this.file);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.bitterless-zellij-${randomUUID()}.kdl`);
    const mode = source === null ? 0o600 : lstatSync(this.file).mode & 0o777;
    try {
      writeFileSync(temporary, candidate, { flag: 'wx', mode });
      await this.options.validate(temporary);
      if (this.revision(this.source()) !== input.revision) throw new Error('config-drift');
      if (source !== null) {
        writeFileSync(`${this.file}.bitterless-backup-${Date.now()}-${randomUUID()}`, source, {
          flag: 'wx',
          mode: 0o600
        });
      }
      // No await between the final revision check and replacement.
      renameSync(temporary, this.file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  private source(): string | null {
    if (!existsSync(this.file)) return null;
    const stat = lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      throw new Error('config-invalid');
    return readFileSync(this.file, 'utf8');
  }

  private revision(source: string | null): string {
    return source === null ? 'missing' : createHash('sha256').update(source).digest('hex');
  }
}
