import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { AgentRuntimeContextSurface } from './runtime/runtime.types'

/**
 * 「如果此刻 send,模型会看到什么」——**唯一的组装入口**。
 *
 * Ral 2026-09-01:「/view_context 能将下次 send 会拼接的历史上下文…复制到剪贴板」+
 * 「将会进上下文的内容拼到一个 jsonl 中用于审计」。契约:`docs/features/cowork-slash-commands.md`。
 *
 * **为什么在 main 而不是渲染端**:渲染端的 `context.service.ts` 算的是**预算账**(五段 + token,
 * 用来决定该不该压缩),它**没有工具调用与工具返回正文** —— 而那是上下文里最大的一块。真源是
 * pi 的条目树(`AgentRuntimeContextSurface.entries()`,压缩后的保留起点也由 pi 定)+ main 追加的
 * 系统提示词与本回合前缀。渲染端拿不到这些,拿它拼出来的"上下文"会骗人,而这个命令的全部价值
 * 就是"它就是发出去的那份"。
 *
 * **一份组装,两个出口**(剪贴板 / JSONL):不允许各拼一份 —— 那样审计文件和人看到的东西会漂。
 */

export interface ContextExportPending {
  workspace?: string
  attachments?: string[]
  /** 输入框里的原文(渲染端一起传上来)。 */
  draft?: string
}

export interface ContextExportInput {
  sessionId: string
  provider?: string
  model?: string
  contextWindow?: number
  systemPrompt: string
  entries: SessionEntry[]
  pending?: ContextExportPending
  /** 本会话 jsonl 的绝对目录。**由调用方解析后传入** —— 组装本身不碰文件系统(同 timestamp 的理由:
   *  守卫要能得到确定输出)。 */
  ioLogDir?: string
  /** ISO 时间戳由调用方给 —— 组装本身不读时钟,便于守卫得到确定输出。 */
  timestamp: string
}

export interface ContextExportEntry {
  i: number
  /** `user` / `assistant` / `tool_call` / `tool_result` / `custom_message` / `compaction` / … */
  type: string
  /** 工具名(tool_call / tool_result 才有)。 */
  tool?: string
  chars: number
  text: string
}

export interface ContextExportRecord {
  ts: string
  sessionId: string
  provider?: string
  model?: string
  contextWindow?: number
  systemChars: number
  system: string
  entries: ContextExportEntry[]
  pending: ContextExportPending
  /**
   * 本会话 model-IO jsonl 的**绝对目录**(没有就 undefined)。
   *
   * Ral 2026-09-03:「/export 要能导出 jsonl 的绝对路径(当前会话存在 jsonl 的话)」。理由很具体:
   * 追 issues/drill-activity-bleeds-into-another-session.md 时,定位"这份上下文对应盘上哪份原文"
   * 要跨十几个目录 grep 内容反推。带上路径 = 以后每份导出自带出处。
   */
  ioLogDir?: string
}

const textOfContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as { type?: string; text?: unknown; name?: unknown; arguments?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
    // 图片不展开成 base64 —— 那是几十万字符的噪声,而"这里有一张图"才是要看的信息。
    else if (record.type === 'image') parts.push('[image]')
    else if (record.type === 'thinking' && typeof record.text === 'string') parts.push(`[thinking] ${record.text}`)
    else if (record.type === 'toolCall') parts.push(`${String(record.name || 'tool')}(${JSON.stringify(record.arguments ?? {})})`)
  }
  return parts.join('\n')
}

/**
 * pi 条目 → 导出行。一条 `message` 条目按 role 展开成 user / assistant / tool_result 三种;
 * assistant 里的 `toolCall` 单独成行(**它是上下文里最容易被忽略的一块**:模型看到的不是
 * "调用了工具"这句话,而是完整参数)。
 */
export const flattenEntries = (entries: SessionEntry[]): ContextExportEntry[] => {
  const rows: ContextExportEntry[] = []
  const push = (type: string, text: string, tool?: string): void => {
    rows.push({ i: rows.length + 1, type, tool, chars: text.length, text })
  }
  for (const entry of entries) {
    const record = entry as unknown as Record<string, unknown>
    const type = String(record.type || 'unknown')
    if (type === 'message') {
      const message = record.message as { role?: string; content?: unknown; toolName?: string } | undefined
      const role = String(message?.role || 'unknown')
      if (role === 'assistant') {
        const content = Array.isArray(message?.content) ? (message?.content as Record<string, unknown>[]) : []
        const said = textOfContent(content.filter((part) => part?.type !== 'toolCall'))
        if (said.trim()) push('assistant', said)
        for (const part of content) {
          if (part?.type !== 'toolCall') continue
          push('tool_call', JSON.stringify(part.arguments ?? {}), String(part.name || ''))
        }
        continue
      }
      if (role === 'toolResult') {
        push('tool_result', textOfContent(message?.content), String(message?.toolName || ''))
        continue
      }
      push(role, textOfContent(message?.content))
      continue
    }
    if (type === 'custom_message') {
      push(`custom_message:${String(record.customType || '')}`, textOfContent(record.content))
      continue
    }
    if (type === 'compaction') {
      push('compaction', String(record.summary || ''))
      continue
    }
    // 其余条目(model_change / thinking_level_change / label / session_info)只留类型 —— 它们不是正文,
    // 但它们**在**上下文里,漏掉会让 index 与真实条目数对不上。
    push(type, '')
  }
  return rows
}

/** 结构化记录 —— JSONL 那一行就是它。 */
export const buildContextRecord = (input: ContextExportInput): ContextExportRecord => ({
  ts: input.timestamp,
  sessionId: input.sessionId,
  provider: input.provider,
  model: input.model,
  contextWindow: input.contextWindow,
  systemChars: input.systemPrompt.length,
  system: input.systemPrompt,
  entries: flattenEntries(input.entries),
  ioLogDir: input.ioLogDir,
  pending: {
    workspace: input.pending?.workspace,
    attachments: input.pending?.attachments?.length ? input.pending.attachments : undefined,
    draft: input.pending?.draft || undefined
  }
})

const HISTORY_EMPTY = '(no model-side history yet — this chat has not sent a turn)'

/**
 * 人读的那份。**不截断任何正文** —— 这个命令的用途是分析提示词质量,截断会把要分析的东西删掉
 * (它去剪贴板,不去日志;日志那边的口径相反)。
 */
export const renderContextText = (record: ContextExportRecord): string => {
  const head = [
    `=== cowork context · session ${record.sessionId} · ${record.ts} ===`,
    `model: ${record.provider || '?'}/${record.model || '?'} · contextWindow ${record.contextWindow || '?'} · entries ${record.entries.length}`,
    '',
    `--- [1] system (${record.systemChars.toLocaleString()} chars) ---`,
    record.system || '(empty)',
    '',
    `--- [2] history: ${record.entries.length} entries ---`
  ]
  // jsonl 路径紧跟表头 —— 它是"去哪看原文"的答案,不该埋在正文后面。
  if (record.ioLogDir) head.splice(2, 0, `model-io jsonl: ${record.ioLogDir}`)
  const body = record.entries.length
    ? record.entries.map((entry) => {
        const label = entry.tool ? `${entry.type} ${entry.tool}` : entry.type
        return `[${String(entry.i).padStart(3, '0')}] ${label} (${entry.chars.toLocaleString()} chars)\n${entry.text}`
      })
    : [HISTORY_EMPTY]
  const pending = [
    '',
    '--- [3] pending (this send) ---',
    `workspace: ${record.pending.workspace || '(none)'}`,
    `attachments: ${record.pending.attachments?.length || 0}${record.pending.attachments?.length ? ` · ${record.pending.attachments.join(', ')}` : ''}`,
    `draft: ${record.pending.draft || '(empty)'}`
  ]
  return [...head, ...body, ...pending].join('\n')
}

/** 一次读取:面拿不到就是空历史 —— 不拿渲染端消息冒充(契约 #3.1)。 */
export const entriesOfSurface = (surface: AgentRuntimeContextSurface | null): SessionEntry[] =>
  (surface?.entries() ?? []) as SessionEntry[]

export const CONTEXT_HISTORY_EMPTY_NOTE = HISTORY_EMPTY
