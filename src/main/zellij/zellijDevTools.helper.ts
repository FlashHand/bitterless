import { app } from 'electron';
import type { Input, WebContents } from 'electron';

/**
 * DevTools for the Zellij surfaces.
 *
 * Until this existed, the Zellij window and its terminal view were the only first-party surfaces in
 * the app with NO way to open DevTools — so a failing enable/initialize left no trace anywhere
 * (see docs/issues/zellij-terminal-no-error-trace.md).
 *
 * The predicates deliberately mirror the OnlyPreview ones in
 * `src/main/windows/onlyPreviewWindow.helper.ts`: auto-open only in debug, but bind the *shortcut*
 * on Preview too, because Preview is the owner-facing test channel. Those are module-private there;
 * this is a separate copy rather than a refactor of that 1300-line file, which would be an
 * unrelated change.
 */
const shouldAutoOpenZellijDevTools = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' && process.env.BITTERLESS_E2E !== '1';

const isZellijDevToolsEnabled = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' ||
  import.meta.env.VITE_RELEASE_CHANNEL === 'preview' ||
  (process.env.BITTERLESS_E2E === '1' && !app.isPackaged);

const isZellijDevToolsShortcut = (input: Input): boolean => {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
  const key = input.key.toLowerCase();
  if (key === 'f12') return !input.shift && !input.control && !input.alt && !input.meta;
  if (key !== 'i') return false;
  if (process.platform === 'darwin') {
    return input.meta && input.alt && !input.control && !input.shift;
  }
  if (process.platform === 'win32') {
    return input.control && input.shift && !input.meta && !input.alt;
  }
  return false;
};

/**
 * The terminal view sets `setIgnoreMenuShortcuts(true)` and owns the keyboard, so a menu
 * accelerator would never reach it — `before-input-event` is the only binding that works there.
 */
export const bindZellijDevTools = (webContents: WebContents): void => {
  if (!isZellijDevToolsEnabled()) return;
  webContents.on('before-input-event', (event, input) => {
    if (!isZellijDevToolsShortcut(input)) return;
    event.preventDefault();
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
      return;
    }
    webContents.openDevTools({ mode: 'detach', activate: false });
  });
};

/** Detached and not activated, so it never steals focus from the terminal. */
export const autoOpenZellijDevTools = (webContents: WebContents): void => {
  if (!shouldAutoOpenZellijDevTools()) return;
  webContents.once('did-finish-load', () => {
    if (webContents.isDestroyed() || webContents.isDevToolsOpened()) return;
    try {
      webContents.openDevTools({ mode: 'detach', activate: false });
    } catch (error) {
      console.error('[zellij] devtools open failed', error);
    }
  });
};
