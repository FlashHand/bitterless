// MMCowork apidoc data model — per-domain OpenAPI-ish contract + `x-mm-*` semantics, plus the
// value-free header profile. Design: areas/agent-runtime/cowork/mmcowork-design.md.
// Shared across main (analysis) / renderer (Sources tab) / agent tools via the `@shared` alias.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | string

// x-mm-source: where a parameter's value comes from.
export type ParamSource =
  | { kind: 'input'; var: string } // vars.* — supplied by the caller/skill input
  | { kind: 'response'; endpoint: string; field: string } // grounded from a prior endpoint's response field

export type ApiRole = 'read' | 'option-read' | 'context-read' | 'write' | 'other'
export type ReplaySafety = 'safe' | 'confirm' | 'unsafe'

export interface ApiParam {
  name: string
  type: string // string | number | boolean | enum | object | array | 'a|b' union...
  required: boolean
  source?: ParamSource
  enum?: string[]
}

export interface RespField {
  path: string
  meaning?: string
}

// One canonical endpoint in the apidoc ledger (deduped by `key`).
export interface ApiEndpoint {
  key: string // canonical key = `${METHOD} ${pathTemplate}`
  method: HttpMethod
  path: string // templatized (e.g. /api/patients/{id})
  role: ApiRole
  query: ApiParam[]
  reqBody: ApiParam[]
  respFields: RespField[]
  replaySafety: ReplaySafety
  auth?: string // x-mm-auth: reference to the domain header profile, e.g. '@domainProfile'
  seen: number // how many captured occurrences merged into this entry
  rawRefs: string[] // pointers into the verbatim store (analysis-time; stripped on publish)
  ambiguous?: boolean // flagged when a merge hit a conflict that needs AI reconciliation
}

// A per-window extraction result (LLM output) — most fields optional; upsert fills defaults.
export interface ExtractedEndpoint {
  method: HttpMethod
  path: string
  role?: ApiRole
  query?: ApiParam[]
  reqBody?: ApiParam[]
  respFields?: RespField[]
  replaySafety?: ReplaySafety
  auth?: string
  seen?: number
  rawRefs?: string[]
}

export interface ApiDoc {
  domain: string
  version_code?: string
  hash?: string
  endpoints: ApiEndpoint[]
}

// ---- Header profile (value-free) ----
// The generated assembler reads the credential VALUE at runtime in-page; only key/site-fn NAMES
// are ever persisted — never the value.

export interface HeaderStorageSource {
  store: 'localStorage' | 'sessionStorage' | 'cookie'
  key: string
}

export interface StaticHeaderRule {
  header: string
  kind: 'static'
  scheme?: string // e.g. 'Bearer '
  source: HeaderStorageSource
}

export interface DynamicHeaderRule {
  header: string
  kind: 'dynamic'
  siteFn?: string // e.g. 'window.__app.sign' — preferred: call the site's own signer in the main world
  algorithm?: string // value-free description, fallback when no callable site fn was recovered
  inputs?: { name: string; source: string }[]
  rawRefs?: string[]
}

export type HeaderRule = StaticHeaderRule | DynamicHeaderRule

export interface HeaderProfile {
  domain: string
  rules: HeaderRule[]
  staticContentType?: string
}


// 抽过来的这几型引用 `CaptureOptions` / `CaptureRule` —— **用 bl 自己那两份**,
// 不抄平行定义:平行定义会在两边各自演进后静默错位,而这两个 bl 早就有。
import type { CaptureOptions } from '@maestro-shared/coach.api'
import type { CaptureRule } from '@maestro-shared/captureFilter.api'

// ── 以下四型从 cowork 的 `shared/cowork.api.ts` 抽出(drill-001 阶段二)。
// **只抽 apidoc 摄取真正用到的**,不整份搬那 1,826 行 —— bl 没有 `cowork.api`,
// 而把一个大杂烩契约整份复制过来会顺带引入几十个 bl 用不上的类型。
export interface IngestAdvice {
  host: string
  /** The filter as it stood during THIS recording — printed first (Ral 2026-08-10「建议包括,黑白名单配置先」). */
  filters: {
    /** The network-capture master switch. Off = nothing was ever recorded, and no filter rule is to blame. */
    recordNetwork: boolean
    globalWhitelistEnabled: boolean
    globalWhitelist: string[]
    globalBlacklist: string[]
    domain: string
    domainWhitelistEnabled: boolean
    domainWhitelist: string[]
    domainBlacklist: string[]
  }
  recommendations: IngestFilterRecommendation[]
  blocked: CaptureBlockedGroup[]
  drops: IngestDropGroup[]
  /** Facts that explain the artifact's shape but need no config change. */
  notes: string[]
  /** The rendered text — what the agent reads and what lands in `advice.md`. */
  text: string
}
export interface IngestApiDocResult {
  ok: boolean
  host: string
  endpointCount: number
  message: string
  error?: string
  /** Filter/coverage advisory — present whenever ingest had a filter context, INCLUDING on failure (an empty capture is usually a whitelist problem). */
  advice?: IngestAdvice
  /**
   * 这一窗里**库中原本不存在**的端点数(在 upsert 之前点查得到的事实)。
   * 「已存在」= `endpointCount - created`,**不单独给一个数** —— 三个数里任意两个漂开时没人知道该信哪个。
   */
  created?: number
  /** 新增端点的 `METHOD /path` 清单,**有上限**:给摘要列举用,不是全量导出。 */
  createdKeys?: string[]
  /**
   * 这一窗没能文档化的端点数。
   *
   * 为什么要单独回一个数而不是让人去翻日志:`lost` 原来只活在一条独立的 warn 里,
   * 没有任何下游读它 —— 实测一个丢了 3 个端点的窗口,在聊天里显示的是一个 ✅。
   */
  lostCount?: number
}
export interface ApiDocEntry {
  host: string
  openapi: Record<string, unknown>
  updatedAt: number
  /** 站点级鉴权方案(apidoc-site-auth)—— LLM 摄取时总结,面板 header 下展示。缺省空串。 */
  authDesc?: string
  /** 端点真正住的 origin(页面站 ≠ API 站)。面板在鉴权方案旁边展示,调用侧据此解析裸路径。 */
  apiBases?: string[]
  /**
   * 鉴权冒烟:**实际打过一发真请求**的结论(`pass`/`fail`),与 `authDesc`(文档怎么说)分开。
   * 面板据此显示绿色/红色 tag —— 文档写得再漂亮也不等于照着它能调通,只有真请求算证据。
   */
  authSmoke?: '' | 'pass' | 'fail'
  /**
   * 人工判定的读/写,键 = `METHOD path`(如 `POST /order/admin/export`)。
   *
   * 为什么单独一张映射而不是塞进 openapi:人工值存在 `apidoc_endpoint.mutates_manual` 列上,
   * **刻意不在 doc_json 里** —— 那份重摄时整份覆盖,写进去会被下一轮钻探静默还原。
   * 面板要显示"这条是人设的",就得把这一列带过来。
   */
  mutatesManual?: Record<string, boolean>
  authSmokeNote?: string
}
export interface ApiDocSummary {
  host: string
  title: string
  endpointCount: number
  updatedAt: number
}

// 摄取建议/过滤上下文那一族 —— 同样只抽用到的四型。
/**
 * The filter as it stood during a recording + what it dropped. Produced by the capture service, read
 * by ingest. Lives in shared (not in either service) because it crosses the two domains and a service
 * may not import another service.
 */
export interface CaptureFilterContext {
  /** The filter as it stood when the recording STARTED — not the live one, which the operator may already have edited in response to earlier advice. */
  options: CaptureOptions
  blocked: CaptureBlockedGroup[]
  blockedCapped: boolean
  /** The filter was edited while the recording was live, so `options` is only part of the truth. */
  filterChangedWhileRecording: boolean
  /**
   * Whether a tally exists for the recording being ingested. False after an app relaunch (the session
   * directory is recovered from disk, the in-memory tally is not) — then an empty `blocked` means
   * "unknown", NOT "nothing was blocked", and the advisory must not claim a clean bill of health.
   */
  tallyAvailable: boolean
}

/** One group of requests that PASSED the filter but that ingest itself refused to document. */
export interface IngestDropGroup {
  host: string
  reason: 'cross-site' | 'preflight' | 'non-business'
  count: number
  apiLike: number
  samplePath: string
}

/** One group of requests the capture filter dropped, aggregated by host + reason + matched rule. Counts and one sample path only — never a body. */
export interface CaptureBlockedGroup {
  host: string
  reason: string
  /** Readable form of the blacklist rule that matched (`domain-suffix foo.com`); empty on a whitelist miss. */
  rule: string
  scope: 'global' | 'domain'
  count: number
  /** How many of them looked like a business API call — only those are worth whitelisting. */
  apiLike: number
  samplePath: string
}

export interface IngestFilterRecommendation {
  /** `remove-blacklist` / `add-whitelist` mean endpoints were LOST; the other two only reduce noise. */
  action: 'remove-blacklist' | 'add-whitelist' | 'enable-whitelist' | 'add-blacklist'
  /** '' = the global scope; otherwise the host whose scope it belongs to. */
  scope: string
  rule: 'domain-suffix' | 'url-prefix'
  value: string
  /** Why this is recommended, in one sentence. */
  reason: string
  /** The counts it rests on — a recommendation with no evidence must not be emitted. */
  evidence: string
}

// 域级过滤范围。**bl 侧永远是 absent** —— bl 的录制没有域级规则,
// 但摄取建议那段逻辑本来就按 "absent = 没有域规则" 写的,所以类型要允许读它。
export interface CaptureFilterScope {
  domain: string
  whitelistEnabled: boolean
  whitelist: CaptureRule[]
  blacklist: CaptureRule[]
}
