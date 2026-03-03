import { app, shell } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import type { PathName } from '../shared/pathHelper.type';

export class PathMainHelper extends XpcMainHandler {
  init(): void {
    // XpcMainHandler auto-registers methods on instantiation
    // This init() is kept for compatibility with existing code
  }

  /** Get the app installation path */
  async getAppPath(): Promise<string> {
    return app.getAppPath();
  }

  /** Get a special directory or file path by name */
  async getPath(params: { name: PathName }): Promise<string> {
    return app.getPath(params.name);
  }

  /** Get the user data path (e.g. Application Support on macOS, Roaming on Windows) */
  async getUserDataPath(): Promise<string> {
    return app.getPath('userData');
  }

  /** Open a path in the default file manager */
  async openPath(params: { path: string }): Promise<string> {
    return shell.openPath(params.path);
  }
}

export const pathMainHelper = new PathMainHelper();
