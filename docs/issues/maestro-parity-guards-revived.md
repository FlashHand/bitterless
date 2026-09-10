# 39 个 Maestro 守卫复活 —— 以及它们藏了什么

`status: 守卫已能执行;11 项失败待逐条裁决`
`revived: 2026-09-08`
`updated: 2026-09-10 — AI-CRMS 退役(docs/features/maestro-crms-retirement.md)`

## 它是怎么全套哑掉的

`check-maestro.mjs:13` 在遍历之前先调 `assertMaestroAliasBoundary()`。这个断言在 HEAD 就是红的
⇒ **它一抛,后面 39 个检查一个都不会执行**。仓里 `docs/issues/maestro-parity-guards-silently-dead.md`
早就记下过同一件事。

复活时看到的 18 项越界(此前是 19,`claudeSubscription` 删除后少一条),分布很说明问题:

| 类别 | 数量 | 性质 |
|---|---|---|
| `@renderer/common/i18n/*` · `assets/style/*` | 13 | **跨切面服务**,Maestro 的 renderer 合法依赖 |
| `homeShellBridge`(localHome / workbench) | 4 | 真实宿主耦合 |
| `main/net/proxy.ts → @main/networking/outboundHttpDispatcher.service` | 1 | 真实宿主耦合 |

i18n 那 13 项以前是**逐文件放行**(allowlist 里已有 4 条一模一样的条目)。守卫一死,同样的 import
在新文件里长到 13 处也没人发现 —— 这就是清单式放行的腐烂方式。改成**前缀规则**
(`hostAliasPrefixAllowlist` 增加 `@renderer/common/i18n/` 与 `@renderer/common/assets/style/`):
是规则就不随文件数腐烂。

另外 5 项是真耦合,**逐文件显式放行并标注为债** —— 列出来是为了可见、可数,抽 SDK 时逐条消解,
而不是假装不存在。

## 复活后:25 ok / 14 FAIL

已顺手修掉一条**可证明的陈旧断言**(不是漂移):
`check-agent-runtime:151` 写死 `this.session.prompt(message.text)` 字面量,而 steering 那次改动
给它加了第二个入参 `{ streamingBehavior }`。判据本来是「媒体以 text/path 引用传递、不做 base64
内联」,与入参个数无关 —— 改成正则语义判据。**这条守卫本身仍然红,但红在下一条更深的断言上。**

剩下 11 项失败,**全部先于本次改动存在**,按主题分:

| 守卫 | 断言 |
|---|---|
| `check-agent-activity` | 工具活动行应显示原始工具名(不加 `call ` 前缀、不做语义动词改写) |
| `check-agent-runtime` | abort 应清掉 hydration 状态 |
| `check-artifact-generation` | Excel 产物生成应依赖 exceljs |
| `check-chat-performance` | 流式 delta 应按会话缓冲 |
| `check-custom-menubar` | Maestro 外壳应预留 90px 的 macOS 交通灯槽位 |
| `check-debugger-toggle` | MenuBar 应渲染 debugger 图标 |
| `check-devtools-debug` | workbench service 应保持有界的 create 流程 |
| `check-host-approval-history` | API 确认应在弹窗**之前**落盘待批,并在之后解决它 |
| `check-inject-button` | Control 应把注入的触发文本发进 Maestro |
| `check-media-upload` | 内嵌特性契约应保留媒体附件 |
| `check-workspace-files` | agent 应暴露 `read_file` |

## 这 11 条要怎么处理

**不要一次性批量"修绿"。** 每一条都是两种可能之一:

- **陈旧守卫** —— 产品行为没变,只是断言写死了会变的字面量(`check-agent-runtime:151` 已确认属此类)
- **真实漂移** —— 产品行为确实退化了,守卫是对的

两者的处置相反:前者改断言,后者改代码。**分不清就先别动**,否则把真实回退"修"成绿色,
比守卫死着更糟 —— 死着至少还知道自己没在看。

建议按主题分批逐条过,并在过的时候顺带回答:这条守卫守的是 cowork 与 bitterless 的**parity**,
那 cowork 那边现在是什么行为?(`micromeet-cowork` 有同名或对应的守卫可对照。)

## 2026-09-10 · AI-CRMS 退役结算掉的三条

`docs/features/maestro-crms-retirement.md` 把 crms 链路整条删掉,顺带结清了上表里的三条:

| 原条目 | 结果 | 说明 |
|---|---|---|
| `check-integration-target` | **守卫已删** | 整份断言 `createAiCrmsMigrationTarget` / `recordedSiteAiCrmsBody` / `runMicromeetCli`,对象全没了 |
| `check-startup-settings` | **转绿** | 它红的正是「钉住 AI-CRMS 首 tab」这笔欠账。断言改盯 `loadPinnedHomeTab()` 之后才走自定义启动 tab —— 守的时序不变,只是首 tab 早就换成本地 Home 了 |
| `check-chat-composer` | **转绿** | 那条窄屏断言此前已被 column-first 布局取代,退役这次顺手把语音样式断言一起摘掉 |

同批一起删的还有 `check-ai-crms-relay-config` · `check-ai-crms-runtime` · `check-cli-integration` ·
`check-cli-domain-commands`(它们在 HEAD 上是绿的,不在本表内),`check-maestro.mjs` 的守卫硬计数
随之从 43 改成 38。

`check-agent-runtime` / `check-embedded-host` / `check-media-upload` 三条**改了断言但仍然红**,
红在与 crms 无关的既有欠账上(分别是 BaseAgent 不再自己 new 路由器、另一个特性引入的
onlypreview 宿主别名越界、`maestro.md` 的 `Attach/drop/paste` 措辞漂移)。它们仍归本表管。

## 与 maestro-agent-sdk 抽取的关系

这套守卫必须先真的在跑,bitterless 接入 SDK 的改造才有网 ——
见 `overmind:areas/agent-runtime/agent-design-parity.md`(那份台账随共享 SDK 一起退役,
内容合并进了这份统一设计文档 —— Ral 2026-09-08 放弃共享 SDK,改为文档统一、实现两边)。
