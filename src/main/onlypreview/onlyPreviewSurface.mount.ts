import type { BaseWindow, View } from 'electron';
import type { OnlyPreviewSurfaceSize } from './onlyPreviewSurfaceLayout';

export type OnlyPreviewMountKind = 'standalone' | 'cowork';

/**
 * What the host can actually honour, so the Shell renders only that.
 *
 * A Cowork tab has no traffic lights and no window of its own to minimize; offering the controls
 * anyway would put buttons on screen whose only possible behaviour is to do nothing.
 */
export interface OnlyPreviewMountChrome {
  minimize: boolean;
  maximize: boolean;
  close: boolean;
}

/**
 * The seam between the OnlyPreview composite and whatever carries it.
 *
 * The composite owns a container `View` holding its four layers and knows its own size; it does not
 * know what that container is attached to. A host implements this interface and hands it in, so the
 * dependency points one way only: **nothing under `src/main/onlypreview/` may import a host.** That
 * is the same inversion the existing `OnlyPreviewGlobalSearchWindowService` and
 * `OnlyPreviewAlertWindowService` already use, where the owner supplies the window and the view
 * factory and the view service owns its own surface.
 *
 * Two implementations are intended: the standalone window, and a tab in the Maestro (Cowork)
 * browser window. A third — an Omni cell — is recorded as deferred in
 * `docs/plan/tasks/onlypreview-omni-embedding-026.md` and would be a third implementation here
 * rather than a rewrite.
 */
export interface OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind;
  readonly chrome: OnlyPreviewMountChrome;

  /** Put the composite's container where this host wants it, and size it. */
  attach(container: View): void;

  /** Release the container. The composite's views are not touched: this is not a teardown. */
  detach(): void;

  /**
   * The composite's extent, in the surface's own coordinate space — origin always `(0, 0)`, because
   * child bounds are relative to the container. `null` once the host is gone.
   */
  contentSize(): OnlyPreviewSurfaceSize | null;

  /** Fires whenever `contentSize` changes for any reason this host knows about. */
  onResize(listener: () => void): () => void;

  /** Fires when the composite becomes, or stops being, this host's foreground content. */
  onActivation(listener: (active: boolean) => void): () => void;

  /**
   * The window the composite currently lives in — for menu-accelerator arbitration and for
   * parenting the Settings and Guide windows. Never for geometry: that is `contentSize`.
   */
  window(): BaseWindow | null;

  /**
   * Whether the host is still there. `View` exposes no `isDestroyed()`, so the composite's services
   * ask this instead of interrogating a window they should not hold.
   */
  isAlive(): boolean;

  /** Close the composite the way this host closes things: a window, or one tab. */
  requestClose(): void;

  reportTitle(title: string): void;
}
