import type { PackageHelperApi } from '../shared/packageHelper.type';

/**
 * Direct reference to window.packageHelper exposed by the preload script.
 * Import this in renderer (browser) code to use packageHelper without manual window casting.
 */
export const packageHelper = (globalThis as any).packageHelper as PackageHelperApi;

export type { PackageInfo, PackageHelperApi } from '../shared/packageHelper.type';
