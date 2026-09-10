export const ZELLIJ_STATE_EVENT = 'zellij/state' as const;
export const ZELLIJ_HANDLER_NAME = 'ZellijHandler' as const;
export const ZELLIJ_WINDOW_HANDLER_NAME = 'ZellijWindowHandler' as const;

export type ZellijErrorCode =
  | 'disabled'
  | 'binary-missing'
  | 'unsupported-platform'
  | 'port-occupied'
  | 'version-mismatch'
  | 'start-failed'
  | 'startup-timeout'
  | 'authentication-failed'
  | 'token-failed'
  | 'secure-storage-unavailable'
  | 'config-invalid'
  | 'config-drift'
  | 'config-validation-failed'
  | 'config-write-failed'
  | 'shortcut-invalid'
  | 'shortcut-conflict'
  | 'directory-missing'
  | 'directory-open-failed'
  | 'operation-failed';

export interface ZellijSnapshot {
  enabled: boolean;
  status: 'idle' | 'starting' | 'ready' | 'error';
  error: ZellijErrorCode | null;
  configDirectory: string;
  configFile: string;
  configRevision: string;
  configExists: boolean;
  shortcuts: { splitDown: string; splitRight: string; closePane: string };
}

export interface ZellijApi {
  snapshot(): Promise<ZellijSnapshot>;
  initialize(): Promise<ZellijSnapshot>;
  setEnabled(params: { enabled: boolean }): Promise<ZellijSnapshot>;
  saveShortcuts(params: {
    revision: string;
    shortcuts: ZellijSnapshot['shortcuts'];
  }): Promise<ZellijSnapshot>;
  copyConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }>;
  openConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }>;
  setContentBounds(params: { x: number; y: number; width: number; height: number }): Promise<void>;
}

export interface ZellijWindowApi {
  openZellijWindow(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}
