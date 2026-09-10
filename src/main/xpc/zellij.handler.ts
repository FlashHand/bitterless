import { clipboard, shell } from 'electron';
import { existsSync } from 'node:fs';
import { XpcMainHandler } from 'electron-xpc/main';
import type { ZellijApi, ZellijErrorCode, ZellijSnapshot } from '@shared/zellij/zellij.type';
import { getZellijRuntime } from '@main/zellij/zellijRuntime.service';
import { zellijWindowService } from '@main/zellij/zellijWindow.service';

class ZellijHandler extends XpcMainHandler implements ZellijApi {
  async snapshot(): Promise<ZellijSnapshot> {
    return getZellijRuntime().snapshot();
  }
  async initialize(): Promise<ZellijSnapshot> {
    return getZellijRuntime().initialize();
  }
  async setEnabled(params: { enabled: boolean }): Promise<ZellijSnapshot> {
    return getZellijRuntime().setEnabled(params?.enabled === true);
  }
  async saveShortcuts(params: {
    revision: string;
    shortcuts: ZellijSnapshot['shortcuts'];
  }): Promise<ZellijSnapshot> {
    return getZellijRuntime().saveShortcuts(params);
  }
  async copyConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }> {
    try {
      clipboard.writeText(getZellijRuntime().snapshot().configDirectory);
      return { ok: true, error: null };
    } catch {
      return { ok: false, error: 'operation-failed' };
    }
  }
  async openConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }> {
    const directory = getZellijRuntime().snapshot().configDirectory;
    if (!existsSync(directory)) return { ok: false, error: 'directory-missing' };
    try {
      if (await shell.openPath(directory)) return { ok: false, error: 'directory-open-failed' };
      return { ok: true, error: null };
    } catch {
      return { ok: false, error: 'directory-open-failed' };
    }
  }
  async setContentBounds(params: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<void> {
    zellijWindowService.setContentBounds(params);
  }
}

export const zellijHandler = new ZellijHandler();
