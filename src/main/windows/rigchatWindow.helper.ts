import { BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class RigchatWindowHelper extends WindowHelper {
  protected preloadFile = 'rigchat.js';
  protected rendererPath = 'rigchat/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    title: 'Rigchat',
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  };
}

export const rigchatWindowHelper = new RigchatWindowHelper();
