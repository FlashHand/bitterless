import { BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class MainWindowHelper extends WindowHelper {
  protected preloadFile = 'home.js';
  protected rendererPath = 'home/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    title: 'BitterLess',
    width: 900,
    height: 670,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    }
  };
}

export const mainWindowHelper = new MainWindowHelper();
