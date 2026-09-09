/**
 * 聊天回合的诊断留痕 —— `[maestro-turn] event=… k=v` 单行。
 *
 * 存在的理由:`turn.service.ts` 的 `send()` 在 `dispatched = true` 之前有 4 个**无超时**的跨进程
 * await(claim / workspace / attachments / compaction),它们之间穿插 5 处静默
 * `return { ok: false, reason: 'not-sendable' }`。任一处挂住或静默返回,UI 的表现完全一样 ——
 * turn 占着、Stop 常亮、没有回复,而日志里一个字都没有(实测 main.log 1467 行里发送记录 0 条)。
 * 详见 `docs/issues/maestro-chat-blind-send-path-and-cowork-parity.md`。
 *
 * **每一档都打 start 和 end**,这是本文件唯一重要的设计:挂住的表现就是「有 start 没 end」,
 * 而这恰恰是原来看不见的那一类故障。只打完成态的话,卡住时依然是一片空白。
 *
 * 落盘走渲染端 `console.info` —— `main/logging/logPolicy.service.ts` 把这个页面归到
 * `proc=renderer:maestroControl`,`[scope]` 前缀被抽成 `scope` 字段,与 `maestro-open`
 * 落盘形状一致,不需要新增管道。
 *
 * **不记正文。** 只记 id、长度、计数、耗时、原因枚举。人的消息、模型输出、路径一律不进日志。
 *
 * 形状照着 `main/maestro/diagnostics/maestroOpenDiagnostics.service.ts`:受校验的事件词表 +
 * 出错不抛(诊断自己坏掉不许连带弄坏发送)。
 */

const TURN_EVENTS = ['send-start', 'stage-start', 'stage-end', 'reject', 'send-terminal', 'history'] as const
export type MaestroTurnEvent = (typeof TURN_EVENTS)[number]

/** 与 `send()` 里 4 个 pre-dispatch await 一一对应,外加投递本体。 */
export const TURN_STAGES = ['claim', 'workspace', 'attachments', 'compaction', 'dispatch'] as const
export type MaestroTurnStage = (typeof TURN_STAGES)[number]

const EVENTS = new Set<string>(TURN_EVENTS)
const STAGES = new Set<string>(TURN_STAGES)

const MAX_DURATION_MS = 3_600_000

/** 只允许标量,且 undefined/null 一律不出现在行里(免得日志里出现 `reason=undefined` 这种噪声)。 */
const renderValue = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(value)) : undefined
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // 空格会把一行 k=v 撕成两截,统一收敛;顺带压掉过长的值(reason 有时是异常原文)。
  return trimmed.replace(/\s+/g, '_').slice(0, 200)
}

export class TurnDiagnostics {
  private readonly clock: () => number
  private readonly write: (line: string) => void

  constructor(options: { clock?: () => number; write?: (line: string) => void } = {}) {
    this.clock = options.clock ?? (() => globalThis.performance.now())
    this.write = options.write ?? ((line) => console.info(line))
  }

  now(): number {
    try {
      const candidate = this.clock()
      return Number.isFinite(candidate) ? Math.max(0, Math.floor(candidate)) : 0
    } catch {
      return 0
    }
  }

  elapsed(startedAt: number): number {
    const done = this.now()
    if (!Number.isFinite(startedAt) || startedAt < 0 || done < startedAt) return 0
    return Math.min(MAX_DURATION_MS, done - startedAt)
  }

  emit(event: MaestroTurnEvent, fields: Record<string, unknown>): boolean {
    if (!EVENTS.has(event)) return false
    try {
      const parts: string[] = []
      for (const [key, raw] of Object.entries(fields)) {
        if (key === 'stage' && !STAGES.has(String(raw))) continue
        const value = renderValue(raw)
        if (value !== undefined) parts.push(`${key}=${value}`)
      }
      this.write(`[maestro-turn] event=${event}${parts.length ? ` ${parts.join(' ')}` : ''}`)
      return true
    } catch {
      return false
    }
  }

  /**
   * 一档的计时包装:进入即 `stage-start`,离开即 `stage-end`(带 ok 与耗时)。
   * 抛出时也会打 `stage-end ok=false`,然后**原样重抛** —— 诊断不改变控制流。
   */
  async stage<T>(turnId: string, stage: MaestroTurnStage, run: () => Promise<T>): Promise<T> {
    const startedAt = this.now()
    this.emit('stage-start', { turnId, stage })
    try {
      const result = await run()
      this.emit('stage-end', { turnId, stage, ok: true, elapsedMs: this.elapsed(startedAt) })
      return result
    } catch (err) {
      this.emit('stage-end', { turnId, stage, ok: false, elapsedMs: this.elapsed(startedAt), error: String(err) })
      throw err
    }
  }
}

export const turnDiagnostics = new TurnDiagnostics()
