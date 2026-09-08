import type { ShortcutCommit, ShortcutItem, ShortcutRunContext, SlashToken } from './shortcut.type'

export const slashTokenAt = (text: string, caret: number): SlashToken | null => {
  const before = text.slice(0, caret)
  const match = /(?:^|\n)\/([\w-]*)$/.exec(before)
  if (!match) return null
  // Do not turn the first slash of a path into a command when its suffix is after the caret.
  if (text[caret] && !/\s/.test(text[caret])) return null
  return { query: match[1], start: caret - match[1].length - 1, end: caret }
}

export class ShortcutStore {
  open = false
  query = ''
  activeIndex = 0
  pending = false

  constructor(readonly items: ShortcutItem[]) {}

  get matches(): ShortcutItem[] {
    const query = this.query.toLowerCase()
    return this.items.filter((item) => `${item.name} ${item.hint}`.toLowerCase().includes(query))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  }

  get active(): ShortcutItem | undefined { return this.matches[this.activeIndex] }

  update(token: SlashToken | null): void {
    if (!token) { this.close(); return }
    if (!this.open || this.query !== token.query) this.activeIndex = 0
    this.query = token.query
    this.open = true
  }

  close(): void { this.open = false; this.query = ''; this.activeIndex = 0 }

  move(delta: number): void {
    if (!this.matches.length) return
    this.activeIndex = (this.activeIndex + delta + this.matches.length) % this.matches.length
  }

  async commit(context: ShortcutRunContext): Promise<ShortcutCommit> {
    const item = this.active
    if (!this.open || !item || this.pending) return { ok: false }
    this.pending = true
    this.close()
    try {
      if (item.name === '/clear') return { ok: await context.newChat() }
      await context.copyContext()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.pending = false
    }
  }
}
