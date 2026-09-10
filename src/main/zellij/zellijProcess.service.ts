import type { ZellijErrorCode, ZellijSnapshot } from '@shared/zellij/zellij.type';
import { defaultZellijShortcuts } from './zellijConfigEdit.service';
import { dirname } from 'node:path';
import type { ZellijRuntimeDependencies, ZellijOwnedProcess } from './zellijRuntime.type';

const ERRORS = new Set<ZellijErrorCode>([
  'disabled',
  'binary-missing',
  'unsupported-platform',
  'port-occupied',
  'version-mismatch',
  'start-failed',
  'startup-timeout',
  'authentication-failed',
  'token-failed',
  'secure-storage-unavailable',
  'config-invalid',
  'config-drift',
  'config-validation-failed',
  'config-write-failed',
  'shortcut-invalid',
  'shortcut-conflict',
  'directory-missing',
  'directory-open-failed',
  'operation-failed'
]);

export const zellijErrorCode = (error: unknown): ZellijErrorCode => {
  const value = error as { code?: string; message?: string } | null;
  for (const code of [value?.code, value?.message]) {
    if (ERRORS.has(code as ZellijErrorCode)) return code as ZellijErrorCode;
  }
  return 'operation-failed';
};

export const parseZellijToken = (output: string): string => {
  const tokens = [
    ...output.matchAll(
      /^\s*token_\d+:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/gim
    )
  ];
  if (tokens.length !== 1) throw new Error('token-failed');
  return tokens[0][1];
};

export class ZellijProcessService {
  private status: ZellijSnapshot['status'] = 'idle';
  private error: ZellijErrorCode | null = null;
  private generation = 0;
  private pending: Promise<ZellijSnapshot> | null = null;
  private owned: ZellijOwnedProcess | null = null;

  constructor(private readonly dependencies: ZellijRuntimeDependencies) {}

  snapshot(): ZellijSnapshot {
    let config: ReturnType<ZellijRuntimeDependencies['config']['read']>;
    try {
      config = this.dependencies.config.read();
    } catch (error) {
      return {
        enabled: this.dependencies.readEnabled(),
        status: 'error',
        error: zellijErrorCode(error),
        configDirectory: dirname(this.dependencies.config.file),
        configFile: this.dependencies.config.file,
        configRevision: '',
        configExists: true,
        shortcuts: defaultZellijShortcuts(process.platform)
      };
    }
    return {
      ...config,
      enabled: this.dependencies.readEnabled(),
      status: this.status,
      error: this.error
    };
  }

  initialize(): Promise<ZellijSnapshot> {
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.pending = this.open(generation).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async setEnabled(enabled: boolean): Promise<ZellijSnapshot> {
    this.dependencies.persistEnabled(enabled);
    await this.settingsChanged(enabled);
    return this.snapshot();
  }

  async settingsChanged(enabled: boolean): Promise<void> {
    if (!enabled) await this.stop();
    else this.publish();
  }

  reportViewFailure(): void {
    this.status = 'error';
    this.error = 'operation-failed';
    this.publish();
  }

  async saveShortcuts(input: {
    revision: string;
    shortcuts: ZellijSnapshot['shortcuts'];
  }): Promise<ZellijSnapshot> {
    try {
      this.dependencies.checkBinary();
      await this.dependencies.config.save(input);
      this.error = null;
      if (this.status === 'error') this.status = 'idle';
    } catch (error) {
      this.error = zellijErrorCode(error);
    }
    this.publish();
    return this.snapshot();
  }

  async stop(): Promise<void> {
    this.generation += 1;
    const owned = this.owned;
    this.owned = null;
    this.status = 'idle';
    this.error = null;
    this.publish();
    if (owned) await owned.stop();
  }

  private async open(generation: number): Promise<ZellijSnapshot> {
    try {
      this.assertActive(generation);
      this.dependencies.checkBinary();
      this.status = 'starting';
      this.error = null;
      this.publish();
      this.dependencies.config.read();
      await this.dependencies.config.initialize();
      this.assertActive(generation);
      let probe = await this.dependencies.probe();
      this.assertActive(generation);
      if (probe === 'mismatch') throw new Error('version-mismatch');
      if (probe === 'occupied') throw new Error('port-occupied');
      if (probe === 'absent') {
        const previous = this.owned;
        this.owned = null;
        if (previous) await previous.stop();
        this.assertActive(generation);
        const child = this.dependencies.spawn([
          '--config',
          this.dependencies.config.file,
          'web',
          '--start',
          '--ip',
          '127.0.0.1',
          '--port',
          '12877'
        ]);
        this.owned = child;
        child.onExit(() => {
          if (this.owned !== child) return;
          this.owned = null;
          this.status = 'error';
          this.error = 'start-failed';
          this.publish();
        });
        for (let attempt = 0; attempt < 40; attempt += 1) {
          this.assertActive(generation);
          if (child.exited()) throw new Error('start-failed');
          await this.dependencies.delay(250);
          probe = await this.dependencies.probe();
          if (probe === 'matching') break;
          if (probe === 'mismatch' || probe === 'occupied') throw new Error('port-occupied');
        }
        if (probe !== 'matching') throw new Error('startup-timeout');
      }
      this.assertActive(generation);
      let token = this.dependencies.readToken();
      if (token && (await this.dependencies.login(token))) {
        this.assertActive(generation);
        this.status = 'ready';
      } else {
        this.assertActive(generation);
        token = parseZellijToken(
          await this.dependencies.run([
            '--config',
            this.dependencies.config.file,
            'web',
            '--create-token'
          ])
        );
        this.assertActive(generation);
        this.dependencies.writeToken(token);
        if (!(await this.dependencies.login(token))) throw new Error('authentication-failed');
        this.assertActive(generation);
        this.status = 'ready';
      }
    } catch (error) {
      if (generation === this.generation) {
        const child = this.owned;
        this.owned = null;
        if (child) await child.stop();
        this.status = 'error';
        this.error = zellijErrorCode(error);
      }
    }
    this.publish();
    return this.snapshot();
  }

  private assertActive(generation: number): void {
    if (generation !== this.generation || !this.dependencies.readEnabled())
      throw new Error('disabled');
  }

  private publish(): void {
    this.dependencies.changed(this.snapshot());
  }
}
