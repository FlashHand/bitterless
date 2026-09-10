import { app, BrowserWindow, WebContentsView } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'node:path';
import { windowStateService, type WindowStateController } from '@main/windows/windowState.service';
import type { ZellijSnapshot } from '@shared/zellij/zellij.type';
import {
  getZellijRuntime,
  subscribeZellijState,
  ZELLIJ_ORIGIN,
  zellijTerminalSession
} from './zellijRuntime.service';

export const isZellijNavigationAllowed = (url: string): boolean => {
  try {
    return new URL(url).origin === ZELLIJ_ORIGIN;
  } catch {
    return false;
  }
};

class ZellijWindowService {
  private window: BrowserWindow | null = null;
  private creating: Promise<void> | null = null;
  private stateController: WindowStateController | null = null;
  private terminal: WebContentsView | null = null;
  private contentBounds = { x: 0, y: 100, width: 0, height: 0 };

  constructor() {
    subscribeZellijState((snapshot) => this.applyState(snapshot));
  }

  async open(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      if (!this.creating)
        this.creating = this.create().finally(() => {
          this.creating = null;
        });
      await this.creating;
    }
    if (!this.window || this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.stateController?.show();
    this.window.show();
    this.window.focus();
    this.applyState(getZellijRuntime().snapshot());
  }

  minimize(): void {
    this.window?.minimize();
  }
  toggleMaximize(): void {
    if (this.window?.isMaximized()) this.window.unmaximize();
    else this.window?.maximize();
  }
  close(): void {
    this.window?.close();
  }

  setContentBounds(input: { x: number; y: number; width: number; height: number }): void {
    if (!this.window || !Object.values(input).every(Number.isFinite)) return;
    const [width, height] = this.window.getContentSize();
    const x = Math.max(0, Math.min(width, Math.round(input.x)));
    const y = Math.max(0, Math.min(height, Math.round(input.y)));
    this.contentBounds = {
      x,
      y,
      width: Math.max(0, Math.min(width - x, Math.round(input.width))),
      height: Math.max(0, Math.min(height - y, Math.round(input.height)))
    };
    this.layout();
  }

  async destroy(): Promise<void> {
    await this.creating?.catch(() => undefined);
    this.removeTerminal();
    this.stateController?.flushAndDispose();
    this.window?.destroy();
    this.window = null;
    this.stateController = null;
    await getZellijRuntime().stop();
  }

  private async create(): Promise<void> {
    const bounds = windowStateService.resolve('zellij');
    const created = new BrowserWindow({
      width: bounds?.bounds.width ?? 1120,
      height: bounds?.bounds.height ?? 760,
      ...(bounds ? { x: bounds.bounds.x, y: bounds.bounds.y } : {}),
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: 'Zellij',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(app.getAppPath(), 'out', 'preload', 'zellij.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    this.window = created;
    this.stateController = windowStateService.register('zellij', created);
    created.on('resize', () => this.layout());
    created.once('closed', () => {
      if (this.window !== created) return;
      this.removeTerminal();
      this.window = null;
      this.stateController = null;
    });
    try {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        await created.loadURL(`${process.env.ELECTRON_RENDERER_URL}/zellij/index.html`);
      } else {
        await created.loadFile(join(app.getAppPath(), 'out', 'renderer', 'zellij', 'index.html'));
      }
    } catch (error) {
      if (!created.isDestroyed()) created.destroy();
      throw error;
    }
  }

  private applyState(snapshot: ZellijSnapshot): void {
    if (!snapshot.enabled || snapshot.status !== 'ready') {
      this.removeTerminal();
      return;
    }
    const window = this.window;
    if (!window || window.isDestroyed() || this.terminal) return;
    const terminalSession = zellijTerminalSession();
    terminalSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    );
    terminalSession.setPermissionCheckHandler(() => false);
    const terminal = new WebContentsView({
      webPreferences: {
        session: terminalSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    this.terminal = terminal;
    terminal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    terminal.webContents.on('will-navigate', (event, url) => {
      if (!isZellijNavigationAllowed(url)) event.preventDefault();
    });
    terminal.webContents.on('will-redirect', (event, url) => {
      if (!isZellijNavigationAllowed(url)) event.preventDefault();
    });
    terminal.webContents.on('will-frame-navigate', (event) => {
      if (!isZellijNavigationAllowed(event.url)) event.preventDefault();
    });
    terminal.webContents.setIgnoreMenuShortcuts(true);
    window.contentView.addChildView(terminal);
    this.layout();
    void terminal.webContents.loadURL(ZELLIJ_ORIGIN).catch(() => {
      if (this.terminal === terminal && !window.isDestroyed()) {
        this.removeTerminal();
        getZellijRuntime().reportViewFailure();
      }
    });
  }

  private layout(): void {
    if (!this.terminal || !this.window || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const bounds = this.contentBounds;
    this.terminal.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(0, Math.min(bounds.width || width, width - bounds.x)),
      height: Math.max(0, Math.min(bounds.height || height - bounds.y, height - bounds.y))
    });
  }

  private removeTerminal(): void {
    const terminal = this.terminal;
    this.terminal = null;
    if (!terminal) return;
    if (this.window && !this.window.isDestroyed())
      this.window.contentView.removeChildView(terminal);
    if (!terminal.webContents.isDestroyed()) terminal.webContents.close();
  }
}

export const zellijWindowService = new ZellijWindowService();
