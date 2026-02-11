import { BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class MainWindowHelper extends WindowHelper {
  protected preloadFile = 'home.js';
  protected rendererPath = 'home/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    width: 900,
    height: 670,
  };
}

export const mainWindowHelper = new MainWindowHelper();
