// 页内提取脚本。序列化后经 Runtime.evaluate 注进页面执行,所以必须【自包含】——
// 不能引用外层作用域的任何东西。
//
// ⚠ 这个文件现在【只枚举,不判断】(agent-driven-exploration.md 决定 6 / 决定 7 降级)。
//
// 它曾经有四处硬编码判据:菜单容器类名嗅探(menu|nav|sider)、"不在菜单里的锚点直接丢"、
// 动词表决定什么算功能点、行级操作按出现次数猜。四处全部删除 —— 不是降级成提示,是删掉。
// 理由有两层:
//   ① Ral 2026-08-10:「探站不符合 agent 判断原则的方案都放弃,一定要 agent 驱动探索」。
//      把"猜出来的导航"写进给模型的证据里,本身就是硬编码判断偷偷回到判断路径上。
//   ② 那些判据的错误【不会自我暴露】。旧的锚点过滤器会静默丢掉不在菜单容器里的入口,
//      而唯一支持它的测量(2026-08-07,15/15)测的是**精确率不是召回率** —— 它找不到的东西,
//      它自己也不知道找不到。20% 召回和 100% 召回产出的产物长得一模一样。
//
// 现在的分工:**结构由计算态无障碍快照(page_snapshot)提供** —— 实测它连 `/url:` 都带,
// 一级+二级导航连 URL 全在里面(所以此前"a11y 有 ref 没 href、必须再配一遍锚点枚举"的说法是错的)。
// 本文件只剩一件快照做不了的事:把**每一个** a[href] 完整枚举出来,包括快照因为没有可读名称
// 而剪掉的那些 —— 作为一份便宜的第二意见,用来量召回,不用来下判断。
//
// 为什么不用站点自己的 ARIA:实测 2026-08-07 与 2026-08-10 两次于 test-dsh-admin.terncloud.com
// (Arco + Vue)—— 全站 role 只有 switch/progressbar/button,`<nav>` 计数 0,aria-label 共 4 个。
// Arco / Element / Ant-Design-Vue 这类国内后台框架普遍不上 ARIA。能用的是**计算态**快照,不是站点 ARIA。

export interface ExtractedNavLink {
  name: string
  href: string
  /** DOM 深度。纯事实,不是"一级菜单更浅"那种推断 —— 深浅怎么解读交给 agent。 */
  depth: number
}

export interface ExtractedControl {
  role: string
  name: string
  /** 是否落在 tr / 表格行 / 列表项里 —— 纯 DOM 事实,不是"出现超过 2 次就是行操作"的猜测。 */
  inRow: boolean
}

export interface NavExtractResult {
  url: string
  title: string
  links: ExtractedNavLink[]
  controls: ExtractedControl[]
  /**
   * 枚举总数与上限。**不许静默截断** —— 只报 links.length 会让"页面就 40 个锚点"和
   * "有 400 个但我们只给了 40 个"看起来一样。
   */
  totals: { anchors: number; anchorsKept: number; controls: number; controlsKept: number; capped: boolean }
  /**
   * 诊断:回答"为什么什么都没提到"。站点 ARIA 的两个计数留着,是为了持续复核上面那条实测结论。
   * `tableRows`/`grids` 是【纯 DOM 事实】的列表页判据(structure-first per-page):有表格/网格或多行 = 列表页,
   * 需要点开一条记录才算探到底 —— 比"有没有带文字的行按钮"可靠(图标按钮无 name 会被下面的控件枚举丢掉)。
   * 结构判据,域无关(不认"详情/编辑"这类中文后台/电商标签)。
   */
  diag: {
    anchors: number
    navRoles: number
    navTags: number
    ariaLabels: number
    tableRows: number
    grids: number
    passwordFields: number
    /**
     * 【量具,不进分母】页面上全部可交互节点数。与 `totals.controls` 的差 = 控件枚举的盲区。
     * 上面那个 controls 选择器只收 button 系;实测漏斗因此只看见 50%(见 NAV_EXTRACT 里的说明)。
     */
    interactive: number
  }
}

/** 单页枚举上限。远高于任何真实后台页面的导航规模,只防跑飞的 DOM;触顶必须报出来。 */
const CAP = 400

export const NAV_EXTRACT = `(() => {
  const CAP = ${CAP}
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const label = (el) => {
    const a = clean(el.getAttribute('aria-label')); if (a) return a
    const t = clean(el.getAttribute('title')); if (t) return t
    let direct = ''
    for (const c of el.childNodes) if (c.nodeType === 3) direct += c.textContent
    direct = clean(direct); if (direct) return direct.slice(0, 60)
    const inner = clean(el.innerText)
    if (inner) return inner.slice(0, 60)
    const img = el.querySelector('img[alt]')
    return img ? clean(img.getAttribute('alt')).slice(0, 60) : ''
  }
  const depthOf = (el) => { let d = 0, p = el; while ((p = p.parentElement)) d++; return d }
  const visible = (el) => {
    if (!el.getClientRects || !el.getClientRects().length) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  }

  // ── 锚点:全部可见的 a[href]。**没有菜单过滤器** —— 那正是被删掉的判据。
  const anchors = [...document.querySelectorAll('a[href]')]
  const links = []
  const seen = new Set()
  let anchorsCapped = false
  for (const a of anchors) {
    const href = a.getAttribute('href')
    if (!href || href === '#' || /^(javascript|mailto|tel):/i.test(href)) continue
    if (!visible(a)) continue
    // 名称为空也【保留】:无名锚点恰恰是快照会剪掉、只有这里能看见的那一类。
    const name = label(a) || label(a.parentElement || a) || '(unnamed)'
    const key = href + '|' + name
    if (seen.has(key)) continue
    seen.add(key)
    if (links.length >= CAP) { anchorsCapped = true; break }
    links.push({ name, href, depth: depthOf(a) })
  }

  // ── 控件:全部可见的可点元素。**没有动词表** —— 什么算功能点、点了会不会写业务数据,
  //    都由 agent 依据页面上下文自己判断(决定 2)。
  const controls = []
  const ctlSeen = new Set()
  let ctlTotal = 0
  let ctlCapped = false
  for (const el of document.querySelectorAll('button,[role=button],[role=menuitem],[role=tab],[class*=btn],input[type=submit],input[type=button]')) {
    if (!visible(el)) continue
    const name = label(el)
    if (!name) continue
    ctlTotal++
    const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : 'button')
    const inRow = !!el.closest('tr,[class*=table-row],[class*=list-item]')
    // 同名 + 同角色 + 同是否在行内 → 归一成一条(表格每行一个「编辑」不必列 100 遍)。
    // 这是**去重**,不是筛选:任何一种形态都至少留下一条。
    const key = role + '|' + name + '|' + (inRow ? 'row' : 'page')
    if (ctlSeen.has(key)) continue
    ctlSeen.add(key)
    if (controls.length >= CAP) { ctlCapped = true; break }
    controls.push({ role, name, inRow })
  }

  return {
    url: location.href,
    title: document.title,
    links, controls,
    totals: {
      anchors: anchors.length,
      anchorsKept: links.length,
      controls: ctlTotal,
      controlsKept: controls.length,
      capped: anchorsCapped || ctlCapped
    },
    diag: {
      anchors: anchors.length,
      navRoles: document.querySelectorAll('[role=navigation],[role=menu],[role=menubar],[role=tree]').length,
      navTags: document.querySelectorAll('nav').length,
      ariaLabels: document.querySelectorAll('[aria-label]').length,
      // 列表页判据(纯 DOM 事实,域无关):数据行数 + 表格/网格数。用于 structure-first 的 markListIfNeeded。
      tableRows: document.querySelectorAll('table tbody tr, [class*="table-row"], [class*="list-item"]').length,
      grids: document.querySelectorAll('table, [role=table], [role=grid], [role=treegrid]').length,
      // 登录墙的便宜信号(域/语言无关):**可见的**密码输入框。
      // 用于登录检测(agent LLM 语义判断为主,这个做辅助信号)。
      //
      // 必须过滤可见性(2026-08-18 Ral 提「多此一问」)。原来是裸 querySelectorAll().length,
      // 数的是**DOM 里存在**而不是**看得见** —— 而已登录的 SPA 后台里躺着密码框太常见了:
      // 收起的「修改密码」表单、常驻 DOM 只是没打开的登录弹窗(v-show 而非 v-if)、
      // 新增用户抽屉里的密码字段。任何一个命中,起点就被判成登录墙。
      //
      // 代价不是"多问一次":autoConfirmWhen 用的是**同一个数**(passwordFields === 0),
      // 所以页面上常驻一个隐藏密码框时,**自动续跑永远不可能触发**,人必须手点 ——
      // 等于把无人值守钻探关掉了。
      //
      // 复用本文件上面那个 visible()(getClientRects + visibility + display + opacity),
      // **不另写一套判据** —— 同一个文件里两种"可见"的定义迟早分叉,而分叉时不会报错。
      passwordFields: [...document.querySelectorAll('input[type=password]')].filter(visible).length,
      // 【量具,不进分母】页面上**全部**可交互节点的数量。
      //
      // ⚠ 这段注释在一个 template literal 里面 —— **不能用反引号**,一个就把 NAV_EXTRACT 闭合掉,
      //   报错还是不知所云的 "Module declaration names may only use quoted strings"(2026-08-17 踩过)。
      //
      // 上面那个 controls 选择器只收 button 系,radio / checkbox / select / switch / combobox
      // 一个都不在里面。实测(2026-08-17,八个模块同口径):seen 91 / 可交互 182,
      // **漏斗只看见 50%**,分母外是 56 个 radio + 32 个 textbox —— 而那批恰恰是切一下就换一组
      // query 参数、打出不同接口变体的控件。于是 untriaged:0 是在被砍掉一半的分母上算出来的,
      // 漏斗在自己看不见的地方报绿灯。
      //
      // 先加这个数**不改行为**:seen 与它的差值就是盲区,让它每页可见。
      // 留一轮两口径并存的数据,才能证明扩选择器之后是「看见得更多」而不是「混进一堆噪音」。
      interactive: document.querySelectorAll(
        'button,[role=button],[role=menuitem],[role=tab],[class*=btn],input[type=submit],input[type=button],' +
        'input[type=radio],input[type=checkbox],select,textarea,input[type=text],input[type=search],' +
        '[role=radio],[role=checkbox],[role=switch],[role=combobox],[role=menuitemradio],[role=menuitemcheckbox],[role=option]'
      ).length
    }
  }
})()`
