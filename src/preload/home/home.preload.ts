import { contextBridge } from 'electron';
import { exposeXpcRenderer } from 'electron-buff/xpc/preload';
import { exposePathHelper } from 'electron-buff/pathHelper/renderer';

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('xpcRenderer', exposeXpcRenderer());
    contextBridge.exposeInMainWorld('pathHelper', exposePathHelper());
  } catch (error) {
    console.error(error);
  }
} else {
  (window as any).xpcRenderer = exposeXpcRenderer();
  (window as any).pathHelper = exposePathHelper();
}
