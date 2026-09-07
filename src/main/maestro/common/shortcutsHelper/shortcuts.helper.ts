import { app, session, webContents } from 'electron'
import type { WebContents } from 'electron'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'

export interface ShortcutActions {
  newTab: () => void
  closeActiveTab: () => void
}

const shortcutContents = new WeakSet<WebContents>()
const shortcutDedupeMs = 120
const lastShortcutAt = new Map<string, number>()
let activated = false
// Enrollment can happen before or after `activateShortcuts`, so the actions are remembered rather
// than captured: a view enrolled first would otherwise get no binding at all.
let pendingActions: ShortcutActions | null = null

const runShortcut = (key: string, actions: ShortcutActions): boolean => {
  if (key !== 't' && key !== 'w') return false
  const now = Date.now()
  const last = lastShortcutAt.get(key) || 0
  if (now - last < shortcutDedupeMs) return true
  lastShortcutAt.set(key, now)
  if (key === 't') actions.newTab()
  else actions.closeActiveTab()
  return true
}

/**
 * Contents that are Maestro's for chord purposes without being in Maestro's partition.
 *
 * A composite mini-app tab (OnlyPreview) creates its views with no `partition`, so they run in the
 * default session and the partition test below skips them. With focus inside such a view, Cmd+W
 * reached neither `closeActiveTab` nor any mini-app binding and fell through to the application
 * menu's inherited `fileMenu` `close` role — closing the whole Cowork window instead of the tab.
 *
 * The partition test stays the default on purpose: it is what stops arbitrary web content in a tab
 * from claiming Bitterless chords. Enrollment grants a keystroke, not a session — the host enrolls
 * each view of a mini app it registered, and nothing else can.
 */
const enrolledContents = new WeakSet<WebContents>()

export const enrollMaestroShortcutContents = (contents: WebContents): void => {
  enrolledContents.add(contents)
  if (pendingActions) installShortcutsForWebContents(contents, pendingActions)
}

const installShortcutsForWebContents = (contents: WebContents, actions: ShortcutActions): void => {
  const isMaestroSession = contents.session === session.fromPartition(MAESTRO_PARTITION)
  if ((!isMaestroSession && !enrolledContents.has(contents)) || shortcutContents.has(contents)) return
  shortcutContents.add(contents)
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (!mod || input.alt || input.shift) return
    if (runShortcut(String(input.key || '').toLowerCase(), actions)) event.preventDefault()
  })
}

// Bitterless retains the application menu and Cmd/Ctrl+Q. Only WebContents in Maestro's
// persistent partition receive the tab shortcuts.
export const activateShortcuts = (actions: ShortcutActions): void => {
  pendingActions = actions
  if (activated) return
  activated = true
  app.on('web-contents-created', (_event, contents) => installShortcutsForWebContents(contents, actions))
  for (const contents of webContents.getAllWebContents()) installShortcutsForWebContents(contents, actions)
}
