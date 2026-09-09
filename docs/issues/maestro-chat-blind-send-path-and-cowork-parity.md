# Maestro chat：发送链路全黑、Cmd+H 历史空白，以及与 cowork 的结构差

`status: 可观测性 + 历史刷新已修;发送无回复待一次真机复现定案`
`reported: 2026-09-09（Ral：「cmd+h 不能展示历史消息 以及发送消息一直没回复，需要检查日志，没有日志就补充日志」）`

## 0. 先说清楚哪条是已定案的、哪条不是

| # | 症状 | 定性 | 证据 |
|---|---|---|---|
| A | 发送链路**没有任何日志** | 已定案，已修 | `turn.service.ts` 720 行、`maestroAgent.service.ts`、`coach.handler.ts` 三个文件里 `log/logger` 调用数合计 **0**；`Bitterless_DEBUG_PROD/logs/main.log` 1467 行里发送相关记录 **0 条** |
| B | Cmd+H 抽屉空白 | 已定案，已修 | 键位正常（`ChatPanel.vue:468`→`toggleHistory()`），故障在数据侧：`historySessions` 只在 `init()` 里拉一次，且 `.catch(() => [])` 吞错，开抽屉时不重拉 |
| C | 发消息一直没回复 | **未定案** | 静态可见 5 处静默 `not-sendable` 返回 + 4 个无超时的 pre-dispatch 跨进程 await；但哪一处真的中断，没有日志就说不出来 —— 这正是 A 的代价 |

C 不硬猜。A 修好之后一次复现就能定案，所以本轮的交付是**让 C 变得可诊断**，而不是赌一个改动。

## 1. A —— 发送链路为什么必须有日志

`turn.service.ts` 的 `send()` 在 `dispatched = true` 之前有 4 个跨进程 await，**每一个都没有超时**：

```
coach.claimAgentTurn()          // 371  main 侧的全局 root 闸
store.refreshWorkspace()        // 386
store.stageAttachments()        // 389
store.compactSessionIfNeeded()  // 415
```

它们之间穿插 5 处 `if (session.turn?.id !== turn.id) return { ok: false, reason: 'not-sendable' }`。
这个组合的后果是：**任一处挂住或静默返回，UI 的表现完全一样** —— turn 占着、Stop 常亮、
没有回复、日志里一个字都没有。人只能看到「发了没反应」。

对照 `maestro-open`：那条链路早就有 `maestroOpenDiagnostics.service.ts`，受校验的事件词表 +
`[maestro-open] event=… k=v` 单行输出，所以窗口打开慢/失败时能一眼看出卡在哪一档。
发送链路缺的就是同一样东西。本轮按同一个模式补 `[maestro-turn]`。

渲染端 `console.info` 会被 `logging/logPolicy.service.ts` 归到 `proc=renderer:maestroControl`，
`[scope]` 前缀被抽成 `scope` 字段 —— 与 `maestro-open` 落盘形状一致，不需要新增管道。

**已排除的一个嫌疑**：`compactSessionIfNeeded`（415）是 2026-09-08 新接的，最可疑，但
`message.store.ts:875` `if (!session.contextUsage.compressionTriggered) return false` 在未触发压缩时
立即返回，普通会话根本不走跨进程。它只在长会话（~90% 上下文）才有嫌疑 —— 因此仍给它和
`claimAgentTurn` 补上超时，但它不是新会话卡住的原因。`CompactionHandler` 的注册也核过了：
`main/xpc/xpc.helper.ts:10` 的 side-effect import，`app.main.ts:508` 会加载，注册是好的。

## 2. B —— Cmd+H 空白的真实成因

```
init()            → refreshHistory()   // 唯一的启动期调用
persist/archive/delete → refreshHistory()
toggleHistory()   → （不刷新）
```

`refreshHistory()` 是 `await maestroChat.listSessions({}).catch(() => [] as MessageSessionSummary[])`。
启动期这一次要是失败（sqlite 窗口/preload 还没就绪是现实可能 —— 日志里
`renderer:maestroSqlite … getSession miss` 就在同一段启动序列里），`historySessions` 会**永久**留空：
之后只有写操作才重拉，而一个空历史的新会话在你发第一条之前不会触发任何写。
于是「Cmd+H 永远是空的」，且没有任何错误痕迹。

cowork 那侧 `refreshHistory` 的实现是同一份形状（同样的吞错 catch），所以这一条**不是**照 cowork 抄
就能好的；两边都缺「开抽屉时重拉 + 失败要说话」。修法：`toggleHistory()` 打开时触发一次刷新，
且把失败记进 `[maestro-turn]`（scope 复用，同一条 chat 链路）。

## 3. 与 cowork 的结构差（Ral：「bl 在 chat 方面需要向 cowork 学习」）

逐项核过了。结论是**三项里只有一项是 bl 真的缺**，另两项 bl 不落后 —— 所以不能整体照抄。

### 3.1 消息结构 —— 几乎一致，差 1 个字段

`ChatMessage`：bl 21 字段 / cowork 22 字段，唯一的差是 cowork 多一个 **`replyId`**。
`MessageSession`：两边 15 字段，**完全一致**。

`Turn`：**bl 17 字段 / cowork 10 字段 —— bl 反而多 7 个**
（`generation`、`rootText`、`rootHumanMessageId`、`lastAssistantMessageId`、
`sealedAssistantSegments`、`hasStreamedText`、`streamCoverageComplete`）。
那 7 个是 bl 自己的 turn-steering / 流式覆盖工作留下的，cowork 没有。
**这一项上 bl 是超集，不存在「向 cowork 学习」。**

### 3.2 进行中的 UI —— 同一个组件，bl 更全

两边都有 `ResponseStatus.vue`，是同一份设计的两个实现。bl 那份对 retry 的处理明显更厚
（`retry` 出现 23 次 vs 计数、`elapsed`/`phase`/`activity`/`thinking`/`aborting` 齐备）。
**也不落后。**

### 3.3 未读红点 —— **这一项 bl 是真的没有**

`grep -rn unread src/renderer/maestro/` → **0 命中**。cowork 那套是完整的一小套设计：

| 层 | cowork 的做法 |
|---|---|
| 数据 | `unreadSessionIds: string[]`，持久化到 localStorage 键 `cowork.unreadSessions`（`readUnreadIds`/`writeUnreadIds`） |
| 动作 | `markUnread(sessionId)` / `markRead(sessionId)`，外加 `activeSessionId`（由 `channel.store` 切换时写入，**不反向 import**，否则成环即启动崩溃） |
| 视图模型 | `SessionListItem { id, title, preview, updatedAt, running, unread }` |
| 排序 | 三态互斥：`unread` → `running` → 已读 |
| 出处 | `docs/features/cowork-multi-session.md #3` |

两个必须先说清的事实：

1. **cowork 那个点是蓝的，不是红的** —— 类型注释原文「有你没看过的结论 —— 蓝点,排最上」。
   Ral 说的是「未读红点」。以 cowork 为准就该是蓝点；要红点就是有意偏离 cowork，得挑一个。
2. **bl 没有会话列表可挂。** cowork 的红/蓝点长在 `ChatPanel.vue` 里的常驻会话列表
   （`chat-panel__sessions-group`）每一行上。bl 的 maestro chat **没有这个列表** ——
   它只有 Cmd+H 的历史抽屉（`historySessions`，会话摘要）。
   所以「把未读点搬过来」不是加一个 `markUnread` 方法，而要先定它挂在哪。

## 4. 待裁决（已发 BotAndI）

- **未读点挂哪 + 什么颜色**：(i) 挂到 Cmd+H 抽屉的行上（改动最小，但人不开抽屉就看不见，
  而未读的意义正是「不看也知道」）；(ii) 照 cowork 建常驻会话列表再挂（对齐最彻底，
  但那是给 bl 的 maestro chat 加一个新的 UI 区块）；(iii) 先不做。
  颜色另定：cowork 是蓝点。**这是设计决定，不自己拍。**
- **`ChatMessage.replyId`**：bl 缺的那个字段。cowork 用它做什么、bl 是否需要，得先看
  cowork 那侧的用法再决定要不要补 —— 不为了字段对齐而对齐。
- **pre-dispatch 没有超时**：`withInactivityTimeout` 只护住投递之后。投递之前那 4 个 await
  一个超时都没有，挂住就是永久挂住、没有兜底。本轮**故意没加超时** —— 先让日志说话，
  免得一个超时把证据改成另一种表象。定案后再决定要不要补这道兜底。
- **C 的定案**：需要一次真机复现，把 `[maestro-turn]` 那几行贴回来。

## 5. 本轮改了什么

| 文件 | 改动 |
|---|---|
| `store/turnDiagnostics.service.ts` | 新增。`[maestro-turn]` 诊断，受校验事件词表，**每档打 start + end**，不记正文 |
| `store/turn.service.ts` | 14 处留痕：`send-start`、4 档 pre-dispatch（claim/workspace/attachments/compaction）+ dispatch、5 处静默 `not-sendable` 收成 `turnLost()` 并留痕、`send-terminal` |
| `store/message.store.ts` | `refreshHistory` 不再 `.catch(() => [])` 静默吞错，失败会说话 |
| `ChatPanel.vue` | `toggleHistory()` 打开时重拉历史（Cmd+H 空白的修法）；Stop 按钮改成 `IconBtn` 纯图标 |
| `ChatPanel.less` | Stop 软红底无边框；footer 控件高度按 cowork 压到 26px |

验证：`typecheck:web` 33 个诊断 = 基线（零新增）；`check:chat-composer` 绿。
`check-agent-activity`（工具名显示）与 `test:onlypreview`（扩展名清单 / shell store 行数预算）
在 HEAD 与本轮改动前**就是红的**，且属于别的在途工作，未处理。
Electron E2E 未跑（项目规则：不自行发起）。
