# OnlyPreview 开在 tab 里时，点 workspace 芯片不会激活那个 tab

Ral 2026-09-10：

> bl onlypreview tab 中打开时，如果点击 workspace 的按钮应该激活这个 tab 现在不行 cowork 是好的

## 现象

OnlyPreview 已经作为 composite tab 开着，人切到别的 tab，然后点 composer 里 workspace 芯片的左半格
（`maestro__composer__workspace-open`）。**期望**：切回 OnlyPreview 那个 tab。**实际**：什么都没发生。

## 定位

链路是对的，但**判断落在了错的谓词上**。

```ts
// onlyPreviewMaestroOpener.ts —— 改之前
if (onlyPreviewWindowHelper.getStandaloneHost()) {
  await openRegisteredOnlyPreviewExplicitTarget(absolutePath);
  return;
}
```

`getStandaloneHost()` 这个名字在撒谎：**tab 挂载同样会设 `standaloneHost`** ——
`openOnMount()`（`onlyPreviewWindow.helper.ts:500`）和 `ensureStandalone()`（`:449`）都设它。所以
「有没有独立窗口」和「有没有承载」这两件事被同一个谓词回答了，tab 那一种被送进了窗口那条路。

那条路把「摆到前台」交给一条**六层委派链**，末端是一个可选链：

```
openRegisteredOnlyPreviewExplicitTarget
  → openOnlyPreviewAbsoluteTarget → ensureStandalone() 的 existing 分支
  → this.show()
  → this.standaloneMount?.showSurface()      // ← 末端的 `?.`
  → OnlyPreviewCoworkMount.showSurface() → deps.activate()
  → maestroBrowserView.activateTab({ id: tab.id })
```

`show()` 的实现是 `this.standaloneMount?.showSurface()` —— **挂载对象不在时它静默什么都不做，
和成功完全一样**。而目录那一支在「要打开的就是当前项目根」时（点芯片最常见的那一次）`show()` 是
**唯一**发生的事：

```ts
// onlyPreviewExplicitOpen.service.ts —— 目录分支的短路
if (onlyPreviewWorkspaceRegistry.isActiveProjectRoot(host.hostToken, inspected.rootRealPath)) {
  onlyPreviewWindowHelper.show();      // ← 这一次的全部可见效果
  return;
}
```

也就是说这一次的整个可见效果都押在那条链上，链上任何一环不成立都表现为「点了没反应」，且不报错。

**我没有把「具体断在哪一环」定死。** 每一环静态读下来都成立（`attachSurface` 设了
`standaloneMount` 和 `baseWindow`，`activateTab` 的 composite 分支会 `setActive(true)` →
`reportActivation` → `container.setVisible(true)`），而要把它钉到某一环需要真起 Electron —— 本项目
禁止在验证里做这件事。所以修法选的是**把这条链从这次动作里拿掉**，而不是继续猜。

## 修法

让「已经挂着的那一个」赢，并且**按承载种类分流**：tab 交给知道 tab id 的那一侧去激活。

```ts
const mountedHost = onlyPreviewWindowHelper.getStandaloneHost();
if (mountedHost) {
  if (isMountedOnCoworkTab(mountedHost.hostToken)) {
    const result = await maestroWindowHelper.openWorkspaceInPreview({ path: absolutePath });
    if (!result.ok) throw new Error(result.error || 'OnlyPreview could not open that path.');
    return;
  }
  await openRegisteredOnlyPreviewExplicitTarget(absolutePath);   // 窗口那一支原样
  return;
}
```

`openWorkspaceInPreview` → `openCompositeTabTarget` → `openCompositeTab`，后者对已存在的 tab 会
**显式** `await this.activateTab({ id: existing.id })`，然后才 `spec.openTarget(path)`。少四层委派，
也不再有能被 `?.` 吞掉的无操作。

`isMountedOnCoworkTab` 用 `getMountKind(hostToken)`，它在挂载已经不活着时**抛** —— 那种竞态
（tab 刚被关掉）当成「不是 tab」处理：落到窗口那一支，`ensureStandalone()` 会造一个新的，这比让芯片
报错好。

## cowork 侧

他说「cowork 是好的」，实测也没复现。但**同一个先后顺序的坑在那边成立**：cowork 的
`openOnlyPreviewTarget` 同样只问 `getStandaloneHost()`，一个「上次是窗口」的持久化偏好会在 tab 明明
开着的时候又开一个窗口（`peekOnlyPreviewHostMount()` 是上一次**切换**留下的，而通过启动器/地址栏开
的 tab 不写它，所以「tab 活着 + 偏好是 window」这个状态真实可达）。按「bl 和 cowork 同步」一起改了，
形状相同、分支方向相反（cowork 是 early-return 否定分支，因为它的 tab 路径要传 `ensureTab`）。

## 验证

- **源码守卫 12 条 / 两仓各一份**：`tests/onlypreview/onlyPreviewWorkspaceBinding.test.mjs` ·
  cowork `tests/unit/onlyPreviewWorkspaceBinding.test.mjs`。为什么是源码守卫写在文件头：这条链每一环
  都要 Electron，而钉住**接线**恰好对应真实的失败模式。
- **变异测试两仓各 5 条，全部被捕获**：删掉 tab 分支（回到只问有没有 host）· 把 tab 分支挪到窗口
  分支之后（变成死代码）· 去掉 `isActiveProjectRoot` 比对 · `previousPath` 挪到解绑之后 ·
  `chooseWorkspace` 不再开预览。
  - 其中「挪到之后」那一条**第一次是存活的** —— 我的顺序断言从 tab 分支自己开始切片，看不见它被挪
    走；切片改成取整个 `if (mountedHost)` 块之后才转红。留档：切片的起点决定了断言能不能看见"顺序"。
- bl typecheck 108 → 107（少的那条是同一批里修掉的一个 import），`scripts/maestro/check-*.mjs`
  15 条失败与 HEAD **逐条相同**，`test:onlypreview` 17 条失败与 HEAD 逐条相同；cowork typecheck 20、
  单测 503/1，均在基线上。
- **运行时那一半要你跑一次**：OnlyPreview 开在 tab 里 → 切到别的 tab → 点芯片左半格，应该切回来。
