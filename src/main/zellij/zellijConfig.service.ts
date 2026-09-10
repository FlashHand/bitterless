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
import type { ZellijShortcuts } from './zellijConfig.type';

export const resolveZellijConfigFile = (
  options: {
    env?: NodeJS.ProcessEnv;
    home?: string;
    platform?: string;
  } = {}
): string => {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  if (env.ZELLIJ_CONFIG_FILE) return resolve(env.ZELLIJ_CONFIG_FILE);
  if (env.ZELLIJ_CONFIG_DIR) return join(resolve(env.ZELLIJ_CONFIG_DIR), 'config.kdl');
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

  async initialize(): Promise<void> {
    if (this.source() !== null) return;
    await this.save({
      revision: this.revision(null),
      shortcuts: defaultZellijShortcuts(this.options.platform)
    });
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
