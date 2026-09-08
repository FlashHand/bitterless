import { registerMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  MAESTRO_TRENCH_DISPLAY_URL,
  MAESTRO_TRENCH_TAB_ID
} from '@maestro-shared/compositeTab.identity';
import type { MaestroCompositeTabHostApi } from '@maestro-shared/compositeTab.api';
import { coinWindowHandler } from '@main/xpc/coinWindow.handler';
import { coinWindowManager } from '@main/coin/coinWindow.manager';

export const registerTrenchCoworkTab = (): void => {
  let host: MaestroCompositeTabHostApi | null = null;
  registerMaestroCompositeTab({
    id: MAESTRO_TRENCH_TAB_ID,
    title: 'Trench',
    favicon: '',
    displayUrl: MAESTRO_TRENCH_DISPLAY_URL,
    open: async (next) => {
      host = next;
      try {
        await coinWindowHandler.openOnTab(next);
      } catch (error) {
        if (host === next) host = null;
        throw error;
      }
    },
    close: () => {
      const previous = host;
      host = null;
      if (previous) coinWindowManager.closeTab(previous);
    },
    setActive: (active) => {
      if (host) coinWindowManager.setTabActive(host, active);
    },
    refresh: () => {
      if (host) coinWindowManager.refreshTab(host);
    }
  });
};
