/**
 * 切点校验与 item 粒度兜底(ctx-005)。**纯函数,只有 `import type`** —— pi 的函数按依赖注入,
 * 守卫脚本要能把它 esbuild 出来在 vm 里跑(同 `compactionRun` / `compactionEntries` 那一批)。
 *
 * ## 治的是什么病
 *
 * `findCutPoint`(pi `compaction.js:298`)有一条**静默失效路径**,根因分析见
 * `overmind:areas/agent-runtime/chat/compaction-decisions.html #1.9`:
 *
 * ```js
 * let cutIndex = cutPoints[0];                       // 默认 = 区间【最靠前】的切点
 * for (let i = endIndex - 1; i >= startIndex; i--) {
 *   accumulatedTokens += estimateTokens(entries[i].message);
 *   if (accumulatedTokens >= keepRecentTokens) {
 *     for (let c = 0; c < cutPoints.length; c++) {
 *       if (cutPoints[c] >= i) { cutIndex = cutPoints[c]; break; }   // ← 找不到就不赋值
 *     }
 *     break;
 *   }
 * }
 * ```
 *
 * 而 `findValidCutPoints`(`:223`)把 `toolResult` **排除在切点之外**(它必须紧跟自己的
 * `tool_call`)。于是:**单条工具返回 ≥ `keepRecentTokens` 且它就是最新的那条** ⇒ 内层搜不到
 * `cutPoints[c] >= i` ⇒ `cutIndex` 停在 `cutPoints[0]` ⇒ `firstKeptEntryIndex ≈ startIndex` ⇒
 * **压缩空转**(什么都没切走)⇒ 下一轮加新内容直接撞窗口上限。
 *
 * 三条让它危险的性质:
 *  ① **静默** —— 不抛错、不返回错误码,返回的是一个结构完好的 `CutPointResult`。
 *     pi 自己的 `prepareCompaction` 也没校验这个。
 *  ② 后果是**爆窗口**不是变慢 —— 上下文没降,下一轮就终止会话。
 *  ③ **`isSplitTurn` 在这条路径上是 `false`** —— `cutPoints[0]` 通常是条 user 消息 ⇒
 *     `isUserMessage` 为真 ⇒ `isSplitTurn: false`。**指望 split-turn 分支兜住它是错的**
 *     (决策台账 #1.9 专门更正了 D-13 残留风险里写错的那一句)。
 *
 * ## 三层处置(契约「切点校验与兜底」· 台账 D-31)
 *
 * | 层 | 落点 |
 * |---|---|
 * | 1 校验 | `validateCutPoint` —— `firstKeptEntryIndex > startIndex` 且被选段非空,才往下走 |
 * | 2 item 粒度硬切 | `itemGranularCutIndex` + `repairToolPairs` —— 从最新往前累加到 ≥ 预算就切,**不管是不是 `toolResult`**;切在工具返回上时同一对**一起切走** |
 * | 3 前缀单独摘 | 不在本文件:`resolveCutPoint` 把兜底切点标成 `isSplitTurn` + `turnStartIndex`,ctx-004 的 `turnPrefixSlice` → `TURN_PREFIX_CUSTOM_INSTRUCTIONS` 那条路原样接住 |
 *
 * **第 2 层为什么选「一起切走」而不是「补占位 `tool_result`」**:兜底切的是一个**连续前缀**
 * (`[startIndex, cutIndex)` 全部被吸收),而 `tool_result` 永远在自己的 `tool_call` 之后 ⇒
 * 这种切法唯一可能制造的落单是「**返回被留下、调用被切走**」。补一条占位 `tool_result` 修不了这个
 * 方向的落单(要补的是 `tool_call`);而把这一对一起推进前缀,既让配对天然完好,又正好把那条
 * **巨型返回**赶出尾部 —— 它本来就是撑爆预算的那个 item。另外我们对外只交一个**切点**,不落 entry,
 * 占位条目在这个返回形状里根本表达不出来。
 */
import type { CompactionCutRejection, CompactionCutSource } from './compaction.types'
import type {
  CutPointResult,
  SessionEntry,
  estimateTokens as PiEstimateTokens,
  findCutPoint as PiFindCutPoint,
  findTurnStartIndex as PiFindTurnStartIndex
} from '@earendil-works/pi-coding-agent'

/** pi 的三个纯函数按注入进来(ESM-only,模块级 import 不成立;守卫也靠这个口子塞真 pi)。 */
export interface CutPointDeps {
  findCutPoint: typeof PiFindCutPoint
  /** 第 2 层的 turn 归属靠它。**不自己找 user 消息** —— turn 边界的定义权在 pi。 */
  findTurnStartIndex: typeof PiFindTurnStartIndex
  /**
   * pi 的 chars/4 估算。第 2 层必须与 `findCutPoint` **同一把尺** ——
   * 兜底要接的正是 pi 那条累加循环,换尺子就成了另一个切点。
   */
  estimateTokens: typeof PiEstimateTokens
}

export interface ResolvedCutPoint extends CutPointResult {
  source: CompactionCutSource
  /** `findCutPoint` 的原始下标(兜底前)。 */
  piFirstKeptEntryIndex: number
  rejection?: CompactionCutRejection
  pairedToolCuts: number
  keptTokens: number
  cutTokens: number
}

const isMessageEntry = (entry: SessionEntry | undefined): boolean => Boolean(entry && entry.type === 'message')

/** 这条 entry 是不是工具返回。`toolResult` 就是 pi 拒绝作为切点的那一类。 */
const toolResultCallId = (entry: SessionEntry | undefined): string | undefined => {
  if (!entry || entry.type !== 'message') return undefined
  const message = entry.message as { role?: string; toolCallId?: string }
  return message.role === 'toolResult' ? message.toolCallId || '' : undefined
}

/** 这条 entry 发起的工具调用 id。pi 允许一条 assistant 带 N 个 `toolCall` 块,所以是个数组。 */
const toolCallIds = (entry: SessionEntry | undefined): string[] => {
  if (!entry || entry.type !== 'message') return []
  const message = entry.message as { role?: string; content?: unknown }
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return []
  const ids: string[] = []
  for (const block of message.content as { type?: string; id?: string }[]) {
    if (block?.type === 'toolCall' && block.id) ids.push(block.id)
  }
  return ids
}

/** 发起 `callId` 的那条 entry 在哪。找不到返回 `-1`(调用比本批更老 ⇒ 这条返回本来就配不上对)。 */
const callIndexOf = (entries: SessionEntry[], callId: string, startIndex: number, endIndex: number): number => {
  for (let i = startIndex; i < endIndex; i++) {
    if (toolCallIds(entries[i]).includes(callId)) return i
  }
  return -1
}

/**
 * 这一段里有没有**值得摘**的东西。
 *
 * 判据借 pi 的 `estimateTokens`(chars/4)—— 它 > 0 就等于这条消息有字符。**不另立一把尺**:
 * 这里要的只是「非空」这个布尔,而不是一个预算数字。
 */
const hasSummarizableContent = (entries: SessionEntry[], from: number, to: number, deps: CutPointDeps): boolean => {
  for (let i = Math.max(0, from); i < Math.min(to, entries.length); i++) {
    const entry = entries[i]
    if (entry.type !== 'message') continue
    if (deps.estimateTokens(entry.message) > 0) return true
  }
  return false
}

const sumTokens = (entries: SessionEntry[], from: number, to: number, deps: CutPointDeps): number => {
  let total = 0
  for (let i = Math.max(0, from); i < Math.min(to, entries.length); i++) {
    const entry = entries[i]
    if (entry.type !== 'message') continue
    total += deps.estimateTokens(entry.message)
  }
  return total
}

/**
 * **第 1 层** —— 校验 `findCutPoint` 的返回值。调用方不信任它(见文件头 ①)。
 *
 * 四条判否:
 *  · `out-of-range` —— 下标不是整数或落在区间外(防的是签名漂移,不是当前 pi 的行为);
 *  · `no-progress` —— `firstKeptEntryIndex <= startIndex`,**这就是 #1.9 那条路径的指纹**;
 *  · `empty-selection` —— 被选段里一条有字符的消息都没有 ⇒ 摘了也是空摘;
 *  · `bad-turn-start` —— 自称切在 turn 中间,但 turn 起点不在 `[startIndex, firstKept)` 里 ⇒
 *    照它切 `historySlice` 与 `turnPrefixSlice` 会互相错位,那段前缀会凭空消失。
 */
export const validateCutPoint = (
  result: CutPointResult,
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  deps: CutPointDeps
): { ok: boolean; reason?: CompactionCutRejection } => {
  const first = result?.firstKeptEntryIndex
  if (!Number.isInteger(first) || first < startIndex || first > endIndex) return { ok: false, reason: 'out-of-range' }
  if (first <= startIndex) return { ok: false, reason: 'no-progress' }
  if (!hasSummarizableContent(entries, startIndex, first, deps)) return { ok: false, reason: 'empty-selection' }
  if (result.isSplitTurn) {
    const turnStart = result.turnStartIndex
    if (!Number.isInteger(turnStart) || turnStart < startIndex || turnStart >= first) return { ok: false, reason: 'bad-turn-start' }
  }
  return { ok: true }
}

/**
 * **第 2 层的前半** —— item 粒度硬切:从最新往前累加,过线的那一条就是切点候选。
 *
 * 与 pi 那条循环的差别只有一处:**不问是不是有效切点**。相同的两处刻意保留 ——
 * 累加用 pi 的 `estimateTokens`,且把「压过线的那一条」**留下**(pi `:325` 的
 * `cutPoints[c] >= i` 同样是把 `i` 自己算作可留)。
 *
 * 返回 `-1` = 整段加起来都没到预算 ⇒ **本来就没有该切的东西**,不是失效。这一条至关重要:
 * 短会话里 `findCutPoint` 同样返回 `cutPoints[0]`(循环从未过线),第 1 层会判它 `no-progress` ——
 * 若兜底不认这种情形,短会话会被硬切一刀。
 */
export const itemGranularCutIndex = (
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
  deps: CutPointDeps
): number => {
  let accumulated = 0
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i]
    if (entry.type !== 'message') continue
    accumulated += deps.estimateTokens(entry.message)
    if (accumulated >= keepRecentTokens) return i
  }
  return -1
}

/**
 * **第 2 层的后半** —— 配对修复,**一起切走**。
 *
 * 保留区不许出现「调用被切走、返回被留下」的落单 `tool_result`(API 层要求配对,不配对直接 400)。
 * 修法是把切点往后推,让那一对整体进前缀 —— 顺带把撑爆预算的那条巨型返回赶出尾部。
 *
 * 循环必然终止:每一轮 `cutIndex` 严格增大,上界是 `endIndex`。推进本身会让更多返回变成落单
 * (它们的调用也被切走了),所以必须反复扫,不能只看头一条。
 *
 * 调用不在本批里(`callIndexOf === -1`)的返回**同样算落单** —— 它的调用比本批更老、已经被上一轮
 * 压走了,留着它在保留区里就是个配不上对的孤儿。
 */
export const repairToolPairs = (
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  cutIndex: number
): { cutIndex: number; pairedToolCuts: number } => {
  let cut = cutIndex
  let paired = 0
  for (;;) {
    let orphan = -1
    for (let i = cut; i < endIndex; i++) {
      const callId = toolResultCallId(entries[i])
      if (callId === undefined) continue
      const callIndex = callId ? callIndexOf(entries, callId, startIndex, endIndex) : -1
      if (callIndex < 0 || callIndex < cut) {
        orphan = i
        break
      }
    }
    if (orphan < 0) return { cutIndex: cut, pairedToolCuts: paired }
    paired += 1
    cut = orphan + 1
  }
}

/**
 * 兜底切点的 turn 归属 —— 第 3 层的入口。
 *
 * 两种形状:
 *  · 还留着东西(`cutIndex < endIndex`):首条保留是 user 消息 ⇒ 切在 turn 边界上,不是 split;
 *    否则 turn 起点交 pi 的 `findTurnStartIndex`。**与 pi `:342` 同一判据**。
 *  · 一条不留(`cutIndex === endIndex`,巨型返回连同调用一起被切走后常见):从最后一条往前找它
 *    所属的 turn。被切走的仍是**这个 turn 的前缀** —— suffix 是这个 turn 接下来要产生的内容
 *    (pi 自己的 auto-compaction 就发生在 turn 内两次工具调用之间),所以照样走三段前缀骨架。
 */
const turnShapeFor = (
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  cutIndex: number,
  deps: CutPointDeps
): { turnStartIndex: number; isSplitTurn: boolean } => {
  const probe = Math.min(cutIndex, endIndex - 1)
  if (probe < startIndex) return { turnStartIndex: -1, isSplitTurn: false }
  if (cutIndex < endIndex) {
    const entry = entries[cutIndex]
    const message = entry && entry.type === 'message' ? (entry.message as { role?: string }) : undefined
    if (message?.role === 'user') return { turnStartIndex: -1, isSplitTurn: false }
  }
  const turnStartIndex = deps.findTurnStartIndex(entries, probe, startIndex)
  if (turnStartIndex < startIndex || turnStartIndex >= cutIndex) return { turnStartIndex: -1, isSplitTurn: false }
  return { turnStartIndex, isSplitTurn: true }
}

/**
 * 三层处置的入口:pi 算 → 校验 → 不过就 item 粒度切并修配对。
 *
 * `keptTokens` / `cutTokens` 用 pi 的 chars/4 报出来,**只为观测**「上下文确实下降」——
 * 预算那把尺在 renderer(`gpt-tokenizer`,与 `token_count` 列同源),两者不混用。
 */
export const resolveCutPoint = (
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
  deps: CutPointDeps
): ResolvedCutPoint => {
  const budget = Math.max(1, Math.floor(keepRecentTokens || 0))
  const piResult = deps.findCutPoint(entries, startIndex, endIndex, budget)
  const settle = (cutIndex: number, shape: { turnStartIndex: number; isSplitTurn: boolean }, rest: Omit<ResolvedCutPoint, keyof CutPointResult | 'keptTokens' | 'cutTokens'>): ResolvedCutPoint => ({
    firstKeptEntryIndex: cutIndex,
    turnStartIndex: shape.turnStartIndex,
    isSplitTurn: shape.isSplitTurn,
    keptTokens: sumTokens(entries, cutIndex, endIndex, deps),
    cutTokens: sumTokens(entries, startIndex, cutIndex, deps),
    ...rest
  })

  const validation = validateCutPoint(piResult, entries, startIndex, endIndex, deps)
  if (validation.ok) {
    return settle(
      piResult.firstKeptEntryIndex,
      { turnStartIndex: piResult.turnStartIndex, isSplitTurn: piResult.isSplitTurn },
      { source: 'pi', piFirstKeptEntryIndex: piResult.firstKeptEntryIndex, pairedToolCuts: 0 }
    )
  }

  const noCut = (): ResolvedCutPoint =>
    settle(
      startIndex,
      { turnStartIndex: -1, isSplitTurn: false },
      { source: 'none', piFirstKeptEntryIndex: piResult.firstKeptEntryIndex, rejection: validation.reason, pairedToolCuts: 0 }
    )

  const hard = itemGranularCutIndex(entries, startIndex, endIndex, budget, deps)
  if (hard < 0) return noCut()
  const repaired = repairToolPairs(entries, startIndex, endIndex, hard)
  // 兜底自己也要过「真的前移 + 被选段非空」这一关 —— 否则它只是把空转换了个来源标签。
  if (repaired.cutIndex <= startIndex || !hasSummarizableContent(entries, startIndex, repaired.cutIndex, deps)) return noCut()
  return settle(repaired.cutIndex, turnShapeFor(entries, startIndex, endIndex, repaired.cutIndex, deps), {
    source: 'item-granular',
    piFirstKeptEntryIndex: piResult.firstKeptEntryIndex,
    rejection: validation.reason,
    pairedToolCuts: repaired.pairedToolCuts
  })
}

/**
 * 保留区里还有没有落单的工具返回。**不参与切点决策**,是给守卫与日志用的事后判据 ——
 * 「配对完好」这条不变量必须能被独立验证,而不是靠相信修复循环写对了。
 */
export const orphanToolResults = (entries: SessionEntry[], startIndex: number, endIndex: number, cutIndex: number): number => {
  let orphans = 0
  for (let i = Math.max(cutIndex, startIndex); i < endIndex; i++) {
    const callId = toolResultCallId(entries[i])
    if (callId === undefined) continue
    const callIndex = callId ? callIndexOf(entries, callId, startIndex, endIndex) : -1
    if (callIndex < 0 || callIndex < cutIndex) orphans += 1
  }
  return orphans
}

/** 保留区里有没有 `tool_call` 落了单(它的返回一条都不在保留区里)。同上,事后判据。 */
export const unansweredToolCalls = (entries: SessionEntry[], startIndex: number, endIndex: number, cutIndex: number): number => {
  let unanswered = 0
  for (let i = Math.max(cutIndex, startIndex); i < endIndex; i++) {
    for (const callId of toolCallIds(entries[i])) {
      let answered = false
      for (let j = i + 1; j < endIndex; j++) {
        if (toolResultCallId(entries[j]) === callId) {
          answered = true
          break
        }
      }
      if (!answered) unanswered += 1
    }
  }
  return unanswered
}

/** 本批里有多少条是工具返回。守卫用它确认自己造的那个会话真的踩在 pi 的失效条件上。 */
export const countToolResults = (entries: SessionEntry[], startIndex: number, endIndex: number): number => {
  let count = 0
  for (let i = Math.max(0, startIndex); i < Math.min(endIndex, entries.length); i++) {
    if (isMessageEntry(entries[i]) && toolResultCallId(entries[i]) !== undefined) count += 1
  }
  return count
}
