export interface ZellijShortcuts {
  splitDown: string;
  splitRight: string;
  closePane: string;
}

export type ZellijShortcutAction = keyof ZellijShortcuts;

export type ZellijConfigEditErrorCode = 'config-invalid' | 'shortcut-invalid' | 'shortcut-conflict';
