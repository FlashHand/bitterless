import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

/**
 * Zellij's web client encodes any Cmd-held key as a Kitty sequence built from
 * `ev.key.charCodeAt(0)`. For a named key that is the first letter of the NAME:
 *
 *     "Backspace".charCodeAt(0) === 66  // 'B'
 *
 * so Cmd+Delete reaches Zellij as Super+B and no keybind can recover it. These tests pin the
 * translation that runs before the page sees the event.
 */
const directory = mkdtempSync(join(tmpdir(), 'zellij-key-bridge-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'bridge.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijKeyBridge.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const { translateZellijCommandKey, bindZellijKeyBridge } = createRequire(import.meta.url)(outfile);

const keyDown = (overrides) => ({
  type: 'keyDown',
  key: 'a',
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...overrides
});

test('Cmd+Delete becomes the readline binding every shell already implements', () => {
  const translation = translateZellijCommandKey(keyDown({ key: 'Backspace', meta: true }));
  assert.equal(translation?.toKey, 'u', 'Cmd+Delete must arrive as Ctrl+U');
});

test('only plain Cmd translates — combinations are left alone rather than guessed at', () => {
  for (const extra of [{ shift: true }, { alt: true }, { control: true }]) {
    assert.equal(
      translateZellijCommandKey(keyDown({ key: 'Backspace', meta: true, ...extra })),
      undefined
    );
  }
  assert.equal(translateZellijCommandKey(keyDown({ key: 'Backspace' })), undefined, 'no Cmd, no translation');
  assert.equal(translateZellijCommandKey(keyDown({ key: 'w', meta: true })), undefined, 'Cmd+W is a real Zellij bind');
  assert.equal(
    translateZellijCommandKey({ ...keyDown({ key: 'Backspace', meta: true }), type: 'keyUp' }),
    undefined,
    'keyUp must not fire a second translation'
  );
});

test('the re-dispatched event carries ONE modifier, or Zellij would intercept it again', () => {
  // `hasModifiersToHandle` in Zellij's handler fires on `modifiers_count > 1 || metaKey`. Sending
  // Ctrl+Shift+U, or anything still holding Cmd, would loop straight back into the broken encoder.
  const sent = [];
  const webContents = {
    on: (event, handler) => {
      if (event === 'before-input-event') webContents.fire = handler;
    },
    sendInputEvent: (input) => sent.push(input)
  };
  bindZellijKeyBridge(webContents, 'darwin');
  let prevented = false;
  webContents.fire({ preventDefault: () => { prevented = true; } }, keyDown({ key: 'Backspace', meta: true }));

  assert.equal(prevented, true, 'the mis-encoded original must not reach the page');
  assert.deepEqual(sent.map((event) => event.type), ['keyDown', 'keyUp']);
  for (const event of sent) {
    assert.deepEqual(event.modifiers, ['control']);
    assert.equal(event.keyCode, 'u');
  }
});

test('non-macOS is untouched: there `meta` is the Windows key, not Cmd', () => {
  const sent = [];
  const webContents = { on: () => sent.push('bound'), sendInputEvent: () => sent.push('sent') };
  bindZellijKeyBridge(webContents, 'win32');
  bindZellijKeyBridge(webContents, 'linux');
  assert.deepEqual(sent, [], 'no handler should even be installed');
});
