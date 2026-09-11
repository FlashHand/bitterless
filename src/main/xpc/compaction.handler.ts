import { XpcMainHandler } from 'electron-xpc/main'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import { maestroAuthPath, maestroModelsPath, maestroUserChainDir } from '@maestro-main/llm/llmPaths'
import { DEFAULT_CONTEXT_WINDOW_TOKENS } from '@maestro-main/llm/llmModels'
import {
  USER_CHAIN_WINDOW_RATIO,
  chainFilePath,
  projectUserChain,
  readChainRecords,
  renderUserChainBlock
} from '@main/agent/userChainStore.service'
import { usageLedger } from '@main/agent/runtime/usageLedger'
import { compactionBoundary, toCompactionUsage, toPiUsage } from '@main/agent/compaction/compactionEntries'
import { computeCutPoint, runCompaction, type CompactionApplyPlan, type CompactionApplyResult, type CompactionDeps } from '@main/agent/compaction/compactionRun'
import type { AgentRuntimeContextSurface } from '@main/agent/runtime/agentRuntime.types'
import type {
  CompactionCutPoint,
  CompactionCutPointRequest,
  CompactionReply,
  CompactionRequest,
  CompactionTriggerReply,
  CompactionTriggerRequest,
  CompactionUsage,
  MaestroCompactionApi
} from '@maestro-shared/maestroChat.api'
import type { Api, Model, ProviderHeaders } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'

/**
 * 摘要 + 切点 + 触发判定 —— **全部 pi 调用都在这里**。
 *
 * 与 cowork 的 `xpc/compaction.handler.ts` 是同一份设计的两个实现
 * (`areas/agent-runtime/agent-design-parity.md` 裁决一);编排本体在 `agent/compaction/*`,
 * 两边逐字相同,只有这一层的宿主接线不同。**改这里要看一眼另一边。**
 *
 * 为什么在 main 而不在 renderer(cowork 2026-08-27 实测定案,本仓同构):renderer 段没有
 * `externalizeDepsPlugin()`,且 `nodePolyfills()` 会把 node builtin 换成空 shim —— 在 renderer
 * `import` pi **拿到的是空壳,编译期一声不吭,运行期才炸**。加上摘要要调模型、provider 凭据不进
 * 渲染进程,这条边界是技术约束不是偏好。
 *
 * ⚠️ **本文件目前没有调用方。** 16 个 compaction/* 模块与这层接线都已到位,但渲染端仍跑着老设计
 * (`message.store.ts` 把 ChatMessage 列表 one-shot 重摘要进 `session.detail.compressedContext`)。
 * 裁决一因此只完成了一半:main 侧能压了,renderer 还没改道 —— 那一步会改变**何时触发**
 * (渲染端启发式 90% → pi 的真 usage 判据)与**切什么**(渲染端时间线切片 → pi entry 树切点),
 * 属于用户可见的行为变更,单独一轮做。
 */

// pi 是 ESM-only、main 打成 CJS,所以只能动态 `import()`(CJS 运行期可以 import 一个 ESM)。
// 类型走 `import type`(编译期擦除),不会退化成运行期 `require`。见 piRuntimeAdapter 顶部。
type PiModule = typeof import('@earendil-works/pi-coding-agent')

/** 摘要的整体超时。与 cowork 同值。 */
const SUMMARY_TIMEOUT_MS = 120_000

const mainCtl = (): typeof maestroWindowHelper => maestroWindowHelper

/** 解析出来的模型 + 请求凭据。`ok:false` 时 `error` 是给人看的一句话。 */
type ResolvedTarget =
  | { ok: true; pi: PiModule; model: Model<Api>; apiKey?: string; headers?: ProviderHeaders }
  | { ok: false; error: string }

/**
 * ② U 链与 ④ 清单落 entry 时的 `customType`。**pi 只拿它做重载后的过滤标签**,不进提示词正文
 * (`createCustomMessage` 把 `customType` 放在消息对象上,`convertToLlm` 只取 `content`)。
 */
const CHAIN_CUSTOM_TYPE = 'maestro-user-chain'
const MANIFEST_CUSTOM_TYPE = 'maestro-manifest'

class CompactionHandler extends XpcMainHandler implements MaestroCompactionApi {
  /**
   * 当前活跃后端的 pi 模型与请求凭据。
   *
   * 凭据的取法**照抄 pi 自己的 compaction 路径**(`modelRegistry.getApiKeyAndHeaders(model)`)——
   * pi 内部的 streamFn 也只是拿这一对再交给 `streamSimple`,所以 OAuth(codex / anthropic)与
   * API-key 两类都走同一个出口。
   *
   * pi 0.85.1:凭据编排归 `ModelRuntime`,`AuthStorage` / `ModelRegistry.create()` 都没了 ——
   * 本仓的 `maestroLlm.service` 早就是 `ModelRuntime` 形态(那也是四条裁决里唯一以 bitterless
   * 为准的一条),所以这里直接用它的路径函数。
   */
  private async resolveTarget(): Promise<ResolvedTarget> {
    try {
      const pi: PiModule = await import('@earendil-works/pi-coding-agent')
      const target = mainCtl().getLlmRuntimeTarget()
      const modelRuntime = await pi.ModelRuntime.create({ authPath: maestroAuthPath(), modelsPath: maestroModelsPath() })
      const modelRegistry = new pi.ModelRegistry(modelRuntime)
      const model = modelRegistry.find(target.provider, target.model)
      if (!model) return { ok: false, error: `model not found: ${target.provider}/${target.model}` }
      if (!modelRegistry.hasConfiguredAuth(model)) {
        return { ok: false, error: `not signed in to ${target.provider} — cannot generate a summary` }
      }
      const auth = await modelRegistry.getApiKeyAndHeaders(model)
      if (!auth.ok) return { ok: false, error: auth.error }
      return { ok: true, pi, model, apiKey: auth.apiKey, headers: auth.headers }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 这个会话在 main 侧的 pi 条目树 —— **压缩的候选批**。
   *
   * 走的是**已存在**的那个 agent(`getExistingMaestroAgent` + `existingContextSurface`):
   * 没有 pi 会话 ⇒ 模型侧没有上下文 ⇒ 压缩无事可做,而**不是**开一个会话来凑一个候选批。
   *
   * 这里是 pi 类型的收窄点:`AgentRuntimeContextSurface.entries()` 对 provider-neutral 那一层
   * 是不透明的 `unknown[]`,到了这里才断言成 `SessionEntry[]` —— 本文件本来就只跟 pi 打交道。
   */
  private async contextSurface(sessionId: string | undefined): Promise<AgentRuntimeContextSurface | null> {
    try {
      const agent = mainCtl().agentService.getExistingMaestroAgent(sessionId)
      return (await agent?.existingContextSurface()) ?? null
    } catch {
      return null
    }
  }

  private static entriesOf(surface: AgentRuntimeContextSurface | null): SessionEntry[] {
    return (surface?.entries() ?? []) as SessionEntry[]
  }

  /**
   * 真 usage 的一次读取。
   *
   * 数据源是 `agent/runtime/usageLedger.ts` —— `AgentRuntimeEvent{type:'usage'}` 逐轮累加,
   * 由 `maestroAgent.service` 的 `onUsage: (_delta, total) => usageLedger.set(key, total)` 写入。
   * key 就是聊天会话 key(`agentSessionKey(sessionId)`,缺省 `'default'`),所以 renderer 传来的
   * `sessionId` 直接对得上。
   *
   * ⚠ 账本的值是**本回合累计**,不是会话历史总和。这恰好就是触发判定要的东西
   * (「上一轮模型实际吃进去多少」),但别当成会话总花销。
   */
  private usageSnapshot(sessionId: string | undefined, pi: PiModule | null, contextWindow: number): CompactionUsage {
    // 读不到账本(窗口还没起来 / 会话 key 取不到)时报一份全零 —— `ledgerHit:false`,调用方
    // 退回本地估算。**不让它抛**:这是失败路径上也要填的一个字段,为它把整个 xpc 调用打成 reject
    // 会让"摘要失败"变成"通信失败",两者的处置完全不同。
    const ledger = (() => {
      try {
        return usageLedger.get(mainCtl().agentService.agentSessionKey(sessionId))
      } catch {
        return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }
      }
    })()
    const contextTokens = pi ? pi.calculateContextTokens(toPiUsage(ledger)) : ledger.totalTokens || 0
    return toCompactionUsage(ledger, contextTokens, contextWindow)
  }

  /**
   * 该压了吗 —— 真 usage 口径(含 `cacheRead` / `cacheWrite`)。
   *
   * 判据整条交给 pi 的 `shouldCompact`(`used > window - reserve`,**严格大于**,等于触发线不压),
   * 不在这里复刻那行公式。窗口取 pi 的 `Model.contextWindow`,不是写死的常量。
   *
   * 账本里没有这个会话(还没跑过一轮)或解析不到模型时报 `no-usage` —— 调用方退回本地估算。
   * **不返回一个零用量的「不用压」**:那和「上下文是空的」不可分,而两者的后果相反。
   */
  async shouldCompact(params: CompactionTriggerRequest): Promise<CompactionTriggerReply> {
    const resolved = await this.resolveTarget()
    const pi = resolved.ok ? resolved.pi : null
    const contextWindow = resolved.ok ? resolved.model.contextWindow || 0 : 0
    const usage = this.usageSnapshot(params?.sessionId, pi, contextWindow)
    if (params?.force) return { shouldCompact: true, usage, reason: 'forced' }
    if (!pi || !usage.ledgerHit || !contextWindow) return { shouldCompact: false, usage, reason: 'no-usage' }
    const hit = pi.shouldCompact(usage.contextTokens, contextWindow, {
      enabled: true,
      reserveTokens: Math.max(0, Math.floor(params.reserveTokens || 0)),
      keepRecentTokens: Math.max(1, Math.floor(params.keepRecentTokens || 0))
    })
    return { shouldCompact: hit, usage, reason: hit ? 'usage' : 'under-threshold' }
  }

  /**
   * 压一次:切点 → 选段 → 摘要(主 + split turn 前缀)→ 合并 → 路径清洗。
   *
   * 编排本体在 `agent/compaction/compactionRun.ts`(pi 的函数注入进去),这里只做装配 ——
   * 那样四条验收(`previousSummary` 被传入 / 整替而非追加 / 产出不含路径 / split turn 两份都产生
   * 并合并)不必启动 Electron、不必调模型就能验。
   */
  async compact(params: CompactionRequest): Promise<CompactionReply> {
    const failure = (error: string, usage: CompactionUsage, entryCount = 0): CompactionReply => ({
      ok: false,
      summary: '',
      cutPoint: { firstKeptIndex: 0, turnStartIndex: -1, isSplitTurn: false },
      usage,
      mergedTurnPrefix: false,
      redactedPaths: 0,
      entryCount,
      applied: false,
      ts: Date.now(),
      error
    })

    const resolved = await this.resolveTarget()
    if (!resolved.ok) return failure(resolved.error, this.usageSnapshot(params?.sessionId, null, 0))

    const usage = this.usageSnapshot(params?.sessionId, resolved.pi, resolved.model.contextWindow || 0)
    // **候选批 = main 自己的 pi entry 树**,不是 renderer 交来的消息清单。
    // 拿不到会话面 ⇒ 这个会话在 main 侧还没跑过一轮 ⇒ 模型侧没有上下文可压,如实报错。
    const surface = await this.contextSurface(params?.sessionId)
    const entries = CompactionHandler.entriesOf(surface)
    if (!surface || !entries.length) return failure('no-context-entries', usage)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS)
    try {
      const deps: CompactionDeps = {
        entries,
        findCutPoint: resolved.pi.findCutPoint,
        findTurnStartIndex: resolved.pi.findTurnStartIndex,
        estimateTokens: resolved.pi.estimateTokens,
        generateSummary: resolved.pi.generateSummary,
        apply: (plan) => CompactionHandler.applyToSession(surface, plan),
        model: resolved.model,
        apiKey: resolved.apiKey,
        headers: resolved.headers,
        signal: controller.signal,
        usage
      }
      // ② 用户原话链 —— **main 自己从 `<userData>/chain/<sessionId>.jsonl` 建**,
      // 不再由渲染端交(Ral 2026-09-11 定的形态)。
      //
      // 为什么必须 main 建:渲染端存的是**用户敲的原文**,而 main 发出去的是长粘贴换过的
      // **引用**。渲染端建链 ⇒ 被换掉的长粘贴在第一次压缩时原样注入回来,长粘贴转文件形同虚设。
      // main 写进 jsonl 的就是它真正发出去的那一份,这类矛盾从根上不存在。
      //
      // 预算 = 窗口的 10%(Ral:「上下文留存的用户原话给 10% 的 context window 预算」)。
      // 窗口解析不到时退 `DEFAULT_CONTEXT_WINDOW_TOKENS`,与别处同一口径。
      const chainPath = chainFilePath(maestroUserChainDir(), mainCtl().agentService.agentSessionKey(params?.sessionId))
      const chainWindow = resolved.model.contextWindow || DEFAULT_CONTEXT_WINDOW_TOKENS
      const projection = projectUserChain(readChainRecords(chainPath), Math.floor(chainWindow * USER_CHAIN_WINDOW_RATIO))
      return await runCompaction(
        { ...params, userChainText: renderUserChainBlock(projection, chainPath) },
        deps
      )
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * ②③④ 落到 pi 会话上 —— **压缩真正生效的那一步**。
   *
   * 顺序:③ `appendCompaction` → ② U 链 → ④ 清单(cowork 2026-08-28 用 pi 真
   * `buildSessionContext` 实测四组对照定下的)。三条都追加在当前 leaf 之后,所以 pi 的
   * `buildSessionContext` 投影出来是「③ 摘要 → ⑤ 保留的尾部 → ② → ④」。
   *
   * **为什么 ③ 必须排第一 —— 不是偏好,是 ⑤ 尾部清空那条路上 ②④ 的存亡**:
   * pi 投影 compaction entry **之前**的 entry 时受 `foundFirstKept` 门控,**之后**的 entry
   * 无条件投。尾部清空时 `firstKeptEntryId` 是那个匹配不到任何 entry 的哨兵 ⇒ `foundFirstKept`
   * 永不置真 ⇒ 排在 compaction entry 之前的 ②④ **被整段丢掉**。而那条路是可达的(单条工具返回
   * ≥ 尾部预算、且它到最新之间全是 `toolResult`),后果直击 ② 存在的唯一理由:那句话必须逐字在。
   * 正常路径上两种顺序的投影**逐条相同** ⇒ `③ → ② → ④` 严格占优,不分叉。
   *
   * 任一条 append 返回 null(pi 挪走了方法)⇒ 整体报 `apply-*` 失败:**宁可报失败也不报一个
   * 「压了但其实没压」** —— 后者下一轮直接撞窗口上限,而且从外面看和成功一模一样。
   */
  private static applyToSession(surface: AgentRuntimeContextSurface, plan: CompactionApplyPlan): CompactionApplyResult {
    if (!surface.appendCompaction(plan.summary, plan.firstKeptEntryId, plan.tokensBefore)) return { ok: false, error: 'apply-compaction-failed' }
    const chain = (plan.userChainText || '').trim()
    if (chain && !surface.appendCustomMessage(CHAIN_CUSTOM_TYPE, chain)) return { ok: false, error: 'apply-user-chain-failed' }
    const manifest = (plan.manifestText || '').trim()
    if (manifest && !surface.appendCustomMessage(MANIFEST_CUSTOM_TYPE, manifest)) return { ok: false, error: 'apply-manifest-failed' }
    return { ok: true }
  }

  /**
   * 只算切点,不调模型、不落 entry。
   *
   * 返回值**已经过三层处置的前两层**:`findCutPoint` 的返回值先过校验,不过关就退回 item 粒度
   * 硬切并修 `tool_call`/`tool_result` 配对。第 3 层(被切走的前缀单独摘一份)要调模型,
   * 只在 `compact()` 上成立 —— 这里把 `isSplitTurn` / `turnStartIndex` 标对就够了。
   */
  async cutPoint(params: CompactionCutPointRequest): Promise<CompactionCutPoint> {
    // 刻意**不走 `resolveTarget`**:切点是个纯下标计算(pi 那三个函数只读 role 与 content),
    // 没登录、没配好模型都不该让它失败 —— 那会把"该在哪切"和"能不能摘要"绑成一件事。
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const entries = CompactionHandler.entriesOf(await this.contextSurface(params?.sessionId))
    return computeCutPoint(entries, params?.keepRecentTokens || 0, compactionBoundary(entries).startIndex, {
      findCutPoint: pi.findCutPoint,
      findTurnStartIndex: pi.findTurnStartIndex,
      estimateTokens: pi.estimateTokens
    })
  }
}

export const compactionHandler = new CompactionHandler()
