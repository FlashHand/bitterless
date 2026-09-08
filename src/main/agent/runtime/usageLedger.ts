import type { AgentRuntimeUsage } from './agentRuntime.types'

/**
 * 每个 agent 会话【当前这一回合】的累计用量。
 *
 * 与 cowork 同一份设计(`areas/agent-runtime/agent-design-parity.md`):`BaseAgent` 逐轮回调
 * `onUsage`,由 `maestroAgent.service` 写进这里,读者按自己所属的 sessionKey 取。
 *
 * **为什么压缩需要它**:压缩的触发线要问「上一轮模型实际吃进去多少」,而那个数只有模型往返
 * 知道 —— 渲染端按自己的 token 计量估算是另一把尺。`compaction.handler` 读这里,拿不到就报
 * `no-usage` 让调用方退回本地估算,**而不是**报一个零用量的「不用压」:零用量与「上下文是空的」
 * 不可分,而两者的后果相反。
 *
 * 值的语义是**本回合累计**,不是历史总和:每次新回合从零开始累加,所以新回合会覆盖旧值。
 * 别把它当会话总花销用。
 */
class UsageLedger {
  private byAgentKey = new Map<string, AgentRuntimeUsage>()

  set(agentKey: string, total: AgentRuntimeUsage): void {
    this.byAgentKey.set(agentKey, { ...total })
  }

  get(agentKey: string): AgentRuntimeUsage {
    return this.byAgentKey.get(agentKey) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }
  }

  totalTokens(agentKey: string): number {
    return this.get(agentKey).totalTokens
  }

  costUsd(agentKey: string): number {
    return this.get(agentKey).costUsd
  }
}

export const usageLedger = new UsageLedger()
