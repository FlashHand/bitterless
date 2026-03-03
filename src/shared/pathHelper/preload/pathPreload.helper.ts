import { contextBridge } from 'electron';
import { xpcRenderer } from 'electron-xpc/preload';
import type { PathName, PathHelperApi } from '../shared/pathHelper.type';

/**
 * Returns a contextBridge-safe object for exposeInMainWorld.
 */
const createPathHelperApi = (): PathHelperApi => {
  return {
    getAppPath: (): Promise<string> => {
      return xpcRenderer.send('xpc:PathMainHelper/getAppPath');
    },
    getPath: (name: PathName): Promise<string> => {
      return xpcRenderer.send('xpc:PathMainHelper/getPath', { name });
    },
    getUserDataPath: (): Promise<string> => {
      return xpcRenderer.send('xpc:PathMainHelper/getUserDataPath');
    },
    openPath: (path: string): Promise<string> => {
      return xpcRenderer.send('xpc:PathMainHelper/openPath', { path });
    },
  };
};

/** The pathHelper API instance, usable in preload code */
export const pathHelper: PathHelperApi = createPathHelperApi();

// Auto-expose pathHelper to window on import
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('pathHelper', pathHelper);
  } catch (error) {
    console.error('[pathPreload] exposeInMainWorld failed:', error);
  }
} else {
  (globalThis as any).pathHelper = pathHelper;
}
