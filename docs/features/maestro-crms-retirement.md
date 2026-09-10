# Maestro · AI-CRMS 链路整体退役

`status: 契约已定,未动代码(2026-09-09)`
`decided: Ral 2026-09-09 —「bl 的 Maestro 不能包含 crms 的东西」`
`上游决策: areas/agent-runtime/sdk/maestro-sdk.html #PQ-7`
`基线证据: 只读清点 + 对抗性复核,2026-09-09,分支 dev/next`
`行号快照: 2026-09-10 复核于 dev/next 工作区`

> 这是**删除契约**,不是实现记录。它存在的理由:这次退役的失败模式不是"删不干净",
> 而是**删错**和**看起来删干净了**。所以 #3(保留面)和 #5(连带面)的分量高于 #2。

### 行号是快照,符号才是锚

这个仓有别的会话在同时改 Maestro(见 #7.6)。本文写下的行号在 **2026-09-10** 复核过一遍,
上一版(2026-09-09 18:44)写的行号已经漂了 —— `docs/features/maestro.md` 整体位移约 +20 行、
`maestroAgent.service.ts` 位移约 +90 行、守卫总数从 42 变成 43。

所以:**每一条都同时给了符号名或字面串**。行号对不上时以符号为准,用下面这组命令重新定位,
不要照着行号盲删:

```bash
grep -rn "ai-crms\|AiCrms\|AI_CRMS\|AI-CRMS" src/ | grep -v node_modules   # 应用层
grep -rn "micromeet-cli\|MicromeetCli\|MICROMEET_CRMS" src/ scripts/ *.yml package.json
grep -rn "Integration" src/main/maestro/xpc/coach.handler.ts               # XPC 面
ls scripts/maestro/check-*.mjs | grep -v check-maestro | wc -l             # 守卫计数
```

**收敛判据**:第一条命令的输出只剩 #3 列出的保留项时,应用层才算删干净。

---

## 1. 决定与依据

### 1.1 决定本身

Ral 2026-09-09:

> 「bl 的 Maestro 不能包含 crms 的东西」

这不是"不用 `ai-crms` 那个 provider",是**整条链路清除**。代价已经被明确接受:
**bitterless 从此没有 `ai-crms` 这个 LLM provider**。

上游依据是 `areas/agent-runtime/sdk/maestro-sdk.html` 的 **PQ-7** —— Maestro SDK 要脱离
micromeet 后端才能成为一个独立的宿主运行时;只要 bl 里还留着一条通往 crms.micromeet.ai 的
凭据链,这个边界就是假的。

### 1.2 四条子决定(Ral 2026-09-09 逐条拍板)

原话:「Q1 和 ai crms 有关 就需要撤掉 Q2 bl语音也 撤掉先 Q3 BL 不用 micromeet cli 的 其他按你的建议来」

| # | 问题 | 裁决 | 直接代价 |
|---|---|---|---|
| D1 | Workbench **Integration 子系统**整体退役,还是只砍 crms 目的地? | **整体退役** | Workbench 少一个面板 + agent 少 **13** 条工具 |
| D2 | Control 的**语音录音 / 转写**要不要一并退役? | **一并退役,连录音按钮 UI** | 所有 provider 的会话都失去语音输入 |
| D3 | vendored 的 `packages/micromeet-cli` 要不要移除? | **移除** | 打包链 6 条 `_package:*` 要改,下次发版需重跑完整打包验证 |
| D4 | 盘上凭据一次性清理做到哪一档? | **中档**(见 #6) | 需要一段带 sunset 的迁移代码 |

D1 的理由(清点者建议、Ral 采纳):`IntegrationTargetDestinationKind` 只有 `'ai-crms'`
一个成员,每个 target 都硬编码 `destination: { kind: 'ai-crms' }`。留一个没有目的地的面板,
等于留一堆能 dry-run 但永远 apply 不了的按钮,比删掉更难解释。

D2 的理由:`scribeAudio` 的唯一后端就是 CRMS(core 预签名上传 + Bailian ASR relay),
没有第二个 provider 可切。只留一个按了就报错的麦克风是更差的结果。想保住语音输入
需要先定一个新的 ASR 后端 —— **那是新需求,不在本次范围**。

D4 的第五条:`docs/features/maestro.md` 正文改成"已退役",安全契约段移 `docs/issues` 留档。
理由见 #5.3 —— **这个文件被 7 个守卫机读**,不是普通说明文档。

### 1.3 这份契约不重新讨论什么

上表四条已定。以下不再提出:是否保留 recorded-site 的抓包→契约能力(D1 已答否)、
是否换一个 ASR 后端(D2 已答:新需求)、是否把 CLI 留着只删凭据同步(D3 已答否)。

---

## 2. 删除面

按**执行批次**组织,每批之后代码可编译。行号取自 2026-09-09 的 `dev/next` 工作区;
**动手前逐条自己复核** —— 另一个会话正在改其中几个文件(见 #7.4)。

### 批 A · 应用层叶子(renderer,无人 import 它们)

| 位置 | 动作 |
|---|---|
| `src/renderer/maestro/control/src/ChatPanel.vue:26-27, 63-131, 143-193, 197-223, 227-288` | 删语音全链路:`VOICE_SCRIBE_*` 常量、`voiceRecording`/`voiceBusy`/`voiceRecorder`/计时器状态、`concatPcmChunks`/`resamplePcm`/`encodeWav` 三个 PCM 工具、`appendTranscript`、`promptAiCrmsLogin`(`:206`)、`ensureAiCrmsScribeReady`(`:216`)、`startVoiceScribe`(`:227`)、`stopVoiceScribe`(`:249`,含 `:268` 的 `coach.scribeAudio`)、`:284-285` 的切换、`:288` 的 `onBeforeUnmount` |
| `ChatPanel.vue:3, 854-859, 955-956` | 模板侧:删波形 `<span class="chat-panel__voice-wave">` 五条 bar、录音按钮的 `IconPlayerPause`/`IconMicrophone` 分支;`:3` 的 import 里**只摘 `IconMicrophone` 与 `IconPlayerPause`**,其余 tabler 图标留着 |
| `ChatPanel.less:273-330, 502` | 删 `.chat-panel__voice-recording` / `__voice-wave` / `__voice-wave-bar`(含 5 条 nth-child)/ `__voice-time` / `__voice-button--recording` 与 `chat-panel-voice-wave-pulse` 动画 —— `check-chat-composer.mjs:51` 正在断言 `.chat-panel__voice-wave-bar` 存在,那条断言同批改 |
| `src/renderer/maestro/control/src/ControlApp.vue:21, 368` | 删 `AUTH_BROADCAST` import 与那整块 `xpcRenderer.subscribe(AUTH_BROADCAST, …)` 订阅 |
| `src/renderer/maestro/control/src/ControlApp.vue:65, 70, 78, 96, 144` | **不是简单删除**,见 #3.6。注意闸门有**四个**调用点(`:70` filter、`:78` continue、`:96` `activeLlmProviderAllowed`、`:144` 切换守卫),上一版契约只点了两个 |
| `src/renderer/maestro/workbench/src/views/WorkbenchIntegrationsView.vue` | 整文件删(D1) |
| `src/renderer/maestro/workbench/src/views/WorkbenchIntegrationsView.less` | 随视图删 |
| `src/renderer/maestro/workbench/src/workbench.router.ts:4, 18` | 删 import 与 `/integrations` 路由 |
| `src/renderer/maestro/workbench/src/workbench.store.ts:140` | 从 `workbenchPanes` 数组删 `'integrations'`(它是 `preferredWorkbenchPane()` 的合法性表,漏删 = 存量偏好把人送进一个不存在的路由) |
| `src/renderer/maestro/workbench/src/workbench.store.ts:22-29, 241-251, 404-405, 442-443, 479, 509, 638-706` | 删 8 个 `Integration*` 类型 import、`:241-251` 的十个状态字段、`selectedIntegrationTarget` getter、三处 `activePane === 'integrations'` 刷新钩子(`:442-443` 还带一个 `xpcRenderer.subscribe('coach/integration-targets-changed')`,别只删 if 留订阅)、`refreshIntegrationTargets` 起到 `createAiCrmsMigrationTarget` 止的整段方法 |
| `src/renderer/maestro/workbench/src/workbench.store.ts:288` | `{ key: 'integration', label: 'Integration' }` —— 工具分类表里的这一项在 13 条工具删完后是空分类,一并删 |
| `src/renderer/maestro/common/networking/clients/endpoint.client.ts` | 整文件删(批 A 做完已无消费者) |
| `src/renderer/maestro/common/networking/api/coachEndpoint.api.ts` | 整文件删 |

### 批 B · Integration 子系统与 agent 运行时(main,自上而下)

**顺序敏感:上层先断引用,下层后删文件。**

| 位置 | 动作 |
|---|---|
| `src/main/agent/hostToolCatalog.ts` 约 `148-264`(13 条 `category: 'integration'`,锚点行 151/160/169/178/187/196/205/214/223/232/241/250/259) | 删这 13 条目录条目。`list_integration_targets` · `create_integration_target_from_capture` · `create_ai_crms_migration_target` · `run_integration_dry_run` · `run_recorded_site_sync_dry_run` · `plan_recorded_site_sync` · `apply_recorded_site_sync` · `run_integration_migration` · `run_integration_report_readiness` · `set_integration_schedule` · `list_integration_mappings` · `upsert_integration_mapping` · `delete_integration_mapping` |
| `src/main/maestro/windows/main/maestroWindow.controller.ts:1174-1332`(`name: 'list_integration_targets'` → `name: 'delete_integration_mapping'`) | 删对应的 **13 条工具声明块**。目录与声明必须同批删:留声明删目录 → 每次启动喷 `missing catalog entry`(`check-host-tools.mjs:158` 证实这条路径);留目录删声明 → 永久误导模型的工具说明书 |
| `maestroWindow.controller.ts:67, 69-71, 73-74` | 删 `integrationScheduler` / `IntegrationService` / `IntegrationServiceState` 与 `normalizeRecordedSiteHost` / `recordedSiteHostMatches` 的 import |
| `maestroWindow.controller.ts:215, 231` | 删构造参数 `public readonly integrationService: IntegrationService` 与 `this.integrationService.setState(this)` |
| `maestroWindow.controller.ts:420-423, 1774` | 删 `integrationScheduler.start({…})` 与 `await integrationScheduler.stop()` |
| `maestroWindow.controller.ts:641-722` | 删 15 个 XPC 转发方法(`listIntegrationTargets` → `deleteIntegrationMapping`)与 `handleIntegrationSchedulerEvent` |
| `maestroWindow.controller.ts:678-688` | 上一格里那段用 `recordedSiteHostMatches` 按 target 域名找 tab 的逻辑 —— 入参是 integration target,随子系统走 |
| `maestroWindow.controller.ts:795-845` | 删 13 个 `tool*` 转发方法(`toolListIntegrationTargets` → `toolDeleteIntegrationMapping`) |
| `src/main/maestro/xpc/coach.handler.ts:47-63` | 删 17 个 `Integration*` 类型 import |
| `src/main/maestro/xpc/coach.handler.ts:183-239`(`listIntegrationTargets` → `deleteIntegrationMapping`,`createAiCrmsMigrationTarget` 在 `:195`) | 删 13 个 XPC 方法 |
| `src/main/maestro/integration/integration.service.ts` | 整文件删 |
| `src/main/maestro/integration/integrationTarget.service.ts` | 整文件删 |
| `src/main/maestro/integration/integrationRunner.service.ts` | 整文件删 |
| `src/main/maestro/integration/integrationScheduler.service.ts` | 整文件删 |
| `src/main/maestro/integration/integrationMapping.service.ts` | 整文件删 |
| `src/main/maestro/integration/recordedSite/**` | 整目录删(`rowMapping.ts` 的 `recordedSiteAiCrmsBody` / `aiCrmsIdFromResponse` / `ai_crms_*` 字段别名表全在这里) |
| `scripts/maestro/check-ioc-composition.mjs:35-40` | 删 `IntegrationService` 那一项。**这是第 6 个要改的守卫,上一版契约漏了** —— 它 `readMaestro('main/integration/integration.service.ts')`,文件删掉后是 **ENOENT 直接抛**,不是断言失败,整个 IoC 守卫当场哑掉 |
| `src/main/agent/runtime/coachRuntimeAdapter.ts:2, 6, 18` | **不是删文件**,见 #3.7 —— 路由退化为直接返回 `this.pi` |
| `src/main/agent/runtime/aiCrmsRuntimeAdapter.ts` | 整文件删(**必须在上一行改完之后**) |
| `src/main/agent/maestroAgent.service.ts:90, 92` | 删 `uploadFileThroughAiCrmsCore` 与 `resolveAiCrmsRelayEndpoint` 两个 import。**`:91` 的 `uploadMediaRefsForProvider` 留着**(通用媒体上传,见 #3.1) |
| `src/main/agent/maestroAgent.service.ts` 的 `AuthSession` / `SessionApi` 类型 import 与 `maestroSession` emitter | 随 `session.api.ts` 一起删(符号锚:`createXpcMainEmitter<SessionApi>('MaestroSessionDao')`) |
| `src/main/agent/maestroAgent.service.ts:735-930`(`async scribeAudio(`) | 删 `scribeAudio` 全链路,含 `'ai-crms-asr-upload'` / `'ai-crms-asr-request'` / `'ai-crms-asr-response'` / `'ai-crms-asr-error'` 四个 phase 与 `:747` 的 `'ai-crms-login-required'` |
| `src/main/agent/maestroAgent.service.ts:1701-1702` | 删 `mediaUploadSessionForProvider`(`providerId !== 'ai-crms'` 就返回 null) |
| `src/main/agent/maestroAgent.service.ts:1640-1643` | 调用点:删 `session: await this.mediaUploadSessionForProvider(…)` 这一参数,`uploadMediaRefsForProvider` 本身保留 |
| `src/main/agent/runtime/agentPrompt.ts:19` | 删 `AI_CRMS_ASR_MODEL` 及其 Fun-ASR-Flash / DashScope 解析分支 |
| `src/main/agent/runtime/agentRuntime.types.ts:81` | 删 `COACH_AI_CRMS_TOOL_ROUNDS` 环境变量契约 —— 留着就是一个永久死配置 |
| `BaseAgent.ts:83-84, 283` · `piRuntimeAdapter.ts:428` · `toolResultFailure.ts:10` · `compaction.handler.ts:67` · `debuggerCapture.ts:454` | 只有注释提到 AI-CRMS,改注释;**不动代码** |

> **`maestroWindow.controller.ts` 是本批的第二大改动面,上一版契约只点了两行。** 实际是
> import / 构造参数 / 调度器起停 / 15 个 XPC 转发 / 13 个 tool 转发 / 13 段工具声明,六处分散。
> 漏任何一处都是编译错误(好事),但**漏 `:420` 的 `integrationScheduler.start()` 是运行期**
> 才炸 —— 它引用的 `handleIntegrationSchedulerEvent` 已经不在了。

### 批 C · tab / LLM / 网络 / 会话契约(main + shared)

| 位置 | 动作 |
|---|---|
| `src/main/maestro/windows/main/maestroWindow.controller.ts:1116-1118, 1778` | 删 `openAiCrmsLoginTab()` 与 `await this.browserView.quiesceAuthBridge()` |
| `src/main/xpc/maestroWindow.handler.ts:10-11, 22, 25, 196, 220-221, 338-347` | 删 authBridge import、CLI import、`SessionApi` 类型与 `maestroSession` emitter、boot 阶段的 `getSession` + `writeMicromeetCliCredential`、`ensureMicromeetCliIntegration()`、`performAuthCleanup` 里两处 `authBridge.quiesce` 与 `clearSession` / `writeMicromeetCliCredential(null)` |
| `src/main/maestro/windows/main/maestroBrowserView.service.ts:13-16, 37, 58-60, 154, 211-213, 310-311, 437-450, 675-676, 695-719, 722-731, 744-789, 824-828, 856-857, 893-915, 966-995, 1042-1044, 1069, 1108-1109, 1292-1295, 1346-1350, 1370-1375, 1647` | **本次改动最大的单文件**。删 imports、`AI_CRMS_LOGIN_URL`/`AI_CRMS_TITLE`/`AI_CRMS_FAVICON`、`OperationTab.bridgeCapture` 字段、`authBridgeOwner`/`authBridgeCleanup`/`aiCrmsPreparation` 字段、`addAiCrmsLoginTab`、`preventAiCrmsEscape`、`detachAuthBridgeForView`/`detachAuthBridge`/`quiesceAuthBridge`、`queueAiCrmsPreparation`、`prepareAiCrmsTab`、`openAiCrmsLoginTab`,以及散落的 `kind === 'ai-crms'` 分支。**`bridgeCapture` 是 authBridge 独占的 debugger 拥有者,与普通 tab 的 `capture` 不是同一个东西 —— 只删 `bridgeCapture`**。符号锚见下方 grep |
| `src/main/maestro/auth/authBridge.ts` | 整文件删(**必须最后** —— 它是被引用方) |
| `src/main/app.main.ts:348, 355` | 删 `maestroHandler` 里 `url.origin === 'http://crms.micromeet.ai'` 的整个分支与 `mockResponse('/ai-crms', request)`;删后只剩 `return deniedResponse(request)` |
| `src/main/maestro/llm/maestroLlm.service.ts:40, 129, 148-176, 204-206, 255, 281, 298, 347-348, 455-461` | 删 `buildAiCrmsPiProviderConfig` import、`openAiCrmsLoginTab` 端口声明、`syncAiCrmsProviderModels`(含 `:161` 的 `providers['ai-crms'] = providerConfig` —— 这就是 #6.1 那枚 JWT 的写入点)、`checkLlmProviderReady` 的 ai-crms 分支、三处 sync 调用、`performLlmLogin` / `logoutLlm` 的 ai-crms 分支;`AuthSession` / `aiCrmsSession` 随 session 契约走 |
| `src/main/maestro/llm/llmModels.ts:18, 39-40, 59-60, 152, 159-160, 176, 291-292, 300` | 删注释、`LLM_PROVIDERS` 条目、**`LLM_PRESETS` 的 `ai-crms/qwen3.7-plus` 条目**、`DEFAULT_PRESET_MODEL` 项、`LLM_LOGIN_PROVIDERS` 条目、`normalizeLlmProvider` 别名行、`describeLlmTarget` 的 supplier 分支、`providerLabel` 的 `'Micromeet'`(行号是各条目的锚点行,条目本身跨若干行) |
| `src/main/maestro/settings/coachSettings.service.ts:15, 84` | 删 `DEFAULT_MODEL_BY_PROVIDER` 的 `'ai-crms'` 与 `normalizeLlmProvider` 的别名行 |
| `src/main/maestro/networking/api/aiCrmsRelay.api.ts` | 整文件删 |
| `src/main/maestro/networking/api/aiCrmsCoreFileUpload.api.ts` | 整文件删 |
| `src/main/maestro/networking/clients/relay.client.ts` | 整文件删。**注意 `src/main/sniping/snipingRelay.client.ts` 只是名字像,见 #3.9** |
| `src/main/maestro/networking/api/mediaUpload.api.ts:7-9, 14, 25, 43, 73, 76, 82-83, 89, 100-103` | **文件保留,只摘 crms 分支**,见 #3.1 |
| `src/shared/maestro/networking/coachEndpoint.ts` | 整文件删 |
| `src/shared/maestro/networking/coachRegion.ts` | 整文件删 |
| `electron.vite.config.ts:58-70` | 删 `__COACH_BUILD_REGION__` 与 4 个 `__COACH_AI_CRMS_RELAY_BASE_URL*__` define(及对应 `VITE_COACH_REGION` / `VITE_COACH_AI_CRMS_RELAY_BASE_URL*` 读取)。不删 = relay 域名继续被烤进每一个 renderer bundle |
| `src/preload/maestro/sqlite.preload.ts:66` | 删 `await import('./sqlite/session.dao')`;**同一行位置换上 #6 的一次性清理**,不是纯删除 |
| `src/preload/maestro/sqlite/session.dao.ts` | 整文件删。**别删成 `src/preload/sqlite/dao/session.dao.ts`,见 #3.4** |
| `src/shared/maestro/session.api.ts` | 整文件删(**所有消费者之后**) |
| `src/shared/maestro/coach.api.ts` —— **最后一步**,逐个符号见下表 | 此时全部消费者已清,类型联合坍缩不会报错 |
| `src/shared/maestro/config.api.ts:10, 59, 64` | 改注释(它给 `integration-targets` / `integration-mappings` 两个 domain 写的是数据契约说明,那两张表不存在了);domain 常量本身随 #6 处理 |
| `src/shared/diagnostics/applicationDiagnostics.contract.ts:84-86, 88-89` | 删 `COACH_AI_CRMS_CORE_BASE_URL` / `COACH_AI_CRMS_MEDIA_UPLOAD_URL` / `COACH_AI_CRMS_RELAY_BASE_URL` / `MICROMEET_CLI_PATH` / `MICROMEET_CRMS_CREDENTIAL_FILE`。**`:87` 的 `COACH_MEDIA_UPLOAD_URL` 夹在中间,必须保留** |
| `src/main/diagnostics/diagnosticEnvironment.service.ts:21-23` | 同批删同样三个键(`:24` 的 `COACH_MEDIA_UPLOAD_URL` 保留)。**这两处必须同批** —— 只删 contract → `Type '"COACH_AI_CRMS_CORE_BASE_URL"' is not assignable to ApplicationDiagnosticEnvironmentKey`;只删 service → 诊断面板永远展示三个再也不会被设置的端点 |
| `src/renderer/maestro/home/src/views/layout/Layout.vue:66` | 注释把 boot splash 说成"等 AI-CRMS 加载完",改文案 |

#### `coach.api.ts` 逐个符号

**该文件正在被另一个会话改动,行号漂得最快(9-09 到 9-10 已偏 +11)—— 按符号删。**

| 行 | 符号 |
|---|---|
| `:12` | `MAESTRO_AI_CRMS_LOGIN_DISPLAY_URL = 'bitterless://ai-crms-login'` |
| `:66` | `createAiCrmsMigrationTarget(...)` 方法签名 |
| `:154` | `scribeAudio(...)` 方法签名 |
| `:290` | `TabKind` 的 `'ai-crms'` 成员 |
| `:291` | `WorkbenchPane` 的 `'integrations'` 成员 |
| `:309` | `IntegrationTargetSourceKind` 的 `'ai-crms-migration'` 成员 |
| `:310` | `IntegrationTargetDestinationKind` **整个类型**(唯一成员就是 `'ai-crms'`) |
| `:437-438` · `:473-474` | `IntegrationMappingEntry` 与 `IntegrationMappingUpsertRequest` 的 `aiCrmsId` / `aiCrmsLabel` |
| `:499` · `:505` | `IntegrationTarget` 的 `source.kind` 与 `destination` 字段 |
| `:525-526` | `IntegrationTargetSummary` 的 `sourceKind` / `destinationKind` |
| `:678` | `LlmProviderId` 的 `'ai-crms'` 成员(联合末尾有 `\| string`,删它不产生编译错误,但要删才不留误导) |
| `:910` · `:923` | `AudioScribeErrorCode`(含 `'ai-crms-login-required'`)与引用它的 `code?` 字段 |
| — | `IntegrationMigrationTargetRequest` · `AudioScribeRequest` · `AudioScribeResult` 三个接口整体 |

### 批 D · CLI 与打包链

| 位置 | 动作 |
|---|---|
| `src/main/maestro/cli/micromeetCli.service.ts` | 整文件删(realm 硬编码 `'crms'`) |
| `src/main/maestro/cli/micromeetCliPath.service.ts` | 整文件删 |
| `packages/micromeet-cli/` | 整目录删 |
| `scripts/prepare-maestro-cli.cjs` | 整文件删 —— **但它顺带做的 stage-root 清空必须补掉,见 #5.5** |
| `package.json:69` | 删 `test:maestro-cli-channel` |
| `package.json:102` | 删 `prepare:maestro-cli` |
| `package.json:109, 112, 115, 118, 125, 128` | 6 条 `_package:*` 各删一段 CLI 调用(`:109` 是 `yarn prepare:maestro-cli`,其余 5 条是 `node scripts/prepare-maestro-cli.cjs <target>`) |
| `scripts/maestro/externalTools.cjs:631-645, 684, 686, 702` | 删 `cliFilenameForTarget` / `validateCliStage` 与两处调用;`verifyStagedExternalTools` 的 `extraFiles` 从 `['manifest.json', cliFilename]` 改成 `[]` |
| `electron-builder.yml:34-35` 与 `electron-builder.tmp.yml:34-35` | 删 `'!packages/micromeet-cli/**'` 与 `'!node_modules/@micromeet/cli{,/**}'` |
| `electron-builder.yml:168` 与 `electron-builder.tmp.yml:168` | 删 mac 签名列表里的 `Contents/Resources/maestro-tools/micromeet` 一行。**只删这一行,`bun`/`rg`/`fd`/`anydoc.node`/`ouch` 留着,见 #3.3** |
| `scripts/maestro/_harness.mjs:6` | 删 `cliRoot` 导出(消费者只有两个被删的守卫,已核) |
| `.gitignore:33` | 删 `packages/micromeet-cli/release/` |
| `scripts/maestro/MANUAL_GATES.md:6, 10` | 删"登录生产 AI-CRMS"与"安装/配置打包 `micromeet` CLI"两条人工闸 |

### 批 E · 运行时数据

见 **#6**,与代码删除是两件事:**删 writer 不会删数据**。

---

## 3. 保留面 —— 看着像但绝不能删

> **这一节比 #2 重要。** #2 删错了会编译报错;这一节删错了是**静默的** ——
> 编译通过、守卫通过、下一个人再也查不出来。

### 3.1 `mediaUpload.api.ts` —— 只摘分支,不删文件

`src/main/maestro/networking/api/mediaUpload.api.ts`

`resolveMediaUploadUrl:75-78` 里 crms 只是第一个 `||` 分支:

```ts
const raw =
  (provider === 'ai-crms' ? process.env.COACH_AI_CRMS_MEDIA_UPLOAD_URL : '') ||
  process.env.COACH_MEDIA_UPLOAD_URL ||
  ''
```

后面的 `COACH_MEDIA_UPLOAD_URL` 与 provider 无关,而 `uploadMediaRefsForProvider` 在
`maestroAgent.service.ts:1552` 对**每一个 provider** 调用。整文件删 = **Codex / Claude 会话的
附件上传一起死**,而且是运行期才发现。

正确做法:摘掉 `:76` 与 `:82-85` 两个 `provider === 'ai-crms'` 分支、`:14` 的 `session` 字段、
`:99-104` 里 crms 专用的 `Authorization` / `x-region` / `x-workspace-id` 头,
以及 `:7-9` 的三个 import。`normalizeUploadMediaRefs` / `normalizeUploadMediaRef` /
`extractUploadedUrl` / `uploadOneMediaRef` 全部保留。

### 3.2 `check-chat-composer.mjs` —— 删 13 条断言,不删守卫

`scripts/maestro/check-chat-composer.mjs`

它**现在是绿的**,守的是整个 Chat 输入区:BEM token 校验(`:41`)、样式必须在 `.less` 里
(`:49, :51`)、附件、布局。crms/语音相关的只有 `:21`(读 `aiCrmsCoreFileUpload.api.ts`)、
`:135-143`(9 条语音断言,含 `:143` 的 `scribeAudio` 门面)与 `:154-157`(4 条 core-upload
断言)。删掉整个守卫 = 连带丢掉 Composer 的全部样式与结构约束 ——
这仓的 borderless UI 规矩就是靠这类守卫钉住的。

注意 `:49` 与 `:51` 也要改(它们断言 `.chat-panel__voice-wave-bar` 与 `<style` 缺席),
但那是**改断言**,不是删守卫。

### 3.3 `build/maestro-tools` 这一整套暂存/打包配置

`electron-builder.yml:59-60, 168-173` · `scripts/maestro/externalTools.cjs` · `scripts/prepare-maestro-*.cjs`

`maestro-tools` 目录同时装着 `bun` / `rg` / `fd` / `ouch` / `anydoc.node`,而且
`archive.service.ts:81-82` 与 `anydoc.service.ts:34-35` **各自独立解析这个目录**,
完全不经过 `micromeetCliPath.service.ts`。整块拿掉 = 文件搜索、解压、文档解析全废。

只能精确摘掉 `micromeet` 这一个二进制:`electron-builder*.yml:168` 一行、`validateCliStage()`、
以及 6 个 `_package:*` 里的 `prepare-maestro-cli.cjs` 调用。

### 3.4 `src/preload/sqlite/dao/session.dao.ts` 的 `SessionDao`

与要删的 `src/preload/maestro/sqlite/session.dao.ts` **同名不同物** —— 这是 Bitterless 主 sqlite
的 DAO。**按路径删,别按文件名删。**

### 3.5 Bitterless 自己的账号会话链路

- `src/shared/auth/auth.type.ts` 的 `AuthSessionApi` / `AuthInvalidationPayload`
- `src/main/xpc/auth.handler.ts` 的 `AuthHandler`
- `src/renderer/maestro/localHome/src/localHomeAuth.store.ts` 与 `homeShellBridge.client.ts` /
  `homeShellBridge.contract.ts` 的 `restoreAuthSession` / `cancelAuthSessionRecovery` / `getSessionSummary`

**名字最像、最容易误删的一组。** 这是 Ral 自己 Bitterless 账号的会话契约,与 crms 的
`SessionApi` / `MaestroSessionDao` 是两套完全独立的东西,唯一共同点是都叫 "session"。

特别注意 `maestroWindow.handler.ts:319-321` 的 `assertAuthReady()` —— 它读的是 **bl 账号**的
invalidation marker,不是 crms session。Maestro 开窗的门禁是 bl 账号,所以删 crms **不影响开窗**。

### 3.6 `ControlApp.vue:65` 的 `isControlProviderAllowed`

```ts
const isControlProviderAllowed = (provider: string): boolean => provider !== 'ai-crms'
```

这行是**排除 crms 的闸门**,不是 crms 功能。删掉之后 Control 的 provider 白名单从
「除了 ai-crms」变成「全放行」—— 今天没有区别,加下一个 provider 时才炸。
而且 `tests/maestro/maestroControlProviders.test.mjs:281, 338, 354` 正在断言这个过滤行为。

**处置(推荐)**:保留这个闸门与它的**四个**调用点(`:70` 的 `.filter`、`:78` 的 `continue`、
`:96` 的 `activeLlmProviderAllowed`、`:144` 的切换守卫),只把谓词改成显式的**允许清单**,
并同批更新那三处测试改用另一个 fixture provider。
理由:闸门本身表达的是「Control 面板不是所有 provider 都合适」这条产品约束,
它比 crms 活得久。改成允许清单还顺手把「新 provider 默认不出现在 Control」变成安全默认。

### 3.7 `coachRuntimeAdapter.ts` —— 必须编辑,不能删

`src/main/agent/runtime/coachRuntimeAdapter.ts:2, 6, 18`

`providerId === 'ai-crms' ? this.aiCrms : this.pi` —— **pi 那条也走这个路由器**。
删了 `aiCrmsRuntimeAdapter.ts` 而不先改这里 = 编译不过。退化成直接返回 `this.pi`,
路由器本身保留(它是 `BaseAgent` 的默认运行时入口)。

### 3.8 LLM 侧的三个端口

`src/main/maestro/llm/llmModels.ts`

- **`describeLlmTarget`(约 275-297)只删 ai-crms 那个 supplier 分支。** 这个端口在 SDK 里刻意
  没有默认值,文件里的注释记了一次真实事故:空的后端身份块让用户对着错 provider 的额度提示
  白等六天。整体删掉会编译期炸 `BaseAgent`。
- **`selectableLlmPresets` / `isLlmProviderSelectable` / `requireSelectableLlmTarget` 全部保留。**
  它们不是为 ai-crms 写的 —— Claude(anthropic)也靠同一套「preset 存在但 provider 不可选」
  机制隐藏(见 `llmModels.ts:48-54` 的注释块)。删了会连带打掉 Claude 的隐藏开关。
- **`parseStoredLlmCompressionPrefs`(约 196-216)保留**,只是它会留下一个孤儿键,见 #6.5。

### 3.9 命名撞车,别做全局搜删

| 看着像 | 实际是 | 消费者 |
|---|---|---|
| `src/main/sniping/snipingRelay.client.ts` / `SnipingRelayClient` | Trench 狙击链路 | `snipingIpc` · `snipingBridge` · `monitoringIpc` · `monitoringBridge` |
| `micromeet://only-preview` 与 `src/shared/maestro/compositeTab.identity.ts` 的 micromeet slug | OnlyPreview 与 micromeet-cowork 共用的窗口内嵌端口 | `workbench.store.ts:109` 的 `protocol === 'micromeet:'` |
| `docs/features/maestro.md:163` 的 "bundled-CLI document conversion" | **anydoc**,不是 micromeet CLI(CLI 源码里没有任何转换命令) | `check-artifact-generation.mjs:145` |

按 `relay.client` 或 `micromeet` 做全局搜删会连带打掉 Trench、Monitoring 与 OnlyPreview。

### 3.10 存量迁移兜底,不是残留

`src/renderer/maestro/home/src/components/MenuBar/tab.store.ts:132-134`

```ts
savedKey === 'ai-crms' ? 'home' : savedKey
```

这是**存量 localStorage 的 `LAST_ACTIVE_KEY` 回退**:老机器上这个键可能就存着 `'ai-crms'`,
删掉这段会让首屏落到一个不存在的 tab。它自己不引用任何 crms 代码,是纯字符串迁移。

**保留**,并加一行注释说明 provider 已退役、这行只为存量偏好活着。

### 3.11 E2E fixture 的 `/ai-crms` 路由 —— 改名,不删

`tests/maestro/fixtures/bitterlessApp.fixture.ts:145-149`

它已经被三个和 CRMS 毫无关系的 Trench 用例当作「第二个普通网页」在用:
`tests/coin/specs/trench-index.spec.ts:424` · `trench-omni.spec.ts:534, 738` ·
`trench-skill-integration.spec.ts:453`。直接删路由 → 三条 Trench E2E 一起挂,
排查时会指向 Trench 而不是这次改动。

正确做法:把路由与 `#ai-crms-e2e` 锚点改成中性名(如 `/sample-site` / `#sample-site-e2e`),
同批改那三个 spec 与 `tests/maestro/specs/baseline.spec.ts:143, 284`。

### 3.12 顺手清洁,但不在本次范围

- `src/renderer/maestro/control/src/config/captureConfig.store.ts:22` 与
  `CaptureFilterPanel.vue` 里拿 `crms.micromeet.ai` 当 domain-suffix 示例的占位文案 ——
  抓包过滤器本身是通用的。要改就单开一次,别混进删除 diff。
- 30 份历史 `docs/plan/tasks` · `docs/plan/reviews` · `docs/plan/analysis` 提到 ai-crms ——
  **历史记录,一律不动**。

---

## 4. 刀序

每一步之后**都要编译得过**。步内可以中间态,跨步不行。

| # | 批 | 内容 | 编译得过的理由 |
|---|---|---|---|
| 1 | A | ChatPanel 语音 UI + Less;ControlApp 的 `AUTH_BROADCAST` 订阅 | renderer 叶子,无人 import |
| 2 | A | WorkbenchIntegrationsView(+ .less)· router · workbench.store 的 pane / 状态 / 方法 / 工具分类 | 视图与路由同批 → 不会出现「路由指向已删组件」 |
| 3 | A | `renderer/maestro/common/networking/` 两个文件 | 第 1-2 步做完已无消费者 |
| 4 | B | hostToolCatalog 13 条 **+** controller 13 条声明 | **必须同批**,否则启动喷 `missing catalog entry` |
| 5 | B | coach.handler 的 17 个 import + 13 个方法 | 上层断引用 |
| 6 | B | integration 五个 service + recordedSite 目录 + IoC 注册 | 第 4-5 步已断上游 |
| 7 | B | coachRuntimeAdapter 路由退化 → 删 aiCrmsRuntimeAdapter | **顺序不能反** |
| 8 | B | maestroAgent 的 scribeAudio + mediaUploadSession + imports;agentPrompt;agentRuntime.types | |
| 9 | C | controller 的 `openAiCrmsLoginTab` / `quiesceAuthBridge` → maestroWindow.handler 接线 → maestroBrowserView 全部 crms tab → **最后**删 authBridge.ts | authBridge 是被引用方,必须最后 |
| 10 | C | app.main 的 crms 协议 mock 分支 | |
| 11 | C | maestroLlm.service → llmModels 六处 → coachSettings 两处 | **`LLM_PRESETS` 那条要在这一步删掉,#6.4 的自动回退才成立** |
| 12 | C | aiCrmsRelay.api → aiCrmsCoreFileUpload.api → relay.client → mediaUpload 摘分支 → coachEndpoint.ts → coachRegion.ts | 网络层叶子,此时才没人引用 |
| 13 | C | electron.vite.config 的 5 个 define | |
| 14 | C | 诊断 contract + service **同批** | 只改一侧必然 typecheck 红 |
| 15 | C | sqlite.preload:66 换成 #6 的清理 → 删 session.dao.ts → 删 session.api.ts | |
| 16 | C | **coach.api.ts 全部类型成员** | 此时消费者已清,联合坍缩(`IntegrationTargetDestinationKind` 删掉唯一成员会变 `never`)不会报错 |
| 17 | D | micromeetCli.service + micromeetCliPath.service + prepare-maestro-cli.cjs + packages/micromeet-cli | |
| 18 | D | package.json 8 处 → externalTools.cjs → electron-builder ×2 → _harness.mjs → .gitignore → MANUAL_GATES.md | |
| 19 | E | 一次性清理迁移(#6) | |
| 20 | — | 守卫:删 5 个 → 改 `check-maestro.mjs` 计数(43 → 38,当天重数)→ 改 **6** 个守卫断言(#5.2) | |
| 21 | — | 测试:改 7 个测试 + fixture 改名(#5.4) | |
| 22 | — | 文档:`maestro.md` 逐条改写 + `docs/issues` 留档 + 两处活账本(#5.3) | |

**第 16 步的机制**:`TabKind` 删 `'ai-crms'` 后,`maestroBrowserView` 里 14 处
`tab.kind === 'ai-crms'` 变成 **TS2367(比较无重叠)** 而不是自动消失 ——
必须逐处删分支(第 9 步),不能只删类型成员。

---

## 5. 连带面

### 5.1 `check-maestro.mjs` 的硬计数 —— 最阴的一条

`scripts/maestro/check-maestro.mjs:12`

```js
assert(checks.length === 43, `expected 43 Maestro parity checks, found ${checks.length}`)
```

这是 `yarn check:maestro` 的**第一行有效逻辑**,跑在任何一个检查**之前**。删完 5 个守卫后
`checks.length` 变 38,它当场抛 —— 剩下 38 个守卫一个都不会执行。
表面像"守卫都清干净了",实际是**整条防线静默失效**。

**断言值与消息文字都改成 38。**

> 核对方法:`ls scripts/maestro/check-*.mjs | grep -v check-maestro | wc -l`。
> 2026-09-10 是 **43**,删 `check-ai-crms-relay-config` · `check-ai-crms-runtime` ·
> `check-cli-integration` · `check-cli-domain-commands` · `check-integration-target` 之后是 **38**。
>
> **这个数字自己会漂。** 上一版契约(9-09 18:44)写的是「42 → 37」,一天之内别的会话加了一个
> 守卫就作废了。动手当天**重跑一次上面这条命令**,以实际输出减 5 为准,不要照抄本文的 38。

### 5.2 守卫逐个点名

**删除(5 个)**

| 守卫 | 今天状态 | 理由 |
|---|---|---|
| `check-ai-crms-relay-config.mjs` | 绿 | 整份都在断言 crms relay 配置 |
| `check-ai-crms-runtime.mjs` | 绿 | 起本地 SSE server 打 `CoachRuntimeAdapter` 的 crms 分支 |
| `check-cli-integration.mjs` | 绿 | 整份断言 CLI shim / crms 凭据同步;`:3` 用 `cliRoot` |
| `check-cli-domain-commands.mjs` | 绿 | `readFileSync(join(cliRoot, 'src/commands.ts'))` 等 6 个 CLI 源文件 —— CLI 目录删掉后是 **ENOENT 直接抛**,不是断言失败 |
| `check-integration-target.mjs` | **已红** | 断言 `createAiCrmsMigrationTarget` / `recordedSiteAiCrmsBody` / `runMicromeetCli`;`:18` 自己拼 `packages/micromeet-cli` 路径(不走 `_harness`) |

**改断言,守卫留着(6 个)**

| 守卫 | 改哪 | 为什么不能删守卫 |
|---|---|---|
| `check-agent-runtime.mjs` | 删 `:17`(读 `aiCrmsRuntimeAdapter.ts`)、`:19`(读 `check-ai-crms-runtime.mjs` 源码)、`:81`、`:106-127`、`:171` 的 AI-CRMS 断言 | 它同时守着 pi / Codex 运行时。**文件删了 `readFileSync` 直接 ENOENT** |
| `check-chat-composer.mjs` | 删 `:21`、`:135-157`;改 `:49`、`:51`(语音样式断言) | 见 #3.2 —— 它守着整个 Composer 的 BEM 与样式约束 |
| `check-media-upload.mjs` | 删 `:141-214` 的 `providerId: 'ai-crms'` 用例与 `loadTsModule(aiCrmsCoreFileUpload.api)` | 保留通用 `COACH_MEDIA_UPLOAD_URL` 用例;`:134-135` 两条文档断言与 crms 无关 |
| `check-embedded-host.mjs` | 删 `:35`(读 `prepare-maestro-cli.cjs`)、`:52`(`createXpcMainEmitter<SessionApi>('MaestroSessionDao')`)、`:93`(`prepareCli.includes("packages', 'micromeet-cli'")`) | **它不是 crms 守卫** —— 还看着 E2E 网络隔离、SQLCipher key 文件模式、userData 分区、Mini Apps 卡片注册。`:35` 在脚本删除后是 ENOENT |
| `check-startup-settings.mjs` | 删 `:82-85`(断言 `loadURL(AI_CRMS_URL)`)与 `:87`(断言文档含 `'Pinned AI-CRMS tab'`);把 `:120`/`:123` 的 `'pinned-ai-crms'` 改成 `'pinned-local-home'` | 它守着 startUrl 归一化与 GPT-5.5 preset 保留。**这条今天就是红的**,是既有欠账,顺手一起清 |
| `check-ioc-composition.mjs` | 删 `:35-40` 的 `IntegrationService` 那一项 | **上一版契约漏了这个守卫。** 它 `readMaestro('main/integration/integration.service.ts')` —— 文件删掉后是 **ENOENT 直接抛**,不是断言失败,连带 `MaestroLlmService` / `BrowserView` / `Capture` / `Skill` / `MaestroAgentService` 等 9 项 IoC 断言一起哑掉 |

**不改断言,但约束文档改法(3 个)** —— 见 #5.3。

### 5.3 `docs/features/maestro.md` —— 被 7 个守卫机读的契约文件

**先说清楚谁在读它**,因为"改文档"在这个仓里是一次带断言的改动:

| 守卫 | 断言的字符串 | 处置 |
|---|---|---|
| `check-cli-integration.mjs:93` | `'Bundled Micromeet CLI invocation and credential synchronization'` | 守卫一起删 → **句子可以删**(在 `:213-214`) |
| `check-integration-target.mjs:797` | `'integration targets'` **且** `'dry-run/apply/readiness flows'` | 守卫一起删 → **句子可以改**(在 `:201-202`) |
| `check-startup-settings.mjs:87` | `'Pinned AI-CRMS tab'` | 该串**今天就已不存在**(grep 零命中),断言一起删 |
| `check-llm-persistence.mjs:33` | `'provider/model/effort/compression selection'` | **必须保留这句**(在 `:179`) |
| `check-media-upload.mjs:134` | `'Attach/drop/paste for supported text, image, PDF'` | **必须保留** |
| `check-media-upload.mjs:135` | `'No credential value is written into the Bitterless repository or log output.'` | **必须保留**(在 `:324`)—— 这是凭据边界那句,与 crms 无关,退役后更该留着 |
| `check-inject-button.mjs:85` | `'domain injections'` | **必须保留**(在 `:201`,与要删的 integration 三项**同一行**,见下表) |
| `check-artifact-generation.mjs:145` | `'workspace-scoped'` 且 `'file search/read/write; artifact'` | **必须保留**(在 `:183-184`)。注意那句里的 "bundled-CLI document conversion" 指 anydoc,不是 micromeet CLI —— **别顺手删** |

**逐处改法**(行号为 2026-09-10 快照,`maestro.md` 现 584 行;上一版契约的行号整体偏小约 20):

| 行 | 现状 | 改法 |
|---|---|---|
| `:176-179` | "Maestro Control omits Micromeet (`ai-crms`) and Local (`local`) choices…" | 删掉 Micromeet 那半句,保留 Local 的表述与 `:179` 的 `provider/model/effort/compression selection` 整句 |
| `:183` | "bundled-CLI document conversion" | **不动**(是 anydoc,且 `:183-184` 带着 artifact 守卫要的两个串) |
| `:194` | "Voice recording and AI-CRMS transcription within the upstream five-minute limit." | **整条删** |
| `:201-202` | "…domain injections, integration targets, mappings, dry-run/apply/readiness flows, app-open schedules, host tools, models, About, and Log." | 只删 `integration targets` / `mappings` / `dry-run/apply/readiness flows` 三项。**`domain injections` 在同一行,必须留**(`check-inject-button.mjs:85`)—— 这行是本次最容易一刀切错的一行 |
| `:213-214` | "Bundled Micromeet CLI invocation and credential synchronization remain available…" | **整条删** |
| `:221` | "after the Micromeet CLI build clears and recreates the staging root" | 改成 external-tools 自己建 stage 的表述(见 #5.5) |
| `:286-300` | 两段 "The bundled Micromeet CLI resolves its executable and writable paths by desktop release channel…" / "Preview instead places its shim, `credentials/crms.json`…" | **整两段删**,并同步 `docs/features/desktop-release-channels.md:24-30`(**第二份活的 feature 文档**) |
| `:302-306` | "Preview installs this environment boundary before any directory, permission, shim, or cleanup I/O…" | 这段讲的是 **CLI setup 的启动时序**,随 CLI 删。但 `:306` 的"handler 模块是进程级 import、不被重复注册"与 CLI 无关 —— **保留那一句** |
| `:319-322` | AI-CRMS 专用登录 tab 的安全契约 | **移到 `docs/issues/maestro-crms-retirement-security-record.md` 留档**,正文只留一句"AI-CRMS provider 已于 2026-09 退役"(D4 第五条) |
| `:329-332` | "Bundled Micromeet CLI credentials use a random local key…" 加密封套要求 | 同上,一起移进那份留档 |
| `:522` | "The fixed first tab is a local `home` tab rather than the legacy remote `ai-crms` tab." | **删掉对比句,不要反写** —— 现在没有 ai-crms 可对比,写成"固定首 tab 是本地 home tab" |
| `:542` | "AI-CRMS provider/login code is not allowed to navigate or replace this fixed tab." | 改成"任何 provider 的登录代码都不得导航或替换这个固定 tab"(约束比 crms 活得久,别连约束一起删) |
| `:554` | 排除项列表 "Cowork's forked CRMS renderer, AI-CRMS avatar/profile UI…" | 改成只说排除 Cowork 的 forked 渲染器,删 AI-CRMS avatar/profile |
| `:574` | `yarn check:maestro` 覆盖面列表里的 "auth, integrations, and packaging paths" | 删 `integrations` |
| `:580-581` | 验收清单 "AI-CRMS/Codex login… skills/injections/integrations/tools/models." | 删 `AI-CRMS`(留 Codex)与 `integrations` |
| `:582` | 打包验收 "…native SQLite ABI, CLI extra resource, signing/entitlements…" | 删 `CLI extra resource` |

**另外两份活账本**:

- `docs/issues/maestro-parity-guards-revived.md:51` —— 更新 `check-startup-settings` 那一行。
  **不要删这份 issue**,它还盖着另外 13 条与 crms 无关的红守卫。
- `docs/issues/maestro-cowork-menubar-controls-outdated.md`(未关闭,5 处提到 crms)—— 逐处更新。

### 5.4 测试

| 测试 | 现象 | 处置 |
|---|---|---|
| `scripts/maestro/micromeetCliChannelIsolation.test.ts` | `import … from '../../src/main/maestro/cli/micromeetCliPath.service.ts'` → **模块解析失败**,不是断言失败 | 整文件删 + 删 `package.json:69` |
| `tests/maestro/maestroContextExport.test.mjs:68, 74, 145-146` | `:68` `load('…/aiCrmsRuntimeAdapter.ts')` → **ENOENT 硬失败**;`:145` 是整条 `'AI-CRMS exposes no context surface…'` 用例 | 删 `:68`/`:74` 的加载与 `:145` 整条用例,文件其余用例保留 |
| `tests/coin/unit/maestroCodexDelegation.test.ts:16` | 断言源码含 `/provider === 'ai-crms'/` → 删掉分支后**必红** | 改成断言路由直接返回 pi |
| `tests/maestro/maestroControlProviders.test.mjs:177, 180, 281, 338, 354` | 整个测试的立论就是「ai-crms 不该出现在 Control」 | 随 #3.6 的允许清单重新表达,换一个 fixture provider |
| `tests/maestro/maestroCompactionHandler.test.mjs:120` | fixture `provider: 'ai-crms'` | 换 fixture provider |
| `tests/maestro/maestroChatLayout.test.mjs:78` · `maestroCompositeTabNavigation.test.mjs:67` | 都桩了 `export const AI_CRMS_AUTH_HOST` | 删桩 |
| `scripts/maestro/externalTools.test.mjs:259, 481, 488-490, 507-509` | 断言 `prepare:maestro-cli` 在 `prepare-maestro-package-tools.cjs` 之前、builder 含 `micromeet` 二进制、staged 文件名 | 删这些断言,保留 bun/rg/fd/ouch/anydoc 的 |
| `scripts/package/desktopPackageAudit.test.mjs:617, 647-664` | 断言 builder 含 `!node_modules/@micromeet/cli` 排除行与 mac 签名列表含 `maestro-tools/micromeet` | 删这两条 |
| `tests/maestro/specs/baseline.spec.ts:45, 143, 284` · 三条 Trench spec | fixture 路由改名的连带 | 见 #3.11 |

### 5.5 打包链 —— 删掉 `prepare-maestro-cli.cjs` 会顺带丢掉 stage-root 清空

这条**清点与复核都没抓到**,是本节最实的一个坑。

`scripts/prepare-maestro-cli.cjs:58-59`:

```js
fs.rmSync(STAGE_DIR, { recursive: true, force: true })
fs.mkdirSync(STAGE_DIR, { recursive: true })
```

**全仓只有它做 `build/maestro-tools` 的整目录清空**。`externalTools.cjs` 那边靠
`removeStaleExternalArtifacts()` 按名删(覆盖 `external-tools.manifest.json` + `anydoc` +
bun/rg/fd/ouch 输出),`copyPayload()` 靠 `mkdirSync(dirname(dest), {recursive:true})` 建目录。

所以删掉这个脚本之后:

1. **stage 目录仍会被建出来**(`copyPayload` 的 recursive mkdir),mac/win 链不会因为缺目录而炸。
2. **但存量机器上的 `build/maestro-tools/micromeet` 与 `manifest.json` 会留着**,
   而 `validateManifestAndPayload → assertExactTree(directory, payloadSpecs, extraFiles)` 是
   **精确树校验**。一旦 `extraFiles` 从 `['manifest.json', cliFilename]` 改成 `[]`,
   下一次 `verify-stage` 会因为"多出两个文件"失败。
3. `build/maestro-tools/` 是 gitignored 的构建目录 —— **改完之后本地跑一次 `rm -rf build/maestro-tools`**,
   并在 `docs/features/maestro.md:201` 把"CLI 构建清空并重建 staging root"改写成
   external-tools 自己建 stage 的表述。

CI / 干净检出不受影响(没有存量目录)。这是**开发机一次性动作**,不是代码改动。

### 5.6 alias 边界

`scripts/maestro/_harness.mjs` 的 `assertMaestroAliasBoundary()` 在 `check-maestro.mjs:13` 跑,
也在被 `check-embedded-host` 间接触发。**它今天就是红的**(另一个特性引入的宿主别名越界,
不是本次改动)。改完 `maestroBrowserView` / `maestroLlm` 之后,如果保留文件新增了
`@main/...` 形式的宿主别名 import,会被判 forbidden —— 但**你分不清这条红是不是自己造成的**,
除非先记基线(#7.1)。

---

## 6. 运行时数据的一次性清理

> **删 writer 不会删数据。** 这一节不做,就是「退役完成」但盘上还留着一枚可用的 CRMS JWT ——
> 这与 #1 的决定直接矛盾。D4 裁定做到**中档**:6.1 + 6.2 + 6.3 + 6.6。

### 6.1 pi 的 `models.json` —— 明文 JWT(最严重)

路径由 `src/main/maestro/llm/llmPaths.ts:37-41 maestroModelsPath()` 决定(userData 下的 `.pi` 目录),
由 `maestroLlm.service.ts:161-164` 写入。`providers['ai-crms']` 里**存着一枚明文 CRMS JWT**。

清理:读 `models.json` → `delete doc.providers['ai-crms']` → 写回。同时清 `models-store.json`
(pi 的 `ModelRuntime` 在旁边写,`piAgentDir.service.ts:PI_STATE_FILES` 已把两者当一组带)。

### 6.2 Micromeet CLI 凭据文件 —— AES-GCM 加密的 JWT + 密钥

路径见 `src/main/maestro/cli/micromeetCliPath.service.ts:60-63`:

- `<rootDir>/credentials/crms.json`
- `<rootDir>/credentials/.credential-key-v2`(32 字节密钥)

`rootDir` 按通道分叉:Stable = `~/.micromeet`,Preview = `<userData>/cowork/cli`。
**两个都要清** —— 一台机器上可能同时装过两个通道。

今天只有 `writeMicromeetCliCredential(null)` 会清(`authBridge.ts:305` / `maestroLlm.service.ts:459` /
`maestroWindow.handler.ts:346`),这三处一删就再没人清。

清理:unlink 这两个文件;`credentials/` 目录若为空(`sys.json` 不在本次范围)则一并删。
**不要动 `sys.json`** —— 那是 Sys realm,不是 CRMS。

> **实现时发现这两句在同一个目录里会打架,已按下面这条落地(2026-09-10)。**
> `.credential-key-v2` 是 crms 与 sys **共用**的密钥(`credentialStore.ts:credentialKeyFile()` 按
> `dirname(credentialFile)` 取,两个 realm 同目录同一把)。目录里还留着 `sys.json` 时把密钥删掉,
> 那份 Sys 凭据就再也解不开 —— 而 `~/.micromeet` 是用户自己那套 micromeet CLI 的 home,不只是
> bl 写过的地方。所以:**密钥只在没有 `sys.json` 时删**。`crms.json` 一走,它就不再能解开任何
> CRMS 凭据,留着不违背退役的决定。判据落在 `planCliCredentialRemoval()`,有测试钉住。

### 6.3 sqlite 隐藏窗口 renderer 的 localStorage —— JWT 的原始落盘点

键定义在 `src/shared/maestro/session.api.ts:26-28`,写入在
`src/preload/maestro/sqlite/session.dao.ts:41-44`:

| 键 | 内容 |
|---|---|
| `mtk` | **CRMS JWT 明文** |
| `crms.workspaceId` | 租户 id |
| `crms.region` | 区域 |
| `mtk.ts` | 写入时间戳 |

这是 Electron LevelDB,落在那个隐藏窗口的 partition 下。**删掉 DAO 之后再没有任何代码能碰它。**

> 顺带纠正一条证据里的判断:`clearSession():49-53` 不删 `crms.region` **是故意的** ——
> 那一行上面写着 "Drop auth; keep region (it's a UI preference, not a credential)"。
> 它不是漏删。但 provider 退役后 region 也成了孤儿,一次性清理里**四个键全清**。

### 6.4 `coach-settings.json` 与 `llm_target` —— 靠删两行成立,不需要迁移代码

- **`llm_target`(config 表)**:`readStoredLlmTarget → normalizeSelectableLlmTarget → normalizeLlmTarget`。
  `LLM_PRESETS` 删掉 ai-crms 那条之后 `presets` 为空 → `fallback = LLM_PRESETS[0]` =
  `openai-codex / gpt-5.6-luna`,**自动回落**。
- **`coach-settings.json`**:必须删 `coachSettings.service.ts:84`(别名行)**和** `:15`。
  留着 `:84`,文件里会一直脏着 `ai-crms`,只在下一次 `writeStoredLlmTarget` 时自愈;
  删掉之后 `'ai-crms'` 落到 `:88` 的 `return DEFAULT_SETTINGS.llmProvider = 'openai-codex'`,
  `:76` 再把 `'qwen3.7-plus'` 归一到 `'gpt-5.6-luna'`。

**这一档不需要迁移代码,但需要一次手测**:改完第 11 步之后,拿一份 `llm_target='ai-crms'`
的存量配置冷启动,确认落到 Codex 而不是空 provider。

### 6.5 LLM 压缩偏好的孤儿键 —— 不处理,记一句

`maestroLlm.service.ts:157` 以 `modelPresetKey('ai-crms','qwen3.7-plus')` 读写 config 表里的
压缩百分比;`llmModels.ts:196-201 parseStoredLlmCompressionPrefs` 只按 `key.includes('/')` 过滤,
不校验 provider 是否还存在。

这个键会永远留在 config 表里,`applyCompressionPrefs` 每次白跑一遍。
**无害,不做处理,在这里记一句就够** —— 它不含凭据。

### 6.6 历史 tab 行 —— 会把远端 CRMS 重新拉起来

`src/shared/maestro/tabs.api.ts:4-10` 的 `SavedTab` **只有 url/title/favicon/position,没有 kind**;
`maestroBrowserView.service.ts:955-960 restoreTabs()` 把每一行都当普通 tab `addTab({url})` 恢复。

所以用户库里任何一行 `http://crms.micromeet.ai/...` 的历史 tab,在退役之后**照样在启动时被打开** ——
而且此时 `preventAiCrmsEscape`(`:676-694`)已经删了,连原来的越站防护都没了,
变成一个裸的远端浏览 tab。

清理:通过既有的 `createXpcMainEmitter<TabsApi>('TabsDao')`,`listAll()` → 过滤掉
`new URL(tab.url).host === 'crms.micromeet.ai'` 的行 → `replaceAll()`。
**按 host 精确匹配,不要用 `includes('crms')`** —— 用户可能有别的含这四个字母的书签。

### 6.7 integration 的两个 config domain

`domain='integration-targets'`(每行 `destination.kind='ai-crms'`)与 `domain='integration-mappings'`
(前缀 `'map:'`),契约见 `src/shared/maestro/config.api.ts:59-67`。

D4 裁定的中档**不含**这一项。它们不含凭据,子系统删掉后是读不出来的孤儿行。
**建议一并清**(在同一段迁移里多两行),因为 6.6 已经要碰 config/tabs 表了,边际成本接近零。
若 Ral 不同意,就明确写进文档说"接受这两个 domain 的孤儿行留存"。

> **已按建议一并清(2026-09-10)。** 同时把 `config.api.ts` 里那四个 domain / 前缀常量删掉 ——
> 它们已无消费者,domain 名现在只写在清理代码里一处,sunset 时随目录一起消失。

### 6.8 这段代码放哪

仓里已有现成的形状,照抄:

```
src/main/maestro/llm/piAgentDir.service.ts   ← 纯逻辑、Electron-free、可测(路径 + 迁移决策)
src/main/maestro/llm/llmPaths.ts             ← 薄的 Electron 绑定层,负责 app.getPath()
```

`piAgentDir.service.ts` 的文件头注释把理由写清楚了:
「决策值得测试的是"哪个目录"和"迁移拷贝什么",两者在这个模块伸手去拿 `app.getPath()` 的
那一刻就都不可测了」。同样的划分:

| 放哪 | 装什么 |
|---|---|
| `src/main/maestro/retirement/crmsResidueCleanup.service.ts` | **Electron-free**。输入 = 路径与文档内容,输出 = "要删哪些键 / 哪些文件"。6.1 与 6.2 的全部决策逻辑 |
| `src/main/maestro/retirement/crmsResidueCleanup.ts`(薄层)| 绑 `app.getPath('userData')` / `homedir()`,在 boot 阶段调用一次;6.6 / 6.7 走 `TabsDao` / `ConfigDao` emitter |
| `src/preload/maestro/sqlite.preload.ts:66`(原 session.dao import 的位置)| 6.3 的四个 localStorage 键。**这一条 main 够不着** —— 它落在隐藏 sqlite 窗口的 renderer partition 里,只能在那个 preload 执行。用一个不注册任何 XPC 通道的一次性函数替换掉 DAO 的 import |

一次性语义照 `migratePiDirOnce` 的做法:**用一个持久化 marker 门控**,第一次跑完之后
每次启动只多一次 config 读。不要每次开机都去 stat 五个文件。

### 6.9 这段迁移代码要活多久 —— 推荐

**推荐:保留一个整季度,到 2026-12-31 为止,然后删除。**

理由,以及为什么不是别的答案:

- **不能只留一个版本。** 跳版升级是常态 —— 一台从 2026-08 直接升到 2026-11 的机器,
  如果清理代码只活在 2026-09 那一版里,它的 JWT 永远不会被清。凭据留存的窗口
  必须覆盖"用户实际会跳过多少版本",不是"我们发了几版"。
- **不能永久保留。** 它是一段每次启动都要解释一遍的死代码,而且 `crmsResidueCleanup`
  这个名字会让三年后的人以为 bl 还跟 crms 有关系。marker 门控让运行成本接近零,
  但**认知成本不为零**,那才是要收的账。
- **为什么是一个季度**:Stable 与 Preview 两个通道各自至少滚过一轮,加上
  「装了没开」的机器有时间被打开一次。这是覆盖率与死代码之间一个可辩护的折中,
  不是精算出来的数。

**落地要求(缺一不可)**:

1. 服务文件顶部写一行带日期的 sunset 注释:`// Sunset: 2026-12-31 — 见 docs/features/maestro-crms-retirement.md #6.9`。
2. 在 `docs/issues/` 开一条到期删除的账,不要只靠注释 —— 注释没人会主动去读。
3. 删除时**连 marker 键一起删**,否则 config 表里留一个再也没人写的孤儿。

CLI 凭据(6.2)、models.json(6.1)、localStorage(6.3)三处同一个 sunset。
tabs / config domain(6.6 / 6.7)可以更早撤(它们不含凭据),但**没必要分两次** ——
同生同死更好维护。

---

## 7. 验证

### 7.1 先记基线 —— 否则验证信号本身不可信

这个仓的验证基线已经很脏,而且**比证据文件说的还脏**。我在 2026-09-09 的 `dev/next`
工作区实测,**动手之前**就红的守卫是 **7 个**,不是 5 个:

| 守卫 | 首个失败断言(动手前) |
|---|---|
| `check-startup-settings` | `controller readiness should invoke the extracted custom-startup-tab flow after pinned AI-CRMS load` |
| `check-integration-target` | `renderer/workbench/src/WorkbenchApp.vue should include integrations: 'Integrations'` |
| `check-media-upload` | `embedded feature contract should preserve media attachments` |
| `check-agent-runtime` | `BaseAgent should use the Coach runtime router by default` |
| `check-embedded-host` | `Maestro alias boundary failed: …` |
| `check-inject-button` | `Control should send injected trigger text into Maestro` |
| `check-artifact-generation` | `Excel artifact generation should depend on exceljs` |

绿的:`check-cli-integration` · `check-chat-composer` · `check-llm-persistence` ·
`check-ai-crms-relay-config` · `check-ai-crms-runtime` · `check-cli-domain-commands` · `check-host-tools`。

**动手前重跑一遍这张表并存档** —— 上面的结果取自 2026-09-09 一个有 40+ 文件未提交改动的
工作区,不等于 HEAD,也不等于今天(9-10 已是 87 个文件,并多了
`check-context-graph` / `check-new-tab-focus` 两个当时不存在的守卫)。
按 memory 里 `bitterless-verify-baseline-vs-head` 的办法:`git archive HEAD` 拉一份只读基线,
两边各跑一遍,**差集**才是自己造成的。

这张表的用途不是"这 7 个可以不管",而是:**动手后如果某个守卫的失败断言换了一条,
那就是自己造成的**,哪怕它动手前也是红的。

### 7.2 typecheck 判据

**判据是"没有新增 error",不是"零 error"。** 该仓 typecheck 在 HEAD 就有约 80 个既有错误。

做法:`git archive HEAD` 到临时目录 → 在那份只读基线上跑一次 typecheck 存 A →
在工作区跑一次存 B → 比对 **B \ A**。B\A 为空 = 通过。

必须在 B\A 里为空的高危项(它们是"删一半"的直接症状):

- `Type '"COACH_AI_CRMS_CORE_BASE_URL"' is not assignable to ApplicationDiagnosticEnvironmentKey`(#2 批 C 诊断两处不同步)
- `Cannot find module '…/aiCrmsRuntimeAdapter'`(第 7 步顺序反了)
- `Cannot find module '…/WorkbenchIntegrationsView.vue'`(第 2 步只删视图没删路由)
- `Cannot find module '…/coachEndpoint'`(第 3 步漏了 renderer 两个文件)
- `TS2367`(比较无重叠)—— 第 16 步先删了类型成员、第 9 步的分支还在

### 7.3 要单跑哪些 check

**`yarn check:maestro` 今天跑不过**:`assertMaestroAliasBoundary()` 在 for 循环之前抛。
所以**逐个单跑**,别指望聚合器:

```
# 必须由红转绿(本次直接修的既有欠账)
node scripts/maestro/check-startup-settings.mjs

# 必须保持绿(改了断言的)
node scripts/maestro/check-chat-composer.mjs
node scripts/maestro/check-media-upload.mjs
node scripts/maestro/check-agent-runtime.mjs
node scripts/maestro/check-embedded-host.mjs
node scripts/maestro/check-ioc-composition.mjs

# 必须保持绿(没改但可能被误伤的)
node scripts/maestro/check-llm-persistence.mjs
node scripts/maestro/check-host-tools.mjs
node scripts/maestro/check-inject-button.mjs
node scripts/maestro/check-artifact-generation.mjs
node scripts/maestro/check-no-tailwind.mjs
node scripts/maestro/check-custom-menubar.mjs

# 计数对齐(不是跑,是核对)
ls scripts/maestro/check-*.mjs | grep -v check-maestro | wc -l   # 动手当天的数 - 5
```

`check-inject-button` 与 `check-artifact-generation` 进这张表,是因为 #5.3 里
`maestro.md:201`(`domain injections` 与 integration 三项同行)和 `:183-184`
(artifact 两个串与 "bundled-CLI" 同段)**是改文档时最容易连坐的两处**。

`check-embedded-host` 与 `check-agent-runtime` 在基线里就是红的 —— 判据是
**失败断言不变或减少**,不是转绿。失败断言**换了一条**就要查。

### 7.4 要跑哪些测试

```
yarn test:maestro-external-tools      # 改了 externalTools.cjs 与 package.json 脚本顺序
yarn test:desktop-package-audit       # 改了 electron-builder ×2
node --test tests/maestro/maestroContextExport.test.mjs
node --test tests/maestro/maestroControlProviders.test.mjs
node --test tests/maestro/maestroCompactionHandler.test.mjs
node --test tests/maestro/maestroChatLayout.test.mjs
node --test tests/maestro/maestroCompositeTabNavigation.test.mjs
node --test tests/coin/unit/maestroCodexDelegation.test.ts
```

`test:maestro-cli-channel` 随文件一起消失,不在清单里。

### 7.5 不跑什么

- **不跑 `yarn build`** —— 它会把 `package.json` 的 `name` 改写成 `Bitterless_DEBUG_*`。
  打包链的改动(批 D)只能靠 `test:maestro-external-tools` + `test:desktop-package-audit`
  两条脚本测试与人工读 diff 验证;**真正的完整打包验证交给 Ral 在下次发版时跑一次**
  (D3 已接受这个代价),届时报告哪些平台跑过。
- **不跑 `yarn lint`** —— 已知 OOM 崩溃,跑不出结论。
- **不跑 Electron E2E / 不启动桌面应用**。`baseline.spec.ts` 与三条 Trench spec 的改动
  (#3.11)属于**改了但未运行**,必须在最终报告里明说。

### 7.6 共享 worktree 风险 —— 开工前必查

当前分支 `dev/next`。2026-09-10 复核时 `git status` 是 **87 个文件正被别的会话改着**
(9-09 那次是 40+,一天翻了一倍),其中 **十一个正好是本次要大改的**:

```
docs/features/maestro.md                                    ← #5.3 的全部行号
scripts/maestro/check-maestro.mjs                           ← #5.1 的计数
package.json                                                ← 批 D
electron-builder.tmp.yml                                    ← 批 D
src/main/app.main.ts
src/main/agent/maestroAgent.service.ts                      ← 行号已漂 +90
src/main/maestro/windows/main/maestroBrowserView.service.ts
src/main/maestro/windows/main/maestroWindow.controller.ts
src/main/maestro/xpc/coach.handler.ts
src/renderer/maestro/control/src/ChatPanel.vue              ← 批 A 语音
src/shared/maestro/coach.api.ts                             ← 行号已漂 +11
```

那个会话还新增了 `check-context-graph.mjs` 与 `check-new-tab-focus.mjs` 两个守卫 ——
**这就是守卫总数从 42 变 43 的原因**,也是为什么 #5.1 的数字必须当天重数。

- 开工前确认那个会话的改动已落地。
- `git add` **只加自己的路径**,绝不 `git add -A`。
- 不切分支、不 stash、不 commit 别人的改动。
- 每批开始前对该批要碰的文件重跑一次开头「行号是快照,符号才是锚」那组 grep,不要信本文的行号。

### 7.7 一次手测(不可省)

改完第 11 步之后,拿一份 `llm_target='ai-crms'` 的存量配置冷启动,
确认落到 `openai-codex / gpt-5.6-luna` 而不是空 provider 或崩溃。
这是 #6.4 自动回退链的唯一验证方式 —— 没有守卫覆盖它。

---

## 8. 明确不做

| 不做 | 为什么 |
|---|---|
| **不给 Maestro 找新的 ASR 后端** | D2 已裁定语音一并退役。换后端是新需求,要先定 provider、成本、隐私边界,不属于一次删除 |
| **不保留 recorded-site 的抓包→接口契约能力** | D1 已裁定 integration 整体退役。保留它反而工作量更大 —— 要重新定义 target 的"目的地"是什么 |
| **不清理抓包过滤器里拿 `crms.micromeet.ai` 当示例的占位文案** | `captureConfig.store.ts:22` 等处只是 domain-suffix 规则的示例字符串。属于顺手清洁,混进删除 diff 会让 review 更难。要改单开一次 |
| **不动 30 份历史 `docs/plan/{tasks,reviews,analysis}`** | 它们是任务单与评审报告,是**当时的**记录。改历史文档等于伪造记录 |
| **不修 `check-embedded-host` / `check-agent-runtime` / `check-inject-button` / `check-artifact-generation` / `check-media-upload` 那些与 crms 无关的既有红断言** | 它们在 `docs/issues/maestro-parity-guards-revived.md` 里另有账。本次只清 `check-startup-settings` 那一条(因为它就是钉 AI-CRMS 首 tab 的欠账) |
| **不重构 `ControlApp.vue` 的 provider 白名单之外的东西** | #3.6 只把谓词改成允许清单,不动 `getLlmProviderGroups` 的其余逻辑 |
| **不跑 `yarn build` / `yarn lint` / Electron E2E** | 见 #7.5 |
| **不动 `package.json` 的 `name` / `version` / `_version` / `version_code`** | 工作区里那几行是别人跑打包留下的痕迹,不属于本任务 |
| **不删 `sys.json` 与 Sys realm 相关的任何东西** | 那不是 CRMS |
| **不在本次注册 `docs/INDEX.md`** | 本阶段只产出契约文档。索引登记与实现一起提交 |

---

## 9. 一页纸的账

| 面 | 数量 |
|---|---|
| 整文件删除 | 约 **22** 个源文件 + `packages/micromeet-cli/` 整目录 + `recordedSite/` 整目录 |
| 摘分支不删文件 | **6** 处(#3.1 · #3.2 · #3.3 · #3.6 · #3.7 · #3.8) |
| 守卫:删除 | **5** 个 → `check-maestro.mjs` 计数 43 → **38**(数字会漂,当天重数) |
| 守卫:改断言 | **6** 个(含上一版漏掉的 `check-ioc-composition`) |
| 守卫:约束文档改法但不改断言 | **3** 个 |
| agent 工具移除 | **13** 条(catalog 目录 + controller 声明 + controller 转发,共三份) |
| `docs/features/maestro.md` 改动点 | **15 处**,另加 `desktop-release-channels.md:24-30` |
| 测试改动 | **9** 份 + 1 个 E2E fixture 改名(连带 4 条 spec) |
| 运行时数据清理点 | **4 处必做**(models.json · CLI credentials · localStorage 四键 · 历史 tab 行)+ 2 处建议 |
| 迁移代码 sunset | **2026-12-31** |
