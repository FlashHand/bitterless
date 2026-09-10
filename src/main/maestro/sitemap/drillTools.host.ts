/**
 * 三个钻探工具的执行体（`drill-001` 阶段四）—— 把 `DrillRunService`（谁在钻 / 哪一次 / 能不能开）
 * 与 `ExploreSessionService`（怎么走站点）接在一起。
 *
 * **闸的顺序就是这个文件的全部要点。** `begin` 分支里每一步的位置都不是风格：
 *
 *  1. `refuseIfBusyElsewhere` 必须在**任何赋值、任何动录制的动作之前** ——
 *     `clearCaptureSession()` 对正在录的会话是「换目录」，第一轮还在往里写而窗口游标已指向
 *     被换掉的目录，那段流量成孤儿且**没有任何报错**；`drillOwnerSessionId` 一旦被覆盖，
 *     第一轮之后所有播报都盖上第二个会话的章。
 *  2. 上一轮已作废但 `open` 还是 true → 先 `abandonRun`，否则 `begin` 会走幂等短路，
 *     把新一轮接到那个死掉的运行上（连它 abort 过的 TaskHandle 一起）——
 *     「停止后立刻重开」于是变成「新一轮一开始就是被停止的」。
 *  3. 再 `claimRun()` 铸新代次 + 认领归属。**在任何长流程开始之前** ——
 *     旧一轮遗留的异步工作从这一刻起就过期了。
 *  4. 重入（同一个站再 begin）**不建第二张任务卡**，判据借 `svc.reentersRun()`，
 *     与 `begin` 内部同一份，不在这里重写一遍。
 *
 * 出处：cowork `docs/issues/drill-must-be-global-singleton.md` ·
 * `drill-run-epoch-and-stop-gates.md`。
 */

import { currentChatSessionId } from '@main/agent/runtime/agentSessionContext'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import type { DrillHostService } from '@maestro-main/sitemap/drillHost.service'
import type { DrillRunService } from '@maestro-main/sitemap/drillRun.service'
import type { CodexDebugEvent } from '@maestro-shared/coach.api'

export interface DrillToolsHostState {
  currentUrl(): string
  /** 激活的 operation tab —— `begin` 要拒 mini-app 面（它们不是可探索的站点）。 */
  activeTabKind(): { kind: string; miniappId?: string } | null
  setAutoDismissFileDialogs(on: boolean): Promise<void>
  /** 对一次录制电平：红点只吃 started/stopped 两个沿，钻探开始正是"灯必须是对的"那一刻。 */
  announceCaptureState(): void
  debugCodex(event: CodexDebugEvent): void
  /** 把这一轮的产物落到 sitemap.json —— 落不了盘等于探了没探。 */
  persistAgentRun(params: {
    siteId: string
    host: string
    modules: unknown
    uncovered: unknown
    offsite: unknown
    visited: number
  }): Promise<{ ok: boolean; error?: string }>
}

export class DrillToolsHost {
  constructor(
    private readonly host: DrillToolsHostState,
    private readonly drillHost: DrillHostService,
    private readonly run: DrillRunService
  ) {}

  async toolExploreSession(params: {
    action: string
    startUrl?: string
    focus?: string[]
    sessionKey?: string
  }): Promise<string> {
    const svc = this.drillHost.ensureSession()
    const action = (params.action || 'state').toLowerCase()

    if (action === 'begin') {
      /**
       * **agent 工具路径的门。** 按钮那条路有两道天然拒（`/^https?:/` 与「钻探依赖录制」），
       * 这条路**两道都没有** —— 它直接进 `exploreSession.begin()`，而 `begin()` 只校验
       * wc 存在 + startUrl 非空。所以「入口层面禁止 mini-app」必须在这里再挡一次。
       *
       * 返回的是给 agent 读的文本，所以要说清**为什么**+**怎么办**，否则它原样重试。
       */
      const active = this.host.activeTabKind()
      if (active?.kind === 'miniapp') {
        return (
          `REFUSED: the active tab is a mini-app ('${active.miniappId ?? '?'}'). ` +
          'Mini-app tabs never participate in recording or drilling (they are first-party local apps, not sites to explore). ' +
          'Switch to a website tab first, or pass an explicit startUrl for a site that is open in one.'
        )
      }

      // 主人 = 开钻的那个聊天会话。退化键在这里等于没有主人。
      const owner = currentChatSessionId() ?? undefined

      // ① 单例闸 —— 在任何赋值与任何动录制的动作**之前**。
      const refusal = this.run.refuseIfBusyElsewhere(owner)
      if (refusal) return refusal

      // ② 上一轮已作废但还没收摊 → 就地放弃它，让 `begin` 走**完整重置**而不是幂等短路。
      if (!this.run.isRunLive(this.run.currentRunId) && svc.isExploring) {
        svc.abandonRun('上一轮已被停止/作废,这里开的是新一轮')
        this.run.setExploreTask(null)
      }

      // ③ 新一轮 → 新代次 + 认领归属。在任何长流程开始之前。
      this.run.claimRun({ sessionKey: params.sessionKey, owner })

      /**
       * 钻探开始 → 打开「自动取消文件框」。由流程自己开，**不做成 agent 工具** ——
       * 让模型去记得开一个安全开关，等于把它变成可选项。
       *
       * 放在这里而不是 `startRecording`：常见时序是**录制先起来**（人按 Capture、钻探随后 begin），
       * 只在开录时读一次标志的话，钻探全程都是关着的。
       */
      void this.host.setAutoDismissFileDialogs(true)
      this.host.announceCaptureState()

      // ④ 重入的 begin（同一个站已经在钻）**不建第二张任务卡**。判据借 svc 的，
      //    与 begin 内部同一份 —— 两处各自推导迟早不一致。
      if (svc.reentersRun(params.startUrl)) {
        return await svc.begin({ startUrl: params.startUrl, focus: params.focus })
      }

      const task = taskRegistry.start({
        // 钻探自己的任务**一律显式盖章** —— 续跑循环跑在 `runInAgentSession` 之外，
        // 那时 ALS 的默认值是 undefined。
        sessionId: this.run.ownerSessionId ?? owner,
        name: 'explore_session',
        kind: 'builtin',
        // 限定范围要写进标题 —— 否则 12 个模块的站点跑出 3 个模块的 sitemap 看起来像 bug。
        title: params.focus?.length
          ? `agent exploring ${params.startUrl || this.host.currentUrl()} · 只钻 ${params.focus.join(' / ')}`
          : `agent exploring ${params.startUrl || this.host.currentUrl()}`,
        input: { startUrl: params.startUrl || this.host.currentUrl(), focus: params.focus || [] }
      })
      this.run.setExploreTask(task)
      const text = await svc.begin({ startUrl: params.startUrl, task, focus: params.focus })
      if (text.startsWith('ERROR')) task.fail(text)
      return text
    }

    if (action === 'end') {
      /**
       * end 闸：完成 = 机械的「已钻模块 == 已发现模块」。判据**只有一处**
       * （`continueState().shouldContinue`）—— end 闸和续跑循环一旦各自推导，
       * 就会出现"end 放行但循环还想跑"这种自相矛盾的状态。
       */
      const st = svc.continueState()
      if (st?.shouldContinue) {
        this.host.debugCodex({
          scope: 'agent',
          phase: 'drill:end-refused',
          level: 'info',
          message: `模块 ${st.drilled}/${st.discovered} 已钻 · frontier 剩 ${st.worklistLeft} · 支线未收 ${st.openBranches} · ${st.remainingText} 预算 —— 拒绝提前 end`,
          ts: Date.now()
        })
        return svc.endRefusal()
      }
      // frontier 空但还有没钻的同站 tab → 拒绝 end，催去钻它（它的流量也需要被录）。
      if (st && !st.overBudget) {
        const nextTab = await svc.firstUndrilledSameSiteTab()
        if (nextTab) {
          this.host.debugCodex({
            scope: 'agent',
            phase: 'drill:end-refused',
            level: 'info',
            message: `还有未钻同站 tab ${nextTab.id} → ${nextTab.url} —— 拒绝提前 end`,
            ts: Date.now()
          })
          return (
            `REFUSED: cannot end — there is still a same-site tab you have not drilled: ${nextTab.url}. ` +
            `explore_visit {"tab":"${nextTab.id}"} to drill it (its traffic also needs recording), then end.\n${svc.stateText()}`
          )
        }
      }
      return await this.finalizeExploreSession()
    }

    if (action === 'need_login') {
      // 登录暂停：agent 判定被登录墙挡住 → 暂停 + 请人登录，人点继续（或自动检测到登录）后返回。
      await svc.pauseForLogin('agent 判断需要登录')
      return `登录暂停已结束(用户已登录 / 已确认继续)。继续钻探。\n${svc.stateText()}`
    }

    return svc.stateText()
  }

  async toolExploreVisit(params: { url?: string; tab?: string; from?: string }): Promise<string> {
    return await this.drillHost.ensureSession().visit(params)
  }

  /**
   * **snake_case → camelCase 的翻译不能省。** 工具契约对外是 snake_case（与其它工具一致），
   * 内部是 camelCase。不翻的后果是**静默失效**，不是报错：
   *  · `expected_children` 被当成"没给" ⇒ 子模块承诺闸失效；
   *  · `renamed_from` 被当成"没给" ⇒ 每一次改名认领都被那道闸拒掉。
   *
   * `plan.skip` 收两种写法（`[{name,reason}]` 和 `["名字"]`）：模型两种都会给，而一个只写了
   * 名字的 skip **仍然是有效的分诊**（它表态了），不该因为少个 reason 就掉回"未分诊"那一格。
   */
  async toolExploreRecord(findingsJson: string): Promise<string> {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(findingsJson) as Record<string, unknown>
    } catch (err) {
      return `ERROR: findings_json is not valid JSON (${(err as Error).message}).`
    }
    const asRecord = (value: unknown): Record<string, unknown> => (value || {}) as Record<string, unknown>
    return await this.drillHost.ensureSession().record({
      module: (parsed.module
        ? {
            ...asRecord(parsed.module),
            expectedChildren: asRecord(parsed.module).expectedChildren ?? asRecord(parsed.module).expected_children
          }
        : undefined) as never,
      functions: (Array.isArray(parsed.functions) ? parsed.functions : []).map((raw) => {
        const f = asRecord(raw)
        return {
          ...f,
          functionId: f.function_id ?? f.functionId,
          renamedFrom: f.renamed_from ?? f.renamedFrom,
          rowLevel: f.row_level ?? f.rowLevel,
          moduleUrl: f.module_url ?? f.moduleUrl
        }
      }) as never,
      worklistAdd: (parsed.worklist_add ?? parsed.worklistAdd) as never,
      retired: parsed.retired as never,
      dontClick: (parsed.dont_click ?? parsed.dontClick) as never,
      dontVisit: (parsed.dont_visit ?? parsed.dontVisit) as never,
      searchValues: (parsed.search_values ?? parsed.searchValues) as never,
      observedWrite: (parsed.observed_write ?? parsed.observedWrite) as never,
      disagreement: parsed.disagreement as never,
      uncovered: parsed.uncovered as never,
      moduleDone: (parsed.module_done ?? parsed.moduleDone) as never,
      plan: (() => {
        const p = (parsed.plan ?? parsed.triage) as Record<string, unknown> | undefined
        if (!p || typeof p !== 'object') return undefined
        const skip = Array.isArray(p.skip) ? p.skip : []
        return {
          click: (Array.isArray(p.click) ? p.click : []).map((v) => String(v ?? '')),
          skip: skip.map((raw) => (typeof raw === 'string' ? { name: raw } : asRecord(raw) as { name: string; reason?: string }))
        }
      })() as never,
      note: parsed.note as never
    })
  }

  /**
   * 收尾。
   *
   * **不在这里停录制**（Ral 2026-08-16 推翻 2026-08-12）：流程早就是**边钻边摄** ——
   * 钻一段 → 摄一窗 → **接着钻**，finalize 于是不是终点，而是一轮里反复经过的一站。
   * 在这里停录的后果是：① 摄完这一窗之后，后续钻探的流量**全部没被录**，而那正是下一窗要摄的；
   * ② 停录会 revert 目标 tab 的 `Runtime.enable`，下一次 `start_recording` 连
   * `isCapturableTab` 都过不了 —— 「下一轮开不起来」。
   * 录制的生命周期归人（Capture 按钮）或显式 `stop_recording`，不归单轮 finalize。
   */
  async finalizeExploreSession(reason?: string): Promise<string> {
    const svc = this.drillHost.exploreSessionOrNull()
    if (!svc) return ''
    // 先把"还剩多少地点"取下来 —— end 之后 session 就关了，取不到了。
    const finalState = svc.continueState()
    // 收尾那一摄：最后一个模块之后到现在的尾巴也要摄掉，否则那段流量谁都不管
    // （边钻边摄按模块切，最后一段没有"下一个模块完成"来触发它）。
    try {
      await svc.ingestTailWindow()
    } catch (err) {
      this.host.debugCodex({
        scope: 'agent',
        phase: 'sitemap:v2:tail-ingest-failed',
        level: 'warn',
        message: (err as Error).message,
        ts: Date.now()
      })
    }
    // **钻探结束 → 把文件框开关关回去。** 录制可能还开着，而人接着自己操作时不该再被取消文件框 ——
    // 开关的语义是"这一段是 agent 在开"，不是"录制期间一律拦"。
    void this.host.setAutoDismissFileDialogs(false)
    const out = await svc.end()
    const task = this.run.exploreTaskHandle
    this.run.setExploreTask(null)
    task?.artifact({ label: 'run', path: out.runPath })
    let persisted = ''
    try {
      const r = await this.host.persistAgentRun({
        siteId: out.siteId,
        host: out.siteId,
        modules: out.modules,
        uncovered: out.uncovered,
        offsite: out.offsite,
        visited: out.visited
      })
      if (!r.ok) persisted = `\n⚠ sitemap 落盘失败:${r.error || 'unknown'}`
    } catch (err) {
      persisted = `\n⚠ sitemap 落盘失败:${(err as Error).message}`
    }
    task?.complete(`explored ${out.siteId} · ${out.visited} pages`)
    // 本轮结束 → 作废代次。之后可以正常开下一轮，而旧一轮遗留的异步工作会自行退出。
    this.run.invalidateDrillRun(reason || '本轮钻探结束')
    return `${out.text}${persisted}${finalState?.worklistLeft ? `\n(还剩 ${finalState.worklistLeft} 个地点没打开)` : ''}`
  }
}
