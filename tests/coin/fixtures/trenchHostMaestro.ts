import { BaseWindow, type View } from './trenchHostElectron';
import { getMaestroCompositeTab } from '../../../src/main/maestro/windows/main/compositeTab.registry';
import type { MaestroCompositeTabHostApi } from '../../../src/shared/maestro/compositeTab.api';

const tabs = new Map<string, { id: string; kind: string }>();
let sequence = 0;
export const maestroRuntime = { ready: null as Promise<void> | null };
export const maestroWindowHelper = {
  browserWindow: new BaseWindow() as BaseWindow | null,
  async whenReady(): Promise<void> {
    await maestroRuntime.ready;
  },
  async getTabs(): Promise<Array<{ id: string; kind: string }>> {
    return [...tabs.values()];
  },
  async closeTab({ id }: { id: string }): Promise<void> {
    const tab = tabs.get(id);
    if (!tab) return;
    tabs.delete(id);
    getMaestroCompositeTab(tab.kind)?.close();
  },
  async openCompositeTab({ id: kind }: { id: string }): Promise<void> {
    if ([...tabs.values()].some((tab) => tab.kind === kind)) return;
    const spec = getMaestroCompositeTab(kind);
    if (!spec) throw new Error('unregistered tab');
    const window = this.browserWindow!;
    const id = `tab-${++sequence}`;
    tabs.set(id, { id, kind });
    const host = {
      window: () => window,
      contentRect: () => ({ x: 0, y: 80, width: 900, height: 620 }),
      attach: (view: View) => window.contentView.addChildView(view),
      detach: (view: View) => window.contentView.removeChildView(view),
      activate: () => undefined,
      close: () => {
        void this.closeTab({ id });
      },
      isOpen: () => tabs.has(id),
      setTitle: () => undefined
    } as unknown as MaestroCompositeTabHostApi;
    try {
      await spec.open(host);
    } catch (error) {
      tabs.delete(id);
      throw error;
    }
  }
};
