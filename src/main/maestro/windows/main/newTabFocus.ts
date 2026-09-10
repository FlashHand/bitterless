import { xpcMain } from 'electron-xpc/main'
import type { BrowserWindow } from 'electron'

/**
 * 操作者主动开出来的空白 tab → 地址栏自动聚焦并全选。
 *
 * 契约:`docs/features/maestro-new-tab-focus-address-bar.md`(姊妹落地在 micromeet-cowork
 * `docs/features/new-tab-focus-address-bar.md`,两份要一起改)。
 *
 * **判据不在这里。** 这个模块只管"焦点怎么交接",谁配得上聚焦由调用路径决定 ——
 * `MaestroBrowserViewService.newTab()` 是"操作者开了一个空白 tab"的唯一定义,也是本函数的
 * 唯一调用点(契约 #3.1)。判据不能看 `tab.url` / `tab.kind`:带 URL 的、恢复的、Duplicate 出来的
 * tab 全都是 `kind === 'browser'` 且 URL 非空,真正区分"谁开的"的信息只存在于调用路径里。
 */
export const MAESTRO_FOCUS_ADDRESS_CHANNEL = 'coach/focus-address'

/** 操作者开了空白 tab:把焦点交给地址栏。判据在调用方(见契约 #3.1),这里只管交接。 */
export const focusAddressBarForBlankTab = (win: BrowserWindow | null): void => {
  if (!win || win.isDestroyed()) return
  // 顺序不能反:先把原生焦点从刚被隐藏的网页 view / 聊天框夺回宿主页(地址栏就在它里面),
  // 再让渲染层把 DOM 焦点放进 input。反过来会得到"input 有焦点环、打字却进了网页"的半吊子状态。
  win.webContents.focus()
  xpcMain.broadcast(MAESTRO_FOCUS_ADDRESS_CHANNEL, null)
}
