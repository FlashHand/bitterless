// Classify a domain's auth/dynamic headers into a VALUE-FREE HeaderProfile by value-provenance:
// match a captured authenticated request's header VALUE against localStorage/sessionStorage/cookie
// entries → the header is STATIC, sourced from that key (record the key name + any scheme prefix,
// NEVER the value). A signature-named header with no storage match is a DYNAMIC candidate (its
// siteFn is recovered later by the resource A→E flow). Validated black-box on test-dsh-admin
// (header `-r-token` ← localStorage `token`, static, no signature). Design: mmcowork-design.md #8.
import type { HeaderRule } from '@maestro-shared/apidoc.types'
import type { AuthEvidence } from './headerClassify.types'

const SIG_RE = /sign|signature|nonce|timestamp|hmac|digest|x-ca-/i
const SKIP_RE = /^(host|origin|referer|user-agent|accept|accept-encoding|accept-language|content-length|content-type|connection|sec-|cache-control|pragma|cookie|date)$/i
const MIN_LEN = 16 // ignore short/boilerplate header values when matching

// If the header value is `<prefix><storedValue>` with a word+space prefix (e.g. "Bearer "), return it.
const splitScheme = (headerValue: string, storedValue: string): string | undefined => {
  if (headerValue === storedValue) return undefined
  if (headerValue.endsWith(storedValue)) {
    const prefix = headerValue.slice(0, headerValue.length - storedValue.length)
    if (/^[A-Za-z][A-Za-z-]* $/.test(prefix)) return prefix
  }
  return undefined
}

export const classifyAuthHeaders = (ev: AuthEvidence): HeaderRule[] => {
  const stores: Array<{ store: 'localStorage' | 'sessionStorage' | 'cookie'; map: Record<string, string> }> = [
    { store: 'localStorage', map: ev.localStorage || {} },
    { store: 'sessionStorage', map: ev.sessionStorage || {} },
    { store: 'cookie', map: ev.cookies || {} }
  ]
  const rules: HeaderRule[] = []
  for (const [name, rawValue] of Object.entries(ev.requestHeaders || {})) {
    if (SKIP_RE.test(name)) continue
    const value = String(rawValue || '')
    // STATIC: the header value derives from a stored value (value-provenance).
    let matched: { store: 'localStorage' | 'sessionStorage' | 'cookie'; key: string; scheme?: string } | null = null
    if (value.length >= MIN_LEN) {
      for (const s of stores) {
        for (const [k, v] of Object.entries(s.map)) {
          if (!v || v.length < MIN_LEN) continue
          if (value === v || value.endsWith(v)) {
            matched = { store: s.store, key: k, scheme: splitScheme(value, v) }
            break
          }
        }
        if (matched) break
      }
    }
    if (matched) {
      rules.push({ header: name, kind: 'static', scheme: matched.scheme, source: { store: matched.store, key: matched.key } })
      continue
    }
    // DYNAMIC candidate: a signature-named header with no storage provenance (siteFn recovered later).
    if (SIG_RE.test(name)) rules.push({ header: name, kind: 'dynamic' })
  }
  return rules
}
