import type { BaseWindow, View } from 'electron';
import type {
  OnlyPreviewMount,
  OnlyPreviewMountChrome,
  OnlyPreviewMountKind
} from '@main/onlypreview/onlyPreviewSurface.mount';
import type { OnlyPreviewSurfaceSize } from '@main/onlypreview/onlyPreviewSurfaceLayout';

/**
 * The composite carried by its own window — today's behaviour, behind the seam.
 *
 * Every member is a plain window operation, which is the point: the standalone host was never
 * doing anything a second host could not also do, it was just doing it in the composite's own code.
 * Window creation, `windowStateService` registration, persisted bounds and the 800x600 minimum stay
 * with the window helper; this only exposes what the composite is allowed to ask for.
 */
export class OnlyPreviewStandaloneMount implements OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind = 'standalone';
  // A window can do all three. The Shell renders its own MenuBar controls from this.
  readonly chrome: OnlyPreviewMountChrome = { minimize: true, maximize: true, close: true };

  private container: View | null = null;
  private readonly resizeListeners = new Set<() => void>();
  private readonly activationListeners = new Set<(active: boolean) => void>();

  constructor(private readonly baseWindow: BaseWindow) {}

  attach(container: View): void {
    if (!this.isAlive()) return;
    this.container = container;
    this.baseWindow.contentView.addChildView(container);
    this.applyContainerBounds();
  }

  detach(): void {
    const container = this.container;
    this.container = null;
    if (!container || !this.isAlive()) return;
    try {
      // One detach for the whole composite: the layers are children of the container, so removing
      // the container takes them with it.
      this.baseWindow.contentView.removeChildView(container);
    } catch {
      // Electron may already have released the child view during window teardown.
    }
  }

  contentSize(): OnlyPreviewSurfaceSize | null {
    if (!this.isAlive()) return null;
    const [width, height] = this.baseWindow.getContentSize();
    return { width, height };
  }

  /**
   * Keep the container over the window's content rect and tell the composite to re-lay-out.
   *
   * Called by the owner on the window's `resize`, which is also what covers the asynchronous settle
   * of `maximize()` and `setFullScreen(true)` on macOS.
   */
  reportResize(): void {
    this.applyContainerBounds();
    for (const listener of this.resizeListeners) listener();
  }

  reportActivation(active: boolean): void {
    for (const listener of this.activationListeners) listener(active);
  }

  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  onActivation(listener: (active: boolean) => void): () => void {
    this.activationListeners.add(listener);
    return () => this.activationListeners.delete(listener);
  }

  window(): BaseWindow | null {
    return this.isAlive() ? this.baseWindow : null;
  }

  isAlive(): boolean {
    return !this.baseWindow.isDestroyed();
  }

  requestClose(): void {
    if (this.isAlive()) this.baseWindow.close();
  }

  reportTitle(title: string): void {
    if (this.isAlive()) this.baseWindow.setTitle(title);
  }

  dispose(): void {
    this.resizeListeners.clear();
    this.activationListeners.clear();
    this.container = null;
  }

  private applyContainerBounds(): void {
    const size = this.contentSize();
    if (!size || !this.container) return;
    this.container.setBounds({ x: 0, y: 0, ...size });
  }
}
