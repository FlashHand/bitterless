import { BrowserWindow, BrowserWindowConstructorOptions, shell, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import icon from '../../../resources/icon.png?asset';

export abstract class WindowHelper {
  browserWindow: BrowserWindow | null = null;

  protected abstract preloadFile: string;
  protected abstract rendererPath: string;
  protected abstract windowOptions: Partial<BrowserWindowConstructorOptions>;

  create(): BrowserWindow {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    const windowWidth = Math.floor(screenWidth / 2);
    const windowHeight = Math.floor(screenHeight / 2);
    const x = 0;
    const y = screenHeight - windowHeight;

    const options: BrowserWindowConstructorOptions = {
      show: false,
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon } : {}),
      ...this.windowOptions,
      width: windowWidth,
      height: windowHeight,
      x: x,
      y: y,
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
