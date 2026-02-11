import { xpcCenter } from 'electron-xpc/main';

export const initXpc = (): void => {
  // xpcCenter is a singleton; importing it registers all __xpc__ ipcMain listeners.
  // This explicit reference ensures the module side-effect executes.
  void xpcCenter;
};
