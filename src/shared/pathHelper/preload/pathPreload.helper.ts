import { contextBridge, ipcRenderer } from 'electron';
import type { PathName, PathHelperApi } from '../shared/pathHelper.type';

const IPC_GET_APP_PATH = '__buff_path_getAppPath__';
const IPC_GET_PATH = '__buff_path_getPath__';
const IPC_GET_USER_DATA_PATH = '__buff_path_getUserDataPath__';

/** Get the app installation path */
const getAppPath = (): Promise<string> => {
  return ipcRenderer.invoke(IPC_GET_APP_PATH);
};

/** Get a special directory or file path by name */
const getPath = (name: PathName): Promise<string> => {
  return ipcRenderer.invoke(IPC_GET_PATH, name);
};

/** Get the user data path */
const getUserDataPath = (): Promise<string> => {
  return ipcRenderer.invoke(IPC_GET_USER_DATA_PATH);
};

/**
 * Returns a contextBridge-safe object for exposeInMainWorld.
 */
const createPathHelperApi = (): PathHelperApi => {
  return {
    getAppPath: (): Promise<string> => {
      return getAppPath();
    },
    getPath: (name: PathName): Promise<string> => {
      return getPath(name);
    },
    getUserDataPath: (): Promise<string> => {
      return getUserDataPath();
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
