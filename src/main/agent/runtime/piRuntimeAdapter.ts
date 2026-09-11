import { existsSync, readFileSync } from 'fs'
import { describeAuthFile } from './authDiagnostic'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeContextEntry,
  AgentRuntimeContextSurface,
  AgentRuntimeEvent,
  AgentRuntimePrompt,
  AgentRuntimeSession,
  AgentRuntimeSessionOptions,
  AgentRuntimeUsage,
  AgentToolParamSpec
} from './agentRuntime.types'
import type { CodexDebugEvent } from './runtime.types'
import { sanitizeRuntimeError } from './errorSanitizer'
import { toolResultLooksFailed } from './toolResultFailure'
import { decideStreamingBehavior, type SteeringMode } from '../steering/steeringPolicy'

/**
 * PQ-1(Ral 2026-08-28 定案):`steeringMode` 取 `one-at-a-time`,而且**显式设**。
 *
 * 为什么不吃 pi 的默认值:策略表第 3 条(「上一条 steering 尚未投递 → followUp」)只在
 * `one-at-a-time` 下生效。不显式设,这条规则成不成立就取决于 pi 自己的默认值 —— 那是 SDK 的
 * 决定,不是我们的;哪天它改成 `all`,我们的退让会**静默消失**,没有任何地方会报红。
 *
 * 为什么是 `one-at-a-time` 而不是 `all`:连着几条 steering 一起投进去,模型会把它们当成一段
 * 混合指令,容易顾此失彼 —— 一次只投一条,前一条落地了再投下一条。
 */
const STEERING_MODE: SteeringMode = 'one-at-a-time'

/** pi `AgentSession` 上与 steeringMode 有关的那一小片(本文件对 pi 一贯手写最小结构)。 */
interface PiSteeringModeSurface {
  setSteeringMode?: (mode: SteeringMode) => void
  readonly steeringMode?: SteeringMode
}

/**
 * 建会话时把 `steeringMode` **显式**设成 `one-at-a-time`,并把实际值报出来。
 *
 * 导出仅为可测:「它被显式设置过」这条只有拿到这个函数、喂一个假 session 才验得动 ——
 * 源码正则只能看见那行字在,看不见它被执行。
 */
export const applySteeringMode = (
  session: PiSteeringModeSurface,
  debug?: (event: { phase: string; level: 'info' | 'warn'; message: string; detail?: unknown }) => void
): void => {
  let applied = false
  try {
    if (typeof session.setSteeringMode === 'function') {
      session.setSteeringMode(STEERING_MODE)
      applied = true
    }
  } catch {
    applied = false
  }
  debug?.({
    phase: 'pi-steering-mode',
    level: applied ? 'info' : 'warn',
    message: applied
      ? `pi steeringMode explicitly set to ${STEERING_MODE} (now: ${session.steeringMode ?? 'unknown'}).`
      : `pi has no setSteeringMode() — steeringMode left at the SDK default (${session.steeringMode ?? 'unknown'}); 策略表第 3 条可能失效`,
    detail: { requested: STEERING_MODE, actual: session.steeringMode, applied }
  })
}

// pi-coding-agent is ESM-only and the coach main bundles as CJS, so pi is loaded
// lazily via dynamic import() (a CJS module may import() an ESM one at runtime).
// Types are import-type-only (erased at compile), so no runtime ESM `require` happens.
type PiModule = typeof import('@earendil-works/pi-coding-agent')

/**
 * pi 0.85.1 起,凭据编排归 `ModelRuntime`:`AuthStorage` 不再从包入口导出(类还在
 * `dist/core/auth-storage.js`,但 `exports` map 只开四个入口,深路径 import 被 Node 挡死),
 * `ModelRegistry.create()` 这个静态工厂也没了 —— 它变成了 `constructor(runtime)` 的同步兼容门面。
 *
 * 这里刻意**留着 `ModelRegistry` 门面**而不是直接用 `ModelRuntime`:下游的 `find()` /
 * `hasConfiguredAuth(model)` / `getApiKeyAndHeaders(model)` 因此一个字都不用改。
 * `ModelRuntime.hasConfiguredAuth` 收的是 `providerId` 而不是 `model`,直接换会悄悄改变语义。
 *
 * `allowModelNetwork` 不传 —— 0.85.1 的默认值是 false,与我们一直设的 `PI_OFFLINE=1` 同义。
 */
const createModelRuntime = async (pi: PiModule, authPath: string, modelsPath?: string) =>
  await pi.ModelRuntime.create({ authPath, modelsPath })

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  async checkTarget(params: { providerId: string; modelId: string; authPath: string; modelsPath?: string }): Promise<boolean> {
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const modelRegistry = new pi.ModelRegistry(await createModelRuntime(pi, params.authPath, params.modelsPath))
    const model = modelRegistry.find(params.providerId, params.modelId)
    return Boolean(model && modelRegistry.hasConfiguredAuth(model))
  }

  /**
   * 解析这些目标在 pi 目录里的**真实上下文窗口**。查表,不建会话 ——
   * 与 `checkTarget()` 走同一条 `ModelRegistry.find()`。
   *
   * **为什么需要它**:窗口以前是 `llmModels.ts` 里手写的常量(`contextLengthK`),与 pi 实际
   * 用的值没有任何同步机制 —— 抄错或模型换代就静默失准,而**压缩的触发线、reserve 预算、
   * summary 上限全都乘在它上面**。一个 1M 的模型被当 256K 会提前压;反过来 200K 的被当 1M,
   * 压缩**永远不触发直到溢出**。
   *
   * 查不到的目标**不进返回值**,由调用方退 256K
   * (Ral 2026-09-11:「pi 给不出 contextWindow 就默认就是 256k,因为现在一般至少 256k 了」)。
   */
  async describeContextWindows(params: {
    authPath: string
    modelsPath?: string
    targets: { providerId: string; modelId: string }[]
  }): Promise<Record<string, number>> {
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const modelRegistry = new pi.ModelRegistry(await createModelRuntime(pi, params.authPath, params.modelsPath))
    const windows: Record<string, number> = {}
    for (const target of params.targets) {
      const found = modelRegistry.find(target.providerId, target.modelId)
      const window = found?.contextWindow
      if (typeof window === 'number' && window > 0) windows[`${target.providerId}/${target.modelId}`] = window
    }
    return windows
  }

  async createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession> {
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const { Type } = (await import('typebox')) as { Type: TypeBoxFactory }
    const modelRuntime = await createModelRuntime(pi, options.authPath, options.modelsPath)
    const modelRegistry = new pi.ModelRegistry(modelRuntime)
    const model = modelRegistry.find(options.target.providerId, options.target.modelId)
    if (!model || !modelRegistry.hasConfiguredAuth(model)) {
      const auth = describeAuthFile(options.authPath, options.target.providerId)
      throw new Error(
        `Not signed in to ${providerDisplayName(options.target.providerId)} for "${options.target.providerId}/${options.target.modelId}". ` +
          `Use the app's AI Login button to authorize in your browser ` +
          `so ${options.authPath} gets a "${options.target.providerId}" credential ` +
          `(or set COACH_PI_PROVIDER / COACH_PI_MODEL to a provider you're already logged into).\n` +
          auth
      )
    }

    const customTools = options.tools.map((spec) =>
      pi.defineTool({
        name: spec.name,
        label: spec.name,
        description: spec.description,
        parameters: buildSchema(Type, spec.params),
        execute: async (_toolCallId: string, params: Record<string, unknown>) => {
          const startedAt = Date.now()
          try {
            const text = await spec.execute(params || {})
            const durationMs = Date.now() - startedAt
            options.onDebug?.({
              scope: options.scope,
              phase: 'pi-tool-result',
              level: 'info',
              message: `tool ${spec.name} returned.`,
              detail: { durationMs, outputChars: text.length },
              ts: Date.now()
            })
            return { content: [{ type: 'text', text }], details: { durationMs } }
          } catch (err) {
            const durationMs = Date.now() - startedAt
            const error = sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')
            options.onDebug?.({
              scope: options.scope,
              phase: 'pi-tool-error',
              level: 'error',
              message: `tool ${spec.name} failed.`,
              detail: { durationMs, error },
              ts: Date.now()
            })
            throw new Error(error)
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    )

    // Tool gating. pi registers ALL builtins (read/bash/edit/write/grep/find/ls) but only activates
    // read/bash/edit/write by default, and its allowlist (`tools`) filters BUILTIN **and** custom
    // tools alike — so a builtin-only allowlist would silently disable every host tool. Hence:
    // when builtins are requested we pass ONE list = requested builtins + every host tool name.
    // Without builtins we keep the old posture: 'builtin' (host tools only) / 'all' (pure LLM call).
    const builtinNames = (options.builtinTools || []).filter(Boolean)
    const useBuiltins = builtinNames.length > 0 && customTools.length > 0
    const allowedToolNames = useBuiltins ? [...new Set([...builtinNames, ...options.tools.map((spec) => spec.name)])] : undefined

    /**
     * **system 槽位的接管。** pi 只有一个口子:`resourceLoader.getSystemPrompt()` ——
     * `createAgentSession()` 的参数表里**没有** systemPrompt 字段(`sdk.d.ts:10-56`)。
     * 不传 loader 时 pi 自建 `DefaultResourceLoader`(`sdk.js:75-79`),那份什么定制都没有。
     *
     * **这里不用 `DefaultResourceLoader`**:它会连带接手 A7(从 cwd 一路 dirname 到根,
     * 收每层 AGENTS.md/CLAUDE.md —— bl 没传 cwd,dev 下能吸进 overmind/CLAUDE.md 47 KB)
     * 与 A8(skills 扫描),还要一次 `await reload()`。手写这个最小 loader 把发现类方法
     * 全返回空,三笔代价一次付清 —— 形状照已在跑的
     * `codex/codexRuntime.service.ts:746-763 createSterileResourceLoader`。
     *
     * **`trim()` 非空是硬断言,不是防御性代码。** pi 对 customPrompt 只做 truthy 判断
     * (`system-prompt.js:15`),而两种失效都**不报错**:传 `''`/`undefined` ⇒ A1–A5 原样回来
     * (长度 2858,看起来完全正常);传 `'   '` ⇒ 走 customPrompt 分支但基座只剩 41 字符,
     * A2/A4 一起没了。宁可启动失败,不可静默退回 pi 原厂。
     */
    const systemPrompt = options.systemPrompt?.trim()
    if (options.systemPrompt !== undefined && !systemPrompt) {
      throw new Error('systemPrompt was provided but is blank — refusing to fall back to pi stock prompt')
    }

    const { session } = await pi.createAgentSession({
      model,
      modelRuntime,
      thinkingLevel: options.target.thinkingLevel,
      ...(allowedToolNames ? { tools: allowedToolNames } : { noTools: customTools.length > 0 ? 'builtin' : 'all' }),
      // pi's builtin file tools resolve relative paths against cwd; unset means process.cwd(),
      // which is undefined-ish for a packaged Electron app.
      ...(options.cwd ? { cwd: options.cwd } : {}),
      // Keep pi state (auth/sessions/managed bin — where its grep looks for ripgrep) inside the app.
      ...(options.agentDir ? { agentDir: options.agentDir } : {}),
      customTools,
      // `getAppendSystemPrompt` 返回 `[]`:A6 是另一层,这一层只接管 A1–A5。
      // 发现类方法全返回空 —— 那正是"不用 DefaultResourceLoader"要买的东西。
      ...(systemPrompt
        ? {
            resourceLoader: {
              getExtensions: () => ({ extensions: [], errors: [], runtime: pi.createExtensionRuntime() }),
              getSkills: () => ({ skills: [], diagnostics: [] }),
              getPrompts: () => ({ prompts: [], diagnostics: [] }),
              getThemes: () => ({ themes: [], diagnostics: [] }),
              getAgentsFiles: () => ({ agentsFiles: [] }),
              getSystemPrompt: () => systemPrompt,
              // 这两个 *Sources 只为 pi 的 `/resources` 自省面服务(报告提示词来自哪个文件)。
              // 我们的提示词来自代码而不是磁盘,所以如实返回「没有来源文件」。
              // 它们在 `ResourceLoader` 接口上是**必填**的 —— 漏掉就是 TS2345。
              getSystemPromptSource: () => undefined,
              getAppendSystemPrompt: () => [],
              getAppendSystemPromptSources: () => [],
              extendResources: () => undefined,
              reload: async () => undefined
            }
          }
        : {}),
      sessionManager: pi.SessionManager.inMemory()
    })
    options.onDebug?.({
      scope: options.scope,
      phase: 'pi-session-start',
      level: 'info',
      message:
        `pi session ready (${options.target.providerId}/${options.target.modelId}, ${customTools.length} host tools` +
        `${useBuiltins ? `, builtins: ${builtinNames.join('/')}` : ', builtins off'}).`,
      detail: { cwd: options.cwd, agentDir: options.agentDir, builtinTools: builtinNames },
      ts: Date.now()
    })
    // 显式打开自动压缩,并把当前设置打出来 —— 我们从没设过它,一直在赌 SDK 的默认值
    // (Ral 2026-08-13 要日志)。钻探是单个上百轮的回合,回合内唯一会让上下文变小的就是它:
    // 没开 = 上下文只涨不落,10M token 预算十几分钟就烧光(那正是"24/58 就收工"的成因)。
    const piSession = session as PiSession &
      PiSteeringModeSurface & {
        setAutoCompactionEnabled?(enabled: boolean): void
        autoCompactionEnabled?: boolean
        model?: { contextWindow?: number }
      }
    try {
      piSession.setAutoCompactionEnabled?.(true)
    } catch {
      /* SDK 版本没有这个开关就算了 —— 下面那条日志会把实际状态报出来 */
    }
    options.onDebug?.({
      scope: options.scope,
      phase: 'pi-compaction-config',
      level: piSession.autoCompactionEnabled === false ? 'warn' : 'info',
      message: `pi auto-compaction: ${piSession.autoCompactionEnabled === false ? 'OFF (context will only grow)' : 'on'} · model contextWindow ${piSession.model?.contextWindow ?? 'unknown'}`,
      detail: { autoCompaction: piSession.autoCompactionEnabled, contextWindow: piSession.model?.contextWindow },
      ts: Date.now()
    })
    // steering 的第 3 条退让依赖 steeringMode —— 显式设,不吃 pi 的默认值(见 STEERING_MODE 上的说明)。
    applySteeringMode(piSession, (event) => options.onDebug?.({ scope: options.scope, ts: Date.now(), ...event }))
    return new PiRuntimeSession(session as PiSession, (event) => options.onDebug?.({ scope: options.scope, ts: Date.now(), ...event }))
  }
}

// 导出仅为可测:steering 的投递(到底把什么 streamingBehavior 交给了 pi、有没有多调什么)只有在能
// 拿到这个类、喂一个假 pi session 时才验得动 —— 否则守卫只能退回源码正则,而正则只能看见那行字在,
// 看不见它被执行。
export class PiRuntimeSession implements AgentRuntimeSession {
  /** 本回合正在收尾(策略表第 4 条)。pi 没有这个 getter,只能由发起 abort 的这一侧记。 */
  private aborting = false

  constructor(
    private readonly session: PiSession,
    private readonly debug?: (event: Omit<CodexDebugEvent, 'ts' | 'scope'>) => void
  ) {}

  /**
   * pi 此刻是否在流式(直接透 `AgentSession.isStreaming`)。
   *
   * `BaseAgent.steerActiveTurn` 在**投递之前**读它:非流式时 pi 会把这条消息当成一次**普通
   * prompt** 跑起来(`agent-session.js:737` 只在 `isStreaming` 为真时才走入队分支),于是它抢走
   * `activeRun`,而真正的第一条反倒变成 steer 入队 —— 角色反转。缺了这个只读面,那个判断就无从做起。
   */
  get isStreaming(): boolean {
    return this.session.isStreaming === true
  }

  /**
   * 上下文条目面 —— 压缩的候选批与落点(契约「候选批的来源」,2026-08-28 定案)。
   *
   * 直透 pi 的 `AgentSession.sessionManager`(`agent-session.d.ts:165`,公开只读成员)。
   * `getEntries()` / `appendCustomMessageEntry()` / `appendCompaction()` 三个都是
   * `SessionManager` 的公开方法(`session-manager.d.ts:257` / `:219` / `:204`)。
   *
   * 每个成员都**按可选取**并 try 包住:pi 大版本挪走某一个,退化成「这条运行时不支持压缩」
   * (`entries()` 返回空 ⇒ 压缩如实报 `no-context-entries`),而不是让整个回合炸掉。
   *
   * ⚠ **写入会推进 `leafId`**,所以只能在回合之间调 —— 两个调用点
   * (`turn.service.ts:234` 发送前 / `:310` 回合结束后)都在回合之外。
   */
  get context(): AgentRuntimeContextSurface {
    const manager = (): PiSessionManagerSurface | undefined => this.session.sessionManager
    return {
      entries: () => {
        try {
          return manager()?.getEntries?.() ?? []
        } catch {
          return []
        }
      },
      appendCustomMessage: (customType: string, content: string) => {
        try {
          return manager()?.appendCustomMessageEntry?.(customType, content, false) ?? null
        } catch {
          return null
        }
      },
      appendCompaction: (summary: string, firstKeptEntryId: string, tokensBefore: number) => {
        try {
          return manager()?.appendCompaction?.(summary, firstKeptEntryId, tokensBefore) ?? null
        } catch {
          return null
        }
      }
    }
  }

  subscribe(listener: (event: AgentRuntimeEvent) => void): undefined | (() => void) {
    return this.session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) listener(normalized)
    })
  }

  async prompt(message: AgentRuntimePrompt): Promise<unknown> {
    // 回合内 steering(docs/features/cowork-turn-steering.md)。**默认 steer,投递方式与工具无关**
    // (`steer` 不打断执行中的工具,pi 只在下一个工具边界取队)。代价不对称:
    // 「补充信息」被误判成 steer 只多插一次且内容不丢(它进 entry 树,模型下一步就看到);
    // 「改方向」被误判成 followUp,用户要看着 AI 把一条已经被否掉的路跑到回合结束。
    const decision = decideStreamingBehavior({
      streaming: this.session.isStreaming === true,
      compacting: this.session.isCompacting === true,
      pendingSteeringCount: this.session.getSteeringMessages?.().length ?? 0,
      steeringMode: this.session.steeringMode ?? 'one-at-a-time',
      aborting: this.aborting
    })
    if (decision.rule !== 0) {
      this.debug?.({
        phase: 'steering-decision',
        level: 'info',
        message: `steering rule #${decision.rule} → ${decision.behavior} (${decision.reason}).`,
        detail: { rule: decision.rule, behavior: decision.behavior, reason: decision.reason }
      })
    }
    // The current pi SDK native media option expects inline base64 payloads. Cowork keeps
    // attachments as path/url refs instead, so pi receives the textual @path note until
    // an adapter surface can consume refs without copying bytes.
    return await this.session.prompt(message.text, { streamingBehavior: decision.behavior })
  }

  async abort(): Promise<void> {
    this.aborting = true
    try {
      await this.session.abort()
    } finally {
      // pi 的 abort() 「等 agent 回到空闲」才 resolve,所以这一段正好就是收尾窗口。
      this.aborting = false
    }
  }
}

// TypeBox is loaded dynamically; we only need the factory methods we use, so model
// the surface loosely rather than depend on typebox's compile-time types here.
interface TypeBoxFactory {
  Object: (props: Record<string, unknown>) => unknown
  String: () => unknown
  Number: () => unknown
  Boolean: () => unknown
  Optional: (schema: unknown) => unknown
}

interface PiMessage {
  role?: string
  stopReason?: string
  content?: string | Array<{ type?: string; text?: string }>
  errorMessage?: string
  // pi SDK 的 `Usage`(input/output/cacheRead/cacheWrite/totalTokens/cost)。这里保持 unknown 由
  // normalizePiUsage 逐字段收窄 —— 本文件对 pi 的类型一贯是手写最小结构,不直接吃 SDK 类型。
  usage?: unknown
}

interface PiSessionEvent {
  type?: string
  message?: PiMessage
  toolName?: string
  isError?: boolean
  args?: unknown
  assistantMessageEvent?: {
    type?: string
    delta?: string
    reason?: string
    message?: PiMessage
    error?: PiMessage
  }
}

/**
 * 手写的 pi 会话最小结构(本文件对 pi 的类型一贯如此,不直接吃 SDK 类型)。
 *
 * steering 用到的四个成员全部标成**可选** —— 它们都是 pi `AgentSession` 上的真实公开成员
 * (`isStreaming` / `isCompacting` / `steeringMode` / `getSteeringMessages`),
 * 标可选是为了让 SDK 大版本挪动字段时退化成「按不在流式处理」,而不是让整个回合炸掉。
 */
interface PiSession {
  subscribe: (listener: (event: PiSessionEvent) => void) => undefined | (() => void)
  /** `options.streamingBehavior` 在流式中**必填** —— 不传 pi 直接抛(`agent-session.js:735`)。 */
  prompt: (message: string, options?: { streamingBehavior?: 'steer' | 'followUp' }) => Promise<unknown>
  abort: () => Promise<void>
  readonly isStreaming?: boolean
  readonly isCompacting?: boolean
  readonly steeringMode?: SteeringMode
  getSteeringMessages?: () => readonly string[]
  /** pi `AgentSession.sessionManager`(公开只读,`agent-session.d.ts:165`)。压缩的候选批住这里。 */
  readonly sessionManager?: PiSessionManagerSurface
}

/**
 * pi `SessionManager` 上压缩要用到的那三个方法(同上,手写最小结构、全部可选)。
 * 条目形状对本文件是不透明的 —— 收窄归 pi 边界那一侧(`main/xpc/compaction.handler.ts`)。
 */
interface PiSessionManagerSurface {
  getEntries?: () => AgentRuntimeContextEntry[]
  appendCustomMessageEntry?: (customType: string, content: string, display: boolean) => string
  appendCompaction?: (summary: string, firstKeptEntryId: string, tokensBefore: number) => string
}

/**
 * pi 的 `AssistantMessage.usage` 是**非可选**字段(`@earendil-works/pi-ai` `dist/types.d.ts` `Usage`),
 * 一直都在送,只是以前归一化时被丢掉了。钻探的 token 预算就靠它 —— 别再丢。
 * 防御性写法是因为 SDK 大版本升级时字段可能挪位置,少一个字段不该让整个回合炸掉。
 */
const normalizePiUsage = (usage: unknown): AgentRuntimeUsage | undefined => {
  const u = usage as Record<string, unknown> | undefined
  if (!u || typeof u !== 'object') return undefined
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const cost = u.cost as Record<string, unknown> | undefined
  const input = num(u.input)
  const output = num(u.output)
  const cacheRead = num(u.cacheRead)
  const cacheWrite = num(u.cacheWrite)
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    // totalTokens 优先用 SDK 给的;缺了就自己加起来,免得预算白算。
    totalTokens: num(u.totalTokens) || input + output + cacheRead + cacheWrite,
    costUsd: num(cost?.total)
  }
}

const normalizePiEvent = (event: PiSessionEvent): AgentRuntimeEvent[] => {
  const type = event?.type
  // 压缩事件透出来 —— 不接就等于看不见 pi 在替我们做上下文管理(见 AgentRuntimeEvent 上的说明)。
  if (type === 'compaction_start') {
    return [{ type: 'compaction_start', reason: (event as { reason?: string }).reason }]
  }
  if (type === 'compaction_end') {
    const e = event as { reason?: string; result?: { ok?: boolean; tokensBefore?: number; tokensAfter?: number } }
    return [{ type: 'compaction_end', reason: e.reason, ok: e.result?.ok, beforeTokens: e.result?.tokensBefore, afterTokens: e.result?.tokensAfter }]
  }
  if (type === 'message_update') return normalizeAssistantMessageEvent(event.assistantMessageEvent)
  if (type === 'message_end' && event.message?.role === 'assistant') {
    // pi 每轮工具循环都结束一条 assistant message,所以这条路径每轮都会走 —— 用量逐轮发出。
    const usage = normalizePiUsage(event.message.usage)
    const events: AgentRuntimeEvent[] = usage ? [{ type: 'usage', usage }] : []
    events.push({
      type: 'assistant_message_end',
      text: extractMessageText(event.message),
      stopReason: event.message.stopReason,
      errorMessage: sanitizeRuntimeError(event.message.errorMessage, 'provider')
    })
    return events
  }
  if (type === 'tool_execution_start') return [{ type: 'tool_start', toolName: event.toolName, args: event.args }]
  if (type === 'tool_execution_end') {
    // **`ERROR:` 前缀 = 失败**,即便 pi 认为这次调用成功了。判据与理由都在
    // `toolResultFailure.ts` —— 2026-09-08 它在 ai-crms adapter 上原样复发了一次,
    // 所以现在只有一份、并由 check-agent-runtime 钉住"每个 adapter 都用它"。
    // 判据放在这一层而不是 BaseAgent:这里是"pi 事件 → 我们的事件"的翻译层,`result` 只在这里拿得到。
    // 本地类型里 `PiSessionEvent` 没声明 `result`(我们只窄化了用到的字段),这里就地取一次。
    const carried = (event as { result?: unknown }).result
    return [
      {
        type: 'tool_end',
        toolName: event.toolName,
        args: event.args,
        isError: Boolean(event.isError) || toolResultLooksFailed(carried)
      }
    ]
  }
  return []
}

const normalizeAssistantMessageEvent = (inner?: PiSessionEvent['assistantMessageEvent']): AgentRuntimeEvent[] => {
  if (!inner) return []
  if (inner.type === 'text_delta' && typeof inner.delta === 'string') return [{ type: 'text_delta', delta: inner.delta }]
  if (inner.type === 'thinking_start') return [{ type: 'thinking_start' }]
  if (inner.type === 'thinking_delta' && typeof inner.delta === 'string') return [{ type: 'thinking_delta', delta: inner.delta }]
  if (inner.type === 'thinking_end') return [{ type: 'thinking_end' }]
  if (inner.type === 'done' || inner.type === 'error') {
    const msg = inner.message || inner.error
    return [
      {
        type: 'assistant_done',
        text: extractMessageText(msg),
        stopReason: typeof inner.reason === 'string' ? inner.reason : undefined,
        errorMessage: sanitizeRuntimeError(msg?.errorMessage, 'provider')
      }
    ]
  }
  return []
}

// Join the text parts of a final assistant message (ignoring thinking + tool calls).
const extractMessageText = (message?: PiMessage): string => {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

const providerDisplayName = (providerId: string): string => {
  if (providerId.startsWith('openai')) return 'OpenAI Codex (ChatGPT subscription)'
  if (providerId === 'anthropic') return 'Claude'
  return providerId
}

const buildSchema = (Type: TypeBoxFactory, params: AgentToolParamSpec[]): unknown => {
  const props: Record<string, unknown> = {}
  for (const p of params) {
    const base = p.type === 'number' ? Type.Number() : p.type === 'boolean' ? Type.Boolean() : Type.String()
    props[p.name] = p.required ? base : Type.Optional(base)
  }
  return Type.Object(props)
}
