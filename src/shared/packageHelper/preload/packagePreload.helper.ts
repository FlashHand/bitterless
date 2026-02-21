import { contextBridge, ipcRenderer } from 'electron';
import type { PackageInfo, PackageHelperApi } from '../shared/packageHelper.type';

const IPC_GET_PACKAGE_INFO = '__buff_pkg_getPackageInfo__';

/** Get package.json info (filtered fields only) */
const getPackageInfo = (): Promise<PackageInfo> => {
  return ipcRenderer.invoke(IPC_GET_PACKAGE_INFO);
};

/**
 * Returns a contextBridge-safe object for exposeInMainWorld.
 */
const createPackageHelperApi = (): PackageHelperApi => {
  return {
    getPackageInfo: (): Promise<PackageInfo> => {
      return getPackageInfo();
    },
  };
};

/** The packageHelper API instance, usable in preload code */
export const packageHelper: PackageHelperApi = createPackageHelperApi();

// Auto-expose packageHelper to window on import
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('packageHelper', packageHelper);
  } catch (error) {
    console.error('[packagePreload] exposeInMainWorld failed:', error);
  }
} else {
  (globalThis as any).packageHelper = packageHelper;
}
