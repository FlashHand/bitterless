import { app, ipcMain } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { PackageInfo } from '../shared/packageHelper.type';

const IPC_GET_PACKAGE_INFO = '__buff_pkg_getPackageInfo__';

const ALLOWED_FIELDS: (keyof PackageInfo)[] = [
  'name',
  'version',
  'versionCode',
  'description',
  'repository',
  'author',
  'license',
  'homepage',
];

const DEFAULTS: Record<keyof PackageInfo, any> = {
  name: '',
  version: '',
  versionCode: 0,
  description: '',
  repository: '',
  author: '',
  license: '',
  homepage: '',
};

class PackageMainHelper {
  private cached: PackageInfo | null = null;

  private pickFields(raw: Record<string, any>): PackageInfo {
    const result: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      result[key] = raw[key] ?? DEFAULTS[key];
    }
    return result as PackageInfo;
  }

  /**
   * Read package.json from app.getAppPath(), cache after first read.
   * Returns only the allowed fields.
   */
  async getPackageInfo(): Promise<PackageInfo> {
    if (this.cached) return this.cached;

    const appPath = app.getAppPath();
    const packagePath = join(appPath, 'package.json');
    const raw = JSON.parse(await readFile(packagePath, 'utf-8'));
    this.cached = this.pickFields(raw);
    return this.cached;
  }

  /**
   * Register IPC listener so renderer/preload processes can request package info.
   * Call this in the main process during initialization.
   */
  init(): void {
    ipcMain.handle(IPC_GET_PACKAGE_INFO, async () => {
      return await this.getPackageInfo();
    });
  }
}

export const packageMainHelper = new PackageMainHelper();
