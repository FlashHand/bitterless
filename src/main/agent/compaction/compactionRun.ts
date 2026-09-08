/**
 * 一次压缩的编排:边界 → 切点 → 选段 → 摘要(主 + split turn 前缀)→ 合并 → 路径清洗 → **落 entry**。
 *
 * **pi 的函数与 pi 会话的写入面都按依赖注入进来,不在这里 import**(只有 `import type`,
 * 编译期擦除)。两个理由:
 *  · pi 是 ESM-only 且要动态 `import()`(见 `piRuntimeAdapter` 顶部那段说明),模块级 import 不成立;
 *  · 验收(`previousSummary` 被传入 / 整替而非追加 / 产出不含路径 / split turn 两份摘要都产生并合并 /
 *    **②③④ 真的落到会话上** / **尾部清空是合法结果**)都是**编排**的性质,注入之后守卫脚本
 *    不必启动 Electron、不必调模型就能验。
 *
 * 真正的 pi 装配在 `main/xpc/compaction.handler.ts`。
 *
 * ## 候选批来自哪
 *
 * **`deps.entries` —— main 自己 pi 会话的 entry 树**(`AgentSession.sessionManager.getEntries()`),
 * 不是 renderer 交来的消息清单(2026-08-28 定案,理由见 `compactionEntries.ts` 顶部)。
 * `params.messages` / `params.turnPrefixMessages` 这两个过渡字段在本文件里**一次都不出现**。
 */
import type { CompactionCutPoint, CompactionReply, CompactionRequest, CompactionUsage } from './compaction.types'
import type { Api, Model, ProviderHeaders } from '@earendil-works/pi-ai'
import type {
  SessionEntry,
  estimateTokens as PiEstimateTokens,
  findCutPoint as PiFindCutPoint,
  findTurnStartIndex as PiFindTurnStartIndex,
  generateSummary as PiGenerateSummary
} from '@earendil-works/pi-coding-agent'
import { resolveCutPoint } from './compactionCut'
import {
  PI_SUMMARY_RESERVE_TOKENS,
  TURN_PREFIX_CUSTOM_INSTRUCTIONS,
  mergeSummaries,
  piReserveForTurnPrefix,
  stripPaths
} from './compactionPrompt'
import { compactionBoundary, entryMessages, historySlice, toCutPoint, turnPrefixSlice } from './compactionEntries'

/**
 * ⑤ 尾部被清空时交给 `appendCompaction` 的 `firstKeptEntryId`。
 *
 * **故意匹配不到任何 entry** —— pi 的 `buildSessionContext`(`session-manager.js:190-200`)按
 * `entry.id === compaction.firstKeptEntryId` 找保留起点,找不到就一条都不保留,而那正是
 * 「尾部清空」要的语义。entry id 由 `generateId()` 产出、永不为空串,所以这个哨兵是确定的。
 *
 * 这条**不是错误路径**:ctx-005 证明单条工具返回 ≥ 尾部预算且它到最新之间全是 `toolResult` 时,
 * 「一起切走」必然清空尾部 —— 被切走的东西全部进了摘要(主 + 三段前缀),一个字都没丢。
 */
export const TAIL_CLEARED_FIRST_KEPT_ID = ''

/** `deps.apply` 收的形状 —— ②③④ 三条 entry 的内容,一次落齐。 */
export interface CompactionApplyPlan {
  /** ③ 摘要全文(已合并、已过路径清洗)。 */
  summary: string
  /** ⑤ 保留起点。尾部清空时是 `TAIL_CLEARED_FIRST_KEPT_ID`。 */
  firstKeptEntryId: string
  /** 压缩前的上下文估算(pi 的 chars/4 口径)。只是 `compaction` entry 上的元数据。 */
  tokensBefore: number
  /** ② 用户原话链的正文,逐字。空 = 不落这条 entry。 */
  userChainText?: string
  /** ④ 清单的正文,一行一条。空 = 不落这条 entry。 */
  manifestText?: string
}

export interface CompactionApplyResult {
  ok: boolean
  error?: string
}

export interface CompactionDeps {
  /**
   * 候选批 —— **main 自己 pi 会话的 entry 树**,时间升序。`findCutPoint` 的入参本来就是它。
   * 空数组 = 这个会话在 main 侧还没有 pi 会话(没跑过一轮)⇒ 没有模型上下文可压。
   */
  entries: SessionEntry[]
  /** pi `findCutPoint`。签名从 pi 取,别手抄 —— 它不是稳定契约,升级时要让 tsc 报错而不是静默错位。 */
  findCutPoint: typeof PiFindCutPoint
  /** pi `findTurnStartIndex`。ctx-005 兜底切点的 turn 归属靠它 —— turn 边界的定义权在 pi。 */
  findTurnStartIndex: typeof PiFindTurnStartIndex
  /** pi `estimateTokens`。兜底的累加必须与 `findCutPoint` 同一把尺(chars/4)。 */
  estimateTokens: typeof PiEstimateTokens
  /** pi `generateSummary`。位置参数第 7 是 `customInstructions`、第 8 是 `previousSummary`。 */
  generateSummary: typeof PiGenerateSummary
  /**
   * ②③④ 落到 pi 会话上 —— `appendCustomMessageEntry` × 2 + `appendCompaction`。
   *
   * 省略 = 只算不落(`cutPoint()` 那条只读路径)。**摘要成功但没落上去不算压缩成功**:
   * 模型看到的上下文一个 token 都没少,下一轮直接撞窗口上限。所以 `applied` 单独报。
   */
  apply?: (plan: CompactionApplyPlan) => CompactionApplyResult
  model: Model<Api>
  apiKey?: string
  /**
   * pi 0.84.0 起 `getApiKeyAndHeaders()` 返回 `ProviderHeaders`(值可为 `null` = **删除标记**,
   * 用来阻止占位凭据被发出去)。CHANGELOG 明确要求转发方**原样透传**,所以这里用 pi 自己的类型,
   * 不收窄成 `Record<string, string>` —— 丢掉 `null` 项等于让那个头照发。
   */
  headers?: ProviderHeaders
  signal?: AbortSignal
  usage: CompactionUsage
}

/**
 * pi 的 `generateSummary` 在 .d.ts 里仍把 headers 标成 `Record<string, string>`,而它的实现
 * (`compaction.js:441`)只是把这一项原样塞进 `completionOptions` 交给 pi-ai,而 pi-ai 收的是
 * `ProviderHeaders`(`models.d.ts:62`)。也就是说**运行时通路是干净的,陈旧的只是那行标注**。
 * 所以这里在唯一的两个调用点做一次窄转换,把 `null` 删除标记原样送到底,而不是在上游丢掉它们。
 * pi 修好标注后删掉这个函数即可。
 */
const piHeaders = (headers?: ProviderHeaders): Record<string, string> | undefined =>
  headers as Record<string, string> | undefined

const emptyCutPoint: CompactionCutPoint = {
  firstKeptEntryId: undefined,
  firstKeptIndex: 0,
  turnStartEntryId: undefined,
  turnStartIndex: -1,
  isSplitTurn: false,
  source: 'none',
  piFirstKeptIndex: 0,
  pairedToolCuts: 0,
  keptTokens: 0,
  cutTokens: 0
}

type CutDeps = Pick<CompactionDeps, 'findCutPoint' | 'findTurnStartIndex' | 'estimateTokens'>

/**
 * 只算切点,不摘要、不落 entry。
 *
 * **返回值已经过 ctx-005 三层处置的前两层**(`resolveCutPoint`:校验 `findCutPoint` 的返回值,
 * 不过关就 item 粒度硬切并修 `tool_call`/`tool_result` 配对)。第 3 层是「被切走的前缀单独摘一份」,
 * 它只在 `runCompaction` 里成立 —— 那要调模型;这里只把切点算准,并把
 * `isSplitTurn` / `turnStartIndex` 标对,让 `turnPrefixSlice` 那条路原样接住。
 *
 * `startIndex` 是上一轮的保留起点(`compactionBoundary`)—— 不从 0 起,否则每轮重摘全会话。
 */
export const computeCutPoint = (entries: SessionEntry[], keepRecentTokens: number, startIndex: number, deps: CutDeps): CompactionCutPoint => {
  const list = entries || []
  if (!list.length || startIndex >= list.length) return emptyCutPoint
  const resolved = resolveCutPoint(list, Math.max(0, startIndex), list.length, keepRecentTokens, deps)
  return toCutPoint(list, resolved)
}

const sumEntryTokens = (entries: SessionEntry[], deps: CutDeps): number => {
  let total = 0
  for (const message of entryMessages(entries, 0, (entries || []).length)) total += deps.estimateTokens(message)
  return total
}

export const runCompaction = async (params: CompactionRequest, deps: CompactionDeps): Promise<CompactionReply> => {
  const entries = deps.entries || []
  const boundary = compactionBoundary(entries)
  // S₁ 的权威来源是**main 自己 entry 树上最后一条 `compaction` entry** —— 那才是模型看见的那一份。
  // `params.previousSummary` 只在树上还没有 compaction entry 时作为迁移兜底(老会话的
  // `detail.compressedContext`)。
  const previousSummary = boundary.previousSummary || params.previousSummary?.trim() || undefined
  const cutPoint = computeCutPoint(entries, params.keepRecentTokens, boundary.startIndex, deps)
  const entryCount = Math.max(0, entries.length - boundary.startIndex)

  const history = historySlice(entries, cutPoint, boundary.startIndex)
  // **三层处置的第 3 层就落在这一行**:item 粒度兜底(`resolveCutPoint`)把硬切走的那段标成
  // `isSplitTurn` + `turnStartIndex`,于是它被 `turnPrefixSlice` 原样切出来、走下面 `prefixTask`
  // 那份 `generateTurnPrefixSummary` 复刻(ctx-004 建的三段骨架)。**不另写一份前缀摘要**。
  const turnPrefix = turnPrefixSlice(entries, cutPoint)

  const fail = (error: string, redactedPaths = 0): CompactionReply => ({
    ok: false,
    summary: '',
    cutPoint,
    usage: deps.usage,
    mergedTurnPrefix: false,
    redactedPaths,
    entryCount,
    applied: false,
    ts: Date.now(),
    error
  })

  if (!history.length && !turnPrefix.length && !previousSummary) return fail('nothing-to-compact')

  // **不覆盖 pi 的 `reserveTokens`**:主摘要照传 pi 的默认值,前缀折算成 pi 自己的 `0.5 × R` 口径。
  // 摘要长度不设人为上限 —— `maxTokens` 到顶是截断,砍掉的是骨架尾部的 Next Steps / Critical Context。
  const summaryReserve = PI_SUMMARY_RESERVE_TOKENS
  const prefixReserve = piReserveForTurnPrefix(PI_SUMMARY_RESERVE_TOKENS)

  /**
   * 本批没有要摘的历史,但上一轮有摘要 —— **原样留住 S₁,不调模型**。
   *
   * pi 在这条路上填的是字符串 `"No prior history."`(`compaction.js:571`),因为 pi 的摘要是
   * append-only 的条目链,旧摘要还在链上;我们是**单槽整替**,照抄 pi 就等于把 S₁ 抹掉。
   */
  // 位置参数第 7 是 `customInstructions` —— **主摘要一律传 `undefined`**(契约「③ 摘要」实测定案):
  // A/B/C 三组各 8 轮真实压缩里,哪怕是 C 组那种零裁剪许可的纯加法要求,逐字留存也从 89% 掉到 51%
  // ⇒ 追加指令会把模型从**搬运**推成**重写**,而重写在递归摘要里逐代复利。别把它传回来。
  const historyTask = history.length
    ? deps.generateSummary(history, deps.model, summaryReserve, deps.apiKey, piHeaders(deps.headers), deps.signal, undefined, previousSummary)
    : Promise.resolve(previousSummary || '')

  // 前缀不传 `previousSummary`:它摘的是**这一个 turn 的前半段**,把整会话的旧摘要塞进去会让
  // 模型把两者混写,而两份摘要随后是要拼在一起的 —— 拼出来会自我重复。
  const prefixTask = turnPrefix.length
    ? deps.generateSummary(turnPrefix, deps.model, prefixReserve, deps.apiKey, piHeaders(deps.headers), deps.signal, TURN_PREFIX_CUSTOM_INSTRUCTIONS, undefined)
    : Promise.resolve('')

  let cleaned: { text: string; redacted: number }
  let mergedTurnPrefix = false
  try {
    // 并行 —— 与 pi `compact()` 同做法(`compaction.js:569`):两份摘要之间没有数据依赖。
    const [historySummary, prefixSummary] = await Promise.all([historyTask, prefixTask])
    cleaned = stripPaths(mergeSummaries(historySummary, prefixSummary))
    mergedTurnPrefix = Boolean(turnPrefix.length && prefixSummary.trim())
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  if (!cleaned.text.trim()) return fail('compact-summary-empty', cleaned.redacted)

  /**
   * ⑤ 尾部清空(`cutPoint.tailCleared`)是**合法结果**,在这里显式处置而不是当异常:
   * 交给 `appendCompaction` 的是那个匹配不到任何 entry 的哨兵 id ⇒ pi 一条都不保留。
   */
  const firstKeptEntryId = cutPoint.tailCleared ? TAIL_CLEARED_FIRST_KEPT_ID : cutPoint.firstKeptEntryId || TAIL_CLEARED_FIRST_KEPT_ID
  const applied = deps.apply
    ? deps.apply({
        summary: cleaned.text,
        firstKeptEntryId,
        tokensBefore: sumEntryTokens(entries, deps),
        userChainText: params.userChainText,
        manifestText: params.manifestText
      })
    : { ok: false, error: 'no-apply-surface' }

  return {
    ok: true,
    summary: cleaned.text,
    cutPoint,
    usage: deps.usage,
    mergedTurnPrefix,
    redactedPaths: cleaned.redacted,
    entryCount,
    applied: applied.ok,
    ts: Date.now(),
    ...(applied.ok ? {} : { error: applied.error || 'apply-failed' })
  }
}
