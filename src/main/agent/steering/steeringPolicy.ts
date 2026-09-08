/**
 * 回合内 steering 的**机械**策略 —— `docs/features/cowork-turn-steering.md`「策略表」的代码形态。
 *
 * 一句话:AI 正在回话时人再发一条,默认**带进当前回合**(`steer`),只在三种「此刻插进去没有落点」
 * 的情形下退让成排队(`followUp`)。**不给用户开关、不用 LLM 判断、不看在跑什么工具**
 * (Ral 2026-08-28:「不用让人选了,不需要快捷键,steer 还是 followUp 都是按策略进行」)。
 *
 * ## 为什么默认 steer 而不是保守
 *
 * 代价不对称:
 * - 「补充信息」被误判成 steer → 多插一次,**内容不丢** —— 它进 entry 树,模型下一步就看到。
 * - 「改方向」被误判成 followUp → 用户看着 AI 继续跑一条已经被否掉的路,**得等到整个回合结束**。
 *
 * 后者的代价大得多。所以默认档是 steer,下面那三条 followUp 是**例外**,不是基线。
 *
 * ## 为什么这里没有工具读/写分类
 *
 * 初版按工具分过一次,理由是「中途打断会留半完成状态」。**该理由被 pi 源码证伪**:
 * `steer` 从不打断执行中的工具 —— `harness/agent-harness.js:601` 只把消息 push 进 `steerQueue`,
 * 投递点在 `agent-loop.js:154`,即一个 turn 的工具**全部执行完毕**之后。
 * ⇒ 「工具不会被切成半截」是 pi 白送的属性,不需要一张随工具增长的静态表去买它。
 * pi 自己的交互模式(`modes/interactive/interactive-mode.js:2170` / `:2886`)也是零工具分类。
 *
 * ## 判定只用 main 侧拿得到的四个信号
 *
 * 是否流式 / 是否压缩 / 有无未投递 steering / 回合是否在收尾 —— 全部来自 pi session 与适配器
 * 自己的事件流。**renderer 只管「发」,不判断投递方式**,与压缩契约的进程边界一致。
 *
 * 本文件刻意**零 import**:它是纯函数 + 四条 if,所以守卫可以 esbuild → vm 直接跑真源码,
 * 不必起 Electron、不必造 pi session。
 */

export type StreamingBehavior = 'steer' | 'followUp'

export type SteeringMode = 'all' | 'one-at-a-time'

/** 策略判定要的四个信号。**没有工具信息** —— 见文件头「为什么这里没有工具读/写分类」。 */
export interface SteeringSignals {
  /** pi 的 `isStreaming`。false 时 pi 会忽略 `streamingBehavior`,但我们照样传(见 rule 0)。 */
  streaming: boolean
  /** pi 的 `isCompacting`(`agent-session.js:560` 那个复合判断:手动 / 自动 / 分支摘要)。 */
  compacting: boolean
  /** pi 的 `getSteeringMessages().length` —— 已排队但**尚未投递**的 steering 条数。 */
  pendingSteeringCount: number
  /** pi 的 `steeringMode`。`one-at-a-time` 时第 3 条才生效。 */
  steeringMode: SteeringMode
  /** 本回合已进入收尾(适配器的 `abort()` 正在跑)。pi 没有对应 getter,由适配器自己记。 */
  aborting: boolean
}

export interface SteeringDecision {
  behavior: StreamingBehavior
  /** 命中的策略表行号。0 = 表没覆盖的「根本没在流式」那一档。 */
  rule: 0 | 1 | 2 | 3 | 4
  /** 给日志看的一句话。 */
  reason: string
}

/**
 * 策略表(`cowork-turn-steering.md`,**原文,不得在此处私改**):
 *
 * | # | 情形 | 选 |
 * |---|---|---|
 * | 1 | 正常流式输出 | steer |
 * | 2 | 正在压缩(`isCompacting`) | followUp |
 * | 3 | 已有未投递 steering 且 `steeringMode === 'one-at-a-time'` | followUp |
 * | 4 | 回合已进入收尾(`aborting`) | followUp |
 *
 * 优先级 **4 → 3 → 2 → 1**,先命中先返回(契约「策略表」原文)。
 *
 * ⚠ 任何时候都返回一个 `behavior`,**包括没在流式的时候**。pi 只在 `isStreaming` 为真时读它
 * (`agent-session.js:735`),所以多传无害;而少传的代价是 pi 直接抛
 * 「Agent is already processing. Specify streamingBehavior…」。我们读 `isStreaming` 与 pi 自己读之间
 * 隔着一次 await,这中间流可以刚好开起来 —— 恒传就把这个竞态关掉了。
 */
export const decideStreamingBehavior = (signals: SteeringSignals): SteeringDecision => {
  const decide = (behavior: StreamingBehavior, rule: SteeringDecision['rule'], reason: string): SteeringDecision => ({
    behavior,
    rule,
    reason
  })

  // 4 —— 回合已在收尾。抢一个正在停的回合没有意义。
  if (signals.aborting) return decide('followUp', 4, 'turn is aborting')

  // 3 —— 上一条 steering 还没投递出去。避免连续打断把回合搅碎。
  if (signals.steeringMode === 'one-at-a-time' && signals.pendingSteeringCount > 0) {
    return decide('followUp', 3, `steering pending (${signals.pendingSteeringCount}) under one-at-a-time`)
  }

  // 2 —— 正在压缩:摘要正在生成,此刻插队没有落点,等它完成后作为下一个 prompt。
  //      **不 abort 压缩**:abort 有活锁 —— 被 abort 的那次没有产出,上下文仍在触发线之上 →
  //      立刻重触发 → 用户再发 → 再 abort,压缩永远完不成而上下文持续增长。
  //      pi 的做法也是排队等待(`interactive-mode.js:3147` queueCompactionMessage),不 abort。
  if (signals.compacting) return decide('followUp', 2, 'compaction in progress — queue until it finishes')

  // 1 —— 正常流式输出:默认档,本 feature 的目标本身。
  if (signals.streaming) return decide('steer', 1, 'streaming')

  // 0 —— 契约的表不覆盖这一档:根本没在流式。pi 会忽略这个值(它只在 isStreaming 为真时读),
  //      照样传是为了关掉「我们读完 isStreaming 到 pi 读它」之间那段竞态。
  return decide('steer', 0, 'not streaming — sent anyway to close the isStreaming race')
}
