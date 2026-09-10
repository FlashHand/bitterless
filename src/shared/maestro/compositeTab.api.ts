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
  /**
   * 这个 tab 的地址栏该显示什么 —— 空串 = 退回注册时那个静态 `displayUrl`。
   *
   * 为什么需要它:composite tab 没有网页,地址栏原来永远显示注册时那一行
   * (`bitterless://only-preview`)。Ral 2026-09-10 要的是**看起来像真实浏览器** —— 里面在看哪个
   * 文件,地址栏就显示那个文件的 `file://`。而"在看哪个文件"只有 mini app 知道,所以和 `setTitle`
   * 同一类:mini app 把自己的状态推给承载它的 tab。
   * 见 `docs/features/onlypreview-address-bar-shows-file-url.md`。
   */
  setDisplayUrl(url: string): void
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
