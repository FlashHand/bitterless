// 站点地图的【读侧与落盘侧】:<userData>/sites/<siteId>/sitemap.json 的合并、读取、每次探站的总结。
//
// 契约见 docs/features/agent-driven-exploration.md;方案权威 areas/agent-runtime/cowork/full-auto.html。
//
// ⚠ 这里【不再有遍历器】。v1 的 explore()(硬编码走导航菜单)已整体删除 —— Ral 2026-08-10:
// 「探站不符合 agent 判断原则的方案都放弃,一定要 agent 驱动探索」,以及更早的
// 「遍历器出骨架,你怎么保证硬编码能稳定」。诚实的答案是保证不了:它靠四处手写判据
// (深度 / 容器类名 / 动词表 / standalone 名单),而唯一支持它的测量测的是**精确率不是召回率**,
// 所以它找不到的菜单它自己也不知道 —— 20% 召回和 100% 召回产出的产物长得一模一样。
//
// 现在探索由 agent 驱动(见 exploreSession.service.ts),完事调 persistAgentRun 落到同一份
// sitemap.json,所以下面的合并/读取逻辑对新旧产物是同一条路。
import { app } from 'electron'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SiteSitemap,
  SitemapModule,
  SitemapOffsiteExit,
  SitemapRunSummary,
  SitemapSiteSummary,
  SitemapUncovered
} from '@maestro-shared/sitemap.types'
import type { SitemapServiceDeps } from '@maestro-main/sitemap/sitemap.types'


// stats 的两个口径 —— 首次写入和合并后【必须用同一份】,否则合并回来的模块进了 modules 却没进计数,
// 面板上的模块/功能数会比 sitemap.json 里实际有的少。
const countLeaves = (ms: SitemapModule[]): number => ms.reduce((n, m) => n + (m.children?.length ? countLeaves(m.children) : 1), 0)
const countFns = (ms: SitemapModule[]): number => ms.reduce((n, m) => n + (m.functions?.length || 0) + (m.children ? countFns(m.children) : 0), 0)

export class SitemapService {
  constructor(private deps: SitemapServiceDeps) {}

  private log(phase: string, message: string, detail?: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.deps.onDebug?.({ scope: 'sitemap', phase, level, message, detail, ts: Date.now() })
  }

  /** 与上次取【并集】—— 新增的进来,这轮没探到的整棵保留(不降级、不丢),跨轮累积。 */
  private async mergeWithPrevious(dir: string, next: SiteSitemap): Promise<SiteSitemap> {
    let prev: SiteSitemap | null = null
    try {
      prev = JSON.parse(await readFile(join(dir, 'sitemap.json'), 'utf8')) as SiteSitemap
    } catch { return next }
    // 跳出清单也取并集,`seen` 累加 —— 这张表的价值在于跨录制累积:一个只在某个页面出现过
    // 一次的外链,下一轮如果没走到那个页面,不该从"别点"清单里消失。
    for (const old of prev.offsite || []) {
      const hit = next.offsite.find((e) => e.url === old.url && e.kind === old.kind)
      if (hit) hit.seen += old.seen
      else next.offsite.push({ ...old })
    }
    next.stats.offsite = next.offsite.length
    const index = (ms: SitemapModule[], out = new Map<string, SitemapModule>()): Map<string, SitemapModule> => {
      for (const m of ms) { out.set(m.url, m); if (m.children) index(m.children, out) }
      return out
    }
    const nextIdx = index(next.modules)
    const prevIdx = index(prev.modules)
    const gone = [...prevIdx.keys()].filter((u) => !nextIdx.has(u))
    if (gone.length) {
      // 【保留,不降级】。这里以前是把"这轮没探到"的模块塞进 uncovered 当一行墓碑,modules 只留本轮的
      // —— 于是一轮浅钻探(7 个模块)会把上一轮 35 个模块的 children/functions 全部抹掉,而 functions
      // 上挂着功能点把手(fnp_NN),把手一丢,绑定就成了孤儿。更糟的是 prev.uncovered 从不合并,
      // 那批墓碑下一轮连"曾经存在过"都不剩。sitemap 是【累积的站点地图】,不是本轮快照:
      // 没探到 ≠ 不存在(这轮可能只是没走到那儿),所以整棵保留,只标 lastSeenRun,由读的人自己判断新鲜度。
      this.log('merge-kept', `${gone.length} module(s) present last time were not reached this run — kept from the previous sitemap.`, { gone: gone.slice(0, 10) }, 'info')
      const carry = (ms: SitemapModule[]): SitemapModule[] =>
        ms.filter((m) => !nextIdx.has(m.url)).map((m) => ({ ...m, ...(m.children ? { children: carry(m.children) } : {}) }))
      next.modules.push(...carry(prev.modules))
      // 上一轮的 uncovered 也带过来(去重):它记的是"确实打不开/不该开"的页面,这类结论跨轮有效。
      for (const old of prev.uncovered || []) {
        if (!next.uncovered.some((u) => u.url === old.url)) next.uncovered.push({ ...old })
      }
      next.stats.topLevel = next.modules.filter((m) => !m.standalone).length
      next.stats.standalone = next.modules.filter((m) => m.standalone).length
      next.stats.leafModules = countLeaves(next.modules)
      next.stats.functions = countFns(next.modules)
      next.stats.uncovered = next.uncovered.length
    }
    return next
  }

  /**
   * 把 agent 主导探站(v2)的发现落成 sitemap.json —— **v2 自己只写 runs/ 日志**。
   *
   * 没有这一步,v2 探完等于没探:Workbench ▸ Sitemap 面板与 agent 的 `sitemap` 工具读的都是
   * sitemap.json。合并复用 v1 的 `mergeWithPrevious`,所以 v1 与 v2 的产物落在同一处、互相取并集
   * —— 两套引擎不该产出两份互不相认的地图。
   */
  async persistAgentRun(params: {
    siteId: string
    host: string
    modules: SitemapModule[]
    uncovered: SitemapUncovered[]
    offsite: SitemapOffsiteExit[]
    visited: number
  }): Promise<{ sitemapPath: string; stats: SiteSitemap['stats'] }> {
    const sitemap: SiteSitemap = {
      siteId: params.siteId,
      host: params.host,
      exploredAt: new Date().toISOString(),
      modules: params.modules,
      uncovered: params.uncovered,
      offsite: params.offsite,
      stats: {
        topLevel: params.modules.filter((m) => !m.standalone).length,
        standalone: params.modules.filter((m) => m.standalone).length,
        leafModules: countLeaves(params.modules),
        functions: countFns(params.modules),
        visited: params.visited,
        uncovered: params.uncovered.length,
        offsite: params.offsite.length
      }
    }
    const dir = join(app.getPath('userData'), 'sites', params.siteId)
    await mkdir(join(dir, 'runs'), { recursive: true })
    const merged = await this.mergeWithPrevious(dir, sitemap)
    const sitemapPath = join(dir, 'sitemap.json')
    await writeFile(sitemapPath, JSON.stringify(merged, null, 2), 'utf8')
    await writeFile(
      join(dir, 'coverage.json'),
      JSON.stringify({ exploredAt: merged.exploredAt, stats: merged.stats, uncovered: merged.uncovered, offsite: merged.offsite }, null, 2),
      'utf8'
    )
    this.log('agent-run-persisted', `agent exploration merged into ${sitemapPath}`, { stats: merged.stats })
    return { sitemapPath, stats: merged.stats }
  }

  // ── 读侧:Workbench ▸ Sitemap 需要"记录和展示每次探站的总结"(Ral 2026-08-10)。
  //    产物本来就在盘上,这里只提供读取 —— 不另存一份索引。

  private sitesRoot(): string {
    return join(app.getPath('userData'), 'sites')
  }

  async listSites(): Promise<SitemapSiteSummary[]> {
    let ids: string[] = []
    try {
      ids = (await readdir(this.sitesRoot(), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    } catch {
      return []
    }
    const out: SitemapSiteSummary[] = []
    for (const siteId of ids) {
      const map = await this.readSitemap(siteId)
      if (!map) continue
      let runCount = 0
      try {
        // 同上:快照台账和 run journal 同目录,不排掉的话每一轮会被数成两轮。
        runCount = (await readdir(join(this.sitesRoot(), siteId, 'runs'))).filter((f) => f.endsWith('.json') && !f.endsWith('-snapshots.json')).length
      } catch {
        /* 没有 runs 目录就是 0 */
      }
      out.push({ siteId, host: map.host, exploredAt: map.exploredAt, stats: map.stats, runCount })
    }
    return out.sort((a, b) => (a.exploredAt < b.exploredAt ? 1 : -1))
  }

  async readSitemap(siteId: string): Promise<SiteSitemap | null> {
    try {
      const map = JSON.parse(await readFile(join(this.sitesRoot(), siteId, 'sitemap.json'), 'utf8')) as SiteSitemap
      // 旧产物没有 offsite / stats.offsite —— 补默认值,读侧不该因为老文件炸掉
      map.offsite ||= []
      map.stats.offsite ??= map.offsite.length
      return map
    } catch {
      return null
    }
  }

  /** 每次探站的总结(不含 steps —— 那是排查用的,按需另读 runs/<id>.json)。 */
  async listRuns(siteId: string): Promise<SitemapRunSummary[]> {
    let files: string[] = []
    try {
      // 排掉 `<stamp>-snapshots.json`(2026-08-14 加的快照台账,和 run journal 同目录)。
      // 降序排时 `-snapshots` 恰好落在同一轮的 `-agent` 【前面】,于是每一轮占两个位:listRuns 会多出
      // 一半读不出内容的空条目(listRuns 里每一轮会显示成两条)。
      // 排除法而不是 `endsWith('-agent.json')` —— 那样会把 v1 那三个没有后缀的老 run 也一起丢掉。
      files = (await readdir(join(this.sitesRoot(), siteId, 'runs'))).filter((f) => f.endsWith('.json') && !f.endsWith('-snapshots.json')).sort().reverse()
    } catch {
      return []
    }
    const out: SitemapRunSummary[] = []
    for (const f of files) {
      try {
        const r = JSON.parse(await readFile(join(this.sitesRoot(), siteId, 'runs', f), 'utf8')) as SitemapRunSummary & { steps?: unknown[] }
        out.push({
          runId: r.runId || f.replace(/\.json$/, ''),
          startedAt: r.startedAt,
          durationMs: r.durationMs,
          stats: r.stats,
          request: r.request,
          partial: r.partial,
          stalled: r.stalled,
          returnedToSite: r.returnedToSite,
          stepCount: r.stepCount ?? r.steps?.length ?? 0
        })
      } catch {
        /* 单个坏文件不该让整张列表读不出来 */
      }
    }
    return out
  }
}
