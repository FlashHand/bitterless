import { contextBridge } from 'electron';
import { exposeXpcRenderer } from 'electron-xpc/preload';

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('xpcRenderer', exposeXpcRenderer());
  } catch (error) {
    console.error(error);
  }
} else {
  (window as any).xpcRenderer = exposeXpcRenderer();
}
