# OnlyPreview 脱离成独立窗口后，工作区芯片又开了第二个 OnlyPreview tab

Ral 2026-09-09：

> 当 tab 中打开 onlypreview 然后切换成独立窗口打开，此时点击 control 中 workspace 又新建了一个
> onlypreview tab，应该直接聚焦 onlypreview window。

复现：在 tab 里打开 OnlyPreview → 用顶栏那个按钮切成独立窗口 → 点 control 里的工作区芯片。
结果是**同时存在两个 OnlyPreview**（一个窗口、一个新 tab），而不是把已有的窗口摆到前台。

## 根因：两仓的芯片路径都**无条件先建 tab**

| 仓 | 芯片入口 | 无条件那一步 |
| --- | --- | --- |
| micromeet-cowork | `cowork.handler.openWorkspaceInPreview` → `openOnlyPreviewTarget` | `newTab({ kind: 'miniapp', miniappId: 'only-preview' })` |
| bitterless | `coach.handler.openWorkspaceInPreview` → `maestroWindowHelper.openWorkspaceInPreview` → `openCompositeTabTarget` | `openCompositeTab({ id: MAESTRO_ONLY_PREVIEW_TAB_ID })` |

两处都是「先把承载 tab 弄出来，再把目标交给它」——**那个顺序本身是对的**，理由写在各自的注释里：
反了的话 mini app 自己的 "ensure a host" 会找不到 host，转而弹一个独立窗口。

问题在于「先弄出承载 tab」被写成了**无条件**。而承载已经存在、只是它现在是一个**窗口**时，
正确动作是复用它 —— `openOnlyPreviewAbsoluteTarget` 内部的 `ensureStandalone()` 本来就会返回已有
host 并把它摆到前台，也就是说**下游早就是对的，上游多做了一步**。

这一条在 cowork 侧只差半步就已经存在了：

```ts
// micromeet-cowork/src/main/miniapps/onlypreview/host/onlyPreviewOpenTarget.ts（改之前）
// Finder opens reuse a detached OnlyPreview too; do not create a tab and steal its Project.
export const openOnlyPreviewOperatingSystemTarget = async (target) => {
  if (onlyPreviewWindowHelper.getStandaloneHost()) { … } else { … }
}
```

判断写对了，但**只写在 Finder 那个变体里**。它和 `preserveTreeSelection` 这个真正属于 Finder 的
差异被捆在了一起 —— 而「有窗口就别建 tab」对**每一个**调用方都成立。

## 修复

**判断上移到公共入口，`preserveTreeSelection` 留给 Finder。**

- **cowork**：`openOnlyPreviewTarget` 自己先问 `getStandaloneHost()`；
  `openOnlyPreviewOperatingSystemTarget` 退化成「同一个入口 ＋ `preserveTreeSelection: true`」。
- **bitterless**：判断不能放进 `maestroBrowserView.openCompositeTabTarget` —— maestro 那棵树
  **不许 import OnlyPreview**（`check:maestro` 的别名边界，`onlyPreviewCoworkTab.ts` 顶部的注释
  说明了为什么胶水住在宿主侧）。所以芯片改走**宿主已经注册的那个 preview opener**
  （`registerMaestroPreviewOpener`，EyesOnAgents 已经在用同一个槽），由宿主侧决定：
  有独立窗口就复用，否则走「开 tab 再交目标」那条既有原语。

这也顺手把 bitterless 的芯片从「硬编码开某个 composite tab」换成了「用那个本来就为此存在的槽」。

## 验证

两仓各一条源码守卫：公共入口里必须出现 `getStandaloneHost()` 判断，且 Finder 变体里**不再**
自己拼那个判断（拼两遍就是两个可以各自写反的地方）。

## 与「模式持久化」的关系

Ral 同一条消息里还要求「切到独立窗口的状态要持久化，下次按上次的方式打开」。那是
[`onlypreview-host-mount-persistence`](../features/onlypreview-host-mount-persistence.md) ——
两件事在**同一个决策点**汇合（「此刻没有承载时，该建哪一种」），但可以分开落：
本条只管「承载已经存在时不要再建一个」。
