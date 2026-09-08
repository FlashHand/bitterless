/**
 * 候选批的读取与切分 —— **在 main 自己的 pi entry 树上**。**纯函数,只有 `import type`**
 * (编译期擦除),守卫脚本要能把它单独 esbuild 出来在 vm 里跑,`require` 是个空桩。
 *
 * ## 2026-08-28:这里原来是一层「renderer 消息 → pi message」的转换层,已删
 *
 * 删掉的是 `PiMessageIdentity` / `toPiMessage` / `toPiMessages` / `toPiEntries` 四个导出。
 * 理由是契约「候选批的来源 —— main 读 pi 的 entry 树,不由 renderer 交」那一条,决定性的一句:
 *
 * > **renderer 的 chat 消息永远没有工具返回正文。** 工具结果活在 pi 的回合内 session 与
 * > `modelIoLog`;`ChatMessage.type` 只有 `text|files|compact|task|confirm`,工具活动挂在
 * > `activity[]` 上**只有 label 没有 payload**。
 *
 * 而 `findCutPoint` 的静默失效条件**恰恰是关于工具返回体积的**(单条 `toolResult` ≥
 * `keepRecentTokens`)⇒ 拿 renderer 消息合成 entry 当候选批,ctx-005 那套三层兜底
 * **永远是休眠代码**:那条路径既不可能出现、也不可能被验。
 *
 * 转换层本身也是**有损**的:它只能从 `{ role, text, ts }` 造出文本消息,`tool: {kind,callId}`
 * 那个身份得由调用方额外声明 —— 而 renderer 手上根本没有这个信息。真正的 entry 树是
 * `AgentSession.sessionManager.getEntries()`,`findCutPoint` 的入参本来就是它
 * (`findCutPoint(entries: SessionEntry[], …)`)。
 *
 * 留下来的是三类:**边界解析**(上一轮的 S₁ 与压缩起点)· **切分**(下标 → entry 段)·
 * **账本 usage → pi Usage**。
 */
import type {
  CompactionCutPoint,
  CompactionCutRejection,
  CompactionCutSource,
  CompactionUsage
} from './compaction.types'
import type { AgentRuntimeUsage } from '../runtime/runtime.types'
import type { Usage } from '@earendil-works/pi-ai'
import type { SessionEntry, CutPointResult } from '@earendil-works/pi-coding-agent'

/**
 * pi 的 `AgentMessage`。**从 `SessionEntry` 里取而不是 import** —— 它的定义在
 * `@earendil-works/pi-agent-core`(pi-coding-agent 的传递依赖),不在我们的 `package.json` 里,
 * 直接 import 会把一个未声明的包变成编译期依赖。`SessionEntry` 的 message 分支给的就是它。
 */
type PiAgentMessage = Extract<SessionEntry, { type: 'message' }>['message']

/**
 * `toCutPoint` 收的形状:pi 的 `CutPointResult` + ctx-005 兜底的观测字段。
 *
 * 定在这里而不是 import `compactionCut.ts` 的 `ResolvedCutPoint`:那样两个文件会互相依赖,
 * 而守卫脚本是**逐文件** esbuild 进 vm 的(`require` 只认显式注入的那几个)。
 */
export interface CutPointOutcome extends CutPointResult {
  source?: CompactionCutSource
  piFirstKeptEntryIndex?: number
  rejection?: CompactionCutRejection
  pairedToolCuts?: number
  keptTokens?: number
  cutTokens?: number
}

/**
 * 本次压缩的边界 —— 与 pi 自己的 `prepareCompaction`(`compaction.js:475-493`)同一算法。
 *
 * pi 未导出 `prepareCompaction`(只导出 `getLatestCompactionEntry`),所以这段边界逻辑复刻:
 *  · 上一轮的 `compaction` entry 给出 S₁(`summary`)与保留起点(`firstKeptEntryId`);
 *  · 压缩只在 `[boundaryStart, entries.length)` 上做 —— **已经被上一轮摘走的那些不再摘第二遍**,
 *    否则每一轮都从会话开头重摘,S 会逐轮吃掉自己。
 *  · `firstKeptEntryId` 找不到(上一轮把尾部清空了 ⇒ 那个 id 故意匹配不到任何 entry)⇒
 *    起点退到 `prevCompactionIndex + 1`,与 pi 的 `findIndex >= 0 ? … : prevCompactionIndex + 1` 一致。
 */
export interface CompactionBoundary {
  startIndex: number
  previousSummary?: string
  /** 上一轮 `compaction` entry 的下标;没有则 `-1`。 */
  previousCompactionIndex: number
}

export const compactionBoundary = (entries: SessionEntry[]): CompactionBoundary => {
  const list = entries || []
  let previousCompactionIndex = -1
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].type === 'compaction') {
      previousCompactionIndex = i
      break
    }
  }
  if (previousCompactionIndex < 0) return { startIndex: 0, previousCompactionIndex }
  const previous = list[previousCompactionIndex] as { summary?: string; firstKeptEntryId?: string }
  const keptIndex = list.findIndex((entry) => entry.id === previous.firstKeptEntryId)
  return {
    startIndex: keptIndex >= 0 ? keptIndex : previousCompactionIndex + 1,
    previousSummary: previous.summary || undefined,
    previousCompactionIndex
  }
}

/**
 * 一条 entry 进摘要时的消息形态 —— 复刻 pi 的 `getMessageFromEntryForCompaction`
 * (`compaction.js:60-65` → `getMessageFromEntry` `:45-59`)。**两个都是模块私有,取不到**,
 * 所以照它的分支复刻;`compaction` entry 返回 `undefined`(旧摘要不再摘一遍 —— S₁ 走
 * `previousSummary` 那条口子)。
 *
 * `custom_message` → `role:'custom'`(pi `messages.js:57` `createCustomMessage`):**必须收** ——
 * ② U 链与 ④ 清单就是这个形态,漏掉它们等于让上一轮挂上去的用户原话在下一轮凭空消失。
 */
const messageFromEntry = (entry: SessionEntry): PiAgentMessage | undefined => {
  if (entry.type === 'message') return entry.message
  if (entry.type === 'custom_message') {
    return {
      role: 'custom',
      customType: entry.customType,
      content: entry.content,
      display: entry.display,
      details: entry.details,
      timestamp: new Date(entry.timestamp).getTime()
    } as PiAgentMessage
  }
  if (entry.type === 'branch_summary') {
    return { role: 'branchSummary', summary: entry.summary, fromId: entry.fromId, timestamp: new Date(entry.timestamp).getTime() } as PiAgentMessage
  }
  return undefined
}

/** 一段 entry → pi 的 `AgentMessage[]`(`generateSummary` 的入参)。不产生消息的 entry 跳过。 */
export const entryMessages = (entries: SessionEntry[], from: number, to: number): PiAgentMessage[] => {
  const list = entries || []
  const out: PiAgentMessage[] = []
  for (let i = Math.max(0, from); i < Math.min(to, list.length); i += 1) {
    const message = messageFromEntry(list[i])
    if (message) out.push(message)
  }
  return out
}

/**
 * ⑤ 尾部**被清空** —— 保留区一个 token 都不剩。**判据是 `keptTokens === 0`,不是下标相等。**
 *
 * ⚠ 早先写的 `firstKeptEntryIndex === entries.length` **不成立**(ctx-005 review 的反例):
 * 批以一条 `label` entry 收尾时切点是 `3/4`(下标不相等)而 `keptTokens === 0` —— `label` /
 * `session_info` / `thinking_level_change` 这些 entry 不产生消息,留着它们等于没留。
 * 下标相等只在「批以 message entry 收尾」时才等价,而**读真 pi entry 树之后这个前提没了**。
 *
 * 语义上要的一直是「保留区里没有内容」,所以直接判它。`keptTokens` 由 `resolveCutPoint` 恒填。
 */
const isTailCleared = (result: CutPointOutcome): boolean => result.keptTokens === 0

/**
 * 切点结果 → entry id。下标越界一律留空,不给调用方一个假 id。
 *
 * `tailCleared` 见 `isTailCleared`:**尾部被清空是合法结果**(ctx-005 那一路)。置位而不是抛错 ——
 * 调用方据此把一个匹配不到任何 entry 的 `firstKeptEntryId` 交给 `appendCompaction`,
 * pi 的 `foundFirstKept` 永不置真 ⇒ 保留区为空,正是要的语义。
 */
export const toCutPoint = (entries: SessionEntry[], result: CutPointOutcome): CompactionCutPoint => {
  const list = entries || []
  const at = (index: number): string | undefined => (index >= 0 && index < list.length ? list[index].id : undefined)
  return {
    firstKeptEntryId: at(result.firstKeptEntryIndex),
    firstKeptIndex: result.firstKeptEntryIndex,
    turnStartEntryId: at(result.turnStartIndex),
    turnStartIndex: result.turnStartIndex,
    isSplitTurn: result.isSplitTurn,
    ...(isTailCleared(result) ? { tailCleared: true } : {}),
    ...(result.source ? { source: result.source } : {}),
    ...(typeof result.piFirstKeptEntryIndex === 'number' ? { piFirstKeptIndex: result.piFirstKeptEntryIndex } : {}),
    ...(result.rejection ? { rejection: result.rejection } : {}),
    ...(typeof result.pairedToolCuts === 'number' ? { pairedToolCuts: result.pairedToolCuts } : {}),
    ...(typeof result.keptTokens === 'number' ? { keptTokens: result.keptTokens } : {}),
    ...(typeof result.cutTokens === 'number' ? { cutTokens: result.cutTokens } : {})
  }
}

/**
 * 要摘掉的那一段(会被丢弃,所以要先摘)。
 *
 * 起点是 `boundary.startIndex`(上一轮的保留起点)而不是 0 —— 见 `compactionBoundary`。
 * 切在 turn 中间时**摘到 turn 起点为止**,起点之后的前缀单独摘一份(见 `turnPrefixSlice`)——
 * 否则那段前缀既不在主摘要里、也不在保留区里,凭空消失。
 */
export const historySlice = (entries: SessionEntry[], cutPoint: CompactionCutPoint, startIndex = 0): PiAgentMessage[] => {
  const end = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptIndex
  if (end <= startIndex) return []
  return entryMessages(entries, startIndex, end)
}

/** split turn 的前缀:turn 起点 → 第一条保留 entry 之间。不是 split turn 就是空。 */
export const turnPrefixSlice = (entries: SessionEntry[], cutPoint: CompactionCutPoint): PiAgentMessage[] => {
  if (!cutPoint.isSplitTurn) return []
  const start = Math.max(0, cutPoint.turnStartIndex)
  const end = Math.min(cutPoint.firstKeptIndex, (entries || []).length)
  if (end <= start) return []
  return entryMessages(entries, start, end)
}

/**
 * 账本的 usage → pi 的 `Usage`。
 *
 * 账本存的是 `costUsd`(一个数),pi 的 `Usage.cost` 是逐项拆开的对象 —— 只有 `total` 填得出来,
 * 其余留零。`calculateContextTokens` 根本不读 cost,填它只为满足类型;**不编造**分项金额。
 */
export const toPiUsage = (usage: AgentRuntimeUsage): Usage => ({
  input: usage.input || 0,
  output: usage.output || 0,
  cacheRead: usage.cacheRead || 0,
  cacheWrite: usage.cacheWrite || 0,
  totalTokens: usage.totalTokens || 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.costUsd || 0 }
})

/**
 * 对外的 usage 快照。
 *
 * `ledgerHit` 判据是 `contextTokens > 0` —— 账本对未知 key 返回全零,而全零与「记过一笔零」
 * 在 `usageLedger.get()` 上不可分。跑过一轮的回合累计不可能为零,所以这个判据是可用的;
 * 为 false 时调用方必须退回本地估算,**不能**把零当成「上下文是空的」。
 */
export const toCompactionUsage = (usage: AgentRuntimeUsage, contextTokens: number, contextWindow: number): CompactionUsage => ({
  input: usage.input || 0,
  output: usage.output || 0,
  cacheRead: usage.cacheRead || 0,
  cacheWrite: usage.cacheWrite || 0,
  totalTokens: usage.totalTokens || 0,
  contextTokens,
  contextWindow,
  ledgerHit: contextTokens > 0
})
