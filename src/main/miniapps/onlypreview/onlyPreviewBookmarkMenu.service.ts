import { Menu, type BaseWindow } from 'electron';
import { i18nHelper } from '@main/i18n/i18n.helper';

export const showOnlyPreviewBookmarkMenu = (window: BaseWindow): Promise<boolean> => {
  if (window.isDestroyed()) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const finish = (remove: boolean): void => {
      window.removeListener('closed', onClosed);
      resolve(remove);
    };
    const onClosed = (): void => finish(false);
    const menu = Menu.buildFromTemplate([
      {
        label: i18nHelper.getMessages().app.onlyPreviewFileMenu.removeBookmark,
        click: () => finish(true)
      }
    ]);
    window.once('closed', onClosed);
    try {
      menu.popup({ window, callback: () => finish(false) });
    } catch (error) {
      window.removeListener('closed', onClosed);
      reject(error);
    }
  });
};
