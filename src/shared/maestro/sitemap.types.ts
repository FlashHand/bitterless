// 站点功能地图。产出形状的权威是 areas/agent-runtime/cowork/full-auto.html #6;
// 本仓契约见 docs/features/site-explore-sitemap.md。
//
// ⚠ 功能点的身份不再由 function_id 计算(full-auto.html **PQ-8 已否决**,Ral 2026-08-10
// 「放弃 function_id,先从语义着手」)。现在的契约是 docs/features/function-identity-semantic.md:
// 身份 = 一次性铸造的**不透明把手** `handle`,连续性由 agent 在重新探索时【认领】。
// 下面的 sitemapFunctionId() 仅为读老产物保留,新代码不要再用它当键。

/**
 * function_id 的算法版本。**换算法就换这个前缀**:旧绑定不会静默错配到新功能点上,
 * 而是整批变成 orphaned(Workbench 里看得见)—— 这正是 PQ-8 要的「能看出是断了而不是丢了」。
 */
export const SITEMAP_FUNCTION_ID_VERSION = 'fn1'

/** id 的一段:NFKC → 去分隔符 → 空白压一个 → 小写。`|` 是字段分隔符,内容里不许出现。 */
const idPart = (raw?: string): string =>
  (raw || '')
    .normalize('NFKC')
    .replace(/\|/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

/**
 * 模块的路由键 —— 只留 pathname + hash 路由,**丢掉 protocol / host / port / query**。
 * 站点已经由 site_id 分域,所以 http→https、换端口、staging→prod 不该把绑定弄断;
 * query 是状态不是身份(`?tab=2` 指的仍是同一个模块)。
 *
 * `?` 必须在**拼完 hash 之后**再砍:hash 路由的 query 挂在 fragment 里
 * (`/#/customer/list?tab=2` 的 `u.search` 是空的),只看 `u.search` 会漏掉它。
 */
const routeKeyOf = (moduleUrl: string): string => {
  let route = moduleUrl || ''
  try {
    const u = new URL(moduleUrl)
    route = `${u.pathname}${u.hash}`
  } catch {
    // 不是绝对 URL(record() 里已经 normalize 过,理论上到不了这里)—— 原样当路由用
  }
  return idPart(route.split('?')[0]).replace(/\/+$/, '') || '/'
}

/**
 * 功能点的稳定 id:`fn1|<路由键>|<verb>|<object>|<控件名>`。
 *
 * 四个输入全是**内容**,没有一个是位置(不含控件下标、DOM 顺序、数组序号)——
 * 所以同一个站重新探一次、菜单顺序变了、页面多了个按钮,id 都不变。
 *
 * **刻意不做 hash**:绑定断掉时,人要在面板上认出「断的是哪个功能」。`fn1|/#/customer/list|
 * create|客户|新增客户` 自己就说清楚了,`fn_9a3f21…` 什么都不说。附带好处是 renderer 里
 * 不需要 crypto(它是浏览器上下文,node:crypto 不可用),三个进程共用同一段纯字符串逻辑。
 *
 * 带控件名(而不是只有「路径+动宾」)是为了**堵掉静默合并**:同一个模块里两个同动词的按钮
 * (「新增客户」「新增标签」,object 都退化成模块名)在只有动宾时会撞成一个 id,两个功能的绑定
 * 悄悄混在一起 —— 那比断掉更糟。断掉是看得见的,混掉不是。
 */
/**
 * @deprecated **不要再用它当身份。** PQ-8 否决:一条词法键分不清"改了名"和"换了功能",
 * 两种失败都不自我暴露(撞键静默合并、失配静默变空)。保留它只为一件事 —— 2026-08-10 那天
 * v2 写下过 `fn1|…` 的产物,读到时把那个串原样当 handle 收编,不做迁移。
 */
export const sitemapFunctionId = (params: { moduleUrl: string; verb?: string; object?: string; name: string }): string =>
  [
    SITEMAP_FUNCTION_ID_VERSION,
    routeKeyOf(params.moduleUrl),
    idPart(params.verb) || 'action',
    idPart(params.object),
    idPart(params.name)
  ].join('|')

/** 一个功能点 = 动词 + 对象。粒度决定见 feature doc 决定 7。 */
export interface SitemapFunction {
  /**
   * **功能点的身份**(docs/features/function-identity-semantic.md 决定 1)。
   *
   * 不透明:`fnp_31`。**不含路由 / 动宾 / 控件名 / 位置** —— 含任何内容,内容一变身份就变,
   * 那正是 PQ-8 被否掉的病。它一次铸造、跨 run 持久,绑定指向它,所以站点改个文案不断绑定。
   *
   * 它不需要"能被算出来",只需要"能被认出来":连续性由 agent 在下一次探索时认领
   * (决定 2),main 只提供候选与机械预标,不替它决定。
   */
  handle?: string
  /**
   * @deprecated PQ-8 否决的计算键。只可能出现在 2026-08-10 那天写下的产物里,
   * 读到时原样收编为 handle(决定 8)。新记录一律不写它。
   */
  functionId?: string
  /** create | update | delete | export | view | approve | … 由控件名推断 */
  verb: string
  /** 动作的对象,取自所在模块名(「客户列表」→「客户」) */
  object: string
  /** 人读的名字,直接用控件的 accessible name */
  name: string
  /**
   * 上一次它叫什么 —— 只有 agent 认领时【报告了改名】才有(决定 4/5)。
   * 面板靠它显示「上次叫 X」,而这正是**错误合并唯一会被人抓到的地方**,所以它落在产物里,
   * 不只落在 run journal 里:journal 会被翻页淹掉,产物不会。
   */
  renamedFrom?: string
  /** 改名认领时 agent 给的理由。与 renamedFrom 同生共死。 */
  renamedWhy?: string
  /** 触发它的控件 —— 回头人工录制时靠这个找到入口 */
  control: { role: string; name: string }
  /** 表格行内重复出现的操作(每行一个「编辑」)归一为一条,标记它是行级的 */
  rowLevel?: boolean
  /** observed = 只看到控件;exercised = 已录过、有 apidoc/技能 */
  status: 'observed' | 'exercised'
}

export interface SitemapModule {
  name: string
  /** 1 = 一级模块。standalone 也放 1 级(feature doc 决定 4) */
  level: number
  /** 归一化后的 URL,同时是去重键 */
  url: string
  /** 不挂在主菜单树上的独立入口(登录 / 改密 / 个人中心) */
  standalone?: boolean
  /** standalone 是从哪找到的,方便人复核 */
  foundAt?: string
  children?: SitemapModule[]
  functions?: SitemapFunction[]
}

/** 没走到的节点 —— G1 要求显式,不许静默缺失 */
export interface SitemapUncovered {
  name: string
  url: string
  reason: 'page-budget' | 'depth-cap' | 'nav-failed' | 'no-href' | 'timeout' | 'error' | 'offsite-redirect' | 'nav-timeout'
  detail?: string
}

/**
 * 一个【跳出站外】的入口。这是 issue explore-site-wanders-offsite-and-stalls 的产物:
 * 遍历不进它,只把它点名记下来 ——「后续别点」(Ral 2026-08-10)。跨录制累积,`seen` 递增。
 */
export interface SitemapOffsiteExit {
  /** 锚点/入口的可读名字 */
  name: string
  /** 目标 URL(已去 query) */
  url: string
  /** 目标 host —— 与站点 host 不同才会进这张表 */
  host: string
  /** 在哪个页面上发现的 */
  foundOn: string
  /**
   * link     = 菜单/页面里的锚点直接指向外站,遍历【没有进去】
   * redirect = URL 本身同站,但打开后被跳到了外站,遍历【进去了又退回来】
   */
  kind: 'link' | 'redirect'
  seen: number
}

export interface SiteSitemap {
  siteId: string
  host: string
  exploredAt: string
  /** 以哪个账号探的 —— 菜单随权限变,这条决定两次结果可不可比 */
  account?: string
  modules: SitemapModule[]
  uncovered: SitemapUncovered[]
  /** 跳出站外的入口清单 —— 遍历不进,人也别点 */
  offsite: SitemapOffsiteExit[]
  stats: {
    topLevel: number
    standalone: number
    leafModules: number
    functions: number
    visited: number
    uncovered: number
    offsite: number
  }
}

/** run journal 的一行 —— 每个访问过的节点都留一条,失败的也留 */
export interface SitemapRunStep {
  seq: number
  at: string
  url: string
  name?: string
  action: 'nav' | 'extract' | 'skip' | 'fail'
  ms?: number
  navLinks?: number
  functions?: number
  note?: string
}

export interface ExploreResult {
  ok: boolean
  siteId?: string
  host?: string
  /** 摘要文本 —— 给 agent 看的,全树在文件里 */
  message: string
  error?: string
  sitemapPath?: string
  runPath?: string
  stats?: SiteSitemap['stats']
  /** record:true 时带上 apidoc 那一半的结果 */
  apiDoc?: { ok: boolean; endpointCount: number; message: string }
  // ── 以下是 agent 需要感知的状态(issue explore-site-wanders-offsite-and-stalls)
  /** 本次发现的跳出入口。agent 要在总结里点名它们,并知道后续别点 */
  offsite?: SitemapOffsiteExit[]
  /** 因为被跳到外站而【退回本站】了几次 */
  returnedToSite?: number
  /** 有节点耗时超过停滞阈值 —— 通常就是跳出去了或者对方站很慢 */
  stalled?: boolean
  /** 预算/超时导致没走完:sitemap 是部分结果,可以再跑一次补 */
  partial?: boolean
  /** 部分结果时给 agent 的续跑指引(它自己看得懂的下一步) */
  resumeHint?: string
  /** 固有任务的 id —— background 模式下这是唯一的返回值,用 task_output 读进度 */
  taskId?: string
}

/** Workbench ▸ Sitemap 的站点行 */
export interface SitemapSiteSummary {
  siteId: string
  host: string
  exploredAt: string
  stats: SiteSitemap['stats']
  runCount: number
}

/** 一次探站的总结(runs/<ts>.json 的头部) */
export interface SitemapRunSummary {
  runId: string
  startedAt: string
  durationMs: number
  stats: SiteSitemap['stats']
  request?: ExploreSiteRequest
  partial?: boolean
  stalled?: boolean
  returnedToSite?: number
  stepCount: number
}

export interface ExploreSiteRequest {
  /** 从哪进站,默认当前 tab */
  startUrl?: string
  /** 页面预算,触顶写进 uncovered 而不是静默停 */
  maxPages?: number
  /** 模块层数硬顶 */
  maxDepth?: number
  /** 遍历期间开录制,结束后跑 ingest 生成 apidoc */
  record?: boolean
  /** 每个页面之间的节流(毫秒)—— 别把人家后台打成 DDoS */
  throttleMs?: number
  /**
   * 后台跑:立刻返回 `taskId`,遍历继续在后台推进(docs/features/cowork-tasks.md 决定 7)。
   * 默认 false —— 改默认值会静默改掉所有现有调用方的语义。agent 想在遍历【进行中】看进度、
   * 发现卡死,就得用这个:同步调用期间它拿不到任何中间状态。
   */
  background?: boolean
}
