/**
 * 取页目的地策略 —— `web_fetch` 与 `deep_fetch` **共用同一个判据**。
 *
 * 为什么必须共用:两个工具的 URL 都来自模型,而模型的输入可能被网页正文注入。一份判据、
 * 两处执法(加载前 + 每一跳重定向),比两份"差不多"的检查可靠。
 * 设计见 docs/features/agent-web-fetch.md `#3` 闸门 4。
 */

export class FetchPolicyError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message)
  }
}

/**
 * 私网 / 环回 / 链路本地 / 云元数据。
 *
 * 这条不是理论风险:本应用自己就在 loopback 上跑东西 —— mini-app 的进程内 static server、
 * 以及 LLM 登录用的两个 OAuth 回调服务。让模型能 `deep_fetch('http://127.0.0.1:<port>/…')`
 * 等于把这些内部端点交给它(以及交给任何能注入它的网页)。
 */
const isBlockedHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  // IPv6 环回与未指定地址
  if (h === '::1' || h === '::' || h === '0:0:0:0:0:0:0:1') return true
  // IPv6 唯一本地 (fc00::/7) 与链路本地 (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if ([a, Number(v4[2]), Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true
  if (a === 0 || a === 10 || a === 127) return true // 未指定 / 私网 A / 环回
  if (a === 169 && b === 254) return true // 链路本地 —— 含 169.254.169.254 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true // 私网 B
  if (a === 192 && b === 168) return true // 私网 C
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // 组播 / 保留
  return false
}

/**
 * 唯一的目的地闸门。抛 `FetchPolicyError`,由调用方翻译成模型可读文本。
 *
 * 只允许 `http:` / `https:` —— 显式拒绝 `file:`(读本地磁盘)、`javascript:`、`data:`、`blob:`、
 * `about:`,以及本应用自己的 `micromeet://` scheme(那会把 mini-app 面交给模型)。
 */
export const assertFetchableUrl = (raw: string): URL => {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) throw new FetchPolicyError('empty', 'no url given')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // 不做 https:// 补全 —— 相对/裸域名一律让调用方给全,免得把 "foo/bar" 猜成一个真实主机。
    throw new FetchPolicyError('not-absolute', `not an absolute URL with a scheme: "${trimmed.slice(0, 120)}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchPolicyError('scheme', `only http/https can be fetched, got "${url.protocol}"`)
  }
  if (!url.hostname) throw new FetchPolicyError('no-host', 'the URL has no host')
  if (isBlockedHost(url.hostname)) {
    throw new FetchPolicyError('private-host', `refusing a private, loopback or link-local address: ${url.hostname}`)
  }
  if (url.username || url.password) {
    // URL 里内嵌凭据 = 一条把凭据塞进请求的路,同时也是钓鱼形态(https://real.com@evil.com)
    throw new FetchPolicyError('embedded-credentials', 'refusing a URL with embedded credentials')
  }
  return url
}

/** 日志/回执里只留 origin + path —— query 里常带签名与 token(与 downloadGuard 的 narrowUrl 同口径)。 */
export const narrowForLog = (raw: string): string => {
  try {
    const u = new URL(raw)
    /**
     * `origin` 对 `file:` / `data:` 这类**不透明来源**是字符串 `"null"`,直接拼会得到
     * `null/etc/passwd` 这种东西 —— 在日志里既看不出 scheme,又像是个 bug。
     * 而被策略拒掉的 URL 恰恰经常是这几种 scheme,也就是最需要看清的那些。
     */
    const base = u.origin && u.origin !== 'null' ? u.origin : `${u.protocol}//${u.host}`
    return `${base}${u.pathname}`
  } catch {
    return '(unparseable url)'
  }
}
