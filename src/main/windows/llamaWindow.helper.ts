import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';

class LlamaWindowHelper {
  browserWindow: BrowserWindow | null = null;

  create(): BrowserWindow {
    const isDev = is.dev;

    const options: BrowserWindowConstructorOptions = {
      show: isDev,
      width: isDev ? 800 : 0,
      height: isDev ? 600 : 0,
      skipTaskbar: !isDev,
      title: 'Llama Worker',
      webPreferences: {
        preload: join(__dirname, '../preload/llama.js'),
        sandbox: false,
        nodeIntegration: true,
      },
    };

    this.browserWindow = new BrowserWindow(options);

    if (isDev) {
      this.browserWindow.webContents.openDevTools();
    }

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      this.browserWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/llama/index.html`);
    } else {
      this.browserWindow.loadFile(join(__dirname, '../renderer/llama/index.html'));
    }

    return this.browserWindow;
  }
}

export const llamaWindowHelper = new LlamaWindowHelper();
