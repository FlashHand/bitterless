export interface SitemapDebugEvent {
  scope: 'sitemap'
  phase: string
  level: 'info' | 'warn' | 'error'
  message: string
  detail?: Record<string, unknown>
  ts: number
}

export interface SitemapServiceDeps {
  /** 日志出口 —— 合并时"上次有这次没有"的告警走这里 */
  onDebug?(e: SitemapDebugEvent): void
}
