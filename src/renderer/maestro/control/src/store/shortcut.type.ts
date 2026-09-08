export interface ShortcutItem {
  name: '/clear' | '/view_context'
  hint: string
}

export interface ShortcutRunContext {
  newChat: () => Promise<boolean>
  copyContext: () => Promise<void>
}

export type ShortcutCommit = { ok: true } | { ok: false; error?: string }

export interface SlashToken {
  query: string
  start: number
  end: number
}
