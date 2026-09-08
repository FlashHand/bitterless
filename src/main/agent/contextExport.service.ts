import type { AgentRuntimeContextSnapshot } from './runtime/agentRuntime.types'
import { assertContextTextSize } from './runtime/contextSnapshot.service'

export const formatContextExport = (params: {
  sessionId: string
  provider: string
  model: string
  runtime: AgentRuntimeContextSnapshot | null
  preamblePending: boolean
  pending: string
  attachmentPaths: string[]
}): { text: string; entries: number } => {
  const entries = params.runtime?.messages.length ?? 0
  const text = [
    `=== Bitterless model context snapshot · ${params.sessionId} ===`,
    `model: ${params.provider}/${params.model}`,
    'Read-only snapshot plus pending prompt, not an exact future provider wire request.',
    'Runtime extensions, compaction and skill replay can change the next send.',
    'Inline media payloads are identified but omitted; model text and tool text are not truncated.',
    '',
    '--- Runtime system prompt ---',
    params.runtime ? params.runtime.systemPrompt : '(not initialized; runtime system prompt is not available yet)',
    '',
    `--- Model-side history: ${entries} entries (including tool calls/results) ---`,
    params.runtime ? JSON.stringify(params.runtime.messages, null, 2) : '(no model-side history yet)',
    '',
    `--- Pending user prompt (${params.preamblePending ? 'includes first-turn Bitterless preamble' : 'preamble already sent'}) ---`,
    params.pending,
    '',
    '--- Pending attachment references (not read, validated or uploaded) ---',
    JSON.stringify(params.attachmentPaths, null, 2),
    'Media/directory/archive annotations and transport are unresolved; they are assembled only on send.'
  ].join('\n')
  assertContextTextSize(text)
  return { text, entries }
}
