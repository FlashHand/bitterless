import type { AgentRuntimeAdapter, AgentRuntimeSession, AgentRuntimeSessionOptions } from '@main/agent/runtime/agentRuntime.types'
import { PiRuntimeAdapter } from '@main/agent/runtime/piRuntimeAdapter'

// 路由器保留(它是 BaseAgent 的默认运行时入口),但 2026-09 AI-CRMS 退役后只剩 pi 一条路。
// 不把 BaseAgent 直接接到 PiRuntimeAdapter 上,是因为这一层就是「按 provider 选运行时」的
// 接缝 —— 下一个非 pi 运行时接回来的地方在这里,不在 BaseAgent 里。
export class CoachRuntimeAdapter implements AgentRuntimeAdapter {
  private readonly pi = new PiRuntimeAdapter()

  async checkTarget(params: { providerId: string; modelId: string; authPath: string; modelsPath?: string }): Promise<boolean> {
    return await this.select().checkTarget(params)
  }

  async createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession> {
    return await this.select().createSession(options)
  }

  private select(): AgentRuntimeAdapter {
    return this.pi
  }
}
