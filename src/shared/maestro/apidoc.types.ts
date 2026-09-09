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
