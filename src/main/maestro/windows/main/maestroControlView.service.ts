import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { injectable } from 'inversify'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { ViewRect } from '@maestro-shared/coach.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import { createBoundsApplier } from './viewBounds'
import { installControlLinkPolicy } from './maestroControlLinkPolicy'

export const shouldOpenControlDevTools = (): boolean => {
  if (import.meta.env.VITE_MODE !== 'debug') return false
  if (process.env.BITTERLESS_E2E === '1') return false
  return is.dev || process.env.COACH_DEVTOOLS === '1'
}

export interface MaestroControlViewServiceState {
  browserWindow: BrowserWindow | null
  emitTrace(event: TraceEvent): void
  /**
   * Where a web link clicked INSIDE the panel lands: a new operation tab (Ral 2026-09-08, ported
   * from cowork). The alternative is Electron's default for an uninstalled window-open hook, which
   * is a bare BrowserWindow inheriting this view's privileged preload — see
   * `maestroControlLinkPolicy.ts`.
   */
  openTab(params: { url: string }): Promise<void>
}

@injectable()
export class MaestroControlViewService extends CommonService<MaestroControlViewServiceState> {
  private view: WebContentsView | null = null
  private readonly applyBounds = createBoundsApplier()

  create(): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return Promise.reject(new Error('Maestro window is not available.'))
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/maestroCoach.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: MAESTRO_PARTITION
      }
    })
    view.setVisible(false)
    this.view = view
    // These two chords belong to the focused chat, not the app menu's macOS Hide action.
    // Keep DOM events intact; every other key (including key-up) restores normal menu routing.
    view.webContents.on('before-input-event', (_event, input) => {
      const command = process.platform === 'darwin' ? input.meta : input.control
      view.webContents.setIgnoreMenuShortcuts(Boolean(
        input.type === 'keyDown' && command && !input.alt && !input.shift &&
        !input.isComposing && ['h', 'n'].includes(input.key.toLowerCase())
      ))
    })
    win.contentView.addChildView(view)
    const entryFile = join(__dirname, '../renderer/maestro/control/index.html')
    const devEntry =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? `${process.env['ELECTRON_RENDERER_URL']}/maestro/control/index.html`
        : ''
    // The policy needs the url this view is actually AT — it is what tells "the panel reloading
    // itself" apart from "a link trying to take the panel somewhere". Derived from the same two
    // branches that load it, so the two can never disagree.
    installControlLinkPolicy(
      view.webContents,
      devEntry || pathToFileURL(entryFile).toString(),
      { openTab: (params) => this._state.openTab(params) }
    )
    const load = devEntry
      ? view.webContents.loadURL(devEntry)
      : view.webContents.loadFile(entryFile)

    if (shouldOpenControlDevTools()) {
      view.webContents.once('did-finish-load', () => {
        if (!view.webContents.isDestroyed() && !view.webContents.isDevToolsOpened()) {
          view.webContents.openDevTools({ mode: 'detach', activate: false })
        }
      })
    }

    return load.catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'control load: ' + (err as Error).message, ts: Date.now() })
      throw err
    })
  }

  layout(bounds: { x: number; y: number; width: number; height: number }): void {
    this.setBounds(bounds)
  }

  setBounds(rect: ViewRect): void {
    const view = this.view
    if (!view || view.webContents.isDestroyed()) return
    this.applyBounds(view, rect)
    view.setVisible(Math.round(rect.width) > 0 && Math.round(rect.height) > 0)
  }

  reset(): void {
    const view = this.view
    this.view = null
    if (!view || view.webContents.isDestroyed()) return
    try {
      view.webContents.close()
    } catch {
      // Best effort: the parent window may already have destroyed the view.
    }
  }
}
