# Maestro 新 tab 自动聚焦地址栏

Status: designed 2026-09-09(口径已由 Ral 定死,见 #1)· **未实现** —— 本文只是契约,代码归下一阶段。

姊妹落地:`micromeet-cowork:docs/features/new-tab-focus-address-bar.md`(Cowork 侧同构,**两份要一起改**)。
本文只管 Maestro 浏览器,即 `src/main/maestro/` 与 `src/renderer/maestro/home/`。
行号取自本仓工作副本(`dev/next`,2026-09-09 复核)。

## #1 需求(Ral 2026-09-09 口述)

> new tab 需要自动聚焦 url input

口径已定,**不再讨论**:只有**操作者主动开出来的空白新 tab** 才自动聚焦地址栏并全选。

| 入口 | 聚焦? | 理由 |
|---|---|---|
| tab 条 `+` 按钮 / `Cmd+T` / tab 右键菜单里的 New tab | ✅ 聚焦 + 全选 | 人开一个空白 tab,下一个动作必然是输地址 |
| 带 URL 开出来的 tab(在新 tab 打开链接、agent 工具、页面 `window.open`) | ❌ 不聚焦 | 内容已经有了;抢焦点会打断正在看页面的人,agent 开的更不能抢 |
| 启动时的会话恢复 | ❌ 不聚焦 | 不是"新开" |
| mini-app / composite / 文件预览 一类**非网页** tab | ❌ 不聚焦 | 它们的地址栏根本不是可输入的目标(`activeLocked` → `disabled`) |

## #2 现状

### #2.1 所有新建 tab 的入口,以及今天的聚焦行为

**今天没有任何一条入口聚焦地址栏** —— 整个 `src/main/maestro/` 里 `.focus()` 只有四处
(`window.helper.ts:134` 窗口本身 · `maestroWorkbenchView.service.ts:113` 关 Workbench 后把焦点还给内容 view ·
`bookingDemo.service.ts:547` 与 `replayEngine.ts:733` 是注进页面的脚本),**建 tab 的链路上一处都没有**。
所以下表最后一列全是"不会",区别只在**该不该**。

| # | 入口 | 链路(file:line) | 新 tab 的形态 | 本特性 |
|---|---|---|---|---|
| 1 | tab 条 `+` 按钮 | `MenuBar.vue:234-243` → `tab.store.ts:229-237` → `coach.handler.ts:116-118` → `maestroWindow.controller.ts:1708-1711` → `maestroBrowserView.service.ts:1250-1261` | **空白**(`claimSpareTab({})`,`tab.url = ''`) | ✅ 聚焦 |
| 2 | `Cmd/Ctrl+T` | `shortcuts.helper.ts:18-27`(`runShortcut`)+ `:48-58`(`installShortcutsForWebContents`),绑定于 `src/main/xpc/maestroWindow.handler.ts:199-202` → 同 #1 的 `controller.newTab()` | **空白** | ✅ 聚焦 |
| 3 | tab 右键菜单 → New tab | `maestroBrowserView.service.ts:1104`(菜单体 `showTabMenu:1093-1127`;入口 `MenuBar.vue:152` / `tab.store.ts:240-242`) | **空白** | ✅ 聚焦 |
| 4 | tab 右键菜单 → Duplicate | `maestroBrowserView.service.ts:1118` → `openTabWithUrl:1222-1247` | 带 URL | ❌ |
| 5 | 页面右键 → Open link in new tab | `maestroBrowserView.service.ts:1157`(`showPageMenu:1142-1189`,由 `wc.on('context-menu')` `:1057` 触发) | 带 URL | ❌ |
| 6 | 页面右键 → Open image in new tab | `maestroBrowserView.service.ts:1163` | 带 URL | ❌ |
| 7 | 页面 `window.open` / `target=_blank` | `maestroBrowserView.service.ts:1040-1056`,关键 `:1051-1054`(一律 `deny` 弹窗,`queueMicrotask` 改开 tab) | 带 URL | ❌ |
| 8 | **control 聊天面板里点外链** | `maestroControlLinkPolicy.ts:66-90`(`installControlLinkPolicy`),`:75` `queueMicrotask(() => actions.openTab({ url }))`;装配于 `maestroControlView.service.ts:72` | 带 URL | ❌ |
| 9 | AI-CRMS 登录 tab 里逃逸的外链 | `maestroBrowserView.service.ts:676-684`,`:681` | 带 URL | ❌ |
| 10 | XPC `coach.openTab({url})` | `coach.handler.ts:120-122` → `controller:1721-1723` → `maestroBrowserView.service.ts:1267-1284`;`url` 为空时 `:1268-1271` **回落到 `newTab()`** | 带 URL(空则退化成空白) | ❌(空串退化的边界见 #4) |
| 11 | 主进程广播 `coach/open-tab`(今天唯一发起者 `openDemo`) | `maestroWindow.controller.ts:592-598`,广播在 `:597` → `tab.store.ts:104-106` → `openInNewTab:258-261` → `coach.openTab` | 带 URL | ❌ |
| 12 | 启动时的 `startUrl` | `maestroBrowserView.service.ts:255-266`(`:263` 调 `openTab`);boot 调用点 `controller:495-500` | 带 URL(`:262` 空则不开) | ❌ |
| 13 | 启动时的会话恢复 | `tab.store.ts:111-112` → `maestroBrowserView.service.ts:955-961`(只 `addTab` 成 cold tab,`view=null`,**不 activate**);随后 `tab.store.ts:130-144` `restoreLastActive` 才激活一个 | 带 URL(cold) | ❌ |
| 14 | 固定 Home tab(pinned,不可关) | `maestroBrowserView.service.ts:217`(`createPinnedHomeTab`) | 本地固定页,`activeLocked` | ❌ |
| 15 | AI-CRMS 登录 tab | `maestroBrowserView.service.ts:438`(`addAiCrmsLoginTab`)/ `:1289`(`openAiCrmsLoginTab`) | 固定地址,`activeLocked` | ❌ |
| 16 | composite mini-app tab(OnlyPreview / Trench) | `maestroBrowserView.service.ts:521`(`openCompositeTab`) | **非网页**,`view=null` | ❌ |
| 17 | 地址栏敲本地绝对路径 | `maestroBrowserView.service.ts:289-291`(`resolveLocalPathTarget` → `openOnlyPreviewAbsoluteTarget`) | 非网页(OnlyPreview) | ❌ |
| 18 | Workbench chip | `maestroWorkbenchView.service.ts:84`(`openTab`) | 根本不是 operation tab;地址栏显示固定串且 `disabled` | ❌ |

**#1 / #2 / #3 三条空白入口在主进程里已经汇成一点:`MaestroBrowserViewService.newTab()`(`:1250-1261`)。**
这是本特性能只写一处判据的前提,不是巧合 —— 三条路都先经过 `controller.newTab()`(`:1708-1711`,
顺带 `workbenchView.backgroundTab()`),再落到同一个方法。

### #2.2 焦点归属链路(主进程 → 渲染层)

| 事实 | 位置 | 它决定了什么 |
|---|---|---|
| **地址栏在 BrowserWindow 自己的 webContents 里**,不在任何子 view 里。窗口基类把 `maestro/home/index.html` 直接 `loadURL`/`loadFile` 给 `win` | `maestroWindow.controller.ts:196` `rendererPath = 'maestro/home/index.html'` → `windows/window.helper.ts:106-115` | 要让 input 真能收键盘,必须让**宿主 webContents** 拿到原生焦点,不能只在渲染层 `el.focus()` |
| 网页 tab 是盖在宿主页上的 `WebContentsView` 子 view | `maestroBrowserView.service.ts:463-481`(`buildViewSlot`:`:467` `addChildView(view, 0)` 后 `:468` 立刻 `setVisible(false)`) | 焦点在子 view 时,宿主页的 input 收不到键 |
| `activateTab` 里唯一动原生焦点归属的两行:**`:1379` `previous.view.setVisible(false)`** 与 **`:1389` `tab.view.setVisible(true)`**;两者之间隔着一个 `await`(`:1384` `switchCaptureTarget`) | `maestroBrowserView.service.ts:1315-1408` | 见 #3.3 的时序论证 |
| 本仓已有的先例:关掉 Workbench 后**显式**把焦点还给内容 view —— 说明"改可见性后焦点无人接管"在这个文件里是已知事实 | `maestroWorkbenchView.service.ts:111-113` | 交接焦点要显式写,不能指望可见性变化自己带过去 |
| `Cmd+T` 挂在**当前有焦点的那个 webContents** 的 `before-input-event` 上;control 面板同在 `MAESTRO_PARTITION`(`maestroControlView.service.ts:46`),所以在 agent 聊天框里按 `Cmd+T` 也会触发 | `shortcuts.helper.ts:48-58` | 按下时焦点通常在网页 view 或聊天框里,不在宿主页 —— 必须主动把它夺回来 |
| 地址栏 input **没有 ref、没有 autofocus**;`disabled` 绑的是 `workbenchStore.visible \|\| tabStore.activeLocked` | `MenuBar.vue:303-310`;`activeLocked` = `tab.store.ts:80-82`(`kind !== 'browser'`) | 渲染层要新加一个 ref;且 `disabled` 是 Vue 渲染出来的,**不是**立刻生效的(见 #3.4) |
| `activateTab` 的最后一行就是 `broadcastTabs()`(`:1407`),它带着新 tab 的 `active` / `kind` 一起过去 | `maestroBrowserView.service.ts:1407` | 聚焦通知排在它之后,渲染层就一定先收到新 tab 条,再收到聚焦请求 |
| 渲染层 `menuBarStore` 已经是地址栏的 controller(`url` / `go()` / 四条 xpc 订阅),模块级函数在这个文件里用 `function` 声明 | `menuBar.store.ts` 全文 | 新逻辑落在这里,并**沿用该文件的 `function` 风格**(工作区默认是箭头 const,此文件已确立 `function`) |

## #3 决定

### #3.1 判据 —— 「有没有走 `browserView.newTab()`」就是判据,**没有第二处**

不新增 `origin` 枚举、不给 tab 加字段、不在任何入口处各判一次。判据就是那条**已经存在的汇聚点**:

> **`MaestroBrowserViewService.newTab()`(`maestroBrowserView.service.ts:1250-1261`)
> 是"操作者主动开了一个空白 tab"的唯一定义,也是聚焦动作的唯一调用点。**

理由:判据**不能**看 `tab.url` 或 `tab.kind` —— 带 URL 的 tab、恢复的 tab、Duplicate 出来的 tab
全都是 `kind === 'browser'`,URL 也都非空;真正区分"谁开的"的信息只存在于**调用路径**里,
而那条路径今天已经收成一点了。散着在 18 个入口各写一遍必然漏,漏掉的症状是
"从某个入口开的 tab 不聚焦",**不报错**、typecheck 看不见、视觉验收也只在那一个入口才复现。

守卫钉死这一点(#5):任何新的空白 tab 入口必须复用 `newTab()`,不许自己去 `claimSpareTab({})`。

### #3.2 通知路径 —— 一个新广播 + 主进程先夺原生焦点

新文件 `src/main/maestro/windows/main/newTabFocus.ts`,**唯一允许发这条广播的地方**:

```ts
export const MAESTRO_FOCUS_ADDRESS_CHANNEL = 'coach/focus-address'

/** 操作者开了空白 tab:把焦点交给地址栏。判据在调用方(见契约 #3.1),这里只管交接。 */
export const focusAddressBarForBlankTab = (win: BrowserWindow | null): void => {
  if (!win || win.isDestroyed()) return
  // 顺序不能反:先把原生焦点从刚被隐藏的网页 view / 聊天框夺回宿主页(地址栏就在它里面),
  // 再让渲染层把 DOM 焦点放进 input。反过来会得到"input 有焦点环、打字却进了网页"的半吊子状态。
  win.webContents.focus()
  xpcMain.broadcast(MAESTRO_FOCUS_ADDRESS_CHANNEL, null)
}
```

频道名沿用本仓 `coach/*` 惯例(`coach/nav` · `coach/tabs` · `coach/title` · `coach/open-tab` …)。
不新增 XPC **方法**:这是主进程 → 渲染层的单向事实广播,不需要回值。

### #3.3 时序 —— 聚焦排在 `await activateTab(...)` **之后**,主进程侧**不加任何定时器**

调用点就一处,`newTab()` 里 `activateTab` 那一行的后面:

```ts
const tab = await this.claimSpareTab({})
await this.activateTab({ id: tab.id })
focusAddressBarForBlankTab(this._state.browserWindow)
```

**为什么必须排在后面 —— 抢焦点的不是"某个 view 主动 focus",而是隐藏动作把焦点丢掉:**

- 建 tab 的整条链上**没有任何 `.focus()` 调用**(#2.1 已核)。所以不存在"原生 view 把焦点抢过去"这回事。
- 真正会毁掉焦点的是 **`maestroBrowserView.service.ts:1379` 的 `previous.view.setVisible(false)`**:
  `Cmd+T` 按下时焦点几乎总在那个即将被隐藏的 view 里,一隐藏,焦点就没有归属了。
  如果先聚焦再激活,这一行会把刚放好的焦点抹掉。
- 对称的 **`:1389` `tab.view.setVisible(true)`** 让新 view 可见。它不主动 focus,
  但它是最后一次动 view 可见性的地方 —— 聚焦必须在它之后,否则焦点归属仍可能被这一帧改写。
- 这两行之间还隔着一个 `await`(`:1384` `switchCaptureTarget`),所以**不能**在 `activateTab` 内部找一个
  "隐藏之后、显示之前"的位置插进去 —— 那是一个跨微任务的中间态。`await activateTab` 返回之后才是稳定态。

**为什么 `await activateTab` 就够,不需要 `setTimeout`:**

- `activateTab` 返回时,`:1379` / `:1389` 两次可见性翻转都已经同步执行完了(`:1389` 之后到 `:1408`
  之间只剩 `applyBounds` / 圆角 / 三条广播,都不动焦点)。
- 空白 tab 的 `needsLoad` 恒为 `false`(`:1365` `Boolean(tab.url) && …`,而 `tab.url === ''`),
  所以 `:1393` 那条 fire-and-forget 的 `loadURL` 分支**不会**执行 —— 没有"稍后还会有一次导航把焦点带走"。
- 预热槽的建 view 动作(`buildViewSlot` 里 `addChildView` 后 `setVisible(false)`)发生在**更早**:
  `claimSpareTab` 的 `:1217` `void this.prewarmSpare()` 在第一个 `await` 之前同步跑完 `buildViewSlot()`,
  所以它不会在我们聚焦之后再插一脚。

真机验收若发现焦点仍被吞(只可能来自 Chromium 侧的异步焦点结算),补救是**在主进程侧延后一帧**
(`win.webContents.once('...')` 或一次 `setImmediate`),并且**必须在这一节写清是哪一行吞的**;
不接受不带理由的 `setTimeout`。

### #3.4 渲染层 —— 聚焦 + 全选,**要等一次 `nextTick`**

`menuBar.store.ts`(地址栏的 controller)持有 input 元素并提供动作;`MenuBar.vue` 只负责把 ref 交出去:

```ts
// menuBar.store.ts —— class 内一律方法简写(reactive(class) 用箭头类字段会绕过 proxy)
private addressInput: HTMLInputElement | null = null

bindAddressInput(el: HTMLInputElement | null): void {
  this.addressInput = el
}

async focusAddress(): Promise<void> {
  // 必须等一帧:coach/tabs 刚在同一批广播里到达(activateTab 的最后一行 :1407),
  // Vue 还没把新 tab 的 :disabled 应用到 DOM 上 —— 上一个 tab 若是 composite / 固定 tab,
  // input 此刻仍带着 disabled,浏览器会静默忽略 focus()。
  await nextTick()
  this.addressInput?.focus()
  this.addressInput?.select()
}
```

`init()` 里加一条订阅:`xpcRenderer.subscribe(MAESTRO_FOCUS_ADDRESS_CHANNEL, () => void this.focusAddress())`。
`MenuBar.vue` 给 `:303-310` 的 input 加 `ref="addressInput"`,在既有的 `onMounted`(`:56`)里
`menuBarStore.bindAddressInput(addressInput.value)`。

- **把元素存进 `reactive` 的 store 是安全的**:Vue 3 的 `reactive()` 只代理 Object/Array/Map/Set,
  `HTMLInputElement` 落在 `TargetType.INVALID`,原样存放 —— 不必 `markRaw`。
- **不加 `if (el.disabled) return` 之类的防御分支**:`nextTick` 之后状态就是对的,
  而真被禁用时浏览器本来就会忽略 `focus()`。
- **全选沿用同一次动作**:本仓今天**没有**任何 focus 地址栏的实现可以复用(#2.1),所以
  `focus()` + `select()` 就是那一套,不另造第二套。空白 tab 的 input 本来是空的
  (`coach/tabs` 把 `displayUrl || url` 写成 `''`),`select()` 此时是 no-op;它的价值在于
  "在新 tab 打开"之后人手动改地址时,以及日后任何复用这条路的场景。

## #4 代价 / 已知边界(知情接受,不是遗留问题)

| 代价 | 说明 |
|---|---|
| **在 agent 聊天框里按 `Cmd+T` 会把光标从聊天框拽走** | control view 同在 `MAESTRO_PARTITION`(`maestroControlView.service.ts:46`),快捷键在那里也生效。这是 `Cmd+T` 的应有语义(人要的就是新 tab),但正在打字的一句会被打断。**不为此加"聊天框里禁用 Cmd+T"的例外** |
| `coach.openTab({ url: '' })` 会退化成"操作者开了空白 tab"并聚焦 | `maestroBrowserView.service.ts:1268-1271` 的既有回落。今天**没有活的调用方**能走到:`tab.store.openInNewTab:258-259` 与 `openStartupTabIfNeeded:262` 都先挡空串,`maestroControlLinkPolicy` 只传真 URL。日后若有 agent 工具传空串,它会抢焦点 —— 那时的修法是在**调用方**挡住,不是给判据加分支 |
| 焦点在**跨进程**交接,主进程夺焦与渲染层聚焦之间隔着一次 IPC | 中间那一小段窗口里,焦点在宿主页但 DOM 焦点还没落到 input。人眼看不见,但极快的连按 `Cmd+T` 可能让第二次的 `nextTick` 先于第一次结算。表现是"连开两个 tab 只聚焦了一次",无害 |
| macOS / Windows 一致性**未实证** | `webContents.focus()` 与 `setVisible` 在 Electron 里都无平台分支,但**没跑过** —— agent 不启动桌面应用,由 owner 真机验收 |
| composite / 固定 tab 切回来时**不会**恢复地址栏焦点 | 本特性只管"新开",不管"切回"。切 tab 的焦点归属维持现状(谁也不接) |
| 预热槽 `buildViewSlot` 里 `addChildView` 与 `setVisible(false)` 之间有一瞬可见 | `maestroBrowserView.service.ts:467-468` 的既有写法。它发生在聚焦之前(#3.3 已论证),与本特性无关,**不顺手改** |

## #5 验证

- `yarn typecheck`(= `typecheck:surfaces`)。本仓 HEAD 上已有大量既有 type error,判据是
  **输出里没有一条指向本次改动的文件**(参照 `docs/features/maestro-control-inset-and-rounded-tab.md` #5 的同一口径)。
- **新增守卫** `scripts/maestro/check-new-tab-focus.mjs`,并把 `scripts/maestro/check-maestro.mjs:12`
  的 `checks.length === 42` 改成 `43`(那行是脚本数硬断言,漏改会直接红)。守卫断言四条:
  1. **判据只有一个定义点**:`focusAddressBarForBlankTab` 与 `MAESTRO_FOCUS_ADDRESS_CHANNEL`
     各只在 `src/main/maestro/windows/main/newTabFocus.ts` 声明一次,别处只能 import。
  2. **所有建 tab 的入口都经过它**:全仓 `focusAddressBarForBlankTab(` 的调用点**恰好一个**,
     且落在 `maestroBrowserView.service.ts` 的 `newTab()` 方法体内;同时
     `claimSpareTab({})`(空 meta)在全仓**恰好一次**,也在 `newTab()` 里 ——
     新的空白 tab 入口必须复用 `newTab()`,自己去 `claimSpareTab({})` 就红。
  3. **时序**:`newTab()` 里 `focusAddressBarForBlankTab(` 那一行出现在
     `await this.activateTab(` 之后(纯文本先后即可);且 `newTabFocus.ts` 里
     `win.webContents.focus()` 出现在 `xpcMain.broadcast(` 之前。
  4. **渲染层单点**:`MAESTRO_FOCUS_ADDRESS_CHANNEL` / `'coach/focus-address'` 的订阅在
     `src/renderer/` 下**恰好一处**(`menuBar.store.ts`),且 `focusAddress()` 体内同时含
     `await nextTick()`、`.focus()`、`.select()` 三样 —— 少了 `nextTick` 的症状是
     "从 composite tab 开新 tab 时不聚焦",**不报错**;少了 `select()` 就是需求 #1 少做一半。
  > 守卫的反向断言要读**去注释后**的源码,写法照 `scripts/maestro/check-control-inset.mjs:35-36`
  > 的 `codeOnly()` —— 否则解释这条守卫的注释本身会把它匹配红。
  >
  > **注意**:`yarn check:maestro` 这道聚合守卫在当前工作区**跑不过** ——
  > `assertMaestroAliasBoundary()` 因另一个特性引入的宿主别名越界在循环之前就抛
  > (已记在 `maestro-control-inset-and-rounded-tab.md` #5)。所以本特性的守卫要**单独**
  > `node scripts/maestro/check-new-tab-focus.mjs` 跑绿,并且知道聚合器里它一次都执行不到。
- **不跑 `yarn build`**(会把 `package.json` 的 `name` 改写成 `Bitterless_DEBUG_*`)、
  **不跑 lint**(已知 OOM)、**不跑 Electron E2E / 不启动桌面应用**(工作区规则)。
  焦点手感 —— 尤其 `Cmd+T` 从网页 view / 聊天框按下的那两种 —— 由 owner 真机验收。

## #6 明确不做

- **带 URL 开出来的 tab 不聚焦** —— #2.1 的 4/5/6/7/8/9/10/11/12 全部不动。内容已经在了,抢焦点是错的;
  agent 开的 tab 抢焦点更是错的(`sitemap/exploreSession.service.ts:1803` 已经把"新 tab 冒出来"
  当成一种要恢复的干扰来处理,虽然那说的是 agent 的目标 tab 而非键盘焦点)。
- **启动恢复的 tab 不聚焦**(#2.1 的 13),`startUrl` 同理(12)。
- **非网页 tab 不聚焦**:composite(OnlyPreview / Trench,16)、地址栏本地路径开出来的预览(17)、
  固定 Home(14)、AI-CRMS 登录(15)、Workbench(18)。它们的地址栏是 `disabled` 的,聚焦没有意义。
- **不给 tab 加 `origin` 字段、不加枚举、不加 XPC 方法** —— 判据就是调用路径本身(#3.1)。
- **不改切 tab 时的焦点归属** —— 只管"新开",不管"切回"。
- **不为 `Cmd+T` 在聊天框里加例外** —— 见 #4 第一行。
- **不顺手修** `buildViewSlot` 里 `addChildView` 早于 `setVisible(false)` 的既有写法。
