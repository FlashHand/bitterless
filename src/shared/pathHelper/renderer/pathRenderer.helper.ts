import type { PathHelperApi } from '../shared/pathHelper.type';

/**
 * Direct reference to window.pathHelper exposed by the preload script.
 * Import this in renderer (browser) code to use pathHelper without manual window casting.
 */
export const pathHelper = (globalThis as any).pathHelper as PathHelperApi;

export type { PathName, PathHelperApi } from '../shared/pathHelper.type';
