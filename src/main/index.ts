import { app, BrowserWindow } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { packageMainHelper } from '../shared/packageHelper/main';
import { pathMainHelper } from '../shared/pathHelper/main';
import { mainWindowHelper } from './windows/mainWindow.helper';
import { sqliteWindowHelper } from './windows/sqliteWindow.helper';
import { rigchatWindowHelper } from './windows/rigchatWindow.helper';
import { initXpc } from './xpc/xpc.helper';
import { initDirectory } from './directoryHelper/directory.helper';
import { llamaWindowHelper } from './windows/llamaWindow.helper';

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron');

  packageMainHelper.init();
  pathMainHelper.init();
  initDirectory();
  initXpc();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // llamaWindowHelper.create();
  mainWindowHelper.create();
  sqliteWindowHelper.create();
  // rigchatWindowHelper.create();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      llamaWindowHelper.create();
      mainWindowHelper.create();
      sqliteWindowHelper.create();
      rigchatWindowHelper.create();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
