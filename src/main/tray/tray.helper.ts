import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'path';
import { i18nHelper } from '../i18n/i18n.helper';
import { dialogHelper } from '../dialog/dialog.helper';

interface PrimaryWindowPresenter {
  show(): void;
}

class TrayHelper {
  private tray: Tray | null = null;
  private primaryWindowPresenter: PrimaryWindowPresenter | null = null;

  init(primaryWindowPresenter: PrimaryWindowPresenter): void {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      return;
    }

    this.primaryWindowPresenter = primaryWindowPresenter;

    const isWin = process.platform === 'win32';
    const iconFilename = isWin ? 'tray-win.ico' : 'bitterless-tray-mac-24.png';
    let iconPath: string;

    if (import.meta.env.VITE_MODE === 'release') {
      const unpacked = join(app.getAppPath(), '..', 'app.asar.unpacked', 'icons');
      iconPath = join(unpacked, iconFilename);
    } else {
      const sourceDirectory = isWin ? '../../build' : '../../doc';
      iconPath = join(__dirname, sourceDirectory, iconFilename);
    }

    const icon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }

    this.tray = new Tray(icon);

    this.updateMenu();

    this.tray.on('click', () => {
      this.showMainWindow();
    });

    console.log('[TrayHelper] Tray initialized, iconPath:', iconPath);
  }

  updateMenu(): void {
    if (!this.tray) return;

    const messages = i18nHelper.getMessages();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: messages.app.show,
        click: () => this.showMainWindow(),
      },
      {
        type: 'separator',
      },
      {
        label: messages.app.quit,
        click: () => this.requestQuit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip('Bitterless');
  }

  private showMainWindow(): void {
    if (this.primaryWindowPresenter) {
      this.primaryWindowPresenter.show();
    }
  }

  private async requestQuit(): Promise<void> {
    if (process.platform === 'darwin') {
      app.quit();
      return;
    }
    const shouldQuit = await dialogHelper.showQuitConfirmDialog();
    if (shouldQuit) {
      app.quit();
    }
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export const trayHelper = new TrayHelper();
