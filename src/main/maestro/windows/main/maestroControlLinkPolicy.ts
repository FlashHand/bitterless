import type { WebContents } from 'electron'

/**
 * What the Cowork chat panel is allowed to do when a link in it tries to open or navigate.
 *
 * PORTED FROM micromeet-cowork (`main/modules/window-manager/windows/main/coworkLinkPolicy.ts`),
 * which is the parity source for the Control chat (`docs/features/maestro.md`). Keep the two the
 * same shape; BL-only divergence must be stated here and there.
 *
 * WHY THIS EXISTS. The panel renders the model's reply as Markdown, and `markstream-vue` gives every
 * link `target="_blank" rel="noopener noreferrer"`. Local-file links are intercepted in the renderer
 * (`MessageItem.vue` `onMarkdownClick`) so they never reach a window-open. Everything else did — and
 * this view had NO `setWindowOpenHandler` and NO navigation fence, while every other surface in this
 * app is fenced (`window.helper.ts:100`, `configureOnlyPreviewNavigationFence`, the coin/trench/
 * fileSearch windows). So Electron's built-in path ran: an `https` link in a chat reply opened a
 * bare BrowserWindow instead of becoming a tab in the operation view.
 *
 * That landing was nobody's decision — it was the default of a missing hook. It is also the worst
 * view in the app to leave unfenced: this one carries `maestroCoach.js` with `sandbox: false` on a
 * persistent partition, so a window created off it inherits a preload that exposes `xpcRenderer`.
 *
 * WHY IN MAIN AND NOT IN THE RENDERER'S CLICK HANDLER. A delegated `click` listener does not fire for
 * a middle-click (that is `auxclick`), and `Cmd`/`Ctrl`+click, `window.open()` and a
 * `<form target="_blank">` all reach the window-open path too. One policy on the webContents covers
 * every gesture and whatever component renders next.
 */
export interface ControlLinkPolicyActions {
  /** Open `url` as a new operation tab and activate it (`maestroBrowserView.openTab`). */
  openTab(params: { url: string }): Promise<void>
}

/**
 * Is `raw` a remote page — something the operation view can legitimately show?
 *
 * The own-origin exclusion is load-bearing, not defensive: a produced-file link's href is a BARE
 * absolute path (`/Users/ral/…`), so a gesture that escapes the renderer's interceptor resolves it
 * against the PANEL's own origin. In dev that yields `http://localhost:5173/Users/ral/…` — http(s),
 * and without this test it would open a tab onto the dev server's 404.
 */
export const isRemotePageUrl = (raw: string, selfUrl: string): boolean => {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return !isPanelsOwnUrl(raw, selfUrl)
  } catch {
    return false
  }
}

/**
 * Is `raw` the panel re-loading itself? Exact match covers a packaged reload; the same-origin arm
 * covers the dev server. `origin` is the STRING `'null'` for `file://`, which is why that arm must
 * exclude it — otherwise every `file://` target in the world would count as "the panel itself".
 */
export const isPanelsOwnUrl = (raw: string, selfUrl: string): boolean => {
  if (raw === selfUrl) return true
  try {
    const url = new URL(raw)
    const self = new URL(selfUrl)
    return url.origin !== 'null' && url.origin === self.origin
  } catch {
    return false
  }
}

export const installControlLinkPolicy = (
  webContents: WebContents,
  selfUrl: string,
  actions: ControlLinkPolicyActions
): void => {
  const openInTab = (url: string): void => {
    // `window.open` blocks the opener synchronously until the handler returns, so a tab must never be
    // built inline here — the same reason `maestroBrowserView`'s own popup path defers.
    queueMicrotask(() => {
      void actions.openTab({ url }).catch((err) => {
        console.warn('[maestro] chat link → tab failed:', err instanceof Error ? err.message : err)
      })
    })
  }
  webContents.setWindowOpenHandler(({ url }) => {
    if (isRemotePageUrl(url, selfUrl)) openInTab(url)
    // Everything else is denied SILENTLY, matching every other fenced surface here: a
    // `file:`/`data:`/`javascript:` target must not become a window, and must not become a tab
    // either — `openTab` hands its string to `loadURL` with no scheme check of its own.
    return { action: 'deny' }
  })
  // A link with no `target` would navigate the panel ITSELF, replacing the chat with a web page.
  // Nothing in the chat emits such a link today (markstream always sets `_blank`), which is exactly
  // why the fence belongs here rather than in a component.
  const fence = (event: Electron.Event, url: string): void => {
    if (isPanelsOwnUrl(url, selfUrl)) return
    event.preventDefault()
    if (isRemotePageUrl(url, selfUrl)) openInTab(url)
  }
  webContents.on('will-navigate', fence)
  webContents.on('will-redirect', fence)
}
