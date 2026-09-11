import type { Input, WebContents } from 'electron';

/**
 * macOS line-editing keys that Zellij's web client cannot receive, translated before they reach it.
 *
 * Zellij's own key handler (`assets/key-handler.js`) intercepts anything with Cmd held and encodes
 * it as a Kitty sequence using `ev.key.charCodeAt(0)`. That is correct for a single character and
 * WRONG for every named key, because it takes the first letter of the NAME:
 *
 *     "Backspace".charCodeAt(0) === 66   // 'B'
 *     "Delete".charCodeAt(0)    === 68   // 'D'
 *
 * So Cmd+Delete arrives at Zellij as Super+B. No keybind can fix that — the sequence never carried
 * the key. Translating here is the only layer that still has the real event.
 *
 * The translation targets are the readline bindings every shell already implements, so nothing has
 * to be configured for them to work.
 */
interface KeyTranslation {
  /** The literal Electron `Input.key` this fires on. */
  readonly from: string;
  /** What the page receives instead. One modifier only — Zellij passes single-Ctrl through. */
  readonly toKey: string;
  readonly why: string;
}

const MAC_COMMAND_TRANSLATIONS: readonly KeyTranslation[] = [
  { from: 'Backspace', toKey: 'u', why: 'Cmd+Delete = delete to start of line (readline Ctrl+U)' }
];

export const translateZellijCommandKey = (input: Input): KeyTranslation | undefined => {
  if (input.type !== 'keyDown' || !input.meta) return undefined;
  // Only plain Cmd. Cmd+Shift+Delete and friends are left alone rather than guessed at.
  if (input.control || input.alt || input.shift) return undefined;
  return MAC_COMMAND_TRANSLATIONS.find((entry) => entry.from === input.key);
};

/**
 * Only on macOS: elsewhere Cmd is not a key users press, and `input.meta` is the Windows/Super key
 * where these translations would be wrong.
 */
export const bindZellijKeyBridge = (
  webContents: WebContents,
  platform: string = process.platform
): void => {
  if (platform !== 'darwin') return;
  webContents.on('before-input-event', (event, input) => {
    const translation = translateZellijCommandKey(input);
    if (!translation) return;
    event.preventDefault();
    // Re-dispatched as Ctrl+<key>: one modifier, so Zellij's handler ignores it and xterm.js emits
    // the ordinary control character the shell is already listening for.
    webContents.sendInputEvent({ type: 'keyDown', keyCode: translation.toKey, modifiers: ['control'] });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: translation.toKey, modifiers: ['control'] });
  });
};
