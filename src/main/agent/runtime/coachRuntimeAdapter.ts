import type { AgentRuntimeAdapter, AgentRuntimeSession, AgentRuntimeSessionOptions } from '@main/agent/runtime/agentRuntime.types'
import { AiCrmsRuntimeAdapter } from './aiCrmsRuntimeAdapter'
import { PiRuntimeAdapter } from '@main/agent/runtime/piRuntimeAdapter'

export class CoachRuntimeAdapter implements AgentRuntimeAdapter {
  private readonly aiCrms = new AiCrmsRuntimeAdapter()
  private readonly pi = new PiRuntimeAdapter()

  async checkTarget(params: { providerId: string; modelId: string; authPath: string; modelsPath?: string }): Promise<boolean> {
    return await this.select(params.providerId).checkTarget(params)
  }

  async createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession> {
    return await this.select(options.target.providerId).createSession(options)
  }

  private select(providerId: string): AgentRuntimeAdapter {
    return providerId.trim().toLowerCase() === 'ai-crms' ? this.aiCrms : this.pi
  }
}

