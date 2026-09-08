/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewFocusHarness } from './onlyPreviewPreviewFocusTest.helper.mjs';

test('ordinary bounds changes never recover focus, even when nothing is focused', () => {
  const h = createPreviewFocusHarness();
  h.updateWidth(700);
  const view = h.service.getVuePreviewView();
  assert.deepEqual(h.state.focusClaims, [view.webContents]);
  h.state.focused = null;
  const queryCount = h.state.focusQueries;
  for (const width of [710, 720, 740, 680]) h.updateWidth(width);
  assert.equal(h.state.focusQueries, queryCount, 'geometry must not even ask to acquire focus');
  assert.deepEqual(h.state.focusClaims, [view.webContents]);
  assert.equal(h.state.focused, null);
  assert.equal(view.bounds.width, 680);
  assert.deepEqual(h.container.children, [view]);
  h.service.destroy();
});

test('initial and replacement attachments respect global Chat, tree, search and inner PDF focus', async () => {
  for (const owner of ['Chat', 'Project', 'Search', 'PDF inner']) {
    const h = createPreviewFocusHarness();
    const focused = h.newContents();
    focused.owner = owner;
    h.state.focused = focused;
    if (owner === 'Project' || owner === 'Search') {
      const layerView = h.newView();
      layerView.webContents = focused;
      h.layers.show(owner === 'Project' ? 'base' : 'global', owner === 'Project' ? 'shell' : 'globalSearch', layerView);
    }
    h.updateWidth(700);
    await h.replacePdf();
    await h.replacePdf();
    h.updateWidth(620);
    assert.equal(h.state.focused, focused, owner);
    assert.deepEqual(h.state.focusClaims, [], `${owner} must not lose keyboard ownership`);
    if (owner === 'Chat' || owner === 'PDF inner') {
      assert.equal(h.container.children.some((view) => view.webContents === focused), false);
    }
    if (owner === 'Search') assert.equal(h.container.children.at(-1).webContents, focused);
    h.service.destroy();
  }
});

test('fresh and replaced standalone PDFs recover missing focus and keep shortcut binding', async () => {
  const h = createPreviewFocusHarness();
  h.state.activeSurface = 'chrome';
  h.updateWidth(700);
  const first = await h.replacePdf();
  assert.equal(h.state.focused, first.webContents);
  assert.equal(first.webContents.shortcutsBound, true);
  const second = await h.replacePdf();
  assert.equal(first.webContents.isDestroyed(), true);
  assert.equal(h.state.focused, second.webContents);
  assert.equal(second.webContents.shortcutsBound, true);
  assert.deepEqual(h.state.focusClaims, [first.webContents, second.webContents]);
  h.service.destroy();
});

test('hidden containers, invisible views, empty bounds and dead hosts cannot claim focus', async () => {
  for (const blockedBy of ['container', 'view', 'width', 'height', 'host']) {
    const h = createPreviewFocusHarness();
    if (blockedBy === 'container') h.container.setVisible(false);
    if (blockedBy === 'host') h.state.alive = false;
    if (blockedBy === 'view') {
      h.runtime.createVuePreviewView = () => {
        const view = h.newView();
        // A native view can be hidden during its bounds update after the layer has been shown.
        view.setBounds = (bounds) => { view.bounds = bounds; view.setVisible(false); };
        return view;
      };
    }
    h.service.updateBounds({
      x: 0, y: 0,
      width: blockedBy === 'width' ? 0 : 700,
      height: blockedBy === 'height' ? 0 : 500
    });
    assert.deepEqual(h.state.focusClaims, [], blockedBy);
    if (blockedBy === 'container') {
      await h.replacePdf();
      assert.deepEqual(h.state.focusClaims, [], 'a background PDF must also stay unfocused');
    }
    h.service.destroy();
  }
});

test('a destroyed global focus owner does not prevent replacement recovery', async () => {
  const h = createPreviewFocusHarness();
  const stale = h.newContents();
  stale.close();
  h.state.focused = stale;
  h.state.activeSurface = 'chrome';
  h.updateWidth(700);
  const replacement = await h.replacePdf();
  assert.equal(h.state.focused, replacement.webContents);
  h.service.destroy();
});
