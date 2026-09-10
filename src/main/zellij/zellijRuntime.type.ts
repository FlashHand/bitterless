import type { ZellijSnapshot } from '@shared/zellij/zellij.type';
import type { ZellijConfigService } from './zellijConfig.service';

export interface ZellijOwnedProcess {
  stop(): Promise<void>;
  onExit(callback: () => void): void;
  exited(): boolean;
}

export interface ZellijRuntimeDependencies {
  config: ZellijConfigService;
  readEnabled(): boolean;
  persistEnabled(enabled: boolean): void;
  checkBinary(): void;
  run(args: string[]): Promise<string>;
  spawn(args: string[]): ZellijOwnedProcess;
  probe(): Promise<'absent' | 'matching' | 'mismatch' | 'occupied'>;
  login(token: string): Promise<boolean>;
  readToken(): string | null;
  writeToken(token: string): void;
  changed(snapshot: ZellijSnapshot): void;
  delay(milliseconds: number): Promise<void>;
}
