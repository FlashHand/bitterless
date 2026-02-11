import { BrowserWindow, BrowserWindowConstructorOptions, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import icon from '../../../resources/icon.png?asset';

export abstract class WindowHelper {
  browserWindow: BrowserWindow | null = null;

  protected abstract preloadFile: string;
  protected abstract rendererPath: string;
  protected abstract windowOptions: Partial<BrowserWindowConstructorOptions>;

  create(): BrowserWindow {
    const options: BrowserWindowConstructorOptions = {
      show: false,
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon } : {}),
      ...this.windowOptions,
      webPreferences: {
        preload: join(__dirname, `../preload/${this.preloadFile}`),
        sandbox: false,
        ...this.windowOptions.webPreferences,
      },
    };

    this.browserWindow = new BrowserWindow(options);

    this.browserWindow.on('ready-to-show', () => {
      this.browserWindow?.show();
      this.browserWindow?.webContents.openDevTools();
    });

    this.browserWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.browserWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${this.rendererPath}`);
    } else {
      this.browserWindow.loadFile(join(__dirname, `../renderer/${this.rendererPath}`));
    }

    return this.browserWindow;
  }
}
