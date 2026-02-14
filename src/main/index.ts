import { app, BrowserWindow } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { mainWindowHelper } from './windows/mainWindow.helper';
import { sqliteWindowHelper } from './windows/sqliteWindow.helper';
import { wechatyWindowHelper } from './windows/wechatyWindow.helper';
import { initXpc } from './xpc/xpc.helper';
import { initDirectory } from './directoryHelper/directory.helper';

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron');

  initDirectory();
  initXpc();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  mainWindowHelper.create();
  sqliteWindowHelper.create();
  wechatyWindowHelper.create();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindowHelper.create();
      sqliteWindowHelper.create();
      wechatyWindowHelper.create();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
