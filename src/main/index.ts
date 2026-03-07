import { app, BrowserWindow } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { packageMainHelper } from '../shared/packageHelper/main/package.helper';
import { pathMainHelper } from '../shared/pathHelper/main/pathMain.helper';
import { mainWindowHelper } from './windows/mainWindow.helper';
import { sqliteWindowHelper } from './windows/sqliteWindow.helper';
import { connectorWindowHelper } from './windows/connectorWindow.helper';
import { initXpc } from './xpc/xpc.helper';
import { initDirectory } from './directoryHelper/directory.helper';
import { llamaWindowHelper } from './windows/llamaWindow.helper';

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron');
  initXpc();

  packageMainHelper.init();
  pathMainHelper.init();
  initDirectory();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 先启动 SQLite 进程并等待其准备就绪
  const sqliteWindow = sqliteWindowHelper.create();
  await new Promise<void>((resolve) => {
    sqliteWindow.webContents.on('did-finish-load', () => {
      resolve();
    });
  });

  // SQLite 进程准备就绪后，再启动主窗口和其他窗口
  // llamaWindowHelper.create();
  mainWindowHelper.create();
  connectorWindowHelper.create();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // llamaWindowHelper.create();
      // mainWindowHelper.create();
      // sqliteWindowHelper.create();
      // connectorWindowHelper.create();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
