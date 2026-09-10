import { XpcMainHandler } from 'electron-xpc/main';
import type { ZellijWindowApi } from '@shared/zellij/zellij.type';
import { zellijWindowService } from '@main/zellij/zellijWindow.service';

class ZellijWindowHandler extends XpcMainHandler implements ZellijWindowApi {
  async openZellijWindow(): Promise<void> {
    await zellijWindowService.open();
  }
  async minimize(): Promise<void> {
    zellijWindowService.minimize();
  }
  async toggleMaximize(): Promise<void> {
    zellijWindowService.toggleMaximize();
  }
  async close(): Promise<void> {
    zellijWindowService.close();
  }
}

export const zellijWindowHandler = new ZellijWindowHandler();
