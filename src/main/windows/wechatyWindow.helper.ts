import { BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class WechatyWindowHelper extends WindowHelper {
  protected preloadFile = 'wechaty.js';
  protected rendererPath = 'wechaty/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    title: 'Wechaty',
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  };
}

export const wechatyWindowHelper = new WechatyWindowHelper();
