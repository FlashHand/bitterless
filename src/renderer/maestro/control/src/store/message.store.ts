import { markRaw, nextTick, reactive } from 'vue'
import { inject, injectable } from 'inversify'
import { countTokens } from 'gpt-tokenizer'
import { iocHelper } from '@maestro-shared/iocHelper/ioc.helper'
import { AGENT_TURN_CHANNEL, MODEL_RETRY_CHANNEL } from '@maestro-shared/coach.api'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type {
  AgentActivityStep,
  AgentCompactRequest,
  AgentCompactMessage,
  AgentConversationContext,
  AgentReply,
  AgentStreamDelta,
  AgentThinkingState,
  AgentTurnFinished,
  AgentTurnRecoverySnapshot,
  AgentTurnSnapshot,
  AgentTurnUpdate,
  CoachXpcContract,
  ModelRetryProgress,
  WorkspaceRef
} from '@maestro-shared/coach.api'
import type { MaestroChatApi, MaestroChatMessage, MaestroChatSession, MaestroCompactionApi } from '@maestro-shared/maestroChat.api'
import type { MaestroTask, MaestroTaskPart } from '@maestro-shared/task.api'
import type {
  ChatAttachment,
  ChatContextUsage,
  ChatFile,
  ChatMessage,
  MessageIntent,
  MessageSession,
  MessageSessionSummary,
  MessageSource
} from './message.type'
import { TurnService, type SendResult } from './turn.service'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const maestroChat = createXpcRendererEmitter<MaestroChatApi>('MaestroChatDao')
/**
 * main 侧 `CompactionHandler` —— **凡调 pi 的都在那边**(渲染端 import pi 拿到的是空壳,
 * 编译期一声不吭、运行期才炸;而且摘要要调模型、provider 凭据不进渲染进程)。
 * 字符串必须是 handler 的**类名**。与 cowork 同一份设计
 * (`areas/agent-runtime/agent-design-parity.md` 裁决一)。
 */
const compaction = createXpcRendererEmitter<MaestroCompactionApi>('CompactionHandler')

interface SessionOptions {
  title: string
  intent: MessageIntent
  source?: MessageSource
  operationTabId?: string
}

const DEFAULT_OPERATION_TAB_ID = 'active-operation-tab'
const DEFAULT_CONTEXT_LIMIT_K = 256
const DEFAULT_CONTEXT_LIMIT_LABEL = '256K'
const DEFAULT_COMPRESSION_REMAINING_PERCENT = 10
const COMPACTING_CONTENT = 'Compacting...'
const COMPACTED_CONTENT = 'Compacting complete.'
// 摘要出来了但没落回 pi 会话 —— 补水通路有了内容,而活着的会话没变小。
// 照实说,不拿 'Compacting complete.' 冒充。
const COMPACT_NOT_APPLIED_CONTENT = 'Compacted summary saved, but the live session was not shrunk.'
const COMPACT_SUMMARY_MAX_CONTEXT_SHARE = 0.45
const COMPACT_SUMMARY_HARD_MAX_CHARS = 500_000
// Auto-scroll "stick to bottom" threshold. While streaming we keep pinning the list to the bottom,
// but once the user scrolls up more than this many px from the bottom we stop — until they scroll
// back down near the bottom, or send a new message. ~120px ≈ a couple of lines of breathing room.
const STICK_TO_BOTTOM_THRESHOLD_PX = 120

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const placeholderFor = (): string => {
  return 'Start a Maestro conversation…'
}

const emptyDetail = () => ({ compressedContext: '' })

const emptyUsage = (): ChatContextUsage => ({
  usedTokens: 0,
  maxTokens: DEFAULT_CONTEXT_LIMIT_K * 1024,
  ratio: 0,
  percent: 0,
  label: `0 / ${DEFAULT_CONTEXT_LIMIT_LABEL}`,
  compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
  compressionTriggerPercent: 100 - DEFAULT_COMPRESSION_REMAINING_PERCENT,
  compressionTriggered: false
})

const safeTokenCount = (text: string): number => {
  const input = text || ''
  try {
    return countTokens(input)
  } catch {
    return Math.ceil(input.length / 4)
  }
}

const normalizeCompressionRemainingPercent = (value: number): number => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_COMPRESSION_REMAINING_PERCENT
  return Math.max(1, Math.min(90, n))
}

const contentForTokenCount = (message: ChatMessage): string => {
  if (message.promptExcluded) return ''
  const files = message.files?.length ? `\nfiles: ${message.files.map((file) => file.name).join(', ')}` : ''
  return `${message.role}: ${message.content}${files}`
}

const clipChars = (text: string, limit: number): string => {
  const value = (text || '').trim()
  if (value.length <= limit) return value
  return value.slice(0, Math.max(0, limit - 14)).trimEnd() + '\n...[truncated]'
}

const ARCHIVE_PATH = /\.(?:zip|7z|rar|tar|tgz|gz|xz|bz2|bz3|zst|lz4|lzma|lz|sz|br)$/i

const messageTextForPrompt = (message: ChatMessage): string => {
  if (message.type === 'files') {
    const files = (message.files || []).filter(
      (file) => !file.isDirectory && !ARCHIVE_PATH.test(file.path || file.name)
    )
    const archives = (message.files || []).filter(
      (file) => !file.isDirectory && ARCHIVE_PATH.test(file.path || file.name)
    )
    const directories = (message.files || []).filter((file) => file.isDirectory)
    const blocks: string[] = []
    if (files.length) {
      blocks.push(
        'Attached files (documents can be read with read_file; images are path refs for a vision-capable adapter):\n' +
          files.map((file) => (file.path ? `@${file.path}` : file.name)).join('\n')
      )
    }
    if (directories.length) {
      blocks.push(
        'Attached folders (directories — list with list_workspace_files or search_files, then use read_file on an individual entry):\n' +
          directories.map((file) => (file.path ? `@${file.path}` : file.name)).join('\n')
      )
    }
    if (archives.length) {
      blocks.push(
        'Attached archives (inspect with list_archive or unpack with extract_archive; do not use read_file directly):\n' +
          archives.map((file) => (file.path ? `@${file.path}` : file.name)).join('\n')
      )
    }
    return blocks.length ? blocks.join('\n\n') : 'Attached files: (none)'
  }
  return message.content || ''
}

const isPromptContextMessage = (message: ChatMessage): boolean => {
  if (message.promptExcluded || message.compressed || message.streaming || message.type === 'compact') return false
  if (message.id.startsWith('welcome-')) return false
  return Boolean(messageTextForPrompt(message).trim())
}

const plainActivity = (activity?: AgentActivityStep[]): AgentActivityStep[] | undefined =>
  activity
    ?.filter((step) => step.phase !== 'think')
    .map((step) => ({
      phase: step.phase,
      label: step.label,
      ok: Boolean(step.ok),
      ts: step.ts
    }))

const plainFiles = (files?: ChatFile[]): ChatFile[] | undefined =>
  files?.map((file) => ({
    name: file.name,
    path: file.path,
    kind: file.kind,
    action: file.action,
    size: file.size,
    isDirectory: file.isDirectory
  }))

const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T


@injectable()
export class MessageStoreState {
  constructor(
    @inject(Symbol.for(TurnService.name))
    public readonly turnService: TurnService
  ) {
    this.turnService.setState(this)
  }

  private scrollNearRaf = 0
  private streamFlushRaf = 0
  private streamBuffers = markRaw(new Map<string, string>())
  private taskBindings = markRaw(new Map<string, { sessionId: string; messageId: string }>())
  private confirmMessages = markRaw(new Map<string, string>())
  private latestTasks = markRaw([] as MaestroTask[])
  private agentTurnRevision = 0
  private pendingAgentTurnFinishes = markRaw(new Map<string, AgentTurnFinished>())
  private agentTurnFinishReplays = markRaw(new Map<string, Promise<void>>())

  sessions: MessageSession[] = []
  historySessions: MessageSessionSummary[] = []
  defaultWorkspace: WorkspaceRef | undefined = undefined
  contextLimitK = DEFAULT_CONTEXT_LIMIT_K
  contextLimitLabel = DEFAULT_CONTEXT_LIMIT_LABEL
  compressionRemainingPercent = DEFAULT_COMPRESSION_REMAINING_PERCENT
  initialized = false
  activeAgentTurnSnapshot: AgentTurnSnapshot | null = null
  // While true, streaming/agent updates keep the message list pinned to the bottom. Flipped off when
  // the user scrolls up past STICK_TO_BOTTOM_THRESHOLD_PX (see onListScroll), back on when they
  // return near the bottom or send a new message. This is the bool that gates the auto-scroll.
  stickToBottom = true
  private listEl: HTMLElement | null = null

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe(MODEL_RETRY_CHANNEL, (payload) => {
      const progress = payload?.params as ModelRetryProgress | undefined
      const session = progress ? this.getSession(progress.sessionId) : undefined
      if (
        !progress ||
        !session?.turn ||
        session.turn.id !== progress.turnId ||
        session.turn.generation !== progress.generation ||
        session.turn.aborting
      ) {
        return
      }
      session.turn.retry = progress.recovered
        ? undefined
        : { attempt: progress.attempt, max: progress.max }
    })
    xpcRenderer.subscribe(AGENT_TURN_CHANNEL, (payload) => {
      this.applyAgentTurnUpdate(payload.params as AgentTurnUpdate)
    })
    xpcRenderer.subscribe('coach/workspace-changed', (payload) => {
      const params = payload.params as { sessionId?: string; workspace?: WorkspaceRef | null }
      void this.applyWorkspaceBroadcast(params)
    })
    const recovery = await coach.getActiveAgentTurn().catch(() => null)
    if (recovery) this.applyAgentTurnRecovery(recovery)
    await this.refreshDefaultWorkspace()
    await this.refreshHistory()
  }

  createSession(options: SessionOptions): MessageSession {
    const session = this.createEmptySession(options)
    this.updateSessionContextUsage(session)
    this.sessions.push(session)
    this.restoreActiveTurn(session)
    this.replayTaskSnapshot()
    return session
  }

  async latestActiveSessionForOperationTab(operationTabId: string): Promise<MessageSession | undefined> {
    await this.init()
    const existing = this.sessions
      .filter((session) => session.operationTabId === operationTabId && !session.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (existing) return existing

    const activeSnapshot = this.activeAgentTurnSnapshot
    if (
      activeSnapshot &&
      (!activeSnapshot.operationTabId || activeSnapshot.operationTabId === operationTabId)
    ) {
      const active = await this.loadPersistedSession(activeSnapshot.sessionId)
      if (active?.operationTabId === operationTabId && !active.archivedAt) return active
      if (!active) return this.createRecoveredTurnSession(activeSnapshot, operationTabId)
    }

    const missedFinish = [...this.pendingAgentTurnFinishes.values()]
      .filter(
        (finished) =>
          !finished.turn.operationTabId || finished.turn.operationTabId === operationTabId
      )
      .sort((a, b) => b.turn.startedAt - a.turn.startedAt)[0]
    if (missedFinish) {
      const persisted = await this.loadPersistedSession(missedFinish.turn.sessionId)
      if (persisted?.operationTabId === operationTabId && !persisted.archivedAt) return persisted
      if (!persisted) {
        const recovered = this.createRecoveredTurnSession(missedFinish.turn, operationTabId)
        await this.replayFinishedAgentTurns(recovered)
        return recovered
      }
    }

    const summary = this.historySessions.find((item) => item.operationTabId === operationTabId && !item.archivedAt)
    return summary ? await this.loadPersistedSession(summary.id) : undefined
  }

  private createRecoveredTurnSession(
    snapshot: AgentTurnSnapshot,
    operationTabId: string
  ): MessageSession {
    const session = this.createEmptySession({
      title: snapshot.rootText.trim().split('\n')[0]?.slice(0, 36) || 'Maestro',
      intent: 'chat',
      operationTabId
    })
    session.id = snapshot.sessionId
    session.createdAt = snapshot.startedAt
    session.updatedAt = Date.now()
    if (snapshot.state !== 'reserved') {
      session.messages.push(
        this.withTokenCount({
          id: uid(),
          source: 'cowork',
          role: 'human',
          content: snapshot.rootText,
          streaming: false,
          ts: snapshot.startedAt
        })
      )
    }
    this.sessions.push(session)
    this.restoreTurnFromSnapshot(session, snapshot)
    this.updateSessionContextUsage(session)
    return session
  }

  async loadPersistedSession(sessionId: string): Promise<MessageSession | undefined> {
    const existing = this.getSession(sessionId)
    if (existing) return existing

    const stored = await maestroChat.getSession({ id: sessionId }).catch(() => null)
    if (!stored) return undefined
    const session = this.fromStoredSession(stored)
    this.sessions.push(session)
    this.restorePersistedBindings(session)
    await this.replayFinishedAgentTurns(session)
    this.restoreActiveTurn(session)
    this.replayTaskSnapshot()
    await this.refreshWorkspace(session.id)
    return session
  }

  getSession(id: string): MessageSession | undefined {
    return this.sessions.find((session) => session.id === id)
  }

  setActiveAgentTurnSnapshot(snapshot: AgentTurnSnapshot | null, expectedTurnId?: string): void {
    if (
      expectedTurnId &&
      this.activeAgentTurnSnapshot &&
      this.activeAgentTurnSnapshot.turnId !== expectedTurnId
    ) {
      return
    }
    this.activeAgentTurnSnapshot = snapshot
    if (!snapshot) return
    const session = this.getSession(snapshot.sessionId)
    if (session) this.restoreActiveTurn(session)
  }

  private applyAgentTurnUpdate(update: AgentTurnUpdate): void {
    if (update.finished) this.queueAgentTurnFinish(update.finished)
    // A getActiveAgentTurn() response can race a newer broadcast. Revisions are Main-monotonic, so
    // stale snapshots may contribute replayable finishes but must never overwrite current ownership.
    if (update.revision < this.agentTurnRevision) {
      this.replayLoadedAgentTurnFinishes()
      return
    }
    this.agentTurnRevision = update.revision
    this.activeAgentTurnSnapshot = update.turn
    if (update.turn) {
      const session = this.getSession(update.turn.sessionId)
      if (session) this.restoreActiveTurn(session)
    }
    this.replayLoadedAgentTurnFinishes()
  }

  private applyAgentTurnRecovery(recovery: AgentTurnRecoverySnapshot): void {
    for (const finished of recovery.finished) this.queueAgentTurnFinish(finished)
    if (recovery.revision >= this.agentTurnRevision) {
      this.agentTurnRevision = recovery.revision
      this.activeAgentTurnSnapshot = recovery.turn
    }
    this.replayLoadedAgentTurnFinishes()
  }

  private queueAgentTurnFinish(finished: AgentTurnFinished): void {
    this.pendingAgentTurnFinishes.set(
      this.agentTurnKey(finished.turn.sessionId, finished.turn.turnId),
      finished
    )
  }

  private replayLoadedAgentTurnFinishes(): void {
    for (const session of this.sessions) void this.replayFinishedAgentTurns(session)
  }

  private replayFinishedAgentTurns(session: MessageSession): Promise<void> {
    const existing = this.agentTurnFinishReplays.get(session.id)
    if (existing) return existing
    const replay = this.runFinishedAgentTurnReplay(session)
    this.agentTurnFinishReplays.set(session.id, replay)
    const cleanup = (): void => {
      if (this.agentTurnFinishReplays.get(session.id) === replay) {
        this.agentTurnFinishReplays.delete(session.id)
      }
    }
    void replay.then(cleanup, cleanup)
    return replay
  }

  private async runFinishedAgentTurnReplay(session: MessageSession): Promise<void> {
    while (true) {
      const pending = [...this.pendingAgentTurnFinishes.values()]
        .filter((finished) => finished.turn.sessionId === session.id)
        .sort((a, b) => a.turn.startedAt - b.turn.startedAt)
      if (!pending.length) return
      const finished = session.turn
        ? pending.find((candidate) => candidate.turn.turnId === session.turn?.id)
        : pending[0]
      // A different active generation owns this session. Its finish broadcast will clear it and
      // trigger another pass; never replace that live Turn with an older replay.
      if (!finished) return
      if (!session.turn) this.restoreTurnFromSnapshot(session, finished.turn)
      try {
        await this.turnService.finishFromMain(
          session,
          finished.turn.turnId,
          finished.reply,
          finished.reason
        )
      } catch {
        // Keep the unacknowledged Main record for the next renderer/session replay.
        return
      }
      if (session.turn?.id === finished.turn.turnId) return
      this.pendingAgentTurnFinishes.delete(
        this.agentTurnKey(finished.turn.sessionId, finished.turn.turnId)
      )
      await coach
        .ackAgentTurnFinished({
          sessionId: finished.turn.sessionId,
          turnId: finished.turn.turnId
        })
        .catch(() => undefined)
    }
  }

  private restoreActiveTurn(session: MessageSession): void {
    const snapshot = this.activeAgentTurnSnapshot
    if (!snapshot || snapshot.sessionId !== session.id) return
    if (session.turn?.id === snapshot.turnId) {
      session.turn.generation = snapshot.generation
      session.turn.aborting = snapshot.state === 'aborting'
      return
    }
    if (session.turn) return
    this.restoreTurnFromSnapshot(session, snapshot)
  }

  private restoreTurnFromSnapshot(session: MessageSession, snapshot: AgentTurnSnapshot): void {
    const root = session.messages.find(
      (message) =>
        message.role === 'human' &&
        message.type !== 'files' &&
        message.ts >= snapshot.startedAt - 1_000 &&
        message.content.trim() === snapshot.rootText
    )
    const nextHuman = root
      ? session.messages.find(
          (message) =>
            message.role === 'human' &&
            message.type !== 'files' &&
            message.id !== root.id &&
            message.ts > root.ts
        )
      : undefined
    const segments = session.messages.filter(
      (message) =>
        message.role === 'ai' &&
        (message.type === undefined || message.type === 'text') &&
        !message.id.startsWith('welcome-') &&
        message.ts >= snapshot.startedAt &&
        (!nextHuman || message.ts < nextHuman.ts)
    )
    session.turn = {
      id: snapshot.turnId,
      generation: snapshot.generation,
      rootText: snapshot.rootText,
      rootHumanMessageId: root?.id,
      phase: segments.some((message) => message.content.trim()) ? 'streaming' : 'accepted',
      lastAssistantMessageId: segments[segments.length - 1]?.id,
      sealedAssistantSegments: segments.length,
      hasStreamedText: segments.some((message) => message.content.trim()),
      streamCoverageComplete: false,
      activity: [],
      thinking: false,
      startedAt: snapshot.startedAt,
      lastActivityAt: Date.now(),
      aborting: snapshot.state === 'aborting'
    }
  }

  private agentTurnKey(sessionId: string, turnId: string): string {
    return `${sessionId}\u0000${turnId}`
  }

  private restorePersistedBindings(session: MessageSession): void {
    for (const message of session.messages) {
      if (message.type === 'task') {
        for (const task of message.tasks || []) {
          if (!this.taskBindings.has(task.taskId)) {
            this.taskBindings.set(task.taskId, { sessionId: session.id, messageId: message.id })
          }
        }
      }
    }
    // Persisted unanswered cards remain live until the authoritative task snapshot says otherwise.
    // Rebuild the dedupe map before replay; if legacy data contains more than one unanswered card,
    // keep only the newest actionable and close the older duplicate locally.
    const restored = new Set<string>()
    for (const message of session.messages.slice().reverse()) {
      const confirm = message.confirm
      if (!confirm || confirm.answer) continue
      if (restored.has(confirm.taskId) || this.confirmMessages.has(confirm.taskId)) {
        confirm.answer = 'elsewhere'
        continue
      }
      restored.add(confirm.taskId)
      this.confirmMessages.set(confirm.taskId, confirm.confirmId)
    }
  }

  private replayTaskSnapshot(): void {
    if (this.latestTasks.length) this.applyTaskSnapshot(this.latestTasks, false)
  }

  setContextWindow(limitK: number, label: string, compressionRemainingPercent = DEFAULT_COMPRESSION_REMAINING_PERCENT): void {
    this.contextLimitK = limitK > 0 ? limitK : DEFAULT_CONTEXT_LIMIT_K
    this.contextLimitLabel = label || `${this.contextLimitK}K`
    this.compressionRemainingPercent = normalizeCompressionRemainingPercent(compressionRemainingPercent)
    for (const session of this.sessions) this.updateSessionContextUsage(session)
  }

  setListEl(el: HTMLElement | null): void {
    this.listEl = el ? markRaw(el) : null
    if (this.listEl) {
      this.stickToBottom = true
      this.scrollToBottom(true)
    }
  }

  // Bound to the list's scroll event. Sticky while the user is within the threshold of the bottom;
  // scrolling up past it turns auto-scroll off. Guarded write so it only reacts on transitions.
  onListScroll(): void {
    const el = this.listEl
    if (!el) return
    const next = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX
    if (next !== this.stickToBottom) this.stickToBottom = next
  }

  async compactAllIfNeeded(): Promise<void> {
    for (const session of this.sessions) {
      if (session.archivedAt || session.turn) {
        this.updateSessionContextUsage(session)
        continue
      }
      await this.compactSessionIfNeeded(session)
    }
  }

  async send(sessionId: string, message: string, files?: ChatAttachment[]): Promise<SendResult | null> {
    return await this.turnService.send(sessionId, message, files)
  }

  async stop(sessionId: string): Promise<void> {
    await this.turnService.stop(sessionId)
  }

  async archive(sessionId: string): Promise<boolean> {
    const session = this.getSession(sessionId)
    if (!session || session.turn || session.archivedAt) return false
    if (!this.shouldPersistSession(session)) {
      this.sessions = this.sessions.filter((item) => item.id !== session.id)
      await maestroChat.deleteSession({ id: session.id }).catch(() => ({ ok: false }))
      await this.refreshHistory()
      return true
    }
    session.archivedAt = Date.now()
    session.updatedAt = session.archivedAt
    await this.persistSession(session)
    return true
  }

  // Drop a never-used empty draft (including legacy welcome-only drafts).
  // A session with real content is left untouched — NOT archived: it stays sendable
  // and reachable via the history drawer. (Real archive is a later feature.)
  async discardIfEmpty(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session || session.turn || this.shouldPersistSession(session)) return
    this.sessions = this.sessions.filter((item) => item.id !== session.id)
    await maestroChat.deleteSession({ id: session.id }).catch(() => ({ ok: false }))
    await this.refreshHistory()
  }

  async persistSession(session: MessageSession): Promise<void> {
    if (session.source !== 'cowork') return
    this.updateSessionContextUsage(session)
    if (!this.shouldPersistSession(session)) {
      await maestroChat.deleteSession({ id: session.id }).catch(() => ({ ok: false }))
      await this.refreshHistory()
      return
    }
    try {
      await maestroChat.saveSession({ session: this.toStoredSession(session) })
    } catch {
      /* best effort */
    }
    await this.refreshHistory()
  }

  async chooseWorkspace(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) return
    const result = await coach.chooseWorkspaceDirectory({ sessionId: session.id }).catch(() => null)
    if (!result?.ok) return
    this.defaultWorkspace = result.workspace ? this.cloneWorkspace(result.workspace) : undefined
    session.detail = { ...session.detail, workspace: result.workspace }
    session.updatedAt = Date.now()
    await this.persistSession(session)
  }

  async clearWorkspace(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) return
    await coach.setWorkspaceDirectory({ sessionId: session.id, path: '' }).catch(() => null)
    this.defaultWorkspace = undefined
    session.detail = { ...session.detail, workspace: undefined }
    session.updatedAt = Date.now()
    await this.persistSession(session)
  }

  async refreshDefaultWorkspace(): Promise<void> {
    const result = await coach.getWorkspaceDirectory({}).catch(() => null)
    this.defaultWorkspace = result?.ok && result.workspace ? this.cloneWorkspace(result.workspace) : undefined
  }

  async refreshWorkspace(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.detail.workspace) return
    const result = await coach.setWorkspaceDirectory({ sessionId: session.id, path: session.detail.workspace.path }).catch(() => null)
    if (result?.ok && result.workspace) {
      this.defaultWorkspace = this.cloneWorkspace(result.workspace)
      session.detail = { ...session.detail, workspace: result.workspace }
      return
    }
    if (result?.missing || !result?.ok) {
      if (this.defaultWorkspace?.path === session.detail.workspace.path) this.defaultWorkspace = undefined
      session.detail = { ...session.detail, workspace: undefined }
      session.updatedAt = Date.now()
      await this.persistSession(session)
    }
  }

  async applyWorkspaceBroadcast(params: { sessionId?: string; workspace?: WorkspaceRef | null }): Promise<void> {
    const sessionId = params.sessionId || ''
    if (sessionId === 'default') {
      this.defaultWorkspace = params.workspace ? this.cloneWorkspace(params.workspace) : undefined
      return
    }
    const session = sessionId ? this.getSession(sessionId) : undefined
    if (!session) return
    session.detail = { ...session.detail, workspace: params.workspace || undefined }
    session.updatedAt = Date.now()
    await this.persistSession(session)
  }

  async refreshHistory(): Promise<void> {
    const list = await maestroChat.listSessions({}).catch(() => [] as MessageSessionSummary[])
    this.historySessions = list
  }

  applyTaskSnapshot(tasks: MaestroTask[], remember = true): void {
    if (remember) this.latestTasks = markRaw(tasks.slice())
    for (const task of tasks) {
      const confirmSession =
        (task.sessionId ? this.getSession(task.sessionId) : undefined) ||
        this.turnService.activeSession()
      if (confirmSession) this.syncTaskConfirm(confirmSession, task)
      if (task.transient) continue

      const bound = this.taskBindings.get(task.id) || this.registerTaskBinding(task)
      if (!bound) continue
      const session = this.getSession(bound.sessionId)
      const message = session?.messages.find((item) => item.id === bound.messageId)
      if (!message || !session) continue
      if (!message.tasks) message.tasks = []
      const index = message.tasks.findIndex((item) => item.taskId === task.id)
      const current = index < 0 ? undefined : message.tasks[index]
      if (
        current &&
        current.state.time.update === task.state.time.update &&
        current.state.stalled === task.state.stalled
      ) {
        continue
      }
      this.turnService.touchForTask(bound.sessionId)
      const part: MaestroTaskPart = {
        type: 'task',
        taskId: task.id,
        callId: task.callId,
        name: task.name,
        kind: task.kind,
        state: task.state
      }
      if (index < 0) {
        message.tasks.push(part)
        this.scheduleScrollToBottomIfNear()
      } else {
        message.tasks[index] = part
      }
      if (task.state.status === 'completed' || task.state.status === 'error') {
        void this.persistSession(session)
      }
    }
  }

  private syncTaskConfirm(session: MessageSession, task: MaestroTask): void {
    const pending = task.state.pendingConfirm
    const emitted = this.confirmMessages.get(task.id)
    if (pending) {
      if (emitted === pending.id) return
      if (emitted) {
        const previous = session.messages.find(
          (item) => item.confirm?.taskId === task.id && item.confirm?.confirmId === emitted
        )
        if (previous?.confirm && !previous.confirm.answer) previous.confirm.answer = 'elsewhere'
      }
      const message = this.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'ai',
        type: 'confirm',
        content: '',
        streaming: false,
        promptExcluded: true,
        ts: Date.now(),
        confirm: {
          taskId: task.id,
          confirmId: pending.id,
          title: pending.title,
          detail: pending.detail,
          confirmLabel: pending.confirmLabel,
          cancelLabel: pending.cancelLabel,
          payload: pending.payload
        }
      })
      this.turnService.appendTimelineEntry(session, message)
      this.confirmMessages.set(task.id, pending.id)
      this.stickToBottom = true
      this.scrollToBottom(true)
      void this.persistSession(session)
      return
    }
    if (!emitted) return
    this.confirmMessages.delete(task.id)
    const message = session.messages.find(
      (item) => item.confirm?.taskId === task.id && item.confirm?.confirmId === emitted
    )
    if (message?.confirm && !message.confirm.answer) {
      message.confirm.answer = 'elsewhere'
      this.turnService.touchForTask(session.id)
      void this.persistSession(session)
    }
  }

  async answerConfirm(message: ChatMessage, confirm: boolean): Promise<{ ok: boolean }> {
    const card = message.confirm
    if (!card || card.answer) return { ok: false }
    const session = this.sessions.find((item) => item.messages.includes(message))
    card.answer = confirm ? 'confirm' : 'cancel'
    if (session) this.turnService.touchForTask(session.id)
    const result = await coach
      .respondTaskConfirm({ taskId: card.taskId, confirmId: card.confirmId, confirm })
      .catch(() => ({ ok: false }))
    if (!result.ok) card.answer = 'elsewhere'
    if (session) await this.persistSession(session)
    return result
  }

  pushActivity(step: AgentActivityStep): void {
    this.turnService.pushActivity(step)
  }

  pushThinking(payload: AgentThinkingState): void {
    this.turnService.pushThinking(payload)
  }

  pushStream(payload: AgentStreamDelta): void {
    this.turnService.pushStream(payload)
  }

  // Pin the list to the bottom. `force` scrolls unconditionally (mount / user-sent message); without
  // it, the scroll is gated by stickToBottom — and re-checked inside the deferred callbacks so a
  // scroll scheduled before the user scrolled up won't yank them back down mid-stream.
  scrollToBottom(force = false): void {
    if (!force && !this.stickToBottom) return
    if (!this.listEl) return
    nextTick(() => {
      if (!force && !this.stickToBottom) return
      const el = this.listEl
      if (!el) return
      el.scrollTop = el.scrollHeight
      requestAnimationFrame(() => {
        if (!force && !this.stickToBottom) return
        const node = this.listEl
        if (node) node.scrollTop = node.scrollHeight
      })
    })
  }

  private createEmptySession(options: SessionOptions): MessageSession {
    const now = Date.now()
    const session: MessageSession = {
      id: uid(),
      source: options.source || 'cowork',
      operationTabId: options.operationTabId || DEFAULT_OPERATION_TAB_ID,
      title: options.title,
      intent: options.intent,
      placeholder: placeholderFor(),
      // Maestro chats accept file attachments (read by the agent's read_file tool);
      // connector/customer-facing channels do not.
      allowFiles: (options.source || 'cowork') === 'cowork',
      messages: [],
      detail: { ...emptyDetail(), workspace: this.cloneWorkspace(this.defaultWorkspace) },
      contextUsage: emptyUsage(),
      createdAt: now,
      updatedAt: now
    }
    return session
  }

  async dispatch(
    session: MessageSession,
    message: string,
    currentHumanMessageId: string | undefined,
    attachedPaths: string[] | undefined,
    intent: 'root' | 'steering',
    turnId: string
  ): Promise<AgentReply> {
    return await coach.sendAgentMessage({
      sessionId: session.id,
      turnId,
      intent,
      message,
      context: this.buildAgentContext(session, currentHumanMessageId, attachedPaths)
    })
  }

  finishAssistant(msg: ChatMessage, full: string): void {
    const session = this.sessions.find((item) => item.messages.includes(msg))
    if (session) this.flushStreamBuffer(session.id)
    if (!msg.content.trim()) msg.content = full
    msg.thinking = false
    msg.streaming = false
    this.withTokenCount(msg)
    this.scrollToBottom()
  }

  private cloneWorkspace(workspace?: WorkspaceRef): WorkspaceRef | undefined {
    return workspace ? { ...workspace } : undefined
  }

  private shouldPersistSession(session: MessageSession): boolean {
    return session.source === 'cowork' && session.messages.some((message) => !message.id.startsWith('welcome-'))
  }

  async compactSessionIfNeeded(session: MessageSession, options?: { protectMessageIds?: Set<string> }): Promise<boolean> {
    this.updateSessionContextUsage(session)
    if (!session.contextUsage.compressionTriggered) return false
    // 渲染端的启发式说该压了 → 再问 main 一次真 usage。**只有真数说"没到线"才拦**,
    // 其余情形(账本里还没这个会话、跨进程失败)一律放行 —— 见 confirmRealUsage。
    if (!(await this.confirmRealUsage(session))) return false

    const candidates = this.selectCompactCandidates(session, options?.protectMessageIds || new Set<string>())
    if (!candidates.length) return false

    const until = candidates[candidates.length - 1]
    const compactMessage: ChatMessage = this.withTokenCount({
      id: uid(),
      source: 'cowork',
      role: 'ai',
      type: 'compact',
      content: COMPACTING_CONTENT,
      streaming: true,
      promptExcluded: true,
      compactUntilMessageId: until.id,
      ts: Date.now()
    })
    session.messages.push(compactMessage)
    this.scrollToBottom()
    await this.persistSession(session)
    await delay(80)

    const bridgeMessages = this.selectCompactBridgeMessages(session, candidates)
    // 压缩本体在 main:候选批是**它自己的 pi entry 树**,不是这里的 `candidates`
    // (渲染端的 chat 消息永远没有工具返回正文,拿它当候选批会让那套三层兜底永远休眠)。
    // `candidates` 从此只决定**渲染端自己**标哪些消息为已压缩 —— 两个坐标系不通,
    // 回包里的 `cutPoint` 是 entry 下标、映不到消息 id,所以这一份保留集仍由渲染端自己算。
    const outcome = await this.requestMainCompaction(session, candidates, bridgeMessages)
    const compactSummary = outcome.summary
    // **`compressed` 标照打,不看 `applied`** —— 与 cowork 一致(它那边 `applied === false`
    // 只改占位文案,不分叉打标)。
    //
    // 我先前写成「只有 applied 才打标」,理由是不想让记账说"压过了"而模型仍看得见全部。
    // 撤回,因为那个理由的前提不成立,而代价是真的:
    //  · 兜底是 pi 自己的 auto-compaction —— 两边都在 `piRuntimeAdapter.ts:188` 显式
    //    `setAutoCompactionEnabled?.(true)`,它在**回合内**按 overflow/threshold 触发并 compact-and-retry。
    //    所以「活着的会话没变小」不会一路撞到硬失败,有人接着;
    //  · `applied:false` 通常是**永久**失败(pi 把 `appendCompaction` 挪走了),门控会让渲染端每一轮
    //    重压一次、每次花一次模型钱,而重试不会成功;
    //  · 渲染端这份标记管的是**它自己**的账与补水载荷 —— 有了摘要覆盖那段,它们就该减下去,
    //    这件事与 pi 活着的树是否变小本来就是两回事(真 usage 才是那件事的口径,由 `shouldCompact` 读)。
    //
    // 让偏差**可见**而不是消失:占位文案照实说没落回会话(见下面的 `COMPACT_NOT_APPLIED_CONTENT`)。
    for (const message of candidates) {
      message.compressed = true
      this.withTokenCount(message)
    }
    compactMessage.content = outcome.applied ? COMPACTED_CONTENT : COMPACT_NOT_APPLIED_CONTENT
    compactMessage.streaming = false
    compactMessage.compactSummary = compactSummary
    compactMessage.compactUntilMessageId = until.id
    session.detail = {
      ...session.detail,
      compressedContext: compactSummary,
      compressedUntilMessageId: until.id,
      compressedAt: Date.now()
    }
    session.updatedAt = Date.now()
    this.updateSessionContextUsage(session)
    this.scrollToBottom()
    await this.persistSession(session)
    return true
  }

  private selectCompactCandidates(session: MessageSession, protectMessageIds: Set<string>): ChatMessage[] {
    const maxTokens = Math.max(1, session.contextUsage.maxTokens || this.contextLimitK * 1024)
    const recentFloor = maxTokens <= 2048 ? 2 : 6
    const recentTokenTarget = maxTokens <= 2048 ? Math.round(maxTokens * 0.3) : Math.min(Math.round(maxTokens * 0.25), 12000)
    const promptMessages = session.messages.filter(isPromptContextMessage)
    const protectedTail = new Set<string>(protectMessageIds)
    let recentCount = 0
    let recentTokens = 0

    for (let i = promptMessages.length - 1; i >= 0; i -= 1) {
      const message = promptMessages[i]
      if (protectMessageIds.has(message.id)) {
        protectedTail.add(message.id)
        continue
      }
      if (recentCount < recentFloor || recentTokens < recentTokenTarget) {
        protectedTail.add(message.id)
        recentCount += 1
        recentTokens += message.tokenCount || safeTokenCount(contentForTokenCount(message))
        continue
      }
      break
    }

    const removable = promptMessages.filter((message) => !protectedTail.has(message.id))
    if (!removable.length) return []

    const targetTokens = Math.round(maxTokens * 0.62)
    const needReduce = Math.max(1, session.contextUsage.usedTokens - targetTokens)
    const selected: ChatMessage[] = []
    let selectedTokens = 0
    for (const message of removable) {
      selected.push(message)
      selectedTokens += (message.tokenCount || safeTokenCount(contentForTokenCount(message))) + 4
      if (selectedTokens >= needReduce) break
    }
    return selected
  }

  private selectCompactBridgeMessages(session: MessageSession, compactedMessages: ChatMessage[]): ChatMessage[] {
    const compactedIds = new Set(compactedMessages.map((message) => message.id))
    const last = compactedMessages[compactedMessages.length - 1]
    const startIndex = last ? session.messages.findIndex((message) => message.id === last.id) + 1 : 0
    return session.messages
      .slice(Math.max(0, startIndex))
      .filter((message) => !compactedIds.has(message.id) && isPromptContextMessage(message))
      .slice(0, 4)
  }

  /**
   * 真数据的**否决票** —— 渲染端的启发式先说该压了,再问 main「按真 usage 算,到线了吗」。
   *
   * **只有 `under-threshold` 会拦下来**:那是真数说没到线,那就是没到线。`no-usage`(账本里
   * 还没有这个会话)、跨进程异常、解析不到模型 —— 一律放行,回落到渲染端自己的判断。
   * 与 cowork 的 `confirmRealUsage` 同一语义。
   *
   * 为什么是否决而不是主触发:渲染端的账是**它自己**要用的(进度条、`compressed` 标记都按它走),
   * 而真 usage 只有 main 知道。让真数当主触发就等于把渲染端的显示与它自己的决定拆成两套口径。
   *
   * 参数不发明新数字,用本仓已有的两个:
   * · `reserveTokens` = 「要留多少余量」,正是 `compressionRemainingPercent` 的语义(pi 的判据是
   *   `used > window - reserve`)。**按比例算,不写死** —— 写死的余量在小窗口模型上会让它永远在压缩;
   * · `keepRecentTokens` = `selectCompactCandidates` 里那个受保护尾部预算,同一把尺。
   */
  private async confirmRealUsage(session: MessageSession): Promise<boolean> {
    const maxTokens = Math.max(1, session.contextUsage.maxTokens || this.contextLimitK * 1024)
    try {
      const reply = await compaction.shouldCompact({
        sessionId: session.id,
        reserveTokens: Math.round((maxTokens * this.compressionRemainingPercent) / 100),
        keepRecentTokens: maxTokens <= 2048 ? Math.round(maxTokens * 0.3) : Math.min(Math.round(maxTokens * 0.25), 12000)
      })
      return reply.shouldCompact || reply.reason !== 'under-threshold'
    } catch {
      return true
    }
  }

  /**
   * 让 main 压一次 —— 摘要 + **把结果落回活着的 pi 会话**。
   *
   * 返回 `applied` 而不只是一段摘要,是因为两者的后果不同:摘要生成成功只代表有一段文字,
   * **只有 `applied:true` 才代表模型看到的上下文真的变小了**。调用方按它决定要不要给渲染端
   * 消息打 `compressed` 标 —— 打错的后果见 `compactSessionIfNeeded` 里那段注释。
   *
   * 失败时回落到确定性摘要(`buildFallbackCompactSummary`):那段文字对**补水**仍然有用
   * (重启后 `compressedContext` 是恢复历史的唯一来源),只是它没有让活着的会话变小。
   * 所以 `applied` 照实报 false,不拿兜底冒充一次成功的压缩。
   */
  private async requestMainCompaction(
    session: MessageSession,
    candidates: ChatMessage[],
    bridgeMessages: ChatMessage[]
  ): Promise<{ summary: string; applied: boolean; error?: string }> {
    const maxChars = this.compactSummaryMaxChars()
    const maxTokens = Math.max(1, session.contextUsage.maxTokens || this.contextLimitK * 1024)
    try {
      const reply = await compaction.compact({
        sessionId: session.id,
        keepRecentTokens: maxTokens <= 2048 ? Math.round(maxTokens * 0.3) : Math.min(Math.round(maxTokens * 0.25), 12000),
        // 迁移兜底而已:main 优先用自己 entry 树上最后一条 compaction entry 作为 S₁,
        // 只有树上还没有时才用这个(老会话的 `detail.compressedContext`)。
        previousSummary: session.detail.compressedContext || undefined
      })
      if (reply.ok && reply.summary.trim()) {
        return { summary: clipChars(reply.summary, maxChars), applied: reply.applied, error: reply.error }
      }
      return {
        summary: await this.buildCompactSummary(session, candidates, bridgeMessages),
        applied: false,
        error: reply.error || 'compact-failed'
      }
    } catch (error) {
      return {
        summary: await this.buildCompactSummary(session, candidates, bridgeMessages),
        applied: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async buildCompactSummary(session: MessageSession, messages: ChatMessage[], bridgeMessages: ChatMessage[]): Promise<string> {
    const maxChars = this.compactSummaryMaxChars()
    const previousSummary = session.detail.compressedContext || ''
    const previous = previousSummary.trim()
    const request: AgentCompactRequest = {
      previousSummary,
      messages: messages.map((message) => this.toCompactMessage(message)),
      bridgeMessages: bridgeMessages.map((message) => this.toCompactMessage(message)),
      maxSummaryChars: maxChars,
      targetContextLabel: this.contextLimitLabel
    }

    try {
      const reply = await coach.compactConversation(jsonSafe(request))
      if (reply.ok && reply.summary.trim()) return clipChars(reply.summary, maxChars)
    } catch {
      /* fall through to deterministic compact summary */
    }

    return this.buildFallbackCompactSummary(previous, messages, bridgeMessages, maxChars)
  }

  private compactSummaryMaxChars(): number {
    const maxTokens = Math.max(1, this.contextLimitK * 1024)
    const summaryChars = Math.round(maxTokens * 4 * COMPACT_SUMMARY_MAX_CONTEXT_SHARE)
    return Math.max(1600, Math.min(COMPACT_SUMMARY_HARD_MAX_CHARS, summaryChars))
  }

  private toCompactMessage(message: ChatMessage): AgentCompactMessage {
    return {
      role: message.role,
      content: messageTextForPrompt(message),
      ts: message.ts
    }
  }

  private buildFallbackCompactSummary(previous: string, messages: ChatMessage[], bridgeMessages: ChatMessage[], maxChars: number): string {
    const lines = [
      '# Compact Summary',
      '## Durable Facts',
      `Updated at: ${new Date().toISOString()}`,
      previous ? clipChars(previous, Math.round(maxChars * 0.72)) : '- No previous summary.',
      '## Current User Goal',
      '- Continue the Maestro chat using the compacted history plus newer verbatim turns.',
      '## Decisions And Constraints',
      '- Newer uncompressed messages override older compacted details if they conflict.',
      '## Open Threads',
      '- Preserve unresolved user requests, important data, and browser/app state from the compacted range.',
      '## Newly Compacted Range'
    ].filter(Boolean)

    for (const message of messages) {
      const role = message.role === 'human' ? 'Human' : 'Assistant'
      const text = clipChars(messageTextForPrompt(message), 700)
      if (text) lines.push(`- ${role}: ${text}`)
    }

    if (bridgeMessages.length) {
      lines.push('## Recent Handoff Notes')
      for (const message of bridgeMessages) {
        const role = message.role === 'human' ? 'Human' : 'Assistant'
        const text = clipChars(messageTextForPrompt(message), 360)
        if (text) lines.push(`- Boundary ${role}: ${text}`)
      }
    }

    return clipChars(lines.join('\n'), maxChars)
  }

  private latestCompactSummary(session: MessageSession): string {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const message = session.messages[i]
      if (message.type === 'compact' && message.compactSummary) return message.compactSummary
    }
    return session.detail.compressedContext || ''
  }

  buildAgentContext(session: MessageSession, currentHumanMessageId?: string, attachedPaths?: string[]): AgentConversationContext {
    const recentMessages: AgentConversationContext['recentMessages'] = []
    const recentBudget = Math.max(256, Math.min(Math.round((session.contextUsage.maxTokens || this.contextLimitK * 1024) * 0.35), 16000))
    let used = 0

    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const message = session.messages[i]
      if (message.id === currentHumanMessageId || !isPromptContextMessage(message)) continue
      const text = messageTextForPrompt(message).trim()
      const tokens = message.tokenCount || safeTokenCount(contentForTokenCount(message))
      if (recentMessages.length >= 4 && used + tokens > recentBudget) break
      recentMessages.unshift({ role: message.role, content: clipChars(text, 4000), ts: message.ts })
      used += tokens + 4
    }

    return {
      compactSummary: this.latestCompactSummary(session),
      recentMessages,
      attachedPaths: attachedPaths?.length ? attachedPaths.slice() : undefined,
      workspace: session.detail.workspace
    }
  }

  withTokenCount<T extends ChatMessage>(message: T): T {
    if (message.promptExcluded) {
      message.tokenCount = 0
      return message
    }
    message.tokenCount = safeTokenCount(contentForTokenCount(message))
    return message
  }

  updateSessionContextUsage(session: MessageSession): void {
    const compressedTokens = session.detail.compressedContext ? safeTokenCount(session.detail.compressedContext) : 0
    const messageTokens = session.messages.reduce((sum, message) => {
      if (message.compressed || message.promptExcluded) return sum
      const tokens = message.tokenCount || safeTokenCount(contentForTokenCount(message))
      message.tokenCount = tokens
      return sum + tokens + 4
    }, 0)
    const usedTokens = compressedTokens + messageTokens
    const maxTokens = this.contextLimitK * 1024
    const ratio = maxTokens > 0 ? Math.min(1, usedTokens / maxTokens) : 0
    const compressionRemainingPercent = this.compressionRemainingPercent
    const compressionTriggerPercent = 100 - compressionRemainingPercent
    const percent = Math.round(ratio * 100)
    session.contextUsage = {
      usedTokens,
      maxTokens,
      ratio,
      percent,
      label: `${usedTokens.toLocaleString()} / ${this.contextLimitLabel}`,
      compressionRemainingPercent,
      compressionTriggerPercent,
      compressionTriggered: percent >= compressionTriggerPercent
    }
  }

  private toStoredSession(session: MessageSession): MaestroChatSession {
    return {
      id: session.id,
      operationTabId: session.operationTabId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      archivedAt: session.archivedAt,
      detail: {
        compressedContext: session.detail.compressedContext || '',
        compressedUntilMessageId: session.detail.compressedUntilMessageId,
        compressedAt: session.detail.compressedAt,
        workspace: session.detail.workspace
      },
      messages: session.messages.map((message) => ({
        id: message.id,
        source: 'cowork',
        role: message.role,
        type: message.type || 'text',
        content: message.content,
        files: plainFiles(message.files),
        skill: message.skill ? jsonSafe(message.skill) : undefined,
        skills: message.skills?.length ? jsonSafe(message.skills) : undefined,
        replay: message.replay ? jsonSafe(message.replay) : undefined,
        streaming: message.streaming,
        error: message.error,
        activity: plainActivity(message.activity),
        tasks: message.tasks?.length ? jsonSafe(message.tasks) : undefined,
        confirm: message.confirm ? jsonSafe(message.confirm) : undefined,
        compressed: message.compressed,
        promptExcluded: message.promptExcluded,
        compactSummary: message.compactSummary,
        compactUntilMessageId: message.compactUntilMessageId,
        tokenCount: message.tokenCount,
        ts: message.ts
      }))
    }
  }

  private fromStoredSession(stored: MaestroChatSession): MessageSession {
    const session: MessageSession = {
      id: stored.id,
      source: 'cowork',
      operationTabId: stored.operationTabId || DEFAULT_OPERATION_TAB_ID,
      title: stored.title || 'Maestro',
      intent: 'chat',
      placeholder: placeholderFor(),
      allowFiles: true,
      messages: stored.messages.map((message: MaestroChatMessage) =>
        this.withTokenCount({
          id: message.id,
          source: 'cowork',
          role: message.role,
          type: message.type,
          content: message.content,
          files: message.files,
          skill: message.skill,
          skills: message.skills,
          replay: message.replay,
          streaming: false,
          error: message.error,
          activity: message.activity,
          tasks: message.tasks,
          confirm: message.confirm ? { ...message.confirm } : undefined,
          compressed: message.compressed,
          promptExcluded: message.promptExcluded,
          compactSummary: message.compactSummary,
          compactUntilMessageId: message.compactUntilMessageId,
          tokenCount: message.tokenCount,
          ts: message.ts
        })
      ),
      detail: stored.detail || emptyDetail(),
      contextUsage: emptyUsage(),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt
    }
    this.updateSessionContextUsage(session)
    return session
  }

  scheduleScrollToBottomIfNear(): void {
    if (this.scrollNearRaf) return
    this.scrollNearRaf = requestAnimationFrame(() => {
      this.scrollNearRaf = 0
      // Gated by stickToBottom inside scrollToBottom — no-ops once the user has scrolled up.
      this.scrollToBottom()
    })
  }

  private scheduleStreamFlush(): void {
    if (this.streamFlushRaf) return
    this.streamFlushRaf = requestAnimationFrame(() => this.flushStreamBuffers())
  }

  private flushStreamBuffers(): void {
    this.streamFlushRaf = 0
    if (!this.streamBuffers.size) return
    const entries = Array.from(this.streamBuffers.entries())
    this.streamBuffers.clear()
    for (const [sessionId, delta] of entries) this.appendStreamDelta(sessionId, delta)
  }

  flushStreamBuffer(sessionId: string): void {
    const delta = this.streamBuffers.get(sessionId)
    if (!delta) return
    this.streamBuffers.delete(sessionId)
    this.appendStreamDelta(sessionId, delta)
  }

  private appendStreamDelta(sessionId: string, delta: string): void {
    const session = this.getSession(sessionId)
    if (!session || !delta) return
    const sink = this.turnService.sink(session)
    if (!sink) return
    sink.thinking = false
    sink.content += delta
    this.scheduleScrollToBottomIfNear()
  }

  messageById(session: MessageSession, id: string): ChatMessage | undefined {
    return session.messages.find((message) => message.id === id)
  }

  lastStreamingMessage(session: MessageSession): ChatMessage | undefined {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const message = session.messages[i]
      if (message.role === 'ai' && message.streaming) return message
    }
    return undefined
  }

  bufferStreamDelta(sessionId: string, delta: string): void {
    this.streamBuffers.set(sessionId, (this.streamBuffers.get(sessionId) || '') + delta)
    this.scheduleStreamFlush()
  }

  private registerTaskBinding(task: MaestroTask): { sessionId: string; messageId: string } | null {
    const bound = this.turnService.bindTask(task)
    if (!bound) return null
    const session = this.getSession(bound.sessionId)
    if (!session) return null
    const message = this.turnService.appendTimelineEntry(
      session,
      this.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'ai',
        type: 'task',
        content: '',
        streaming: false,
        promptExcluded: true,
        ts: Date.now()
      })
    )
    const binding = { sessionId: session.id, messageId: message.id }
    this.taskBindings.set(task.id, binding)
    this.scheduleScrollToBottomIfNear()
    return binding
  }

  async stageAttachments(
    session: MessageSession,
    files?: ChatAttachment[]
  ): Promise<(ChatFile & { path: string })[]> {
    if (!files?.length) return []
    const registered = await coach
      .attachFiles({ sessionId: session.id, paths: files.map((file) => file.path) })
      .catch(() => null)
    const staged: (ChatFile & { path: string })[] = []
    const failed: string[] = []
    if (!registered) {
      failed.push(...files.map((file) => file.name || file.path))
    } else {
      // Main returns one result per input, in input order. Pairing by path is incorrect because
      // Main resolves/normalizes paths before returning them.
      for (let index = 0; index < files.length; index += 1) {
        const entry = registered[index]
        const file = files[index]
        if (entry?.ok && entry.path) {
          staged.push({
            name: entry.name || entry.path,
            path: entry.path,
            kind: 'attachment',
            size: entry.size,
            isDirectory: entry.isDirectory
          })
          continue
        }
        const reason = entry?.error
          ? ` (${entry.error})`
          : registered.length !== files.length
            ? ' (no result returned)'
            : ''
        failed.push(`${file.name || file.path}${reason}`)
      }
    }
    if (failed.length) {
      this.turnService.appendTimelineEntry(
        session,
        this.withTokenCount({
          id: uid(),
          source: 'cowork',
          role: 'ai',
          content:
            `Could not attach ${failed.length} file(s) — they were NOT sent to the agent:\n` +
            failed.map((name) => `· ${name}`).join('\n'),
          streaming: false,
          error: true,
          promptExcluded: true,
          ts: Date.now()
        })
      )
    }
    return staged
  }

}

export const messageStore = reactive<MessageStoreState>(
  iocHelper.bind({ controller: MessageStoreState, services: [TurnService] }) as MessageStoreState
)
