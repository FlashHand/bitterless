# pi 的 agent 目录落在 `~/.pi/agent`,不在应用自己的 userData 里

`status: fixed`
`reported: 2026-09-08 (Ral：「首先将 bitterless 和 cowork 的 pi 的目录都调整为 <userData>/.pi 而不用全局的 pi 目录」)`

## 现象

`maestroAuthPath()` / `maestroModelsPath()` 一直是应用本地的(`<userData>/cowork/pi/`),
注释也写着 "NOT ~/.pi"。但那只覆盖了 **auth.json 与 models.json 两个文件**。
pi 还有一个**目录级**的概念 `agentDir`,它决定另外一批路径,而这一批一直落在用户自己的
`~/.pi/agent` 上 —— 因为:

- `createAgentSession()` 我们没传 `agentDir`(`piRuntimeAdapter.ts:174` 只传 model/tools/sessionManager);
- `PI_CODING_AGENT_DIR` 环境变量我们从没设过。

于是 `getAgentDir()` 走兜底分支 `join(homedir(), '.pi', 'agent')`(pi `dist/config.js:412`)。

## 三个实际后果

| 落点 | pi 里的取法 | 实际影响 |
|---|---|---|
| `<agentDir>/AGENTS.md` | `loadProjectContextFiles()` 的全局那一份 | **`~/.pi/agent/AGENTS.md` 正在被注入每个 maestro 会话的 system 段。**本机实测该文件存在(1,253 B),内容是一份 *git 同步工作流* 规则(`git add -A` → commit → pull → push)。它进的是 `<project_context>`,属于 system 消息 ⇒ **永不被压缩**,每轮都在 |
| `<agentDir>/SYSTEM.md` · `APPEND_SYSTEM.md` | `discoverSystemPromptFile()` | 用户自己的 pi CLI 若放过这两个文件,会**整段替换**我们的 system prompt(A1–A5),应用无从察觉 |
| `<agentDir>/bin` | `TOOLS_DIR`(模块级 `const`,首次 import 冻结) | pi 的 grep/find 先找这里,再找 PATH,最后从 api.github.com 下载。任何跑过 pi CLI 的机器上,这里的二进制会静默胜出 |

另外 `settings.json` / `sessions/` 也写进用户的 pi CLI 状态里 —— 两个程序共用一份可变状态,
互相看不见对方。

提示词侧的完整拆解见 `overmind:areas/agent-runtime/chat/prompt-structure.html` #1 的 A7 行。

## 契约

**pi 的一切落地物都在 `<userData>/.pi/` 下,应用本地,与用户的 `pi` CLI 完全隔离。**
目录名取 `.pi` 而不是 `pi`:与 pi 自己的 `CONFIG_DIR_NAME = '.pi'` 同形,且与 cowork 对齐
(cowork 同步改名,见 `micromeet-cowork:docs/issues/pi-agent-dir-app-local.md`)。

- `PI_CODING_AGENT_DIR` = `<userData>/.pi`,在 **boot 阶段**设(必须早于第一次
  `await import('@earendil-works/pi-coding-agent')`,因为 `TOOLS_DIR` 在首次 import 时冻结;
  main 里所有 pi import 都是 lazy 的,已核)。
- `createAgentSession()` 显式传 `agentDir` —— 环境变量与入参两条路径都堵上,不依赖谁先谁后。
- auth/models 从 `<userData>/cowork/pi/` 前移到 `<userData>/.pi/`,**一次性迁移**:
  `auth.json` · `models.json` · `models-store.json` · `settings.json` 四个文件,目标侧缺哪个补哪个,
  已存在的不覆盖。不迁 `bin/`(见下)。
- `<userData>/.pi/bin` **保持为空**。它是 `TOOLS_DIR`,放进任何东西都会盖掉后续可能引入的
  随包二进制。

## 不做的事

- 不动 codex / claudeSubscription 各自的凭据库(`codexAccount.repository.ts` 的 per-account
  auth 目录、`codexModelsPath()`)—— 它们不是 pi 的 agentDir,是另一套账号存储。
- 不设 `PI_OFFLINE`。cowork 设它是因为随包 rg/fd 需要挡住运行时下载;bitterless 的 maestro 走
  `noTools:'builtin'`,没有 grep/find 工具,不构成同一个问题。要不要随包二进制是另一件事。

## 落地

| 文件 | 改了什么 |
|---|---|
| `src/main/maestro/llm/piAgentDir.service.ts` **(新增)** | 纯模块,**不 import electron** —— 与 `cli/micromeetCliPath.service.ts` 同一个理由:「目录选在哪」「迁移搬了什么」是这里唯一值得测的判断,而一旦伸手去拿 `app.getPath()` 就测不动了。导出 `PI_DIR_NAME` · `PI_STATE_FILES` · `resolveMaestroPiPaths()` · `migratePiStateFiles()`(返回实际拷了哪几个文件) |
| `src/main/maestro/llm/llmPaths.ts` | 收缩成 Electron 侧的薄壳:新增 `maestroAgentDir()`,auth/models 改为从 `resolveMaestroPiPaths()` 取;`configureMaestroPiAgentDir()` 设环境变量 |
| `src/main/app.main.ts` | `initializeCorePrerequisites` 里 `initDirectory()` 之后调 `configureMaestroPiAgentDir()`,并打一行 `[maestro] pi agentDir=…` |
| `agentRuntime.types.ts` · `BaseAgent.ts` · `maestroAgent.service.ts` | `agentDir?` 贯通到 7 个 agent 构造点(值 = `maestroAgentDir()`) |
| `piRuntimeAdapter.ts` | `createAgentSession({ …, agentDir })` |

环境变量与入参**两条都下**:环境变量管 pi 冻结的 `TOOLS_DIR` 与内部所有 `getAgentDir()` 调用,
入参管 pi 为这个会话现场 `new` 的那个 resourceLoader。少任何一条都会留下一条读回 `~/.pi/agent` 的路。

## 验证

- `yarn test:maestro-pi-agent-dir` —— 5 条全绿。断言的是**迁移语义**(缺哪个补哪个 · 目标侧优先 ·
  `bin/` 绝不搬 · 二次运行 no-op · 旧目录不存在时不建目录),不是路径拼接。
- `yarn typecheck:node` —— `main` 面 66 个 error、全仓 74 条 distinct,与改动前逐字一致,
  且**本次触及的文件一个都不在其中**(既有基线见 `docs/issues/typecheck-is-a-false-green.md`)。
- `scripts/maestro/check-llm-persistence.mjs` ok。`check-embedded-host.mjs` 的 alias 守卫在 HEAD
  就是红的(`llmModels.ts` / `localClaudeProvider.ts` / `maestroLlm.service.ts` / `net/proxy.ts` /
  多个 renderer 文件),本次新增的文件不在失败清单里;`check-agent-runtime.mjs` 同样在 HEAD 就红
  —— 它断言 `this.session.prompt(message.text)` 字面量,而 steering 那次改动加了第二个入参,
  守卫陈旧,与本次无关。
- 启动一次后人工核对:`<userData>/.pi/` 出现 auth/models,`~/.pi/agent` 不再被写入。
- **不跑 Electron E2E**(CLAUDE.md 纪律)。
