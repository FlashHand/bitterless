# 预览一个项目外的文件之后，OnlyPreview 变成「No project open」

Ral 2026-09-09 报：

> 预览一个 workspace 外的文件 …… onlypreview 选了 workspace，因为预览外部文件这个选择失效了

截图是 OnlyPreview 顶栏显示 **`No project open`**，Project 页签下没有项目。
复现路径：OnlyPreview 未开着（或项目尚未绑定完）时，显式预览一个项目外的文件，
例如 `/Users/ral/Downloads/NOTE_voice_scribe_regional_language_2026-09-08.pdf`。

**这与 [`onlypreview-external-preview-clears-project-selection`](onlypreview-external-preview-clears-project-selection.md)
不是同一件事。** 那一份是「项目**内**的文件被误判成外部」，丢的是树里的高亮
（`selectedRelativePath` 一个字段）；这一份的文件**确实在项目外**，丢的是**整个项目**。

## 「No project open」到底是什么

它是 shell 顶栏在 `onlyPreviewShellStore.workspace` 为空时的文案
（`shell/src/App.vue:24`，`onlyPreviewI18n.topbar.noWorkspace`）。而 `workspace` 只由一条路写入：

```ts
// shell/src/onlyPreviewShell.store.ts:451
const workspace = unwrapOnlyPreviewResult(await onlyPreviewClient.restoreWorkspace({ hostToken }));
if (!workspace) { …; this.workspace = null; … }   // ← main 说 null,shell 就当"没有项目"
```

shell 在**挂载时**问一次，之后只在收到 `workspaceChanged` 广播时再问
（`onlyPreviewShell.store.ts:357`）。

## 根因

`restoreWorkspace` 在 main 侧有一道闸门：

```ts
// onlyPreviewRecentDirectory.service.ts:185
const current = this.workspaces.restore(host.hostToken);
if (current) return current;                       // 已绑定且已 settle → 原样返回
if (this.activeExplicitGeneration !== null) return null;   // ← 有 explicit 目标在飞,不恢复
```

这道闸门本身是对的：一个 explicit **目录** 打开马上就要自己绑项目，让「恢复上次目录」在这中间
跑起来会和它抢。**问题是这个 claim 被无条件地占了**：

```ts
// onlyPreviewExplicitOpen.service.ts:111 —— 在 inspectTarget 之前
const recentGeneration = onlyPreviewRecentDirectoryService.beginExplicitTarget();
```

`beginExplicitTarget` 同时做两件事：bump `mutationGeneration`（per-host 的 supersede 记账，**必要**）
与 `activeExplicitGeneration = generation`（「别恢复」的 claim）。而这条 explicit 路
**同时服务目录与文件两种目标**，只有目录那支会绑项目 —— 文件那支根本不碰
`projectWorkspaceByHost`（外部预览住在另一个 map `externalPreviewWorkspaceByHost` 里）。

于是完整链条是：

1. `openOnlyPreviewAbsoluteTarget(pdf)` → `beginExplicitTarget()` 占下 claim；
2. `ensureStandalone('explicit')` 在这个飞行窗口内**新建窗口**，shell 挂载；
3. shell 挂载即问 `restoreWorkspace` → 此时 `current` 为空（还没绑任何项目）→ 撞上闸门 → `null`；
4. shell 据此把 `workspace` 置空 → **`No project open`**；
5. 文件那支结束时广播的是 `SELECTION_CHANGED` 而**不是** `WORKSPACE_CHANGED`
   （`onlyPreviewExplicitOpen.service.ts:98`），所以 shell **再也不会问第二次** —— 空状态就留在那里。

**一次性的恢复 ＋ 一个本不该对它生效的抑制窗口。** 两者单独都不出错。

三个 `beginExplicitTarget` 调用方里，另外两个的 claim 是**对的**，不动：

| 调用方 | 会绑项目吗 | claim |
| --- | --- | --- |
| `onlyPreviewChooseFolder.service.ts:28` | 会（`openExplicitTarget`） | 保留 |
| `onlyPreviewHostToggle.service.ts:242` | 会（重建 host 并恢复原目标） | 保留 |
| `onlyPreviewExplicitOpen.service.ts:111` | **只有目录那支会** | **文件那支必须释放** |

## 修复

**① claim 说什么就得是什么 —— 文件目标释放它。** 一旦 `inspectTarget` 判定目标是文件，
就调 `releaseProjectRestoreClaim(generation)`（只在 `activeExplicitGeneration` 仍等于该
generation 时清空，所以不会误伤后来者）。`mutationGeneration` 与 per-host 记账**不动** ——
那部分是 supersede 用的，和「能不能恢复」无关。

**② 补一次再问的机会。** 释放之后，用 fire-and-forget 去 `restoreWorkspace(hostToken)`，
**只有真恢复出项目时**才广播 `WORKSPACE_CHANGED`。

- **不 await**：Ral 的项目索引是 8 万多个文件（生产日志 `count=86450`），让一个 PDF 的预览等在
  索引后面是另一种坏。预览先出，项目随后出现。
- **只在有项目时广播**：没有可恢复的项目时广播 `workspaceChanged` 会让 shell 再走一遍
  「置空 ＋ 重置索引状态」，那是无谓的抖动，而且是在说一件没发生的事。

**不做的**：不把 claim 从 `beginExplicitTarget` 里整体挪走。那要改三个调用方，而其中两个的当前
行为是对的 —— 为一个只在一支里成立的问题改三处，是把正确的代码也卷进来。

## 验证

`tests/onlypreview/onlyPreviewExternalFilePreview.test.mjs` 新增：项目未绑定时显式预览一个项目外
的文件，之后 `restoreWorkspace` 必须能恢复出上次的项目，并且广播过一次 `WORKSPACE_CHANGED`；
以及反面 —— 没有可恢复项目时**不**广播。目录那支的 claim 仍然有效（并发的恢复不得抢在它前面）。

变异测试 6 条，5 条被捕获；第 6 条「把闸门整体拆掉」**存活**，查证后确认它是**惰性**的：
抑制在服务里写了两处 —— `restoreWorkspace` 开头的快路径与 `canRestore` 里的那一条。按行号做实验：
只拆快路径**行为不变**（`canRestore` 仍在挡），两处都拆才让断言变红。所以断言钉的是行为不是某一行，
不是测试空洞；这条记在测试的注释里，免得后人把那个快路径当成"没被测到"而删掉。

同步到 micromeet-cowork（`src/main/miniapps/onlypreview/` 是适配面，两处各自逐条对齐而非整体覆盖）。
两仓验证：bitterless `test:onlypreview` 1091 项 17 失败（＝基线）、`main` surface 65 错（＝基线）；
cowork 单测 429 项 1 失败（＝基线）、node typecheck 20（＝基线）。cowork 那个文件里的
`TS2349: This expression is not callable` 是**既有**错误（原第 468 行，被本次插入推到 486 行，
同一段 `resolveCurrent?.()`），与本修复无关。
