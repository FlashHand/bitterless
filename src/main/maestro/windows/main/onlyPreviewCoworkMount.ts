import type { BaseWindow, View } from 'electron';
import type {
  OnlyPreviewMount,
  OnlyPreviewMountChrome,
  OnlyPreviewMountKind
} from '@main/onlypreview/onlyPreviewSurface.mount';
import type { OnlyPreviewSurfaceSize } from '@main/onlypreview/onlyPreviewSurfaceLayout';
import type { ViewRect } from '@maestro-shared/coach.api';

export interface OnlyPreviewCoworkMountDeps {
  /** The window carrying the tab. Used for menu arbitration and parented dialogs, never geometry. */
  window: () => BaseWindow | null;
  /** The rect Maestro reserves for tab content, measured by the Home renderer. */
  contentRect: () => ViewRect | null;
  /** Attach at the tab-view position so the whole composite sits below Maestro's chrome. */
  attach: (container: View) => void;
  detach: (container: View) => void;
  activate: () => void;
  closeTab: () => void;
  setTitle: (title: string) => void;
  isOpen: () => boolean;
}

/**
 * The OnlyPreview composite carried by a Maestro (Cowork) tab.
 *
 * Everything host-shaped in one place: the composite asks for an extent and gets the tab's content
 * rect, asks to be shown and gets its tab activated, asks to close and closes one tab rather than
 * the window everyone else's tabs live in.
 *
 * Two things it deliberately does not do. It never joins `MAESTRO_PARTITION` — the composite keeps
 * its own default-session views, its `bitterless-preview://` registration and its sandboxed content
 * preload, so an embedded OnlyPreview shares no cookies or storage with the remote pages in sibling
 * tabs. And it never reaches into Maestro's view order beyond the tab position it is given: the
 * composite's four layers are children of one container, so two independent stacks nest, and
 * OnlyPreview's own sort can never interleave with Maestro's chrome.
 */
export class OnlyPreviewCoworkMount implements OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind = 'cowork';
  // A tab has no traffic lights and no window of its own to minimize. Close is the tab's own close.
  readonly chrome: OnlyPreviewMountChrome = { minimize: false, maximize: false, close: true };

  private container: View | null = null;
  private visible = false;
  private lastBounds = '';
  private readonly resizeListeners = new Set<() => void>();
  private readonly activationListeners = new Set<(active: boolean) => void>();
  private readonly hostGoneListeners = new Set<() => void>();

  constructor(private readonly deps: OnlyPreviewCoworkMountDeps) {}

  attach(container: View): void {
    this.container = container;
    this.deps.attach(container);
    // Hidden until the tab is activated, exactly like every other tab view. Hiding the container
    // hides its children — measured on Electron 40.10.6 — while each layer keeps its own visibility
    // flag, so the composite's layer state survives a tab switch untouched.
    container.setVisible(this.visible);
    this.applyContainerBounds();
  }

  detach(): void {
    const container = this.container;
    this.container = null;
    if (!container) return;
    this.deps.detach(container);
  }

  contentSize(): OnlyPreviewSurfaceSize | null {
    const rect = this.deps.contentRect();
    if (!rect) return null;
    return { width: rect.width, height: rect.height };
  }

  refresh(): void {
    this.applyContainerBounds();
    for (const listener of this.resizeListeners) listener();
  }

  /** The host reporting that this tab is, or is no longer, the foreground content. */
  reportActivation(active: boolean): void {
    this.visible = active;
    if (this.container) this.container.setVisible(active);
    if (active) this.applyContainerBounds();
    for (const listener of this.activationListeners) listener(active);
  }

  /** The host reporting that this tab is gone. */
  reportHostGone(): void {
    for (const listener of [...this.hostGoneListeners]) listener();
  }

  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  onActivation(listener: (active: boolean) => void): () => void {
    this.activationListeners.add(listener);
    return () => this.activationListeners.delete(listener);
  }

  onHostGone(listener: () => void): () => void {
    this.hostGoneListeners.add(listener);
    return () => this.hostGoneListeners.delete(listener);
  }

  window(): BaseWindow | null {
    return this.deps.window();
  }

  isAlive(): boolean {
    return this.deps.isOpen() && Boolean(this.deps.window());
  }

  requestClose(): void {
    this.deps.closeTab();
  }

  showSurface(): void {
    this.deps.activate();
  }

  destroyHost(): void {
    this.deps.closeTab();
  }

  reportTitle(title: string): void {
    this.deps.setTitle(title);
  }

  dispose(): void {
    this.resizeListeners.clear();
    this.activationListeners.clear();
    this.hostGoneListeners.clear();
    this.container = null;
  }

  /**
   * Position the container over the tab's content rect, suppressing redundant rects.
   *
   * Same reason `createBoundsApplier` exists for Maestro's `WebContentsView`s — a ResizeObserver
   * reports the same rect repeatedly during a layout pass — but written out here because that helper
   * is typed for a web view and the composite's container is a plain `View`.
   */
  private applyContainerBounds(): void {
    const rect = this.deps.contentRect();
    const container = this.container;
    if (!rect || !container) return;
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (this.lastBounds === key) return;
    this.lastBounds = key;
    container.setBounds(bounds);
  }
}
