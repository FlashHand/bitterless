import type { WebContentsView } from 'electron'
import type { ViewRect } from '@maestro-shared/coach.api'

/**
 * Initial geometry for the very first frame, before the Home renderer reports the real placeholder
 * rects. The 36px tab strip plus the compact 42px address row total 78px; renderer measurements
 * remain authoritative thereafter.
 *
 * Here rather than in the window controller because a composite mini-app tab needs the same
 * fallback, and the controller already imports the view services that would have to import it back.
 */
export const MAESTRO_TOOLBAR_H = 78
export const MAESTRO_SIDEBAR_W = 480

/** The rect a tab's content occupies before the renderer has measured one. */
export const maestroFirstFrameOperationRect = (contentWidth: number, contentHeight: number): ViewRect => ({
  x: 0,
  y: MAESTRO_TOOLBAR_H,
  width: Math.max(0, contentWidth - MAESTRO_SIDEBAR_W),
  height: Math.max(0, contentHeight - MAESTRO_TOOLBAR_H)
})

/**
 * Per-view redundant-bounds suppression.
 *
 * ResizeObserver can report the same native rect repeatedly during a layout pass. Each view
 * service owns one applier so native relayout only runs when its rounded bounds actually change.
 * Compare the native bounds so an out-of-band layout cannot leave a stale cached rectangle.
 */
export const createBoundsApplier = (): ((view: WebContentsView | null, rect: ViewRect) => void) => {
  return (view, rect) => {
    if (!view || view.webContents.isDestroyed()) return
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    }
    const current = view.getBounds()
    if (current.x === bounds.x && current.y === bounds.y && current.width === bounds.width && current.height === bounds.height) return
    view.setBounds(bounds)
  }
}
