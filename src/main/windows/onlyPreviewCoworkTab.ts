import { registerMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  MAESTRO_ONLY_PREVIEW_DISPLAY_URL,
  MAESTRO_ONLY_PREVIEW_TAB_ID
} from '@maestro-shared/compositeTab.identity';
import { openOnlyPreviewAbsoluteTarget } from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { OnlyPreviewCoworkMount } from '@main/windows/onlyPreviewCoworkMount';

/**
 * Teach Cowork that OnlyPreview can live in one of its tabs.
 *
 * The glue lives here, on the Bitterless side, because only this side may know both halves: Maestro
 * offers a tab that carries a native view, OnlyPreview offers a composite that can be carried, and
 * `check:maestro`'s alias boundary forbids Maestro from reaching for the second. So the host
 * registers a spec and Maestro drives it without ever importing a mini app.
 *
 * One mount instance per open tab, held by the closure the spec builds — there is at most one, since
 * only one OnlyPreview content surface is live at a time.
 */
// Re-exported from maestro-shared so both halves name the tab the same thing exactly once.
export const ONLY_PREVIEW_COWORK_TAB_ID = MAESTRO_ONLY_PREVIEW_TAB_ID;

export const registerOnlyPreviewCoworkTab = (): void => {
  let mount: OnlyPreviewCoworkMount | null = null;
  registerMaestroCompositeTab({
    id: ONLY_PREVIEW_COWORK_TAB_ID,
    title: 'OnlyPreview',
    favicon: '',
    displayUrl: MAESTRO_ONLY_PREVIEW_DISPLAY_URL,
    // One bound workspace and one search runtime, so a second copy would be a second view of the
    // same thing — the closure below holds exactly one mount, which is that fact in code.
    singleton: true,
    open: async (host) => {
      const next = new OnlyPreviewCoworkMount(host);
      mount = next;
      try {
        await onlyPreviewWindowHelper.openOnMount(next);
      } catch (error) {
        if (mount === next) mount = null;
        next.dispose();
        throw error;
      }
    },
    close: () => {
      const current = mount;
      mount = null;
      // The tab is already gone; this is what tells the composite its host went away, which is the
      // signal its own teardown listens on.
      current?.reportHostGone();
      current?.dispose();
    },
    setActive: (_host, active) => mount?.reportActivation(active),
    refresh: () => mount?.refresh(),
    // Only meaningful once `open` has run — Maestro calls this after the tab exists, so the
    // composite is already the live host and `ensureStandalone()` inside will resolve to it rather
    // than spawning a standalone window.
    openTarget: async (absolutePath) => {
      await openOnlyPreviewAbsoluteTarget(absolutePath);
    }
  });
};
