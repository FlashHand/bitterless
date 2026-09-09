// Leaf module: browser-header profile + response redaction + the explicit-header policy.
//
// Extracted from requestExec.service.ts so the Node API executor can use them without creating an
// import cycle (replayEngine → nodeApiExecutor → requestExec → replayEngine; requestExec imports
// RUNTIME values from replayEngine, so that cycle would be real, not type-only).
// requestExec re-exports these, so existing importers are unchanged.
import { app } from 'electron'

// Kept BYTE-IDENTICAL to the original in requestExec.service.ts. Widening it is tempting (e.g.
// adding `signature|sign`) and wrong: `sign` also matches "design", "assignee", "designation", so a
// wider pattern would redact legitimate business fields. Any change here is a behaviour change to
// every redacted response and needs its own decision.
const CURL_SECRET_KEY_RE = /(authorization|token|secret|password|passwd|api[-_]?key|jwt|bearer|cookie|csrf|xsrf|credential|session)/i
const CURL_JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g

export const redactCurlValue = (value: unknown, keyHint = ''): unknown => {
  if (typeof value === 'string') {
    if (CURL_SECRET_KEY_RE.test(keyHint)) return '[REDACTED]'
    return value.replace(CURL_JWT_RE, '[REDACTED_JWT]')
  }
  if (Array.isArray(value)) return value.map((item) => redactCurlValue(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactCurlValue(v, k)
    return out
  }
  return value
}

// Maintained browser-header profile so out-of-page requests look like real Chrome.
// Node can set these forbidden headers that in-page fetch cannot. Bump the Chrome rev periodically.
export const chromeHeaderProfile = (): Record<string, string> => {
  const win = process.platform === 'win32'
  const mac = process.platform === 'darwin'
  const platform = win ? '"Windows"' : mac ? '"macOS"' : '"Linux"'
  const uaPlatform = win ? 'Windows NT 10.0; Win64; x64' : mac ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'
  return {
    'User-Agent': `Mozilla/5.0 (${uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36`,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="137", "Not:A-Brand";v="24", "Google Chrome";v="137"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': platform,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  }
}

// Headers the CALLER (i.e. the model, or a stored recipe) may not set. Two reasons, and they stay
// valid out of page: (1) an auth-ish header supplied by the model would shadow the live resolver, so
// a stale recorded token could be replayed; (2) hop-by-hop / identity headers are the host's job.
// NOTE: the HOST legitimately sets cookie/user-agent/referer/origin on the out-of-page path — this
// policy applies only to caller-supplied headers, never to host-assembled ones.
export const isUnsafeExplicitHeader = (header: string): boolean =>
  /^(authorization|cookie|set-cookie|proxy-authorization|host|origin|referer|user-agent|content-length)$/i.test(header) ||
  /(csrf|xsrf|token|secret|credential|session|jwt|bearer|api[-_]?key)/i.test(header)

/**
 * THE artifact key. Writer and reader must both go through this — they did not, and that was a
 * silent-miss bug: ingest wrote under a www-stripped PORTLESS hostname while the executor looked up
 * `url.host` (WITH port). Any `www.` host or non-default port therefore found no `profile.json`,
 * lost its `successRule`, and reported a 200-with-error-envelope as success — the exact false
 * positive decision 6 of `node-only-api-execution.md` exists to prevent.
 *
 * Accepts a bare host, a `host:port`, or a full URL, and always yields the same key for all three.
 * Contract: features/api-learn-to-call.md D3.
 */
export const apiArtifactKey = (hostOrUrl: string): string => {
  let h = String(hostOrUrl || '').trim()
  if (!h) return ''
  if (h.includes('://')) {
    try {
      h = new URL(h).hostname
    } catch {
      /* fall through and treat it as a host string */
    }
  }
  // Drop a port if one survived (`host:port`, but never an IPv6 literal's inner colons).
  if (!h.startsWith('[')) h = h.split(':')[0]
  return h.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '_')
}

/** `<userData>/skills/_api/<key>/` — where ingest persists a domain's execution artifacts. */
export const apiArtifactDir = (hostOrUrl: string): string =>
  `${app.getPath('userData')}/skills/_api/${apiArtifactKey(hostOrUrl)}`
