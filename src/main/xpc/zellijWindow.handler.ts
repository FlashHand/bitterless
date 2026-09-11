import { XpcMainHandler } from 'electron-xpc/main';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import { MAESTRO_ZELLIJ_TAB_ID } from '@maestro-shared/compositeTab.identity';
import type { ZellijWindowApi } from '@shared/zellij/zellij.type';
import { zellijWindowService } from '@main/zellij/zellijWindow.service';

class ZellijWindowHandler extends XpcMainHandler implements ZellijWindowApi {
  /**
   * Opens INSIDE the operation view, not as a window of its own (Ral 2026-09-11:「就差 改为 tab
   * 下打开而不是独立窗口」).
   *
   * The standalone window stays as the fallback rather than being deleted: Zellij can be opened
   * before Maestro exists (tray, first run), and a terminal that refuses to open because the
   * browser window is closed would be a regression, not a simplification.
   */
  async openZellijWindow(): Promise<void> {
    try {
      await maestroWindowHelper.whenReady();
      await maestroWindowHelper.openCompositeTab({ id: MAESTRO_ZELLIJ_TAB_ID });
      return;
    } catch (error) {
      console.error('[zellij] docking into a Maestro tab failed; falling back to a window', error);
    }
    await zellijWindowService.open();
  }

  async minimize(): Promise<void> {
    zellijWindowService.minimize();
  }
  async toggleMaximize(): Promise<void> {
    zellijWindowService.toggleMaximize();
  }
  async close(): Promise<void> {
    zellijWindowService.close();
  }
}

export const zellijWindowHandler = new ZellijWindowHandler();
