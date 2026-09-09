export interface StorageSnapshot {
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  cookies: Record<string, string>
}

/** Captured headers are `Record<string, string | string[]>` (a header may legally repeat). */
export interface AuthLearnExchange {
  url: string
  headers?: Record<string, string | string[]>
}
