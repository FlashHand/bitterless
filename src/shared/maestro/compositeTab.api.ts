import type { BaseWindow, View } from 'electron'
import type { ViewRect } from './coach.api'

/**
 * What a Maestro tab offers a mini app whose content is not one web page.
 *
 * Maestro knows how to carry a native `View` in a tab; it does not know what is inside one. A host
 * mini app implements its own mount on top of this and registers a spec, so the dependency points
 * from the host into Maestro and never back — the direction `check:maestro`'s alias boundary exists
 * to keep. That is also why this lives in `maestro-shared` rather than beside the mini app: it is
 * Maestro's offer, expressed in Maestro's own terms.
 */
export interface MaestroCompositeTabHostApi {
  /** The window carrying the tab. For menu arbitration and parented dialogs, never for geometry. */
  window(): BaseWindow | null
  /** The rect Maestro reserves for tab content, or null before the renderer has measured one. */
  contentRect(): ViewRect | null
  /** Attach at the tab-view position, so the whole composite sits below Maestro's own chrome. */
  attach(container: View): void
  detach(container: View): void
  /** Bring this tab forward. */
  activate(): void
  /** Close this tab — not the window it lives in. */
  close(): void
  setTitle(title: string): void
  /** Whether this tab is still in the strip. */
  isOpen(): boolean
}

/** A registered composite mini app: how to build it into a tab, and how to take it down. */
export interface MaestroCompositeTabSpec {
  /** Stable id, also the tab kind: `'onlypreview'`. */
  id: string
  title: string
  favicon: string
  displayUrl: string
  /** Build the mini app onto this tab. Rejecting leaves no tab behind. */
  open(host: MaestroCompositeTabHostApi): Promise<void>
  /** The tab is gone; tear the mini app down. */
  close(): void
  /** The tab became, or stopped being, the foreground content. */
  setActive(active: boolean): void
  /** The tab's content rect changed. */
  refresh(): void
  /**
   * Show an absolute path inside the mini app, if it can (optional — most composites cannot).
   *
   * Declared here rather than reached for directly because `check:maestro`'s alias boundary forbids
   * Maestro from importing a mini app: Maestro owns the tab and knows nothing about what fills it,
   * so "open this folder in whatever is in that tab" has to arrive as a capability the host
   * supplied. The host is also the only side that can order the two steps correctly — the tab must
   * exist before the target is handed over.
   */
  openTarget?(absolutePath: string): Promise<void>
}
