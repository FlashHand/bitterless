# 地址栏显示 `file://` —— 让 OnlyPreview 那个 tab 看起来像真实浏览器

Ral 2026-09-10：

> file:// 为啥不能用？我只是希望 url 上显示 file:// 真实用什么没关系 只要看起来像真实浏览器就好

以及同一轮：

> 而且文件我也希望你直接用 preload 去读，而不是走 main 进程，否则可能会导致卡顿

## 先分清两件被我上一轮混在一起的事

| | 他要的 | 我上一轮答的 |
| --- | --- | --- |
| **显示** | 地址栏那一行写 `file:///Users/ral/…` | — |
| **传输** | 「真实用什么没关系」 | 我论证了不该把资产 scheme 换成 `file://` |

那两个顾虑（资产 token 是可撤销/会过期的能力边界；dev 的 http 源不允许 `file://` 子资源）
**只针对传输**，对"只改显示"一条都不适用。所以这条要做，而且和能力边界完全不冲突。

## 现状：地址栏写的是一个假 URL

```ts
// maestroBrowserView.service.ts
private displayUrl(tab: OperationTab): string {
  if (tab.kind === 'home') return MAESTRO_LOCAL_HOME_DISPLAY_URL
  if (tab.kind === 'onlypreview') return this.compositeTabs.get(tab.id)?.displayUrl ?? ''
  return tab.url
}
```

composite tab 的 `displayUrl` 是**注册时那个静态字符串** ——
`MAESTRO_ONLY_PREVIEW_DISPLAY_URL = 'bitterless://only-preview'`（cowork 是
`micromeet://only-preview`）。不管里面在看哪个文件，地址栏永远是这一行。

## 只改显示会打断回车往返 —— 所以是两半

地址栏是可编辑的。显示成 `file:///Users/ral/Documents/PIL 2/2.csv` 之后，人**按一下回车**就该回到
同一个文件。而现在的判据不认 `file://`：

```ts
// shared/onlypreview/onlyPreviewTargetInput.ts —— 只认 POSIX / Windows 的裸路径
export const isAbsoluteFilePath = (input: string): boolean => { … }
```

于是 `resolveLocalPathTarget` 返回 `null`（「不是本机路径」），输入落到 `normalizeUrl`，Chromium
在普通 tab 里直接加载那条 `file://` —— 一个 `.csv` 变成原始文本或下载，而不是回到 OnlyPreview。

**显示成什么，就必须能被敲回去。** 这是这条需求的承重部分，不是附带。

## 落法

### 半一：判据认 `file://`（vendored shared 面）

`onlyPreviewTargetInput.ts` 加一个把地址栏输入归一成绝对路径的纯函数：

```ts
/** 地址栏那一串对应的本机绝对路径，`null` = 不是本机路径。裸路径和 `file://` 都认。 */
export const resolveAddressBarLocalPath = (input: string): string | null
```

`isAbsoluteFilePath` 留着（它是"长得像不像"的判据，别处还在用），新函数在它之上多认一种写法。

**编码/解码手写，不用 `node:url`。** 这个目录的东西**渲染进程也 import**，文件头那段注释已经把
规矩写死了：不碰 `node:fs`。`pathToFileURL` / `fileURLToPath` 同样是 node-only，所以：

- 出：`/Users/ral/Documents/PIL 2/2.csv` → `file:///Users/ral/Documents/PIL%202/2.csv`
- 入：反过来，`decodeURIComponent` 每一段

**用百分号编码而不是解码后的形态**，因为他要的就是"看起来像真实浏览器"—— Chrome 的地址栏对
`file://` 里的空格显示的正是 `%20`。

### 半二：显示 URL 跟着预览走

- `MaestroCompositeTabHostApi` 加 `setDisplayUrl(url: string)`，形状照 `setTitle`（同一类：mini app
  把自己的状态推给承载它的 tab）。
- `OperationTab` 加一个 live 的 composite 显示 URL 字段，`displayUrl(tab)` 优先读它，注册时那个静态
  字符串退为**兜底**（没有项目、没有选中文件时仍然显示 `bitterless://only-preview`）。
- 挂载对象加 `reportDisplayUrl(url)`：standalone 那一种没有地址栏，实现为**空操作**；cowork tab 那
  一种转给 `deps.setDisplayUrl`。

**URL 从哪里算出来 —— 不碰 `rootRealPath`。** `toSnapshot` 是**故意**把真实根路径挡在
`OnlyPreviewWorkspace` 之外的（`isActiveProjectRoot` 那段注释：「那条路径是文件授权的根基，为了省
一行就把它交出去等于白白放宽面」）。但快照里**有** `displayPath` 和 `selectedRelativePath`，而
`displayPath` 本来就已经显示在 OnlyPreview 顶栏上。所以：

```
外部预览记录活着 → 它的 displayPath + selectedRelativePath
否则项目有选中文件 → 项目的 displayPath + selectedRelativePath
否则有项目        → 项目的 displayPath（目录本身，真实浏览器也这么显示目录）
否则              → null → 兜底那个静态字符串
```

**何时推。** 挂在预览区 `publishPresentation()` 上 —— 它是每一种"预览变了"的汇合点（显式打开、
点树、恢复、书签），逐个调用方各推一次必然漏掉某一条。预览区加一个宿主注册的监听（它现在一个
对外回调都没有），宿主在那里算好 URL 再交给挂载对象。

## 他那条 preload 约束在这里的落点

「文件直接用 preload 读，不走 main」—— 这批改动**一个字节的文件都不读**：拼 URL 是纯字符串，
取值来自内存里的注册表快照。所以这条约束这里没有新增违反。

但它照出一处**既有**的：`resolveLocalPathTarget` 在 **main** 里做同步 `existsSync(target)`，而它
就在地址栏敲回车那条路上 —— 正是他说的"卡顿"的形状（冷的网络卷上一次同步 stat 能卡住 main）。

**这次不动它**，理由要说清：那个同步是**承重**的（`address-bar-local-path.md` 写着调用点在建 tab
之前，插一次异步会让输入像卡住），改成 preload 异步要一起改端口的同步契约。这是一个该由他点头的
取舍，已单独记成待定项，不夹在这条需求里顺手做。

## 验证

- 纯函数往返（vendored 面，两仓逐字节相同）：带空格 / 中文 / `#` / `?` / `%` 的路径出入一致；
  Windows 盘符与 UNC；`file://` 与裸路径两种写法都归一到同一个绝对路径；不是本机路径的输入返回
  `null`（含 `//example.com`、单独一个 `/`、`c:8080`）。
- 显示链的源码守卫：`displayUrl(tab)` 优先 live 值、静态字符串是兜底；standalone 那一种是空操作
  （它没有地址栏，推上去等于往一个不存在的控件写字）。
- 变异测试：静态字符串反过来盖住 live 值 · 判据不认 `file://`（回到往返断裂）· 编码用解码形态
  （和真实浏览器不一样）· 空操作那一侧改成真推。
- **运行时那一半要 Ral 跑一次**：OnlyPreview 里点一个文件 → 地址栏应显示它的 `file://`；
  在地址栏里对着那一行按回车 → 应回到同一个文件；点目录 → 显示目录的 `file://`。
