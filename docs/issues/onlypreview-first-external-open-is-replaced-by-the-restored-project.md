# 第一次打开工作区外的文件没反应，第二次才成功

Ral 2026-09-10：

> 首先打开 `/Users/ral/Documents/PIL 2/2.csv` 这种 …… cowork 是打开了 op(onlypreview)，但是第一次
> 打开没成功，第二次打开才成功

随后确认：**bl 和 cowork 都有这个问题**。

OnlyPreview 本身开出来了；**那个文件没有出现在预览区**。再点一次同一个文件就正常。

## 这是一个回归，来源是同一天的另一个修复

前一条 issue [`onlypreview-external-file-open-drops-the-project`](onlypreview-external-file-open-drops-the-project.md)
修的是「预览一个项目外的文件之后顶栏变成 No project open」。那个修复在文件那一支末尾补了一次
**fire-and-forget 的项目恢复**：

```ts
// onlyPreviewExplicitOpen.service.ts —— 那次修复加的
if (!onlyPreviewWorkspaceRegistry.restore(host.hostToken)) {
  void onlyPreviewRecentDirectoryService.restoreWorkspace(host.hostToken).then(…)
}
```

当时的判断是「恢复项目只影响树，不影响已经呈现的预览」。**那个判断是错的。**

## 根因：恢复项目会**呈现那个项目记住的文件**

```ts
// onlyPreviewRecentDirectory.service.ts:320-329
const selectedRelativePath = await this.readSelectedFile(workspace.displayPath);
…
if (!selectedRelativePath) return workspace;
const restored = { ...workspace, selectedRelativePath };
// Best effort: a file that has been deleted … leaves the Project open with nothing previewed
await this.presentSelection?.(hostToken, restored).catch(() => undefined);
```

`presentSelection` 就是 `presentOnlyPreviewRestoredSelection`（在 `onlyPreview.handler.ts` 注册）——
和显式打开走**同一个预览区**。所以完整链条是：

| 步 | 发生什么 |
| --- | --- |
| 1 | 打开一个**项目外**的文件，此刻还没有项目绑定 |
| 2 | `presentOnlyPreviewExplicitFile` 把那个文件呈现出来 ✔ |
| 3 | 上面那段 fire-and-forget 的 `restoreWorkspace` 跑起来 |
| 4 | 它恢复上次的项目，并在 `:329` **呈现那个项目记住的文件** |
| 5 | 第 2 步的外部预览被**替换掉** → 看起来「没打开」 |
| 6 | 第二次点:`restore(hostToken)` 已非空 ⇒ 那段 kick 被 `if (!restore(…))` 跳过 ⇒ 没人替换 ⇒ 正常 |

**为什么两仓都有**：那次修复是两仓同步落的。
**为什么静默**：第 4 步是一次正常的「呈现另一个文件」，不是错误 —— 没有任何日志说「你刚打开的那个
被换掉了」。
**为什么第二次就好**：`if (!restore(…))` 这个前置条件在第二次不成立。

`/Users/ral/Documents/PIL 2/2.csv` 里的**空格与 `.csv` 都不是原因** —— 任何一个项目外的文件、
在「当前没有项目绑定」这个状态下第一次打开，都会撞上它。

## 更正：上面那条只是**两条**替换路径中的一条

**2026-09-10 追加。** 第一版修复(下面的 (a))落地后我写了「已修」——**那个结论是错的**。一次对抗式
审计(3 个独立 refute 视角,其中 2 个各自做了运行时复现)指出还有第二条路径,而它单独就足以复现同一个
症状。我自己核实过,确认成立。

**第二条路径:绑定项目会**撤销**这个 host 的外部预览。**

```ts
// onlyPreviewWorkspace.registry.ts —— registerValidatedTarget 里,改之前
this.revokeHost(host.hostToken);        // ← 跨 kind、整个 host
// revokeHost(:427-433)
for (const workspace of [...this.workspaces.values()]) {
  if (workspace.hostToken === hostToken) this.revokeWorkspace(workspace.workspaceId);
}
```

对照 `registerExternalPreview(:138)` 用的是**窄**的 `this.revokeExternalPreview(...)` —— 这个不对称
就是根因。完整链条:

| 步 | 发生什么 |
| --- | --- |
| 1 | 外部文件被 `registerExternalPreview` 注册并呈现,预览区的 `workspaceId` 指向它 |
| 2 | fire-and-forget 的恢复走到 `createWorkspaceForTarget` → `registerValidatedTarget` |
| 3 | 它第一件事就是 `revokeHost`,**连带撤掉那条还活着的外部预览** |
| 4 | 撤销监听(`onlyPreview.handler.ts:153-158`)→ `handleWorkspaceRevoked` → `clearPresentation` |
| 5 | 预览区被**清空** |

注意第 3 步排在 (a) 新加的 `if (!presentRestoredSelection) return restored;` **之前**,所以 (a) 拦不
住它。也就是说 (a) 只把症状从「被项目记住的文件换掉」变成「被清空」——**对人来说没有区别**,他报的
「第一次打开没反应」照旧。

**为什么当时的测试没抓到。** (a) 的断言只数 `presentSelection` 的调用次数(它确实是 0),而这条路径
一个断言都没碰到:那些用例既没有 `registerExternalPreview`,也没有挂撤销监听。cowork 那侧更弱 ——
是纯源码正则守卫,看不见运行时撤销。

**修法(已落地)。** 加一个和 `revokeExternalPreview` 对称的窄撤销,`registerValidatedTarget` 用它:

```ts
/** 只撤销这个 host 的**项目**记录 —— 外部预览那一条留着。 */
revokeProject(hostToken: unknown): boolean {
  const host = this.hosts.require(hostToken, ['content']);
  const workspaceId = this.projectWorkspaceByHost.get(host.hostToken);
  return workspaceId ? this.revokeWorkspace(workspaceId) : false;
}
```

判断依据:绑定新项目要作废的是**旧项目**的能力;外部预览按定义不属于任何项目,它的生命周期由
`registerExternalPreview` 自己的窄撤销 + token TTL 管。`revokeHost` 保持跨 kind —— host 整个没了
是另一回事,那里的宽撤销是对的(测试里专门有一条钉它,防止照着这次一起收窄)。

顺带修正了 `replacingOwnWorkspace`:原来算的是「这个 host 有任何记录」,配上窄撤销会在
`MAX_WORKSPACES` 边界上放行一次并不腾出槽位的注册;改成 `projectWorkspaceByHost.has(...)`,和
`registerExternalPreview` 对称。

**验证(两仓各 4 条行为测试,真跑注册表 + 撤销监听)**:
`tests/onlypreview/onlyPreviewExternalPreviewSurvivesProjectBind.test.mjs` ·
cowork `tests/unit/onlyPreviewExternalPreviewSurvivesProjectBind.test.mjs`(esbuild bundle 真对象,
不是源码守卫)。变异测试:调用点改回 `revokeHost` → 3/4 红;`revokeProject` 拿错 map → 4/4 红;
把 `revokeHost` 也收窄 → 1/4 红。两仓套件失败集与 HEAD 逐条相同(bl 17 / cowork 1)。

## 另一处更正:「树里那一项照样高亮」是错的

(a) 的第二条判断写的是「不呈现时返回的仍是 `restored`,树里那一项照样高亮」。**那句不成立**:
`restored` 只是一个对象副本(`{ ...workspace, selectedRelativePath }`),注册表记录从来没拿到这个选中
—— 写它的唯一入口是 `onlyPreviewRestoreSelection.service.ts` 里的 `Registry.select(...)`,而那正是
早退跳过的那一步。所以 `toSnapshot` 产出的快照里没有 `selectedRelativePath`,树**不会**高亮。

这个行为本身是**对的**(人刚点名要看另一个文件,不该再去高亮项目记住的那个),错的是文档里那句
描述。留档而不是删掉:一句"看起来解释得通"的因果,比没有解释更容易在下一次被当成前提。

## 修法 —— 已落地 (a)

**恢复项目的那一次不该呈现任何东西。** 第 3 步要的只是「让项目回到树里」，而 `restoreWorkspace`
顺手把「恢复上次预览的文件」也做了 —— 那是它服务**启动恢复**场景时的正确行为，在这里是多余的。

```ts
// onlyPreviewRecentDirectory.service.ts
async restoreWorkspace(
  hostToken: unknown,
  options: { presentRestoredSelection?: boolean } = {}   // 缺省 true
): Promise<OnlyPreviewWorkspace | null>

// restoreFromStorage —— 早退排在 presentSelection **之前**
if (!presentRestoredSelection) return restored;
await this.presentSelection?.(hostToken, restored).catch(() => undefined);
```

```ts
// onlyPreviewExplicitOpen.service.ts —— 文件那一支
.restoreWorkspace(host.hostToken, { presentRestoredSelection: false })
```

三个判断值得记下来：

- **缺省是「呈现」。** 启动恢复靠它实现「下次打开还在上次那个文件」；把缺省写成不呈现会静默删掉
  那个特性，而它没有任何断言（所以变异测试里专门有一条）。
- **不呈现时返回的仍是 `restored`（带 `selectedRelativePath`）**，不是 `workspace`。树里那一项照样
  高亮，只是预览区不动 —— 那正是「外部预览与项目选中并存」的既有语义
  （`onlypreview-external-preview-clears-project-selection.md` 最后那次裁定）。
- **`restoreFlights` 是按 host 的飞行缓存**，所以两个调用方的 `presentRestoredSelection` 可能不一致，
  先到的那个决定这一次。**这不是漏洞**：唯一会撞上的组合是「显式打开一个外部文件」与「shell 挂载
  时的恢复」同时发生，而那时候不呈现那个记住的文件正是对的 —— 人刚刚点名要看另一个文件。

否决的两条，留档：

- **(b) 恢复完成后再把外部文件呈现一遍。** 那是让两次呈现比赛，谁后到谁赢；而"后到"取决于索引大小。
- **(c) 在 `presentSelection` 那一行判断「预览区正在显示外部预览就跳过」。** 把一个调用方的上下文
  塞进被调用方，下一个调用方还会再撞一次。

## 与 Ral 的第二条要求的关系

他同一条消息里要求：**工作区外的文件不该在 OnlyPreview 里打开，而是另封装一个渲染进程**
（拷一份 vuePreview / chromePreview 的能力，也要有 `onlypreview__previewRegion`），只有工作区**内**
的文件走 workspace 预览。

那条是这一整类 bug 的**结构性解**：外部文件与项目从此不共用同一个预览区，第 4 步就不存在了 ——
它连"谁替换谁"这个问题都消掉。本条 issue 的 (a) 是在那之前的即时修复；两者不冲突，(a) 也不会在
做那条时变成需要拆掉的东西（`restoreWorkspace` 不该顺手呈现，这一点本身就是对的）。

## 验证

- **bitterless 行为测试**（`tests/onlypreview/onlyPreviewRecentDirectory.test.mjs`）：两种模式各真跑
  一次 —— 缺省呈现那个记住的文件；`presentRestoredSelection: false` 时**一次都不呈现**，但仍把
  `selectedRelativePath` 带回去。为此加了一个按 `sub_key` 分开的存储桩：原来那个共用一个值，
  读不到「上次那个文件」（它在另一个子键上），呈现那一支根本走不到。
- **cowork 源码守卫**（`tests/unit/onlyPreviewRestorePresentation.test.mjs`）：本仓这个服务是**适配**过
  的（存储从 `SettingDao` 换成文件后备），没有对应 harness，所以守的是「那次适配没把修复漏掉」——
  这正是 vendored/adapted 关系下真实会发生的失败。
- **变异测试两仓各 5 条，全部被捕获**：删掉早退（回到缺陷）· 早退挪到呈现之后（参数等于没生效）·
  缺省值写反（启动恢复不再呈现）· 不呈现时返回 `workspace` 而不是 `restored`（树里高亮丢了）·
  显式文件那一支忘了传 `false`。
- 两仓基线未动：bitterless `test:onlypreview` 17 失败 / `main` 65 错；cowork 单测 1 失败 / node 20。
- **运行时那一半要你跑一次**：在没有项目绑定的状态下打开一个工作区外的文件（例如
  `/Users/ral/Documents/PIL 2/2.csv`），**第一次就该出现**。
