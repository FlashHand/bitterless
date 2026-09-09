// Per-domain execution artifacts written at API ingest.
// Contract: docs/features/node-only-api-execution.md (nodeexec-003); upstream design
// overmind:areas/agent-runtime/automation/api-automation.html #5.2.
//
// The owner's requirement is that recording produces a FIXED, parameterised call unit instead of an
// LLM-authored one-off per call. That unit is:
//
//   endpoints.json   the audited descriptor table — "these are the endpoints ingest actually saw"
//   profile.json     the domain's envelope rule + static headers + optional signers
//   client.mjs       emitted ONLY when the domain needs code (per-request signature, multi-step)
//
// Generation is DELIBERATELY deterministic, not LLM-driven: the OpenAPI doc next door already goes
// through the model and has to bisect-retry around output truncation. An execution artifact that
// silently loses an endpoint to a truncated response would be far worse than a slightly dumber
// descriptor, so this reads the captured exchanges directly.
//
// Values never land in these files. A recorded body/query carries business data; only param NAMES
// are kept. (The trace itself keeps values — by owner decision — but that is a private capture
// store, not an artifact the executor reads on every call.)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apiArtifactDir } from '@maestro-main/drive/httpProfile'
import type { ApiDocExchangeInput } from '@maestro-main/apidoc/apiDoc.types'
import type { ApidocArtifactWriteResult, DomainProfileArtifact, EndpointDescriptor } from './apiArtifacts.types'

/** `/order/1234` → `/order/{id}`; `/x/8f0e-…-uuid` → `/x/{uuid}`. */
const templatizePath = (pathname: string): string =>
  pathname
    .split('/')
    .map((seg) => {
      if (/^\d{2,}$/.test(seg)) return '{id}'
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return '{uuid}'
      return seg
    })
    .join('/')

const NON_BUSINESS = /\.(js|mjs|css|map|png|jpe?g|gif|svg|webp|woff2?|ttf|ico)(\?|$)/i

const bodyParamNamesOf = (body: string | null | undefined): string[] | undefined => {
  if (!body) return undefined
  try {
    const parsed = JSON.parse(body) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.keys(parsed as Record<string, unknown>).sort()
    if (Array.isArray(parsed)) return ['<array-body>']
  } catch {
    return ['<non-json-body>']
  }
  return undefined
}

export const buildEndpointTable = (
  exchanges: ApiDocExchangeInput[]
): { table: Record<string, EndpointDescriptor>; dropped: number } => {
  const table: Record<string, EndpointDescriptor> = {}
  let dropped = 0
  for (const ex of exchanges) {
    const method = String(ex.method || 'GET').toUpperCase()
    // OPTIONS is preflight noise, never a callable business endpoint.
    if (method === 'OPTIONS') {
      dropped += 1
      continue
    }
    if (NON_BUSINESS.test(ex.url)) {
      dropped += 1
      continue
    }
    let u: URL
    try {
      u = new URL(ex.url)
    } catch {
      dropped += 1
      continue
    }
    const path = templatizePath(u.pathname)
    const key = `${method} ${path}`
    const query: Record<string, string> = {}
    for (const k of u.searchParams.keys()) query[k] = ''
    const prev = table[key]
    table[key] = {
      method,
      path,
      origin: u.origin,
      query: prev && Object.keys(prev.query).length ? { ...prev.query, ...query } : query,
      bodyParamNames: bodyParamNamesOf(ex.requestBody) || prev?.bodyParamNames,
      required: prev?.required || [],
      // A GET is a read. Anything else is only a write if it mutates, and dsh-style backends put
      // list filters in a POST body — so do NOT guess 'write' from the verb, leave it unknown and
      // let the existing apiSafety classifier decide at call time.
      role: method === 'GET' ? 'read' : 'unknown',
      seen: (prev?.seen || 0) + 1,
      observedStatus: ex.status ?? prev?.observedStatus
    }
  }
  return { table, dropped }
}

// Infer the envelope rule from what the responses actually looked like. Only claims a rule when the
// SAME field carries the SAME value across every 2xx JSON response — one sample is a coincidence,
// and a wrong rule would mark healthy responses as failures.
export const inferSuccessRule = (exchanges: ApiDocExchangeInput[]): DomainProfileArtifact['successRule'] => {
  const candidates = ['code', 'status', 'errcode', 'errCode', 'resultCode']
  const seen = new Map<string, Set<string>>()
  let samples = 0
  for (const ex of exchanges) {
    if (!ex.responseBody || (ex.status ?? 200) >= 300) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(ex.responseBody)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    samples += 1
    const rec = parsed as Record<string, unknown>
    for (const field of candidates) {
      if (!(field in rec)) continue
      const set = seen.get(field) || new Set<string>()
      set.add(JSON.stringify(rec[field]))
      seen.set(field, set)
    }
  }
  if (samples < 2) return undefined
  for (const field of candidates) {
    const set = seen.get(field)
    // Present on every sample AND always the same value → that value means "ok" for this domain.
    if (set && set.size === 1) return { field, equals: JSON.parse(Array.from(set)[0]) }
  }
  return undefined
}

// The generated per-domain client. Emitted ONLY when the domain needs code — see decision 2 in the
// feature doc: for a static-header domain the executor's own T1 path runs the same descriptor with
// no spawn cost and without keeping two implementations of one behaviour in sync.
const renderClientMjs = (host: string, profile: DomainProfileArtifact): string => `// GENERATED by cowork API ingest for ${host} — do not edit by hand; re-ingest to regenerate.
// stdin  : { endpoint, params, credentials, pageData, browserHeaders }
// stdout : exactly one JSON object { ok, status?, bodyCode?, data?, error? }
//
// Value-free: this file contains the domain's ALGORITHM only. Credential values arrive on stdin and
// are never written here, logged, or echoed back.
const readStdin = () =>
  new Promise((resolve, reject) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { buf += c })
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', reject)
  })

const out = (o) => process.stdout.write(JSON.stringify(o))
const JWT = /eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}/g
const scrub = (s) => String(s).replace(JWT, '[REDACTED_JWT]').slice(0, 2000)

// qs arrayFormat 'indices' — tags[0]=1&tags[1]=2. Matches the r-networking convention; getting this
// wrong is a silent wrong-result bug, not an error.
const qsIndices = (obj, prefix = '') => {
  const parts = []
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue
    const key = prefix ? prefix + '[' + k + ']' : k
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const ik = key + '[' + i + ']'
        if (item !== null && typeof item === 'object') parts.push(qsIndices(item, ik))
        else parts.push(encodeURIComponent(ik) + '=' + encodeURIComponent(String(item)))
      })
    } else if (typeof v === 'object') parts.push(qsIndices(v, key))
    else parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)))
  }
  return parts.filter(Boolean).join('&')
}

const SUCCESS_RULE = ${JSON.stringify(profile.successRule ?? null)}

const main = async () => {
  const raw = await readStdin()
  if (!raw.trim()) return out({ ok: false, error: 'no stdin input' })
  let input
  try { input = JSON.parse(raw) } catch { return out({ ok: false, error: 'stdin was not valid JSON' }) }

  const { endpoint, params = {}, credentials = {}, pageData = {}, browserHeaders = {} } = input
  const table = pageData.endpoints || {}
  const desc = table[endpoint]
  // Fail CLOSED: a persisted client may only reach endpoints ingest actually saw.
  if (!desc) return out({ ok: false, error: 'unknown endpoint "' + endpoint + '" (known: ' + Object.keys(table).join(', ') + ')' })

  const missing = (desc.required || []).filter((k) => params[k] === undefined || params[k] === null || params[k] === '')
  if (missing.length) return out({ ok: false, error: 'missing required param(s): ' + missing.join(', ') })

  const method = (desc.method || 'GET').toUpperCase()
  const origin = desc.origin || pageData.origin
  if (!origin) return out({ ok: false, error: 'no origin for ' + endpoint })
  const sendsBody = method !== 'GET' && method !== 'HEAD'

  let url = new URL(desc.path, origin).toString()
  const qs = qsIndices(sendsBody ? desc.query : { ...(desc.query || {}), ...params })
  if (qs) url += (url.includes('?') ? '&' : '?') + qs

  const headers = { ...browserHeaders, ...(pageData.staticHeaders || {}), ...(credentials.headers || {}) }
  if (credentials.cookie) headers.cookie = credentials.cookie
  if (sendsBody) headers['content-type'] = headers['content-type'] || 'application/json'
  headers.referer = headers.referer || pageData.referer || origin
  headers.origin = headers.origin || pageData.origin || origin

  // --- per-request signature goes here when this domain needs one. Call the site's own signer
  // --- through pageData/credentials rather than re-implementing it; see the feature doc.

  try {
    const res = await fetch(url, { method, headers, body: sendsBody ? JSON.stringify(params) : undefined, redirect: 'follow' })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { __nonJsonBody: text.slice(0, 2000), __len: text.length } }
    const rule = SUCCESS_RULE
    const bodyCode = rule && data && typeof data === 'object' ? data[rule.field] : undefined
    const bodyOk = rule && bodyCode !== undefined ? bodyCode === rule.equals : null
    // NOT "HTTP 200": this domain may answer a failure with a 2xx and signal it in the envelope.
    out({ ok: res.ok && bodyOk !== false, status: res.status, bodyCode, data })
  } catch (err) {
    out({ ok: false, error: scrub(err && err.message ? err.message : err) })
  }
}

main().catch((err) => out({ ok: false, error: scrub(err && err.message ? err.message : err) }))
`

export const writeDomainArtifacts = (opts: {
  host: string
  exchanges: ApiDocExchangeInput[]
  staticHeaders?: Record<string, string>
  signers?: { header: string; siteFn: string }[]
}): ApidocArtifactWriteResult => {
  const dir = apiArtifactDir(opts.host)
  mkdirSync(dir, { recursive: true })

  const { table, dropped } = buildEndpointTable(opts.exchanges)
  const profile: DomainProfileArtifact = {
    host: opts.host,
    updatedAt: Date.now(),
    successRule: inferSuccessRule(opts.exchanges),
    staticHeaders: opts.staticHeaders,
    signers: opts.signers
  }

  writeFileSync(join(dir, 'endpoints.json'), JSON.stringify(table, null, 2))
  writeFileSync(join(dir, 'profile.json'), JSON.stringify(profile, null, 2))

  const needsClient = Boolean(opts.signers?.length)
  if (needsClient) writeFileSync(join(dir, 'client.mjs'), renderClientMjs(opts.host, profile))

  return { host: opts.host, dir, endpointCount: Object.keys(table).length, wroteClient: needsClient, droppedNonBusiness: dropped }
}
