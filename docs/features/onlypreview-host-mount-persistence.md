# OnlyPreview 的承载方式持久化 —— 上次 tab 就 tab，上次窗口就窗口

Ral 2026-09-09：

> 切到独立窗口打开的状态应该持久化，以及 onlypreview 窗口的尺寸和位置也要像 omnipreview 那样持久化，
> 还有所在的屏幕，下次打开能恢复上次的状态。如果上次 tab 打开，下次也是 tab 打开；如果上次是窗口打开
> 下次也应该是窗口，且复用上次的位置

## 三件事里已经成立的两件

**尺寸/位置/所在屏幕 —— 早就持久化了，而且用的就是他说的那一套。**

```ts
// src/main/windows/onlyPreviewWindow.helper.ts:956 / :985
const restored = windowStateService.resolve('onlypreview');
const window = new BaseWindow({
  width: restored?.bounds.width ?? DEFAULT_WIDTH,
  height: restored?.bounds.height ?? DEFAULT_HEIGHT,
  ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : {})
});
this.baseWindowState = windowStateService.register('onlypreview', window);
```

`'onlypreview'` 与 `'omni'`、`'main'`、`'maestro'` 是同一个 `WindowStateKey` 联合里的成员，
走的是同一个 `windowStateService`。**屏幕**那一项也在里面：`resolve()` →
`resolveWindowState()` → `screen.getAllDisplays()` → `resolveWindowStateForDisplays()`，
即持久化的矩形会按**当前**这套屏幕重新校验（屏幕拔了、分辨率变了都不会把窗口留在看不见的地方）。

所以本页只补第三件：**哪一种承载**。

## 落法

新一个键，`readOnlyPreviewHostMount()` / `rememberOnlyPreviewHostMount()`
（[`onlyPreviewHostMount.service.ts`](../../src/main/miniapps/onlypreview/onlyPreviewHostMount.service.ts)）。

| | |
| --- | --- |
| 存哪 | `onlypreview_host` / `mount`，值是 `'tab'` \| `'window'` |
| 默认 | `'tab'` —— 工作区芯片一直是开 tab 的（mini-016），没有记录时保持那个行为 |
| 何时记 | host toggle **结算之后**，记的是 `settledKind` 而不是 `destinationKind` |
| 何时读 | 打开入口发现**当前没有任何承载**时 |

**为什么单开一个键，而不是加进 `OnlyPreviewSettings`。** 那个对象的 parser 是严格的：未知字段抛错、
每个字段必填。往里加一个字段，所有**已存**的记录都会解析失败 —— 读路径会兜住并回落默认值，
于是每个人的 OnlyPreview 设置被静默重置一次。为一个不面向用户的状态位付这个代价不值得；
而它也确实不属于那个对象 —— 它是「上次的界面状态」，和窗口位置同类，不是一条偏好。

**记 `settledKind` 而不是 `destinationKind`。** 切换可能落在别处（`buildHost` 失败后的回退），
而「下次开哪种」要跟着**实际结果**，不是跟着意图。

**写是 fire-and-forget 且吞异常。** 调用点在切换已经成功之后：一次写不进去只该影响下次的默认，
不该把一次成功的切换报成失败。读失败同理落默认 —— 一个状态位不该让「打开 OnlyPreview」失败。

## 两个入口的顺序：先问承载，再问偏好

```
打开一个目标
  ├─ 已经有独立窗口？ → 复用它（issue: onlypreview-detached-window-gets-a-second-tab）
  ├─ 上次是窗口？     → ensureStandalone() 造窗口，它自己从 'onlypreview' 恢复位置
  └─ 否则            → 开 tab 再交目标（顺序承重）
```

顺序反了的后果不同级：先读偏好的话，一个**已经开着的**窗口可能被再开一个 tab 抢走内容 ——
那正是那条 issue 的现象。所以「已有承载」永远排在最前。

窗口那一支**不需要自己建窗口**：`ensureStandalone()` 没有 host 时就会造一个，而它造出来的窗口
从 `windowStateService` 恢复尺寸/位置/屏幕 —— 也就是他要的「复用上次的位置」，不用额外接线。

| 仓 | 入口 |
| --- | --- |
| bitterless | `src/main/windows/onlyPreviewMaestroOpener.ts`（宿主注册进 maestro 的那个 preview 槽） |
| micromeet-cowork | `src/main/miniapps/onlypreview/host/onlyPreviewOpenTarget.ts` |

两仓的**存储**是各自适配的（bitterless 走 `SettingDao` xpc → 隐藏 sqlite 渲染进程；cowork 走
`host/onlyPreviewSettingStore` 的文件后备存储），和 `onlyPreviewSettings.service.ts` 同一处适配点。

## 验证

[`tests/onlypreview/onlyPreviewHostMount.test.mjs`](../../tests/onlypreview/onlyPreviewHostMount.test.mjs)
（cowork：`tests/unit/onlyPreviewHostMount.test.mjs`）7 条：默认 tab、未知值落默认、读失败落默认不抛、
写是 fire-and-forget 且不抛、不碰 `OnlyPreviewSettings`（检代码不检注释 —— 文件头那段注释必须提到
那个名字，因为它在解释为什么不用它）、toggle 记的是 `settledKind`、入口的「承载先于偏好」顺序。

**运行时那一半要你跑一次才算**：切成窗口 → 关掉 app → 重开 → 点工作区芯片，应该直接出窗口
且位置与上次一致。这条走的是真实的 sqlite / 文件存储与真实的窗口创建，单测覆盖不到。

## 不做

- **不做「记住每个屏幕上的位置」。** `windowStateService` 存一份矩形并按当前屏幕集校验，
  这已经是 `omni` / `main` 的既有行为；多屏各记一份是另一个特性，他没要求。
- **不持久化 tab 本身。** composite tab 不进 `tab.store` 的持久化（过滤是 `kind === 'browser'`，
  `browser.types.ts` 记了理由）—— 恢复的是「下次用哪种承载」，不是「上次那个 tab 还在」。
