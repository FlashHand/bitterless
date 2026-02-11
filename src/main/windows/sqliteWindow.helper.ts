import { BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class SqliteWindowHelper extends WindowHelper {
  protected preloadFile = 'sqlite.js';
  protected rendererPath = 'sqlite/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    width: 800,
    height: 600,
  };
}

export const sqliteWindowHelper = new SqliteWindowHelper();
