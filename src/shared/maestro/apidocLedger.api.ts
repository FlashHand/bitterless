// apidoc 账本的 xpc 契约(apidoc-001)。表在 sqlite 窗口的 preload 里,main 经
// createXpcMainEmitter<ApidocLedgerApi>('ApidocDao') 调过来。
//
// 两张表的分工:目录管【找到】,详情管【调用】。设计与理由见
// docs/features/apidoc-ledger.md 与 areas/agent-runtime/cowork/ingest-pipeline.html。

/** 目录行 —— agent 每轮注入的就是这几个字段,不含契约 */
export interface ApidocCatalogRow {
  id: number
  siteId: string
  method: string
  pathTemplate: string
  /** 同 method+path 不同操作时的判别值(网关式接口);无则空串 */
  discriminator: string
  /** LLM 写的语义:动词 + 对象 + 关键字段 */
  summary: string
  role: string
  /**
   * **人工判定的读/写** —— `true` = 会改服务端状态,`false` = 只读,`undefined` = 没人设过。
   *
   * 为什么和 `role` 并存而不是替掉它:`role` 是模型写的(住在 `doc_json` 的 `x-mm` 里),
   * 而 `doc_json` 重摄时**整份覆盖** —— 人工改了存那儿会被静默还原。所以人工值单独成列,
   * 摄取根本不碰,「人工赢」是结构保证的。
   *
   * 读取优先级:`mutatesManual ?? 模型的 x-mm ?? 未知`。**未知不等于只读** ——
   * 写闸把未知当作"需要确认"处理(错标 write 只是多问一次,错标 read 会静默执行)。
   */
  mutatesManual?: boolean
  capability: string
  status: string
  source: string
  seen: number
  firstSeen: number
  lastSeen: number
  versionCode: string
  dirty: number
}

/** 详情 —— 命中一个端点才拉 */
export interface ApidocContractRow {
  endpointId: number
  /** params / req / resp 的完整 schema。**这是字段信息的唯一真身**,不另存倒排 */
  docJson: unknown
  servers: string[]
  authShape: unknown
  updatedAt: number
}

export interface ApidocEndpointWrite {
  siteId: string
  method: string
  pathTemplate: string
  discriminator?: string
  /** 只在有新语义时传;不传则保留库里已有的(COALESCE 语义) */
  summary?: string
  role?: string
  capability?: string
  status?: string
  source?: string
  versionCode?: string
  docJson: unknown
  servers?: string[]
  authShape?: unknown
}

export interface ApidocSiteSummary {
  siteId: string
  endpointCount: number
  updatedAt: number
}

// ── 功能点 ↔ 端点绑定(binding-001)。第三张表,和账本同一个库。
//
// 绑定表指向端点用的是**canonical key**(method + path_template + discriminator),不是
// apidoc_endpoint.id —— 那个自增主键在 removeSite() + 重新摄取之后会换,按它绑等于按行号绑。
// 也因此**没有外键**:CASCADE 会在删站时静默删掉绑定,而绑定断了必须看得见。设计见
// docs/features/function-endpoint-binding.md 与 areas/agent-runtime/cowork/full-auto.html #8。

/** 写一条绑定 —— 端点侧给 canonical key,不给 id */
export interface FunctionEndpointWrite {
  method: string
  pathTemplate: string
  discriminator?: string
  /** 这个端点在这个功能里扮演什么:option-read | write | refresh | … */
  role?: string
  /** auto-traverse | interaction-probe | manual-recording —— 粒度可信度的来源 */
  source?: string
  /** 0..1。模块级推断的低,人工录制的高;upsert 取 MAX,后来的低置信不许把高的压下去 */
  confidence?: number
}

/**
 * 读出来的一条绑定。`endpointMissing` / `endpointSummary` 是 **JOIN 出来的派生值,不落库** ——
 * 落一个 broken 标记就等于给「端点还在不在」存第二副本,它会静默过期(和账本砍倒排表同一条理由)。
 */
export interface FunctionEndpointBinding {
  id: number
  siteId: string
  functionId: string
  method: string
  pathTemplate: string
  discriminator: string
  role: string
  source: string
  confidence: number
  seen: number
  firstSeen: number
  lastSeen: number
  /** true = 这条绑定指向的端点已经不在账本里 —— BROKEN,要显示出来,不许隐藏 */
  endpointMissing: boolean
  /** 命中端点时带上,供面板直接显示,免得再查一遍 */
  endpointId: number | null
  endpointSummary: string
  endpointStatus: string
}

export interface FunctionEndpointApi {
  /** 一个功能点绑 N 个端点,整批一个事务。已存在的 `seen++`、`confidence` 取 MAX */
  bind(params: { siteId: string; functionId: string; endpoints: FunctionEndpointWrite[] }): Promise<{ ok: boolean; written: number }>
  /** 解一条绑定(人工纠错)。**没有按站清空** —— 清空绑定和清空账本必须是两个动作 */
  unbind(params: { siteId: string; functionId: string; method: string; pathTemplate: string; discriminator?: string }): Promise<{ ok: boolean; removed: number }>
  /** 正向:这个功能点绑了哪些端点(含已断的) */
  functionBindings(params: { siteId: string; functionId: string }): Promise<FunctionEndpointBinding[]>
  /** 反向:这个端点被哪些功能点用着 —— N:M 的另一半,「改这个接口会影响谁」靠它 */
  endpointFunctions(params: { siteId: string; method: string; pathTemplate: string; discriminator?: string }): Promise<FunctionEndpointBinding[]>
  /**
   * 一个站的全部绑定,**一次取完**。面板要的不只是每个功能点下面挂什么,还要认出
   * function_id 已经不在当前 sitemap 里的那些(改版后的 orphan)—— 那个差集只能在
   * 拿到全量之后算,一个功能点一次查是算不出来的。
   */
  siteBindings(params: { siteId: string }): Promise<FunctionEndpointBinding[]>
}

export interface ApidocLedgerApi {
  /** 目录:窄投影,不碰 doc_json。status 缺省只取 active */
  catalog(params: { siteId: string; status?: string; role?: string; capability?: string }): Promise<ApidocCatalogRow[]>
  /**
   * 人工设定/清除一个端点的读写判定。`mutates: null` = 清除,回落到模型的判断。
   *
   * 只写 `apidoc_endpoint.mutates_manual` 这一列 —— **刻意不碰 `doc_json`**:
   * 那份在重摄时整份覆盖,写进去等于让下一轮钻探把人的修正抹掉。
   */
  setMutates(params: { siteId: string; method: string; pathTemplate: string; discriminator?: string; mutates: boolean | null }): Promise<{ ok: boolean }>
  /** 详情:按 canonical key 或 endpointId 取一行 */
  contract(params: { siteId?: string; method?: string; pathTemplate?: string; discriminator?: string; endpointId?: number }): Promise<(ApidocCatalogRow & ApidocContractRow) | null>
  /** 跨站清单 —— Workbench 的站点切换器与 integration 家族都要它 */
  sites(): Promise<ApidocSiteSummary[]>
  /**
   * 一个端点一次 upsert,目录与详情在**同一事务**里写。
   * 目录侧 `seen++`、语义 COALESCE;详情侧整份覆盖那一行。
   */
  upsertEndpoint(params: ApidocEndpointWrite): Promise<{ ok: boolean; endpointId: number }>
  /**
   * 批量 upsert,整批一个事务 —— 摄取一次几十个端点走这个。
   *
   * `created` / `createdKeys` = 这一批里**库中原本不存在**的端点(在 upsert 之前点查得到的事实)。
   * 「已存在」由读的人算 `written - created`,**不单独回一个数** —— 三个数里任意两个漂开时,
   * 没人知道该信哪个。`createdKeys` 有上限,它是给摘要列举用的,不是全量导出。
   */
  upsertMany(params: { endpoints: ApidocEndpointWrite[] }): Promise<{ ok: boolean; written: number; created: number; createdKeys: string[] }>
  /**
   * 字段级检索。**故意不建倒排表** —— doc_json 是 TEXT,LIKE 子串全扫在几百端点的规模下
   * 是微秒级,而且天然 CJK 安全(不需要分词)。复议条件见 feature doc。
   */
  searchFields(params: { siteId: string; needle: string; limit?: number }): Promise<ApidocCatalogRow[]>
  /** 删一个站的账本(site-knowledge:删站 = 一条 DELETE) */
  removeSite(params: { siteId: string }): Promise<{ ok: boolean; removed: number }>
  /** 站点级 metadata:读一个站的 auth_desc 等(apidoc-site-auth)。没有该站则 null */
  siteMeta(params: { siteId: string }): Promise<ApidocSiteMeta | null>
  /** 站点级 metadata:UPSERT(site_id 主键 → 覆盖写)。摄取总结出鉴权方案后写这里 */
  upsertSite(params: { siteId: string; authDesc: string; apiBases?: string[] }): Promise<{ ok: boolean }>
  upsertAuthSmoke(params: { siteId: string; smoke: 'pass' | 'fail'; note: string }): Promise<{ ok: boolean }>
}

/** 站点级 apidoc metadata(apidoc-site-auth)。auth_desc = LLM 摄取时总结的鉴权方案(人话,不含凭证值)。 */
export interface ApidocSiteMeta {
  siteId: string
  authDesc: string
  /**
   * 这批端点真正住的 origin(可能多个,第一个是主的)。**页面站 ≠ API 站** —— test-dsh 的页面在
   * `test-dsh-admin.terncloud.com`,39 个端点一个不落全在 `dsh-test.terncloud.com`。
   *
   * 为什么要在站级存一份(Ral 2026-08-14:「endpoint 应该最开始先解析出对方的 endpoint 放到 apidoc
   * 的开头,和鉴权方案应该存到一起可以被取用」):不存的话,裸路径调用只能拿【当前页面地址】兜底,
   * 分离域名的站每一发都打到静态站拿 404 —— 而 404 和"这个端点要参数"在日志里长得一模一样。
   */
  apiBases?: string[]
  /**
   * 鉴权冒烟的结论:`''` 未测 / `'pass'` 调通 / `'fail'` 没调通。
   *
   * 为什么要单独存一个字段(Ral 2026-08-14):`authDesc` 是【文档怎么说】,由 LLM 从流量里总结;
   * 这个是【实际调没调通】,由一发真请求验证。两者可以不一致 —— 而恰恰是不一致的时候最要紧:
   * 文档写得头头是道、真调却 401,这种事只有打一发才知道。API Doc 面板据此显示绿/红 tag。
   */
  authSmoke?: '' | 'pass' | 'fail'
  authSmokeNote?: string
  authSmokeAt?: number
  updatedAt: number
}
