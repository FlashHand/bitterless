import { app, BrowserWindow } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { mainWindowHelper } from './windows/mainWindow.helper';
import { sqliteWindowHelper } from './windows/sqliteWindow.helper';
import { initXpc } from './xpc/xpc.helper';

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron');

  initXpc();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  mainWindowHelper.create();
  sqliteWindowHelper.create();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindowHelper.create();
      sqliteWindowHelper.create();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
