export interface ShortcutItem {
  // 名字用下划线而不是空格:开菜单的 token 正则是 `\/([\w-]*)`,带空格的名字根本不会被识别成命令。
  // 与既有的 `/view_context` 同一个写法。
  name: '/clear' | '/view_context' | '/copy_session_path'
  hint: string
}

export interface ShortcutRunContext {
  newChat: () => Promise<boolean>
  copyContext: () => Promise<void>
  copySessionPath: () => Promise<void>
}

export type ShortcutCommit = { ok: true } | { ok: false; error?: string }

export interface SlashToken {
  query: string
  start: number
  end: number
}
