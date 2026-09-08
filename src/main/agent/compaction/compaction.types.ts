/**
 * 压缩(compaction)的领域词汇 —— **SDK 拥有**,宿主的 xpc 契约从这里 re-export。
 *
 * 从 `micromeet-cowork:src/shared/coworkChat.api.ts` 原样迁入(2026-09-08),语义一个字未改。
 * 唯一的删减:`CompactionRequest` 去掉了 `messages` / `turnPrefixMessages` 两个字段。它们在
 * 2026-08-28 就被标记废弃(「main 一行都不读它」),renderer 的 `context.service.ts:673` 实际
 * 也不传;留着它们会把 `CompactionMessage` → `CoworkChatRole` / `CoworkChatMessageType` 这条
 * 宿主聊天词汇的反向依赖拖进 SDK,而那正是抽取要消除的东西。
 * (宿主侧 `CompactionMessage` / `CompactionToolPart` 未动,现在成为无引用的死导出,单独清理。)
 */

/**
 * 切点是谁算出来的(ctx-005)。
 *
 * · `pi` —— `findCutPoint` 的返回值过了第 1 层校验,直接用;
 * · `item-granular` —— 校验没过,走了第 2 层 item 粒度硬切(含 tool_call/tool_result 配对修复);
 * · `none` —— 连硬切都无处可切(累计根本没到尾部预算)⇒ **本来就不用压**,不是失效。
 */
export type CompactionCutSource = 'pi' | 'item-granular' | 'none'

/** 第 1 层校验判否的理由。`none` / `pi` 时为空。 */
export type CompactionCutRejection = 'out-of-range' | 'no-progress' | 'empty-selection' | 'bad-turn-start'

/**
 * 真 usage 口径的一次快照(main `agent/runtime/usageLedger.ts`)。
 *
 * ⚠ **语义是「本回合累计」,不是整会话历史总和** —— `runPrompt` 每轮从零开始累加(账本自己的
 * 注记)。所以它是「上一轮模型实际吃进去多少上下文」的观测值,正是 pi
 * `calculateContextTokens` 要的那份数据;但它不能当成「会话至今花了多少」来用。
 */
export interface CompactionUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  /** pi `calculateContextTokens` 的口径:优先 `totalTokens`,缺了才 input+output+cacheRead+cacheWrite。 */
  contextTokens: number
  /** 模型窗口(pi `Model.contextWindow`)。解析不到模型时为 0。 */
  contextWindow: number
  /**
   * 账本里**确实有**这个会话的记录。
   *
   * 账本 `get()` 对未知 key 返回全零,而「全零」与「记过一笔零」在这个接口上不可分 ——
   * 所以判据是 `contextTokens > 0`:一个真跑过的回合不可能累计为零。为 false 时调用方
   * 应退回自己的本地估算,**不要**把零当成「上下文是空的」。
   */
  ledgerHit: boolean
}

export interface CompactionTriggerRequest {
  sessionId: string
  /** 触发线的保留量(窗口 − 触发线)。pi 判据 `used > window - reserve`,**严格大于**。 */
  reserveTokens: number
  /** ⑤ 尾部预算。只为凑齐 pi 的 `CompactionSettings`,不参与触发判定。 */
  keepRecentTokens: number
  /** 语义触发(产物落盘之类):不看用量,直接返回该压。 */
  force?: boolean
}

export interface CompactionTriggerReply {
  shouldCompact: boolean
  usage: CompactionUsage
  /**
   * · `forced` —— 语义触发;
   * · `usage` / `under-threshold` —— 真 usage 口径判过了 / 没到线;
   * · `no-usage` —— 账本里没有这个会话(或解析不到模型窗口)。**调用方退回本地估算**。
   */
  reason: 'forced' | 'usage' | 'under-threshold' | 'no-usage'
}

/**
 * 切点,下标已翻成消息 id。**已经过 ctx-005 的三层处置** —— 不是 `findCutPoint` 的原样返回值:
 * 那条路径会在单条工具返回 ≥ 尾部预算且它是 `toolResult` 时静默回落到区间最前端(压缩空转),
 * 见 `compaction-decisions.html #1.9`。判据在 `main/agent/compaction/compactionCut.ts`。
 */
export interface CompactionCutPoint {
  /**
   * 第一条**保留**的 pi entry 的 id(`SessionEntry.id`,**不是** cowork 的消息 id ——
   * 候选批是 main 自己的 entry 树)。取不到时为空 —— 两种情形:候选为空,或
   * `firstKeptIndex === entries.length`(见 `tailCleared`)。
   *
   * 它就是 `SessionManager.appendCompaction(summary, firstKeptEntryId, …)` 要的那个 id:
   * pi 的 `buildSessionContext` 从这条 entry 起开始保留(`session-manager.js:190-200`)。
   */
  firstKeptEntryId?: string
  /** 在这一批 entry 里的下标。等于 `entries.length` 表示这批全被切走。 */
  firstKeptIndex: number
  /** 切在 turn 中间时,那个 turn 起点 entry 的 id;否则为空。 */
  turnStartEntryId?: string
  /** pi 的口径:不切 turn 时为 `-1`。 */
  turnStartIndex: number
  /**
   * ⑤ 尾部被**清空** —— 保留区一个 token 都不剩。**判据是 `keptTokens === 0`**,
   * 不是 `firstKeptIndex === entries.length`(后者只在批以 message entry 收尾时等价;
   * 以 `label` 收尾时下标不相等而保留区确实是空的 —— ctx-005 review 的反例)。
   *
   * ⚠ **这是合法结果,不是错误**(ctx-005 证明的那一路):单条工具返回 ≥ 尾部预算且
   * 从它到最新之间全是 `toolResult` 时,「一起切走」必然把尾部清空 —— 而那条巨型返回
   * 本来就是撑爆预算的那个 item。调用方**必须显式处置**它:
   *  · `firstKeptEntryId` 为空 ⇒ 交给 `appendCompaction` 的是一个**匹配不到任何 entry** 的 id,
   *    pi 的 `foundFirstKept` 永不置真 ⇒ 保留区为空,正是要的语义;
   *  · 被切走的那段仍然进摘要(主摘要 + 三段前缀),一个字都没丢。
   */
  tailCleared?: boolean
  /**
   * 切在 turn 中间 ⇒ 前缀要单独摘一份(第 3 层)。
   *
   * ⚠ item 粒度兜底把当前 turn **整个**切走时也置位:被切走的仍是这个 turn 的前缀,
   * suffix 是这个 turn 接下来要产生的内容(pi 自己的 auto-compaction 就发生在 turn 内两次工具
   * 调用之间)。所以那一轮照样走三段前缀骨架,而不是六段 checkpoint。
   */
  isSplitTurn: boolean
  /** 切点的来源。缺省(旧调用方)按 `pi` 读。 */
  source?: CompactionCutSource
  /** `findCutPoint` 的原始下标(兜底**前**)。与 `firstKeptIndex` 比较即知切点有没有真的前移。 */
  piFirstKeptIndex?: number
  /** 第 1 层判否的理由。`source === 'pi'` 时为空。 */
  rejection?: CompactionCutRejection
  /** 配对修复把多少条工具返回连同它的 `tool_call` 一起推进了切点。0 = 这次不需要修复。 */
  pairedToolCuts?: number
  /**
   * 切点两侧的量,**pi 的 `estimateTokens`(chars/4)口径** —— 就是 `findCutPoint` 内部用的那把尺。
   * 只为观测「压缩后上下文确实下降」(`keptTokens` 必须真的比全量小),**不参与预算判定**:
   * 预算那把尺是 renderer 的 `gpt-tokenizer`(与 `token_count` 列同源)。
   */
  keptTokens?: number
  cutTokens?: number
}

/**
 * 压一次。
 *
 * ⚠ **没有「摘要预算」字段**:③ 的长度不设人为上限,`reserveTokens` 直接用 pi 的默认值
 * (`main/agent/compaction/compactionPrompt.ts` 的 `PI_SUMMARY_RESERVE_TOKENS`)。`maxTokens` 是
 * 输出上限,顶到了得到的是截断而不是更短的摘要,而骨架有序 —— 截掉的正好是尾部的
 * `## Next Steps` / `## Critical Context`。别再往这里加预算旋钮。
 */
export interface CompactionRequest {
  sessionId: string
  /**
   * 上一轮的摘要。**单槽整替,不累积** —— 形态是 `S₂ = LLM(压缩指令, S₁, 本批选段)`。
   *
   * ⚠ **正常路径不传**:main 从自己 entry 树上最后一条 `compaction` entry 读 S₁
   * (`getLatestCompactionEntry`)—— 那才是模型真正看见的那一份。本字段只在 entry 树上
   * **还没有** compaction entry 时作为迁移兜底(老会话的 `detail.compressedContext`)。
   */
  previousSummary?: string
  /** ⑤ 尾部预算,pi `findCutPoint` 的 `keepRecentTokens`(参数表 24k)。 */
  keepRecentTokens: number
  /**
   * ② 用户原话链的正文,**逐字**。renderer 算内容(`ContextService.buildUserChain`),
   * main 落 `appendCustomMessageEntry` —— 契约「② 用户原话链的承载形态」F1 更正后的分工。
   * 空/省略 = 这一轮链是空的,不落 entry。
   */
  userChainText?: string
  /**
   * ④ 清单的正文,一行一条(renderer `ContextService.renderManifest` 渲染,**不过 LLM**)。
   * 同 ②:main 落 `custom_message` entry。空/省略 = 没有可寻址产物,不落 entry。
   */
  manifestText?: string
}

export interface CompactionReply {
  ok: boolean
  /**
   * 新的 ③ 全文。**单槽整替** —— 调用方写进 `compactSummary` 时是替换,不是追加。
   * 已过路径清洗(见 `main/agent/compaction/compactionPrompt.ts`):不含文件系统地址。
   */
  summary: string
  cutPoint: CompactionCutPoint
  usage: CompactionUsage
  /** split turn 的前缀摘要已单独摘出并合并进 `summary`。 */
  mergedTurnPrefix: boolean
  /** 摘要正文里被清洗掉的路径处数。0 = 模型这次没写路径。 */
  redactedPaths: number
  /**
   * 候选批的规模 —— main 侧 pi entry 树在本次压缩边界内的 entry 条数。
   *
   * 观测用,但它是「候选批真的来自 entry 树」的唯一外部判据:renderer 交不出 entry,
   * 所以这个数只可能来自 main 自己读的那棵树。
   */
  entryCount: number
  /**
   * ②③④ 三条 entry 是否**真的落到了 pi 的会话上**(`appendCustomMessageEntry` × 2 +
   * `appendCompaction`)。
   *
   * `ok:true` 只说明摘要生成成功;**只有 `applied:true` 才说明模型看到的上下文真的变小了**。
   * 两者分开报,是因为「摘要出来了但没落上去」在外部看和「压缩成功」一模一样,而后果相反
   * (下一轮直接撞窗口上限)。
   */
  applied: boolean
  ts: number
  error?: string
}

/** 只要切点、不要摘要(不调模型)。候选批同样是 main 自己的 entry 树。 */
export interface CompactionCutPointRequest {
  sessionId: string
  keepRecentTokens: number
}
