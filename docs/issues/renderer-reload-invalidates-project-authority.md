# 渲染进程一次重载,就把项目权限作废并弹出「This project belongs to another preview session」

`status: root-caused`
`reported: 2026-09-08（Ral 截图,cowork dev）`

## 现象

```
OnlyPreview error · 2026-09-08T07:53:04.450Z
code: WORKSPACE_ACCESS_DENIED
message: Project authority does not match the active workspace.
```

UI 上是项目树顶部一条红色横幅:**This project belongs to another preview session.**
树本身照常显示,所以看起来像「项目被另一个会话抢走了」—— 而实际上并没有第二个会话。

那句话只是 `WORKSPACE_ACCESS_DENIED` 这个**错误码的 i18n 标签**
(`onlyPreviewI18n.ts`),不是一个针对 host 的诊断。按它去找「另一个会话」会走错方向。

## 直接触发:一次渲染进程重载

本次是**开发期自伤** —— 有人(我)在 Ral 正在跑的 dev 树里改了两个渲染进程文件:

| 本地时间 | 事件 |
| --- | --- |
| 15:50:16 | 写入 `ChatPanel.vue` ＋ `PreviewToolbar.vue`(IconBtn 路径修复) |
| **15:53:04** | **报错** |
| 15:59:20–15:59:22 | 日志里 `vite connecting…/connected.` 约 **10 次**,2 秒内 |

`vite` 的 HMR 重载渲染进程,OnlyPreview 的 shell 因此重新 boot。日志里每一轮都是同一串:

```
event=preview-focus-claimed
event=restore-index-grace phase=scheduled generation=1
event=restore-index-grace phase=start generation=1
event=xpc-start method=initialize
event=shell-initialized outcome=success elapsedMs=81
event=runtime-accepted method=initialize generation=1
```

## 根因:每一次 bind 都铸新代次,而重载必然重新 bind

```ts
// preload/fileSearch/fileSearchProjectAuthority.service.ts — bindWorkspace()
const workspace: ProjectWorkspaceAuthority = {
  workspaceId,
  generation: ++this.generation,   // ← 每次 bind 都 +1
  …
};
```

`requireWorkspace(workspaceId, workspaceGeneration)` 用 `workspace.generation !== workspaceGeneration`
判定,所以**一次重绑作废之前发出的全部 `workspaceGeneration`**。而 main 侧持有的引用是
重载之前拿的 —— 于是下一次用它就是这条错误。

链条:

```
渲染进程重载 → shell 重新 boot → recentDirectoryService 恢复上次的项目
  → onlyPreview.handler 的 bindWorkspace → fileSearchWindowService.bindProjectWorkspace
  → preload 的 authority.bindWorkspace → ++generation
  → main 手上的旧 generation 失配 → WORKSPACE_ACCESS_DENIED → 横幅
```

**重载在生产里也会发生**,不只是 dev 的 HMR:渲染进程崩溃恢复、冷 tab 被激活时的
view 重新物化、host toggle 之后的重建。所以这不是一个「只在开发期出现」的问题,
只是这次是开发期把它触发得特别密集。

## 与已修的那条的关系

2026-09-07 修过一条同样错误码的:**重复打开同一个 workspace** 会重绑并铸新代次
(`onlyPreviewExplicitOpen.service.ts` 的 `isActiveProjectRoot` 短路)。那条修的是
**显式打开**的重入路径,判据是 real path 相等就不再走 `openExplicitTarget`。

这一条在**更下面一层**:`bindWorkspace` 自己。短路挡不住它,因为重载走的不是显式打开,
是 shell boot 的项目恢复。

## 已落地（2026-09-08，bitterless；cowork 待同步）

`bindWorkspace` 的幂等化，判据是 **real path ＋ dev ＋ inode 三者全等**。

一处**顺序**上的重排是必要的：原实现第一件事就是 `this.workspace = null` ＋
`await this.revokeDeleteGrants()`，等路径解析完也就没有东西可以比较了。所以
`existing` 在**任何破坏性动作之前**捕获，破坏性动作推迟到「确认真换了目录」之后。
代价是多了一个 `await`，所以在它之后**补了第二次 supersede 检查** —— 「supersede 之后
不再改状态」这条不变量不能因为多一个 await 就漏掉。

**幂等重绑不撤销 delete grant**，这正是修复的要点：一个没有变化的项目，它的 grant 不该
因为一次重载而失效。

**验证**（`tests/onlypreview/onlyPreviewProjectAuthority.test.mjs` 新增 5 例，共 20 例全绿）：

| 用例 | 钉住的性质 |
| --- | --- |
| 同一目录重绑幂等 | 代次不变，**且重载前拿的引用重载后仍可用** |
| 换目录仍铸新代次 | 幂等没有削掉「真换了就该失效」 |
| 同 `workspaceId` 不同目录**不**幂等 | 判据不能只比调用方给的 id |
| 同路径但换了 inode 的目录 | dev/inode 两项判据存在的理由 |
| 同一目录的另一种拼法 | 判据在 real path 上，不在字面路径上 |

原有的 15 例在**有没有这个修复的情况下都通过** —— 所以它们不是这条性质的证据。
新增那 5 例做了**变异测试，6/6 全部被对应用例捕获**（整条短路去掉、只比 id、漏 dev/inode、
幂等分支也 `++`、换目录不 `++`、`existing` 在破坏性动作之后才捕获）。

全套 `test:onlypreview` 1052 例、1035 通过、17 失败 —— 与改动前基线的 17 条**逐条相同**。

## 修法（原始建议，已按此实施）

**让同一个目录的重绑成为幂等操作**,而不是每次铸新代次。`bindWorkspace` 已经算出了
判定所需的全部材料 —— `rootRealPath`、`deviceId`、`inode`:

```ts
const existing = this.workspace;
if (existing && existing.workspaceId === workspaceId
    && existing.rootRealPath === rootRealPath
    && existing.deviceId === rootStats.dev && existing.inode === rootStats.ino) {
  return { runtimeInstanceId, workspaceId, workspaceGeneration: existing.generation };
}
```

判据必须是 **real path ＋ dev ＋ inode 三者都相等**,不能只比 `workspaceId`:
`workspaceId` 是调用方给的,而这个模块的职责就是「确认那个 id 指的还是同一个真实目录」——
只比 id 等于把它自己要守的东西当成前提。dev/inode 是它已经取过的,所以这不增加 syscall。

**代价要写清**:幂等重绑意味着一次重载之后,**重载前发出的引用仍然有效**。那正是要的
(重载不该作废权限),但它同时意味着 generation 不再是「bind 次数」的计数器 ——
如果有别的地方靠 generation 变化来感知「项目换了」,那条依赖会失效。落地前要先查这一点。

**不要**用「把错误吞掉」来修:那会把一次真实的项目替换(用户确实换了目录)也一起藏掉,
而那时旧引用**应当**失效。

## 顺带记一条开发纪律

**不要在 Ral 正在跑 dev 的仓库里改渲染进程文件而不打招呼。** 每次写入都会 HMR 重载他的应用;
这次直接产出了一个他以为是产品缺陷的报错。要改就先说,或者等他停下 dev。
