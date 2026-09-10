import { Menu, WebContentsView, clipboard } from 'electron'
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, View, WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { randomUUID } from 'crypto'
import { injectable } from 'inversify'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { DebuggerCapture } from '@maestro-main/capture/debuggerCapture'
import { chromeIdentity } from '@maestro-main/capture/chromeIdentity'
import { ReplayEngine } from '@maestro-main/drive/replayEngine'
import { normalizeUrl } from '@maestro-main/settings/coachSettings.service'
import { openOnlyPreviewAbsoluteTarget } from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service'
import { isAbsoluteFilePath } from '@shared/onlypreview/onlyPreviewTargetInput'
import { resolveLocalPathTarget } from './localPathTarget'
import { focusAddressBarForBlankTab } from './newTabFocus'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import type { NetworkInterceptionRule } from '@maestro-main/capture/networkInterception'
import type {
  AgentActivityStep,
  CaptureState,
  CoachSettings,
  InjectedButtonDomain,
  InjectedButtonRemoveResult,
  TabKind,
  TabInfo,
  WorkbenchTabState,
  ViewRect
} from '@maestro-shared/coach.api'
import { MAESTRO_LOCAL_HOME_DISPLAY_URL } from '@maestro-shared/coach.api'
import type { MaestroCompositeTabSpec } from '@maestro-shared/compositeTab.api'
import type { InjectBtnApi, InjectBtnEntry, InjectBtnInput } from '@maestro-shared/injectBtn.api'
import type { SavedTab } from '@maestro-shared/tabs.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { createBoundsApplier, maestroFirstFrameOperationRect } from './viewBounds'
import { getMaestroCompositeTab } from './compositeTab.registry'

export const shouldOpenOperationDevTools = (): boolean => {
  if (import.meta.env.VITE_MODE !== 'debug') return false
  if (process.env.BITTERLESS_E2E === '1') return false
  return process.env.COACH_DEVTOOLS === '1'
}

export const shouldOpenPinnedHomeDevTools = (): boolean => {
  if (import.meta.env.VITE_MODE !== 'debug') return false
  return process.env.BITTERLESS_E2E !== '1'
}

const LOCAL_HOME_TITLE = 'Home'
const LOCAL_HOME_FAVICON = ''
const ATTACH_BEFORE_NAVIGATE_TIMEOUT_MS = 3000
// Chromium may keep a page "loading" for a stalled subresource or never emit a stop event when
// its renderer dies. The tab spinner is only a status hint, so always settle it after this cap.
const LOAD_WATCHDOG_MS = 30_000
const INJECTED_BUTTON_ROOT_ID = '__bitterless_maestro_button_root__'
const injectBtnStore = createXpcMainEmitter<InjectBtnApi>('InjectBtnDao')

const isWorkbenchInternalUrl = (url: string): boolean => /^(?:bitterless|micromeet):\/\/workbench(?:[/?#].*)?$/i.test(url.trim())

interface LocalHomeEntry {
  url: string
  file?: string
}

const localHomeEntry = (): LocalHomeEntry => {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '')
    return { url: `${base}/maestro/localHome/index.html` }
  }
  const file = join(__dirname, '../renderer/maestro/localHome/index.html')
  return { url: pathToFileURL(file).toString(), file }
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const hostFromUrl = (url: string | undefined): string => {
  try {
    return new URL(url || '').hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const clipInline = (value: unknown, max: number): string => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

const awaitAttach = async (ready: Promise<void> | undefined): Promise<void> => {
  if (!ready) return
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      ready,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ATTACH_BEFORE_NAVIGATE_TIMEOUT_MS)
      })
    ])
  } catch {
    // The attach path already reports its own error; navigation remains the fallback.
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface ViewSlot {
  view: WebContentsView
  capture: DebuggerCapture
  replay: ReplayEngine
  attachReady?: Promise<void>
}

export interface OperationTab {
  id: string
  kind: TabKind
  view: WebContentsView | null
  /**
   * A composite mini-app's own container `View`, for a tab whose content is not one web page.
   *
   * `view` stays `null` for such a tab, which is what keeps it out of `enforceWarmCap` — its `warm`
   * filter only counts tabs with a live `view`. That matters: cooling an OnlyPreview tab would
   * detach the container while leaving its four renderers, its hidden search runtime, its bound
   * workspace and its host capability alive and unreachable.
   */
  surface?: View | null
  capture: DebuggerCapture | null
  replay: ReplayEngine | null
  attachReady?: Promise<void>
  coolingReady?: Promise<void>
  cooling?: boolean
  closeReady?: Promise<void>
  url: string
  title: string
  favicon: string
  debuggerEnabled: boolean
  pinned: boolean
  lastActive: number
  /** Page load in flight; projected to the tab chip instead of a global progress bar. */
  loading: boolean
  /** Hard cap for a missing did-stop-loading event. Cleared whenever the view loses ownership. */
  loadWatchdog: ReturnType<typeof setTimeout> | null
}

export interface MaestroBrowserViewServiceState {
  browserWindow: BrowserWindow | null
  operationView: WebContentsView | null
  capture: DebuggerCapture | null
  replayEngine: ReplayEngine | null
  currentUrl: string
  opBounds: ViewRect | null
  readonly capturing: boolean
  readonly captureTargetTabId: string | null
  tabsOpenedThisTurn: TabInfo[]
  readonly browserInterceptionRules: NetworkInterceptionRule[]

  emitTrace(event: TraceEvent): void
  layout(): void
  readMaestroSettings(): CoachSettings
  hasCustomStartUrl(): boolean
  openWorkbenchTab(): Promise<WorkbenchTabState>
  newTab(): Promise<void>
  stopCapture(): Promise<CaptureState>
  broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok?: boolean): void
  switchCaptureTarget(next: OperationTab): Promise<void>
  onCapturedEvent(event: TraceEvent, tabId: string): void
}

@injectable()
export class MaestroBrowserViewService extends CommonService<MaestroBrowserViewServiceState> {
  private readonly applyBounds = createBoundsApplier()

  tabs: OperationTab[] = []
  activeTabId: string | null = null
  private readonly MAX_WARM = 4
  private tabSeq = 0
  private startupTabOpened = false
  private spareSlot: ViewSlot | null = null
  private prewarming = false
  private creatingTab = false
  private injectedButtonNonces = new Map<string, string>()
  private readonly compositeTabs = new Map<string, MaestroCompositeTabSpec>()
  private lifecycleEpoch = 0

  createPinnedHomeTab(): WebContentsView {
    const view = this.buildPinnedHomeView()
    const entry = localHomeEntry()
    const first: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'home',
      view,
      capture: null,
      replay: null,
      url: entry.url,
      title: LOCAL_HOME_TITLE,
      favicon: LOCAL_HOME_FAVICON,
      debuggerEnabled: false,
      pinned: true,
      lastActive: Date.now(),
      loading: false,
      loadWatchdog: null
    }
    this.tabs.push(first)
    this.activeTabId = first.id
    this.setOperationView(view)
    this._state.capture = null
    this._state.replayEngine = null
    return view
  }

  async loadPinnedHomeTab(): Promise<void> {
    const tab = this.tabs.find((item) => item.kind === 'home' && item.pinned)
    const wc = tab?.view?.webContents
    if (!tab || !wc || wc.isDestroyed()) throw new Error('Bundled Home view is unavailable.')
    const entry = localHomeEntry()
    tab.url = entry.url
    if (entry.file) await wc.loadFile(entry.file)
    else await wc.loadURL(entry.url)
    this.sendTabNav(tab, true)
    this.broadcastTabs()
  }

  async openStartupTabIfNeeded(params?: { skipForThisBoot?: boolean }): Promise<void> {
    if (this.startupTabOpened) return
    this.startupTabOpened = true
    if (params?.skipForThisBoot) return
    const settings = this._state.readMaestroSettings()
    if (!this._state.hasCustomStartUrl()) return
    const url = settings.startUrl
    if (!url) return
    await this.openTab({ url }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'startup tab: ' + (err as Error).message, ts: Date.now() })
    })
  }

  async navigate(params: { url: string }): Promise<void> {
    if (isWorkbenchInternalUrl(params.url || '')) {
      await this._state.openWorkbenchTab()
      return
    }
    if (!this._state.operationView) return
    const active = this.tabs.find((tab) => tab.id === this.activeTabId)
    if (active?.kind !== 'browser') return
    // 本机绝对路径(Ral 2026-09-09,`docs/features/address-bar-local-path.md`)。
    //
    // **在** → 交给 OnlyPreview。这里落的是**独立窗口**,而 micromeet-cowork 那边落 mini-app tab ——
    // 那是刻意的分歧:bitterless 的 OnlyPreview 本来就是一个一等窗口,在 tab 里再造一个预览面等于
    // 同一件事有两个入口。判据本身两仓共用(`@shared/onlypreview/onlyPreviewTargetInput`,那一面
    // 逐字节等同),分歧只在落点。
    //
    // **不在** → 落一发 `file://`,让 Chromium 出它自己的「文件不存在」页 —— 也就是网页那条路上
    // 一次失败加载的落地页,Ral 要的「和网页共用不存在的组件」。
    const raw = (params.url || '').trim()
    const isLocalPath = isAbsoluteFilePath(raw)
    let localFileUrl = ''
    if (isLocalPath) {
      const local = resolveLocalPathTarget(raw)
      if (local.kind === 'preview') {
        await openOnlyPreviewAbsoluteTarget(local.path)
        return
      }
      // `chrome` 与 `missing` 都落到下面那一发 `file://`:一个是 Chromium 自己渲染这个文件,
      // 一个是 Chromium 自己的「文件不存在」页 —— 同一条加载路径,两种落地页都不是我们画的。
      localFileUrl = local.fileUrl
    }
    // 路径那一支**不能**过 `normalizeUrl` —— 它会把 `/Users/…` 补成 `https:///Users/…`,
    // 落地是一张无解的错误页,而不是「这个文件不存在」。
    const target = isLocalPath ? localFileUrl : normalizeUrl(params.url)
    if (!target) return
    await this._state.operationView.webContents.loadURL(target).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'navigate: ' + (err as Error).message, ts: Date.now() })
    })
  }

  async reload(): Promise<void> {
    const active = this.getActiveTab()
    if (!active) return
    const wc = active.view?.webContents
    if (!wc || wc.isDestroyed()) {
      await this.warmAndLoad(active)
      return
    }
    wc.reload()
  }

  async goBack(): Promise<void> {
    const active = this.getActiveTab()
    if (!active || active.kind !== 'browser') return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoBack()) return
    wc.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    const active = this.getActiveTab()
    if (!active || active.kind !== 'browser') return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoForward()) return
    wc.navigationHistory.goForward()
  }

  async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]> {
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return await this.getTabs()
    if (tab.kind !== 'browser') return await this.getTabs()
    const enabled = Boolean(params.enabled)
    if (tab.debuggerEnabled !== enabled) {
      if (!enabled && this._state.capturing && this._state.captureTargetTabId === tab.id) {
        await this._state.stopCapture()
      }
      tab.debuggerEnabled = enabled
      if (tab.capture && tab.view && !tab.view.webContents.isDestroyed()) {
        if (enabled) {
          tab.attachReady = tab.capture.resume().catch((err) => {
            this._state.emitTrace({ kind: 'error', msg: 'debugger attach: ' + (err as Error).message, ts: Date.now() })
          })
          await tab.attachReady
        } else {
          tab.capture.suspend()
          tab.attachReady = undefined
        }
      }
    }
    this.broadcastTabs()
    return await this.getTabs()
  }

  openOperationDevTools(): void {
    if (!shouldOpenOperationDevTools()) return
    if (this.getActiveTab()?.kind !== 'browser') return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || wc.isDevToolsOpened()) return
    try {
      wc.openDevTools({ mode: 'detach', activate: false })
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'operation devtools: ' + (err as Error).message, ts: Date.now() })
    }
  }

  async listInjectedButtons(): Promise<InjectedButtonDomain[]> {
    const entries = await injectBtnStore.list({})
    return groupInjectedButtonDomains(entries)
  }

  async removeInjectedButtonDomain(params: { domain: string }): Promise<InjectedButtonRemoveResult> {
    const domain = normalizeInjectedButtonDomain(params.domain)
    if (!domain) return { ok: false, domain: '', removed: 0, unInjected: 0, error: 'Missing domain' }
    const removed = await injectBtnStore.removeDomain({ domain })
    const unInjected = await this.removeInjectedButtonFromTabs(domain)
    this.injectedButtonNonces.delete(domain)
    xpcMain.broadcast('coach/injected-buttons-changed', { domain, ts: Date.now() })
    return {
      ok: removed.ok,
      domain,
      removed: removed.count,
      unInjected,
      error: removed.ok ? undefined : 'Could not remove injected button rows'
    }
  }

  /**
   * `operationView` 的**唯一写入口**。
   *
   * 收成一个口子是为了圆角:原生圆角按 view 设,而后台 view 错过了它不在前台时的每一次 control
   * 翻转 —— 所以"成为前台内容"这件事本身必须补一次。这条路有三个入口(固有 Home 装配、切到
   * composite 时置空、切到网页 tab),散着挂钩子必然漏一条,漏掉的症状是"某个 tab 切回来是方角",
   * 而且**不报错**。
   */
  private setOperationView(view: WebContentsView | null): void {
    this._state.operationView = view
  }

  layout(bounds: { x: number; y: number; width: number; height: number }): void {
    this.setBounds(bounds)
  }

  setBounds(rect: ViewRect): void {
    this.applyBounds(this._state.operationView, rect)
  }

  private addTab(meta: { url?: string; title?: string; favicon?: string }): OperationTab {
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      view: null,
      capture: null,
      replay: null,
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: 0,
      loading: false,
      loadWatchdog: null
    }
    this.tabs.push(tab)
    return tab
  }

  private buildViewSlot(): ViewSlot {
    const view = new WebContentsView({ webPreferences: { partition: MAESTRO_PARTITION } })
    view.setBackgroundColor('#d9ecff')
    view.webContents.setUserAgent(chromeIdentity().userAgent)
    this._state.browserWindow?.contentView.addChildView(view, 0)
    view.setVisible(false)
    const capture = new DebuggerCapture(
      view.webContents,
      (event) => {
        const owner = this.ownerOf(view)
        if (owner) this._state.onCapturedEvent(event, owner.id)
      },
      () => this._state.capturing && this.ownerOf(view)?.id === this._state.captureTargetTabId
    )
    void capture.setInterceptionRules(this._state.browserInterceptionRules)
    const replay = new ReplayEngine(view.webContents)
    this.attachViewListeners(view)
    return { view, capture, replay }
  }

  /**
   * Open a registered composite mini app as a tab, or bring the existing one forward.
   *
   * The tab carries the mini app's own container view instead of a web view, so `view` stays `null`
   * and every path that reaches for `tab.view` skips it — including the warm cap, which must never
   * cool a whole sub-application. Nothing here knows which mini app it is: the host registered a
   * spec, and this drives it.
   */
  /**
   * Open a composite tab and show `path` inside it (Ral 2026-09-07: the chat workspace chip should
   * land in OnlyPreview, not in a folder picker).
   *
   * Both steps here rather than in the caller, because the ORDER is load-bearing and easy to get
   * backwards: the tab has to exist before the target is handed over, or the mini app's own
   * "ensure a host" path finds none and opens a standalone window instead of filling the tab.
   * Maestro still learns nothing about what is in the tab — `openTarget` is a capability the host
   * registered with the spec.
   */
  async openCompositeTabTarget(params: {
    id: string
    path: string
  }): Promise<{ ok: boolean; error?: string }> {
    const target = String(params?.path || '').trim()
    if (!target) return { ok: false, error: 'A path is required.' }
    try {
      const tab = await this.openCompositeTab({ id: params.id })
      if (!tab) return { ok: false, error: `No composite tab is registered as '${params.id}'.` }
      const spec = this.compositeTabs.get(tab.id)
      if (!spec?.openTarget) {
        return { ok: false, error: `'${params.id}' cannot open a path.` }
      }
      await spec.openTarget(target)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  async openCompositeTab(params: { id: string }): Promise<OperationTab | null> {
    const spec = getMaestroCompositeTab(params.id)
    if (!spec) return null
    const existing = this.tabs.find((tab) => tab.kind === spec.id)
    if (existing) {
      await this.activateTab({ id: existing.id })
      return existing
    }
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: spec.id as TabKind,
      view: null,
      surface: null,
      capture: null,
      replay: null,
      url: '',
      title: spec.title,
      favicon: spec.favicon,
      debuggerEnabled: false,
      pinned: false,
      lastActive: Date.now(),
      loading: false,
      loadWatchdog: null
    }
    this.tabs.push(tab)
    this.compositeTabs.set(tab.id, spec)
    try {
      await spec.open({
        window: () => this._state.browserWindow,
        contentRect: () => this._state.opBounds ?? this.firstFrameOperationRect(),
        attach: (container) => {
          tab.surface = container
          // Index 0 is the tab-view position, so the whole composite sits below Maestro's chrome and
          // control sidebar by construction — no re-assertion rule needed.
          this._state.browserWindow?.contentView.addChildView(container, 0)
        },
        detach: (container) => {
          if (tab.surface === container) tab.surface = null
          try {
            this._state.browserWindow?.contentView.removeChildView(container)
          } catch {
            // The parent window may already have released the child view.
          }
        },
        activate: () => void this.activateTab({ id: tab.id }),
        close: () => void this.closeTab({ id: tab.id }),
        setTitle: (title) => {
          tab.title = title || spec.title
          this.broadcastTabs()
        },
        isOpen: () => this.tabs.includes(tab)
      })
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: `composite tab ${spec.id}: ` + (err as Error).message, ts: Date.now() })
      this.compositeTabs.delete(tab.id)
      const index = this.tabs.indexOf(tab)
      if (index >= 0) this.tabs.splice(index, 1)
      this.broadcastTabs()
      throw err
    }
    await this.activateTab({ id: tab.id })
    return tab
  }

  /**
   * The rect a tab's content occupies before the Home renderer has measured one.
   *
   * A web tab can afford to wait — it is loading anyway. A composite tab cannot: with no rect its
   * container gets no bounds, and a zero-size container hides its children, so the mini app would
   * open to nothing at all.
   */
  private firstFrameOperationRect(): ViewRect | null {
    const win = this._state.browserWindow
    if (!win) return null
    const [width, height] = win.getContentSize()
    return maestroFirstFrameOperationRect(width, height)
  }

  /**
   * Re-position every composite tab after the host reports new content bounds.
   *
   * Web tab views are moved by `setBounds` on the active view; a composite tab is moved by its own
   * mini app, and nothing else in this file knows how to reach it.
   */
  refreshCompositeTabs(): void {
    for (const spec of this.compositeTabs.values()) spec.refresh()
  }

  private buildPinnedHomeView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/maestroLocalHome.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: MAESTRO_PARTITION
      }
    })
    view.setBackgroundColor('#f4f6ff')
    this._state.browserWindow?.contentView.addChildView(view, 0)
    view.setVisible(false)
    this.attachViewListeners(view)
    return view
  }

  /** Hide a tab's content, whichever kind of content it has. */
  private hideTabContent(tab: OperationTab): void {
    const composite = this.compositeTabs.get(tab.id)
    if (composite) {
      composite.setActive(false)
      return
    }
    if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.setVisible(false)
  }

  private ownerOf(view: WebContentsView): OperationTab | undefined {
    return this.tabs.find((tab) => tab.view === view)
  }

  private ownerOfWebContents(wc: WebContents): OperationTab | undefined {
    return this.tabs.find((tab) => tab.view?.webContents === wc)
  }

  getActiveTab(): OperationTab | undefined {
    return this.activeTabId ? this.tabs.find((tab) => tab.id === this.activeTabId) : undefined
  }

  private isPinnedHomeTab(tab?: OperationTab): boolean {
    return Boolean(tab?.pinned && tab.kind === 'home')
  }

  private openPinnedHomeDevTools(tab: OperationTab | undefined, view: WebContentsView | null): void {
    if (!shouldOpenPinnedHomeDevTools()) return
    if (!tab || !view || !this.isPinnedHomeTab(tab) || !this.isLiveTabView(tab, view)) return
    const wc = view.webContents
    if (wc.isDevToolsOpened()) return
    try {
      wc.openDevTools({ mode: 'detach', activate: false })
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'Home devtools: ' + (err as Error).message, ts: Date.now() })
    }
  }

  private isAllowedPinnedHomeNavigation(tab: OperationTab, url: string): boolean {
    const withoutHash = (value: string): string => value.replace(/#.*$/, '')
    return withoutHash(url) === withoutHash(tab.url)
  }

  private preventPinnedHomeEscape(tab: OperationTab | undefined, url: string): boolean {
    if (!tab || !this.isPinnedHomeTab(tab)) return false
    if (this.isAllowedPinnedHomeNavigation(tab, url)) return false
    this._state.emitTrace({ kind: 'info', msg: `blocked bundled Home navigation · ${url}`, ts: Date.now() })
    return true
  }

  private isLiveTabView(tab: OperationTab, view: WebContentsView, epoch = this.lifecycleEpoch): boolean {
    return (
      this.lifecycleEpoch === epoch &&
      !tab.cooling &&
      this.tabs.includes(tab) &&
      tab.view === view &&
      !view.webContents.isDestroyed()
    )
  }

  async prewarmSpare(): Promise<void> {
    if (this.spareSlot || this.prewarming) return
    this.prewarming = true
    try {
      const slot = this.buildViewSlot()
      slot.attachReady = slot.capture.attach().catch((err) => {
        this._state.emitTrace({ kind: 'error', msg: 'spare view attach: ' + (err as Error).message, ts: Date.now() })
      })
      this.spareSlot = slot
    } finally {
      this.prewarming = false
    }
  }

  private async ensureWarm(tab: OperationTab): Promise<void> {
    if (tab.cooling) throw new Error('Tab is cooling down.')
    if (tab.view && !tab.view.webContents.isDestroyed()) return
    if (tab.kind === 'home') {
      const entry = localHomeEntry()
      tab.url = entry.url
      tab.view = this.buildPinnedHomeView()
      tab.capture = null
      tab.replay = null
      tab.attachReady = undefined
      tab.debuggerEnabled = false
      tab.lastActive = Date.now()
      return
    }
    let slot = this.spareSlot
    if (slot) {
      this.spareSlot = null
    } else {
      slot = this.buildViewSlot()
      slot.attachReady = slot.capture.attach().catch((err) => {
        this._state.emitTrace({ kind: 'error', msg: 'warm view attach: ' + (err as Error).message, ts: Date.now() })
      })
    }
    tab.view = slot.view
    tab.capture = slot.capture
    tab.replay = slot.replay
    tab.attachReady = slot.attachReady
    if (!tab.debuggerEnabled) tab.capture.suspend()
    tab.lastActive = Date.now()
    void this.prewarmSpare()
    await this.enforceWarmCap()
  }

  async warmAndLoad(tab: OperationTab): Promise<void> {
    const wasCold = !tab.view || tab.view.webContents.isDestroyed()
    await this.ensureWarm(tab)
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return
    if (wasCold && tab.url && wc.getURL() !== tab.url) {
      await awaitAttach(tab.attachReady)
      await wc.loadURL(tab.url).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'warm load: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
  }

  private coolTab(tab: OperationTab): Promise<void> {
    if (tab.coolingReady) return tab.coolingReady
    const cooling = this.performCoolTab(tab)
    tab.coolingReady = cooling
    void cooling.then(
      () => {
        if (tab.coolingReady === cooling) tab.coolingReady = undefined
      },
      () => {
        if (tab.coolingReady === cooling) tab.coolingReady = undefined
      }
    )
    return cooling
  }

  private async performCoolTab(tab: OperationTab): Promise<void> {
    tab.cooling = true
    const view = tab.view
    const capture = tab.capture

    // The old view cannot promise a stop event after this point. Settle before detaching ownership.
    this.setTabLoading(tab, false)

    // Drop the old slot from the tab before touching it, so nothing can pick it back up.
    tab.view = null
    tab.capture = null
    tab.replay = null
    tab.attachReady = undefined

    try {
      capture?.detach()
    } catch {
      // Already detached.
    }
    if (view) {
      try {
        this._state.browserWindow?.contentView.removeChildView(view)
      } catch {
        // The parent window may already have released the child view.
      }
      try {
        view.webContents.close()
      } catch {
        // Best effort.
      }
    }
    tab.cooling = false
  }

  private async enforceWarmCap(extraProtectedIds: string[] = []): Promise<void> {
    const warm = this.tabs.filter((tab) => tab.view && !tab.view.webContents.isDestroyed())
    if (warm.length <= this.MAX_WARM) return
    const protectedIds = new Set<string>([
      ...(this.activeTabId ? [this.activeTabId] : []),
      ...(this._state.captureTargetTabId ? [this._state.captureTargetTabId] : []),
      ...this._state.tabsOpenedThisTurn.map((tab) => tab.id),
      ...extraProtectedIds
    ])
    const evictable = warm
      .filter((tab) => !tab.pinned && !protectedIds.has(tab.id))
      .sort((a, b) => a.lastActive - b.lastActive)
    let over = warm.length - this.MAX_WARM
    for (const tab of evictable) {
      if (over <= 0) break
      await this.coolTab(tab)
      over -= 1
    }
  }

  async restoreTabs(params: { tabs: SavedTab[] }): Promise<void> {
    if (this.tabs.some((tab) => !tab.pinned)) return
    for (const tab of params.tabs) {
      if (tab.url) this.addTab({ url: tab.url, title: tab.title, favicon: tab.favicon })
    }
    this.broadcastTabs()
  }

  private attachViewListeners(view: WebContentsView): void {
    const wc = view.webContents
    wc.on('will-navigate', (event) => {
      if (this.preventPinnedHomeEscape(this.ownerOf(view), event.url)) event.preventDefault()
    })
    wc.on('will-redirect', (event) => {
      const tab = this.ownerOf(view)
      if (event.isMainFrame && this.preventPinnedHomeEscape(tab, event.url)) event.preventDefault()
    })
    wc.on('did-navigate', (_event, url) => {
      const tab = this.ownerOf(view)
      if (!tab || url === 'about:blank') return
      if (tab.kind !== 'home') tab.url = url
      if (this.activeTabId === tab.id || this._state.captureTargetTabId === tab.id) this.sendTabNav(tab, true)
      this.broadcastTabs()
    })
    wc.on('did-navigate-in-page', (event, url) => {
      const tab = this.ownerOf(view)
      if (!tab || !event.isMainFrame) return
      if (tab.kind !== 'home') tab.url = url
      if (this.activeTabId === tab.id || this._state.captureTargetTabId === tab.id) this.sendTabNav(tab, false)
      this.broadcastTabs()
    })
    wc.on('page-title-updated', (_event, title) => {
      const tab = this.ownerOf(view)
      if (!tab) return
      if (tab.kind === 'browser') {
        tab.title = title
        if (this.activeTabId === tab.id) this.sendTitle(title)
      }
      this.broadcastTabs()
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      const tab = this.ownerOf(view)
      if (!tab || tab.kind !== 'browser') return
      if (Array.isArray(favicons) && favicons[0]) {
        tab.favicon = favicons[0]
        this.broadcastTabs()
      }
    })
    wc.on('did-start-loading', () => {
      const tab = this.ownerOf(view)
      if (tab) this.setTabLoading(tab, true)
    })
    wc.on('did-stop-loading', () => {
      const tab = this.ownerOf(view)
      if (tab) this.setTabLoading(tab, false)
    })
    wc.on('did-fail-load', (_event, _errorCode, _errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame) return
      const tab = this.ownerOf(view)
      if (tab) this.setTabLoading(tab, false)
    })
    wc.on('render-process-gone', () => {
      const tab = this.ownerOf(view)
      if (tab) this.setTabLoading(tab, false)
    })
    wc.on('did-finish-load', () => {
      const tab = this.ownerOf(view)
      if (this.isPinnedHomeTab(tab)) this.openPinnedHomeDevTools(tab, view)
      if (tab?.kind === 'browser') void this.injectStoredButtonForTab(tab)
    })
    wc.setWindowOpenHandler((details) => {
      if (this.handleInjectedButtonOpen(details.url)) return { action: 'deny' }
      if (/^https?:\/\//i.test(details.url)) {
        const url = details.url
        queueMicrotask(() => void this.openTabWithUrl(url))
      }
      return { action: 'deny' }
    })
    wc.on('context-menu', (_event, params) => this.showPageMenu(wc, params))
  }

  private sendNav(url: string, resetTitle = false): void {
    this._state.currentUrl = url
    xpcMain.broadcast('coach/nav', url)
    if (resetTitle) xpcMain.broadcast('coach/title', '')
    this.broadcastNavState()
  }

  private displayUrl(tab: OperationTab): string {
    if (tab.kind === 'home') return MAESTRO_LOCAL_HOME_DISPLAY_URL
    if (tab.kind === 'onlypreview') return this.compositeTabs.get(tab.id)?.displayUrl ?? ''
    return tab.url
  }

  private sendTabNav(tab: OperationTab, resetTitle = false): void {
    this.sendNav(this.displayUrl(tab), resetTitle)
  }

  private sendTitle(title: string): void {
    xpcMain.broadcast('coach/title', String(title || ''))
  }

  private broadcastNavState(): void {
    const active = this.getActiveTab()
    const wc = this._state.operationView?.webContents
    const live = wc && !wc.isDestroyed() ? wc : null
    const historyLocked = active?.kind !== 'browser'
    xpcMain.broadcast('coach/nav-state', {
      canGoBack: !historyLocked && live ? live.navigationHistory.canGoBack() : false,
      canGoForward: !historyLocked && live ? live.navigationHistory.canGoForward() : false
    })
  }

  async showTabMenu(params: { id: string }): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return
    const index = this.tabs.findIndex((tab) => tab.id === params.id)
    if (index < 0) return
    const tab = this.tabs[index]
    const canClose = !tab.pinned && this.tabs.length > 1
    const canDuplicate = tab.kind === 'browser' && !tab.pinned && Boolean(tab.url)
    const otherClosable = this.tabs.some((item) => item.id !== tab.id && !item.pinned)
    const rightClosable = this.tabs.slice(index + 1).some((item) => !item.pinned)
    const menu = Menu.buildFromTemplate([
      { label: 'New tab', click: () => void this._state.newTab() },
      { type: 'separator' },
      {
        label: 'Reload',
        click: () => {
          if (tab.view && !tab.view.webContents.isDestroyed()) {
            tab.view.webContents.reload()
          } else {
            void this.warmAndLoad(tab)
          }
        }
      },
      { label: 'Duplicate', enabled: canDuplicate, click: () => void this.openTabWithUrl(tab.url) },
      { type: 'separator' },
      { label: 'Close', enabled: canClose, click: () => void this.closeTab({ id: tab.id }) },
      { label: 'Close other tabs', enabled: otherClosable, click: () => void this.closeTabsExcept(tab.id) },
      { label: 'Close tabs to the right', enabled: rightClosable, click: () => void this.closeTabsToRight(tab.id) }
    ])
    menu.popup({ window: win })
  }

  private async closeTabsExcept(keepId: string): Promise<void> {
    const ids = this.tabs.filter((tab) => tab.id !== keepId && !tab.pinned).map((tab) => tab.id)
    for (const id of ids) await this.closeTab({ id })
  }

  private async closeTabsToRight(afterId: string): Promise<void> {
    const index = this.tabs.findIndex((tab) => tab.id === afterId)
    if (index < 0) return
    const ids = this.tabs
      .slice(index + 1)
      .filter((tab) => !tab.pinned)
      .map((tab) => tab.id)
    for (const id of ids) await this.closeTab({ id })
  }

  private showPageMenu(wc: WebContents, params: ContextMenuParams): void {
    const win = this._state.browserWindow
    if (!win) return
    const nav = wc.navigationHistory
    const owner = this.ownerOfWebContents(wc)
    const historyLocked = owner?.kind !== 'browser'
    const sections: MenuItemConstructorOptions[][] = [
      [
        { label: 'Back', enabled: !historyLocked && nav.canGoBack(), click: () => void this.goBack() },
        { label: 'Forward', enabled: !historyLocked && nav.canGoForward(), click: () => void this.goForward() },
        { label: 'Reload', click: () => wc.reload() }
      ]
    ]
    if (params.linkURL) {
      sections.push([
        { label: 'Open link in new tab', click: () => void this.openTabWithUrl(params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) }
      ])
    }
    if (params.mediaType === 'image' && params.srcURL) {
      sections.push([
        { label: 'Open image in new tab', click: () => void this.openTabWithUrl(params.srcURL) },
        { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) },
        { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }
      ])
    }
    if (params.isEditable) {
      const flags = params.editFlags
      sections.push([
        { label: 'Cut', enabled: flags.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: flags.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: flags.canPaste, click: () => wc.paste() },
        { label: 'Select all', enabled: flags.canSelectAll, click: () => wc.selectAll() }
      ])
    } else if (params.selectionText) {
      sections.push([{ label: 'Copy', click: () => wc.copy() }])
    }
    if (is.dev && owner?.kind === 'browser') {
      sections.push([{ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) }])
    }
    const template: MenuItemConstructorOptions[] = []
    for (const section of sections) {
      if (template.length) template.push({ type: 'separator' })
      template.push(...section)
    }
    Menu.buildFromTemplate(template).popup({ window: win })
  }

  private async claimSpareTab(meta: { url?: string; title?: string; favicon?: string }): Promise<OperationTab> {
    let slot = this.spareSlot
    this.spareSlot = null
    if (!slot || slot.view.webContents.isDestroyed()) {
      slot = this.buildViewSlot()
      slot.attachReady = slot.capture.attach().catch((err) => {
        this._state.emitTrace({ kind: 'error', msg: 'tab attach: ' + (err as Error).message, ts: Date.now() })
      })
    }
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      view: slot.view,
      capture: slot.capture,
      replay: slot.replay,
      attachReady: slot.attachReady,
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: Date.now(),
      loading: false,
      loadWatchdog: null
    }
    this.tabs.push(tab)
    void this.prewarmSpare()
    await this.enforceWarmCap([tab.id])
    return tab
  }

  private async openTabWithUrl(url: string): Promise<OperationTab> {
    const tab = await this.claimSpareTab({ url })
    this._state.tabsOpenedThisTurn.push({
      id: tab.id,
      kind: tab.kind,
      url,
      title: '',
      active: true,
      pinned: false,
      favicon: '',
      debuggerEnabled: tab.debuggerEnabled,
      debuggerAttached: Boolean(tab.capture?.isAttached()),
      loading: tab.loading
    })
    this._state.broadcastActivity('tab', `opened tab · ${hostnameOf(url) || url}`)
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      await awaitAttach(tab.attachReady)
      await wc.loadURL(url).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'tab load: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
    return tab
  }

  async newTab(): Promise<void> {
    if (this.creatingTab) return
    this.creatingTab = true
    try {
      const tab = await this.claimSpareTab({})
      await this.activateTab({ id: tab.id })
      // 必须排在 activateTab 之后:抢焦点的不是某个 view 主动 focus,而是 activateTab 里
      // `previous.view.setVisible(false)` 把焦点丢掉 —— 先聚焦就会被那一行抹掉。空白 tab 的
      // `needsLoad` 恒为 false,所以 activateTab 返回之后不再有导航把焦点带走(契约 #3.3)。
      focusAddressBarForBlankTab(this._state.browserWindow)
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'new tab: ' + (err as Error).message, ts: Date.now() })
    } finally {
      this.creatingTab = false
    }
  }

  async closeActiveTab(): Promise<void> {
    if (this.activeTabId) await this.closeTab({ id: this.activeTabId })
  }

  async openTab(params: { url: string }): Promise<void> {
    const url = (params.url || '').trim()
    if (!url) {
      await this.newTab()
      return
    }
    if (isWorkbenchInternalUrl(url)) {
      await this._state.openWorkbenchTab()
      return
    }
    const tab = await this.claimSpareTab({ url })
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      await wc.loadURL(url).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'open tab: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
  }

  drainNewTabsNote(): string {
    if (this._state.tabsOpenedThisTurn.length === 0) return ''
    const opened = this._state.tabsOpenedThisTurn.splice(0)
    const lines = opened.map((tab) => `  - tab_id=${tab.id} url=${tab.url}`)
    return (
      `\n\nNOTE: ${opened.length} new browser tab(s) opened during this action — likely a ` +
      `result/confirmation page:\n${lines.join('\n')}\n` +
      `Inspect one with page_snapshot {"tab_id":"<tab_id>"} (does NOT change the active tab), ` +
      `or activate_tab to switch to it.`
    )
  }

  async activateTab(params: { id: string }): Promise<void> {
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return
    // A composite mini-app tab has no web view to warm, load, capture or replay. Hiding the outgoing
    // tab and telling this one's mount it is foreground is the whole switch: hiding a container
    // hides its children, and each layer keeps its own visibility flag, so the composite's layer
    // state survives the round trip.
    const composite = this.compositeTabs.get(tab.id)
    if (composite) {
      const previous = this.tabs.find((item) => item.id === this.activeTabId)
      if (previous && previous.id !== tab.id) this.hideTabContent(previous)
      this.activeTabId = tab.id
      tab.lastActive = Date.now()
      this.setOperationView(null)
      this._state.capture = null
      this._state.replayEngine = null
      composite.setActive(true)
      this.sendTabNav(tab)
      this.sendTitle(tab.title)
      this.broadcastTabs()
      return
    }
    // Leaving a composite tab: it is not the `previous` branch below, because that one only knows
    // how to hide a `WebContentsView`.
    const leaving = this.tabs.find((item) => item.id === this.activeTabId)
    if (leaving && leaving.id !== tab.id) this.compositeTabs.get(leaving.id)?.setActive(false)
    if (this.activeTabId === tab.id && tab.view && !tab.view.webContents.isDestroyed()) {
      if (this.isPinnedHomeTab(tab)) this.openPinnedHomeDevTools(tab, tab.view)
      tab.lastActive = Date.now()
      this.broadcastTabs()
      return
    }
    let needsLoad = false
    if (!tab.view || tab.view.webContents.isDestroyed()) {
      try {
        await this.ensureWarm(tab)
      } catch (err) {
        this._state.emitTrace({ kind: 'error', msg: 'activate: warm failed — ' + (err as Error).message, ts: Date.now() })
      }
      if (!tab.view || tab.view.webContents.isDestroyed()) {
        this.broadcastTabs()
        return
      }
      needsLoad = Boolean(tab.url) && tab.view.webContents.getURL() !== tab.url
    }
    const previous = this.tabs.find((item) => item.id === this.activeTabId)
    if (previous && previous.id !== tab.id && previous.view && !previous.view.webContents.isDestroyed()) {
      previous.view.setVisible(false)
    }
    this.activeTabId = tab.id
    tab.lastActive = Date.now()
    this.setOperationView(tab.view)
    await this._state.switchCaptureTarget(tab)
    this._state.capture = tab.kind === 'browser' ? tab.capture : null
    this._state.replayEngine = tab.kind === 'browser' ? tab.replay : null
    this._state.currentUrl = this.displayUrl(tab) || this._state.currentUrl
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.setVisible(true)
      if (this.isPinnedHomeTab(tab)) this.openPinnedHomeDevTools(tab, tab.view)
      if (this._state.opBounds) this.applyBounds(tab.view, this._state.opBounds)
      else this._state.layout()
      if (needsLoad) {
        const wc = tab.view.webContents
        void awaitAttach(tab.attachReady)
          .then(() => (wc.isDestroyed() ? undefined : wc.loadURL(tab.url)))
          .catch((err) => {
            if (!wc.isDestroyed()) {
              this._state.emitTrace({ kind: 'error', msg: 'tab load: ' + (err as Error).message, ts: Date.now() })
            }
          })
      }
    }
    xpcMain.broadcast('coach/nav', this.displayUrl(tab))
    xpcMain.broadcast('coach/title', tab.title || '')
    this.broadcastNavState()
    this.broadcastTabs()
  }

  async reorderTabs(params: { ids: string[] }): Promise<void> {
    const ids = Array.isArray(params.ids) ? params.ids.filter((id) => typeof id === 'string') : []
    if (!ids.length) return
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length !== this.tabs.length) return
    const byId = new Map(this.tabs.map((tab) => [tab.id, tab]))
    if (uniqueIds.some((id) => !byId.has(id))) return
    const pinned = this.tabs.filter((tab) => tab.pinned)
    const reordered = uniqueIds.map((id) => byId.get(id)!).filter((tab) => !tab.pinned)
    if (reordered.length !== this.tabs.length - pinned.length) return
    const next = [...pinned, ...reordered]
    if (next.every((tab, index) => tab.id === this.tabs[index]?.id)) return
    this.tabs = next
    this.broadcastTabs()
  }

  async closeTab(params: { id: string }): Promise<void> {
    if (this.tabs.length <= 1) return
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return
    if (tab.pinned) return
    if (tab.closeReady) return await tab.closeReady
    const closing = this.performCloseTab(tab)
    tab.closeReady = closing
    try {
      await closing
    } finally {
      if (tab.closeReady === closing) tab.closeReady = undefined
    }
  }

  private async performCloseTab(tab: OperationTab): Promise<void> {
    // A composite tab owns a whole sub-application, so closing it must reach that sub-application's
    // own teardown — cooling a web view it does not have would silently orphan four renderers, a
    // hidden search runtime and a bound workspace.
    const composite = this.compositeTabs.get(tab.id)
    if (composite) {
      const index = this.tabs.indexOf(tab)
      if (index >= 0) this.tabs.splice(index, 1)
      this.compositeTabs.delete(tab.id)
      composite.close()
      const wasActive = this.activeTabId === tab.id
      if (wasActive) {
        const next = this.tabs[index] || this.tabs[this.tabs.length - 1]
        this.activeTabId = null
        if (next) await this.activateTab({ id: next.id })
      } else {
        this.broadcastTabs()
      }
      return
    }
    // Closing can wait on capture teardown; never leave a watchdog armed during that interval.
    this.setTabLoading(tab, false)
    if (this._state.capturing && this._state.captureTargetTabId === tab.id) {
      await this._state.stopCapture()
    }
    await this.coolTab(tab)
    const index = this.tabs.indexOf(tab)
    if (index < 0) return
    const wasActive = this.activeTabId === tab.id
    this.tabs.splice(index, 1)
    if (wasActive) {
      const next = this.tabs[index] || this.tabs[this.tabs.length - 1]
      this.activeTabId = null
      if (next) await this.activateTab({ id: next.id })
    } else {
      this.broadcastTabs()
    }
  }

  async getTabs(): Promise<TabInfo[]> {
    return this.tabs.map((tab) => this.tabInfo(tab))
  }

  private broadcastTabs(): void {
    xpcMain.broadcast('coach/tabs', this.tabs.map((tab) => this.tabInfo(tab)))
  }

  private tabInfo(tab: OperationTab): TabInfo {
    const url = this.displayUrl(tab)
    return {
      id: tab.id,
      kind: tab.kind,
      title: tab.title,
      url,
      ...(tab.kind !== 'browser' ? { displayUrl: url } : {}),
      active: tab.id === this.activeTabId,
      pinned: tab.pinned,
      favicon: tab.favicon,
      debuggerEnabled: tab.debuggerEnabled,
      debuggerAttached: tab.kind === 'browser' && Boolean(tab.capture?.isAttached()),
      loading: tab.loading
    }
  }

  /**
   * The only writer of a tab's visible loading state. Starting always rearms the watchdog, while
   * redirects that keep the boolean true avoid redundant tab-list broadcasts.
   */
  private setTabLoading(tab: OperationTab, loading: boolean): void {
    if (tab.loadWatchdog) {
      clearTimeout(tab.loadWatchdog)
      tab.loadWatchdog = null
    }
    if (loading) {
      tab.loadWatchdog = setTimeout(() => {
        tab.loadWatchdog = null
        if (!tab.loading) return
        tab.loading = false
        console.warn(`[maestro] load watchdog settled tab ${tab.id}`)
        this.broadcastTabs()
      }, LOAD_WATCHDOG_MS)
    }
    if (tab.loading === loading) return
    tab.loading = loading
    this.broadcastTabs()
  }

  async toolInjectButton(skillsJson: string, domainArg: string): Promise<string> {
    const active = this.getActiveTab()
    if (active?.kind !== 'browser') return 'ERROR: open a normal browser tab before injecting a button.'
    const wc = active?.view?.webContents
    const pageDomain = hostFromUrl(wc && !wc.isDestroyed() ? wc.getURL() : active?.url || this._state.currentUrl)
    const domain = normalizeInjectedButtonDomain(domainArg) || pageDomain
    if (!domain) return 'ERROR: no active page domain. Open the customer website first.'
    const items = parseInjectedButtonItems(skillsJson)
    if (!items.length) {
      return 'ERROR: skills_json must contain at least one item with skillTitle and optional skillDescription.'
    }
    const saved = await injectBtnStore.upsertMany({ domain, items })
    const entries = await injectBtnStore.list({ domain })
    const injected = active ? await this.injectButtonIntoTab(active, domain, entries) : { ok: false, error: 'no active tab' }
    this._state.broadcastActivity('act', `injected micromeet button · ${domain}`, injected.ok)
    xpcMain.broadcast('coach/injected-buttons-changed', { domain, ts: Date.now() })
    return JSON.stringify(
      {
        ok: saved.ok && injected.ok,
        domain,
        saved: saved.count,
        triggers: entries.length,
        injected: injected.ok,
        error: injected.ok ? undefined : injected.error
      },
      null,
      2
    )
  }

  async toolRemoveInjectedButton(domainArg: string): Promise<string> {
    const active = this.getActiveTab()
    if (active?.kind !== 'browser' && !normalizeInjectedButtonDomain(domainArg)) {
      return 'ERROR: open a normal browser tab or pass a domain.'
    }
    const wc = active?.view?.webContents
    const pageDomain = hostFromUrl(wc && !wc.isDestroyed() ? wc.getURL() : active?.url || this._state.currentUrl)
    const domain = normalizeInjectedButtonDomain(domainArg) || pageDomain
    if (!domain) return 'ERROR: no active page domain. Open the customer website first or pass a domain.'
    const result = await this.removeInjectedButtonDomain({ domain })
    this._state.broadcastActivity('act', `removed micromeet button · ${domain}`, result.ok)
    return JSON.stringify(result, null, 2)
  }

  private async injectStoredButtonForTab(tab: OperationTab): Promise<void> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return
    const domain = hostFromUrl(wc.getURL() || tab.url)
    if (!domain) return
    const entries = await injectBtnStore.list({ domain }).catch(() => [] as InjectBtnEntry[])
    if (!entries.length) return
    await this.injectButtonIntoTab(tab, domain, entries)
  }

  private async injectButtonIntoTab(
    tab: OperationTab,
    domain: string,
    entries: InjectBtnEntry[]
  ): Promise<{ ok: boolean; error?: string }> {
    if (tab.kind !== 'browser') return { ok: false, error: 'button injection requires a normal browser tab' }
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'tab webContents is not ready' }
    const liveDomain = hostFromUrl(wc.getURL() || tab.url)
    if (!liveDomain || liveDomain !== domain) {
      return { ok: false, error: `active page is ${liveDomain || 'blank'}, not ${domain}` }
    }
    if (!entries.length) return { ok: false, error: 'no inject button rows for domain' }
    try {
      const nonce = randomUUID()
      this.injectedButtonNonces.set(domain, nonce)
      await wc.executeJavaScript(buildInjectedButtonScript(domain, entries, nonce), true)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async removeInjectedButtonFromTabs(domain: string): Promise<number> {
    let count = 0
    for (const tab of this.tabs) {
      if (tab.kind !== 'browser') continue
      const wc = tab.view?.webContents
      if (!wc || wc.isDestroyed()) continue
      const liveDomain = hostFromUrl(wc.getURL() || tab.url)
      if (liveDomain !== domain) continue
      try {
        await wc.executeJavaScript(removeInjectedButtonScript(), true)
        count += 1
      } catch (err) {
        this._state.emitTrace({ kind: 'error', msg: 'remove injected button: ' + (err as Error).message, ts: Date.now() })
      }
    }
    return count
  }

  private handleInjectedButtonOpen(url: string): boolean {
    const trigger = parseInjectedButtonTriggerUrl(url)
    if (!trigger) return false
    const expectedNonce = this.injectedButtonNonces.get(trigger.domain)
    if (!expectedNonce || expectedNonce !== trigger.nonce) return true
    const message = injectedButtonTriggerMessage(trigger)
    xpcMain.broadcast('coach/injected-skill-trigger', {
      domain: trigger.domain,
      skillTitle: trigger.skillTitle,
      skillDescription: trigger.skillDescription,
      message,
      ts: Date.now()
    })
    this._state.broadcastActivity('skill', `trigger ${trigger.skillTitle}`)
    return true
  }

  reset(): void {
    this.lifecycleEpoch += 1
    for (const tab of this.tabs) {
      if (tab.loadWatchdog) {
        clearTimeout(tab.loadWatchdog)
        tab.loadWatchdog = null
      }
      try {
        tab.capture?.detach()
      } catch {
        // Already detached or destroyed.
      }
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        try {
          tab.view.webContents.close()
        } catch {
          // Best effort.
        }
      }
    }
    this.tabs = []
    this.activeTabId = null
    if (this.spareSlot) {
      try {
        this.spareSlot.capture.detach()
      } catch {
        // Already detached or destroyed.
      }
      if (!this.spareSlot.view.webContents.isDestroyed()) {
        try {
          this.spareSlot.view.webContents.close()
        } catch {
          // Best effort.
        }
      }
      this.spareSlot = null
    }
    this.prewarming = false
    this.creatingTab = false
    this.startupTabOpened = false
    this.tabSeq = 0
  }
}

interface InjectedButtonTrigger {
  domain: string
  nonce: string
  skillTitle: string
  skillDescription: string
}

const normalizeInjectedButtonDomain = (value: string): string => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return raw.replace(/^www\./, '').replace(/\/.*$/, '')
  }
}

const parseInjectedButtonItems = (value: string): InjectBtnInput[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.skills)
        ? record.skills
        : parsed
          ? [parsed]
          : []
  const out: InjectBtnInput[] = []
  for (const item of rawItems.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const skillTitle = clipInline(firstNonEmptyString(record.skillTitle, record.title, record.name), 90)
    if (!skillTitle) continue
    out.push({
      skillTitle,
      skillDescription: clipInline(firstNonEmptyString(record.skillDescription, record.description, record.summary), 360)
    })
  }
  return out
}

const groupInjectedButtonDomains = (entries: InjectBtnEntry[]): InjectedButtonDomain[] => {
  const byDomain = new Map<string, InjectedButtonDomain>()
  for (const entry of entries) {
    const domain = normalizeInjectedButtonDomain(entry.domain)
    if (!domain) continue
    const group = byDomain.get(domain) || { domain, triggers: [], updatedAt: 0 }
    group.triggers.push(entry)
    group.updatedAt = Math.max(group.updatedAt, entry.updatedAt || 0)
    byDomain.set(domain, group)
  }
  return Array.from(byDomain.values()).sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.domain.localeCompare(b.domain)
  })
}

const removeInjectedButtonScript = (): string => `
(() => {
  const root = document.getElementById('__bitterless_maestro_button_root__');
  if (root) root.remove();
})();
`

const buildInjectedButtonScript = (domain: string, entries: InjectBtnEntry[], nonce: string): string => {
  const payload = {
    domain,
    nonce,
    entries: entries.map((entry) => ({
      skillTitle: entry.skillTitle,
      skillDescription: entry.skillDescription
    }))
  }
  return `
(() => {
  const payload = ${JSON.stringify(payload)};
  const rootId = ${JSON.stringify(INJECTED_BUTTON_ROOT_ID)};
  const old = document.getElementById(rootId);
  if (old) old.remove();
  if (!payload.entries.length || !document.body) return;

  const root = document.createElement('div');
  root.id = rootId;
  root.style.position = 'fixed';
  root.style.left = 'auto';
  root.style.right = '0';
  root.style.top = '42%';
  root.style.width = '0';
  root.style.height = '0';
  root.style.overflow = 'visible';
  root.style.zIndex = '2147483647';
  root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  root.style.colorScheme = 'light';

  const style = document.createElement('style');
  style.textContent = \`
    #\${rootId}, #\${rootId} * { box-sizing: border-box; }
    #\${rootId} .mmc-btn {
      position: absolute;
      top: 0;
      right: 0;
      min-width: 128px;
      height: 48px;
      border: 0;
      border-radius: 999px;
      background: #165dff;
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      line-height: 48px;
      padding: 0 22px;
      cursor: grab;
      box-shadow: 0 12px 30px rgba(22, 93, 255, .28), 0 3px 10px rgba(15, 23, 42, .18);
      user-select: none;
      touch-action: none;
    }
    #\${rootId} .mmc-btn:active { cursor: grabbing; }
    #\${rootId} .mmc-modal {
      position: absolute;
      top: 58px;
      right: 8px;
      width: 292px;
      max-width: min(292px, calc(100vw - 28px));
      border: 1px solid rgba(148, 163, 184, .36);
      border-radius: 14px;
      background: #fff;
      color: #0f172a;
      box-shadow: 0 24px 70px rgba(15, 23, 42, .24);
      overflow: hidden;
    }
    #\${rootId}[data-side="left"] .mmc-modal {
      left: 8px;
      right: auto;
    }
    #\${rootId} .mmc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      height: 38px;
      padding: 0 10px 0 12px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 800;
    }
    #\${rootId} .mmc-close {
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      font-size: 18px;
      line-height: 20px;
    }
    #\${rootId} .mmc-close:hover { background: #e2e8f0; color: #0f172a; }
    #\${rootId} .mmc-list {
      max-height: min(360px, calc(100vh - 120px));
      overflow: auto;
      padding: 6px;
    }
    #\${rootId} .mmc-row {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 10px;
      background: transparent;
      padding: 9px 10px;
      text-align: left;
      cursor: pointer;
    }
    #\${rootId} .mmc-row:hover { background: #eef4ff; }
    #\${rootId} .mmc-title {
      display: block;
      color: #0f172a;
      font-size: 12px;
      font-weight: 800;
      line-height: 16px;
    }
    #\${rootId} .mmc-desc {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 11px;
      font-weight: 500;
      line-height: 15px;
    }
  \`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mmc-btn';
  button.textContent = 'micromeet';
  button.setAttribute('aria-label', 'Open Micromeet skills');

  const modal = document.createElement('div');
  modal.className = 'mmc-modal';
  modal.hidden = true;
  modal.innerHTML = '<div class="mmc-head"><span>Micromeet skills</span><button type="button" class="mmc-close" aria-label="Close">×</button></div><div class="mmc-list"></div>';
  const list = modal.querySelector('.mmc-list');
  for (const item of payload.entries) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mmc-row';
    row.innerHTML = '<span class="mmc-title"></span><span class="mmc-desc"></span>';
    row.querySelector('.mmc-title').textContent = item.skillTitle || 'Untitled skill';
    row.querySelector('.mmc-desc').textContent = item.skillDescription || 'Trigger Maestro';
    row.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const params = new URLSearchParams({
        domain: payload.domain,
        nonce: payload.nonce,
        title: item.skillTitle || '',
        description: item.skillDescription || ''
      });
      window.open('bitterless-maestro://trigger?' + params.toString(), '_blank', 'noopener');
      modal.hidden = true;
    });
    list.appendChild(row);
  }

  root.appendChild(style);
  root.appendChild(button);
  root.appendChild(modal);
  root.dataset.side = 'right';
  document.body.appendChild(root);

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const edgeOffset = () => Math.max(1, Math.round(button.offsetHeight / 2));
  const place = (x, y) => {
    root.dataset.side = 'drag';
    root.style.left = clamp(x, 8, window.innerWidth - button.offsetWidth - 8) + 'px';
    root.style.right = 'auto';
    root.style.top = clamp(y, 8, window.innerHeight - button.offsetHeight - 8) + 'px';
    button.style.left = '0';
    button.style.right = 'auto';
    button.style.transform = 'none';
  };
  const dock = (side, top) => {
    const offset = edgeOffset();
    root.style.setProperty('--mmc-edge-offset', offset + 'px');
    root.dataset.side = side;
    root.style.left = side === 'left' ? '0' : 'auto';
    root.style.right = side === 'right' ? '0' : 'auto';
    root.style.top = clamp(top, 8, window.innerHeight - button.offsetHeight - 8) + 'px';
    button.style.left = side === 'left' ? '0' : 'auto';
    button.style.right = side === 'right' ? '0' : 'auto';
    button.style.transform = side === 'left' ? 'translateX(-' + offset + 'px)' : 'translateX(' + offset + 'px)';
  };
  const snap = () => {
    const rect = button.getBoundingClientRect();
    const side = rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    dock(side, rect.top);
  };
  dock('right', window.innerHeight * 0.42);

  button.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = button.getBoundingClientRect();
    originX = rect.left;
    originY = rect.top;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
    place(originX + dx, originY + dy);
  });
  button.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    button.releasePointerCapture(event.pointerId);
    snap();
    if (!moved) modal.hidden = !modal.hidden;
  });
  modal.querySelector('.mmc-close').addEventListener('click', () => {
    modal.hidden = true;
  });
  window.addEventListener('resize', snap);
})();
`
}

const parseInjectedButtonTriggerUrl = (url: string): InjectedButtonTrigger | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'bitterless-maestro:' || parsed.hostname !== 'trigger') return null
    const domain = normalizeInjectedButtonDomain(parsed.searchParams.get('domain') || '')
    const nonce = parsed.searchParams.get('nonce') || ''
    const skillTitle = clipInline(parsed.searchParams.get('title') || '', 120)
    if (!domain || !nonce || !skillTitle) return null
    return {
      domain,
      nonce,
      skillTitle,
      skillDescription: clipInline(parsed.searchParams.get('description') || '', 500)
    }
  } catch {
    return null
  }
}

const injectedButtonTriggerMessage = (trigger: InjectedButtonTrigger): string =>
  [
    `Run injected webpage skill: ${trigger.skillTitle}`,
    `Domain: ${trigger.domain}`,
    trigger.skillDescription ? `Details: ${trigger.skillDescription}` : ''
  ]
    .filter(Boolean)
    .join('\n')
