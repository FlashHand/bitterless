import { WebContentsView } from 'electron';
import type { View } from 'electron';
import { bindZellijDevTools } from './zellijDevTools.helper';
import { bindZellijKeyBridge } from './zellijKeyBridge';
import { setTerminalKeyboardOwner } from '@maestro-main/common/shortcutsHelper/shortcuts.helper';
import {
  getZellijRuntime,
  subscribeZellijState,
  zellijOrigin,
  zellijTerminalSession,
  zellijTerminalUrl
} from './zellijRuntime.service';
import type { ZellijSnapshot } from '@shared/zellij/zellij.type';

export interface ZellijTerminalHost {
  /** Identifies THIS surface. Its Zellij session name is derived from it, so it must be stable for
   *  the life of the surface and distinct from every other live surface. */
  surfaceId: string;
  /** Where the view is parented. A BrowserWindow passes its `contentView`; an embedded surface passes its own container. */
  container: View;
  /** Host-space rect for the terminal, recomputed by the host whenever its own layout changes. */
  bounds(): { x: number; y: number; width: number; height: number };
  /** False while the host is hidden (background tab, collapsed cell) so the view is not drawn. */
  visible?(): boolean;
  destroyed(): boolean;
}

export interface ZellijTerminalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ONE Zellij terminal surface: one WebContentsView, its navigation fence, its layout and its
 * teardown — and nothing else.
 *
 * This is the unit that has to multiply. Everything it needs from the outside arrives through
 * `ZellijTerminalHost`, so the same class serves a standalone window, a tab, or an Omni cell; the
 * host decides where it lives and how big it is. The shared pieces (the server process, the token,
 * the config file, the `terminalEnabled` gate) deliberately stay singletons in
 * `zellijRuntime.service.ts` — N surfaces are N HTTP clients of ONE server.
 *
 * Extracted from ZellijWindowService, which held `window` / `terminal` / `contentBounds` as scalars
 * and short-circuited on `if (this.terminal) return` — so a second surface was not merely unsafe,
 * it was unrepresentable.
 */
export class ZellijTerminalView {
  private view: WebContentsView | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly host: ZellijTerminalHost) {
    this.unsubscribe = subscribeZellijState((snapshot) => this.applyState(snapshot));
  }

  /** Attach against the current runtime state; safe to call repeatedly (host show/activate). */
  sync(): void {
    if (this.disposed) return;
    this.applyState(getZellijRuntime().snapshot());
  }

  layout(): void {
    if (this.disposed || !this.view || this.host.destroyed()) return;
    const rect = this.host.bounds();
    this.view.setBounds({
      x: rect.x,
      y: rect.y,
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height)
    });
    // Only hosts that can be hidden (a background tab, a collapsed cell) declare visibility. A
    // window host never did, and calling setVisible unconditionally would be a behaviour change
    // smuggled into a refactor.
    if (this.host.visible) this.view.setVisible(this.host.visible());
  }

  focus(): void {
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.focus();
  }

  /** True once a terminal view exists — the host uses it to decide what to focus. */
  attached(): boolean {
    return this.view !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.detach();
  }

  private applyState(snapshot: ZellijSnapshot): void {
    if (this.disposed) return;
    if (!snapshot.enabled || snapshot.status !== 'ready') {
      this.detach();
      return;
    }
    if (this.view || this.host.destroyed()) return;
    this.attach();
  }

  private attach(): void {
    const terminalSession = zellijTerminalSession();
    terminalSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    terminalSession.setPermissionCheckHandler(() => false);
    const view = new WebContentsView({
      webPreferences: {
        session: terminalSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    this.view = view;
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event: Electron.Event, url: string): void => {
      if (!isZellijNavigationAllowed(url)) event.preventDefault();
    };
    view.webContents.on('will-navigate', guard);
    view.webContents.on('will-redirect', guard);
    view.webContents.on('will-frame-navigate', (event) => guard(event, event.url));
    // The terminal owns the keyboard, so menu accelerators must not fire while it is focused —
    // which is also why DevTools here can only be bound through before-input-event.
    view.webContents.setIgnoreMenuShortcuts(true);
    // Cmd+W closes a PANE here, not the tab — see shortcuts.helper.
    setTerminalKeyboardOwner(view.webContents);
    bindZellijKeyBridge(view.webContents);
    bindZellijDevTools(view.webContents);
    this.host.container.addChildView(view);
    this.layout();
    // Path-addressed: the session name is what stops the web client asking for one on every open.
    const target = zellijTerminalUrl(this.host.surfaceId);
    void view.webContents.loadURL(target).catch((error) => {
      console.error('[zellij] terminal load failed', target, error);
      if (this.view !== view) return;
      this.detach();
      // Per-surface failure. Today this flips the shared status for everyone; splitting that is the
      // remaining half of multi-instance work (docs/issues/zellij-multi-instance.md).
      getZellijRuntime().reportViewFailure();
    });
  }

  private detach(): void {
    const view = this.view;
    this.view = null;
    if (!view) return;
    if (!this.host.destroyed()) this.host.container.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}

export const isZellijNavigationAllowed = (url: string): boolean => {
  try {
    return new URL(url).origin === zellijOrigin();
  } catch {
    return false;
  }
};
