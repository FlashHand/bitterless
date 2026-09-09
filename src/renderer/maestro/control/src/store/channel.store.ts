import { reactive } from 'vue'
import type { TabInfo } from '@maestro-shared/coach.api'
import { messageStore } from './message.store'
import type { MessageSession } from './message.type'

export type ChannelSource = 'cowork' | 'connector'

const FALLBACK_OPERATION_TAB_ID = 'active-operation-tab'

class ChannelStoreState {
  activeSource: ChannelSource = 'cowork'
  currentOperationTabId = FALLBACK_OPERATION_TAB_ID
  maestroSessionByTabId: Record<string, string> = {}
  initialized = false

  get activeSession(): MessageSession | undefined {
    if (this.activeSource === 'connector') return undefined
    const sessionId = this.maestroSessionByTabId[this.currentOperationTabId]
    return sessionId ? messageStore.getSession(sessionId) : undefined
  }

  /**
   * 把「面板此刻显示的是谁」单向写进 `message.store`,并给它置读。
   *
   * **一处收敛,不散写。** cowork 那侧是单一 `activeSessionId`,写在切会话那一个点上;
   * bl 的会话是**按 operation tab 存的**(`maestroSessionByTabId`),能改变「显示的是谁」的
   * 入口有五个(新建 / 全新 / 选历史 / 切 tab / 切 source)。散写五份必然漏,
   * 所以从既有的 `activeSession` getter 取真源 —— 不新增第二份「当前是谁」的状态。
   *
   * 连接器 tab 活跃时 `activeSession` 为 undefined ⇒ 写空串。那时结束的回合**会**置未读,
   * 这是对的:人正看着 connector,那条结论他确实没看到
   * (docs/features/maestro-session-list-unread.md #1)。
   */
  private syncActiveSession(): void {
    const sessionId = this.activeSession?.id || ''
    messageStore.activeSessionId = sessionId
    if (sessionId) messageStore.markRead(sessionId)
  }

  async init(tabs: TabInfo[] = []): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await messageStore.init()
    await this.syncOperationTabs(tabs)
  }

  selectSource(source: ChannelSource): void {
    this.activeSource = source
    this.syncActiveSession()
  }

  async startNewMaestroSession(sessionId: string): Promise<boolean> {
    if (this.activeSource === 'connector') return false
    if (this.maestroSessionByTabId[this.currentOperationTabId] !== sessionId) return false
    if (messageStore.turnService.activeTurn()) return false
    // New chat does NOT archive the old session — it stays sendable and available in the
    // history drawer; we only drop it when it's an empty draft. (Real archive comes later.)
    await messageStore.discardIfEmpty(sessionId)

    const session = messageStore.createSession({ title: 'Maestro', intent: 'chat', operationTabId: this.currentOperationTabId })
    this.maestroSessionByTabId[this.currentOperationTabId] = session.id
    this.syncActiveSession()
    return true
  }

  async startFreshMaestroSession(title = 'Maestro'): Promise<MessageSession | undefined> {
    this.activeSource = 'cowork'
    const currentId = this.maestroSessionByTabId[this.currentOperationTabId]
    const current = currentId ? messageStore.getSession(currentId) : undefined
    if (messageStore.turnService.activeTurn()) return undefined
    if (current && !current.archivedAt) await messageStore.archive(current.id)

    const session = messageStore.createSession({ title, intent: 'chat', operationTabId: this.currentOperationTabId })
    this.maestroSessionByTabId[this.currentOperationTabId] = session.id
    this.syncActiveSession()
    return session
  }

  async selectMaestroHistorySession(sessionId: string): Promise<boolean> {
    const session = await messageStore.loadPersistedSession(sessionId)
    if (!session) return false
    this.activeSource = 'cowork'
    this.maestroSessionByTabId[this.currentOperationTabId] = session.id
    this.syncActiveSession()
    return true
  }

  async syncOperationTabs(tabs: TabInfo[]): Promise<void> {
    const activeTab = tabs.find((tab) => tab.active)
    this.currentOperationTabId = activeTab?.id || FALLBACK_OPERATION_TAB_ID
    await this.ensureMaestroSession(this.currentOperationTabId)
    this.syncActiveSession()
  }

  private async ensureMaestroSession(operationTabId: string): Promise<MessageSession> {
    const existingId = this.maestroSessionByTabId[operationTabId]
    const existing = existingId ? messageStore.getSession(existingId) : undefined
    if (existing && !existing.archivedAt) return existing

    const persisted = await messageStore.latestActiveSessionForOperationTab(operationTabId)
    if (persisted && !persisted.archivedAt) {
      this.maestroSessionByTabId[operationTabId] = persisted.id
      return persisted
    }

    const session = messageStore.createSession({ title: 'Maestro', intent: 'chat', operationTabId })
    this.maestroSessionByTabId[operationTabId] = session.id
    return session
  }
}

export const channelStore = reactive<ChannelStoreState>(new ChannelStoreState())
