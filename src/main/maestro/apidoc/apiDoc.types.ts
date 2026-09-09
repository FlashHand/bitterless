// Type-level declarations extracted from apiDoc.service.ts.
import type { CaptureFilterContext, IngestDropGroup } from '@maestro-shared/apidoc.types'

/** The capture filter's state + everything both filter layers dropped, so ingest can explain its coverage. */
export interface ApiDocFilterContext extends CaptureFilterContext {
  drops: IngestDropGroup[]
}

// One captured HTTP exchange, pre-sanitized by the caller: header NAMES only (auth/cookie VALUES
// never reach the LLM), bodies clipped. Grounds the generated doc in real traffic.
export interface ApiDocExchangeInput {
  method: string
  url: string
  requestHeaderNames: string[]
  requestBody?: string | null
  status?: number
  mime?: string
  responseBody?: string | null
  /** Body was a file/binary upload and was withheld from the prompt — the endpoint is still documented. */
  requestBodyIsFile?: boolean
  /** Response was a file/binary download (export, attachment) and was withheld from the prompt. */
  responseBodyIsFile?: boolean
}

// 满 N 次超时后问用户是否继续(apidoc-ingest-stall-on-slow-model 决定 3,Ral 2026-08-11)。
// 返回 true = 再来一轮重试;false = 放弃这批(整轮继续剩余批)。后台 ingest 会【阻塞】在这个 Promise
// 上,等用户点聊天里那张卡片的 Confirm/Cancel。不传 = 默认放弃(手动摄取等没有卡片通道的路径,保持
// 有界、不吊死)。
export type IngestContinueDecision = (info: {
  label: string
  batchIndex: number
  plannedBatches: number
  attempts: number
  timeoutMs: number
}) => Promise<boolean>

export interface JsonParseOutcome {
  value: Record<string, unknown> | null
  /** JSON.parse message when parsing failed (for diagnostics — never rendered to the user). */
  error?: string
  /** A ±window of the raw JSON around the failing offset, so the log pinpoints WHY it failed. */
  window?: string
  /**
   * 输出**不完整**(读到头了还有没闭合的括号),而不是**格式错**。
   *
   * 为什么要把这两件事分开(2026-08-17):当日 10 次解析失败,**10 次的报错位置都恰好等于输出长度**
   * —— 全是被截断,一个格式错都没有。而告警一直写作 `output was not valid JSON`,
   * 「不合法」听起来是内容问题(只能改 prompt),「被截断」是长度问题(重试就行),
   * 名字取错,方向就跟着错,所以这个漏一直没人追。
   *
   * 判据用**括号深度**,不解析报错文案:文案随运行时版本变,深度是结构事实。
   */
  truncated?: boolean
}

// Flatten the stored OpenAPI into the operation rows `digest()` renders. Defensive at every hop:
// the doc is LLM-generated, so an unexpected shape must degrade to "no operations", never throw.
export interface ApiDocOperation {
  method: string
  path: string
  summary: string
  description: string
  paramNames: string[]
  servers: string[]
  operation: Record<string, unknown>
}
