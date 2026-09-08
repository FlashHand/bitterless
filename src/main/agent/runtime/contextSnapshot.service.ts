import type { AgentRuntimeContextSnapshot } from './agentRuntime.types'

export const MAX_CONTEXT_EXPORT_CHARS = 8 * 1024 * 1024

export const assertContextTextSize = (text: string): void => {
  if (text.length > MAX_CONTEXT_EXPORT_CHARS) throw new Error('Context export exceeds the 8 MiB text limit; nothing was copied.')
}

export const snapshotRuntimeContext = (systemPrompt: string, messages: unknown[]): AgentRuntimeContextSnapshot => {
  let chars = 0
  const json = JSON.stringify({ systemPrompt, messages }, function (key, value: unknown): unknown {
    if (typeof value === 'string') {
      if ((key === 'data' && ['image', 'input_audio'].includes(this?.type)) || (key === 'url' && value.startsWith('data:'))) {
        return `[inline media omitted: ${value.length} encoded characters]`
      }
      chars += value.length
    }
    chars += key.length + 16
    if (chars > MAX_CONTEXT_EXPORT_CHARS) throw new Error('Context export exceeds the 8 MiB text limit; nothing was copied.')
    return value
  })
  assertContextTextSize(json)
  return JSON.parse(json) as AgentRuntimeContextSnapshot
}
