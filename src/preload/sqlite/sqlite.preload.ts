import { contextBridge } from 'electron';
import { exposeXpcRenderer } from 'electron-buff/xpc/preload';

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('xpcRenderer', exposeXpcRenderer());
  } catch (error) {
    console.error(error);
  }
} else {
  (window as any).xpcRenderer = exposeXpcRenderer();
}
