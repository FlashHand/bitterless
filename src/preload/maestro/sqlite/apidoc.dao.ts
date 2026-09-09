import { XpcPreloadHandler } from 'electron-xpc/preload'
import type {
  ApidocCatalogRow,
  ApidocContractRow,
  ApidocEndpointWrite,
  ApidocLedgerApi,
  ApidocSiteSummary,
  ApidocSiteMeta
} from '@maestro-shared/apidocLedger.api'
import { sqliteManager } from './sqliteManager'

// apidoc 账本的 DAO(apidoc-001)。两张表:apidoc_endpoint(目录)+ apidoc_contract(详情)。
//
// 三条口径,改这个文件前先读:
//   ① doc_json 是字段信息的【唯一真身】—— 没有倒排表,字段检索靠 LIKE 全扫
//   ② 目录的 summary/capability 是 LLM 写的,upsert 时用 COALESCE 保留已有值 ——
//      结构 merge 不该把语义冲掉
//   ③ 目录与详情必须在【同一事务】里写,否则会出现有目录没契约的行

interface EndpointRow {
  id: number
  site_id: string
  method: string
  path_template: string
  discriminator: string
  summary: string
  role: string
  capability: string
  status: string
  source: string
  seen: number
  first_seen: number
  last_seen: number
  version_code: string
  dirty: number
  mutates_manual?: number | null
}

interface ContractRow {
  endpoint_id: number
  doc_json: string
  servers: string
  auth_shape: string
  updated_at: number
}

const CATALOG_COLS =
  'id, site_id, method, path_template, discriminator, summary, role, capability, status, source, seen, first_seen, last_seen, version_code, dirty, mutates_manual'

const toCatalog = (r: EndpointRow): ApidocCatalogRow => ({
  id: r.id,
  siteId: r.site_id,
  method: r.method,
  pathTemplate: r.path_template,
  discriminator: r.discriminator,
  summary: r.summary,
  role: r.role,
  capability: r.capability,
  status: r.status,
  source: r.source,
  seen: r.seen,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  versionCode: r.version_code,
  dirty: r.dirty,
  // 人工判定:1/0/未设。**读取优先级高于模型的 x-mm** —— 见建表处的注释。
  mutatesManual: r.mutates_manual === null || r.mutates_manual === undefined ? undefined : r.mutates_manual === 1,
})

const parse = (raw: string, fallback: unknown = null): unknown => {
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

export class ApidocDao extends XpcPreloadHandler implements ApidocLedgerApi {
  /** 目录:窄投影。**不 SELECT doc_json** —— 那是这张表分出来的全部意义。 */
  async catalog(params: { siteId: string; status?: string; role?: string; capability?: string }): Promise<ApidocCatalogRow[]> {
    const where = ['site_id = ?']
    const args: unknown[] = [params.siteId]
    where.push('status = ?')
    args.push(params.status || 'active')
    if (params.role) { where.push('role = ?'); args.push(params.role) }
    if (params.capability) { where.push('capability = ?'); args.push(params.capability) }
    const rows = sqliteManager.db
      .prepare(`SELECT ${CATALOG_COLS} FROM apidoc_endpoint WHERE ${where.join(' AND ')} ORDER BY path_template, method`)
      .all(...args) as EndpointRow[]
    return rows.map(toCatalog)
  }

  /**
   * 人工设定/清除读写判定(Ral 2026-08-17:「read 和 write 应该是可修改的」)。
   *
   * **只 UPDATE mutates_manual 这一列。** 刻意不碰 doc_json —— 那份在重摄时整份覆盖
   * (upsert 里的 doc_json = excluded.doc_json),把人的修正写进去等于让下一轮钻探静默抹掉它。
   * 这一列不在摄取的写入路径上,所以「人工赢」是结构保证的,不依赖谁记得加 COALESCE。
   *
   * mutates: null = 清除,回落到模型的判断。
   */
  async setMutates(params: { siteId: string; method: string; pathTemplate: string; discriminator?: string; mutates: boolean | null }): Promise<{ ok: boolean }> {
    const info = sqliteManager.db
      .prepare(
        'UPDATE apidoc_endpoint SET mutates_manual = ? WHERE site_id = ? AND method = ? AND path_template = ? AND discriminator = ?'
      )
      .run(
        params.mutates === null ? null : params.mutates ? 1 : 0,
        params.siteId,
        params.method.toUpperCase(),
        params.pathTemplate,
        params.discriminator || ''
      )
    return { ok: info.changes > 0 }
  }

  async contract(params: {
    siteId?: string
    method?: string
    pathTemplate?: string
    discriminator?: string
    endpointId?: number
  }): Promise<(ApidocCatalogRow & ApidocContractRow) | null> {
    let row: (EndpointRow & ContractRow) | undefined
    if (params.endpointId) {
      row = sqliteManager.db
        .prepare(`SELECT e.${CATALOG_COLS.split(', ').join(', e.')}, c.doc_json, c.servers, c.auth_shape, c.updated_at
                  FROM apidoc_endpoint e JOIN apidoc_contract c ON c.endpoint_id = e.id WHERE e.id = ?`)
        .get(params.endpointId) as (EndpointRow & ContractRow) | undefined
    } else {
      row = sqliteManager.db
        .prepare(`SELECT e.${CATALOG_COLS.split(', ').join(', e.')}, c.doc_json, c.servers, c.auth_shape, c.updated_at
                  FROM apidoc_endpoint e JOIN apidoc_contract c ON c.endpoint_id = e.id
                  WHERE e.site_id = ? AND e.method = ? AND e.path_template = ? AND e.discriminator = ?`)
        .get(params.siteId, (params.method || '').toUpperCase(), params.pathTemplate, params.discriminator || '') as
        | (EndpointRow & ContractRow)
        | undefined
    }
    if (!row) return null
    return {
      ...toCatalog(row),
      endpointId: row.id,
      docJson: parse(row.doc_json, {}),
      servers: (parse(row.servers, []) as string[]) || [],
      authShape: parse(row.auth_shape, null),
      updatedAt: row.updated_at
    }
  }

  async sites(): Promise<ApidocSiteSummary[]> {
    const rows = sqliteManager.db
      .prepare(`SELECT e.site_id as siteId, COUNT(*) as endpointCount, MAX(COALESCE(c.updated_at, e.last_seen)) as updatedAt
                FROM apidoc_endpoint e LEFT JOIN apidoc_contract c ON c.endpoint_id = e.id
                WHERE e.status = 'active' GROUP BY e.site_id ORDER BY updatedAt DESC`)
      .all() as ApidocSiteSummary[]
    return rows
  }

  async upsertEndpoint(params: ApidocEndpointWrite): Promise<{ ok: boolean; endpointId: number }> {
    const r = this.writeMany([params])
    return { ok: r.written > 0, endpointId: r.lastId }
  }

  async upsertMany(params: { endpoints: ApidocEndpointWrite[] }): Promise<{ ok: boolean; written: number; created: number; createdKeys: string[] }> {
    const r = this.writeMany(params.endpoints || [])
    // `updated` 不回 —— 读的人自己算 `written - created`。存第三个数就有第三份真相,
    // 而三个数里任意两个漂开时,没人知道该信哪个。
    return { ok: true, written: r.written, created: r.created, createdKeys: r.createdKeys }
  }

  /**
   * 目录 + 详情一个事务。整批也是一个事务 —— 摄取一次几十个端点,中途失败不该留半份账本。
   *
   * 语义保护:`summary` / `role` / `capability` 用 `COALESCE(NULLIF(?, ''), 现值)` ——
   * 传空串等于"这次没有新语义",保留库里 LLM 上次写的,而不是冲成空。
   */
  private writeMany(list: ApidocEndpointWrite[]): { written: number; lastId: number; created: number; createdKeys: string[] } {
    const db = sqliteManager.db
    const now = Date.now()
    const upEp = db.prepare(
      `INSERT INTO apidoc_endpoint
         (site_id, method, path_template, discriminator, summary, role, capability, status, source,
          seen, first_seen, last_seen, version_code, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)
       ON CONFLICT (site_id, method, path_template, discriminator) DO UPDATE SET
         summary      = COALESCE(NULLIF(excluded.summary, ''), apidoc_endpoint.summary),
         -- 【只升不降】(Ral 2026-08-17 确认「端点维度算一次」的落地形态)。
         --
         -- 问题:摄取是【按窗口】跑的,每一窗只含那一段录到的调用。同一个端点在不同窗口拿到
         -- 不同的证据样本,模型于是给出不同结论,而最新的那个无条件覆盖上一个 ——
         -- 实测表现就是 68read/5write 变成 69read/4write,接口一个没少,判定自己翻了面。
         --
         -- 判据:**观察到会改状态是正面证据;在一份偏样本里没观察到,不是"不会改"的证据。**
         -- 所以 write 粘住,read 可以被升级成 write,反过来不行。
         --
         -- 只升不降本身是个棘轮,单独用会把一次误判永久钉死 —— 它成立的前提是
         -- **人工覆盖(mutates_manual)已经存在**,人随时能把它改回来。两者要一起看。
         role         = CASE
                          WHEN excluded.role = 'write' THEN 'write'
                          WHEN apidoc_endpoint.role = 'write' THEN 'write'
                          ELSE COALESCE(NULLIF(excluded.role, ''), apidoc_endpoint.role)
                        END,
         capability   = COALESCE(NULLIF(excluded.capability, ''), apidoc_endpoint.capability),
         source       = COALESCE(NULLIF(excluded.source, ''), apidoc_endpoint.source),
         version_code = COALESCE(NULLIF(excluded.version_code, ''), apidoc_endpoint.version_code),
         seen         = apidoc_endpoint.seen + 1,
         last_seen    = excluded.last_seen`
    )
    const findId = db.prepare(
      `SELECT id FROM apidoc_endpoint WHERE site_id = ? AND method = ? AND path_template = ? AND discriminator = ?`
    )
    const upContract = db.prepare(
      `INSERT INTO apidoc_contract (endpoint_id, doc_json, servers, auth_shape, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint_id) DO UPDATE SET
         doc_json = excluded.doc_json, servers = excluded.servers,
         auth_shape = excluded.auth_shape, updated_at = excluded.updated_at`
    )

    let written = 0
    let lastId = 0
    let created = 0
    const createdKeys: string[] = []
    const tx = db.transaction((items: ApidocEndpointWrite[]) => {
      for (const e of items) {
        const method = (e.method || '').toUpperCase()
        const disc = e.discriminator || ''
        if (!e.siteId || !method || !e.pathTemplate) continue
        // **先查后写** —— 「这一轮新增了几个接口」只能在 upsert 之前问(Ral 2026-08-17)。
        // `findId` 这条 prepared statement 本来就有,只是原来用在 upsert **之后**(为了拿 id 写 contract);
        // 往前再用一次就得到新旧判定,代价是同一事务里多一次按唯一索引的点查,整批几十条可忽略。
        const before = findId.get(e.siteId, method, e.pathTemplate, disc) as { id: number } | undefined
        upEp.run(
          e.siteId, method, e.pathTemplate, disc,
          e.summary || '', e.role || '', e.capability || '',
          e.status || 'active', e.source || '',
          now, now, e.versionCode || ''
        )
        const row = before ?? (findId.get(e.siteId, method, e.pathTemplate, disc) as { id: number } | undefined)
        if (!row) continue
        lastId = row.id
        upContract.run(row.id, JSON.stringify(e.docJson ?? {}), JSON.stringify(e.servers ?? []), e.authShape ? JSON.stringify(e.authShape) : '', now)
        written++
        if (!before) {
          created++
          // 有上限:这个清单是给收尾摘要列「新增了哪些」用的,不是全量导出。
          if (createdKeys.length < 40) createdKeys.push(`${method} ${e.pathTemplate}`)
        }
      }
    })
    tx(list)
    return { written, lastId, created, createdKeys }
  }

  /**
   * 字段级检索,LIKE 子串扫 doc_json。**没有倒排表是刻意的** ——
   * 几百端点 × 几 KB 契约 = 一两兆全扫,微秒级;而且 LIKE 天然 CJK 安全,不用分词。
   */
  async searchFields(params: { siteId: string; needle: string; limit?: number }): Promise<ApidocCatalogRow[]> {
    const needle = (params.needle || '').trim()
    if (!needle) return []
    const rows = sqliteManager.db
      .prepare(`SELECT e.${CATALOG_COLS.split(', ').join(', e.')}
                FROM apidoc_endpoint e JOIN apidoc_contract c ON c.endpoint_id = e.id
                WHERE e.site_id = ? AND e.status = 'active' AND c.doc_json LIKE ? ESCAPE '\\'
                ORDER BY e.path_template LIMIT ?`)
      .all(params.siteId, `%${needle.replace(/[\\%_]/g, '\\$&')}%`, params.limit || 50) as EndpointRow[]
    return rows.map(toCatalog)
  }

  /** 删站:contract 有 ON DELETE CASCADE,所以删目录行就够 —— 但外键要开才生效,这里显式两条。 */
  async removeSite(params: { siteId: string }): Promise<{ ok: boolean; removed: number }> {
    const db = sqliteManager.db
    let removed = 0
    const tx = db.transaction((siteId: string) => {
      db.prepare(
        `DELETE FROM apidoc_contract WHERE endpoint_id IN (SELECT id FROM apidoc_endpoint WHERE site_id = ?)`
      ).run(siteId)
      removed = db.prepare('DELETE FROM apidoc_endpoint WHERE site_id = ?').run(siteId).changes
      // 站点级 metadata 一并删 —— 删站就是整站清掉,别留一条孤立的 auth_desc。
      db.prepare('DELETE FROM apidoc_site WHERE site_id = ?').run(siteId)
    })
    tx(params.siteId)
    return { ok: true, removed }
  }

  /** 站点级 metadata:读一个站的 auth_desc(apidoc-site-auth)。没有该站则 null。 */
  async siteMeta(params: { siteId: string }): Promise<ApidocSiteMeta | null> {
    const row = sqliteManager.db
      .prepare('SELECT site_id, auth_desc, api_base, auth_smoke, auth_smoke_note, auth_smoke_at, updated_at FROM apidoc_site WHERE site_id = ?')
      .get(params.siteId) as { site_id: string; auth_desc: string; api_base: string; auth_smoke: string; auth_smoke_note: string; auth_smoke_at: number; updated_at: number } | undefined
    return row
      ? {
          siteId: row.site_id,
          authDesc: row.auth_desc || '',
          apiBases: (row.api_base || '').split('\n').filter(Boolean),
          authSmoke: (row.auth_smoke || '') as '' | 'pass' | 'fail',
          authSmokeNote: row.auth_smoke_note || '',
          authSmokeAt: row.auth_smoke_at || 0,
          updatedAt: row.updated_at || 0
        }
      : null
  }

  /** 站点级 metadata:UPSERT。site_id 主键 → 覆盖写(再摄取一次直接盖旧值)。 */
  async upsertSite(params: { siteId: string; authDesc: string; apiBases?: string[] }): Promise<{ ok: boolean }> {
    if (!params.siteId) return { ok: false }
    // 只覆盖 auth_desc —— 冒烟结论走 upsertAuthSmoke 单独写,不能被一次重新摄取顺手抹掉。
    sqliteManager.db
      .prepare(
        `INSERT INTO apidoc_site (site_id, auth_desc, api_base, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (site_id) DO UPDATE SET
           auth_desc = excluded.auth_desc,
           -- api_base 只在这次真的算出来了才覆盖:一次没带 base 的重摄不该把已知的 origin 抹掉。
           api_base = CASE WHEN excluded.api_base != '' THEN excluded.api_base ELSE apidoc_site.api_base END,
           updated_at = excluded.updated_at`
      )
      .run(params.siteId, params.authDesc || '', (params.apiBases || []).join('\n'), Date.now())
    return { ok: true }
  }

  /** 鉴权冒烟结论:单独写,和 auth_desc 互不覆盖(一个是"文档怎么说",一个是"实际调没调通")。 */
  async upsertAuthSmoke(params: { siteId: string; smoke: 'pass' | 'fail'; note: string }): Promise<{ ok: boolean }> {
    if (!params.siteId) return { ok: false }
    sqliteManager.db
      .prepare(
        `INSERT INTO apidoc_site (site_id, auth_smoke, auth_smoke_note, auth_smoke_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (site_id) DO UPDATE SET auth_smoke = excluded.auth_smoke, auth_smoke_note = excluded.auth_smoke_note, auth_smoke_at = excluded.auth_smoke_at, updated_at = excluded.updated_at`
      )
      .run(params.siteId, params.smoke, params.note || '', Date.now(), Date.now())
    return { ok: true }
  }
}

export const apidocDao = new ApidocDao()
