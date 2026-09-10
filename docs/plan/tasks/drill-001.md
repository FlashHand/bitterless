---
id: drill-001
scope: 把 cowork 的钻探（explore_session）移植进 bitterless 的 maestro 侧
status: 已接通;待真机验收
depends-on: []
verify: typecheck:node + typecheck:web + check:chat-composer + tests/maestro/drillDeps.test.mjs
---

# drill-001 — 钻探移植进 bl

Ral 2026-09-09：先问「bl 中钻探技能无法使用，检查 root cause」，定根因为**从未实现**
（见 [`docs/issues/drill-skill-not-available-in-bitterless.md`](../../issues/drill-skill-not-available-in-bitterless.md)），
随后「go 参考 cowork 都做了」。

## 0. 为什么它是「搬 + 适配」而不是重写

量过：cowork 的 `src/main/sitemap/` 是 **3,761 行**，`drill.service.ts` 另有 1,224 行。
但 `exploreSession.service.ts`（3,014 行）的 import 只有

```
electron(app, WebContents) · node:fs/promises · node:path
@main/sitemap/{navExtract,exploreSession.types,siteRules.*}
@main/tasks/taskRegistry.types      ← bl 有同名文件，且 TaskHandle **完全一致**
@shared/sitemap.types
```

**零宿主耦合** —— 它跟宿主说话全部经过 `ExploreSessionDeps` 那 17 个注入函数。
这正是这次移植可行的全部原因；要是它直接摸 tab/capture，就只能重写。

## 1. 已完成：整个 sitemap 模块搬入，零改动编译通过

`src/main/maestro/sitemap/`（7 个文件）+ `src/shared/maestro/sitemap.types.ts`。
只改了 import 别名：

| cowork | bl |
|---|---|
| `@main/sitemap/*` | `@maestro-main/sitemap/*` |
| `@main/tasks/*` | `@maestro-main/tasks/*` |
| `@shared/sitemap.types` | `@maestro-shared/sitemap.types` |

放 `maestro/` 下而不是 `src/main/sitemap/`：钻探是 maestro 的能力，与 bl 自己那套
（onlypreview / trench / todo）不同层。

**`typecheck:node` 0 错** —— 3,761 行一行没改就过了。

## 2. bl 侧要补的宿主面（`ExploreSessionDeps` 的 17 项）

| dep | bl 现状 | 处置 |
|---|---|---|
| `activeTabId()` | `getActiveOperationTabId()` | 直接接 |
| `listTabs()` | `getOperationTabs()` | 映射 `{id,url}` |
| `currentUrl()` | `CaptureServiceState.currentUrl` | 直接接 |
| `captureSessionDir()` | capture service 有会话目录 | 直接接 |
| `previousSitemap()` | — | 用刚搬入的 `sitemap.service` |
| `pageSnapshot()` | **缺** | 补 `pageSnapshotForAgent()`：`captureSnapshot()` 在 API 模式下被 `'Action capture is off'` 挡掉，而探站**就跑在 API 模式**，所以必须有一个绕过录制闸的兄弟（cowork 同因同法） |
| `webContentsForTab(id)` | **缺** | 按 tab id 取 view，不经过激活（与 cowork conn-009 同一个理由） |
| `retargetCapture(id)` | **缺** | 录制目标随钻探锚点走 —— 少了它，边钻边摄会录成人正在看的那个 tab |
| `activateTab` / `closeTab` | 需在 browserView 上确认 | 条件跟随，不夺回焦点（照 conn-009 的结论，别把 cowork 已经修掉的毛病一起搬过来） |
| `ingestWindow?()` | bl 有 `ingest_recording` | 接它 |
| `recordingStartedAt?()` | capture records | 直接接 |
| `onWaiting` / `onActivity` / `onNote` / `onDebug` / `turnUsage` / `inFlightRequests` | 可选 | 接 bl 的 `broadcastActivity` / `debugCodex` |

**不搬 cowork 已经修掉的毛病**：`pinActiveTabToDrillTab()` 那套「每个动作前把激活 tab 钉回钻探
自己那只」是 cowork 的旧行为，2026-09-09 的 `conn-009` 已把它换成
「按 tab id 取 view + 条件跟随 + 锚点免 LRU 冷却 + 关后台节流 + 录制目标跟随锚点」。
bl 这次**直接落在新形态上**，不重演一次那个 bug 再修。

## 2.5 一个真实的分叉：边钻边摄摄进哪 —— **要 Ral 定**

cowork 的边钻边摄把只读接口摄进 **apidoc 台账**（`createXpcMainEmitter<ApidocLedgerApi>('ApidocDao')`，
任务卡写「摄取 apidoc · host」）。**bl 没有 apidoc** —— 全仓 `apidoc` 只出现在本次搬入的文件里。

bl 的训练管线是**技能**：`skill.service.ts:120 ingestRecordingToSkills()`（与 cowork 同名的方法）。

两条路：

| | 做法 | 代价 |
|---|---|---|
| (i) | 边钻边摄接 bl 的 `ingestRecordingToSkills()`，**不移植 apidoc** | 钻探在 bl 产出的是**技能**而不是接口文档。语义与 cowork 不同 —— 同一个工具在两边产出不同的东西 |
| (ii) | 把 apidoc 台账一起移植（DAO + schema + XPC handler + 那套 ON CONFLICT DO UPDATE 的覆盖补齐） | 又是一个子系统，且 bl 侧没有任何现存消费者会去读它 |
| (iii) | bl 的钻探**只产出站点地图**，不做边钻边摄（`ingestWindow` 这个可选 dep 不接） | 最小、语义最干净；但「边钻边摄」是 Ral 2026-08-13 明确要的行为 |

倾向 (i)：bl 的钻探价值在**站点地图 + 探索**，而它自己的产出物本来就是技能；
硬搬一个没人读的 apidoc 台账是为对齐而对齐。但这条改变了工具在两边的产出语义，**不自己拍**。

## 2.6 其余依赖 bl 全都有（已核）

`agentSessionContext`（DEFAULT_AGENT_SESSION_KEY / currentChatSessionId）· `usageLedger` ·
`agentBroadcast` · `taskRegistry` · `hostFromUrl` —— 五个全在。所以编排那一段除了 apidoc
没有别的缺口。

## 3. 已接通（2026-09-10）

Ral 报「钻探没法持续自动进行」时,日志给出了确切原因:`explore_session` **0 命中**、
「继续钻探」**0 命中** —— agent 只能用通用工具即兴走两步就结束回合。**一个普通回合在模型
停止调工具的那一刻就结束了**,没有任何东西推它继续。cowork 能持续靠的是宿主每轮合成一条新 turn。

补完的四件:

| 件 | 说明 |
|---|---|
| 续跑循环 | `continueAfterTurn` 163 行逐字搬入,挂在 `sendAgentMessage` 出口（只对 `intent === 'root'`）。**这是「自动持续」的唯一来源** |
| 工具注册 | `buildDrillTools` 进 `buildPiTools`;三件套（`DrillRunService` / `DrillHostService` / `DrillToolsHost`）惰性建 |
| 内置技能 | `DRILL_BUILTIN_SKILL` **prepend** 进 skillBriefs（**不能混进 `recordings`** —— 会被确定性快路径当文件技能去读 recipe,而它没有 recipe,整条触发静默失效）。中英文触发词齐 |
| 提示词 | 钻探那 56 行从 cowork 逐字搬入,**话术一字未改**（含 09-10 加的「永不反问下一个钻哪个」） |

三处**bl 与 cowork 的真实架构差异**,不是抄写差错：

1. **合成 turn 要先认领回合。** cowork 的 `sendAgentMessage({message, sessionId?})` 没有回合概念;
   bl 有认领闸、要求 `turnId`,`activeTurnFor()` 找不到就返回 `turn-not-active`。
   所以续跑先 `claimAgentTurn` 再发,与渲染端 `turn.service.send()` 同一件事。认领不到就当失败返回
   —— 续跑读 `!reply.ok` 会停,那是对的:此刻不该硬塞一轮。
2. **`OperationTab` 没有 `miniappId`。** bl 没有 cowork 那套 mini-app tab,所以 begin 的那道拒
   只按 `kind` 判（bl 自己的可录判据本来就是 `kind === 'browser'`）。
3. **活动播报阶段用 `'tool'`。** bl 的 `AgentActivityStep['phase']` 是封闭枚举,
   为钻探单开一档要改共享契约 + 渲染端图标映射,而钻探每一步本来就是一次工具调用。

工具轮次上限提到 200（`MAESTRO_CHAT_MAX_TOOL_ROUNDS`）—— 运行时默认 12 会把钻探砍断,
而它必须高于 exploreSession 自己的 120 分钟预算,否则边界就不是「时间预算 + 无进展检测」了。

## 4. 还没做

- **编排状态机**（cowork `drill.service.ts` 里约 608 行）：run 代次、全局单例闸、主人会话、
  重入判定、`abandonRun`。这一段**不能快搬** —— 它的不变量背后有三份 issue 文档
  （`drill-must-be-global-singleton.md`、`drill-activity-bleeds-into-another-session.md`、
  `drill-run-epoch-and-stop-gates.md`），每一条都是真出过 bug 才写下来的：
  第二次 `begin` 夺舍正在跑的那一轮、活动播报盖上别的会话的章、停止后立刻重开变成
  「新一轮一开始就是被停止的」。搬错的代价是这三个 bug 在 bl 重现一遍，而它们都**静默**。
- `explore_session` 工具注册（`maestroWindow.controller.ts` 那处 `execute` 表）
- 钻探任务卡
- 锚点 tab 免 LRU 冷却的接线（bl 侧 `enforceWarmCap` 等价物）
- **等 #2.5 定了才能接 `ingestWindow`**

`drillHost.service.ts` 适配器**已完成**（见 #1 的提交）。

## 5. 验证边界

能自动验的：编译、`ExploreSessionDeps` 的映射（每个 dep 接到 bl 的哪个真源）、快照绕闸的分叉。
**不能自动验的：一次真实钻探。** 那需要真机跑，且 E2E 按项目规则不自行发起。
钻探能跑两小时并写站点地图，这条必须 Ral 验收。
