# 移除 Coach（skill trainer）agent

Ral 2026-09-10：「移除 `src/main/agent/CoachAgent.ts` 后面用不到了」、「cowork 也不需要 coach agent 相关功能的」。

## 为什么它是死的

`CoachAgent` 是**技能训练师** —— 用工具创建/优化/删除当前站点的录制技能，自己从不执行技能。
它的 XPC 方法（`trainerMessage` / `resetTrainerConversation` / `abortTrainer`）**挂在契约上，但没有任何
renderer 调用**：`grep -rni "trainerMessage" src/renderer` 零命中。整条链从 UI 往下是断的。

cowork 那边 `grep -rniI "coach" src` **零命中** —— 同一个产品形态里这层已经不存在了，bl 这份是遗留。

## `coach` 在 bl 里是两件事 —— 删的时候必须分开

叫 `coach` 但**是活的核心**，一个都不动：

| 文件 | 它其实是什么 |
|---|---|
| `shared/maestro/coach.api.ts` | `CoachXpcContract` —— 整个 maestro 的 XPC 契约，20+ 个 renderer 文件在导入 |
| `main/maestro/xpc/coach.handler.ts` | `CoachXpcHandler` —— 每个 `createXpcRendererEmitter('CoachXpcHandler')` 的那个字符串 |
| `preload/maestro/coach.preload.ts` | 文件路径 / 录音落盘桥 |
| `main/maestro/settings/coachSettings.service.ts` | `CoachSettingsService`、`normalizeUrl` |

这四个名字里的 `coach` 是**旧产品名的遗留**，不是这个 agent。把它们当成 "coach agent 相关" 一起删会把 app 拆了。
本次只从这两个文件里摘掉那 3 个 trainer 方法，文件本身留着。

## 删除范围（trainer 簇，只从 trainer 可达）

- 整文件：`main/agent/CoachAgent.ts`、`main/agent/prompt/coachSysPrompt.ts`
- `main/agent/runtime/agentPrompt.ts`：`buildTrainerTurnPrompt`、`summarizeRecordsForTrainer`
- `main/agent/maestroAgent.service.ts`：`piTrainer`、`trainerAgents`、`MaestroAgentInstances.piTrainer`、
  `trainerMessage`、`resetTrainerConversation`、`abortTrainer`、`getTrainerAgent`、
  `getExistingTrainerAgent`、`buildTrainerTools`、`lastTrainerRun`，以及 state 端口上的
  `trainerToolDetail/Create/Optimize/Delete` 四条声明
- `main/maestro/skills/skill.service.ts`：`trainerToolDetail/Create/Optimize/Delete`
  （**只删工具包装层**，底下的 `generator.train()` 是技能生成引擎，别的路还在用，不动）
- `main/maestro/windows/main/maestroWindow.controller.ts`：上面那些的转发 + `lastTrainerRun` 读写 +
  `ensureAgents()` 形状里的 `piTrainer`
- `shared/maestro/coach.api.ts` + `main/maestro/xpc/coach.handler.ts`：3 个 XPC 方法

## 本次**不动**（不是这个 agent，且缠着持久化状态）

`'trainer'` 这个 **host-tool scope**：`HostToolScope = 'cowork' | 'trainer'`、`hostToolCatalog.ts` 里
8 处条目（其中 4 个是 trainer 独有工具）、`hostApprovalHistory.ts` 里**按 scope 持久化过的审批记录**、
以及 Workbench Tools 的 `Trainer` 页签。

拆它要连带处理已经落盘的历史记录，是独立一件事 —— 混进这次删除会把一个可回滚的删除变成一次数据迁移。
留下的现象：Workbench Tools 里那个 `Trainer` 页签还在，但它配的 agent 已经没了。要不要一起拆等 Ral 定。

## 验证

- `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck:node` —— 错误数不高于删除前的基线 74
- `yarn typecheck:web`
- `node scripts/maestro/check-agent-runtime.mjs`
- 全仓 `grep -rn "CoachAgent\|piTrainer\|trainerMessage"` 应当零命中
