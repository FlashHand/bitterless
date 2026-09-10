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

## 第二步：`'trainer'` 这个 host-tool scope 也一起拆了

先前打算搁下它（怕连带一次数据迁移），量过之后发现不必 —— 而且**留着有实害**：
`hostToolCatalog` 是 `buildHostToolCatalogTool` 交给模型读的说明书，那 4 个 trainer 独有条目
（`get_skill_detail` / `create_or_update_skill` / `optimize_skill` / `delete_skill`）的实现已经随
trainer 删掉了，留着等于告诉模型有它调不到的工具。

- `HostToolScope` → 只剩 `'cowork'`。`getHostToolCatalog` 的 `scope` 入参保留（不改契约形状），
  但它只可能是这一个值
- `hostToolCatalog.ts`：删掉 4 个 trainer 独有条目；4 处 `['cowork', 'trainer']` → `['cowork']`
- `hostApprovalHistory.ts`：归一化只认 `'cowork'` —— **已落盘的 `scope: 'trainer'` 旧记录退化成
  「无 scope」**，记录本身还在、照常显示。优雅降级，不是迁移，所以不用改数据
- Workbench Tools：只剩一个 scope 时那个切换器就是噪音，连按钮块与它的 4 段 Less 一起去掉，
  标题写死 `Maestro Tools`
- `setHostToolPolicy` 里原来要读两个 scope 的目录来判断「这个工具名认不认识」，现在读一次

`BaseAgent.ts` 那张活动分类名单里还留着 `get_skill_detail` / `delete_skill` 两个名字 —— 纯字符串匹配，
无害，而且 `get_skill_contract` / `run_skill_script` / `replay_skill_ui` 这几条同族的路还活着，不动它。

## 验证

- `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck:node` —— 错误数不高于删除前的基线 74
- `yarn typecheck:web`
- `node scripts/maestro/check-agent-runtime.mjs`
- 全仓 `grep -rn "CoachAgent\|piTrainer\|trainerMessage"` 应当零命中
